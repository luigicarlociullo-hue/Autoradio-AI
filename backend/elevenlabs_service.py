"""Text-to-Speech service.
Primary: ElevenLabs (eleven_multilingual_v2) — usato sempre quando
         ELEVENLABS_API_KEY è presente.
Fallback: OpenAI TTS-1-HD via Emergent Universal Key gateway
         (OPENAI_API_KEY + OPENAI_BASE_URL, endpoint /audio/speech) — usato solo
         se ElevenLabs fallisce o non è configurato.
Generated MP3s are stored in TTS_DIR and served through /api/tts/{filename}.

CACHE (v13.0): TTS deterministico basato su hash SHA256 di
(voice_key + kind + text). Prima di chiamare qualsiasi API TTS si verifica
la collection Mongo `tts_cache`; se il file audio è già stato generato in
passato per lo stesso script/voce/kind viene RIUTILIZZATO senza pagare
nuovamente il provider. Il file audio vive su Object Storage — la cache
locale su disco è solo un'ottimizzazione lazy.
"""
import os
import uuid
import hashlib
import logging
from pathlib import Path
import httpx

logger = logging.getLogger(__name__)

ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "").strip()
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "").strip().rstrip("/")
TTS_DIR = Path(__file__).parent / "tts_audio"
TTS_DIR.mkdir(exist_ok=True)

# Internal voice_key → OpenAI TTS voice (nova/alloy/echo/fable/onyx/shimmer)
# Scelte italiane pensate per timbro naturale e varietà DJ:
VOICE_KEY_TO_OPENAI = {
    "female-1": "nova",     # bright energetic
    "female-2": "shimmer",  # youthful warm
    "female-3": "fable",    # storyteller
    "female-4": "nova",
    "female-5": "shimmer",
    "male-1":   "onyx",     # deep confident
    "male-2":   "echo",     # smooth
    "male-3":   "alloy",    # neutral versatile
    "male-4":   "onyx",
    "male-5":   "echo",
}

# ElevenLabs voice map (primary provider)
VOICE_KEY_TO_ELEVEN = {
    "female-1": "EXAVITQu4vr4xnSDxMaL",
    "female-2": "AZnzlk1XvdvUeBnXmlld",
    "female-3": "MF3mGyEYCl7XYWbV9V6O",
    "female-4": "XB0fDUnXU5powFXDhCwa",
    "female-5": "21m00Tcm4Tlm3f5Y58nb",
    "male-1":   "ErXwobaYiN019PkySvjV",
    "male-2":   "pNInz6obpgDQGcFmaJgB",
    "male-3":   "TxGEqnHWrfWFTfGW9XjX",
    "male-4":   "VR6AewLTigWG4xSOukaG",
    "male-5":   "yoZ06aMxZJJ28mfd3POQ",
}
DEFAULT_ELEVEN_ID = "pNInz6obpgDQGcFmaJgB"


def is_enabled() -> bool:
    """True se abbiamo ElevenLabs (primario) O OpenAI via Universal Key (fallback)."""
    return bool(OPENAI_API_KEY and OPENAI_BASE_URL) or bool(ELEVENLABS_API_KEY)


async def _synth_openai(text: str, voice_key: str) -> bytes | None:
    """OpenAI TTS-1-HD via Emergent gateway (fallback). Ritorna bytes mp3 o None."""
    if not OPENAI_API_KEY or not OPENAI_BASE_URL:
        return None
    # v13.7 · Gate AI Master Control: OPENAI TALK OFF → non chiamare l'API
    try:
        from motor.motor_asyncio import AsyncIOMotorClient
        _murl = os.environ.get("MONGO_URL"); _dbn = os.environ.get("DB_NAME")
        if _murl and _dbn:
            _c = AsyncIOMotorClient(_murl)
            _s = await _c[_dbn].station.find_one({"_id": "state"}, {"ai_openai_talk": 1})
            _c.close()
            if not (_s and _s.get("ai_openai_talk")):
                logger.info("[TTS] OpenAI TALK bloccato: AI OPENAI TALK OFF")
                return None
    except Exception:
        pass
    voice = VOICE_KEY_TO_OPENAI.get(voice_key, "nova")
    url = f"{OPENAI_BASE_URL}/audio/speech"
    body = {"model": "tts-1-hd", "voice": voice, "input": text[:4000]}
    headers = {"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(url, headers=headers, json=body)
        if r.status_code != 200:
            logger.warning(f"OpenAI TTS {r.status_code}: {r.text[:220]}")
            return None
        if not r.content or len(r.content) < 200:
            logger.warning("OpenAI TTS returned empty/too-small body")
            return None
        return r.content
    except Exception as e:
        logger.warning(f"OpenAI TTS error: {e}")
        return None


async def _synth_elevenlabs(text: str, voice_key: str, kind: str = "") -> bytes | None:
    """ElevenLabs primario (eleven_multilingual_v2). Ritorna bytes mp3 o None.

    Il parametro `kind` abilita il routing "smart" (default v12.11):
      - Se station.tts_provider == 'smart' (o non impostato): usa ElevenLabs
        SOLO quando kind == 'answer' (risposta a un ascoltatore). Per tutti
        gli altri segmenti (music intro, news, meteo, etc.) ritorna None così
        il fallback OpenAI TTS-1-HD entra in azione — molto più economico.
      - Se station.tts_provider == 'elevenlabs': usa sempre ElevenLabs.
      - Se station.tts_provider == 'openai': usa sempre OpenAI (return None).
    """
    # KILL SWITCH (env, permanente): TTS_DISABLE_ELEVENLABS=true blocca sempre.
    if os.environ.get("TTS_DISABLE_ELEVENLABS", "").strip().lower() in ("1", "true", "yes"):
        logger.info("[TTS] ElevenLabs disabled by env kill-switch")
        return None
    # FM_MODE MASTER (v13.1): il toggle "FM MODE" nella Regia ha priorità
    # assoluta su qualsiasi altra impostazione TTS:
    #   • FM_MODE ON  → sempre ElevenLabs HD (radio vera, alta espressività)
    #   • FM_MODE OFF → sempre OpenAI TTS (economy, default)
    fm_mode = None
    provider_mode = "smart"  # default v12.11+ = smart routing (fallback se fm_mode assente)
    try:
        from motor.motor_asyncio import AsyncIOMotorClient
        _mongo_url = os.environ.get("MONGO_URL")
        _db_name = os.environ.get("DB_NAME")
        if _mongo_url and _db_name:
            _client = AsyncIOMotorClient(_mongo_url)
            _st = await _client[_db_name].station.find_one({"_id": "state"}, {"tts_provider": 1, "fm_mode": 1})
            _client.close()
            if _st:
                fm_mode = bool(_st.get("fm_mode"))
                if _st.get("tts_provider"):
                    provider_mode = str(_st.get("tts_provider")).lower()
    except Exception:
        pass

    # FM_MODE override forte
    if fm_mode is True:
        provider_mode = "elevenlabs"
    elif fm_mode is False:
        provider_mode = "openai"

    if provider_mode == "openai":
        logger.info("[TTS] ElevenLabs disabled by admin toggle (openai)")
        return None
    if provider_mode == "smart" and (kind or "").lower() != "answer":
        # Riserva ElevenLabs solo alle risposte in diretta agli ascoltatori.
        logger.info(f"[TTS] smart-mode: kind='{kind}' → OpenAI (ElevenLabs solo per 'answer')")
        return None
    # provider_mode == 'elevenlabs' oppure smart+answer → prosegui con ElevenLabs
    if not ELEVENLABS_API_KEY:
        return None
    # v13.18 · Per-DJ override: se un record `djs` con lo stesso voice_key ha
    # `eleven_voice_id`, `eleven_model` o `voice_settings` valorizzati, li usa
    # (permette a Leo/Aria/Max/L&C di avere voci Turbo v2.5 custom senza
    # patchare la mappa hardcoded). Fallback: mappa VOICE_KEY_TO_ELEVEN.
    voice_id = VOICE_KEY_TO_ELEVEN.get(voice_key, DEFAULT_ELEVEN_ID)
    model_id = "eleven_multilingual_v2"
    vs = {"stability": 0.4, "similarity_boost": 0.8, "style": 0.5, "use_speaker_boost": True}
    try:
        from motor.motor_asyncio import AsyncIOMotorClient
        _murl = os.environ.get("MONGO_URL"); _dbn = os.environ.get("DB_NAME")
        if _murl and _dbn:
            _c = AsyncIOMotorClient(_murl)
            _dj = await _c[_dbn].djs.find_one(
                {"voice_key": voice_key},
                {"_id": 0, "eleven_voice_id": 1, "eleven_model": 1, "voice_settings": 1},
            )
            _c.close()
            if _dj:
                if _dj.get("eleven_voice_id"): voice_id = _dj["eleven_voice_id"]
                if _dj.get("eleven_model"):   model_id = _dj["eleven_model"]
                if isinstance(_dj.get("voice_settings"), dict):
                    vs.update({k: v for k, v in _dj["voice_settings"].items() if v is not None})
    except Exception as e:
        logger.debug(f"[TTS] per-DJ override lookup failed: {e}")

    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    headers = {"xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json", "Accept": "audio/mpeg"}
    body = {
        "text": text[:900],
        "model_id": model_id,
        "voice_settings": vs,
    }
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            r = await client.post(url, headers=headers, json=body)
        if r.status_code != 200:
            logger.warning(f"ElevenLabs {r.status_code}: {r.text[:200]}")
            return None
        return r.content
    except Exception as e:
        logger.warning(f"ElevenLabs error: {e}")
        return None


async def synth_speech(text: str, voice_key: str = "female-1", kind: str = "") -> str | None:
    """
    Genera TTS. Primario ElevenLabs, fallback OpenAI TTS-1-HD (Universal Key).
    Il parametro `kind` abilita il routing "smart" (ElevenLabs solo per 'answer').
    Ritorna il filename dentro TTS_DIR, o None se entrambi falliscono.

    CACHE: prima di chiamare l'API, cerca in db.tts_cache un record con la
    stessa `content_hash` (SHA256 di voice_key+kind+text). Se esiste,
    riutilizza il file audio già presente su Object Storage — nessuna
    chiamata al provider TTS, zero spreco.
    """
    if not text or not text.strip():
        return None
    text = text.strip()

    # ---- Cache lookup ---------------------------------------------------
    content_hash = hashlib.sha256(
        f"{voice_key}|{kind}|{text}".encode("utf-8")
    ).hexdigest()
    cached_filename = None
    try:
        from motor.motor_asyncio import AsyncIOMotorClient
        _mongo_url = os.environ.get("MONGO_URL")
        _db_name = os.environ.get("DB_NAME")
        if _mongo_url and _db_name:
            _client = AsyncIOMotorClient(_mongo_url)
            _db = _client[_db_name]
            hit = await _db.tts_cache.find_one({"_id": content_hash})
            _client.close()
            if hit and hit.get("filename"):
                cached_filename = hit["filename"]
    except Exception as e:
        logger.debug(f"[TTS cache] lookup failed: {e}")

    if cached_filename:
        # Verifica esistenza locale, altrimenti scaricherà dall'objstore on-demand
        # via l'endpoint /api/tts/{filename}. In entrambi i casi ritorniamo subito.
        logger.info(f"[TTS cache] HIT hash={content_hash[:10]}… → {cached_filename} (skip API)")
        return cached_filename

    # ---- Cache MISS: genera davvero ------------------------------------
    # 1) ElevenLabs (primary — HD voice) — con smart-routing su kind
    audio = await _synth_elevenlabs(text, voice_key, kind=kind)
    provider = "elevenlabs"

    # 2) Fallback OpenAI TTS-1-HD (only if ElevenLabs failed / not configured)
    if not audio:
        audio = await _synth_openai(text, voice_key)
        provider = "openai-tts-1-hd"

    if not audio:
        return None

    # Filename DETERMINISTICO basato sul contenuto → riuso trasparente e
    # de-duplicazione anche se il record cache si perdesse.
    filename = f"tts_{content_hash[:24]}.mp3"
    (TTS_DIR / filename).write_bytes(audio)
    logger.info(f"TTS synthesized via {provider}: {filename} ({len(audio):,} bytes)")
    # Best-effort push to Emergent Object Storage (no-op unless USE_OBJECT_STORAGE=true).
    try:
        import object_storage
        if object_storage.is_enabled():
            await object_storage.put_mp3(f"tts/{filename}", audio)
    except Exception as e:
        logger.debug(f"objstore push skipped: {e}")

    # Salva nella cache Mongo per riuso futuro
    try:
        from motor.motor_asyncio import AsyncIOMotorClient
        from datetime import datetime, timezone
        _mongo_url = os.environ.get("MONGO_URL")
        _db_name = os.environ.get("DB_NAME")
        if _mongo_url and _db_name:
            _client = AsyncIOMotorClient(_mongo_url)
            await _client[_db_name].tts_cache.update_one(
                {"_id": content_hash},
                {"$set": {
                    "filename": filename,
                    "voice_key": voice_key,
                    "kind": kind,
                    "provider": provider,
                    "text_preview": text[:200],
                    "bytes": len(audio),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }},
                upsert=True,
            )
            _client.close()
    except Exception as e:
        logger.debug(f"[TTS cache] persist failed: {e}")

    return filename


def tts_path(filename: str) -> Path | None:
    p = TTS_DIR / filename
    if not p.exists() or not p.is_file():
        return None
    try:
        p.resolve().relative_to(TTS_DIR.resolve())
    except ValueError:
        return None
    return p


def tts_dir() -> Path:
    """Directory dove vengono conservati i file TTS mp3 (cache locale)."""
    return TTS_DIR




def cleanup_old(max_files: int = 200):
    files = sorted(TTS_DIR.glob("*.mp3"), key=lambda p: p.stat().st_mtime, reverse=True)
    for p in files[max_files:]:
        try: p.unlink()
        except Exception: pass
