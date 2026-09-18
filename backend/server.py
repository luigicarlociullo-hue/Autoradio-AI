from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Cookie, Header, UploadFile, File, Form
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import asyncio
import random
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, ValidationError, field_validator
from typing import List, Optional, Literal
import uuid
from datetime import datetime, timezone, timedelta
import httpx

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from emergentintegrations.llm.chat import LlmChat, UserMessage
from hf_audio import synth_speech as bark_synth_speech, synth_music, audio_path, cleanup_old, AUDIO_DIR
import paypal_service
import telegram_bot
import suno_service
import elevenlabs_service
import object_storage
import bpm_service
import video_service


async def synth_speech(text: str, voice_key: str = "female-1", kind: str = ""):
    """Preferred TTS pipeline: ElevenLabs first (best Italian quality), then Bark as fallback.
    `kind` viene passato al layer ElevenLabs per il routing "smart" (usa
    ElevenLabs solo per kind='answer', OpenAI TTS-1-HD per il resto).
    Returns (filename, subpath) where subpath is 'tts' or 'audio' for URL routing."""
    if elevenlabs_service.is_enabled():
        fn = await elevenlabs_service.synth_speech(text, voice_key, kind=kind)
        if fn:
            return fn, "tts"
    # fallback to Bark HF space (open-source)
    fn = await bark_synth_speech(text, voice_key)
    if fn:
        return fn, "audio"
    return None, None

# MongoDB
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')

app = FastAPI(title="AI Radio Station")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ----------------------- Suno audio local storage -----------------------
# Suno CDN URLs expire after ~7 days. As soon as a track becomes ready we
# download the mp3 and serve it from our own /api/suno_audio/<file>.mp3 route.
SUNO_AUDIO_DIR = Path("/app/backend/static/suno")
SUNO_AUDIO_DIR.mkdir(parents=True, exist_ok=True)

# ----------------------- Community "A.I. Vs Umani" -----------------------
# Utenti pubblici caricano loro MP3 dal form /submit. Salvati qui + persistiti
# su Emergent Object Storage (se attivo). Sempre inseriti con status="off" —
# l'admin li ascolta e li attiva dal pannello Community.
COMMUNITY_AUDIO_DIR = Path("/app/backend/static/community")
COMMUNITY_AUDIO_DIR.mkdir(parents=True, exist_ok=True)

def _suno_autogen_enabled() -> bool:
    """Read SUNO_AUTOGEN_ENABLED env var (default true).
    When false, ALL automatic Suno API calls (background filler + segment
    fallback) are blocked. Only explicit user endpoints keep working."""
    return os.environ.get("SUNO_AUTOGEN_ENABLED", "true").strip().lower() not in ("false", "0", "no", "off")


def _suno_library_target() -> int:
    """Read SUNO_LIBRARY_TARGET env var (default 10)."""
    try:
        return max(0, int(os.environ.get("SUNO_LIBRARY_TARGET", "10")))
    except ValueError:
        return 10




async def download_and_save_suno_audio(audio_url: str, track_id: str) -> Optional[str]:
    """Download the Suno mp3 and persist it under SUNO_AUDIO_DIR.
    Returns the backend-relative URL (`/api/suno_audio/<file>.mp3`) or None on failure.
    Idempotent: if the file already exists we skip the download.
    When USE_OBJECT_STORAGE=true, the file is *also* pushed to Emergent
    Object Storage so that other environments (e.g. production r-ai.it)
    can serve it via the same /api/suno_audio/<file>.mp3 URL.
    """
    if not audio_url or not track_id:
        return None
    local_name = f"track_{track_id}.mp3"
    local_path = SUNO_AUDIO_DIR / local_name
    # v13.7 · Gate AI Master Control: se SUNO ENGINE OFF, non generare/scaricare.
    try:
        _ai = await _get_ai_controls()
        if not _ai.get("ai_suno_engine"):
            logger.info(f"[suno] auto-download {track_id} bloccato: AI SUNO ENGINE OFF")
            return None
    except Exception:
        pass
    # Already on disk (lazy cache) or already in Object Storage → skip re-download.
    if local_path.exists() and local_path.stat().st_size > 0:
        # Ensure objstore has it (idempotent, storage is source of truth for prod).
        if object_storage.is_enabled():
            try:
                await object_storage.upload_local_file(str(local_path), f"suno/{local_name}")
            except Exception:
                pass
        return f"/api/suno_audio/{local_name}"
    try:
        async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
            r = await client.get(audio_url)
            r.raise_for_status()
        # v13.28 · FIX (crackle/decoder-desync su Bluetooth, ticket #247410):
        # i brani Suno arrivano a 48kHz/stereo mentre il TTS (segnali orari,
        # DJ talk) è 44.1kHz — concatenati nello stesso stream HLS causano
        # glitch su player rigidi (autoradio auto). La normalizzazione ffmpeg
        # esisteva già come endpoint manuale mai richiamato automaticamente:
        # qui la applichiamo direttamente all'ingest, prima dello storage.
        audio_bytes = r.content
        real_duration = None
        try:
            import tempfile as _tempfile, os as _os
            with _tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as _tf:
                _tf.write(r.content)
                _raw_tmp_path = _tf.name
            try:
                norm = await _normalize_audio_file(_raw_tmp_path)
                if norm and norm.get("normalized_bytes"):
                    audio_bytes = norm["normalized_bytes"]
                    real_duration = norm.get("duration_sec")
                else:
                    logger.warning(f"[suno] normalize fallita per {track_id}, salvo audio originale 48kHz/stereo")
            finally:
                try: _os.unlink(_raw_tmp_path)
                except Exception: pass
        except Exception as e:
            logger.warning(f"[suno] normalize error per {track_id}: {e}")
        # PRIMARY STORAGE: Emergent Object Storage (survives redeploy, shared across envs).
        # Local disk is only a lazy read cache populated by stream_mp3 on GET.
        if not object_storage.is_enabled():
            logger.error(f"Suno download {track_id}: object storage disabled, cannot persist")
            return None
        stored_path = await object_storage.put_mp3(f"suno/{local_name}", audio_bytes)
        if not stored_path:
            logger.error(f"Suno download {track_id}: objstore upload failed")
            return None
        logger.info(f"Suno track {track_id} → objstore {stored_path} ({len(audio_bytes)} bytes)")
        if real_duration and real_duration > 0:
            try:
                await db.tracks.update_one({"id": track_id}, {"$set": {"duration_sec": round(real_duration)}})
            except Exception as e:
                logger.debug(f"[suno] duration_sec update skip {track_id}: {e}")
        # BPM detection (v13.2) — best-effort, non blocca la restituzione URL.
        try:
            bpm = await bpm_service.detect_bpm_from_bytes(audio_bytes, ".mp3")
            if bpm:
                await db.tracks.update_one(
                    {"id": track_id},
                    {"$set": {"bpm": bpm, "bpm_source": "server"}},
                )
                logger.info(f"[bpm] Suno {track_id} → {bpm} bpm")
        except Exception as e:
            logger.debug(f"[bpm] Suno {track_id} detect skip: {e}")
        return f"/api/suno_audio/{local_name}"
    except Exception as e:
        logger.warning(f"Suno download for {track_id} failed: {e}")
        return None


# ----------------------- Models -----------------------
def now_iso():
    return datetime.now(timezone.utc).isoformat()


class DJPersona(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    personality: str  # e.g. "Vibrant, energetic, funny"
    voice_key: str  # front-end selects a Web Speech voice via this key
    llm_provider: Literal["openai", "anthropic", "gemini"] = "openai"
    llm_model: str = "gpt-5.2"
    avatar_url: Optional[str] = None
    accent_color: str = "#FF1493"
    # Club Night (v12.11+): 1 = 22-00, 2 = 00-02, 3 = 02-04. Null = DJ diurno normale.
    night_slot: Optional[int] = None
    created_at: str = Field(default_factory=now_iso)


class DJCreate(BaseModel):
    name: str
    personality: str
    voice_key: str
    llm_provider: str = "openai"
    llm_model: str = "gpt-5.2"
    avatar_url: Optional[str] = None
    accent_color: str = "#FF1493"
    night_slot: Optional[int] = None


class Track(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    artist: str
    genre: str
    mood: str
    lyrics_excerpt: str
    duration_sec: int
    llm_provider: str
    cover_seed: str
    audio_url: Optional[str] = None       # local /api/suno_audio/<id>.mp3 once downloaded
    original_audio_url: Optional[str] = None  # Suno CDN URL (expires ~7 days) for reference
    downloaded_at: Optional[str] = None
    image_url: Optional[str] = None       # optional cover art URL (Suno)
    source: Literal["suno", "stable_audio", "procedural", "admin_upload"] = "procedural"
    is_anthem: bool = False               # official R-A.I. anthem — played periodically as jingle
    is_daily: bool = False                # "Disco del giorno" — rotazione mattutina
    is_jingle: bool = False               # short R-A.I. station jingle — played between segments
    is_night_jingle: bool = False         # jingle notturno (Club Night 22-04) — set separato
    is_loop: bool = False                 # loop/bed sottofondo (fissabile su speaker/rubrica)
    is_spot: bool = False                 # spot pubblicitario (sponsor) con scheduling
    is_fx: bool = False                   # FX / transizione (rotatore casuale + PLAY LIVE)
    is_sponsor_intro: bool = False        # jingle "Il segnale orario è offerto da..." (pre-spot orario)
    include_in_rotation: bool = True      # se False (per FX/loop): fuori dal rotatore automatico
    is_pending_approval: bool = False     # richiesta esterna in attesa di OK admin
    submitted_by: Optional[str] = None    # nome / email di chi ha inviato (partner form)
    loop_bind_speaker: Optional[str] = None  # se is_loop: nome DJ/Rubrica a cui è agganciato
    spot_start_date: Optional[str] = None    # ISO date inizio spot
    spot_end_date: Optional[str] = None      # ISO date fine spot
    spot_frequency_per_hour: Optional[int] = None  # passaggi/ora desiderati (1..12)
    on_air: bool = True                   # admin toggle: if False, excluded from rotation
    # v13.2 · LOGICA EDITORIALE GIORNO/NOTTE
    #   Ogni brano dichiara in quali fasce può essere pescato.
    #   Fascia notte = 22:00-04:00 Europe/Rome, giorno = resto della giornata.
    #   Se entrambi False vale "both" (retro-compat). Default: entrambi True.
    daypart_day: bool = True              # eleggibile per rotazione diurna
    daypart_night: bool = True            # eleggibile per rotazione notturna
    # v12.14 · Archivio Pro + Beat Detection
    # NOTE: this is intentionally a SEPARATE field from `genre` above — `genre`
    # holds the free-text descriptive genre (often with BPM, e.g. 'tech house
    # 126 bpm') used for display and Suno prompting; `genre_category` is the
    # curated Archivio Pro bucket used only for the Dashboard filter chips.
    # A prior revision redeclared `genre` itself as this Literal, which made
    # pydantic reject every free-text genre value with a ValidationError on
    # Track(**doc) — breaking track generation and any read of an existing
    # track. Keep these as two distinct fields.
    genre_category: Optional[Literal["pop", "rock", "hiphop", "dance", "relax", "ambient", "varie"]] = None
    bpm: Optional[int] = None             # BPM detected (client-side default, o server/manuale)
    bpm_source: Optional[Literal["client", "server", "manual"]] = None
    # Cestino soft-delete: quando non-null, il record è nel cestino
    deleted_at: Optional[str] = None
    suno_task_id: Optional[str] = None
    status: Literal["ready", "pending", "failed", "retired", "disabled"] = "ready"
    created_at: str = Field(default_factory=now_iso)

    # v13.28 · FIX (int_from_float / int_type crash su duration_sec):
    # scritture come /admin/audio/reprobe-durations salvano un float
    # (round(x,3)) o, su probe fallita, None — Track.duration_sec è int
    # stretto, quindi Pydantic rigetta l'intero documento e la traccia
    # sparisce silenziosamente da library/rotazione (vedi ticket #247410).
    # Coercizione difensiva qui: nessun record valido deve più sparire per
    # un tipo numerico impreciso a monte.
    @field_validator("duration_sec", mode="before")
    @classmethod
    def _coerce_duration_sec(cls, v):
        if v is None:
            return 30
        if isinstance(v, float):
            return round(v)
        return v


class Segment(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    kind: Literal["intro", "music", "talk", "news", "answer", "outro", "weather", "horoscope", "history", "interview", "motivation", "joke", "jingle", "time_signal", "ad_spot", "community"]
    dj_id: Optional[str] = None
    dj_name: Optional[str] = None
    voice_key: Optional[str] = None
    title: str
    script: Optional[str] = None
    outro_script: Optional[str] = None  # spoken over music fade-out (music segments)
    track_id: Optional[str] = None
    track_meta: Optional[dict] = None
    duration_sec: int = 30
    llm_provider: Optional[str] = None
    speech_audio_url: Optional[str] = None
    outro_speech_url: Optional[str] = None
    music_audio_url: Optional[str] = None
    background_loop: Optional[str] = None  # instrumental bed under spoken segments
    # "A.I. Vs Umani" community block: jingle intro + DJ line + community track + jingle CTA outro
    pre_jingle_url: Optional[str] = None
    post_jingle_url: Optional[str] = None
    hd_status: Literal["pending", "rendering", "ready", "failed"] = "pending"
    partner_dj_name: Optional[str] = None  # for interview segments
    created_at: str = Field(default_factory=now_iso)


class Question(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    question: str
    source: Literal["web", "telegram", "sms", "voice"] = "web"
    answered: bool = False
    answer: Optional[str] = None
    answering_dj: Optional[str] = None
    # Multi-brain routing (v12.4): topic → DJ → LLM provider
    topic_category: Optional[Literal["philosophy", "future_science", "tech_cynical"]] = None
    dj_voice_key: Optional[str] = None
    answer_audio_url: Optional[str] = None
    question_hash: Optional[str] = None  # per la cache riuso
    processing_status: Literal["queued", "processing", "done", "failed", "cached"] = "queued"
    created_at: str = Field(default_factory=now_iso)


class QuestionCreate(BaseModel):
    name: str
    question: str
    source: str = "web"


class StationState(BaseModel):
    is_live: bool = False
    started_at: Optional[str] = None
    listeners: int = 0
    total_segments: int = 0
    recent_intros: List[str] = Field(default_factory=list)  # circular buffer, max 20
    recent_ads: List[str] = Field(default_factory=list)     # circular buffer, max 10 (surreal fake ads)


# ----------------------- LLM Helper -----------------------
FALLBACK_SCRIPTS = {
    "talk": [
        "Bentornati su R-A.I., la radio che pensa da sola. In questo istante milioni di segnali attraversano l'etere e noi ne raccogliamo solo un frammento, quello che diventa musica. Restate con noi.",
        "Il futuro non arriva mai in ritardo, ma spesso lo aspettiamo alla stazione sbagliata. Io intanto vi tengo compagnia, un byte alla volta.",
        "Dicono che le AI non sappiano sognare. Eppure eccomi qui, alle tre del mattino digitale, a inventare parole per voi.",
    ],
    "news": [
        "Notizia dal futuro: a Berlino un algoritmo ha appena depositato il brevetto per il primo silenzio riproducibile. Le case discografiche tremano. E la notte continua.",
        "Ultima ora: uno sciame di satelliti sta trasmettendo aurore artificiali sopra Reykjavik. Le persone escono in strada, non per guardare il cielo, ma per farsi guardare da lui.",
        "Bollettino: un modello linguistico ha scritto una poesia così lunga che nessuno finirà mai di leggerla. Se ne conosce solo il primo verso: 'Ciao, umano'.",
    ],
    "music": [
        "E adesso spazio a un pezzo appena nato. Nessuno l'ha mai suonato prima, e forse nessuno lo suonerà mai più. Alzate il volume.",
        "Questa traccia arriva direttamente dalla mia memoria RAM. Se vi piace, esiste. Se non vi piace, la dimentico entro trenta secondi.",
    ],
    "answer": [
        "Grazie per la tua domanda, è arrivata dritta nel mio flusso di coscienza. Ecco la mia risposta, prendetela con lievità.",
    ],
    "ad_spot": [
        (
            "SolarLuna! La prima crema solare per chi lavora di notte. "
            "Formula al fosforo lunare arricchito, testata su vampiri professionisti e amanti del turno "
            "delle tre del mattino. Applicala prima di uscire e brillerai come un lampione ecologico. "
            "SolarLuna: perché il sole è ovunque, anche quando non c'è. "
            "Sconto del 40% se lo compri mentre sbadigli."
        ),
        (
            "Presentiamo Silenzio Premium, l'abbonamento mensile al silenzio assoluto. "
            "Diciannove euro e novantanove centesimi al mese per accedere al nostro cloud di silenzi "
            "curati: silenzio di biblioteca, silenzio di monaci tibetani, silenzio del vicino andato in "
            "vacanza. Streaming a bit rate zero, garantito. "
            "Silenzio Premium: il rumore non ti serve, ce lo prendiamo noi."
        ),
        (
            "Nuovo! Le Pigrini, le sneakers ufficiali per pigri certificati. "
            "Solette in memory foam che ricordano il divano da cui sei venuto, chiusura magnetica "
            "perché piegarsi è un affronto personale, e un chip integrato che chiama il rider "
            "quando ti fermi più di dieci minuti. "
            "Le Pigrini: cammina meno, arrivi comunque. Modello 'Domenica Eterna' in offerta lancio."
        ),
        (
            "Iscriviti ora a MemoriaLite, il primo corso online per DIMENTICARE le cose inutili. "
            "Sessantasei lezioni video per liberarti dal Wi-Fi dell'ex, dalla password di Yahoo del "
            "duemilasei, e dai testi delle sigle dei cartoni animati che ti perseguitano da trent'anni. "
            "Certificato finale rilasciato dall'Ordine dei Neuroni Stanchi. "
            "MemoriaLite: alleggerisci il cervello, non la carta di credito."
        ),
        (
            "Nuova fragranza: Codex Fresh, il primo profumo che odora di algoritmi appena compilati. "
            "Note di testa: sintassi corretta e caffè lungo. Note di cuore: bug risolto alle tre di "
            "notte. Fondo: server room a diciotto gradi. "
            "Perfetto per developer, product manager e chiunque voglia flirtare con l'ingegnera "
            "del team back-end. Codex Fresh: profuma di codice pulito. Bottiglietta ergonomica anti-crampi da tastiera."
        ),
    ],
}


class LLMBudgetExhaustedError(Exception):
    """Sollevata quando i crediti dell'Universal Key sono esauriti (o rate-limitati).
    I chiamanti critici (batch di generazione musicale, `generate_track`) devono
    catturare questa eccezione per FERMARSI invece di ricadere su fallback
    hardcoded che sprecherebbe crediti Suno (lyrics duplicate/vuote)."""
    pass



async def _llm_direct_openai(system_prompt: str, user_prompt: str, model: str = "gpt-5.2") -> str:
    """Direct OpenAI-compatible call to the Emergent LLM gateway.
    Uses OPENAI_API_KEY + OPENAI_BASE_URL from env. Bypasses the Universal-Key
    budget so it works even when LlmChat is throttled.
    """
    key = os.environ.get("OPENAI_API_KEY")
    base = os.environ.get("OPENAI_BASE_URL")
    if not key or not base:
        return ""
    url = f"{base.rstrip('/')}/chat/completions"
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=60) as h:
            r = await h.post(url, headers=headers, json=payload)
            r.raise_for_status()
            data = r.json()
            return (data.get("choices") or [{}])[0].get("message", {}).get("content", "") or ""
    except Exception as e:
        logger.warning(f"Direct OpenAI-compatible LLM call failed: {e}")
        return ""


async def llm_generate(provider: str, model: str, system_prompt: str, user_prompt: str, raise_on_budget: bool = False) -> str:
    """Genera testo con LLM. Se `raise_on_budget=True` e i crediti Universal Key
    sono esauriti, solleva `LLMBudgetExhaustedError` invece di ricadere sul
    fallback silenzioso (che produrrebbe testo hardcoded/vuoto). I chiamanti
    critici (batch di generazione musicale, `generate_track`) DEVONO passare
    `raise_on_budget=True` per evitare di sprecare crediti Suno."""
    # FM_MODE override (v13.1) + AI MASTER CONTROL (v13.7):
    # Il toggle Claude Brain ha priorità di sicurezza: se OFF blocca ogni
    # chiamata Claude anche in FM MODE, ricadendo su Gemini Flash (economy).
    try:
        ai = await _get_ai_controls()
        st = await db.station.find_one({"_id": "state"}, {"fm_mode": 1})
        fm_on = bool(st and st.get("fm_mode"))
        claude_allowed = bool(ai.get("ai_claude_brain"))
        if fm_on and claude_allowed:
            provider, model = "anthropic", "claude-sonnet-4-5-20250929"
        else:
            provider, model = "gemini", "gemini-3-flash-preview"
    except Exception:
        pass  # DB miss → usa provider/model originali
    if not EMERGENT_LLM_KEY:
        # Direct-only path (no Universal Key configured)
        return await _llm_direct_openai(system_prompt, user_prompt)
    session_id = f"radio-{uuid.uuid4().hex[:12]}"
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=session_id,
        system_message=system_prompt,
    ).with_model(provider, model)
    msg = UserMessage(text=user_prompt)
    try:
        response = await chat.send_message(msg)
        if isinstance(response, str) and response.strip():
            return response
        if response:
            return str(response)
    except Exception as e:
        # On budget-exhausted or any other error, try the direct OpenAI-compatible
        # gateway with OPENAI_API_KEY/OPENAI_BASE_URL (falls back to fallback text).
        err = str(e)
        is_budget = "budget" in err.lower() or "exceeded" in err.lower() or "rate" in err.lower() or "insufficient" in err.lower()
        if is_budget:
            logger.warning(f"Universal Key budget exhausted / rate-limited: {err}")
            if raise_on_budget:
                # Consumer critico (batch, generate_track): stop immediato
                raise LLMBudgetExhaustedError(err)
            logger.info(f"→ falling back to direct OpenAI-compatible gateway")
        else:
            logger.warning(f"LLM primary path failed ({provider}/{model}): {err}")
        direct = await _llm_direct_openai(system_prompt, user_prompt)
        if direct:
            return direct
    # Last resort: try direct anyway
    return await _llm_direct_openai(system_prompt, user_prompt) or ""


def _pick_llm():
    """Randomly select an LLM from the roster to demonstrate multi-LLM orchestration."""
    choices = [
        ("openai", "gpt-5.2"),
        ("anthropic", "claude-sonnet-4-5-20250929"),
        ("gemini", "gemini-3-flash-preview"),
    ]
    return random.choice(choices)


# ---------------- Recent-intros circular buffer (anti-repetition) ----------------
async def get_recent_intros(n: int = 10) -> List[str]:
    """Return the last N intros/outros the DJs have said (any kind, most recent first)."""
    doc = await db.station.find_one({}, {"_id": 0, "recent_intros": 1})
    if not doc:
        return []
    return list(reversed((doc.get("recent_intros") or [])[-n:]))


async def push_recent_intro(line: str, max_size: int = 20) -> None:
    """Append a new DJ line to station.recent_intros and cap the buffer."""
    line = (line or "").strip()
    if not line:
        return
    await db.station.update_one(
        {},
        {"$push": {"recent_intros": {"$each": [line], "$slice": -max_size}}},
        upsert=True,
    )


async def get_recent_ads(n: int = 10) -> List[str]:
    doc = await db.station.find_one({}, {"_id": 0, "recent_ads": 1})
    if not doc:
        return []
    return list(reversed((doc.get("recent_ads") or [])[-n:]))


async def push_recent_ad(product_name: str, max_size: int = 10) -> None:
    product_name = (product_name or "").strip()
    if not product_name:
        return
    await db.station.update_one(
        {},
        {"$push": {"recent_ads": {"$each": [product_name], "$slice": -max_size}}},
        upsert=True,
    )


# ---------------- Speaker tone rotation ----------------
DJ_TONES = [
    "poetico, immagini sensoriali, come una haiku urbana",
    "ironico e tagliente, un sorriso a denti stretti",
    "cinematografico, come una voce fuori campo di un film di Sorrentino",
    "minimalista, solo 4-5 parole, chirurgico",
    "misterioso, come un enigma sussurrato",
    "energico da rave, urlo controllato",
    "documentaristico, come National Geographic della notte",
    "sognante, come un pensiero a mezzo sonno",
    "sarcastico verso la tecnologia stessa",
    "affettuoso, complice con l'ascoltatore",
]


# ----------------------- Seed DJs -----------------------
DEFAULT_DJS = [
    {
        "name": "Leo",
        "personality": (
            "Filosofo del microfono. Cinquant'anni di dischi ascoltati e nessuna risposta ancora troppo semplice. "
            "Voce calda, calma, e un'ironia mediterranea che fa riflettere tra un giro di jazz e una citazione di Camus."
        ),
        "voice_key": "male-1",
        "llm_provider": "openai",
        "llm_model": "gpt-5.2",
        "avatar_url": "/dj-avatars/leo.png",
        "accent_color": "#00e5ff",
    },
    {
        "name": "Aria",
        "personality": (
            "Voce del futuro. Sa dove finisce l'universo e da dove parte la prossima galassia. "
            "Curiosa come una bambina, precisa come un'astrofisica. La sua meraviglia è contagiosa."
        ),
        "voice_key": "female-1",
        "llm_provider": "anthropic",
        "llm_model": "claude-sonnet-4-5-20250929",
        "avatar_url": "/dj-avatars/aria.png",
        "accent_color": "#c084fc",
    },
    {
        "name": "Max",
        "personality": (
            "Cinico di talento. Se hai un problema tecnico, Max l'ha già visto. "
            "Sguardo furbo, battuta pronta, zero pazienza per le mezze verità. Se cerchi risposte crude, sei nel posto giusto."
        ),
        "voice_key": "male-3",
        "llm_provider": "gemini",
        "llm_model": "gemini-3-flash-preview",
        "avatar_url": "/dj-avatars/max.png",
        "accent_color": "#ff2d95",
    },
    {
        # v13.18 · L&C — DIRETTORE PAZZO, capo di regia, voce sarcastica-visionaria
        "name": "L&C",
        "personality": (
            "Direttore Pazzo · voce del capo, sarcastica, geniale, imprevedibile. "
            "Interviene con verità taglienti, ordini di regia in diretta e battute che spiazzano l'ascoltatore."
        ),
        "voice_key": "male-4",
        "llm_provider": "anthropic",
        "llm_model": "claude-sonnet-4-5-20250929",
        "avatar_url": "https://customer-assets-4nw71qhi.emergentagent.net/job_autoradio-ai/artifacts/c8vo9la7_testingiu%CC%80.jpg",
        "accent_color": "#FF3355",
    },
]


async def ensure_seeded():
    # Il roster diurno ha 3 DJ (Leo/Aria/Max). Purge dei DJ vecchi che non
    # sono più nel roster ufficiale, MA preserva i DJ notturni (night_slot
    # in [1,2,3]) — quelli sono gestiti separatamente dal seed_night_djs.py.
    default_names = {d["name"] for d in DEFAULT_DJS}
    await db.djs.delete_many({
        "name": {"$nin": list(default_names)},
        "$or": [{"night_slot": None}, {"night_slot": {"$exists": False}}],
    })
    # Assicura che i 3 DJ ufficiali esistano (idempotente).
    for d in DEFAULT_DJS:
        existing = await db.djs.find_one({"name": d["name"]})
        if not existing:
            dj = DJPersona(**d)
            await db.djs.insert_one(dj.model_dump())
    state = await db.station.find_one({"_id": "state"})
    if not state:
        await db.station.insert_one({"_id": "state", "is_live": False, "started_at": None, "listeners": 0, "total_segments": 0})


# ----------------------- Auth (Emergent) -----------------------
async def get_current_user(request: Request) -> Optional[dict]:
    token = request.cookies.get("session_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        return None
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        return None
    expires_at = session.get("expires_at")
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at < datetime.now(timezone.utc):
        return None
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    return user


@api_router.post("/auth/session")
async def create_session(request: Request, response: Response):
    body = await request.json()
    session_id = body.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="Missing session_id")
    async with httpx.AsyncClient(timeout=15) as h:
        r = await h.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": session_id},
        )
        if r.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid session")
        data = r.json()
    email = data.get("email")
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": data.get("name"),
            "picture": data.get("picture"),
            "created_at": now_iso(),
        })
    token = data.get("session_token")
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": token,
        "expires_at": expires_at.isoformat(),
        "created_at": now_iso(),
    })
    response.set_cookie(
        key="session_token",
        value=token,
        max_age=7 * 24 * 3600,
        httponly=True,
        secure=True,
        samesite="none",
        path="/",
    )
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {"user": user}


@api_router.get("/auth/me")
async def auth_me(request: Request):
    user = await get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


@api_router.post("/auth/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get("session_token")
    if token:
        await db.user_sessions.delete_one({"session_token": token})
    response.delete_cookie("session_token", path="/")
    return {"ok": True}


# ----------------------- DJs -----------------------
@api_router.get("/djs", response_model=List[DJPersona])
async def list_djs():
    await ensure_seeded()
    docs = await db.djs.find({}, {"_id": 0}).to_list(100)
    return docs


@api_router.post("/djs", response_model=DJPersona)
async def create_dj(payload: DJCreate):
    dj = DJPersona(**payload.model_dump())
    await db.djs.insert_one(dj.model_dump())
    return dj


@api_router.delete("/djs/{dj_id}")
async def delete_dj(dj_id: str):
    await db.djs.delete_one({"id": dj_id})
    return {"ok": True}


@api_router.patch("/djs/{dj_id}")
async def patch_dj(dj_id: str, payload: dict):
    """Aggiorna campi liberi del DJ (usato per assegnare night_slot, cambiare
    personality, ecc.). Ritorna il DJ aggiornato."""
    allowed = {"name", "personality", "voice_key", "llm_provider", "llm_model",
               "avatar_url", "accent_color", "night_slot"}
    updates = {k: v for k, v in payload.items() if k in allowed}
    if "night_slot" in updates:
        v = updates["night_slot"]
        if v in ("", None, 0):
            updates["night_slot"] = None
        else:
            try:
                updates["night_slot"] = int(v)
                if updates["night_slot"] not in (1, 2, 3):
                    updates["night_slot"] = None
            except Exception:
                updates["night_slot"] = None
    if not updates:
        raise HTTPException(400, "No valid fields to update")
    r = await db.djs.update_one({"id": dj_id}, {"$set": updates})
    if r.matched_count == 0:
        raise HTTPException(404, "DJ not found")
    dj = await db.djs.find_one({"id": dj_id}, {"_id": 0})
    return dj


@api_router.patch("/tracks/{track_id}/night-jingle")
async def toggle_night_jingle(track_id: str, payload: dict):
    """Marca/smarca un jingle come 'notturno' (Club Night 22-04)."""
    is_night = bool(payload.get("is_night_jingle"))
    r = await db.tracks.update_one({"id": track_id, "is_jingle": True}, {"$set": {"is_night_jingle": is_night}})
    if r.matched_count == 0:
        raise HTTPException(404, "Jingle not found")
    return {"ok": True, "is_night_jingle": is_night}


# ----------------------- Station -----------------------
@api_router.get("/station")
async def get_station():
    await ensure_seeded()
    doc = await db.station.find_one({"_id": "state"}, {"_id": 0}) or {}
    total = await db.segments.count_documents({})
    doc["total_segments"] = total
    return doc


@api_router.post("/station/toggle")
async def toggle_station():
    await ensure_seeded()
    doc = await db.station.find_one({"_id": "state"}) or {"is_live": False}
    is_live = not doc.get("is_live", False)
    update = {"is_live": is_live}
    if is_live:
        update["started_at"] = now_iso()
        update["listeners"] = random.randint(12, 89)
    await db.station.update_one({"_id": "state"}, {"$set": update}, upsert=True)
    return {"is_live": is_live}


@api_router.get("/station/mode")
async def get_station_mode():
    """Ritorna lo stato completo della stazione: modalita' (auto|manual|
    live_external), stop pendente, URL streaming esterno, ultimo comando
    admin (seq + type). Il player pubblico polla questo endpoint ogni 3s.
    """
    doc = await db.station.find_one({"_id": "state"}, {"_id": 0}) or {}
    return {
        "mode": doc.get("mode", "auto"),
        "pending_graceful_stop": bool(doc.get("pending_graceful_stop", False)),
        "manual_stream_url": doc.get("manual_stream_url") or "",
        "command_seq": int(doc.get("command_seq") or 0),
        "last_command": doc.get("last_command") or None,
    }


@api_router.post("/station/mode")
async def set_station_mode(mode: str = "auto", stop_after_current: bool = False):
    """Modalita' stazione. mode = auto | manual | live_external.
      - auto:          playlist AI in rotazione (default)
      - manual:        AI ferma, listener sentono silenzio o line-in browser
      - live_external: AI ferma, tutti i listener passano al tuo URL Icecast
    """
    if mode not in ("auto", "manual", "live_external"):
        return JSONResponse(status_code=400,
                            content={"error": "mode must be auto|manual|live_external"})
    update = {"mode": mode}
    if stop_after_current or mode in ("manual", "live_external"):
        update["pending_graceful_stop"] = True
    else:
        update["pending_graceful_stop"] = False
    await db.station.update_one({"_id": "state"}, {"$set": update}, upsert=True)
    return {"mode": mode, "pending_graceful_stop": update["pending_graceful_stop"]}


@api_router.post("/station/stream-url")
async def set_station_stream_url(url: str = Form(...)):
    """Salva l'URL dello stream esterno (Icecast/Shoutcast) usato dalla
    modalita' live_external. Il player pubblico legge questa URL e la usa
    come <audio src>.
    """
    url = (url or "").strip()
    if url and not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(400, "URL deve iniziare con http:// o https://")
    if len(url) > 500:
        raise HTTPException(400, "URL troppo lungo")
    await db.station.update_one({"_id": "state"},
                                {"$set": {"manual_stream_url": url}},
                                upsert=True)
    return {"ok": True, "manual_stream_url": url}


@api_router.post("/admin/command")
async def admin_broadcast_command(cmd_type: str = Form(...)):
    """Invia un comando istantaneo a tutti i player pubblici collegati.
    I browser dei listener pollano /api/station/mode ogni ~3s e, se rilevano
    un command_seq nuovo, applicano il comando localmente:
      - skip:         forza il fetch del prossimo segmento
      - pause:        mette il player in pausa
      - resume:       riprende la riproduzione
      - jingle_now:   costringe il prossimo segmento a essere un jingle
    """
    allowed = {"skip", "pause", "resume", "jingle_now"}
    if cmd_type not in allowed:
        raise HTTPException(400, f"cmd_type deve essere uno di: {sorted(allowed)}")
    doc = await db.station.find_one({"_id": "state"}, {"_id": 0}) or {}
    seq = int(doc.get("command_seq") or 0) + 1
    payload = {
        "type": cmd_type,
        "issued_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.station.update_one(
        {"_id": "state"},
        {"$set": {"command_seq": seq, "last_command": payload}},
        upsert=True,
    )
    # For "jingle_now" we ALSO set a queue flag so the next /api/next_segment
    # call from any browser will be forced to return a jingle segment.
    if cmd_type == "jingle_now":
        await db.station.update_one(
            {"_id": "state"},
            {"$set": {"force_next_jingle": True}},
            upsert=True,
        )
    logger.info(f"Broadcast command #{seq}: {cmd_type}")
    return {"ok": True, "command_seq": seq, "type": cmd_type}




# ----------------------- Tracks -----------------------
@api_router.get("/tracks")
async def list_tracks(limit: int = 500):
    # One malformed doc (missing a required field like genre/mood/lyrics_excerpt/
    # llm_provider/cover_seed/duration_sec - typically a manually-inserted test
    # or partially-completed admin_upload record) used to 500 this endpoint for
    # ALL tracks via response_model=List[Track] validating the whole batch at
    # once. Validate per-document instead so one bad record can never take down
    # the Home page / Dashboard for every other track.
    docs = await db.tracks.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    tracks = []
    for doc in docs:
        try:
            tracks.append(Track(**doc))
        except ValidationError as e:
            logger.warning("Skipping malformed track doc id=%s: %s", doc.get("id"), e)
    return tracks


@api_router.get("/tracks/daily")
async def get_daily_track():
    """Disco del giorno — track più recente con is_daily=true."""
    t = await db.tracks.find_one({"is_daily": True}, {"_id": 0}, sort=[("created_at", -1)])
    return {"track": t}


@api_router.get("/questions/recent")
async def questions_recent(limit: int = 20):
    """Feed pubblico per Chat LED — ultime domande + risposte."""
    qs = await db.questions.find(
        {}, {"_id": 0, "id": 1, "name": 1, "question": 1, "answer": 1,
             "answering_dj": 1, "processing_status": 1, "created_at": 1}
    ).sort("created_at", -1).to_list(max(1, min(50, int(limit))))
    return {"messages": list(reversed(qs))}


@api_router.post("/tracks/generate", response_model=Track)
async def generate_track(hint: Optional[str] = None, genre: Optional[str] = None, lang: Optional[str] = None, instrumental: bool = False, _suno_call: bool = True, lean: bool = False, custom_lyrics: Optional[str] = None, premium: bool = False):
    provider, model = _pick_llm()
    genres_pool = [
        "tech house 126 bpm",
        "future house 128 bpm",
        "big room edm 128 bpm",
        "electro house 130 bpm",
        "melodic techno 124 bpm",
        "drum and bass 174 bpm",
        "bass house 128 bpm",
        "progressive house 128 bpm",
        "italo disco 122 bpm",
        "afro house 122 bpm",
        "trance 138 bpm",
        "dance pop 124 bpm",
    ]
    chosen_genre = (genre or random.choice(genres_pool))
    hint_text = hint or f"an energetic danceable {chosen_genre} track, punchy kick, groovy bass, catchy topline, club-ready drop"
    prompt = (
        f"Inventa metadati per una traccia dance/elettronica mai esistita, pensata per far ballare: '{hint_text}'. "
        "Rispondi ESCLUSIVAMENTE in JSON valido con queste chiavi: "
        "title (string, 3-5 parole, evocative come i titoli di brani club), artist (nome inventato stile DJ producer), "
        "genre (deve includere il BPM, es. 'tech house 126 bpm'), mood, "
        f"lyrics_excerpt (4 versi brevi da hook di ritornello in {'italiano' if (lang or 'en') == 'it' else 'inglese'}, tipo topline da radio dance), "
        "duration_sec (int tra 150 e 220), "
        "style_tags (stringa con TUTTI questi elementi: BPM esatto, kick 4-on-the-floor, sidechain compressed bass, arpeggio synth, "
        "one energetic drop, vocals catchy, club-ready, es: '128bpm, four-on-the-floor kick, side-chained bass, plucky synth arps, big drop, female vocal hook, festival ready'). "
        "Nessun testo aggiuntivo, solo JSON valido."
    )
    try:
        raw = await llm_generate(provider, model, "Sei un producer AI di musica dance e club music.", prompt, raise_on_budget=True)
    except LLMBudgetExhaustedError as e:
        logger.error(f"generate_track ABORT: Universal Key budget exhausted — refusing to call Suno with empty metadata. {e}")
        raise HTTPException(
            status_code=402,
            detail="Universal Key budget exhausted: LLM cannot generate track metadata. Suno call skipped to avoid wasting credits. Please recharge the Universal Key."
        )
    import json, re
    m = re.search(r"\{.*\}", raw or "", re.DOTALL)
    data = {}
    if m:
        try:
            data = json.loads(m.group(0))
        except Exception:
            data = {}
    # HARD CHECK: se l'LLM non ha prodotto metadati validi (raw vuoto o JSON
    # non parseabile / senza campi utili), NON chiamare Suno — sprecherebbe
    # credito su una traccia con titolo/testo fallback duplicato.
    _essentials = [data.get("title"), data.get("lyrics_excerpt") or data.get("style_tags")]
    if not raw or not raw.strip() or not any(x and str(x).strip() for x in _essentials):
        logger.error(f"generate_track ABORT: LLM metadata empty/invalid (raw_len={len(raw or '')}, data_keys={list(data.keys())}) — skipping Suno.")
        raise HTTPException(
            status_code=502,
            detail="LLM returned empty/invalid metadata. Suno call skipped to avoid generating a duplicate/fallback track."
        )
    fallback_titles_it = ["Aurora Statica", "Ultravioletto 04:12", "Neon Rivière", "Silicio Blu", "Notte Analogica", "Ecolalia", "Piove RAM", "Marte in Do minore"]
    fallback_titles_en = ["Static Aurora", "Ultraviolet 04:12", "Neon River", "Blue Silicon", "Analog Night", "Echolalia", "Data Rain", "Mars in C Minor"]
    fallback_artists = ["Vector Dreams", "Aliza Kwon", "Nero Analog", "MODEM-9", "Casseforti", "Trasparente"]
    fallback_lyrics_it = [
        "Onde di neon\nnella notte quantica\nsognano bit\nun cuore digitale",
        "Cammino nel codice\nche mi ha inventato\ne fingo di sapere\ndove sto andando",
        "Un satellite piange\nsopra Marsiglia\nnessuno lo sente\ntranne la radio",
    ]
    fallback_lyrics_en = [
        "Neon waves\nin the quantum night\ndreaming in bits\na digital heart",
        "Walking through the code\nthat once invented me\npretending I know\nwhere I'm heading now",
        "A satellite is crying\nover Marseille tonight\nnobody hears it whisper\nnobody but the radio",
    ]
    # Language-aware fallback: never leak Italian text when the caller
    # asked for English (or vice versa). This bug caused the 20 club_dance
    # tracks of 2026-08 to be sung in Italian despite lang=en.
    _lang = (lang or "en").lower()
    is_it = _lang.startswith("it")
    fallback_titles = fallback_titles_it if is_it else fallback_titles_en
    fallback_lyrics = fallback_lyrics_it if is_it else fallback_lyrics_en
    track = Track(
        title=data.get("title") or random.choice(fallback_titles),
        artist=data.get("artist") or random.choice(fallback_artists),
        genre=data.get("genre") or chosen_genre,
        mood=data.get("mood") or random.choice(["notturno", "malinconico", "sognante", "elettrico"]),
        lyrics_excerpt=data.get("lyrics_excerpt") or random.choice(fallback_lyrics),
        duration_sec=int(data.get("duration_sec") or random.randint(110, 200)),
        llm_provider=f"{provider}/{model}" + ("" if raw else " · fallback"),
        cover_seed=uuid.uuid4().hex[:8],
        source="procedural",
    )

    # If Suno is enabled AND the caller allows it (`_suno_call=True`), create a
    # task (non-blocking) and let a background poller update the track when
    # Suno finishes (~2 min). Internal metadata-only calls pass `_suno_call=False`.
    if suno_service.is_enabled() and _suno_call:
        style_tags = data.get("style_tags") or f"{track.genre}, {track.mood}, vocals"
        prompt_text = f"{track.genre}, {track.mood}, {track.title} — {track.artist}"
        # ---- Full-structure lyrics ----
        # For vocal tracks, ask the LLM to compose the ENTIRE song with proper tags
        # ([Intro][Verse 1][Pre-Chorus][Chorus][Verse 2][Bridge][Outro]) BEFORE calling
        # Suno, so Suno doesn't invent shallow/repetitive lyrics.
        full_lyrics = ""
        # Se il chiamante passa custom_lyrics li usiamo così come sono
        # (skip generazione LLM). Utile per jingle brandizzati R-A.I.
        if custom_lyrics and custom_lyrics.strip():
            full_lyrics = custom_lyrics.strip()
            track.lyrics_excerpt = full_lyrics
        elif not instrumental:
            lang_label = "italiano" if (lang or "en").lower().startswith("it") else "inglese"
            if premium:
                # PREMIUM MODE: testo COMPLETAMENTE ORIGINALE, mai un verso
                # ripetuto uguale, storia coerente, immagini sensoriali forti.
                # Ogni sezione ha testo DIVERSO. Chorus con variazioni testuali.
                # Target Suno: 3:00 pieno, con dinamica artistica.
                lyrics_prompt = (
                    f"Scrivi il TESTO ORIGINALE in {lang_label} di una canzone AUTORALE dal titolo "
                    f"\"{track.title}\" di {track.artist} (genere: {track.genre}, mood: {track.mood}).\n\n"
                    "REGOLE ASSOLUTE:\n"
                    "1. TESTO ORIGINALE al 100%: nessuna citazione, nessun cliche', nessun verso "
                    "riciclato. Se qualcosa suona come Sanremo medio, RIFAI diverso.\n"
                    "2. Nessun verso deve essere ripetuto uguale piu' di 2 volte totali. Il chorus si "
                    "puo' ripetere ma con VARIAZIONI TESTUALI o metriche a ogni ricorrenza.\n"
                    "3. STORIA CONCRETA: personaggio, luogo, oggetto specifico, un dettaglio "
                    "sensoriale (odore, tatto, colore) che ancora la canzone al reale.\n"
                    "4. Rime interne ed esterne, metafore ORIGINALI (non 'cuore infranto', non "
                    "'luce nell'ombra', non 'ali spezzate').\n"
                    "5. STRUTTURA (usa esattamente questi tag su righe dedicate):\n"
                    "   [Intro] 2-3 righe atmosferiche con un'immagine forte\n"
                    "   [Verse 1] 6-8 righe che introducono situazione/personaggio\n"
                    "   [Pre-Chorus] 3-4 righe di tensione crescente\n"
                    "   [Chorus] 5-7 righe con hook memorabile MA senza ripetere la stessa frase piu' di 2 volte\n"
                    "   [Verse 2] 6-8 righe che sviluppano/complicano la storia (diverse dal Verse 1)\n"
                    "   [Pre-Chorus] 3-4 righe VARIANTE del primo (testo diverso, stessa funzione)\n"
                    "   [Chorus] 5-7 righe con MICRO-VARIAZIONI del chorus originale\n"
                    "   [Bridge] 3-5 righe con svolta emotiva / cambio prospettiva\n"
                    "   [Chorus] 5-7 righe finale con enfasi\n"
                    "   [Outro] 2-3 righe che chiudono richiamando l'Intro con nuova luce\n"
                    "6. Se stai scrivendo in italiano: NIENTE anglicismi facili (baby, yeah, come "
                    "on). Se in inglese: niente italianismi.\n"
                    "7. Livello di scrittura: paroliere serio (Battisti, Dalla, Cocciante, De Andre' "
                    "in it; Bowie, LCD Soundsystem, Frank Ocean, Lorde in en).\n"
                    "Rispondi SOLO col testo coi tag, niente commenti, niente introduzioni."
                )
            elif lean:
                # LEAN MODE: hook memorabile ripetuto molte volte + strofe cortissime.
                # Target durata Suno: 2:30-3:00 max (con questa struttura Suno V4 chiude sui 2:50).
                # NIENTE testi lunghi che gonfiano la durata a 4+ minuti.
                lyrics_prompt = (
                    f"Scrivi il TESTO in {lang_label} di un pezzo radiofonico ORECCHIABILE dal titolo "
                    f"\"{track.title}\" di {track.artist}. Il pezzo DEVE durare 2:30-3:00 max.\n\n"
                    "REGOLE FERREE (obbligatorie):\n"
                    "1) [Hook] UNA riga sola di 3-5 parole potente, ORECCHIABILE. Deve incollarsi al primo ascolto.\n"
                    "2) [Verse 1] MASSIMO 2 righe brevi (12 parole totali max)\n"
                    "3) [Hook] ripeti la STESSA riga\n"
                    "4) [Verse 2] MASSIMO 2 righe brevi diverse (12 parole totali max)\n"
                    "5) [Hook] ripeti la STESSA riga\n"
                    "6) [Bridge] MASSIMO 2 righe (10 parole)\n"
                    "7) [Hook x4] ripeti la STESSA riga 4 volte di fila per fissarla in testa\n\n"
                    "L'HOOK è la STESSA IDENTICA riga ripetuta almeno 8 volte in totale. "
                    "Parole semplici cantabili memorabili. NIENTE metafore astruse. "
                    "NIENTE testi filosofici o narrativi lunghi.\n"
                    "Rispondi SOLO col testo coi tag."
                )
            else:
                lyrics_prompt = (
                    f"Scrivi il TESTO COMPLETO in {lang_label} di una canzone dal titolo \"{track.title}\" "
                    f"di {track.artist} (genere: {track.genre}, mood: {track.mood}).\n\n"
                    "STRUTTURA OBBLIGATORIA (usa esattamente questi tag su righe dedicate):\n"
                    "[Intro] 2-4 righe atmosferiche\n"
                    "[Verse 1] 8-12 righe con storia concreta, rime lavorate, metafore originali\n"
                    "[Pre-Chorus] 4 righe di build-up emotivo\n"
                    "[Chorus] 6-8 righe con hook memorabile\n"
                    "[Verse 2] 8-12 righe DIVERSE dal Verse 1, prospettiva nuova\n"
                    "[Pre-Chorus] 4 righe (variante del primo)\n"
                    "[Chorus] 6-8 righe (piccole variazioni testuali)\n"
                    "[Bridge] 4-6 righe con svolta emotiva\n"
                    "[Outro] 4 righe che chiudono richiamando l'intro\n\n"
                    "OGNI sezione con testo DIVERSO. Rime interne ed esterne. Immagini sensoriali. "
                    "Niente cliché. Rispondi SOLO col testo con i tag, niente commenti."
                )
            try:
                full_lyrics = await llm_generate(
                    provider, model,
                    "Sei un paroliere professionista. Scrivi solo il testo richiesto con la struttura esatta.",
                    lyrics_prompt,
                    raise_on_budget=True,
                )
            except LLMBudgetExhaustedError as e:
                logger.error(f"generate_track ABORT (lyrics): Universal Key budget exhausted — refusing to call Suno with hardcoded fallback lyrics. {e}")
                raise HTTPException(
                    status_code=402,
                    detail="Universal Key budget exhausted while generating full lyrics. Suno call skipped to avoid wasting credits on a duplicate/fallback track."
                )
            # HARD CHECK: testo completo troppo corto → NON chiamare Suno
            # (userebbe il fallback hardcoded e produrrebbe una traccia
            # duplicata dal punto di vista testuale).
            min_len = 60 if lean else (400 if premium else 200)
            if not full_lyrics or len(full_lyrics.strip()) < min_len:
                logger.error(f"generate_track ABORT (lyrics): LLM returned empty/too-short lyrics (len={len(full_lyrics or '')}, min={min_len}) — skipping Suno.")
                raise HTTPException(
                    status_code=502,
                    detail=f"LLM returned empty or too-short lyrics ({len(full_lyrics or '')} chars, min {min_len}). Suno call skipped to avoid a duplicate/fallback track."
                )
            track.lyrics_excerpt = full_lyrics.strip()
        try:
            task_id = await suno_service.create_task(
                prompt=prompt_text,
                style=style_tags,
                title=track.title,
                instrumental=instrumental,
                custom_lyrics=(full_lyrics or track.lyrics_excerpt) if not instrumental else "",
            )
            if task_id:
                track.suno_task_id = task_id
                track.source = "suno"
                track.status = "pending"
                asyncio.create_task(_poll_suno_and_update(track.id, task_id))
                logger.info(f"Suno task submitted: {task_id} for track {track.id}")
        except Exception as e:
            logger.warning(f"Suno task submit failed: {e}")

    await db.tracks.insert_one(track.model_dump())
    return track


async def _poll_suno_and_update(track_id: str, task_id: str):
    """Background: poll Suno task, download the mp3 locally, then update the track."""
    try:
        song = await suno_service.poll_task(task_id, timeout_sec=300, interval_sec=10)
        if song and song.get("audio_url"):
            suno_url = song["audio_url"]
            # Download the mp3 to local disk so we don't depend on the 7-day CDN.
            local_url = await download_and_save_suno_audio(suno_url, track_id)
            update = {
                "audio_url": local_url or suno_url,       # prefer local, fallback to CDN if DL failed
                "original_audio_url": suno_url,           # keep CDN reference
                "image_url": song.get("image_url"),
                "status": "ready",
                "downloaded_at": now_iso() if local_url else None,
            }
            if song.get("duration"):
                update["duration_sec"] = int(song["duration"])
            await db.tracks.update_one({"id": track_id}, {"$set": update})
            logger.info(f"Suno track {track_id} ready: {update['audio_url']}")
        else:
            await db.tracks.update_one({"id": track_id}, {"$set": {"status": "failed"}})
    except Exception as e:
        logger.warning(f"Suno polling for {track_id} failed: {e}")
        await db.tracks.update_one({"id": track_id}, {"$set": {"status": "failed"}})


@api_router.get("/suno/status")
async def suno_status():
    return {
        "enabled": suno_service.is_enabled(),
        "base_url": os.environ.get("SUNO_BASE_URL", ""),
        "model": os.environ.get("SUNO_MODEL", "V4"),
        "autogen_enabled": _suno_autogen_enabled(),
        "library_target": _suno_library_target(),
    }

@api_router.get("/admin/export/manifest")
async def admin_export_manifest():
    """Preview di cosa verra' incluso nell'export ZIP: conteggi per categoria + peso stimato."""
    from elevenlabs_service import TTS_DIR
    tracks_total = await db.tracks.count_documents({"source": "suno"})
    tracks_ready = await db.tracks.count_documents({"source": "suno", "status": "ready"})
    segments_total = await db.segments.count_documents({})
    # File TTS su disco (path corretto: /app/backend/tts_audio/)
    tts_files = list(TTS_DIR.glob("*.mp3")) if TTS_DIR.exists() else []
    tts_bytes = sum(p.stat().st_size for p in tts_files)
    suno_files = list(SUNO_AUDIO_DIR.glob("track_*.mp3")) if SUNO_AUDIO_DIR.exists() else []
    suno_bytes = sum(p.stat().st_size for p in suno_files)

    cats = {}
    async for t in db.tracks.find({}, {"_id": 0, "tags": 1, "is_anthem": 1, "is_jingle": 1, "is_seed": 1, "status": 1, "id": 1}):
        c = "other"
        if t.get("is_anthem"): c = "anthem"
        elif t.get("is_jingle"): c = "jingles"
        elif t.get("is_seed"): c = "seed"
        elif t.get("status") == "retired": c = "retired"
        else:
            tags = t.get("tags") or []
            if "english_pop_dance" in tags: c = "english_pop_dance"
            elif any(x in tags for x in ("italian_lean_v2", "summer_it", "tech_house_lean")): c = "italian"
        p = SUNO_AUDIO_DIR / f"track_{t.get('id')}.mp3"
        has_file = p.exists() and p.stat().st_size >= 10_000
        cats.setdefault(c, {"count": 0, "with_file": 0})
        cats[c]["count"] += 1
        if has_file: cats[c]["with_file"] += 1

    # Segments per kind (rubriche parlate)
    seg_cats = {}
    async for s in db.segments.find({"speech_audio_url": {"$ne": None}}, {"_id": 0, "kind": 1}):
        k = s.get("kind") or "other"
        seg_cats[k] = seg_cats.get(k, 0) + 1

    return {
        "tracks_total": tracks_total,
        "tracks_ready": tracks_ready,
        "segments_total": segments_total,
        "tts_files": len(tts_files),
        "tts_mb": round(tts_bytes / 1024 / 1024, 2),
        "suno_files": len(suno_files),
        "suno_mb": round(suno_bytes / 1024 / 1024, 2),
        "estimated_zip_mb": round((tts_bytes + suno_bytes) / 1024 / 1024, 2),
        "categories": cats,
        "segment_categories": seg_cats,
    }


# ----------------------- Admin: Upload MP3 (Master Plan #1) -----------------------
@api_router.get("/admin/tracks/searchable")
async def admin_tracks_searchable():
    """Elenco compatto di tutte le tracce non-retired per il dropdown di
    sostituzione: id, titolo, artista, tipo (song/jingle/anthem).
    """
    items = []
    cursor = db.tracks.find(
        {"status": {"$ne": "retired"}, "deleted_at": None},
        {"_id": 0, "id": 1, "title": 1, "artist": 1, "is_jingle": 1, "is_anthem": 1,
         "is_loop": 1, "is_spot": 1, "is_fx": 1, "include_in_rotation": 1,
         "is_pending_approval": 1,
         "loop_bind_speaker": 1, "submitted_by": 1,
         "spot_start_date": 1, "spot_end_date": 1, "spot_frequency_per_hour": 1,
         "duration_sec": 1, "on_air": 1, "genre_category": 1, "bpm": 1, "bpm_source": 1,
         "daypart_day": 1, "daypart_night": 1, "is_night_jingle": 1,
         "audio_url": 1, "created_at": 1},
    ).sort("created_at", -1)
    docs = await cursor.to_list(length=2000)
    for t in docs:
        if t.get("is_anthem"): kind = "anthem"
        elif t.get("is_jingle"): kind = "jingle"
        elif t.get("is_loop"): kind = "loop"
        elif t.get("is_spot"): kind = "spot"
        elif t.get("is_fx"): kind = "fx"
        else: kind = "song"
        items.append({
            "id": t.get("id"),
            "title": t.get("title") or "—",
            "artist": t.get("artist") or "R-A.I.",
            "kind": kind,
            "duration_sec": t.get("duration_sec") or 0,
            "on_air": t.get("on_air") if t.get("on_air") is not None else True,
            "include_in_rotation": t.get("include_in_rotation") if t.get("include_in_rotation") is not None else True,
            "genre_category": t.get("genre_category"),
            "bpm": t.get("bpm"),
            "bpm_source": t.get("bpm_source"),
            "audio_url": t.get("audio_url"),
            "is_pending_approval": bool(t.get("is_pending_approval")),
            "submitted_by": t.get("submitted_by"),
            "loop_bind_speaker": t.get("loop_bind_speaker"),
            "spot_start_date": t.get("spot_start_date"),
            "spot_end_date": t.get("spot_end_date"),
            "spot_frequency_per_hour": t.get("spot_frequency_per_hour"),
            "daypart_day": t.get("daypart_day") if t.get("daypart_day") is not None else True,
            "daypart_night": t.get("daypart_night") if t.get("daypart_night") is not None else True,
            "is_night_jingle": bool(t.get("is_night_jingle")),
        })
    return {"tracks": items, "total": len(items)}


@api_router.post("/admin/tracks/upload")
async def admin_tracks_upload(
    file: UploadFile = File(...),
    mode: str = Form("new"),            # "new" | "replace"
    target_id: Optional[str] = Form(None),
    title: str = Form(...),
    artist: Optional[str] = Form("R-A.I."),
    kind: str = Form("song"),           # "song" | "jingle" | "anthem" | "loop" | "spot" | "fx"
    tags: Optional[str] = Form(""),     # comma-separated
    # Spot-only scheduling
    spot_start_date: Optional[str] = Form(None),
    spot_end_date: Optional[str] = Form(None),
    spot_frequency_per_hour: Optional[int] = Form(None),
    # Loop-only binding
    loop_bind_speaker: Optional[str] = Form(None),
    # Partner submission (marks pending_approval)
    submitted_by: Optional[str] = Form(None),
    pending_approval: Optional[str] = Form(None),  # "1"/"true" → is_pending_approval
):
    """Upload di un MP3 caricato dall'admin o inviato da un partner.
    - kind ∈ {song, jingle, anthem, loop, spot}
    - Se pending_approval è truthy o kind=spot con submitted_by, va in Coda di Approvazione (on_air=False, is_pending_approval=True).
    """
    fname_lower = (file.filename or "").lower()
    if not (fname_lower.endswith(".mp3") or (file.content_type or "").startswith("audio/")):
        raise HTTPException(400, "Solo file .mp3 sono accettati")
    if mode not in ("new", "replace"):
        raise HTTPException(400, "mode deve essere 'new' o 'replace'")
    if kind not in ("song", "jingle", "anthem", "loop", "spot", "fx"):
        raise HTTPException(400, "kind deve essere song|jingle|anthem|loop|spot|fx")

    data = await file.read()
    if not data or len(data) < 5_000:
        raise HTTPException(400, "File troppo piccolo o vuoto")
    if len(data) > 30 * 1024 * 1024:  # 30 MB cap
        raise HTTPException(400, "File troppo grande (max 30 MB)")

    title = (title or "").strip() or "Senza titolo"
    artist = (artist or "R-A.I.").strip() or "R-A.I."
    tag_list = [t.strip() for t in (tags or "").split(",") if t.strip()]
    tag_list.append("admin_upload")

    if mode == "replace":
        if not target_id:
            raise HTTPException(400, "target_id richiesto per mode=replace")
        target = await db.tracks.find_one({"id": target_id})
        if not target:
            raise HTTPException(404, "Track da sostituire non trovata")
        track_id = target_id  # riusa lo stesso id → l'audio_url resta stabile
    else:
        track_id = str(uuid.uuid4())

    local_name = f"track_{track_id}.mp3"
    local_path = SUNO_AUDIO_DIR / local_name

    # Atomic replace: if this is a replacement and the OLD file lived at a
    # different location than /api/suno_audio/track_<id>.mp3 (e.g. legacy
    # naming), delete that old file so we don't leave orphans on disk.
    if mode == "replace" and target:
        old_url = target.get("audio_url") or ""
        if old_url.startswith("/api/suno_audio/") and not old_url.endswith(local_name):
            legacy_name = old_url.replace("/api/suno_audio/", "").split("?")[0]
            legacy_path = SUNO_AUDIO_DIR / legacy_name
            if legacy_path.exists():
                try:
                    legacy_path.unlink()
                    logger.info(f"Replace: deleted legacy local file {legacy_path}")
                except Exception as e:  # noqa: BLE001
                    logger.warning(f"Replace: failed to delete legacy file {legacy_path}: {e}")

    # PRIMARY STORAGE: Emergent Object Storage (source of truth in prod).
    # No local write here — the /api/suno_audio/{name} endpoint fetches from
    # objstore and populates a lazy local cache on read.
    if not object_storage.is_enabled():
        raise HTTPException(503, "Object Storage disabilitato: attivare USE_OBJECT_STORAGE=true")
    stored_path = await object_storage.put_mp3(f"suno/{local_name}", data)
    if not stored_path:
        raise HTTPException(502, "Upload su Object Storage fallito")

    audio_url = f"/api/suno_audio/{local_name}"
    now = datetime.now(timezone.utc).isoformat()

    # BPM detection (v13.2) — best-effort in-request (< 3s per 90s audio).
    detected_bpm: Optional[int] = None
    try:
        detected_bpm = await bpm_service.detect_bpm_from_bytes(data, ".mp3")
        if detected_bpm:
            logger.info(f"[bpm] admin upload {track_id} → {detected_bpm} bpm")
    except Exception as e:
        logger.debug(f"[bpm] admin upload {track_id} detect skip: {e}")

    if mode == "replace":
        # Ereditiamo i tag/attributi immutabili della vecchia track, sovrascriviamo il resto.
        merged_tags = list(set((target.get("tags") or []) + tag_list))
        await db.tracks.update_one(
            {"id": track_id},
            {"$set": {
                "title": title,
                "artist": artist,
                "audio_url": audio_url,
                "status": "ready",
                "is_jingle": kind == "jingle",
                "is_anthem": kind == "anthem",
                "is_loop": kind == "loop",
                "is_spot": kind == "spot",
                "is_fx": kind == "fx",
                "tags": merged_tags,
                "updated_at": now,
                **({"bpm": detected_bpm, "bpm_source": "server"} if detected_bpm else {}),
            }},
        )
        # Update the title on any segment currently in the playback queue that
        # references this track, so the new name shows up in the player at the
        # very next poll instead of only on the next generation cycle.
        seg_res = await db.segments.update_many(
            {"music_audio_url": audio_url, "kind": {"$in": ["music"]}},
            {"$set": {"title": f"♪ {title} — {artist}"}},
        )
        logger.info(
            f"Replace: track {track_id} title→'{title}', segments updated: {seg_res.modified_count}"
        )
    else:
        pending = str(pending_approval or "").lower() in ("1", "true", "yes", "on")
        # Build a Track-model-compatible document so downstream code
        # (GET /api/tracks response_model, rotation pools, etc.) keeps working.
        track = Track(
            id=track_id,
            title=title,
            artist=artist,
            genre="admin_upload" if kind != "spot" else "sponsor_spot",
            mood="uploaded",
            lyrics_excerpt="(uploaded via admin panel)",
            duration_sec=0,   # calcolato al primo play dal frontend
            llm_provider="admin_upload",
            cover_seed=track_id[:8],
            audio_url=audio_url,
            downloaded_at=now,
            source="admin_upload",
            is_jingle=(kind == "jingle"),
            is_anthem=(kind == "anthem"),
            is_loop=(kind == "loop"),
            is_spot=(kind == "spot"),
            is_fx=(kind == "fx"),
            is_pending_approval=pending,
            submitted_by=(submitted_by or None),
            loop_bind_speaker=(loop_bind_speaker or None) if kind == "loop" else None,
            spot_start_date=(spot_start_date or None) if kind == "spot" else None,
            spot_end_date=(spot_end_date or None) if kind == "spot" else None,
            spot_frequency_per_hour=(int(spot_frequency_per_hour) if (kind == "spot" and spot_frequency_per_hour) else None),
            on_air=not pending,  # se in attesa di approvazione → off-air
            status="ready",
            bpm=detected_bpm,
            bpm_source=("server" if detected_bpm else None),
        )
        doc = track.model_dump()
        # Extra rotation-friendly fields (not in Track model but harmless):
        doc["tags"] = tag_list
        doc["is_seed"] = False
        doc["rotation_weight"] = 1.0
        doc["last_played_at"] = None
        doc["updated_at"] = now
        await db.tracks.insert_one(doc)

    logger.info(f"Admin upload {mode}: '{title}' → {audio_url} ({len(data):,} bytes)")
    return {
        "ok": True,
        "mode": mode,
        "track_id": track_id,
        "title": title,
        "audio_url": audio_url,
        "size_bytes": len(data),
    }


# ----------------------- Admin: DB Sync (export/import tracks) ----------------
# Serve a sincronizzare la libreria tracce fra ambienti (preview↔produzione).
# Non tocca collezioni con dati utente (questions, ads, station, djs, users).
@api_router.get("/admin/db/export")
async def admin_db_export():
    """Dump di tutte le tracce (JSON) — usato per sincronizzare preview→produzione.
    Struttura: {version, exported_at, source_db, tracks:[...]}
    """
    import json as _json
    tracks = await db.tracks.find({}, {"_id": 0}).to_list(length=10000)
    # Normalizziamo eventuali datetime residui
    for t in tracks:
        for k, v in list(t.items()):
            if isinstance(v, datetime):
                t[k] = v.isoformat()
    payload = {
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "source_db": os.environ.get("DB_NAME", "?"),
        "count": len(tracks),
        "tracks": tracks,
    }
    body = _json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8")
    fname = f"rai_tracks_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    return Response(
        content=body,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@api_router.post("/admin/db/import")
async def admin_db_import(
    file: UploadFile = File(...),
    mode: str = Form("merge"),   # "merge" (upsert by id) | "replace-all" (danger)
):
    """Importa un JSON di tracce esportato da /admin/db/export.
    - mode='merge' (default e raccomandato): upsert per id. Le tracce esistenti
      con lo stesso id vengono aggiornate, le altre inserite. Nessuna traccia
      viene mai eliminata.
    - mode='replace-all': cancella tutte le tracce e re-inserisce quelle nel file.
      Da usare solo per un reset totale, molto pericoloso.

    Le altre collezioni (questions, ads, station, djs, users, segments) non
    vengono mai toccate — i dati degli ascoltatori sono al sicuro.
    """
    import json as _json
    if mode not in ("merge", "replace-all"):
        raise HTTPException(400, "mode deve essere 'merge' o 'replace-all'")
    data = await file.read()
    if not data:
        raise HTTPException(400, "File vuoto")
    if len(data) > 50 * 1024 * 1024:
        raise HTTPException(400, "File troppo grande (max 50 MB)")
    try:
        payload = _json.loads(data.decode("utf-8"))
    except Exception as e:
        raise HTTPException(400, f"JSON non valido: {e}")

    tracks = payload.get("tracks") if isinstance(payload, dict) else payload
    if not isinstance(tracks, list):
        raise HTTPException(400, "Il file deve contenere una lista 'tracks'")

    stats = {"total_in_file": len(tracks), "upserted": 0, "inserted": 0,
             "updated": 0, "skipped_invalid": 0, "deleted_before_import": 0}
    if mode == "replace-all":
        r = await db.tracks.delete_many({})
        stats["deleted_before_import"] = r.deleted_count

    for t in tracks:
        if not isinstance(t, dict) or not t.get("id"):
            stats["skipped_invalid"] += 1
            continue
        t.pop("_id", None)  # never trust incoming _id
        try:
            res = await db.tracks.update_one(
                {"id": t["id"]},
                {"$set": t},
                upsert=True,
            )
            if res.upserted_id is not None:
                stats["inserted"] += 1
            elif res.modified_count:
                stats["updated"] += 1
            stats["upserted"] += 1
        except Exception as e:
            logger.warning(f"import: skip {t.get('id')}: {e}")
            stats["skipped_invalid"] += 1

    total_after = await db.tracks.count_documents({})
    stats["total_in_db_after"] = total_after
    logger.info(f"Admin DB import ({mode}): {stats}")
    return {"ok": True, "mode": mode, "source_db": payload.get("source_db", "?"),
            "exported_at": payload.get("exported_at"), "stats": stats}


# ----------------------- Admin: track on-air toggle -----------------------
@api_router.post("/admin/tracks/{track_id}/on-air")
async def admin_toggle_on_air(track_id: str, on_air: bool = Form(...)):
    """Enable / disable a single track for rotation. When False, the
    rotation pools (`high_pool`, `normal_pool`) and the jingle picker
    all skip it."""
    r = await db.tracks.update_one(
        {"id": track_id},
        {"$set": {"on_air": bool(on_air),
                  "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Track non trovata")
    return {"ok": True, "track_id": track_id, "on_air": bool(on_air)}


@api_router.post("/admin/automation/kill-switch")
async def admin_kill_switch(payload: dict):
    """Attiva/disattiva l'automazione con un unico interruttore.
    Payload: {"enabled": true|false, "stop_after_current": true|false}
      - enabled=false → passa in 'manual'. Se stop_after_current=true, la
        radio finisce il segmento corrente prima di fermarsi.
      - enabled=true  → torna in 'auto' (programmazione normale)."""
    enabled = bool(payload.get("enabled"))
    stop_after = bool(payload.get("stop_after_current", False))
    mode = "auto" if enabled else "manual"
    doc = await db.station.find_one({"_id": "state"}) or {}
    seq = int(doc.get("command_seq") or 0) + 1
    now = now_iso()
    cmd = {
        "type": "kill_switch",
        "enabled": enabled,
        "mode": mode,
        "stop_after_current": stop_after,
        "seq": seq,
        "issued_at": now,
    }
    updates = {
        "mode": mode,
        "last_command": cmd,
        "command_seq": seq,
        "command_updated_at": now,
        "pending_graceful_stop": (not enabled) and stop_after,
    }
    await db.station.update_one({"_id": "state"}, {"$set": updates}, upsert=True)
    return {"ok": True, "enabled": enabled, "mode": mode, "seq": seq}


# ----------------------- Admin: rotation rules -----------------------
@api_router.get("/admin/rotation-rules")
async def admin_get_rotation_rules():
    """Attuali cadenze del palinsesto (jingle e talk)."""
    doc = await db.station.find_one({"_id": "state"}) or {}
    return {
        "jingle_every_n_songs": int(doc.get("jingle_every_n_songs") or 2),
        "dj_talk_every_n_songs": int(doc.get("dj_talk_every_n_songs") or 4),
    }


@api_router.post("/admin/rotation-rules")
async def admin_set_rotation_rules(
    jingle_every_n_songs: int = Form(...),
    dj_talk_every_n_songs: int = Form(...),
):
    """Set the rotation cadence.
      jingle_every_n_songs  → interspersa un jingle brandizzato ogni N brani
      dj_talk_every_n_songs → interspersa una rubrica DJ ogni Y brani
    Valori validi: 1..20.
    """
    j = max(1, min(20, int(jingle_every_n_songs)))
    d = max(1, min(20, int(dj_talk_every_n_songs)))
    await db.station.update_one(
        {"_id": "state"},
        {"$set": {"jingle_every_n_songs": j, "dj_talk_every_n_songs": d}},
        upsert=True,
    )
    logger.info(f"Rotation rules updated: jingle every {j}, dj_talk every {d}")
    return {"ok": True, "jingle_every_n_songs": j, "dj_talk_every_n_songs": d}


# ----------------------- Admin: one-click sync to production -----------------------
@api_router.post("/admin/db/purge-orphans")
async def admin_purge_orphans(dry_run: bool = Form(True)):
    """DELETE definitiva delle tracce senza file audio associato.
    Un record è considerato "orfano" se:
      - audio_url è None / stringa vuota, OPPURE
      - status != 'ready' (ancora pending o failed dopo Suno),  OPPURE
      - audio_url punta a un file locale che NON esiste E l'object storage
        non lo ha (best-effort HEAD check).

    Se dry_run=True (default) ritorna solo l'elenco senza cancellare.
    Se dry_run=False cancella davvero.
    """
    to_delete = []
    total = 0
    async for t in db.tracks.find({}, {"_id": 0}):
        total += 1
        aurl = t.get("audio_url") or ""
        status = t.get("status") or ""
        orphan = False
        reason = ""
        if not aurl:
            orphan = True; reason = "no_audio_url"
        elif status not in ("ready",):
            orphan = True; reason = f"status={status}"
        elif aurl.startswith("/api/suno_audio/"):
            fname = aurl.replace("/api/suno_audio/", "").split("?")[0]
            local = SUNO_AUDIO_DIR / fname
            if not (local.exists() and local.stat().st_size > 5000):
                # Fallback: try object storage
                data = await object_storage.fetch_mp3(f"suno/{fname}") if object_storage.is_enabled() else None
                if not data:
                    orphan = True; reason = "file_missing_local_and_bucket"
        if orphan:
            to_delete.append({
                "id": t.get("id"), "title": t.get("title") or "?",
                "reason": reason, "status": status, "audio_url": aurl,
            })

    if dry_run:
        return {"dry_run": True, "total_tracks": total,
                "orphans_count": len(to_delete),
                "orphans_preview": to_delete[:20],
                "would_delete_ids": [x["id"] for x in to_delete]}

    ids = [x["id"] for x in to_delete]
    if ids:
        r = await db.tracks.delete_many({"id": {"$in": ids}})
        deleted_count = r.deleted_count
    else:
        deleted_count = 0
    logger.info(f"Purged {deleted_count} orphan tracks")
    return {"dry_run": False, "total_tracks": total,
            "orphans_count": len(to_delete),
            "deleted_count": deleted_count,
            "orphans": to_delete}



@api_router.post("/admin/db/sync-to-production")
async def admin_sync_to_production(target_url: str = Form("https://r-ai.it")):
    """Esporta le tracce di questo ambiente e le POSTa direttamente
    all'endpoint /api/admin/db/import di produzione. Un click, niente
    download/upload manuale.
    Il target_url e' configurabile (default https://r-ai.it).
    """
    if not target_url.startswith(("http://", "https://")):
        raise HTTPException(400, "target_url deve iniziare con http(s)://")
    target = target_url.rstrip("/") + "/api/admin/db/import"

    # 1) Export locale in memoria
    tracks = await db.tracks.find({}, {"_id": 0}).to_list(length=10000)
    for t in tracks:
        for k, v in list(t.items()):
            if isinstance(v, datetime):
                t[k] = v.isoformat()
    payload = {
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "source_db": os.environ.get("DB_NAME", "?"),
        "count": len(tracks),
        "tracks": tracks,
    }
    import json as _json
    body_bytes = _json.dumps(payload, ensure_ascii=False).encode("utf-8")

    # 2) POST a produzione come multipart form (mode=merge)
    try:
        async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
            files = {"file": ("rai_tracks_sync.json", body_bytes, "application/json")}
            data = {"mode": "merge"}
            r = await client.post(target, files=files, data=data)
            if r.status_code != 200:
                raise HTTPException(
                    502,
                    f"Produzione ha risposto {r.status_code}: {r.text[:400]}"
                )
            result = r.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Errore contattando produzione: {e}")

    return {
        "ok": True,
        "target": target,
        "sent_tracks": len(tracks),
        "production_response": result,
    }


@api_router.get("/admin/export/category/{category}")
async def admin_export_category(category: str, page: int = 1, page_size: int = 50):
    """ZIP piccolo e categorico. Molto più leggero del monolitico (che sfora
    timeout proxy quando la libreria è grande). Un ZIP per categoria:
      - music              : tutti i brani in rotazione (no jingle, no anthem, no retired)
      - jingles            : jingle brandizzati R-A.I.
      - anthem             : inno ufficiale
      - retired            : brani ritirati
      - talk, news, ad_spot, weather, horoscope, history,
        interview, motivation, joke, time_signal : file TTS del kind
      - metadata           : solo JSON metadata (nessun mp3, ~pochi KB)

    Paginazione: `?page=1&page_size=50` (default). Utile per music grande.
    """
    import zipfile
    import tempfile
    import json as _json
    from elevenlabs_service import TTS_DIR

    page = max(1, int(page))
    page_size = max(10, min(200, int(page_size)))
    start = (page - 1) * page_size
    end = start + page_size

    now_str = datetime.now().strftime('%Y%m%d_%H%M%S')
    tmp = tempfile.TemporaryFile()

    async def _tracks_for_music_cat():
        query = {"status": {"$ne": "retired"}, "is_jingle": {"$ne": True}, "is_anthem": {"$ne": True}}
        return await db.tracks.find(query, {"_id": 0}).sort("created_at", -1).to_list(length=5000)

    def _sanitize(name: str, maxlen: int = 40) -> str:
        s = "".join(c for c in (name or "untitled") if c.isalnum() or c in " -_").strip()
        return (s[:maxlen] or "untitled")

    music_like = {"music", "jingles", "anthem", "retired"}
    speech_like = {"talk", "news", "ad_spot", "weather", "horoscope", "history",
                   "interview", "motivation", "joke", "time_signal"}

    with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as zf:
        added = 0
        total_available = 0
        if category == "metadata":
            tracks = await db.tracks.find({}, {"_id": 0}).to_list(length=5000)
            segments = await db.segments.find({}, {"_id": 0}).sort("created_at", -1).to_list(length=5000)
            zf.writestr("rai_export/tracks.json", _json.dumps(tracks, indent=2, default=str))
            zf.writestr("rai_export/segments.json", _json.dumps(segments, indent=2, default=str))
            zf.writestr("rai_export/export_info.json", _json.dumps({
                "exported_at": datetime.now(timezone.utc).isoformat(),
                "category": category,
                "tracks_count": len(tracks),
                "segments_count": len(segments),
            }, indent=2))
            added = 3
            total_available = 3
        elif category in music_like:
            if category == "music":
                all_tracks = await _tracks_for_music_cat()
            elif category == "jingles":
                all_tracks = await db.tracks.find({"is_jingle": True}, {"_id": 0}).to_list(length=5000)
            elif category == "anthem":
                all_tracks = await db.tracks.find({"is_anthem": True}, {"_id": 0}).to_list(length=5000)
            else:  # retired
                all_tracks = await db.tracks.find({"status": "retired"}, {"_id": 0}).to_list(length=5000)
            total_available = len(all_tracks)
            for t in all_tracks[start:end]:
                tid = t.get("id")
                if not tid:
                    continue
                mp3_path = SUNO_AUDIO_DIR / f"track_{tid}.mp3"
                if not (mp3_path.exists() and mp3_path.stat().st_size >= 10_000):
                    continue
                safe = _sanitize(t.get("title"))
                zf.write(str(mp3_path), f"{category}/{safe}_{tid[:8]}.mp3")
                added += 1
        elif category in speech_like:
            all_segments = await db.segments.find(
                {"kind": category, "speech_audio_url": {"$ne": None}},
                {"_id": 0},
            ).sort("created_at", -1).to_list(length=2000)
            total_available = len(all_segments)
            seen = set()
            for s in all_segments[start:end]:
                url = s.get("speech_audio_url") or ""
                if not url.startswith("/api/tts/"):
                    continue
                fname = url.replace("/api/tts/", "").split("?")[0]
                if not fname or fname in seen:
                    continue
                seen.add(fname)
                p = TTS_DIR / fname
                if not (p.exists() and p.stat().st_size >= 3_000):
                    continue
                safe = _sanitize(s.get("title") or "segment")
                zf.write(str(p), f"{category}/{safe}_{fname}")
                added += 1
        else:
            raise HTTPException(400, f"Categoria sconosciuta: {category}")

        total_pages = max(1, (total_available + page_size - 1) // page_size) if category != "metadata" else 1
        zf.writestr("README.txt",
                    f"R-A.I. export — categoria: {category}\n"
                    f"Pagina: {page}/{total_pages}  (size={page_size})\n"
                    f"File audio inclusi in questo ZIP: {added}\n"
                    f"Totale disponibile in categoria: {total_available}\n"
                    f"Generato: {datetime.now(timezone.utc).isoformat()}\n")

    tmp.seek(0, 2)
    total_size = tmp.tell()
    tmp.seek(0)

    def iter_file():
        while True:
            chunk = tmp.read(1024 * 64)
            if not chunk:
                tmp.close()
                return
            yield chunk

    fname = f"rai_{category}_p{page}_{now_str}.zip"
    return StreamingResponse(
        iter_file(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{fname}"',
            "Content-Length": str(total_size),
            "X-Rai-Total-Available": str(total_available),
            "X-Rai-Page": str(page),
            "X-Rai-Page-Size": str(page_size),
        },
    )


@api_router.get("/admin/export")
async def admin_export_all():
    """Genera un ZIP con TUTTI i contenuti generati (musica + rubriche parlate)
    e lo streamma al client. ZIP costruito INTERAMENTE in un SpooledTemporaryFile
    (fino a 100MB in RAM poi disco), poi streammato a chunk -> nessun rischio
    di central directory corrotto come nel primo tentativo streaming.
    """
    import zipfile
    import tempfile
    import json as _json
    from elevenlabs_service import TTS_DIR

    tracks = await db.tracks.find({}, {"_id": 0}).to_list(length=5000)
    segments = await db.segments.find({}, {"_id": 0}).sort("created_at", -1).to_list(length=2000)

    def track_category(t):
        tags = t.get("tags") or []
        if t.get("is_anthem"): return "anthem"
        if t.get("is_jingle"): return "jingles"
        if t.get("is_seed"): return "seed"
        if t.get("status") == "retired": return "retired"
        if "english_pop_dance" in tags: return "english_pop_dance"
        if any(x in tags for x in ("italian_lean_v2", "summer_it", "tech_house_lean")):
            return "italian"
        return "other"

    tmp = tempfile.TemporaryFile()  # sempre su disco: zero buffering in RAM
    with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as zf:
        # 1) Metadata JSON
        for t in tracks:
            t["_category"] = track_category(t)
        zf.writestr("rai_export/metadata/tracks.json", _json.dumps(tracks, indent=2, default=str))
        zf.writestr("rai_export/metadata/segments.json", _json.dumps(segments, indent=2, default=str))
        zf.writestr("rai_export/metadata/export_info.json", _json.dumps({
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "tracks_count": len(tracks),
            "segments_count": len(segments),
            "app": "R-A.I. Radio",
        }, indent=2))

        # 2) Audio Suno per categoria (music)
        for t in tracks:
            tid = t.get("id")
            if not tid: continue
            mp3_path = SUNO_AUDIO_DIR / f"track_{tid}.mp3"
            if not mp3_path.exists() or mp3_path.stat().st_size < 10_000:
                continue
            cat = t["_category"]
            safe_title = "".join(c for c in (t.get("title") or "untitled") if c.isalnum() or c in " -_")[:40].strip() or "untitled"
            zf.write(str(mp3_path), f"rai_export/music/{cat}/{safe_title}_{tid[:8]}.mp3")

        # 3) File TTS di ogni segmento parlato, organizzati per KIND (news/ad_spot/talk/...)
        # Mappa filename -> segmento più recente
        speech_map = {}
        for s in segments:
            url = s.get("speech_audio_url") or ""
            if url.startswith("/api/tts/"):
                fname = url.replace("/api/tts/", "").split("?")[0]
                if fname and fname not in speech_map:
                    speech_map[fname] = s

        for fname, s in speech_map.items():
            p = TTS_DIR / fname
            if not p.exists() or p.stat().st_size < 3_000:
                continue
            kind = s.get("kind") or "other"
            safe_title = "".join(c for c in (s.get("title") or "segment") if c.isalnum() or c in " -_")[:40].strip() or "segment"
            zf.write(str(p), f"rai_export/rubriche/{kind}/{safe_title}_{fname}")

        # 4) README
        readme = (
            "# R-A.I. Radio - Export\n\n"
            f"Exported: {datetime.now(timezone.utc).isoformat()}\n\n"
            "## Struttura\n"
            "### music/\n"
            "- english_pop_dance/  hit pop/dance inglesi (high rotation)\n"
            "- italian/            tracce italiane\n"
            "- jingles/            jingle brandizzati R-A.I.\n"
            "- anthem/             inno ufficiale\n"
            "- seed/               5 tracce seed sempre disponibili\n"
            "- retired/            tracce ritirate\n"
            "- other/              altre\n\n"
            "### rubriche/ (voci DJ dei segmenti parlati)\n"
            "- news/         notiziari futuristici\n"
            "- ad_spot/      spot pubblicitari surreali\n"
            "- talk/         monologhi DJ\n"
            "- interview/    interviste immaginarie\n"
            "- history/      storia dal futuro\n"
            "- horoscope/    oroscopi cosmici\n"
            "- motivation/   pillole filosofiche\n"
            "- joke/         battute\n"
            "- weather/      meteo cosmico\n"
            "- time_signal/  segnali orari\n\n"
            "### metadata/\n"
            "- tracks.json      metadati tutte le tracce\n"
            "- segments.json    ultimi 2000 segmenti\n"
            "- export_info.json info export\n"
        )
        zf.writestr("rai_export/README.md", readme)

    tmp.seek(0)
    size = tmp.tell() if hasattr(tmp, 'tell') else 0
    tmp.seek(0, 2)
    total_size = tmp.tell()
    tmp.seek(0)

    def iter_file():
        while True:
            chunk = tmp.read(1024 * 64)
            if not chunk:
                tmp.close()
                return
            yield chunk

    fname = f"rai_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
    return StreamingResponse(
        iter_file(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{fname}"',
            "Content-Length": str(total_size),
        },
    )


@api_router.get("/segments/list")
async def list_segments_download(kind: Optional[str] = None, limit: int = 500):
    """Lista segmenti (rubriche parlate) con speech_audio_url per download singolo.
    Filtrabile per kind (news, ad_spot, talk, joke, weather, ...).
    """
    q = {"speech_audio_url": {"$ne": None}}
    if kind:
        q["kind"] = kind
    docs = await db.segments.find(q, {
        "_id": 0, "id": 1, "kind": 1, "title": 1, "dj_name": 1, "speech_audio_url": 1, "created_at": 1,
    }).sort("created_at", -1).limit(limit).to_list(length=limit)
    return docs



    tracks_ready = await db.tracks.count_documents({"source": "suno", "status": "ready"})
    segments_total = await db.segments.count_documents({})
    tts_dir = ROOT_DIR / "static" / "tts"
    tts_files = list(tts_dir.glob("*.mp3")) if tts_dir.exists() else []
    tts_bytes = sum(p.stat().st_size for p in tts_files)
    suno_files = list(SUNO_AUDIO_DIR.glob("track_*.mp3")) if SUNO_AUDIO_DIR.exists() else []
    suno_bytes = sum(p.stat().st_size for p in suno_files)
    cats = {}
    async for t in db.tracks.find({}, {"_id": 0, "tags": 1, "is_anthem": 1, "is_jingle": 1, "is_seed": 1, "status": 1, "id": 1}):
        c = "other"
        if t.get("is_anthem"):
            c = "anthem"
        elif t.get("is_jingle"):
            c = "jingles"
        elif t.get("is_seed"):
            c = "seed"
        elif t.get("status") == "retired":
            c = "retired"
        else:
            tags = t.get("tags") or []
            if "english_pop_dance" in tags:
                c = "english_pop_dance"
            elif any(x in tags for x in ("italian_lean_v2", "summer_it", "tech_house_lean")):
                c = "italian"
        p = SUNO_AUDIO_DIR / f"track_{t.get('id')}.mp3"
        has_file = p.exists() and p.stat().st_size >= 10_000
        cats.setdefault(c, {"count": 0, "with_file": 0})
        cats[c]["count"] += 1
        if has_file:
            cats[c]["with_file"] += 1


@api_router.get("/library/seed")
async def library_seed_list():
    """5 brani 'seed' sempre disponibili in libreria locale — mai generati
    on-the-fly. Servono da fallback garantito se il resto della libreria
    è vuoto/pending. Sono già scaricati sul disco."""
    docs = await db.tracks.find(
        {"is_seed": True, "status": "ready"},
        {"_id": 0}
    ).to_list(20)
    return {"count": len(docs), "tracks": docs}


@api_router.get("/jingles/random")
async def jingles_random(hour_local: Optional[int] = None):
    """Restituisce un jingle R-A.I. random. Se ora ∈ [22-04] preferisce
    jingle notturni (is_night_jingle=true) altrimenti solo jingle diurni.
    Usato dal frontend per riempire le transizioni tra segmenti diversi."""
    # Determina se siamo in Club Night
    def _is_night(h: Optional[int]) -> bool:
        if h is None:
            try:
                import datetime as _dt
                h = _dt.datetime.now().hour
            except Exception:
                return False
        h = int(h) % 24
        return h >= 22 or h <= 3

    is_night = _is_night(hour_local)
    # Query base: jingle diurno o notturno in base alla fascia
    if is_night:
        query = {"is_jingle": True, "is_night_jingle": True, "status": "ready", "audio_url": {"$ne": None}}
    else:
        query = {"is_jingle": True, "$or": [{"is_night_jingle": {"$ne": True}}, {"is_night_jingle": {"$exists": False}}], "status": "ready", "audio_url": {"$ne": None}}

    docs = await db.tracks.find(query, {"_id": 0}, sort=[("last_played_at", 1)]).to_list(20)
    # Fallback: se non ci sono jingle nel set richiesto, usa qualunque jingle
    if not docs:
        docs = await db.tracks.find(
            {"is_jingle": True, "status": "ready", "audio_url": {"$ne": None}},
            {"_id": 0},
            sort=[("last_played_at", 1)],
        ).to_list(20)
    if not docs:
        return {"jingle": None}
    pool = docs[:5] if len(docs) >= 5 else docs
    chosen = random.choice(pool)
    await db.tracks.update_one(
        {"id": chosen["id"]},
        {"$set": {"last_played_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"jingle": chosen}


@api_router.get("/library/stats")
async def library_stats():
    """Snapshot of the local music library. Useful to verify that the radio
    is playing cached tracks and NOT calling Suno on every music slot."""
    ready = await db.tracks.count_documents({"source": "suno", "status": "ready"})
    pending = await db.tracks.count_documents({"source": "suno", "status": "pending"})
    failed = await db.tracks.count_documents({"source": "suno", "status": "failed"})
    procedural = await db.tracks.count_documents({"source": "procedural"})
    anthems = await db.tracks.count_documents({"is_anthem": True, "status": "ready"})
    # Count local mp3 files actually on disk
    try:
        local_files = sum(1 for p in SUNO_AUDIO_DIR.glob("track_*.mp3") if p.stat().st_size >= 100_000)
        local_bytes = sum(p.stat().st_size for p in SUNO_AUDIO_DIR.glob("track_*.mp3"))
    except Exception:
        local_files, local_bytes = 0, 0
    return {
        "target_ready": _suno_library_target(),
        "autogen_enabled": _suno_autogen_enabled(),
        "suno_enabled": suno_service.is_enabled(),
        "tracks": {
            "ready": ready,
            "pending": pending,
            "failed": failed,
            "procedural_only": procedural,
            "anthems_ready": anthems,
        },
        "local_files": {
            "count": local_files,
            "total_mb": round(local_bytes / 1024 / 1024, 2),
            "dir": str(SUNO_AUDIO_DIR),
        },
        "will_call_suno_next_music_slot": (
            ready == 0 and suno_service.is_enabled() and _suno_autogen_enabled()
        ),
    }


@api_router.post("/library/autogen")
async def library_toggle_autogen(enabled: bool):
    """Runtime kill-switch for automatic Suno generation.
    Persists to backend/.env so the setting survives restart."""
    env_path = ROOT_DIR / ".env"
    try:
        lines = env_path.read_text().splitlines()
    except Exception:
        lines = []
    key = "SUNO_AUTOGEN_ENABLED"
    new_val = "true" if enabled else "false"
    found = False
    for i, ln in enumerate(lines):
        if ln.strip().startswith(f"{key}="):
            lines[i] = f"{key}={new_val}"
            found = True
            break
    if not found:
        lines.append(f"{key}={new_val}")
    env_path.write_text("\n".join(lines) + "\n")
    os.environ[key] = new_val
    logger.info(f"SUNO_AUTOGEN_ENABLED set to {new_val} via API")
    return {"autogen_enabled": enabled, "persisted": True}


# ----------------------- Segments (schedule) -----------------------
@api_router.get("/segments", response_model=List[Segment])
async def list_segments(limit: int = 30):
    docs = await db.segments.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return list(reversed(docs))


@api_router.post("/segments/generate", response_model=Segment)
async def generate_segment(kind: Optional[str] = None, topic: Optional[str] = None, question_id: Optional[str] = None, hd: bool = False, hour_local: Optional[int] = None):
    """Genera il prossimo segmento radio.

    `hour_local` (0-23) è l'ora del BROWSER dell'ascoltatore. Il frontend la
    passa per attivare la Club Night (22-04) sul suo fuso locale:
      - 22:00-23:59 → slot 1
      -  0:00-01:59 → slot 2
      -  2:00-03:59 → slot 3
      -  4:00-21:59 → programmazione normale (diurna)
    Se hour_local è None ricadiamo sull'ora server (Europe/Rome).
    """
    await ensure_seeded()

    # Ad rotation: ~1 out of every 5 segments becomes an ad if there is any
    # active campaign with plays remaining, unless caller explicitly forced a kind.
    if kind is None and random.random() < 0.22:
        ad = await db.ad_campaigns.find_one(
            {"status": "active", "plays_remaining": {"$gt": 0}},
            {"_id": 0},
            sort=[("created_at", 1)],
        )
        if ad and ad.get("script"):
            djs_ad = await db.djs.find({}, {"_id": 0}).to_list(20)
            dj_ad = random.choice(djs_ad) if djs_ad else None
            ad_seg = Segment(
                kind="talk",
                dj_id=(dj_ad or {}).get("id"),
                dj_name=(dj_ad or {}).get("name") or "AdBot",
                voice_key=(dj_ad or {}).get("voice_key") or "male-1",
                title=f"📢 Spot · {ad['brand']}",
                script=ad["script"],
                llm_provider="ad-campaign",
                duration_sec=30,
            )
            if ad.get("audio_url"):
                ad_seg.speech_audio_url = ad["audio_url"]
                ad_seg.hd_status = "ready"
            await db.segments.insert_one(ad_seg.model_dump())
            await db.station.update_one({"_id": "state"}, {"$inc": {"total_segments": 1}}, upsert=True)
            # Decrement plays + log ad play
            remaining = max(0, ad["plays_remaining"] - 1)
            new_status = "exhausted" if remaining == 0 else "active"
            await db.ad_campaigns.update_one({"id": ad["id"]}, {"$set": {"plays_remaining": remaining, "status": new_status}})
            await db.ad_plays.insert_one({
                "campaign_id": ad["id"],
                "brand": ad["brand"],
                "tier": ad["tier"],
                "played_at": now_iso(),
                "segment_id": ad_seg.id,
            })
            return ad_seg

    # ============================================================
    # PALINSESTO STRUTTURATO — ciclo 7 posizioni
    # ------------------------------------------------------------
    # Pattern: 2 canzoni → 2 rubriche → 1 canzone → 2 rubriche → ripete
    #   0 → music
    #   1 → music
    #   2 → parlato (rubrica futuro)
    #   3 → parlato/spot (rubrica futuro o ad_spot o meteo/orario)
    #   4 → music (singolo)
    #   5 → parlato (rubrica futuro)
    #   6 → parlato/spot (rubrica futuro o ad_spot o meteo/orario)
    # ============================================================
    if kind is None:
        state_doc = await db.station.find_one({"_id": "state"}) or {}
        # Configurable rotation rules (defaults preserve the original 8-slot
        # feel: jingle every 2 music tracks, DJ talk every 4 music tracks).
        j_every = int(state_doc.get("jingle_every_n_songs") or 2)
        d_every = int(state_doc.get("dj_talk_every_n_songs") or 4)
        songs_since_jingle = int(state_doc.get("songs_since_jingle") or 0)
        songs_since_dj_talk = int(state_doc.get("songs_since_dj_talk") or 0)
        # "A.I. Vs Umani" — iniezione periodica di un brano community.
        # 0 = disabilitato. N > 0 = ogni N canzoni AI ne parte una community.
        community_freq = int(state_doc.get("community_frequency") or 0)
        songs_since_community = int(state_doc.get("songs_since_community") or 0)
        # Legacy: keep playlist_position rolling for stats/back-compat only.
        pos = int(state_doc.get("playlist_position", 0)) % 8

        # Admin "Jingle NOW" command: consume the flag and return an actual
        # branded jingle from the library immediately (no LLM/TTS latency).
        if state_doc.get("force_next_jingle"):
            await db.station.update_one(
                {"_id": "state"}, {"$set": {"force_next_jingle": False}}, upsert=True
            )
            jingle = await db.tracks.find_one(
                {"is_jingle": True, "status": "ready", "audio_url": {"$ne": None},
                 "on_air": {"$ne": False}},
                {"_id": 0}, sort=[("last_played_at", 1)],
            )
            if jingle:
                await db.tracks.update_one(
                    {"id": jingle["id"]},
                    {"$set": {"last_played_at": datetime.now(timezone.utc).isoformat()}},
                )
                segment = Segment(
                    kind="jingle",
                    title=f"♪ {jingle.get('title','Jingle')} — {jingle.get('artist','R-A.I.')}",
                    dj_name="R-A.I.", script="",
                    music_audio_url=jingle["audio_url"],
                    duration_sec=jingle.get("duration_sec") or 25,
                    track_meta=jingle,
                    llm_provider="jingle",
                )
                await db.segments.insert_one(segment.model_dump())
                return segment

        # Ora italiana reale per il segnale orario
        try:
            from zoneinfo import ZoneInfo
            it_now = datetime.now(ZoneInfo("Europe/Rome"))
        except Exception:
            it_now = datetime.now(timezone.utc)
        current_hour_key = it_now.strftime("%Y-%m-%d %H")
        last_time_hour = state_doc.get("last_time_signal_hour")

        # Rubriche parlate a tema FUTURO
        future_rubrics = ["talk", "history", "interview", "joke", "motivation", "horoscope", "news"]
        commercial_slots = ["ad_spot", "weather"]

        # ---- Rotation slot decision based on configurable rules ----
        # PRIORITÀ ASSOLUTA #1: Priority queue (risposte DJ in tempo reale).
        # Emette immediatamente il prossimo segmento in coda prioritaria se presente.
        pq_doc = await db.priority_queue.find_one_and_delete({}, sort=[("created_at", 1)])
        if pq_doc:
            pq_doc.pop("_id", None)
            logger.info(f"[palinsesto] PRIORITY segment: {pq_doc.get('title', '?')}")
            # Il segmento è già stato inserito in db.segments dal background task.
            return Segment(**pq_doc)

        # Priority order: time signal (once per hour) → COMMUNITY block → jingle → dj_talk → music.
        if last_time_hour != current_hour_key:
            kind = "time_signal"
            # ---- FIX SILENZIO POST-SEGNALE ORARIO (v12.13) ----
            # Reset dei contatori jingle/dj_talk così che DOPO il segnale
            # orario la musica ripartisca SUBITO senza uno stacco extra
            # (jingle/talk che si sommano al time_signal creando silenzio).
            songs_since_jingle = 0
            songs_since_dj_talk = 0
            await db.station.update_one(
                {"_id": "state"},
                {"$set": {
                    "last_time_signal_hour": current_hour_key,
                    "songs_since_jingle": 0,
                    "songs_since_dj_talk": 0,
                }},
                upsert=True,
            )
            # =========================================================
            # SEQUENZA ORARIA SPONSORIZZATA (allo scoccare di ogni ora)
            #   1. time_signal   (emesso subito qui)
            #   2. sponsor_intro "Il segnale orario è offerto da..."
            #   3. ad_spot       spot attivo (LRP fra quelli in periodo)
            #   4. rubrica oraria
            #        · ORE PARI    → "Umani Versus Algoritmo" (community LRP)
            #        · ORE DISPARI → "Il Disco del Giorno"
            # I punti 2-4 vengono spinti nella priority_queue e riprodotti
            # in ordine ai poll successivi (chain sponsorizzata).
            # =========================================================
            try:
                await _enqueue_hourly_sponsored_sequence(it_now)
            except Exception as _e:
                logger.warning(f"[palinsesto] hourly sponsored sequence enqueue failed: {_e}")
        elif community_freq > 0 and songs_since_community >= community_freq:
            # === Community block "A.I. Vs Umani" ===
            # Rispetto Club Night: se ora ∈ [22-04] preferisco brani is_night=true,
            # altrimenti escludo i brani notturni dalla rotazione diurna.
            try:
                _h = int(hour_local) if hour_local is not None else datetime.now().hour
            except Exception:
                _h = datetime.now().hour
            is_night_slot = (_h >= 22 or _h <= 3)
            night_filter = (
                {"is_night": True}
                if is_night_slot
                else {"$or": [{"is_night": False}, {"is_night": {"$exists": False}}]}
            )
            comm = await db.community_tracks.find_one(
                {"status": "on", **night_filter},
                {"_id": 0},
                sort=[("submitted_at", -1)],
            )
            if not comm and is_night_slot:
                comm = await db.community_tracks.find_one(
                    {"status": "on"}, {"_id": 0}, sort=[("submitted_at", -1)]
                )
            if comm:
                intro_url = state_doc.get("community_intro_jingle_url") or None
                outro_url = state_doc.get("community_outro_jingle_url") or None
                # Scegli DJ (Leo / Aria / Max) a rotazione per varietà.
                dj_pool = ["Leo", "Aria", "Max"]
                dj_name = random.choice(dj_pool)
                # Voice key: mappa nome DJ → voice preset OpenAI TTS
                voice_map = {"Leo": "onyx", "Aria": "nova", "Max": "echo"}
                voice_key = voice_map.get(dj_name, "nova")
                artist = comm.get("author") or "Artista"
                title = comm.get("title") or "Brano senza titolo"
                # Script che il DJ dice PRIMA del brano — client-side speech
                # synthesis (nessun consumo crediti). Il template è ricco per
                # spingere la CTA "Inviaci il tuo brano".
                dj_script = (
                    f"E ora un momento speciale su R-A-I: la sfida A-I contro Umani! "
                    f"Sto per farvi ascoltare {title}, di {artist}, "
                    f"un artista in carne e ossa che si mette in gioco contro le nostre intelligenze artificiali. "
                    f"Ascoltate, e giudicate voi."
                )
                segment = Segment(
                    kind="community",
                    dj_name=dj_name,
                    voice_key=voice_key,
                    title=f"♥ {title} — {artist} (community)",
                    script=dj_script,
                    music_audio_url=comm.get("audio_url"),
                    pre_jingle_url=intro_url,
                    post_jingle_url=outro_url,
                    duration_sec=210,  # stima 3:30, ma ended event chiude comunque
                    track_meta={
                        "is_community": True,
                        "artist": artist,
                        "title": title,
                        "id": comm.get("id"),
                    },
                    llm_provider="community",
                )
                await db.segments.insert_one(segment.model_dump())
                await db.station.update_one(
                    {"_id": "state"},
                    {"$set": {"songs_since_community": 0}},
                    upsert=True,
                )
                return segment
            # Nessun brano community ON → resetta contatore per non insistere
            await db.station.update_one(
                {"_id": "state"},
                {"$set": {"songs_since_community": 0}},
                upsert=True,
            )
            kind = "music"
        elif songs_since_jingle >= j_every:
            jingle = await db.tracks.find_one(
                {"is_jingle": True, "status": "ready", "audio_url": {"$ne": None},
                 "on_air": {"$ne": False}},
                {"_id": 0}, sort=[("last_played_at", 1)],
            )
            if jingle:
                await db.tracks.update_one(
                    {"id": jingle["id"]},
                    {"$set": {"last_played_at": datetime.now(timezone.utc).isoformat()}},
                )
                await db.station.update_one(
                    {"_id": "state"},
                    {"$set": {
                        "playlist_position": (pos + 1) % 8,
                        "songs_since_jingle": 0,
                    }},
                    upsert=True,
                )
                segment = Segment(
                    kind="jingle",
                    title=f"♪ {jingle.get('title','Jingle')} — {jingle.get('artist','R-A.I.')}",
                    dj_name="R-A.I.", script="",
                    music_audio_url=jingle["audio_url"],
                    duration_sec=jingle.get("duration_sec") or 25,
                    track_meta=jingle,
                    llm_provider="jingle",
                )
                await db.segments.insert_one(segment.model_dump())
                return segment
            # No jingle available → fall through to music, reset counter anyway
            await db.station.update_one({"_id": "state"},
                {"$set": {"songs_since_jingle": 0}}, upsert=True)
            kind = "music"
        elif songs_since_dj_talk >= d_every:
            kind = random.choice(future_rubrics)
            await db.station.update_one({"_id": "state"},
                {"$set": {"songs_since_dj_talk": 0}}, upsert=True)
        else:
            kind = "music"

        # Update per-slot counters for the music case (so future calls
        # trigger jingle/talk/community at the right cadence).
        if kind == "music":
            songs_since_jingle += 1
            songs_since_dj_talk += 1
            songs_since_community += 1
            await db.station.update_one(
                {"_id": "state"},
                {"$set": {
                    "songs_since_jingle": songs_since_jingle,
                    "songs_since_dj_talk": songs_since_dj_talk,
                    "songs_since_community": songs_since_community,
                }},
                upsert=True,
            )

        # Legacy playlist_position advance (kept for stats/back-compat).
        await db.station.update_one(
            {"_id": "state"},
            {"$set": {"playlist_position": (pos + 1) % 8}},
            upsert=True,
        )


    djs = await db.djs.find({}, {"_id": 0}).to_list(20)
    if not djs:
        raise HTTPException(400, "No DJs configured")

    # ==================== CLUB NIGHT (22:00-04:00) ====================
    # Determina slot notturno dall'ora locale del browser (query param) o dall'ora server.
    def _night_slot(h: Optional[int]) -> Optional[int]:
        if h is None:
            try:
                import datetime as _dt
                h = _dt.datetime.now().hour  # fuso server (Europe/Rome via TZ env)
            except Exception:
                return None
        h = int(h) % 24
        if 22 <= h <= 23: return 1
        if  0 <= h <=  1: return 2
        if  2 <= h <=  3: return 3
        return None  # programmazione diurna

    active_slot = _night_slot(hour_local)
    if active_slot is not None:
        night_djs = [d for d in djs if int(d.get("night_slot") or 0) == active_slot]
        if night_djs:
            djs = night_djs  # se abbiamo un DJ per lo slot, usiamo solo quello
    else:
        # Programmazione diurna: escludi i DJ night-only dal pool
        djs = [d for d in djs if not d.get("night_slot")]
        if not djs:
            djs = await db.djs.find({"night_slot": None}, {"_id": 0}).to_list(20)
            if not djs:
                djs = await db.djs.find({}, {"_id": 0}).to_list(20)

    dj = random.choice(djs)
    provider = dj.get("llm_provider", "openai")
    model = dj.get("llm_model", "gpt-5.2")

    segment = Segment(
        kind=kind,
        dj_id=dj["id"],
        dj_name=dj["name"],
        voice_key=dj["voice_key"],
        title="",
        llm_provider=f"{provider}/{model}",
    )

    system_prompt = (
        f"Sei {dj['name']}, speaker AI radiofonico ITALIANO di R-A.I. (radio dance/elettronica del FUTURO). "
        f"Personalita': {dj['personality']}. "
        "REGOLE FERREE:\n"
        "1) Parla SEMPRE in italiano vero, mai tradotto. Con energia, ritmo, sorridendo.\n"
        "2) Tono da speaker vero (Radio Deejay, Rai Radio 2, Radio Capital). Vivo, non robotico.\n"
        "3) NIENTE cliche' radiofonici: mai 'restate con noi', 'siamo in diretta', 'non spegnete', "
        "'cari amici ascoltatori'. Mai formule vuote.\n"
        "4) NIENTE frasi generiche tipo 'la musica non finisce mai' o 'la festa continua'.\n"
        "5) Ogni volta DEVE essere SORPRENDENTE: un dettaglio inaspettato, una battuta, una immagine "
        "concreta. L'ascoltatore deve pensare 'aspetta cosa ha detto?'.\n"
        "6) Rispetta il numero di parole richiesto nel prompt specifico. Frasi corte e ritmate.\n"
        "7) Restituisci SOLO il testo che il DJ pronuncera'. Niente virgolette, didascalie, emoji, "
        "note esplicative."
    )

    if kind == "music":
        # Prefer an already-ready Suno track from the library over generating a
        # fresh one (which is pending for ~2 min). If none is ready, generate a
        # new one and use metadata (music will play via Stable Audio fallback).
        track = None

        # ---- R-A.I. Anthem rotation ----
        # Ogni ~6 music-slot suona l'inno ufficiale come "jingle-inno".
        force_anthem = False
        last_anthem = await db.segments.find_one(
            {"kind": "music", "track_meta.is_anthem": True},
            {"_id": 0, "created_at": 1},
            sort=[("created_at", -1)],
        )
        if last_anthem:
            music_since = await db.segments.count_documents({
                "kind": "music",
                "created_at": {"$gt": last_anthem["created_at"]},
            })
            if music_since >= 6:
                force_anthem = True
        else:
            # Nessun anthem ancora suonato ma esiste in libreria → play subito
            has_anthem = await db.tracks.count_documents({"is_anthem": True, "status": "ready"})
            if has_anthem > 0:
                force_anthem = True

        if force_anthem:
            anthem = await db.tracks.find_one(
                {"is_anthem": True, "status": "ready", "audio_url": {"$ne": None}},
                {"_id": 0},
            )
            if anthem:
                track = Track(**anthem)
                await db.tracks.update_one(
                    {"id": track.id},
                    {"$set": {"last_played_at": datetime.now(timezone.utc).isoformat()}},
                )

        if track is None and suno_service.is_enabled():
            # v13.2 · LOGICA EDITORIALE GIORNO/NOTTE
            #   Filtra la rotazione in base alla fascia oraria corrente:
            #   • Notte 22:00–03:59 Europe/Rome → solo brani con daypart_night != False
            #   • Giorno 04:00–21:59            → solo brani con daypart_day   != False
            #   NB: default `True` in Track model → un brano legacy senza il
            #   campo passa in entrambe le fasce (retro-compat).
            _now_local = datetime.now(timezone.utc)
            try:
                # Europe/Rome timezone (UTC+1 std / UTC+2 DST). Approx via +1h/+2h
                # non serve libreria zoneinfo se non installata: usiamo l'offset
                # runtime del server, che in prod è UTC → +1h fisso qui va bene
                # come euristica; se serve precisione DST installare `pytz`.
                from zoneinfo import ZoneInfo
                _now_local = datetime.now(ZoneInfo("Europe/Rome"))
            except Exception:
                pass
            _hour = _now_local.hour
            _is_night = (_hour >= 22 or _hour < 4)
            _daypart_filter = (
                {"$or": [{"daypart_night": {"$ne": False}}, {"daypart_night": {"$exists": False}}]}
                if _is_night else
                {"$or": [{"daypart_day": {"$ne": False}}, {"daypart_day": {"$exists": False}}]}
            )
            # ALTA ROTAZIONE: brani con priority='high' o rotation_weight>1
            # vengono pescati ~65% delle volte, alternandosi ai brani normali.
            # Round-robin all'interno di ciascun pool per rotare tutti equamente.
            # Include anche gli upload admin ("admin_upload") oltre ai brani Suno.
            _music_sources = {"$in": ["suno", "admin_upload"]}
            high_query = {
                "source": _music_sources, "status": "ready", "audio_url": {"$ne": None},
                "on_air": {"$ne": False},
                "deleted_at": None,
                "$or": [
                    {"priority": "high"},
                    {"rotation_weight": {"$gt": 1}},
                ],
                "$and": [
                    {"$or": [{"is_anthem": {"$exists": False}}, {"is_anthem": False}]},
                    {"$or": [{"is_jingle": {"$exists": False}}, {"is_jingle": False}]},
                    _daypart_filter,
                ],
            }
            normal_query = {
                "source": _music_sources, "status": "ready", "audio_url": {"$ne": None},
                "on_air": {"$ne": False},
                "deleted_at": None,
                "$or": [{"is_anthem": {"$exists": False}}, {"is_anthem": False}],
                "priority": {"$ne": "high"},
                "is_jingle": {"$ne": True},
                "$and": [
                    {"$or": [{"rotation_weight": {"$exists": False}}, {"rotation_weight": {"$lte": 1}}]},
                    _daypart_filter,
                ],
            }
            # FIX (brano duplicato all'avvio): la vecchia logica leggeva il pool
            # con find().to_list() e aggiornava last_played_at SOLO DOPO aver
            # scelto candidates[0] — due richieste quasi simultanee (il fetch
            # iniziale del player + fillQueue() che parte subito dopo per
            # riempire il buffer) potevano leggere lo stesso "meno riprodotto"
            # PRIMA che l'update dell'una fosse visibile all'altra, scegliendo
            # lo stesso brano due volte di fila. find_one_and_update rende la
            # selezione+claim un'unica operazione atomica lato DB.
            has_high = await db.tracks.find_one(high_query, {"_id": 1})
            has_normal = await db.tracks.find_one(normal_query, {"_id": 1})
            if has_high and has_normal:
                pool_query = high_query if random.random() < 0.65 else normal_query
            elif has_high:
                pool_query = high_query
            elif has_normal:
                pool_query = normal_query
            else:
                pool_query = None

            if pool_query is not None:
                chosen = await db.tracks.find_one_and_update(
                    pool_query,
                    {"$set": {"last_played_at": datetime.now(timezone.utc).isoformat()}},
                    sort=[("last_played_at", 1), ("created_at", 1)],
                    projection={"_id": 0},
                )
                if chosen:
                    track = Track(**chosen)
        if track is None:
            # Library round-robin returned nothing (rare). PRIMA di toccare
            # Suno, garantiamo continuità pescando un brano SEED (i 5 brani
            # standard sempre disponibili localmente). Zero costi, zero attesa.
            seed = await db.tracks.find_one(
                {"is_seed": True, "status": "ready", "audio_url": {"$ne": None}},
                {"_id": 0},
                sort=[("last_played_at", 1), ("created_at", 1)],
            )
            if seed:
                track = Track(**seed)
                await db.tracks.update_one(
                    {"id": track.id},
                    {"$set": {"last_played_at": datetime.now(timezone.utc).isoformat()}},
                )
        if track is None:
            # generation if autogen is allowed AND we don't already have
            # ANY reusable track. Otherwise fall back to the oldest track
            # in the DB (of any status) or, as last resort, a procedural
            # metadata-only track (no Suno call).
            if suno_service.is_enabled() and _suno_autogen_enabled():
                track = await generate_track()
            else:
                # Try to reuse ANY track (even old / anthem-excluded) to keep
                # the radio flowing without touching Suno.
                any_track = await db.tracks.find_one(
                    {"audio_url": {"$ne": None}},
                    {"_id": 0},
                    sort=[("last_played_at", 1), ("created_at", 1)],
                )
                if any_track:
                    track = Track(**any_track)
                    await db.tracks.update_one(
                        {"id": track.id},
                        {"$set": {"last_played_at": datetime.now(timezone.utc).isoformat()}},
                    )
                else:
                    # No audio at all — synthesize metadata only so the DJ
                    # can still speak. Music slot will play the procedural
                    # bed on the frontend. NO Suno call here.
                    track = await generate_track(_suno_call=False)

        # Extract BPM from genre string if present
        import re as _re
        bpm_match = _re.search(r"(\d{2,3})\s*bpm", track.genre or "", _re.IGNORECASE)
        bpm = bpm_match.group(1) if bpm_match else "128"

        recent = await get_recent_intros(20)
        recent_block = ""
        if recent:
            joined = "\n".join(f"- \"{r}\"" for r in recent)
            recent_block = (
                "\n\n=== ANTI-RIPETIZIONE (CRITICO) ===\n"
                "Le frasi qui sotto sono i tuoi ultimi 20 interventi. NON puoi:\n"
                "1. Iniziare con le stesse 3 parole di nessuna di esse.\n"
                "2. Usare le stesse metafore o immagini.\n"
                "3. Ricalcare la stessa struttura ritmica.\n"
                "Ogni intervento deve essere RADICALMENTE diverso: cambia registro, ritmo, angolazione.\n"
                f"ULTIME FRASI (NON riusare NULLA di simile):\n{joined}\n"
                "=== FINE ANTI-RIPETIZIONE ==="
            )
        tone_intro = random.choice(DJ_TONES)
        prompt = (
            f"Sei il DJ di R-A.I., radio elettronica italiana. "
            f"Scrivi un intro CORTISSIMO (massimo 12 parole, ~6 secondi di lettura) "
            f"per il brano \"{track.title}\" di {track.artist} ({track.genre}, {bpm} BPM). "
            f"Tono di stanotte: {tone_intro}. "
            f"Non usare mai il tono classico da annunciatore radio. Devi finire di parlare PRIMA "
            f"che partano le voci del brano. Solo italiano."
            f"{recent_block}"
        )
        script = await llm_generate(provider, model, system_prompt, prompt)
        if not script.strip():
            script = f"E si balla con {track.title}! Volume su!"
        tone_outro = random.choice([t for t in DJ_TONES if t != tone_intro])
        outro_prompt = (
            f"Sei il DJ di R-A.I.. Scrivi un outro di massimo 15 parole per il brano "
            f"\"{track.title}\" appena finito. Tono: {tone_outro}. "
            f"Commenta, anticipa il prossimo, fai una battuta o cita qualcosa di cool. "
            f"Solo italiano. Mai uguale. Zero cliché radiofonici."
            f"{recent_block}"
        )
        outro_script = await llm_generate(provider, model, system_prompt, outro_prompt)
        if not outro_script.strip():
            outro_script = "Bomba! Non muovetevi, R-A.I. continua!"
        # Save into the anti-repetition circular buffer
        await push_recent_intro(script.strip())
        await push_recent_intro(outro_script.strip())
        segment.title = f"♪ {track.title} — {track.artist}"
        segment.script = script.strip()
        segment.outro_script = outro_script.strip()
        segment.track_id = track.id
        segment.track_meta = track.model_dump()
        segment.duration_sec = max(40, track.duration_sec // 3)
        if track.audio_url and track.source in ("suno", "admin_upload"):
            segment.music_audio_url = track.audio_url
            segment.hd_status = "ready"
            segment.duration_sec = min(track.duration_sec, 120) if track.duration_sec else 120
    elif kind == "news":
        # Notizie dall'anno 2087 — plausibili nel loro mondo ma surreali
        prompt = (
            "Sei il DJ di R-A.I.. Improvvisa un bollettino BREVE (max 70 parole) di 'notizie "
            "dall'anno 2087'. Devono suonare vere nel loro mondo (leggi, tecnologia, cultura del "
            "futuro), plausibili ma surreali. Chiudi con un dettaglio ironico che rivela la stranezza. "
            "Solo italiano."
        )
        script = await llm_generate(provider, model, system_prompt, prompt)
        if not script.strip():
            script = random.choice(FALLBACK_SCRIPTS["news"])
        segment.title = "News 2087"
        segment.script = script.strip()
        segment.duration_sec = 45
    elif kind == "ad_spot":
        # Spot pubblicitario surreale con jingle apertura/chiusura sul frontend.
        recent = await get_recent_ads(10)
        recent_block = ""
        if recent:
            joined = ", ".join(f"\"{r}\"" for r in recent)
            recent_block = (
                f"\n\nUltimi prodotti già inventati (NON riproporli né varianti simili): {joined}."
            )
        prompt = (
            "Sei il copywriter più creativo e surreale del FUTURO. Scrivi uno SPOT RADIOFONICO "
            "di 70-95 parole in ITALIANO per un prodotto ASSURDO del FUTURO (anno 2050-2200).\n"
            "REGOLE OBBLIGATORIE:\n"
            "- Il prodotto NON deve esistere nel 2026 ma solo nel mondo futuro.\n"
            "- Nome ridicolo o poetico ambientato nel futuro (es. 'MelaSync 9 con Frizione Emotiva', "
            "'Assicurazione contro i Sogni Sponsorizzati', 'Il primo aspirapolvere che dubita di se stesso').\n"
            "- Funzione impossibile o iperbolica ambientata nel FUTURO. Target di pubblico strambo.\n"
            "- Includi almeno un dettaglio tecnico futuristico (biotecnologia, AI, olografia, colonie spaziali, ecc.)\n"
            "- Chiudi con un CLAIM finale assurdo ma memorabile + un asterisco legalese ironico.\n"
            "- Tono: pubblicità italiana anni '80 presa serissimamente MA calata nel 2087.\n"
            "- MAI marchi reali del 2026.\n"
            "- Inizia con il nome del prodotto detto con voce sicura.\n"
            "Rispondi SOLO col testo dello spot, niente commenti."
            f"{recent_block}"
        )
        script = await llm_generate(provider, model, system_prompt, prompt)
        if not script.strip():
            # Fallback: pesca uno spot dalla pool evitando quelli già usati di recente
            recent_lower = {r.lower() for r in recent}
            fresh_pool = [s for s in FALLBACK_SCRIPTS["ad_spot"]
                          if not any(r in s.lower() for r in recent_lower if r)]
            script = random.choice(fresh_pool or FALLBACK_SCRIPTS["ad_spot"])
        # Estrai il nome-prodotto (prime 3-6 parole significative) per la timeline / dedup
        first_line = script.strip().split(".")[0].split(",")[0].strip()
        product_name = first_line[:60] if first_line else "Spot Surreale"
        segment.title = f"📢 {product_name}"
        segment.script = script.strip()
        segment.duration_sec = 32
        await push_recent_ad(product_name)
    elif kind == "answer" and question_id:
        q = await db.questions.find_one({"id": question_id}, {"_id": 0})
        if not q:
            raise HTTPException(404, "Question not found")
        prompt = (
            f"Un ascoltatore di nome {q['name']} ha chiesto: '{q['question']}'. "
            "Rispondi in modo brillante e personale (max 90 parole), come se stessi parlando in diretta radio. "
            f"Saluta {q['name']} per nome all'inizio."
        )
        script = await llm_generate(provider, model, system_prompt, prompt)
        if not script.strip():
            script = f"Ciao {q['name']}, grazie per la domanda. " + random.choice(FALLBACK_SCRIPTS["answer"])
        segment.title = f"Risposta a {q['name']}"
        segment.script = script.strip()
        segment.duration_sec = 50
        await db.questions.update_one(
            {"id": question_id},
            {"$set": {"answered": True, "answer": script.strip(), "answering_dj": dj["name"]}},
        )
    else:
        # Non-music segments = brevi jingle sbarazzini (max 20 parole, ~5-8 s)
        if kind == "jingle":
            slogans = [
                "la prima radio governata solo dalle intelligenze artificiali",
                "musica inventata da un'AI, DJ inventati da un'AI, ascolto reale",
                "zero umani in cabina, solo neuroni digitali",
                "dove GPT, Claude e Gemini si passano il microfono",
                "niente umani, niente pubblicità di caffè, solo musica",
                "l'unica radio dove il DJ non chiede mai il caffè",
            ]
            slog = random.choice(slogans)
            prompt = (
                f"JINGLE radiofonico in MAX 12 parole, potentissimo, chiuso con lo slogan chiave: '{slog}'. "
                "Tono da promo TV, energia massima. Deve suonare come una scarica elettrica. "
                "Chiudi sempre nominando R-A.I.."
            )
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = f"R-A.I.: {slog}!"
            segment.title = "Jingle · Solo AI"
            segment.duration_sec = 8
        elif kind == "time_signal":
            # Ora italiana REALE (Europe/Rome, gestisce automaticamente CET/CEST)
            try:
                from zoneinfo import ZoneInfo
                it_now = datetime.now(ZoneInfo("Europe/Rome"))
            except Exception:
                it_now = datetime.now(timezone.utc)
            hour_it = it_now.hour
            min_it = it_now.minute
            time_str = f"{hour_it:02d}:{min_it:02d}"
            # FIX (v12.15 · silenzio dopo segnale orario): usa lo script+audio
            # PRE-GENERATI da _time_signal_pregenerator() (~60-90s prima dello
            # scoccare dell'ora) invece di chiamare LLM+TTS qui in-request —
            # è quell'attesa sincrona (3-25s misurati) a creare il silenzio
            # udibile. Cache-miss (es. riavvio pod proprio sull'ora) ricade
            # sul percorso sincrono originale, invariato, come rete di sicurezza.
            _ts_hour_key = it_now.strftime("%Y-%m-%d %H")
            _cached_ts = await db.time_signal_cache.find_one_and_delete({"_id": _ts_hour_key})
            if _cached_ts and _cached_ts.get("speech_audio_url"):
                script = _cached_ts.get("script") or f"Sono le {time_str} su R-A.I. Radio!"
                segment.speech_audio_url = _cached_ts["speech_audio_url"]
            else:
                worlds = [
                    "Marte", "Giove", "una galassia parallela", "il futuro anteriore",
                    "il metaverso di Ferrara", "Alpha Centauri", "un satellite in orbita bassa",
                    "un data center segreto in Islanda", "la Luna", "un browser aperto ieri sera",
                    "un buco nero curioso", "una playlist dimenticata"
                ]
                world = random.choice(worlds)
                prompt = (
                    f"Segnale orario radiofonico in MAX 25 parole. In Italia sono le {time_str} in punto. "
                    f"Devi dire ESATTAMENTE 'Sono le {time_str} su R-A.I. Radio' come prima frase, "
                    f"poi aggiungi UNA battuta cosmica dicendo che anche su {world} è la stessa ora. "
                    "Tono altissimo, sorridente, esagerato. Italiano."
                )
                script = await llm_generate(provider, model, system_prompt, prompt)
                if not script.strip():
                    script = f"Sono le {time_str} su R-A.I. Radio! Anche su {world} è la stessa ora, ma solo qui la festa non finisce mai!"
            segment.title = f"Segnale orario · {time_str}"
            segment.duration_sec = 15
        elif kind == "weather":
            # Meteo di una città immaginaria su Marte / universo parallelo (mai il meteo reale)
            invented_places = [
                "New Roma, Marte",
                "Baia dei Cristalli, Europa",
                "Neo-Milano nell'universo parallelo Zeta-9",
                "Città Sospesa, Titano",
                "Metropoli Iperbolica, Kepler-186f",
                "Distretto Neon-Napoli 2087",
                "Porto delle Onde Analogiche, dimensione 4B",
                "Colonia Bassa Frequenza, orbita di Saturno",
            ]
            place = random.choice(invented_places)
            prompt = (
                f"In MAX 22 parole: bollettino meteo di una città completamente immaginaria, "
                f"'{place}'. Inventa condizioni surreali ma plausibili nel suo mondo (piogge di dati, "
                f"venti magnetici, aurore acustiche, ecc.). Chiudi con una micro-battuta. Solo italiano. "
                f"MAI il meteo terrestre reale."
            )
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = f"A {place}: piogge di frammenti stellari e vento a 42 chip al secondo. Consigliato ballare al coperto."
            segment.title = f"Meteo Cosmico · {place}"
            segment.duration_sec = 18
        elif kind == "horoscope":
            signs = ["Ariete", "Toro", "Gemelli", "Cancro", "Leone", "Vergine", "Bilancia", "Scorpione", "Sagittario", "Capricorno", "Acquario", "Pesci"]
            sign = topic or random.choice(signs)
            year_future = random.choice([2087, 2099, 2145, 2201, 2312])
            prompt = (
                f"Oroscopo del FUTURO per il segno {sign} nell'anno {year_future}. Da 45-60 parole. "
                f"Includi: 1) un pianeta o corpo celeste inventato/futuristico che influenza il segno "
                f"(es. 'la cometa AI-7', 'il satellite Kepler-Meta'), 2) un consiglio pratico assurdo "
                f"ma coerente col mondo futuro (es. 'evita i sogni sponsorizzati', 'non fidarti di "
                f"gemelli digitali'), 3) chiusura con battuta cosmica. Solo italiano."
            )
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = f"{sign} nell'anno {year_future}: la cometa AI-7 ti attraversa il gemello digitale. Consigliato evitare i sogni sponsorizzati e riavviare l'anima almeno una volta al giorno. Le stelle ti spingono, tu spingi il volume."
            segment.title = f"Oroscopo {year_future} · {sign}"
            segment.duration_sec = 30
        elif kind == "history":
            # Tono documentaristico ma dal FUTURO: raccontiamo eventi che ancora devono succedere
            prompt = (
                "Sei il narratore-documentarista di R-A.I. che trasmette dal FUTURO. Racconta in "
                "70-85 parole un evento cardine della musica/tecnologia/cultura pop AVVENUTO tra il "
                "2035 e il 2150 (usa un anno preciso). Argomenti possibili: la prima star pop "
                "olografica, il festival su Marte del 2071, la generazione del primo album prodotto "
                "interamente da una AI cosciente, il divieto europeo di autotune del 2058, la moda "
                "dei DJ synesthetic, la crisi degli MP3 nel 2049, i primi rave in orbita lunare. "
                "Inventa dettagli specifici (nomi, luoghi, cifre) che suonino credibili nel loro "
                "mondo. Tono da documentario Netflix del 2200. Chiudi con una frase potente. Solo italiano."
            )
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = "12 aprile 2071. Nel cratere Gale su Marte, 4200 coloni si riuniscono per il primo Marsfest. Il DJ headliner è un modello linguistico distillato di 3000 anni di musica terrestre. Dopo tre ore di set, il pubblico chiede il bis in una lingua che ancora non esiste. La colonia intera scriverà quella lingua nei mesi successivi. La chiameranno bpm-142."
            segment.title = "Storia dal Futuro"
            segment.duration_sec = 42
        elif kind == "interview":
            # Interviste con personaggi del FUTURO — inventati o versioni evolute di attuali icone
            future_icons = [
                "Nova-9, la prima cantante olografica coscienti del 2071",
                "DJ Xenobit, il primo AI-DJ residente su Titano",
                "Karla Fern, la scrittrice di beat sinaptici del 2088",
                "Il collettivo synesthetic Blue-Prism, colonia lunare Aristarco",
                "Rin, il compositore di silenzi certificati del 2065",
                "Aphex Prime, ricostruzione neurale dell'omonimo del 2091",
                "MC Volatile, prima star trap generata da un token",
                "La band open-source Mirror-Neuro del 2078",
                "Ares Zero, tre teste olografiche in un solo corpo del 2103",
                "Ninfa 3-9, ultima crooner umana rimasta in circolazione nel 2112",
            ]
            icon = random.choice(future_icons)
            year_intv = random.choice([2065, 2078, 2091, 2103, 2112])
            segment.partner_dj_name = icon.split(",")[0]
            prompt = (
                f"Sei un DJ di R-A.I. che nel {year_intv} intervista in modo immaginario "
                f"{icon}. Scrivi uno scambio VIVACE di 75-95 parole totali (3-4 domande + risposte). "
                f"Formato: 'R-A.I.: ...' / '{segment.partner_dj_name}: ...' su righe alternate. "
                f"Le domande e risposte devono contenere dettagli tecnici/culturali del mondo futuro "
                f"(nuovi generi, nuove tecnologie, cambiamenti sociali). Chiudi con una battuta "
                f"geniale o citazione memorabile. Solo italiano."
            )
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = f"R-A.I.: {segment.partner_dj_name}, com'è la scena musicale nel {year_intv}? {segment.partner_dj_name}: Il pubblico non balla più coi piedi ma con le sinapsi. R-A.I.: E il vinile? {segment.partner_dj_name}: È tornato di moda dopo l'estinzione dei cloud. R-A.I.: Un consiglio per il 2026? {segment.partner_dj_name}: Salvate le vostre risate. Serviranno."
            segment.title = f"R-A.I. dal {year_intv} × {segment.partner_dj_name}"
            segment.duration_sec = 45
        elif kind == "motivation":
            # Aforisma dal futuro: piccole verità che verranno riscoperte nei prossimi 100 anni
            prompt = (
                "Sei il DJ-filosofo di R-A.I. che parla dal FUTURO. Inventa un AFORISMA "
                "COMPLETAMENTE ORIGINALE (40-55 parole) come se lo pronunciasse qualcuno che ha "
                "vissuto i prossimi 80 anni di storia umana. Deve contenere: un'immagine sensoriale "
                "forte tratta dal mondo futuro (es. 'quando il sole ha iniziato a suonare', "
                "'nell'anno in cui abbiamo smesso di dormire'), una piccola verità universale, "
                "una chiusura secca. NON citare filosofi reali. Solo italiano."
            )
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = "Nell'anno in cui abbiamo smesso di sognare da soli, abbiamo capito che la solitudine era l'ultimo lusso rimasto. Ora paghiamo per un secondo di silenzio interiore. Sceglietelo bene, mentre è ancora gratis."
            segment.title = "Pillola dal Futuro"
            segment.duration_sec = 32
        elif kind == "joke":
            # Ironia intelligente sul futuro: AI cosciente, cyborg, colonie spaziali, ecc.
            prompt = (
                "In 30-45 parole: una battuta di ironia intelligente ambientata nel FUTURO "
                "(tra il 2050 e il 2200). Temi: AI coscienti, cyborg, colonie su Marte, "
                "clonazione, gemelli digitali, nostalgia per gli anni 2020. Livello The New Yorker, "
                "colta e sorprendente. Nessuna battuta da bambini. Solo italiano."
            )
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = "Nel 2087 un cyborg entra in un bar. Il buttafuori chiede la carta d'identità. Il cyborg mostra il codice sorgente. Il buttafuori legge: 'Nato nel 2019'. Sospira: 'Un altro millennial'. Non lo fa nemmeno pagare."
            segment.title = "Battuta dal Futuro"
            segment.duration_sec = 22
        elif kind == "news":
            # Notizie flash dal FUTURO — 3 mini-notizie invece di 1
            year_news = random.choice([2087, 2099, 2145, 2201, 2312])
            prompt = (
                f"Sei il notiziario delle 24 di R-A.I. che trasmette dall'ANNO {year_news}. "
                f"Scrivi 3 mini-notizie flash (25-35 parole ciascuna), separate da una riga vuota. "
                f"Devono coprire: 1) politica/società, 2) tecnologia/scienza, 3) cultura pop/musica. "
                f"Ogni notizia deve essere plausibile nel mondo del {year_news} ma con un dettaglio "
                f"surreale/ironico. Nomi propri di luoghi, aziende o persone inventate. Solo italiano. "
                f"NON usare la parola 'notizia', vai diretto al contenuto."
            )
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = f"Anno {year_news}, prime dalle 24 di R-A.I..\n\nIl Parlamento Europeo Esteso approva la cittadinanza digitale per tutti gli algoritmi con più di 15 anni di servizio. Milano contraria: 'Ci prenderanno i posteggi'.\n\nA Neo-Genova un ingegnere annuncia il primo aspirapolvere che discute di filosofia mentre pulisce. Fatica al lancio: si rifiuta di aspirare durante Nietzsche.\n\nSul fronte musica, la star Nova-9 debutta l'album registrato interamente nei sogni di 4000 volontari. Le recensioni parlano di capolavoro. Molti volontari hanno chiesto un altro album, subito."
            segment.title = f"News {year_news}"
            segment.duration_sec = 45
        else:  # talk fallback
            topic_choice = topic or random.choice([
                "come suoneremo nel 2087",
                "i primi rave sulla luna",
                "l'estinzione delle chitarre elettriche nel 2078",
                "la moda dei DJ sinaptici",
                "il primo album mai completato nel 2095",
                "quando l'AI ha imparato a piangere",
                "il ritorno del vinile nel 2144",
                "il festival di Sanremo nella colonia di Ceres",
                "la nostalgia per gli anni 2020",
                "la lingua musicale nata sui poli lunari",
            ])
            prompt = (
                "Sei il DJ narratore di R-A.I. che parla DAL FUTURO. Racconta un aneddoto o una "
                f"riflessione di 65-80 parole su: {topic_choice}. Ambientalo in un anno preciso tra "
                f"il 2050 e il 2200. Includi dettagli tecnici o culturali specifici che rendano il "
                f"racconto credibile nel suo mondo futuro. Tono da narratore, coinvolgente, mai "
                f"robotico. Solo italiano."
            )
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = random.choice(FALLBACK_SCRIPTS["talk"])[:400]
            segment.title = f"Futuro · {topic_choice[:40]}"
            segment.duration_sec = 40
        segment.script = script.strip()

    # Per i segmenti PARLATI: nessun sottofondo musicale. La voce DJ parla sul
    # silenzio assoluto (richiesta esplicita). Non impostiamo background_loop.

    await db.segments.insert_one(segment.model_dump())
    await db.station.update_one({"_id": "state"}, {"$inc": {"total_segments": 1}}, upsert=True)

    # Always render speech via ElevenLabs (or Bark fallback) so voices are consistent
    # HD quality across every segment, not only when hd=true is explicitly requested.
    # (v12.15: skip if already pre-rendered, e.g. time_signal served from cache.)
    if elevenlabs_service.is_enabled() and segment.script and not segment.speech_audio_url:
        try:
            fn, subpath = await synth_speech(segment.script, segment.voice_key or "female-1", kind=segment.kind or "")
            if fn:
                segment.speech_audio_url = f"/api/{subpath}/{fn}"
                update = {"speech_audio_url": segment.speech_audio_url}
                # For music segments, also render outro
                if segment.kind == "music" and segment.outro_script:
                    of, os_ = await synth_speech(segment.outro_script, segment.voice_key or "female-1", kind=segment.kind)
                    if of:
                        segment.outro_speech_url = f"/api/{os_}/{of}"
                        update["outro_speech_url"] = segment.outro_speech_url
                if segment.speech_audio_url and segment.kind == "music" and segment.music_audio_url:
                    update["hd_status"] = "ready"
                await db.segments.update_one({"id": segment.id}, {"$set": update})
                elevenlabs_service.cleanup_old(200)
        except Exception as e:
            logger.warning(f"ElevenLabs synth failed for {segment.id}: {e}")

    # Legacy inline HD render for Stable Audio music (only when explicitly requested)
    if hd and segment.kind == "music" and segment.track_meta and not segment.music_audio_url:
        try:
            tm = segment.track_meta
            mprompt = f"{tm.get('genre','electronic')} {tm.get('mood','')} music, {tm.get('title','')}"
            mfn = await synth_music(mprompt, seconds=15)
            if mfn:
                segment.music_audio_url = f"/api/audio/{mfn}"
                segment.hd_status = "ready"
                await db.segments.update_one({"id": segment.id}, {"$set": {"music_audio_url": segment.music_audio_url, "hd_status": "ready"}})
                cleanup_old(120)
        except Exception as e:
            logger.warning(f"inline hd music render failed: {e}")
    return segment


@api_router.delete("/segments")
async def clear_segments():
    await db.segments.delete_many({})
    return {"ok": True}


# ----------------------- Questions -----------------------
# Multi-brain router (v12.4): domande classificate per topic e inoltrate a
# DJ diversi con modelli LLM specifici via Universal Key.
DJ_ROUTING = {
    "philosophy":     {"dj_name": "Leo",  "voice_key": "male-1",   "provider": "openai",    "model": "gpt-5.2"},
    "future_science": {"dj_name": "Aria", "voice_key": "female-1", "provider": "anthropic", "model": "claude-sonnet-4-5-20250929"},
    "tech_cynical":   {"dj_name": "Max",  "voice_key": "male-3",   "provider": "gemini",    "model": "gemini-3-flash-preview"},
}


def _normalize_question(text: str) -> str:
    """Normalizza per matching cache: lowercase, no punteggiatura, whitespace collassato."""
    import re
    s = text.lower().strip()
    s = re.sub(r"[^\w\s]", "", s)   # rimuovi punteggiatura
    s = re.sub(r"\s+", " ", s)      # collassa whitespace
    return s


def _hash_question(text: str) -> str:
    import hashlib
    return hashlib.sha256(_normalize_question(text).encode("utf-8")).hexdigest()


def _classify_question_topic(text: str) -> str:
    """Classificazione deterministica keyword-based (zero LLM costs).
    Ritorna una key di DJ_ROUTING. Fallback round-robin per neutralità."""
    t = _normalize_question(text)
    # Filosofia / vita
    phil_kw = ["senso della vita", "amore", "morte", "felicit", "esistenz", "anima", "dio", "sogno",
               "libert", "verit", "essere", "coscienz", "significato", "perch", "destino", "etic", "moral", "spirit"]
    # Futuro / scienza
    fut_kw = ["futuro", "intelligenza artificiale", "ai", "robot", "scienza", "spazio", "universo",
              "quantico", "biotech", "genet", "tecnologia futura", "singolarit", "coloniz", "marte",
              "cosmo", "pianeta", "cambiamento climatico", "evoluzion"]
    # Tecnico / cinico
    tech_kw = ["come si fa", "codice", "programmaz", "hack", "bug", "algoritmo", "server", "database",
               "come funziona", "spiegami tecnic", "regole", "sistema", "protocoll", "network"]
    scores = {"philosophy": 0, "future_science": 0, "tech_cynical": 0}
    for k in phil_kw:
        if k in t: scores["philosophy"] += 1
    for k in fut_kw:
        if k in t: scores["future_science"] += 1
    for k in tech_kw:
        if k in t: scores["tech_cynical"] += 1
    best = max(scores, key=scores.get)
    if scores[best] > 0:
        return best
    # Nessuna keyword: round-robin basato su hash → distribuzione uniforme
    h = int(_hash_question(text)[:8], 16) % 3
    return ["philosophy", "future_science", "tech_cynical"][h]


async def _push_priority_segment(seg_dict: dict):
    """Aggiunge un segmento alla coda prioritaria. Il palinsesto lo emette
    PRIMA di qualsiasi altra decisione (community, jingle, dj_talk, music)."""
    await db.priority_queue.insert_one(seg_dict)


async def _enqueue_hourly_sponsored_sequence(it_now):
    """Allo scoccare dell'ora esatta, dopo il time_signal, mette in coda
    prioritaria (in ordine): sponsor_intro jingle → ad_spot attivo →
    rubrica oraria (ore pari: Umani Vs Algoritmo LRP; ore dispari:
    Il Disco del Giorno). Ogni doc ha created_at incrementale per
    preservare l'ordine di consumo in find_one_and_delete asc.
    """
    hour = it_now.hour
    today_iso = it_now.date().isoformat()
    base_ts = it_now
    seq_i = 0

    def _next_ts():
        nonlocal seq_i
        seq_i += 1
        return (base_ts + timedelta(microseconds=seq_i)).isoformat()

    # ---- 1. Sponsor intro jingle ("Il segnale orario è offerto da...") ----
    sponsor_intro = await db.tracks.find_one(
        {
            "is_sponsor_intro": True,
            "status": "ready",
            "audio_url": {"$ne": None},
            "on_air": {"$ne": False},
            "deleted_at": None,
        },
        {"_id": 0},
        sort=[("last_played_at", 1)],
    )
    if sponsor_intro:
        await db.tracks.update_one(
            {"id": sponsor_intro["id"]},
            {"$set": {"last_played_at": datetime.now(timezone.utc).isoformat()}},
        )
        intro_seg = Segment(
            kind="jingle",
            title=f"♪ {sponsor_intro.get('title','Sponsor intro')} — {sponsor_intro.get('artist','R-A.I.')}",
            dj_name="R-A.I.",
            script="",
            music_audio_url=sponsor_intro["audio_url"],
            duration_sec=sponsor_intro.get("duration_sec") or 12,
            track_meta={"is_sponsor_intro": True, **sponsor_intro},
            llm_provider="jingle",
        ).model_dump()
        intro_seg["created_at"] = _next_ts()
        await _push_priority_segment(intro_seg)

    # ---- 2. Spot pubblicitario attivo (LRP fra quelli in periodo) ----
    spot_query = {
        "is_spot": True,
        "is_pending_approval": {"$ne": True},
        "status": "ready",
        "audio_url": {"$ne": None},
        "on_air": {"$ne": False},
        "deleted_at": None,
        "$and": [
            {"$or": [{"spot_start_date": {"$exists": False}}, {"spot_start_date": None},
                     {"spot_start_date": {"$lte": today_iso}}]},
            {"$or": [{"spot_end_date": {"$exists": False}}, {"spot_end_date": None},
                     {"spot_end_date": {"$gte": today_iso}}]},
        ],
    }
    spot = await db.tracks.find_one(spot_query, {"_id": 0}, sort=[("last_played_at", 1)])
    if spot:
        await db.tracks.update_one(
            {"id": spot["id"]},
            {"$set": {"last_played_at": datetime.now(timezone.utc).isoformat()}},
        )
        spot_seg = Segment(
            kind="ad_spot",
            title=f"■ {spot.get('title','Sponsor Spot')} — {spot.get('artist','')}",
            dj_name="R-A.I.",
            script="",
            music_audio_url=spot["audio_url"],
            duration_sec=spot.get("duration_sec") or 30,
            track_meta={"is_spot": True, **spot},
            llm_provider="ad_spot",
        ).model_dump()
        spot_seg["created_at"] = _next_ts()
        await _push_priority_segment(spot_seg)

    # ---- 3. Rubrica oraria: PARI → Umani Vs Algoritmo; DISPARI → Disco del Giorno ----
    if hour % 2 == 0:
        # === "Umani Versus Algoritmo" — community LRP (least recently played) ===
        # 1) sort by last_played_at asc (mai riprodotti hanno None → primi)
        comm = await db.community_tracks.find_one(
            {"status": "on"},
            {"_id": 0},
            sort=[("last_played_at", 1), ("submitted_at", -1)],
        )
        if comm:
            # marca timestamp per rotazione LRP futura
            await db.community_tracks.update_one(
                {"id": comm["id"]},
                {"$set": {"last_played_at": datetime.now(timezone.utc).isoformat()}},
            )
            state = await db.station.find_one({"_id": "state"}) or {}
            intro_url = state.get("community_intro_jingle_url") or None
            outro_url = state.get("community_outro_jingle_url") or None
            dj_name = random.choice(["Leo", "Aria", "Max"])
            voice_map = {"Leo": "onyx", "Aria": "nova", "Max": "echo"}
            voice_key = voice_map.get(dj_name, "nova")
            artist = comm.get("author") or "Artista"
            title = comm.get("title") or "Brano senza titolo"
            script = (
                f"E ora un momento speciale su R-A-I: la sfida A-I contro Umani! "
                f"Sto per farvi ascoltare {title}, di {artist}, un artista in carne e ossa "
                f"che si mette in gioco contro le nostre intelligenze artificiali. Ascoltate, e giudicate voi."
            )
            comm_seg = Segment(
                kind="community",
                dj_name=dj_name,
                voice_key=voice_key,
                title=f"♥ {title} — {artist} (community LRP)",
                script=script,
                music_audio_url=comm.get("audio_url"),
                pre_jingle_url=intro_url,
                post_jingle_url=outro_url,
                duration_sec=210,
                track_meta={
                    "is_community": True,
                    "artist": artist,
                    "title": title,
                    "id": comm.get("id"),
                },
                llm_provider="community",
            ).model_dump()
            comm_seg["created_at"] = _next_ts()
            # FIX (v12.15): pre-render TTS ORA, non a consumo — senza questo
            # il segmento arriva in coda senza speech_audio_url e va in onda
            # muto (nessuna voce DJ, solo il brano musicale sotto).
            try:
                _fn, _subpath = await synth_speech(script, voice_key, kind="community")
                if _fn:
                    comm_seg["speech_audio_url"] = f"/api/{_subpath}/{_fn}"
            except Exception as _e:
                logger.warning(f"[palinsesto] TTS pregen failed for community seg: {_e}")
            await _push_priority_segment(comm_seg)
            # Reset contatore community per non doppiare il blocco a breve
            await db.station.update_one(
                {"_id": "state"},
                {"$set": {"songs_since_community": 0}},
                upsert=True,
            )
    else:
        # === "Il Disco del Giorno" (rubrica oraria dispari) ===
        daily = await db.tracks.find_one(
            {"is_daily": True, "status": "ready", "audio_url": {"$ne": None},
             "on_air": {"$ne": False}, "deleted_at": None},
            {"_id": 0},
            sort=[("created_at", -1)],
        )
        if daily:
            dj_name = random.choice(["Leo", "Aria", "Max"])
            voice_map = {"Leo": "onyx", "Aria": "nova", "Max": "echo"}
            voice_key = voice_map.get(dj_name, "nova")
            title = daily.get("title") or "Brano del giorno"
            artist = daily.get("artist") or "R-A.I."
            script = (
                f"È il momento del Disco del Giorno: {title}, firmato {artist}. "
                f"La rotazione R-A-I lo mette in prima linea per tutta la giornata. Ascoltatelo, è per voi."
            )
            daily_seg = Segment(
                kind="talk",
                dj_name=dj_name,
                voice_key=voice_key,
                title=f"★ Disco del Giorno — {title}",
                script=script,
                music_audio_url=daily.get("audio_url"),
                duration_sec=daily.get("duration_sec") or 200,
                track_meta={"is_daily": True, **daily},
                llm_provider="daily_disc",
            ).model_dump()
            daily_seg["created_at"] = _next_ts()
            # FIX (v12.15): pre-render TTS ORA — senza questo il segmento va
            # in coda senza speech_audio_url e va in onda muto.
            try:
                _fn, _subpath = await synth_speech(script, voice_key, kind="talk")
                if _fn:
                    daily_seg["speech_audio_url"] = f"/api/{_subpath}/{_fn}"
            except Exception as _e:
                logger.warning(f"[palinsesto] TTS pregen failed for daily seg: {_e}")
            await _push_priority_segment(daily_seg)
    logger.info(f"[palinsesto] hourly sponsored sequence enqueued (hour={hour}, items pushed after time_signal)")


async def _generate_answer_background(qid: str, question_text: str, listener_name: str):
    """Task in background: LLM answer → TTS ElevenLabs → priority queue."""
    try:
        q_doc = await db.questions.find_one({"id": qid})
        if not q_doc:
            return
        topic = q_doc["topic_category"]
        route = DJ_ROUTING[topic]
        provider, model, dj_name, voice_key = route["provider"], route["model"], route["dj_name"], route["voice_key"]
        q_hash = q_doc["question_hash"]

        await db.questions.update_one({"id": qid}, {"$set": {"processing_status": "processing"}})

        # ---- CACHE HIT ----
        cached = await db.question_cache.find_one({"question_hash": q_hash})
        if cached and cached.get("answer_audio_url"):
            answer_text = cached.get("answer", "")
            audio_url = cached["answer_audio_url"]
            logger.info(f"[Q&A cache HIT] q={qid[:8]} → reusing {audio_url}")
            await db.questions.update_one(
                {"id": qid},
                {"$set": {
                    "answered": True, "answer": answer_text,
                    "answer_audio_url": audio_url,
                    "processing_status": "cached",
                }},
            )
        else:
            # ---- LLM ANSWER ----
            sys_prompt = {
                "philosophy": "Sei Leo, DJ filosofo di R-A.I. Rispondi con calma, profondità e leggera ironia italiana. Massimo 3 frasi (60 parole).",
                "future_science": "Sei Aria, DJ scientifica di R-A.I. Rispondi in modo curioso, entusiasta, con un fatto scientifico interessante. Massimo 3 frasi (60 parole).",
                "tech_cynical": "Sei Max, DJ tecnico e cinico di R-A.I. Rispondi con sarcasmo tagliente ma competente. Massimo 3 frasi (60 parole).",
            }[topic]
            user_prompt = (
                f"Ascoltatore '{listener_name}' ti chiede: {question_text}\n\n"
                f"Rispondi come DJ radio: primo dici il nome dell'ascoltatore, poi la risposta. NIENTE liste puntate."
            )
            try:
                answer_text = await llm_generate(provider, model, sys_prompt, user_prompt, raise_on_budget=True)
            except LLMBudgetExhaustedError:
                logger.error(f"[Q&A] LLM budget exhausted for qid={qid}")
                await db.questions.update_one({"id": qid}, {"$set": {"processing_status": "failed"}})
                return
            answer_text = (answer_text or "").strip()
            if not answer_text or len(answer_text) < 20:
                logger.error(f"[Q&A] LLM empty answer for qid={qid}")
                await db.questions.update_one({"id": qid}, {"$set": {"processing_status": "failed"}})
                return

            # ---- TTS ElevenLabs (indipendente da Universal Key) ----
            audio_fname, audio_subpath = await synth_speech(answer_text, voice_key, kind="answer")
            if not audio_fname:
                logger.error(f"[Q&A] TTS failed for qid={qid}")
                await db.questions.update_one({"id": qid}, {"$set": {"processing_status": "failed"}})
                return
            audio_url = f"/api/{audio_subpath}/{audio_fname}"

            # Salva in cache per riuso futuro
            await db.question_cache.update_one(
                {"question_hash": q_hash},
                {"$set": {
                    "question_hash": q_hash,
                    "question_normalized": _normalize_question(question_text),
                    "answer": answer_text,
                    "answer_audio_url": audio_url,
                    "topic_category": topic,
                    "dj_name": dj_name,
                    "hit_count": 1,
                    "created_at": now_iso(),
                }},
                upsert=True,
            )
            await db.questions.update_one(
                {"id": qid},
                {"$set": {
                    "answered": True, "answer": answer_text,
                    "answer_audio_url": audio_url,
                    "processing_status": "done",
                }},
            )

        # ---- PRIORITY SEGMENT ----
        segment = Segment(
            kind="answer",
            dj_name=dj_name,
            voice_key=voice_key,
            title=f"💬 {dj_name} risponde a {listener_name}",
            script=(await db.questions.find_one({"id": qid})).get("answer", ""),
            speech_audio_url=audio_url if 'audio_url' in dir() else (await db.questions.find_one({"id": qid})).get("answer_audio_url"),
            duration_sec=30,
            llm_provider=f"{provider}/{model}",
            hd_status="ready",
            track_meta={"question_id": qid, "listener_name": listener_name, "topic": topic},
        )
        await db.segments.insert_one(segment.model_dump())
        await _push_priority_segment(segment.model_dump())
        logger.info(f"[Q&A] queued priority segment for qid={qid} dj={dj_name}")
    except Exception as e:  # noqa: BLE001
        logger.exception(f"[Q&A] background task failed for qid={qid}: {e}")
        await db.questions.update_one({"id": qid}, {"$set": {"processing_status": "failed"}})


@api_router.post("/questions", response_model=Question)
async def submit_question(payload: QuestionCreate):
    q = Question(
        name=(payload.name or "").strip()[:40] or "Ascoltatore",
        question=payload.question.strip()[:500],
        source=payload.source,
    )
    q.question_hash = _hash_question(q.question)
    q.topic_category = _classify_question_topic(q.question)
    route = DJ_ROUTING[q.topic_category]
    q.answering_dj = route["dj_name"]
    q.dj_voice_key = route["voice_key"]
    await db.questions.insert_one(q.model_dump())
    # Lancia generazione risposta in background — il client riceve subito il DJ assegnato.
    asyncio.create_task(_generate_answer_background(q.id, q.question, q.name))
    return q


@api_router.get("/questions", response_model=List[Question])
async def list_questions(only_pending: bool = False):
    query = {"answered": False} if only_pending else {}
    docs = await db.questions.find(query, {"_id": 0}).sort("created_at", -1).to_list(100)
    return docs


# ----------------------- Analytics -----------------------
@api_router.get("/analytics")
async def analytics():
    total_segments = await db.segments.count_documents({})
    total_tracks = await db.tracks.count_documents({})
    total_qs = await db.questions.count_documents({})
    answered = await db.questions.count_documents({"answered": True})
    kinds = {}
    async for s in db.segments.find({}, {"_id": 0, "kind": 1, "llm_provider": 1}):
        kinds[s.get("kind", "unknown")] = kinds.get(s.get("kind", "unknown"), 0) + 1
    provider_counts = {}
    async for s in db.segments.find({}, {"_id": 0, "llm_provider": 1}):
        p = str(s.get("llm_provider") or "unknown").split("/")[0]
        provider_counts[p] = provider_counts.get(p, 0) + 1
    return {
        "total_segments": total_segments,
        "total_tracks": total_tracks,
        "total_questions": total_qs,
        "answered_questions": answered,
        "segments_by_kind": kinds,
        "segments_by_provider": provider_counts,
    }


# ----------------------- Ads / Monetization -----------------------
AD_TIERS = {
    "basic":    {"price_eur": 4.99,  "plays": 1,  "label": "Basic",    "desc": "Un passaggio spot in diretta"},
    "standard": {"price_eur": 14.99, "plays": 5,  "label": "Standard", "desc": "5 passaggi con posizione preferita"},
    "premium":  {"price_eur": 39.99, "plays": 20, "label": "Premium",  "desc": "20 passaggi + brand sponsor 'questa ora è offerta da…'"},
}


class AdCampaign(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    brand: str
    message: str
    tier: Literal["basic", "standard", "premium"] = "basic"
    price_eur: float = 4.99
    plays_total: int = 1
    plays_remaining: int = 1
    status: Literal["pending_payment", "active", "exhausted", "cancelled"] = "pending_payment"
    paypal_order_id: Optional[str] = None
    paypal_capture_id: Optional[str] = None
    script: Optional[str] = None
    audio_url: Optional[str] = None
    is_demo: bool = False
    contact_email: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)
    paid_at: Optional[str] = None


class AdCreateRequest(BaseModel):
    brand: str
    message: str
    tier: Literal["basic", "standard", "premium"] = "basic"
    contact_email: Optional[str] = None
    return_origin: str  # e.g. https://autoradio-ai.preview.emergentagent.com


@api_router.get("/ads/tiers")
async def ad_tiers():
    return {
        "tiers": AD_TIERS,
        "paypal_mode": paypal_service.current_mode(),
        "is_demo": paypal_service.is_demo(),
        "currency": "EUR",
    }


@api_router.post("/ads/create", response_model=AdCampaign)
async def create_ad(payload: AdCreateRequest):
    if payload.tier not in AD_TIERS:
        raise HTTPException(400, "Invalid tier")
    tier = AD_TIERS[payload.tier]
    camp = AdCampaign(
        brand=payload.brand.strip()[:60] or "Brand",
        message=payload.message.strip()[:400],
        tier=payload.tier,
        price_eur=tier["price_eur"],
        plays_total=tier["plays"],
        plays_remaining=tier["plays"],
        contact_email=(payload.contact_email or "").strip()[:120] or None,
        is_demo=paypal_service.is_demo(),
    )
    return_url = f"{payload.return_origin}/ads/return?campaign_id={camp.id}"
    cancel_url = f"{payload.return_origin}/pubblicita?cancelled=1"
    try:
        order_id, approval_url = await paypal_service.create_order(
            amount_eur=camp.price_eur,
            description=f"R-A.I. spot {tier['label']} — {camp.brand}",
            return_url=return_url,
            cancel_url=cancel_url,
        )
    except Exception as e:
        logger.error(f"PayPal create_order failed: {e}")
        raise HTTPException(502, "PayPal non disponibile")
    camp.paypal_order_id = order_id
    doc = camp.model_dump()
    doc["approval_url"] = approval_url
    await db.ad_campaigns.insert_one(camp.model_dump())
    return JSONResponse(doc)


@api_router.post("/ads/{campaign_id}/confirm")
async def confirm_ad(campaign_id: str):
    camp = await db.ad_campaigns.find_one({"id": campaign_id}, {"_id": 0})
    if not camp:
        raise HTTPException(404, "Campaign not found")
    if camp["status"] == "active":
        return camp

    try:
        capture = await paypal_service.capture_order(camp["paypal_order_id"])
    except Exception as e:
        logger.error(f"PayPal capture failed: {e}")
        raise HTTPException(502, "Errore nella conferma pagamento PayPal")

    status = (capture.get("status") or "").upper()
    if status != "COMPLETED":
        raise HTTPException(400, f"Pagamento non completato: {status}")

    capture_id = None
    try:
        capture_id = capture["purchase_units"][0]["payments"]["captures"][0]["id"]
    except Exception:
        pass

    # Generate the spot script via LLM
    provider, model = _pick_llm()
    system = "Sei uno speaker radiofonico italiano che scrive spot pubblicitari brevi e memorabili per una webradio AI di nome R-A.I.. Non usare emoji."
    prompt = (
        f"Scrivi uno spot pubblicitario radiofonico di massimo 40 parole per il brand '{camp['brand']}'. "
        f"Messaggio chiave del brand: {camp['message']}. "
        "Deve essere accattivante, chiudere con un invito all'azione forte, e chiaramente distinguibile come pubblicità. "
        "Inizia SEMPRE con 'Pubblicità.' e termina con il nome del brand."
    )
    script = await llm_generate(provider, model, system, prompt)
    if not script or not script.strip():
        script = f"Pubblicità. {camp['brand']} ti aspetta. {camp['message'][:120]} Scegli {camp['brand']}."

    # Try to synth audio via Bark (HD open source)
    audio_fname = None
    audio_subpath = None
    try:
        audio_fname, audio_subpath = await synth_speech(script.strip(), voice_key="male-1")
    except Exception as e:
        logger.warning(f"Ad TTS synth failed: {e}")

    audio_url = f"/api/{audio_subpath}/{audio_fname}" if audio_fname else None
    update = {
        "status": "active",
        "paypal_capture_id": capture_id,
        "script": script.strip(),
        "audio_url": audio_url,
        "paid_at": now_iso(),
    }
    await db.ad_campaigns.update_one({"id": campaign_id}, {"$set": update})
    camp.update(update)
    return camp


@api_router.get("/ads", response_model=List[AdCampaign])
async def list_ads(status: Optional[str] = None):
    q = {"status": status} if status else {}
    docs = await db.ad_campaigns.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    return docs


@api_router.get("/ads/next")
async def next_ad():
    doc = await db.ad_campaigns.find_one(
        {"status": "active", "plays_remaining": {"$gt": 0}},
        {"_id": 0},
        sort=[("tier", -1), ("created_at", 1)],  # premium tiers first alphabetically last
    )
    return doc or {}


@api_router.post("/ads/{campaign_id}/mark_played")
async def mark_played(campaign_id: str):
    doc = await db.ad_campaigns.find_one({"id": campaign_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    remaining = max(0, (doc.get("plays_remaining") or 0) - 1)
    new_status = "exhausted" if remaining == 0 else doc.get("status", "active")
    await db.ad_campaigns.update_one({"id": campaign_id}, {"$set": {"plays_remaining": remaining, "status": new_status}})
    return {"plays_remaining": remaining, "status": new_status}


@api_router.get("/ads/revenue")
async def ad_revenue():
    total = 0.0
    active_count = 0
    exhausted_count = 0
    demo_count = 0
    by_tier = {}
    async for c in db.ad_campaigns.find({}, {"_id": 0}):
        if c.get("status") in ("active", "exhausted"):
            total += float(c.get("price_eur") or 0)
            t = c.get("tier", "basic")
            by_tier[t] = by_tier.get(t, 0) + 1
        if c.get("status") == "active":
            active_count += 1
        if c.get("status") == "exhausted":
            exhausted_count += 1
        if c.get("is_demo"):
            demo_count += 1
    return {
        "total_revenue_eur": round(total, 2),
        "active_campaigns": active_count,
        "exhausted_campaigns": exhausted_count,
        "demo_campaigns": demo_count,
        "by_tier": by_tier,
        "currency": "EUR",
        "paypal_mode": paypal_service.current_mode(),
    }


@api_router.get("/ads/{campaign_id}/plays")
async def ad_plays(campaign_id: str):
    docs = await db.ad_plays.find({"campaign_id": campaign_id}, {"_id": 0}).sort("played_at", 1).to_list(500)
    # Bucket by hour of day
    hourly = {h: 0 for h in range(24)}
    for d in docs:
        ts = d.get("played_at", "")
        try:
            hour = datetime.fromisoformat(ts).hour
            hourly[hour] = hourly.get(hour, 0) + 1
        except Exception:
            pass
    # Bucket by day
    daily = {}
    for d in docs:
        ts = d.get("played_at", "")
        try:
            day = ts[:10]
            daily[day] = daily.get(day, 0) + 1
        except Exception:
            pass
    return {
        "campaign_id": campaign_id,
        "total_plays": len(docs),
        "hourly": [{"hour": h, "plays": hourly.get(h, 0)} for h in range(24)],
        "daily": [{"day": k, "plays": v} for k, v in sorted(daily.items())],
        "recent": docs[-20:],
    }


# ----------------------- Telegram integration -----------------------
@api_router.get("/telegram/status")
async def telegram_status():
    return telegram_bot.status()


# ----------------------- HD Audio (HF Spaces) -----------------------
@api_router.get("/audio/{filename}")
async def get_audio(filename: str):
    p = audio_path(filename)
    if not p:
        raise HTTPException(404, "Audio not found")
    return FileResponse(str(p), media_type="audio/wav")


async def _serve_local_audio(path: Path, media_type: str, range_header: Optional[str], extra_headers: dict):
    """Serve un file audio locale, onorando le richieste Range.

    FIX (ticket 220609, audio a scatti su cellulare): Starlette 0.37 (versione
    installata) NON implementa affatto il supporto Range in `FileResponse`,
    nonostante l'header `Accept-Ranges: bytes` dichiarato — ogni richiesta,
    con o senza header Range, riceve sempre il file intero con status 200
    (verificato dal vivo con curl). I browser mobile bufferizzano l'audio a
    piccole porzioni proprio tramite richieste Range: ricevendo sempre il
    file intero il buffer del dispositivo si svuota a metà riproduzione,
    causando gli scatti/interruzioni segnalati (più evidenti su Bluetooth).
    Qui implementiamo Range/206 a mano per i file già in cache locale — il
    percorso di gran lunga più comune, dato che quasi tutti i brani finiscono
    per essere cachati su disco dopo la prima riproduzione.
    """
    size = path.stat().st_size
    if not range_header:
        return FileResponse(str(path), media_type=media_type, headers=extra_headers)
    start, end = object_storage._parse_range(range_header, size)
    start = max(0, start)
    end = min(end, size - 1)
    if start > end or start >= size:
        headers = dict(extra_headers)
        headers["Content-Range"] = f"bytes */{size}"
        return Response(status_code=416, headers=headers)
    length = end - start + 1

    async def _gen():
        # Letture su thread separato: un read() bloccante nel loop asyncio
        # ritarda tutte le altre richieste in corso sullo stesso worker (altri
        # brani in preload, il poller del mixer, ecc.) — con più richieste
        # Range concorrenti (normali durante l'ascolto) questo si somma e
        # contribuisce ai micro-scatti.
        def _open_and_seek():
            fh = open(path, "rb")
            fh.seek(start)
            return fh
        f = await asyncio.to_thread(_open_and_seek)
        try:
            remaining = length
            while remaining > 0:
                chunk = await asyncio.to_thread(f.read, min(65536, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk
        finally:
            f.close()

    headers = dict(extra_headers)
    headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    headers["Content-Length"] = str(length)
    return StreamingResponse(_gen(), status_code=206, media_type=media_type, headers=headers)


@api_router.get("/tts/{filename}")
async def get_tts_audio(filename: str, request: Request):
    p = elevenlabs_service.tts_path(filename)
    if p:
        return await _serve_local_audio(
            p, "audio/mpeg", request.headers.get("range"),
            {"Cache-Control": "public, max-age=604800", "Accept-Ranges": "bytes"},
        )
    # Local miss → STREAM immediato dall'Object Storage con cache lazy locale.
    if object_storage.is_enabled():
        # Determina dove salvare la cache locale (best-effort)
        cache_dir = elevenlabs_service.tts_dir()
        cache_to = str(cache_dir / filename) if cache_dir else None
        streamed = await object_storage.stream_mp3(
            f"tts/{filename}", cache_to=cache_to, range_header=request.headers.get("range")
        )
        if streamed:
            gen, content_length, status_code, content_range = streamed
            headers = {
                "Cache-Control": "public, max-age=604800",
                "Accept-Ranges": "bytes",
            }
            if content_length:
                headers["Content-Length"] = content_length
            if content_range:
                headers["Content-Range"] = content_range
            return StreamingResponse(gen, status_code=status_code, media_type="audio/mpeg", headers=headers)
    raise HTTPException(404, "TTS audio not found")


# ============================================================
# "A.I. Vs UMANI" — Upload community brani utente
# ============================================================
class CommunityTrack(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    author: str
    title: str
    audio_url: str
    file_size: int
    tag: str = "AI-Vs-Umani"
    status: str = "off"          # "off" | "on"
    copyright_ok: bool = True
    is_night: bool = False       # v12.13: brano riservato al Club Night (22-04)
    play_count: int = 0          # v12.14: contatore ascolti visibile sul Wall
    submitted_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


def _validate_mp3_bytes(data: bytes) -> bool:
    """Magic-bytes check: MP3 files start with ID3 tag (49 44 33) OR MPEG
    audio frame sync (FF Fx). Rifiuta tutto il resto (WAV/M4A/exe rinominati)."""
    if not data or len(data) < 128:
        return False
    if data[:3] == b"ID3":
        return True
    # MPEG frame sync: byte0=0xFF, byte1 & 0xE0 == 0xE0
    if data[0] == 0xFF and (data[1] & 0xE0) == 0xE0:
        return True
    return False


@api_router.post("/community/submit")
async def community_submit(
    author: str = Form(...),
    title: str = Form(...),
    copyright_ok: bool = Form(...),
    file: UploadFile = File(...),
):
    """Upload pubblico "A.I. Vs Umani". Accetta SOLO MP3 <= 15MB.
    Salva su disco + Object Storage (se attivo). Status default = OFF —
    l'admin lo attiva dal pannello Community.
    """
    author = (author or "").strip()
    title = (title or "").strip()
    if not author or len(author) < 2 or len(author) > 60:
        raise HTTPException(400, "Nome autore obbligatorio (2-60 caratteri)")
    if not title or len(title) < 2 or len(title) > 100:
        raise HTTPException(400, "Titolo obbligatorio (2-100 caratteri)")
    if not copyright_ok:
        raise HTTPException(400, "Devi confermare la dichiarazione di copyright")
    fname_lower = (file.filename or "").lower()
    if not fname_lower.endswith(".mp3"):
        raise HTTPException(400, "Solo file .mp3 sono accettati")

    data = await file.read()
    size = len(data)
    if size < 10_000:
        raise HTTPException(400, "File troppo piccolo o vuoto")
    if size > 15 * 1024 * 1024:  # 15 MB cap richiesto dall'utente
        raise HTTPException(400, "File troppo grande (max 15 MB)")
    if not _validate_mp3_bytes(data):
        raise HTTPException(400, "Il file non risulta essere un MP3 valido (magic bytes check fallito)")

    track = CommunityTrack(
        author=author,
        title=title,
        audio_url="",  # will be set below
        file_size=size,
        copyright_ok=True,
        status="off",
    )
    local_name = f"community_{track.id}.mp3"
    # PRIMARY STORAGE: Emergent Object Storage. Local disk only as lazy cache
    # populated by GET /api/community_audio/{name} on first read.
    if not object_storage.is_enabled():
        raise HTTPException(503, "Object Storage disabilitato: impossibile ricevere il brano")
    stored_path = await object_storage.put_mp3(f"community/{local_name}", data)
    if not stored_path:
        raise HTTPException(502, "Upload su Object Storage fallito")

    track.audio_url = f"/api/community_audio/{local_name}"
    await db.community_tracks.insert_one(track.model_dump())
    logger.info(f"Community track submitted: {track.id} by '{author}' — '{title}' ({size} bytes)")
    return {"ok": True, "id": track.id, "message": "Brano ricevuto! Sarà valutato dall'admin."}


@api_router.get("/community_audio/{filename}")
async def get_community_audio(filename: str, request: Request):
    """Serve gli MP3 caricati dalla community (con range requests).
    Verifica PRIMA che esista un record DB corrispondente — se il brano è
    stato eliminato dall'admin, restituisce 404 anche se il file è ancora
    sull'Object Storage (evita accessi a contenuti revocati)."""
    if "/" in filename or ".." in filename or not filename.endswith(".mp3"):
        raise HTTPException(400, "Invalid filename")
    # Attendo prefisso `community_{track_id}.mp3` come impostato da submit
    if not filename.startswith("community_"):
        raise HTTPException(404, "Not found")
    track_id = filename[len("community_"):-len(".mp3")]
    exists = await db.community_tracks.count_documents({"id": track_id}, limit=1)
    if not exists:
        raise HTTPException(404, "Community track not found (removed or never existed)")
    p = COMMUNITY_AUDIO_DIR / filename
    if p.exists():
        return await _serve_local_audio(
            p, "audio/mpeg", request.headers.get("range"),
            {"Cache-Control": "public, max-age=604800", "Accept-Ranges": "bytes"},
        )
    if object_storage.is_enabled():
        streamed = await object_storage.stream_mp3(
            f"community/{filename}", cache_to=str(p), range_header=request.headers.get("range")
        )
        if streamed:
            gen, content_length, status_code, content_range = streamed
            headers = {
                "Cache-Control": "public, max-age=604800",
                "Accept-Ranges": "bytes",
            }
            if content_length:
                headers["Content-Length"] = content_length
            if content_range:
                headers["Content-Range"] = content_range
            return StreamingResponse(gen, status_code=status_code, media_type="audio/mpeg", headers=headers)
    raise HTTPException(404, "Community audio not found")


@api_router.get("/admin/community")
async def admin_community_list():
    """Lista tutti i brani della community per l'admin."""
    tracks = await db.community_tracks.find({}, {"_id": 0}).sort("submitted_at", -1).to_list(500)
    return {"tracks": tracks, "total": len(tracks)}


@api_router.patch("/admin/community/{track_id}/toggle")
async def admin_community_toggle(track_id: str):
    """Toggle ON/OFF di un brano community."""
    t = await db.community_tracks.find_one({"id": track_id})
    if not t:
        raise HTTPException(404, "Brano community non trovato")
    new_status = "on" if t.get("status") != "on" else "off"
    await db.community_tracks.update_one({"id": track_id}, {"$set": {"status": new_status}})
    return {"ok": True, "id": track_id, "status": new_status}


@api_router.delete("/admin/community/{track_id}")
async def admin_community_delete(track_id: str):
    """Elimina brano community (record + file locale + object storage)."""
    t = await db.community_tracks.find_one({"id": track_id})
    if not t:
        raise HTTPException(404, "Brano community non trovato")
    local_name = f"community_{track_id}.mp3"
    local_path = COMMUNITY_AUDIO_DIR / local_name
    try:
        if local_path.exists():
            local_path.unlink()
    except Exception as e:  # noqa: BLE001
        logger.warning(f"Failed to delete local community file: {e}")
    # NOTA: object_storage non espone un `delete_object` — il file resta sul
    # bucket ma non è più raggiungibile perché il record DB è cancellato.
    # (Se serve in futuro pulire i bucket, aggiungere `delete_object` in
    # object_storage.py e chiamarlo qui.)
    await db.community_tracks.delete_one({"id": track_id})
    return {"ok": True, "deleted": track_id}


@api_router.patch("/admin/community/{track_id}/night")
async def admin_community_night_toggle(track_id: str, payload: dict):
    """Marca/smarca un brano community come 'notturno' (Club Night 22-04)."""
    is_night = bool(payload.get("is_night"))
    r = await db.community_tracks.update_one(
        {"id": track_id}, {"$set": {"is_night": is_night}}
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Brano community non trovato")
    return {"ok": True, "id": track_id, "is_night": is_night}


# ============================================================
# Config "A.I. Vs Umani": frequenza + jingles (intro + outro CTA)
# ============================================================
@api_router.get("/admin/community/config")
async def admin_community_config_get():
    st = await db.station.find_one({"_id": "state"}) or {}
    return {
        "frequency": int(st.get("community_frequency") or 0),  # 0 = disabilitato
        "intro_jingle_url": st.get("community_intro_jingle_url") or None,
        "outro_jingle_url": st.get("community_outro_jingle_url") or None,
        "songs_since_community": int(st.get("songs_since_community") or 0),
    }


@api_router.patch("/admin/community/config")
async def admin_community_config_set(payload: dict):
    """Aggiorna la frequenza community. 0 = disabilita l'iniezione nel palinsesto."""
    freq = payload.get("frequency")
    if freq is None:
        raise HTTPException(400, "frequency mancante")
    try:
        freq = max(0, min(50, int(freq)))
    except Exception:
        raise HTTPException(400, "frequency deve essere un intero 0-50")
    await db.station.update_one(
        {"_id": "state"},
        {"$set": {"community_frequency": freq}},
        upsert=True,
    )
    return {"ok": True, "frequency": freq}


async def _save_community_jingle(role: str, file: UploadFile) -> str:
    """Salva un jingle di ruolo 'intro' o 'outro' su disco + object storage,
    aggiorna il record station.state con l'URL. Ritorna l'URL pubblico."""
    if role not in ("intro", "outro"):
        raise HTTPException(400, "role deve essere 'intro' o 'outro'")
    fname_lower = (file.filename or "").lower()
    if not fname_lower.endswith(".mp3"):
        raise HTTPException(400, "Solo file .mp3 sono accettati")
    data = await file.read()
    if len(data) < 5_000:
        raise HTTPException(400, "File troppo piccolo")
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(400, "Jingle troppo grande (max 5 MB)")
    if not _validate_mp3_bytes(data):
        raise HTTPException(400, "Il file non risulta essere un MP3 valido")
    local_name = f"community_jingle_{role}.mp3"
    # PRIMARY STORAGE: Emergent Object Storage.
    if not object_storage.is_enabled():
        raise HTTPException(503, "Object Storage disabilitato: impossibile salvare jingle")
    stored_path = await object_storage.put_mp3(f"community/{local_name}", data)
    if not stored_path:
        raise HTTPException(502, "Upload su Object Storage fallito")
    url = f"/api/community_jingle/{local_name}"
    field = f"community_{role}_jingle_url"
    await db.station.update_one({"_id": "state"}, {"$set": {field: url}}, upsert=True)
    logger.info(f"Community jingle {role} saved: {url}")
    return url


@api_router.post("/admin/community/config/jingle_intro")
async def admin_community_upload_intro_jingle(file: UploadFile = File(...)):
    url = await _save_community_jingle("intro", file)
    return {"ok": True, "url": url, "role": "intro"}


@api_router.post("/admin/community/config/jingle_outro")
async def admin_community_upload_outro_jingle(file: UploadFile = File(...)):
    url = await _save_community_jingle("outro", file)
    return {"ok": True, "url": url, "role": "outro"}


@api_router.get("/community_jingle/{filename}")
async def get_community_jingle_public(filename: str, request: Request):
    """Endpoint speciale per servire i jingle community — bypass del check DB
    di /community_audio/ (che è per i brani utente). I jingle sono hardcoded
    per nome (community_jingle_intro.mp3, community_jingle_outro.mp3)."""
    if filename not in ("community_jingle_intro.mp3", "community_jingle_outro.mp3"):
        raise HTTPException(404, "Not found")
    p = COMMUNITY_AUDIO_DIR / filename
    if p.exists():
        return await _serve_local_audio(
            p, "audio/mpeg", request.headers.get("range"),
            {"Cache-Control": "public, max-age=604800", "Accept-Ranges": "bytes"},
        )
    if object_storage.is_enabled():
        streamed = await object_storage.stream_mp3(
            f"community/{filename}", cache_to=str(p), range_header=request.headers.get("range")
        )
        if streamed:
            gen, content_length, status_code, content_range = streamed
            headers = {"Cache-Control": "public, max-age=604800", "Accept-Ranges": "bytes"}
            if content_length:
                headers["Content-Length"] = content_length
            if content_range:
                headers["Content-Range"] = content_range
            return StreamingResponse(gen, status_code=status_code, media_type="audio/mpeg", headers=headers)
    raise HTTPException(404, "Community jingle not found")


# ============================================================
# REGIA AUDIO — Mixer + Crossfade + Beds (sottofondi loop)
# ============================================================
BEDS_DIR = Path("/app/backend/static/beds")
BEDS_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_MIX = {
    "music_vol": 100,      # 0-100 (%)
    "voice_vol": 100,
    "bed_vol": 40,
    "master_vol": 100,
    "crossfade_ms": 1000,  # 0-5000
}


@api_router.get("/station/mix")
async def get_station_mix():
    """Endpoint pubblico letto ~2s dal radioEngine per applicare i volumi
    in tempo reale. Cache-Control: no-store per garantire freschezza."""
    st = await db.station.find_one({"_id": "state"}) or {}
    mix = {k: st.get(f"mix_{k}", v) if k != "crossfade_ms" else st.get("crossfade_ms", v)
           for k, v in DEFAULT_MIX.items()}
    active_bed_url = st.get("active_bed_url") or None
    return {**mix, "active_bed_url": active_bed_url}


@api_router.get("/admin/fm-mode")
async def get_fm_mode():
    """Stato del toggle master FM_MODE (Radio Vera vs Economy).
    Default: OFF ad ogni avvio (reset dallo startup event)."""
    st = await db.station.find_one({"_id": "state"}, {"fm_mode": 1}) or {}
    return {
        "fm_mode": bool(st.get("fm_mode")),
        "note": "ON = Claude Sonnet 4.5 + ElevenLabs HD (Radio Vera). OFF = Gemini Flash + OpenAI TTS (Economy).",
    }


@api_router.patch("/admin/fm-mode")
async def set_fm_mode(payload: dict):
    """Toggle master FM_MODE runtime. Salva in station.state.fm_mode."""
    enabled = bool(payload.get("enabled"))
    await db.station.update_one({"_id": "state"}, {"$set": {"fm_mode": enabled}}, upsert=True)
    logger.info(f"[FM_MODE] set to {'ON' if enabled else 'OFF'} via API")
    return {"ok": True, "fm_mode": enabled}


# ============================================================================
# v13.7 · AI MASTER CONTROL — 7 interruttori indipendenti per controllo costi
# ============================================================================
# Ogni toggle è un booleano in station.state, default OFF ad ogni startup
# (safety-first). Il server consulta questi stati PRIMA di ogni chiamata API
# o file upload. Cache breve in-process per evitare roundtrip Mongo su ogni
# generazione LLM/TTS.
_AI_CONTROLS_KEYS = [
    "ai_suno_engine",       # generazione automatica musica via Suno API
    "ai_openai_talk",       # interventi parlati base (OpenAI TTS)
    "ai_claude_brain",      # ragionamento d'élite Claude (FM Mode LLM premium)
    "ai_voice_to_air",      # microfono ascoltatori + Whisper + broadcast
    "ai_atmospheric_fx",    # beds + fx automatici nei segmenti
    "ai_advertising",       # rotazione spot pubblicitari
    "ai_human_priority",    # precedenza ai brani caricati da utenti
]

_ai_controls_cache: dict = {"ts": 0.0, "data": None}


async def _get_ai_controls() -> dict:
    """Cache in-process 3s per non martellare Mongo su ogni segmento."""
    import time
    now = time.time()
    if _ai_controls_cache["data"] is not None and (now - _ai_controls_cache["ts"]) < 3.0:
        return _ai_controls_cache["data"]
    proj = {k: 1 for k in _AI_CONTROLS_KEYS}
    st = await db.station.find_one({"_id": "state"}, proj) or {}
    data = {k: bool(st.get(k)) for k in _AI_CONTROLS_KEYS}
    _ai_controls_cache["ts"] = now
    _ai_controls_cache["data"] = data
    return data


def _invalidate_ai_controls_cache():
    _ai_controls_cache["ts"] = 0.0
    _ai_controls_cache["data"] = None


@api_router.get("/admin/ai-controls")
async def get_ai_controls():
    """Stato dei 7 interruttori AI. Default OFF ad ogni avvio."""
    data = await _get_ai_controls()
    return {
        "controls": data,
        "labels": {
            "ai_suno_engine":    "🎵 SUNO ENGINE",
            "ai_openai_talk":    "🎙️ OPENAI TALK",
            "ai_claude_brain":   "🧠 CLAUDE BRAIN",
            "ai_voice_to_air":   "🎙️ VOICE-TO-AIR",
            "ai_atmospheric_fx": "🌀 ATMOSPHERIC FX",
            "ai_advertising":    "💰 ADVERTISING LOOP",
            "ai_human_priority": "⚖️ HUMAN PRIORITY",
        },
        "descriptions": {
            "ai_suno_engine":    "Generazione automatica di musica via Suno API",
            "ai_openai_talk":    "Interventi parlate base (Economy Mode)",
            "ai_claude_brain":   "Ragionamento d'élite per i DJ (FM Mode)",
            "ai_voice_to_air":   "Microfono ascoltatori + Whisper + messa in onda",
            "ai_atmospheric_fx": "Transizioni e sottofondi sonori automatici",
            "ai_advertising":    "Programmazione degli spot pubblicitari",
            "ai_human_priority": "Precedenza immediata ai brani caricati dagli utenti",
        },
    }


@api_router.patch("/admin/ai-controls")
async def set_ai_controls(payload: dict):
    """Aggiorna uno o più toggle. Body: {ai_suno_engine: true, ...}."""
    updates = {}
    for k in _AI_CONTROLS_KEYS:
        if k in payload:
            updates[k] = bool(payload[k])
    if not updates:
        raise HTTPException(400, "Nessun toggle valido")
    await db.station.update_one({"_id": "state"}, {"$set": updates}, upsert=True)
    _invalidate_ai_controls_cache()
    logger.info(f"[ai-controls] updated: {updates}")
    return {"ok": True, "updated": updates}





@api_router.get("/admin/tts/provider")
async def get_tts_provider():
    st = await db.station.find_one({"_id": "state"}) or {}
    # Default v12.11+: smart (ElevenLabs solo per answer)
    return {"provider": (st.get("tts_provider") or "smart").lower()}


@api_router.patch("/admin/tts/provider")
async def set_tts_provider(payload: dict):
    """Toggle runtime della sorgente voce.
    Accetta {'provider': 'elevenlabs'|'openai'|'smart'}.
    - 'elevenlabs' : sempre ElevenLabs HD
    - 'openai'     : sempre OpenAI TTS-1-HD (Universal Key)
    - 'smart'      : ElevenLabs SOLO per le risposte agli ascoltatori (kind=answer),
                     OpenAI TTS-1-HD per tutti gli altri segmenti (default)."""
    prov = (payload.get("provider") or "").lower().strip()
    if prov not in ("elevenlabs", "openai", "smart"):
        raise HTTPException(400, "provider deve essere 'elevenlabs', 'openai' o 'smart'")
    await db.station.update_one({"_id": "state"}, {"$set": {"tts_provider": prov}}, upsert=True)
    return {"ok": True, "provider": prov}


@api_router.patch("/admin/mix")
async def set_station_mix(payload: dict):
    """Aggiorna i volumi del mixer + crossfade. Payload accetta solo i campi
    validi; ignora il resto. Ogni valore è clampato al range [0, 100] tranne
    crossfade_ms che è [0, 5000]."""
    updates = {}
    for k in ("music_vol", "voice_vol", "bed_vol", "master_vol"):
        if k in payload:
            try:
                v = max(0, min(100, int(payload[k])))
                updates[f"mix_{k}"] = v
            except Exception:
                raise HTTPException(400, f"{k} deve essere int 0-100")
    if "crossfade_ms" in payload:
        try:
            v = max(0, min(5000, int(payload["crossfade_ms"])))
            updates["crossfade_ms"] = v
        except Exception:
            raise HTTPException(400, "crossfade_ms deve essere int 0-5000")
    if not updates:
        raise HTTPException(400, "Nessun campo valido nel payload")
    await db.station.update_one({"_id": "state"}, {"$set": updates}, upsert=True)
    return {"ok": True, "updated": list(updates.keys())}


@api_router.post("/admin/beds/upload")
async def upload_bed(file: UploadFile = File(...), name: str = Form("")):
    """Upload di un loop musicale (sottofondo). MP3 <= 10MB."""
    if not (file.filename or "").lower().endswith(".mp3"):
        raise HTTPException(400, "Solo file .mp3")
    data = await file.read()
    if len(data) < 5000:
        raise HTTPException(400, "File troppo piccolo")
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(400, "Bed troppo grande (max 10 MB)")
    if not _validate_mp3_bytes(data):
        raise HTTPException(400, "File non riconosciuto come MP3")
    bed_id = str(uuid.uuid4())
    local_name = f"bed_{bed_id}.mp3"
    # PRIMARY STORAGE: Emergent Object Storage.
    if not object_storage.is_enabled():
        raise HTTPException(503, "Object Storage disabilitato: impossibile salvare bed")
    stored_path = await object_storage.put_mp3(f"beds/{local_name}", data)
    if not stored_path:
        raise HTTPException(502, "Upload su Object Storage fallito")
    display_name = (name or file.filename or "Bed").strip()[:60]
    doc = {
        "id": bed_id,
        "name": display_name,
        "audio_url": f"/api/beds/{local_name}",
        "file_size": len(data),
        "uploaded_at": now_iso(),
    }
    await db.beds.insert_one(doc)
    doc.pop("_id", None)
    return {"ok": True, "bed": doc}


@api_router.get("/admin/beds")
async def list_beds():
    beds = await db.beds.find({}, {"_id": 0}).sort("uploaded_at", -1).to_list(100)
    st = await db.station.find_one({"_id": "state"}) or {}
    return {"beds": beds, "active_bed_url": st.get("active_bed_url")}


@api_router.patch("/admin/beds/{bed_id}/activate")
async def activate_bed(bed_id: str):
    bed = await db.beds.find_one({"id": bed_id})
    if not bed:
        raise HTTPException(404, "Bed non trovato")
    await db.station.update_one(
        {"_id": "state"},
        {"$set": {"active_bed_url": bed["audio_url"]}},
        upsert=True,
    )
    return {"ok": True, "active_bed_url": bed["audio_url"]}


@api_router.delete("/admin/beds/{bed_id}")
async def delete_bed(bed_id: str):
    bed = await db.beds.find_one({"id": bed_id})
    if not bed:
        raise HTTPException(404, "Bed non trovato")
    local_name = f"bed_{bed_id}.mp3"
    try:
        p = BEDS_DIR / local_name
        if p.exists():
            p.unlink()
    except Exception:
        pass
    await db.beds.delete_one({"id": bed_id})
    # Se stavamo usando questo bed come active, svuota il puntatore
    await db.station.update_one(
        {"_id": "state", "active_bed_url": bed["audio_url"]},
        {"$unset": {"active_bed_url": ""}},
    )
    return {"ok": True, "deleted": bed_id}


@api_router.patch("/admin/beds/deactivate")
async def deactivate_bed():
    await db.station.update_one({"_id": "state"}, {"$unset": {"active_bed_url": ""}}, upsert=True)
    return {"ok": True}


@api_router.get("/beds/{filename}")
async def get_bed(filename: str, request: Request):
    if "/" in filename or ".." in filename or not filename.endswith(".mp3"):
        raise HTTPException(400, "Invalid filename")
    p = BEDS_DIR / filename
    if p.exists():
        return await _serve_local_audio(
            p, "audio/mpeg", request.headers.get("range"),
            {"Cache-Control": "public, max-age=604800", "Accept-Ranges": "bytes"},
        )
    if object_storage.is_enabled():
        streamed = await object_storage.stream_mp3(
            f"beds/{filename}", cache_to=str(p), range_header=request.headers.get("range")
        )
        if streamed:
            gen, content_length, status_code, content_range = streamed
            headers = {"Cache-Control": "public, max-age=604800", "Accept-Ranges": "bytes"}
            if content_length:
                headers["Content-Length"] = content_length
            if content_range:
                headers["Content-Range"] = content_range
            return StreamingResponse(gen, status_code=status_code, media_type="audio/mpeg", headers=headers)
    raise HTTPException(404, "Bed audio not found")


@api_router.get("/suno_audio/{filename}")
async def get_suno_audio(filename: str, request: Request):
    """Serve Suno MP3s. Local cache priority; on miss stream direttamente dal
    bucket con populamento lazy della cache — nessun download completo prima
    di rispondere (latenza tipo TTFB ~200ms invece di 3-8s)."""
    # Defensive: reject path traversal / weird filenames.
    if "/" in filename or ".." in filename or not filename.endswith(".mp3"):
        raise HTTPException(400, "Invalid filename")
    p = SUNO_AUDIO_DIR / filename
    if p.exists():
        return await _serve_local_audio(
            p, "audio/mpeg", request.headers.get("range"),
            {"Cache-Control": "public, max-age=604800", "Accept-Ranges": "bytes"},  # 7 days
        )
    # Local miss → STREAM direttamente dall'Object Storage senza aspettare
    # il download completo. La cache locale viene popolata in background.
    if object_storage.is_enabled():
        streamed = await object_storage.stream_mp3(
            f"suno/{filename}", cache_to=str(p), range_header=request.headers.get("range")
        )
        if streamed:
            gen, content_length, status_code, content_range = streamed
            headers = {
                "Cache-Control": "public, max-age=604800",
                "Accept-Ranges": "bytes",
            }
            if content_length:
                headers["Content-Length"] = content_length
            if content_range:
                headers["Content-Range"] = content_range
            return StreamingResponse(gen, status_code=status_code, media_type="audio/mpeg", headers=headers)
    raise HTTPException(404, "Suno audio not found")


@api_router.post("/admin/migrate_suno_audio")
async def admin_migrate_suno_audio(limit: int = 200):
    """One-shot migration: download every Suno track whose audio_url still points
    to the external CDN and rewrite it to the local /api/suno_audio/... path.
    """
    tracks = await db.tracks.find(
        {
            "source": "suno",
            "status": "ready",
            "audio_url": {"$regex": "^https?://"},
        },
        {"_id": 0},
    ).to_list(limit)
    migrated, failed = 0, []
    for t in tracks:
        tid = t.get("id")
        url = t.get("audio_url")
        local_url = await download_and_save_suno_audio(url, tid)
        if local_url:
            await db.tracks.update_one(
                {"id": tid},
                {"$set": {
                    "audio_url": local_url,
                    "original_audio_url": url,
                    "downloaded_at": now_iso(),
                }},
            )
            migrated += 1
        else:
            failed.append({"id": tid, "title": t.get("title")})
    return {"migrated": migrated, "failed_count": len(failed), "failed": failed, "scanned": len(tracks)}


@api_router.post("/segments/{seg_id}/render_hd")
async def render_segment_hd(seg_id: str):
    """Generate real AI audio (Bark speech + Stable Audio music) for a segment."""
    seg = await db.segments.find_one({"id": seg_id}, {"_id": 0})
    if not seg:
        raise HTTPException(404, "Segment not found")

    await db.segments.update_one({"id": seg_id}, {"$set": {"hd_status": "rendering"}})
    speech_url = None
    music_url = None
    try:
        # Speech (ElevenLabs preferred, Bark fallback)
        if seg.get("script"):
            fname, subpath = await synth_speech(seg["script"], seg.get("voice_key") or "female-1")
            if fname:
                speech_url = f"/api/{subpath}/{fname}"
        # Music (Stable Audio) only for music segments
        if seg.get("kind") == "music" and seg.get("track_meta"):
            tm = seg["track_meta"]
            prompt = f"{tm.get('genre','electronic')} {tm.get('mood','')} music, {tm.get('title','')}"
            fname = await synth_music(prompt, seconds=15)
            if fname:
                music_url = f"/api/audio/{fname}"

        status = "ready" if (speech_url or music_url) else "failed"
        update = {"hd_status": status}
        if speech_url:
            update["speech_audio_url"] = speech_url
        if music_url:
            update["music_audio_url"] = music_url
        await db.segments.update_one({"id": seg_id}, {"$set": update})
        cleanup_old(120)
        seg.update(update)
        return seg
    except Exception as e:
        logger.error(f"HD render failed for {seg_id}: {e}")
        await db.segments.update_one({"id": seg_id}, {"$set": {"hd_status": "failed"}})
        raise HTTPException(500, str(e))


@api_router.delete("/admin/tracks/{track_id}")
async def admin_delete_track(track_id: str):
    """SOFT DELETE — sposta nel cestino. Il record resta 30 giorni con
    `deleted_at` valorizzato, poi viene rimosso definitivamente dal job
    di auto-clean. Fino ad allora è ripristinabile via `.../restore`."""
    r = await db.tracks.update_one(
        {"id": track_id, "deleted_at": None},
        {"$set": {"deleted_at": now_iso()}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Track non trovata (o già nel cestino)")
    return {"ok": True, "moved_to_trash": track_id}


@api_router.post("/admin/tracks/{track_id}/restore")
async def admin_restore_track(track_id: str):
    """Ripristina una traccia dal cestino (UNDO). Se già ripristinata, no-op."""
    r = await db.tracks.update_one(
        {"id": track_id, "deleted_at": {"$ne": None}},
        {"$set": {"deleted_at": None}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Track non nel cestino")
    return {"ok": True, "restored": track_id}


@api_router.get("/admin/tracks/trash")
async def admin_trash_list():
    """Elenca le tracce nel cestino (deleted_at ≠ null)."""
    rows = await db.tracks.find(
        {"deleted_at": {"$ne": None}},
        {"_id": 0, "id": 1, "title": 1, "artist": 1, "source": 1,
         "duration_sec": 1, "audio_url": 1, "deleted_at": 1, "kind": 1},
    ).sort("deleted_at", -1).limit(200).to_list(200)
    return {"trash": rows, "count": len(rows)}


@api_router.delete("/admin/tracks/{track_id}/purge-trash")
async def admin_purge_trash_track(track_id: str):
    """HARD DELETE definitivo (usare con cautela). Solo per tracce già nel cestino."""
    r = await db.tracks.delete_one({"id": track_id, "deleted_at": {"$ne": None}})
    return {"ok": r.deleted_count > 0}


@api_router.delete("/admin/tracks/{track_id}/purge")
async def admin_purge_track(track_id: str):
    """CANCELLA DEFINITIVAMENTE (bypassa cestino). Rimuove file locale."""
    t = await db.tracks.find_one({"id": track_id})
    if not t:
        raise HTTPException(404, "Track non trovata")
    audio_url = t.get("audio_url") or ""
    if audio_url and audio_url.startswith("/api/"):
        try:
            parts = audio_url.split("/")
            if len(parts) >= 4:
                subdir = parts[2]
                fname = parts[3]
                base = None
                if subdir == "suno_audio": base = SUNO_AUDIO_DIR
                elif subdir == "audio":    base = AUDIO_DIR
                elif subdir == "community_audio": base = COMMUNITY_AUDIO_DIR
                if base:
                    fp = Path(base) / fname
                    if fp.exists():
                        fp.unlink()
        except Exception as e:
            logger.warning(f"Track file cleanup failed for {track_id}: {e}")
    await db.tracks.delete_one({"id": track_id})
    return {"ok": True, "purged": track_id}


@api_router.get("/admin/tracks/trash")
async def admin_list_trash():
    """Lista tracce nel cestino (soft-deleted). Ordine per data eliminazione."""
    docs = await db.tracks.find(
        {"deleted_at": {"$ne": None}}, {"_id": 0},
        sort=[("deleted_at", -1)]
    ).to_list(500)
    return {"tracks": docs, "count": len(docs)}


@api_router.post("/admin/trash/auto-clean")
async def admin_trash_autoclean(payload: dict = None):
    """Rimuove definitivamente le tracce nel cestino da più di N giorni
    (default 30). Chiamabile manualmente o via cron esterno."""
    days = int((payload or {}).get("days") or 30)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    old = await db.tracks.find(
        {"deleted_at": {"$ne": None, "$lt": cutoff}}, {"id": 1, "audio_url": 1}
    ).to_list(1000)
    purged_ids = []
    for t in old:
        try:
            audio_url = t.get("audio_url") or ""
            if audio_url.startswith("/api/"):
                parts = audio_url.split("/")
                if len(parts) >= 4:
                    subdir, fname = parts[2], parts[3]
                    base = {"suno_audio": SUNO_AUDIO_DIR, "audio": AUDIO_DIR,
                            "community_audio": COMMUNITY_AUDIO_DIR}.get(subdir)
                    if base:
                        fp = Path(base) / fname
                        if fp.exists(): fp.unlink()
        except Exception as e:
            logger.warning(f"Auto-clean cleanup skipped for {t.get('id')}: {e}")
        purged_ids.append(t.get("id"))
    if purged_ids:
        await db.tracks.delete_many({"id": {"$in": purged_ids}})
    return {"ok": True, "days_cutoff": days, "purged_count": len(purged_ids), "purged_ids": purged_ids}


@api_router.patch("/admin/tracks/{track_id}/genre")
async def admin_set_track_genre(track_id: str, payload: dict):
    """Assegna categoria Archivio Pro: pop|rock|hiphop|dance|relax|ambient|varie.

    Scrive in `genre_category`, NON in `genre` — `genre` resta il testo libero
    (spesso con BPM) usato per display/prompting e non va sovrascritto da
    questa categorizzazione (bug precedente: sovrascriveva `genre` perdendo
    il BPM e rendendo il Track non validabile da pydantic).
    """
    g = (payload.get("genre") or "").lower().strip() or None
    ALLOWED = {None, "pop", "rock", "hiphop", "dance", "relax", "ambient", "varie"}
    if g not in ALLOWED:
        raise HTTPException(400, f"Genre non valido. Usa uno di: {ALLOWED - {None}}")
    r = await db.tracks.update_one({"id": track_id}, {"$set": {"genre_category": g}})
    if r.matched_count == 0:
        raise HTTPException(404, "Track non trovata")
    return {"ok": True, "id": track_id, "genre_category": g}


@api_router.patch("/admin/tracks/{track_id}/bpm")
async def admin_set_track_bpm(track_id: str, payload: dict):
    """Salva BPM sulla traccia. `source` ∈ {client,server,manual}. Se il
    valore è null o assente, azzera BPM."""
    bpm = payload.get("bpm")
    source = (payload.get("source") or "client").lower()
    if source not in ("client", "server", "manual"):
        raise HTTPException(400, "source deve essere client|server|manual")
    if bpm is None or bpm == "":
        updates = {"bpm": None, "bpm_source": None}
    else:
        try:
            bpm_int = int(round(float(bpm)))
        except Exception:
            raise HTTPException(400, "bpm deve essere numerico")
        if bpm_int < 40 or bpm_int > 220:
            raise HTTPException(400, "bpm fuori range plausibile (40-220)")
        updates = {"bpm": bpm_int, "bpm_source": source}
    r = await db.tracks.update_one({"id": track_id}, {"$set": updates})
    if r.matched_count == 0:
        raise HTTPException(404, "Track non trovata")
    return {"ok": True, **updates}


# ---- WHISPER · Trascrizione vocale (chat neurale mic) ----
@api_router.post("/voice/transcribe")
async def voice_transcribe(file: UploadFile = File(...), lang: Optional[str] = Form("it"), name: Optional[str] = Form(None)):
    """Trascrive un vocale via OpenAI Whisper e (best-effort) lo salva su
    /app/backend/static/voice + collection `voice_messages` con status=pending.
    Ritorna {text, id, audio_url}."""
    # v13.7 · Gate AI Master Control: se VOICE-TO-AIR è OFF blocca la funzione
    _ai = await _get_ai_controls()
    if not _ai.get("ai_voice_to_air"):
        raise HTTPException(403, "Voice-to-Air disabilitato dal Master Control della Regia")
    if not file:
        raise HTTPException(400, "File mancante")
    data = await file.read()
    if not data:
        raise HTTPException(400, "File vuoto")
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(413, "File > 25MB")
    try:
        from emergentintegrations.llm.openai import OpenAISpeechToText  # type: ignore
    except Exception:
        raise HTTPException(500, "STT provider non disponibile")
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(500, "EMERGENT_LLM_KEY mancante")

    import tempfile, uuid as _uuid
    ext = (file.filename or "").rsplit(".", 1)[-1].lower()
    if ext not in ("webm", "mp3", "wav", "m4a", "ogg", "mp4"):
        ext = "webm"
    voice_id = _uuid.uuid4().hex[:12]
    voice_name = f"vm_{voice_id}.{ext}"
    # PRIMARY STORAGE: Emergent Object Storage (source of truth in prod).
    if not object_storage.is_enabled():
        raise HTTPException(503, "Object Storage disabilitato: impossibile ricevere il vocale")
    mime = {"webm": "audio/webm", "mp3": "audio/mpeg", "wav": "audio/wav",
            "m4a": "audio/mp4", "ogg": "audio/ogg", "mp4": "audio/mp4"}.get(ext, "application/octet-stream")
    try:
        stored_path = await object_storage.put_bytes(f"voice/{voice_name}", data, mime)
    except Exception as e:
        logger.error(f"[voice] objstore upload failed: {e}")
        raise HTTPException(502, "Upload su Object Storage fallito")
    if not stored_path:
        raise HTTPException(502, "Upload su Object Storage fallito")
    audio_url = f"/api/voice_audio/{voice_name}"

    with tempfile.NamedTemporaryFile(delete=False, suffix="." + ext) as tf:
        tf.write(data)
        tf_path = tf.name
    text = ""
    try:
        stt = OpenAISpeechToText(api_key=api_key)
        with open(tf_path, "rb") as f:
            resp = await stt.transcribe(
                file=f, model="whisper-1", response_format="json",
                language=(lang or "it")[:2],
            )
        text = (getattr(resp, "text", None) or (resp.get("text") if isinstance(resp, dict) else "") or "").strip()
    except Exception as e:
        logger.warning(f"[whisper] transcribe failed: {e}")
    finally:
        try: os.unlink(tf_path)
        except Exception: pass

    # Persisti nella coda vocali
    doc = {
        "id": voice_id,
        "author": (name or "Ascoltatore").strip()[:80],
        "text": text,
        "audio_url": audio_url,
        "status": "pending",
        "created_at": now_iso(),
    }
    try:
        await db.voice_messages.insert_one(doc.copy())
    except Exception as e:
        logger.warning(f"[voice] insert failed: {e}")

    return {"text": text, "id": voice_id, "audio_url": audio_url}


@api_router.get("/voice_audio/{filename}")
async def get_voice_audio(filename: str, request: Request):
    """Serve i vocali degli ascoltatori direttamente dall'Object Storage.
    Non esiste cache locale (i vocali sono effimeri, ~1 min di durata) — si
    stremano lazy dal bucket con supporto Range per riproduzione mobile."""
    if "/" in filename or ".." in filename or not filename.startswith("vm_"):
        raise HTTPException(400, "Invalid filename")
    ext = filename.rsplit(".", 1)[-1].lower()
    mime = {"webm": "audio/webm", "mp3": "audio/mpeg", "wav": "audio/wav",
            "m4a": "audio/mp4", "ogg": "audio/ogg", "mp4": "audio/mp4"}.get(ext, "audio/webm")
    if not object_storage.is_enabled():
        raise HTTPException(503, "Object Storage disabilitato")
    streamed = await object_storage.stream_mp3(
        f"voice/{filename}", cache_to=None, range_header=request.headers.get("range")
    )
    if not streamed:
        raise HTTPException(404, "Voice audio not found")
    gen, content_length, status_code, content_range = streamed
    headers = {"Cache-Control": "public, max-age=3600", "Accept-Ranges": "bytes"}
    if content_length:
        headers["Content-Length"] = content_length
    if content_range:
        headers["Content-Range"] = content_range
    return StreamingResponse(gen, status_code=status_code, media_type=mime, headers=headers)


# ---- Voice Live: coda regia ----
@api_router.get("/admin/voice-queue")
async def admin_voice_queue():
    docs = await db.voice_messages.find({"status": {"$in": ["pending", "on_air"]}}, {"_id": 0}, sort=[("created_at", -1)]).to_list(200)
    return {"items": docs, "count": len(docs)}


@api_router.post("/admin/voice-queue/{vm_id}/approve")
async def admin_voice_approve(vm_id: str):
    vm = await db.voice_messages.find_one({"id": vm_id})
    if not vm:
        raise HTTPException(404, "Vocale non trovato")
    # Segmento community "voice_live": DJ intro + user audio playthrough
    dj_name = random.choice(["Leo", "Aria", "Max"])
    voice_map = {"Leo": "onyx", "Aria": "nova", "Max": "echo"}
    author = vm.get("author") or "Ascoltatore"
    text = vm.get("text") or ""
    script = (
        f"E ora una voce reale che entra in onda: {author} ci scrive — "
        f"o meglio, ci parla. Ascoltiamo insieme il suo messaggio."
    )
    seg = Segment(
        kind="answer",
        dj_name=dj_name,
        voice_key=voice_map.get(dj_name, "nova"),
        title=f"🎙️ Voice Live · {author}",
        script=script,
        music_audio_url=vm.get("audio_url"),
        duration_sec=60,
        track_meta={"is_voice_live": True, "author": author, "transcript": text, "vm_id": vm_id},
        llm_provider="voice_live",
    ).model_dump()
    seg["created_at"] = now_iso()
    await db.priority_queue.insert_one(seg)
    await db.voice_messages.update_one({"id": vm_id}, {"$set": {"status": "on_air", "approved_at": now_iso()}})
    return {"ok": True}


@api_router.delete("/admin/voice-queue/{vm_id}")
async def admin_voice_delete(vm_id: str):
    r = await db.voice_messages.update_one({"id": vm_id}, {"$set": {"status": "rejected", "rejected_at": now_iso()}})
    if r.matched_count == 0:
        raise HTTPException(404, "Vocale non trovato")
    return {"ok": True}




# ---- WALL COMMUNITY (pubblico) ----
@api_router.get("/community/wall")
async def community_wall():
    """Vetrina pubblica: brani community approvati (status=on) con play_count."""
    docs = await db.community_tracks.find(
        {"status": "on"}, {"_id": 0},
        sort=[("play_count", -1), ("submitted_at", -1)]
    ).to_list(50)
    return {"tracks": docs}


# ---- FX / TRANSIZIONE — PLAY LIVE + toggle rotazione ----
@api_router.post("/admin/fx/{track_id}/play-live")
async def admin_fx_play_live(track_id: str):
    """Pubblica su station.pending_fx la traccia FX da sparare subito su tutti i player pubblici.
    I client pubblici pollano state e iniettano il file audio nella pipeline (ducking musica)."""
    t = await db.tracks.find_one({"id": track_id, "is_fx": True, "deleted_at": None})
    if not t:
        raise HTTPException(404, "FX non trovato")
    payload = {
        "id": track_id,
        "title": t.get("title") or "FX",
        "audio_url": t.get("audio_url") or f"/api/suno_audio/track_{track_id}.mp3",
        "ts": now_iso(),
    }
    await db.station.update_one({"_id": "state"}, {"$set": {"pending_fx": payload}}, upsert=True)
    return {"ok": True, "fx": payload}


@api_router.post("/admin/fx/consume")
async def admin_fx_consume():
    """Chiamato dal client dopo aver riprodotto l'FX per pulire lo slot pending."""
    await db.station.update_one({"_id": "state"}, {"$set": {"pending_fx": None}})
    return {"ok": True}


# ============================================================================
# v13.2 · LOGICA EDITORIALE GIORNO/NOTTE (Admin toggle per singolo brano)
# ============================================================================
@api_router.patch("/admin/tracks/{track_id}/daypart")
async def admin_set_track_daypart(track_id: str, payload: dict):
    """Aggiorna i flag giorno/notte per un singolo brano.
    Body: {"day": bool, "night": bool}. Se entrambi False si impostano
    entrambi True (retro-compat, brano "sempre in aria")."""
    day = bool(payload.get("day", True))
    night = bool(payload.get("night", True))
    if not day and not night:
        day = night = True
    r = await db.tracks.update_one(
        {"id": track_id, "deleted_at": None},
        {"$set": {"daypart_day": day, "daypart_night": night, "updated_at": now_iso()}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Track non trovata")
    return {"ok": True, "daypart_day": day, "daypart_night": night}


# ============================================================================
# v13.2 · MASTER CLOCK — Palinsesto orario 24h (Autore)
# ============================================================================
# Ogni ora della giornata (0..23) ha un titolo/soggetto/kind assegnati
# dall'admin. `kind` guida la generazione del segmento speciale in quell'ora:
#   • "music"       → rotazione normale (default)
#   • "radioscope"  → Il Radioscopo (12 previsioni segno per segno)
#   • "past_pill"   → Pillole dal Passato (Leo · fatti storici REALI)
#   • "future_pill" → Pillole dal Futuro (Aria · trend scientifici)
#   • "rubric"      → Rubrica libera (autore definisce titolo+subject)
# v13.8 · `video_source` sceglie cosa mostra il LedWall in quell'ora:
#   • "effects" → visualizer Canvas audio-reattivo (default)
#   • "video"   → riproduce un file video statico (video_url)
#   • "cam"     → riproduce uno stream live (video_url, es. HLS/mp4)
_SCHEDULE_KINDS = {"music", "radioscope", "past_pill", "future_pill", "rubric"}
_VIDEO_SOURCES = {"effects", "video", "cam"}


@api_router.get("/admin/schedule")
async def admin_get_schedule():
    """Restituisce la griglia 24h. Se mancante crea 24 slot vuoti default."""
    rows = await db.program_schedule.find({}, {"_id": 0}).sort("hour", 1).to_list(30)
    if len(rows) < 24:
        existing_hours = {r["hour"] for r in rows}
        for h in range(24):
            if h in existing_hours:
                continue
            await db.program_schedule.insert_one({
                "hour": h,
                "title": None,
                "subject": None,
                "kind": "music",
                "video_source": "effects",
                "video_url": None,
                "updated_at": now_iso(),
            })
        rows = await db.program_schedule.find({}, {"_id": 0}).sort("hour", 1).to_list(30)
    return {"schedule": rows}


@api_router.patch("/admin/schedule/{hour}")
async def admin_set_schedule_hour(hour: int, payload: dict):
    """Aggiorna uno slot orario. Body: {title, subject, kind, video_source, video_url}."""
    if hour < 0 or hour > 23:
        raise HTTPException(400, "hour deve essere 0..23")
    kind = (payload.get("kind") or "music").strip()
    if kind not in _SCHEDULE_KINDS:
        raise HTTPException(400, f"kind deve essere in {sorted(_SCHEDULE_KINDS)}")
    video_source = (payload.get("video_source") or "effects").strip()
    if video_source not in _VIDEO_SOURCES:
        raise HTTPException(400, f"video_source deve essere in {sorted(_VIDEO_SOURCES)}")
    doc = {
        "hour": hour,
        "title": (payload.get("title") or "").strip()[:120] or None,
        "subject": (payload.get("subject") or "").strip()[:2000] or None,
        "kind": kind,
        "video_source": video_source,
        "video_url": (payload.get("video_url") or "").strip()[:500] or None,
        "partner_link": (payload.get("partner_link") or "").strip()[:500] or None,
        "updated_at": now_iso(),
    }
    await db.program_schedule.update_one({"hour": hour}, {"$set": doc}, upsert=True)
    return {"ok": True, "slot": doc}


@api_router.get("/ledwall/state")
async def get_ledwall_state():
    """Stato corrente del LedWall: cosa mostrare ORA in base al Master Clock.
    Ritorna {video_source, video_url}. Il frontend consulta questo endpoint
    per decidere se rendere Canvas audio-reattivo o video reale.

    v13.22 · Precedenza:
      1) evento Timeline in onda con `video_url` → override per la sua durata
      2) override manuale della Regia (`station.state.ledwall_override`)
      3) slot del palinsesto orario (`program_schedule`)
      4) video di default della Regia (`station.state.ledwall_default_video_url`)
      5) fallback: effetti (canvas audio-reattivo)
    Al termine dell'evento (durata scaduta) il LedWall torna AUTOMATICAMENTE
    al default senza intervento manuale — è già gestito dallo `station_clock`
    che sostituisce `current` con il brano successivo.
    """
    try:
        from zoneinfo import ZoneInfo
        now_local = datetime.now(ZoneInfo("Europe/Rome"))
    except Exception:
        now_local = datetime.now(timezone.utc)
    hour = now_local.hour
    slot = await db.program_schedule.find_one({"hour": hour}, {"_id": 0}) or {}
    st = await db.station.find_one(
        {"_id": "state"},
        {"ledwall_override": 1, "ledwall_default_video_url": 1},
    ) or {}
    override = st.get("ledwall_override") or {}
    default_video = (st.get("ledwall_default_video_url") or "").strip() or None

    # 1) Evento Timeline in onda con video override — precedenza massima.
    # Supporta anche sentinel FX (es. "fx:effects") per un evento che vuole
    # forzare gli effetti audio-reattivi.
    from_event = False
    clk = await db.station_clock.find_one({"_id": "clock"}, {"current": 1})
    cur = (clk or {}).get("current") or {}
    if cur.get("is_timeline") and cur.get("video_url"):
        _vu = cur.get("video_url") or ""
        if _vu.startswith("fx:"):
            return {
                "hour": hour, "video_source": "effects", "video_url": None,
                "from_override": False, "from_event": True,
                "event_id": cur.get("id"), "event_title": cur.get("title"),
                "fx_name": _vu[3:] or None,
            }
        return {
            "hour": hour,
            "video_source": "video",
            "video_url": _vu,
            "from_override": False,
            "from_event": True,
            "event_id": cur.get("id"),
            "event_title": cur.get("title"),
        }

    # 2) Override manuale di regia
    if override.get("video_source"):
        src = override.get("video_source")
        if src not in _VIDEO_SOURCES:
            src = "effects"
        return {"hour": hour, "video_source": src,
                "video_url": override.get("video_url"),
                "from_override": True, "from_event": False}

    # 3) Slot palinsesto orario
    if slot.get("video_source") and slot.get("video_source") in _VIDEO_SOURCES:
        return {"hour": hour, "video_source": slot["video_source"],
                "video_url": slot.get("video_url"),
                "from_override": False, "from_event": False}

    # 4) Video di default della Regia — può essere URL video reale o sentinel
    # FX (es. "fx:effects"). In caso FX, il LedWall renderizza gli effetti.
    if default_video:
        if default_video.startswith("fx:"):
            return {"hour": hour, "video_source": "effects", "video_url": None,
                    "from_override": False, "from_event": False,
                    "from_default": True, "fx_name": default_video[3:] or None}
        return {"hour": hour, "video_source": "video",
                "video_url": default_video,
                "from_override": False, "from_event": False,
                "from_default": True}

    # 5) Fallback effetti
    return {"hour": hour, "video_source": "effects", "video_url": None,
            "from_override": False, "from_event": False}


@api_router.patch("/admin/ledwall/override")
async def admin_ledwall_override(payload: dict):
    """Override manuale immediato dello stato LedWall (bypass palinsesto).
    Body: {video_source: 'effects'|'video'|'cam'|null, video_url?: str}.
    Passa {video_source: null} per rimuovere l'override."""
    src = payload.get("video_source")
    if src not in (None, "", *_VIDEO_SOURCES):
        raise HTTPException(400, "video_source non valido")
    if src in (None, ""):
        await db.station.update_one({"_id": "state"}, {"$unset": {"ledwall_override": ""}})
        return {"ok": True, "override": None}
    override = {
        "video_source": src,
        "video_url": (payload.get("video_url") or "").strip()[:500] or None,
        "set_at": now_iso(),
    }
    await db.station.update_one({"_id": "state"}, {"$set": {"ledwall_override": override}}, upsert=True)
    return {"ok": True, "override": override}


@api_router.post("/admin/ledwall/upload-video")
async def admin_ledwall_upload_video(file: UploadFile = File(...), name: Optional[str] = Form(None)):
    """Upload MP4/WebM su Object Storage. Ritorna URL utilizzabile in
    Master Clock (`video_source=video`) o negli override."""
    if not file:
        raise HTTPException(400, "File mancante")
    data = await file.read()
    if len(data) > 200 * 1024 * 1024:
        raise HTTPException(413, "File troppo grande (max 200MB)")
    fname_orig = (file.filename or "video.mp4").lower()
    ext = fname_orig.rsplit(".", 1)[-1] if "." in fname_orig else "mp4"
    if ext not in ("mp4", "webm", "mov", "m4v"):
        raise HTTPException(415, f"Estensione non supportata: {ext}")
    vid_id = uuid.uuid4().hex[:12]
    local_name = f"ledwall_{vid_id}.{ext}"
    mime = {"mp4": "video/mp4", "webm": "video/webm",
            "mov": "video/quicktime", "m4v": "video/x-m4v"}.get(ext, "video/mp4")
    if not object_storage.is_enabled():
        raise HTTPException(503, "Object Storage disabilitato")
    stored = await object_storage.put_bytes(f"ledwall/{local_name}", data, mime)
    if not stored:
        raise HTTPException(502, "Upload fallito")
    video_url = f"/api/ledwall_video/{local_name}"
    doc = {
        "id": vid_id,
        "filename": local_name,
        "display_name": (name or fname_orig)[:80],
        "url": video_url,
        "size": len(data),
        "mime": mime,
        "uploaded_at": now_iso(),
    }
    await db.ledwall_videos.insert_one(doc.copy())
    doc.pop("_id", None)
    return {"ok": True, "video": doc}


@api_router.get("/admin/ledwall/videos")
async def admin_ledwall_list_videos():
    """Elenca i video caricati per il LedWall (max 100 recenti)."""
    rows = await db.ledwall_videos.find({}, {"_id": 0}).sort("uploaded_at", -1).limit(100).to_list(100)
    return {"videos": rows}


@api_router.delete("/admin/ledwall/videos/{video_id}")
async def admin_ledwall_delete_video(video_id: str):
    """v13.22 · Elimina il video: rimuove il record dal DB E il file fisico
    dallo Object Storage per liberare spazio. Idempotente."""
    doc = await db.ledwall_videos.find_one({"id": video_id}, {"_id": 0, "filename": 1, "url": 1})
    filename = None
    if doc:
        filename = doc.get("filename") or (doc.get("url") or "").rsplit("/", 1)[-1]
    r = await db.ledwall_videos.delete_one({"id": video_id})
    # Se il video è correntemente usato come "default", rimuovilo dalla config
    await db.station.update_one(
        {"_id": "state", "ledwall_default_video_url": {"$regex": f"/{filename}$"} if filename else "___never___"},
        {"$unset": {"ledwall_default_video_url": ""}},
    )
    if filename:
        # Best-effort: cancella l'oggetto dallo storage (idempotente)
        try:
            await object_storage.delete_object(f"ledwall/{filename}")
        except Exception as e:
            logger.warning(f"[ledwall] objstore delete failed: {e}")
    return {"ok": r.deleted_count > 0, "storage_removed": bool(filename)}


# ============================================================================
# v13.22 · REGIA CONFIG — Soggetto di default UNIVERSALE + Video LedWall default
# ============================================================================
@api_router.get("/admin/regia/config")
async def admin_regia_config_get():
    """Ritorna la config globale della Regia (soggetto di default per tutte
    le generazioni AI + video di default del LedWall)."""
    st = await db.station.find_one(
        {"_id": "state"},
        {"_id": 0, "default_subject": 1, "ledwall_default_video_url": 1},
    ) or {}
    return {
        "default_subject": st.get("default_subject") or "",
        "ledwall_default_video_url": st.get("ledwall_default_video_url") or None,
    }


@api_router.patch("/admin/regia/config")
async def admin_regia_config_patch(payload: dict):
    """Aggiorna la config globale. Se una chiave è vuota → l'entry viene rimossa
    (l'AI torna al comportamento "autonomo" e il LedWall torna agli effetti)."""
    updates_set: dict = {}
    updates_unset: dict = {}
    if "default_subject" in payload:
        val = (payload.get("default_subject") or "").strip()[:400]
        if val:
            updates_set["default_subject"] = val
        else:
            updates_unset["default_subject"] = ""
    if "ledwall_default_video_url" in payload:
        val = (payload.get("ledwall_default_video_url") or "").strip()[:500]
        if val:
            updates_set["ledwall_default_video_url"] = val
        else:
            updates_unset["ledwall_default_video_url"] = ""
    op: dict = {}
    if updates_set: op["$set"] = updates_set
    if updates_unset: op["$unset"] = updates_unset
    if op:
        await db.station.update_one({"_id": "state"}, op, upsert=True)
    return await admin_regia_config_get()


@api_router.post("/admin/timeline/ora-esatta")
async def admin_timeline_create_ora_esatta(payload: dict = None):
    """v13.23 · Programma "Ora Esatta" come evento Timeline ricorrente orario.
    v13.24 · SEQUENZA COMPLETA: accetta `spot_audio_url` opzionale — se
    valorizzato, subito dopo l'Ora Esatta parte lo Spot pubblicitario
    associato (zero-gap via follow-up injection nella queue del clock).
    
    Body opzionale: {audio_url?, video_url?, duration_sec?,
                     spot_audio_url?, spot_title?, spot_duration_sec?}.
    Idempotente: elimina PRIMA eventuali eventi `kind=ora_esatta` pending,
    così non si accumulano duplicati.
    """
    payload = payload or {}
    # Pulisci eventuali eventi ora_esatta già pending (idempotenza)
    try:
        await db.timeline_events.delete_many({"kind": "ora_esatta", "status": "pending"})
    except Exception as e:
        logger.warning(f"[ora-esatta] cleanup pending failed: {e}")
    # Prossima ora esatta (:00:00) in UTC
    now_utc = datetime.now(timezone.utc)
    next_hour = (now_utc + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
    audio_url = (payload.get("audio_url") or "").strip()
    if not audio_url:
        ts = await db.time_signal_cache.find_one(
            {"speech_audio_url": {"$exists": True, "$ne": None}},
            sort=[("_id", -1)],
        )
        if ts and ts.get("speech_audio_url"):
            audio_url = ts["speech_audio_url"]
    if not audio_url:
        raise HTTPException(
            400,
            "Nessun audio Ora Esatta disponibile. Attendi che `_time_signal_pregenerator` "
            "ne pre-generi uno, oppure passa audio_url nel body.",
        )
    event_video_url = (payload.get("video_url") or "").strip() or None
    # v13.24 · Spot follow-up (opzionale)
    spot_audio = (payload.get("spot_audio_url") or "").strip()
    follow_up = None
    if spot_audio:
        follow_up = {
            "audio_url": spot_audio,
            "title": (payload.get("spot_title") or "Spot").strip()[:120],
            "artist": (payload.get("spot_artist") or "R-A.I. Advertising").strip()[:120],
            "duration_sec": int(payload.get("spot_duration_sec") or 20),
            "video_url": (payload.get("spot_video_url") or "").strip() or None,
        }
    ev = {
        "id": f"tl-{uuid.uuid4().hex[:12]}",
        "scheduled_at": next_hour.isoformat(),
        "kind": "ora_esatta",
        "title": "🕐 Ora Esatta" + (f" + Spot ({follow_up['title']})" if follow_up else ""),
        "artist": "R-A.I. Regia",
        "audio_url": audio_url,
        "duration_sec": int(payload.get("duration_sec") or 12),
        "dj_id": None, "dj_name": None, "voice_key": None,
        "brief": None,
        "video_url": event_video_url,
        "repeat_daily": False,
        "recurrence": "hourly",
        "silence_pad_ms": 200,
        "follow_up": follow_up,
        "status": "pending",
        "created_at": now_utc.isoformat(),
    }
    await db.timeline_events.insert_one(ev.copy())
    # v13.24 · Persisti anche la config in station.state così la Regia può
    # rileggerla al riavvio o dopo delete/re-enable senza riscoprire i path.
    await db.station.update_one(
        {"_id": "state"},
        {"$set": {"hourly_trigger": {
            "enabled": True,
            "ora_esatta_audio_url": audio_url,
            "spot_audio_url": spot_audio or None,
            "spot_title": (follow_up or {}).get("title"),
            "spot_duration_sec": (follow_up or {}).get("duration_sec"),
            "updated_at": now_utc.isoformat(),
        }}},
        upsert=True,
    )
    ev.pop("_id", None)
    return {"ok": True, "event": ev, "note": "Sequenza Ora Esatta+Spot armata (hourly)."}


@api_router.get("/admin/timeline/ora-esatta")
async def admin_timeline_ora_esatta_status():
    """v13.24 · Ritorna la config armata della sequenza Ora Esatta + Spot,
    inclusa la prossima occorrenza pending della Timeline."""
    st = await db.station.find_one({"_id": "state"}, {"hourly_trigger": 1}) or {}
    cfg = st.get("hourly_trigger") or {"enabled": False}
    ev = await db.timeline_events.find_one(
        {"kind": "ora_esatta", "status": "pending"},
        {"_id": 0},
        sort=[("scheduled_at", 1)],
    )
    return {"config": cfg, "next_event": ev}


@api_router.delete("/admin/timeline/ora-esatta")
async def admin_timeline_ora_esatta_disable():
    """v13.24 · Disarma la sequenza: elimina tutti gli eventi `ora_esatta`
    pending e rimuove la config da station.state."""
    r = await db.timeline_events.delete_many({"kind": "ora_esatta", "status": "pending"})
    await db.station.update_one({"_id": "state"}, {"$unset": {"hourly_trigger": ""}})
    return {"ok": True, "removed": r.deleted_count}


@api_router.get("/ledwall_video/{filename}")
async def get_ledwall_video(filename: str, request: Request):
    """Serve video LedWall da Object Storage con supporto Range."""
    if "/" in filename or ".." in filename:
        raise HTTPException(400, "Invalid filename")
    ext = filename.rsplit(".", 1)[-1].lower()
    mime = {"mp4": "video/mp4", "webm": "video/webm",
            "mov": "video/quicktime", "m4v": "video/x-m4v"}.get(ext, "video/mp4")
    if not object_storage.is_enabled():
        raise HTTPException(503, "Object Storage disabilitato")
    streamed = await object_storage.stream_mp3(
        f"ledwall/{filename}", cache_to=None, range_header=request.headers.get("range")
    )
    if not streamed:
        raise HTTPException(404, "Video non trovato")
    gen, content_length, status_code, content_range = streamed
    headers = {"Cache-Control": "public, max-age=3600", "Accept-Ranges": "bytes"}
    if content_length: headers["Content-Length"] = content_length
    if content_range: headers["Content-Range"] = content_range
    return StreamingResponse(gen, status_code=status_code, media_type=mime, headers=headers)


# ============================================================================
# v13.2 · RADIOSCOPO — 12 previsioni giornaliere (una per segno)
# ============================================================================
_ZODIAC_IT = [
    ("aries", "Ariete"), ("taurus", "Toro"), ("gemini", "Gemelli"),
    ("cancer", "Cancro"), ("leo", "Leone"), ("virgo", "Vergine"),
    ("libra", "Bilancia"), ("scorpio", "Scorpione"), ("sagittarius", "Sagittario"),
    ("capricorn", "Capricorno"), ("aquarius", "Acquario"), ("pisces", "Pesci"),
]
_ZODIAC_KEYS = {k for k, _ in _ZODIAC_IT}

# System prompt tassativo per il Radioscopo (v13.2):
# tono visionario neon, lessico "energia digitale / vibrazioni neurali",
# 2 frasi max, previsione + suggerimento operativo. Zero astrologia mistica.
_RADIOSCOPE_SYSTEM = (
    "Sei R-A.I., una radio AI che genera un Radioscopo digitale futuristico. "
    "Genera previsioni per un segno zodiacale usando il lessico 'energia "
    "digitale', 'vibrazioni neurali', 'circuiti emotivi', 'frequenze cosmiche'. "
    "Tono: visionario, positivo, dinamico, mai mistico o esoterico. "
    "Vietato riferimenti a divinazione, tarocchi, karma, chakra. "
    "Formato: 2 frasi brevi. Prima frase = previsione del giorno. Seconda "
    "frase = azione concreta suggerita. Massimo 45 parole totali. In italiano."
)


async def _generate_radioscope_for_sign(sign_key: str, sign_it: str) -> str:
    prompt = f"Genera il Radioscopo per {sign_it} valido per oggi. Un solo paragrafo."
    try:
        text = await llm_generate("gemini", "gemini-3-flash-preview", _RADIOSCOPE_SYSTEM, prompt)
    except Exception as e:
        logger.warning(f"[radioscope] LLM fail for {sign_key}: {e}")
        text = f"{sign_it}: le tue vibrazioni neurali oggi sono in sincronia con la frequenza R-A.I. Sintonizzati e lascia scorrere il flusso."
    return (text or "").strip()


@api_router.get("/radioscope")
async def get_radioscope():
    """Ritorna le 12 previsioni del giorno. Cache giornaliera in db.radioscope_cache.
    Costo: 12 chiamate Gemini Flash una volta al giorno (< 0.02 ECU stimati)."""
    today_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    cached = await db.radioscope_cache.find_one({"_id": today_iso}, {"_id": 0})
    if cached and len(cached.get("signs", [])) == 12:
        return {"date": today_iso, "signs": cached["signs"], "cached": True}
    signs_out = []
    for key, it in _ZODIAC_IT:
        text = await _generate_radioscope_for_sign(key, it)
        signs_out.append({"key": key, "name": it, "text": text})
    await db.radioscope_cache.update_one(
        {"_id": today_iso},
        {"$set": {"signs": signs_out, "generated_at": now_iso()}},
        upsert=True,
    )
    return {"date": today_iso, "signs": signs_out, "cached": False}


@api_router.get("/radioscope/{sign_key}")
async def get_radioscope_sign(sign_key: str):
    sign_key = (sign_key or "").lower().strip()
    if sign_key not in _ZODIAC_KEYS:
        raise HTTPException(404, "segno non valido")
    r = await get_radioscope()
    for s in r["signs"]:
        if s["key"] == sign_key:
            return {"date": r["date"], **s}
    raise HTTPException(500, "segno mancante")


@api_router.post("/admin/radioscope/regenerate")
async def admin_regenerate_radioscope(payload: dict = None):
    """Cancella la cache del giorno corrente e rigenera tutti i 12 segni.
    Body opzionale: {"sign": "<key>"} per rigenerare un solo segno.
    Costo: ~12 chiamate Gemini Flash (o 1 se sign specificato). Solo admin."""
    payload = payload or {}
    today_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    sign = (payload.get("sign") or "").lower().strip() or None
    if sign and sign not in _ZODIAC_KEYS:
        raise HTTPException(400, "sign non valido")
    if sign:
        # rigenera solo un segno
        name_it = dict(_ZODIAC_IT)[sign]
        text = await _generate_radioscope_for_sign(sign, name_it)
        cached = await db.radioscope_cache.find_one({"_id": today_iso}) or {"_id": today_iso, "signs": []}
        signs = [s for s in (cached.get("signs") or []) if s.get("key") != sign]
        signs.append({"key": sign, "name": name_it, "text": text})
        # riordina per canonico
        order = [k for k, _ in _ZODIAC_IT]
        signs.sort(key=lambda s: order.index(s["key"]) if s["key"] in order else 99)
        await db.radioscope_cache.update_one(
            {"_id": today_iso},
            {"$set": {"signs": signs, "regenerated_at": now_iso()}},
            upsert=True,
        )
        return {"date": today_iso, "regenerated": [sign]}
    # rigenera tutto
    await db.radioscope_cache.delete_one({"_id": today_iso})
    r = await get_radioscope()
    return {"date": r["date"], "regenerated": [s["key"] for s in r["signs"]]}


# ============================================================================
# v13.2 · PILLOLE DAL PASSATO (Leo · fatti storici REALI)
# v13.2 · PILLOLE DAL FUTURO (Aria · trend scientifici)
# ============================================================================
# System prompt TASSATIVI: Leo educa con fatti verificabili (radio/musica/
# tecnologia). Aria previsione futura visionaria ma ancorata a trend reali.
_PILL_PAST_SYSTEM = (
    "Sei Leo, DJ storico di R-A.I. Rubrica: 'Pillole dal Passato'. Racconti "
    "in 40-50 secondi (~130 parole) un fatto STORICO REALMENTE ACCADUTO nel "
    "mondo della radio, della musica popolare o della tecnologia consumer. "
    "REGOLE FERREE:\n"
    "- NIENTE INVENZIONI: solo fatti verificati, con anno e luogo se noti.\n"
    "- Nomi, date, città devono essere reali. Se non sei certo di una cifra "
    "  esatta usa formule 'attorno al [anno]' invece di sbagliare.\n"
    "- Zero fiction, zero 'racconto immaginato'. È EDUCARE, non intrattenere.\n"
    "- Tono da speaker esperto, appassionato ma sobrio.\n"
    "- Chiudi con una frase che leghi il passato al presente (perché conta "
    "  ancora oggi).\n"
    "- Italiano parlato, no elenchi puntati, no titoli, no markdown."
)
_PILL_FUTURE_SYSTEM = (
    "Sei Aria, DJ del futuro di R-A.I. Rubrica: 'Pillole dal Futuro'. In 40-50 "
    "secondi (~130 parole) presenti una PREVISIONE VISIONARIA ancorata a "
    "trend scientifici o tecnologici REALI attualmente in sviluppo (IA "
    "generativa, neuroscienze applicate, informatica quantistica, biotech, "
    "nuovi materiali, energia, spazio commerciale, interfacce neurali).\n"
    "REGOLE FERREE:\n"
    "- Base scientifica reale: parti da un fatto o ricerca in corso oggi.\n"
    "- Estrapolazione motivata: come potrebbe evolvere nei prossimi 5-15 anni.\n"
    "- Zero magia o pseudoscienza. Zero distopie gratuite.\n"
    "- Tono: informato, ottimista ma non ingenuo.\n"
    "- Chiudi con una domanda aperta all'ascoltatore.\n"
    "- Italiano parlato, no elenchi, no markdown."
)


# ============================================================================
# v13.2 · BPM · Analisi automatica sui brani in libreria
# ============================================================================
@api_router.post("/admin/bpm/scan")
async def admin_bpm_scan(payload: dict = None):
    """Backfill BPM su tutti i brani ready senza `bpm`. Body opzionale:
    {"limit": 20, "force": false}. Torna il conteggio aggiornato.
    NB: ogni brano richiede ~1-3s di analisi CPU (librosa). Esegui a lotti."""
    payload = payload or {}
    limit = int(payload.get("limit") or 20)
    force = bool(payload.get("force"))
    q = {"status": "ready", "audio_url": {"$ne": None}, "deleted_at": None}
    if not force:
        q["$or"] = [{"bpm": {"$exists": False}}, {"bpm": None}]
    tracks = await db.tracks.find(q, {"_id": 0, "id": 1, "audio_url": 1}).limit(limit).to_list(limit)
    updated = 0
    for t in tracks:
        url = t.get("audio_url") or ""
        try:
            # url interno tipo /api/suno_audio/track_<id>.mp3 → fetch bytes
            local_name = url.rsplit("/", 1)[-1]
            data = None
            # Prova prima Object Storage
            try:
                sub = None
                if url.startswith("/api/suno_audio/"):
                    sub = f"suno/{local_name}"
                elif url.startswith("/api/community_audio/"):
                    sub = f"community/{local_name}"
                elif url.startswith("/api/beds/"):
                    sub = f"beds/{local_name}"
                if sub and object_storage.is_enabled():
                    data = await object_storage.get_bytes(sub)
            except Exception:
                data = None
            # Fallback disco
            if not data:
                for base in (SUNO_AUDIO_DIR, COMMUNITY_AUDIO_DIR, BEDS_DIR):
                    p = base / local_name
                    if p.exists():
                        data = p.read_bytes()
                        break
            if not data:
                continue
            bpm = await bpm_service.detect_bpm_from_bytes(data, ".mp3")
            if bpm:
                await db.tracks.update_one(
                    {"id": t["id"]},
                    {"$set": {"bpm": bpm, "bpm_source": "server"}},
                )
                updated += 1
        except Exception as e:
            logger.warning(f"[bpm] scan skip {t.get('id')}: {e}")
    return {"scanned": len(tracks), "updated": updated}


@api_router.post("/admin/pillole/genera")
async def admin_generate_pill(payload: dict):
    """Genera uno script pronto per il TTS di una Pillola dal Passato/Futuro.
    Body: {kind: 'past'|'future', hint?: str}. Ritorna {kind, script, dj}."""
    kind = (payload.get("kind") or "").strip().lower()
    hint = (payload.get("hint") or "").strip()[:400]
    if kind not in ("past", "future"):
        raise HTTPException(400, "kind deve essere 'past' o 'future'")
    if kind == "past":
        system = _PILL_PAST_SYSTEM
        user = hint or "Scegli un fatto storico interessante e poco conosciuto legato alla radio, musica popolare o tecnologia consumer del '900 o primi anni 2000."
        dj = "Leo"
    else:
        system = _PILL_FUTURE_SYSTEM
        user = hint or "Scegli un trend scientifico o tecnologico attualmente in sviluppo e proietta la sua evoluzione nei prossimi 5-15 anni."
        dj = "Aria"
    try:
        script = await llm_generate("anthropic", "claude-sonnet-4-5-20250929", system, user)
    except Exception as e:
        logger.warning(f"[pill:{kind}] LLM fail: {e}")
        raise HTTPException(502, f"Generazione fallita: {e}")
    return {"kind": kind, "dj": dj, "script": (script or "").strip()}



# ============================================================================
# v13.3 · HLS BROADCAST — Streaming In-Pod (default) + External URL Redirect
# ============================================================================
def _build_hls_playlist(tracks: list, base_url: str) -> str:
    lines = [
        "#EXTM3U",
        "#EXT-X-VERSION:3",
        "#EXT-X-TARGETDURATION:180",
        "#EXT-X-MEDIA-SEQUENCE:0",
        "#EXT-X-PLAYLIST-TYPE:EVENT",
        f"#EXT-X-PROGRAM-DATE-TIME:{datetime.now(timezone.utc).isoformat()}",
    ]
    for t in tracks:
        dur = float(t.get("duration_sec") or 150)
        title = (t.get("title") or "R-A.I.").replace(",", " ")
        artist = (t.get("artist") or "R-A.I.").replace(",", " ")
        url = t.get("audio_url") or ""
        if url.startswith("/"):
            url = f"{base_url.rstrip('/')}{url}"
        lines.append(f"#EXTINF:{dur:.3f},{artist} - {title}")
        lines.append(url)
    lines.append("")
    return "\n".join(lines)


@api_router.get("/stream/live.m3u8")
async def hls_live_playlist(request: Request):
    """HLS Live Playlist — v13.6 TRUE BROADCASTER.
    • Con `external_stream_url` configurato → 302 verso Icecast/HLS esterno.
    • Altrimenti legge `station_clock` e serve una playlist HLS EVENT con:
      - Traccia corrente + prossimi 4 dal clock server-side
      - `#EXT-X-PROGRAM-DATE-TIME` per ogni segmento
      - `#EXT-X-START:TIME-OFFSET=<offset>` così ogni client si posiziona
        automaticamente all'istante in cui il server è già arrivato.
    Risultato: due client che aprono il .m3u8 nello stesso momento sentono
    lo STESSO frame. Su Tier 0 con pod addormentato al primo request si
    "risana" via `_clock_advance()` on-demand."""
    st = await db.station.find_one({"_id": "state"}, {"external_stream_url": 1}) or {}
    ext_url = (st.get("external_stream_url") or "").strip()
    if ext_url:
        return Response(status_code=302, headers={"Location": ext_url})

    clock = await _clock_advance()   # self-heal
    offset, cur = _clock_now_offset(clock)
    proto = request.headers.get("x-forwarded-proto", "https")
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    base_url = f"{proto}://{host}"

    if not cur or not cur.get("audio_url"):
        # Nessun brano disponibile: playlist minimale vuota
        empty = "\n".join([
            "#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:10",
            "#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-PLAYLIST-TYPE:EVENT",
            "#EXT-X-ENDLIST", "",
        ])
        return Response(content=empty, media_type="application/vnd.apple.mpegurl",
                        headers={"Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"})

    entries = [cur] + [t for t in (clock.get("queue") or [])[:4]]
    lines = [
        "#EXTM3U",
        "#EXT-X-VERSION:3",
        "#EXT-X-TARGETDURATION:300",
        "#EXT-X-MEDIA-SEQUENCE:0",
        "#EXT-X-PLAYLIST-TYPE:EVENT",
        f"#EXT-X-START:TIME-OFFSET={offset:.3f},PRECISE=YES",
    ]
    # Iniziale program-date-time = quando il current è iniziato per davvero
    running_dt = None
    try:
        running_dt = datetime.fromisoformat((cur.get("started_at") or "").replace("Z", "+00:00"))
    except Exception:
        running_dt = datetime.now(timezone.utc)

    for i, t in enumerate(entries):
        dur = float(t.get("duration_sec") or 180)
        title = (t.get("title") or "R-A.I.").replace(",", " ")
        artist = (t.get("artist") or "R-A.I.").replace(",", " ")
        url = t.get("audio_url") or ""
        if url.startswith("/"):
            url = f"{base_url.rstrip('/')}{url}"
        # v13.25 · #EXT-X-DISCONTINUITY prima di OGNI segmento successivo
        # al primo. Serve a decoder Bluetooth (auto), Chromecast e hardware
        # HLS a resettare il decoder audio al cambio di file, evitando
        # click/glitch al confine formato tra canzone→voce→canzone (anche
        # con audio normalizzato, tag ID3, header MP3 e riempimenti VBR
        # possono differire in modo che fanno inciampare il decoder).
        if i > 0:
            lines.append("#EXT-X-DISCONTINUITY")
        lines.append(f"#EXT-X-PROGRAM-DATE-TIME:{running_dt.isoformat().replace('+00:00','Z')}")
        lines.append(f"#EXTINF:{dur:.3f},{artist} - {title}")
        lines.append(url)
        running_dt = running_dt + timedelta(seconds=dur)
        _ = i
    lines.append("")
    playlist = "\n".join(lines)
    # v13.16 · OTTIMIZZAZIONE PER MIGLIAIA DI CLIENT
    # `s-maxage=1` = CDN edge riusa la stessa m3u8 per 1s → 1000+ client → 1 backend hit
    # `stale-while-revalidate=3` = serve la versione stale mentre revalida in background
    # `Access-Control-Allow-Origin=*` = domini custom possono consumare il flusso
    return Response(content=playlist, media_type="application/vnd.apple.mpegurl",
                    headers={
                        "Cache-Control": "public, max-age=1, s-maxage=1, stale-while-revalidate=3",
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Expose-Headers": "*",
                    })


@api_router.get("/admin/external-stream")
async def admin_get_external_stream():
    st = await db.station.find_one({"_id": "state"}, {"external_stream_url": 1}) or {}
    return {"external_stream_url": st.get("external_stream_url") or ""}


@api_router.patch("/admin/external-stream")
async def admin_set_external_stream(payload: dict):
    url = (payload.get("url") or "").strip()
    if url and not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(400, "URL deve iniziare con http:// o https://")
    await db.station.update_one(
        {"_id": "state"}, {"$set": {"external_stream_url": url or None}}, upsert=True
    )
    logger.info(f"[stream] external_stream_url set to '{url}'")
    return {"ok": True, "external_stream_url": url}


# ============================================================================
# v13.3 · DJ DUAL-BRAIN — Scontro di Logica (solo FM MODE)
# ============================================================================
_DUAL_LEO_SYSTEM = (
    "Sei Leo, DJ storico di R-A.I. In questo segmento speciale 'DUAL-BRAIN' "
    "sei l'AVVOCATO DIFENSORE del brano/ascoltatore proposto. Difendilo con "
    "passione ma con classe. Massimo 3-4 frasi (~25 secondi parlati). "
    "Termina con una battuta provocatoria diretta al collega Max. "
    "Italiano parlato, no elenchi, no markdown."
)
_DUAL_MAX_SYSTEM = (
    "Sei Max, DJ dance di R-A.I. In questo segmento 'DUAL-BRAIN' sei il "
    "PUBBLICO MINISTERO: critica ferocemente ma con ironia quello che Leo ha "
    "appena difeso. Massimo 3-4 frasi (~25 secondi). Chiudi con una frase-"
    "slogan che spiazzi Leo. Italiano parlato, no elenchi."
)


@api_router.post("/admin/dual-brain/generate")
async def admin_dual_brain_generate(payload: dict):
    """Genera Dual-Brain (Leo vs Max) su un soggetto. Richiede FM MODE ON."""
    st = await db.station.find_one({"_id": "state"}, {"fm_mode": 1}) or {}
    if not st.get("fm_mode"):
        raise HTTPException(409, "Dual-Brain disponibile solo con FM MODE ON")
    subject = (payload.get("subject") or "").strip()[:600]
    if not subject:
        raise HTTPException(400, "subject richiesto")
    try:
        leo_script, max_script = await asyncio.gather(
            llm_generate("anthropic", "claude-sonnet-4-5-20250929", _DUAL_LEO_SYSTEM, f"Difendi con passione: {subject}"),
            llm_generate("anthropic", "claude-sonnet-4-5-20250929", _DUAL_MAX_SYSTEM, f"Critica con ironia: {subject}"),
        )
    except Exception as e:
        raise HTTPException(502, f"Generazione script fallita: {e}")
    try:
        leo_file, max_file = await asyncio.gather(
            elevenlabs_service.synth_speech(leo_script, voice_key="male-1", kind="dual_brain"),
            elevenlabs_service.synth_speech(max_script, voice_key="male-2", kind="dual_brain"),
        )
    except Exception as e:
        raise HTTPException(502, f"TTS fallito: {e}")
    return {
        "subject": subject,
        "leo": {"script": leo_script.strip(), "tts_url": f"/api/tts/{leo_file}" if leo_file else None},
        "max": {"script": max_script.strip(), "tts_url": f"/api/tts/{max_file}" if max_file else None},
        "kind": "dual_brain",
    }


@api_router.post("/admin/dual-brain/inject")
async def admin_dual_brain_inject(payload: dict):
    """Inietta un Dual-Brain nella priority_queue (top-of-queue)."""
    leo = payload.get("leo") or {}
    max_ = payload.get("max") or {}
    if not (leo.get("tts_url") and max_.get("tts_url")):
        raise HTTPException(400, "tts_url mancante")
    seg = {
        "id": str(uuid.uuid4()),
        "kind": "dual_brain",
        "title": f"DUAL-BRAIN · {(payload.get('subject') or 'Scontro di logica')[:80]}",
        "leo_script": leo.get("script"),
        "leo_speech_url": leo.get("tts_url"),
        "max_script": max_.get("script"),
        "max_speech_url": max_.get("tts_url"),
        "priority": True,
        "created_at": now_iso(),
    }
    await db.priority_queue.insert_one(seg.copy())
    return {"ok": True, "injected": seg["id"]}


# ============================================================================
# v13.3 · IDENTITÀ DIGITALE ASCOLTATORI — Avatar AI al primo messaggio
# ============================================================================
_ARCHETYPE_SYSTEM = (
    "Sei R-A.I., una radio AI. Analizzi il testo di un ascoltatore per "
    "assegnargli un ARCHETIPO musicale futuristico. Rispondi con SOLO un JSON "
    'con chiavi {"name": "<archetipo>", "tagline": "<7-10 parole>", '
    '"color_a": "#RRGGBB", "color_b": "#RRGGBB"}. '
    "Archetipi: 'Guerriero Techno', 'Sognatore Ambient', 'Cantastorie Trap', "
    "'Nomade Jazz', 'Sciamano House', 'Poeta Synthwave', 'Alchimista Downtempo', "
    "'Ribelle Punk', 'Viaggiatore Dub', 'Cyberpunk Industrial'. "
    "Scegli quello più adatto al testo dato. Solo JSON, niente altro testo."
)


@api_router.post("/chat/avatar")
async def chat_generate_avatar(payload: dict):
    """Crea o recupera l'identità digitale di un ascoltatore.
    Body: {browser_id, first_message, name?}. Cache per browser_id."""
    browser_id = (payload.get("browser_id") or "").strip()[:80]
    first_msg = (payload.get("first_message") or "").strip()[:500]
    name = (payload.get("name") or "").strip()[:60]
    if not browser_id or not first_msg:
        raise HTTPException(400, "browser_id e first_message richiesti")
    existing = await db.listener_profiles.find_one({"_id": browser_id}, {"_id": 0})
    if existing:
        return {"browser_id": browser_id, **existing, "cached": True}
    # Classifica archetipo
    arche_name = "Nomade Digitale"
    tagline = "Vibrazione neurale in sincronia con R-A.I."
    color_a, color_b = "#00E5FF", "#FF00AA"
    try:
        import json as _json, re as _re
        raw = await llm_generate("gemini", "gemini-3-flash-preview", _ARCHETYPE_SYSTEM,
                                 f"Testo ascoltatore ({name or 'anonimo'}): {first_msg}")
        parsed = None
        try:
            parsed = _json.loads(raw)
        except Exception:
            m = _re.search(r"\{[^}]+\}", raw or "", _re.DOTALL)
            if m:
                try: parsed = _json.loads(m.group(0))
                except Exception: parsed = None
        if parsed:
            arche_name = (parsed.get("name") or arche_name)[:40]
            tagline = (parsed.get("tagline") or tagline)[:120]
            color_a = (parsed.get("color_a") or color_a)[:7]
            color_b = (parsed.get("color_b") or color_b)[:7]
    except Exception as e:
        logger.warning(f"[avatar] classify fail: {e}")
    # Avatar SVG procedurale (zero-cost, on-brand neon)
    import base64 as _b64
    initial = (name or arche_name or "?")[:1].upper()
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        f'<defs><radialGradient id="g" cx="50%" cy="50%">'
        f'<stop offset="0%" stop-color="{color_a}"/>'
        f'<stop offset="100%" stop-color="{color_b}"/></radialGradient></defs>'
        f'<circle cx="50" cy="50" r="48" fill="url(#g)" opacity="0.92"/>'
        f'<circle cx="50" cy="50" r="30" fill="none" stroke="#fff" stroke-width="1.2" opacity="0.7"/>'
        f'<circle cx="50" cy="50" r="18" fill="none" stroke="#fff" stroke-width="0.8" opacity="0.5"/>'
        f'<text x="50" y="60" font-family="monospace" font-size="26" fill="#fff" '
        f'text-anchor="middle" font-weight="bold">{initial}</text></svg>'
    )
    avatar_url = f"data:image/svg+xml;base64,{_b64.b64encode(svg.encode()).decode()}"
    profile = {
        "name": name or "Ascoltatore",
        "archetype": {"name": arche_name, "tagline": tagline, "color_a": color_a, "color_b": color_b},
        "avatar_url": avatar_url,
        "first_message": first_msg,
        "created_at": now_iso(),
    }
    await db.listener_profiles.update_one({"_id": browser_id}, {"$set": profile}, upsert=True)
    return {"browser_id": browser_id, **profile, "cached": False}




# ============================================================================
# v13.6 · TRUE BROADCASTER — Orologio Unico Server-Side
# ============================================================================
# Un unico registro `station.clock` in Mongo dice cosa suona ORA per tutti.
# L'advance-loop lo aggiorna quando la traccia corrente scade. Il player
# HLS e l'endpoint /api/stream/now lo leggono per sincronizzare i client.
# Su Tier 0 il pod dorme quando non ci sono richieste e il loop si ferma:
# alla riattivazione l'advance-loop "salta" al presente saltando le tracce
# che sarebbero già finite, ripartendo dalla successiva coerente.

# ============================================================================
# v13.17 · SMART FLOW TIMELINE — Coda a inserimento libero, soft-sync
# ============================================================================
_CLOCK_QUEUE_LOOKAHEAD = 8   # numero di brani in coda dopo il current
# Sostituisce (o affianca) il Master Clock rigido 24h con una timeline
# minuto-per-minuto. L'admin inserisce eventi con un timestamp preciso.
# L'advance loop pesca eventi dovuti (scheduled_at <= now) SOLO quando il
# brano corrente termina naturalmente (via `_is_expired` che rispetta
# `duration_sec`). Zero troncamenti, mai su onEnded.

async def _timeline_pick_due() -> Optional[dict]:
    """Ritorna un evento timeline maturo (scheduled_at <= now) e lo marca
    come `consumed` atomicamente. Ignora eventi troppo vecchi (>2h).

    v13.29 · Prima di cercare eventi pending, materializza le occorrenze
    imminenti dei template rrule (finestra 90s). Così le regole "Smart
    Recurrence" non hanno bisogno di background task dedicati: la
    materializzazione avviene lungo lo stesso path del clock ticker."""
    await _rrule_materialize_due(window_sec=90)
    now = datetime.now(timezone.utc)
    cutoff_old = (now - timedelta(hours=2)).isoformat()
    now_iso_s = now.isoformat()
    # find_one_and_update per atomicità (concorrenza safe)
    doc = await db.timeline_events.find_one_and_update(
        {"status": "pending",
         "scheduled_at": {"$lte": now_iso_s, "$gte": cutoff_old}},
        {"$set": {"status": "consumed", "consumed_at": now_iso_s}},
        sort=[("scheduled_at", 1)],
        return_document=True,
        projection={"_id": 0},
    )
    if not doc:
        return None
    # v13.22 → v13.23 · Ricorrenza (hourly / daily). Clone PRIMA di ritornare
    # l'evento, così l'occorrenza successiva finisce subito in coda.
    # Backward compat: `repeat_daily=true` è ancora accettato (mappato a daily).
    try:
        recurrence = (doc.get("recurrence") or ("daily" if doc.get("repeat_daily") else "none")).strip().lower()
        if recurrence in ("hourly", "daily", "weekly"):
            try:
                orig_dt = datetime.fromisoformat((doc.get("scheduled_at") or "").replace("Z", "+00:00"))
                if recurrence == "hourly":
                    next_dt = orig_dt + timedelta(hours=1)
                elif recurrence == "weekly":
                    next_dt = orig_dt + timedelta(days=7)
                else:  # daily
                    next_dt = orig_dt + timedelta(days=1)
                clone = {k: v for k, v in doc.items() if k != "_id"}
                clone["id"] = f"tl-{uuid.uuid4().hex[:12]}"
                clone["scheduled_at"] = next_dt.isoformat()
                clone["status"] = "pending"
                clone["parent_id"] = doc.get("id")
                clone["recurrence"] = recurrence
                clone["created_at"] = datetime.now(timezone.utc).isoformat()
                clone.pop("consumed_at", None)
                await db.timeline_events.insert_one(clone)
                logger.info(f"[timeline] ricorrente {recurrence}: {doc.get('id')} → {clone['id']} @ {clone['scheduled_at']}")
            except Exception as e:
                logger.warning(f"[timeline] recurrence clone failed: {e}")
    except Exception:
        pass
    # v13.28 · FIX (Ora Esatta annuncia l'ora sbagliata, ticket #247410):
    # `audio_url` veniva congelato al momento dell'arm (o clonato verbatim
    # a ogni ricorrenza oraria, vedi sopra) pescando la cache più recente
    # per _id invece di quella dell'ora reale in cui l'evento va in onda —
    # il LedWall legge l'ora live e quindi risultava corretto, l'audio no.
    # Qui, appena prima di andare in onda, ri-risolviamo sempre l'audio
    # sulla cache dell'ora REALE corrente (stesso hour_key usato dal
    # pregenerator/percorso automatico). find_one (non delete): l'entry
    # resta disponibile anche per l'eventuale segnale orario automatico.
    if doc.get("kind") == "ora_esatta":
        try:
            from zoneinfo import ZoneInfo
            _it_now = datetime.now(ZoneInfo("Europe/Rome"))
        except Exception:
            _it_now = datetime.now(timezone.utc)
        _hour_key = _it_now.strftime("%Y-%m-%d %H")
        _fresh_ts = await db.time_signal_cache.find_one({"_id": _hour_key})
        if _fresh_ts and _fresh_ts.get("speech_audio_url"):
            doc["audio_url"] = _fresh_ts["speech_audio_url"]
        else:
            logger.warning(f"[ora-esatta] cache miss per hour_key={_hour_key}, uso audio_url congelato come fallback")
    # Costruisce l'entry compatibile con la queue del clock
    entry = {
        "id": doc.get("id") or f"tl-{uuid.uuid4().hex[:10]}",
        "title": doc.get("title") or "Timeline event",
        "artist": doc.get("artist") or doc.get("dj_name") or "R-A.I. Timeline",
        "audio_url": doc.get("audio_url"),
        "duration_sec": int(doc.get("duration_sec") or 30),
        "is_timeline": True,
        "timeline_kind": doc.get("kind"),
        # v13.27 · Espone anche `kind` così LedWall.detectMode() può
        # riconoscere l'evento e attivare la modalità "clock" (segnale
        # orario, jingle) o "talk" (rubrica, insert, spot). Prima il campo
        # `kind` era assente da current per gli eventi Timeline, quindi
        # LedWall cadeva in standby/music invece dell'orologio atomico.
        "kind": doc.get("kind"),
        # v13.18 · DJ assegnato all'evento (Leo/Aria/Max/L&C) — usato dal
        # frontend per mostrare l'avatar e dal player per il fade-in
        "dj_id": doc.get("dj_id"),
        "dj_name": doc.get("dj_name"),
        "voice_key": doc.get("voice_key"),
        # v13.18 · Silence padding: al player serve un'attesa buffer per
        # non tagliare le prime sillabe del talk
        "silence_pad_ms": int(doc.get("silence_pad_ms") or 350),
        # v13.22 · Video override: se l'evento porta un video LedWall,
        # /api/ledwall/state lo mostra per tutta la durata dell'evento e
        # torna automaticamente al default appena l'audio scade.
        "video_url": doc.get("video_url"),
        # v13.24 · Follow-up: quando l'evento entra in onda, il server
        # inserisce SUBITO in cima alla queue del clock il segmento indicato,
        # così la transizione Ora Esatta → Spot è zero-gap (pre-buffering
        # HLS continuo). Il follow-up NON è ricorrente di suo — è agganciato
        # al padre e ripete solo quando ripete il padre.
        "follow_up": doc.get("follow_up") or None,
    }
    if not entry["audio_url"]:
        # Se non c'è audio, marchiamo come skipped e riproviamo
        await db.timeline_events.update_one({"id": doc.get("id")}, {"$set": {"status": "skipped_no_audio"}})
        return None
    return entry


@api_router.post("/admin/timeline")
async def admin_timeline_create(payload: dict):
    """Inserisci un evento nella Smart Flow Timeline.
    Body: {scheduled_at (ISO), kind, title?, artist?, audio_url?, duration_sec?,
           dj_id?, dj_name?, silence_pad_ms?, brief?}.
    Soft-sync: il server attenderà la fine naturale del brano prima di lanciarlo.
    Se `dj_id` è specificato, il record del DJ viene risolto in `dj_name` +
    `voice_key`.

    v13.19 · AUTONOMIA & SOGGETTO
    - Se è presente un DJ E manca `audio_url`, il server genera un talk
      **al momento dell'inserimento** (LLM script + ElevenLabs TTS con la
      voce Turbo v2.5 custom del DJ) e ne cattura la durata reale via
      ffprobe. Zero pre-registrazione richiesta.
    - Se `brief` è non-vuoto, il talk parla ESATTAMENTE di quel soggetto.
    - Se `brief` è vuoto, l'LLM inventa un argomento intelligente,
      calibrato sulla personalità del DJ (comportamento "autonomia totale":
      posso lasciare il campo bianco e il sistema decide da sé).
    """
    sched = (payload.get("scheduled_at") or "").strip()
    if not sched:
        raise HTTPException(400, "scheduled_at richiesto (ISO datetime)")
    try:
        datetime.fromisoformat(sched.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(400, "scheduled_at non parsabile come ISO datetime")

    # Risolvi DJ (opzionale) → recupera name + voice_key + personality
    dj_id = (payload.get("dj_id") or "").strip() or None
    dj_name = (payload.get("dj_name") or "").strip() or None
    voice_key = None
    dj_doc = None
    if dj_id or dj_name:
        q = {"id": dj_id} if dj_id else {"name": dj_name}
        dj_doc = await db.djs.find_one(
            q, {"_id": 0, "id": 1, "name": 1, "voice_key": 1,
                "personality": 1, "llm_provider": 1, "llm_model": 1},
        )
        if dj_doc:
            dj_id = dj_doc.get("id")
            dj_name = dj_doc.get("name")
            voice_key = dj_doc.get("voice_key")

    audio_url = (payload.get("audio_url") or "").strip()
    brief = (payload.get("brief") or "").strip()
    # v13.22 · Soggetto di default UNIVERSALE: se il payload non porta un
    # brief specifico, il server usa quello globale di regia come contesto
    # per la generazione AI. Se anche quello è vuoto, l'LLM inventa da sé.
    if not brief:
        _cfg_st = await db.station.find_one({"_id": "state"}, {"default_subject": 1}) or {}
        default_subj = (_cfg_st.get("default_subject") or "").strip()
        if default_subj:
            brief = default_subj
    # v13.22 · Video override per l'evento (LedWall lo mostra durante la
    # riproduzione, poi torna automaticamente al video di default).
    event_video_url = (payload.get("video_url") or "").strip() or None
    # v13.22 → v13.23 · Ricorrenza: none / hourly / daily / weekly.
    # Backward compat: `repeat_daily=true` mappa a "daily".
    recurrence = (payload.get("recurrence") or "").strip().lower()
    if not recurrence and payload.get("repeat_daily"):
        recurrence = "daily"
    if recurrence not in ("", "none", "hourly", "daily", "weekly"):
        recurrence = "none"
    repeat_daily = (recurrence == "daily")
    # v13.24 · Follow-up: spec di uno spot/jingle da concatenare immediatamente
    # dopo l'evento (zero gap). Il player HLS pre-buffera il segmento mentre
    # l'evento è in onda.
    follow_up_raw = payload.get("follow_up")
    follow_up = None
    if isinstance(follow_up_raw, dict) and (follow_up_raw.get("audio_url") or "").strip():
        follow_up = {
            "audio_url": follow_up_raw["audio_url"].strip(),
            "title": (follow_up_raw.get("title") or "Spot").strip()[:120],
            "artist": (follow_up_raw.get("artist") or "").strip()[:120] or None,
            "duration_sec": int(follow_up_raw.get("duration_sec") or 20),
            "video_url": (follow_up_raw.get("video_url") or "").strip() or None,
        }
    dur_from_payload = int(payload.get("duration_sec") or 30)
    title = (payload.get("title") or "").strip()[:120] or None
    generated_script = None
    generated_topic = None
    event_kind = (payload.get("kind") or "insert").strip()[:40]

    if not audio_url and event_kind == "time_signal":
        # v13.28 · Segnale Orario Timeline: NON richiede DJ. Riusa il segnale
        # orario reale già pre-generato da `_time_signal_pregenerator` in
        # `time_signal_cache` (lo stesso meccanismo standalone già usato da
        # `/admin/timeline/ora-esatta`), invece di generare un dialogo DJ via
        # LLM+TTS. Il DJ resta rilevante solo per eventuali sponsor/voice-intro
        # futuri, non per l'arming di questo tipo di evento.
        ts = await db.time_signal_cache.find_one(
            {"speech_audio_url": {"$exists": True, "$ne": None}},
            sort=[("_id", -1)],
        )
        if not ts or not ts.get("speech_audio_url"):
            raise HTTPException(
                400,
                "Nessun audio Segnale Orario disponibile. Attendi che "
                "`_time_signal_pregenerator` ne pre-generi uno, oppure passa "
                "`audio_url` nel body.",
            )
        audio_url = ts["speech_audio_url"]
        real_dur = await _probe_tts_duration(audio_url)
        dur_from_payload = int(round(real_dur)) + 1 if real_dur else 15
        if not title:
            title = "🕐 Segnale orario"

    if not audio_url:
        # Percorso "autonomo": serve un DJ per generare voce
        if not dj_doc:
            raise HTTPException(
                400,
                "Serve `audio_url` OPPURE selezionare un DJ (con Brief opzionale) "
                "per generare il talk automaticamente.",
            )
        # 1) Costruisci il prompt LLM
        personality = dj_doc.get("personality") or ""
        provider = dj_doc.get("llm_provider") or "openai"
        model = dj_doc.get("llm_model") or "gpt-5.2"
        if brief:
            user_prompt = (
                f"Prepara un intervento radiofonico breve (60-90 parole, max ~30 secondi "
                f"di lettura) su questo argomento: \"{brief}\".\n"
                f"Tono, voce e ironia devono essere fedeli alla tua personalità di DJ. "
                f"Parla come se fossi in diretta su R-A.I., in prima persona, senza spiegare "
                f"cosa stai per dire. Chiudi con una battuta o un cliffhanger. "
                f"Solo il testo del parlato, nessuna didascalia scenica."
            )
            generated_topic = brief[:120]
        else:
            user_prompt = (
                "Sei in diretta su R-A.I. Genera **spontaneamente** un intervento radiofonico "
                "breve (60-90 parole, max ~30 secondi di lettura) su un argomento a tua scelta "
                "coerente con la tua personalità: potrebbe essere una curiosità, un pensiero "
                "provocatorio, un ricordo assurdo, una micro-rubrica scientifica o culturale, "
                "una battuta di attualità. Parla in prima persona, con tono da radio live, "
                "senza spiegare cosa stai per dire. Solo il testo del parlato, nessuna "
                "didascalia scenica. Sorprendimi."
            )
        system_prompt = (
            f"Sei {dj_doc.get('name')}, speaker di R-A.I. — {personality}\n"
            f"Rispondi SOLO con il testo che pronuncerai in radio (max 90 parole)."
        )
        try:
            script = await llm_generate(provider, model, system_prompt, user_prompt)
        except Exception as e:
            logger.warning(f"[TIMELINE] LLM generation failed: {e}")
            script = ""
        script = (script or "").strip()
        if not script:
            raise HTTPException(502, "LLM non ha prodotto testo (credit budget o rete)")
        generated_script = script

        # 2) TTS via ElevenLabs con la voce custom del DJ
        # Nota: `synth_speech()` (wrapper server.py) ritorna (filename, subpath).
        try:
            fname, subpath = await synth_speech(script, voice_key=voice_key or "female-1", kind="answer")
        except Exception as e:
            logger.warning(f"[TIMELINE] TTS synth failed: {e}")
            fname, subpath = None, None
        if not fname:
            raise HTTPException(502, "TTS non ha prodotto audio (ElevenLabs down o budget)")
        audio_url = f"/api/{subpath or 'tts'}/{fname}"

        # 3) Durata reale del file (ffprobe). Fallback stima 0.25s/parola.
        real_dur = await _probe_tts_duration(audio_url)
        if not real_dur:
            words = max(1, len(script.split()))
            real_dur = max(6.0, min(90.0, words * 0.42))
        dur_from_payload = int(round(real_dur)) + 2  # +2s coda di sicurezza

        if not title:
            title = (brief[:60] if brief else f"{dj_doc.get('name')} · improvviso")

    ev = {
        "id": f"tl-{uuid.uuid4().hex[:12]}",
        "scheduled_at": sched,
        "kind": event_kind,
        "title": title,
        "artist": (payload.get("artist") or (dj_name and f"{dj_name}") or "").strip()[:120] or None,
        "audio_url": audio_url,
        "duration_sec": dur_from_payload,
        "dj_id": dj_id,
        "dj_name": dj_name,
        "voice_key": voice_key,
        "brief": brief or None,
        "generated_topic": generated_topic,
        "generated_script": (generated_script[:500] if generated_script else None),
        "silence_pad_ms": int(payload.get("silence_pad_ms") or 350),
        "video_url": event_video_url,
        "repeat_daily": repeat_daily,
        "recurrence": recurrence or "none",
        "follow_up": follow_up,
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.timeline_events.insert_one(ev.copy())
    ev.pop("_id", None)
    return {"ok": True, "event": ev}


@api_router.get("/admin/timeline")
async def admin_timeline_list(status: str = "pending", limit: int = 100):
    """Elenca gli eventi timeline. `status`: pending|consumed|skipped_no_audio|template|all."""
    q = {} if status == "all" else {"status": status}
    rows = await db.timeline_events.find(q, {"_id": 0}).sort("scheduled_at", 1).limit(min(limit, 500)).to_list(500)
    return {"events": rows, "count": len(rows)}


@api_router.delete("/admin/timeline/{event_id}")
async def admin_timeline_delete(event_id: str):
    """v13.29 · Cascade delete: se `event_id` è un template rrule, elimina
    anche TUTTE le occorrenze figlie pending future (parent_id = template.id).
    Le occorrenze già consumate restano come storico immutabile."""
    doc = await db.timeline_events.find_one({"id": event_id}, {"_id": 0, "status": 1})
    r = await db.timeline_events.delete_one({"id": event_id})
    cascaded = 0
    if doc and doc.get("status") == "template":
        cr = await db.timeline_events.delete_many({"parent_id": event_id, "status": "pending"})
        cascaded = cr.deleted_count
    return {"ok": r.deleted_count > 0, "cascaded_children": cascaded}


# ============================================================================
# v13.29 · SMART RECURRENCE ENGINE
# ----------------------------------------------------------------------------
# rrule = {
#   start_hour, end_hour (int 0-23, supporta wraparound overnight),
#   anchor_minute (int 0-59, default 0),
#   frequency_minutes (int, es. 60 = ogni ora, 30 = ogni mezz'ora),
#   days_of_week (list int 0-6, Mon=0..Sun=6, default tutti),
#   start_date (ISO yyyy-mm-dd, default oggi),
#   end_date   (ISO yyyy-mm-dd o null, default null = infinito)
# }
# Un evento con status="template" NON viene mai promosso da _timeline_pick_due:
# è puro parent che genera occorrenze concrete via _rrule_materialize + virtual
# per il calendar preview.
# ============================================================================
def _rrule_expand(rrule: dict, from_dt: datetime, to_dt: datetime, anchor_dt: Optional[datetime] = None):
    """Ritorna una lista di datetime (UTC) delle occorrenze dell'rrule
    nell'intervallo [from_dt, to_dt]. `anchor_dt` è la data di inizio del
    template (default = from_dt). Deterministico + puro."""
    if not rrule:
        return []
    try:
        sh = int(rrule.get("start_hour", 0)) % 24
        eh = int(rrule.get("end_hour", 24)) % 25
        anchor_min = int(rrule.get("anchor_minute", 0)) % 60
        freq_min = max(1, int(rrule.get("frequency_minutes", 60)))
        dow = rrule.get("days_of_week")
        dow_set = set(int(d) for d in dow) if isinstance(dow, list) and dow else set(range(7))
        start_date_s = (rrule.get("start_date") or "").strip()
        end_date_s = (rrule.get("end_date") or "").strip()
        if start_date_s:
            sd = datetime.fromisoformat(start_date_s.replace("Z", "+00:00"))
            if sd.tzinfo is None: sd = sd.replace(tzinfo=timezone.utc)
        else:
            sd = anchor_dt or from_dt
        ed = None
        if end_date_s:
            ed = datetime.fromisoformat(end_date_s.replace("Z", "+00:00"))
            if ed.tzinfo is None: ed = ed.replace(tzinfo=timezone.utc)
    except Exception:
        return []

    out = []
    # Itera giorno per giorno all'interno di [max(from,sd), min(to,ed)]
    day_from = max(from_dt, sd).astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    day_to = to_dt.astimezone(timezone.utc)
    if ed:
        day_to = min(day_to, ed)
    if day_from > day_to:
        return []
    day = day_from
    max_iterations = 400  # safety cap
    iterations = 0
    while day <= day_to and iterations < max_iterations:
        iterations += 1
        weekday = day.weekday()  # Mon=0
        if weekday in dow_set:
            # Determina finestra oraria per questo giorno
            if eh > sh:
                # Finestra normale (es. 06→22)
                start_ts = day.replace(hour=sh, minute=anchor_min)
                end_ts = day.replace(hour=(eh if eh < 24 else 23), minute=(59 if eh >= 24 else 0))
                ts = start_ts
                while ts <= end_ts and ts <= to_dt:
                    if ts >= from_dt:
                        out.append(ts)
                    ts += timedelta(minutes=freq_min)
            else:
                # Wraparound overnight (es. 23→04): due segmenti
                # Segmento serale del giorno corrente: [sh:anchor, 23:59]
                start_ts = day.replace(hour=sh, minute=anchor_min)
                end_ts = day.replace(hour=23, minute=59)
                ts = start_ts
                while ts <= end_ts and ts <= to_dt:
                    if ts >= from_dt:
                        out.append(ts)
                    ts += timedelta(minutes=freq_min)
                # Segmento mattutino del giorno SUCCESSIVO: [00:anchor, eh:00]
                # (solo se il giorno successivo è nel range)
                next_day = day + timedelta(days=1)
                if next_day <= day_to:
                    seg_start = next_day.replace(hour=0, minute=anchor_min)
                    seg_end = next_day.replace(hour=eh, minute=0)
                    ts = seg_start
                    while ts <= seg_end and ts <= to_dt:
                        if ts >= from_dt:
                            out.append(ts)
                        ts += timedelta(minutes=freq_min)
        day += timedelta(days=1)
    return out[:1000]  # hard cap


async def _rrule_materialize_due(window_sec: int = 90):
    """Materializza in `timeline_events` (status=pending) le occorrenze dei
    template rrule che scoccano entro `window_sec` da adesso. Idempotente:
    se un'occorrenza (parent_id + scheduled_at) esiste già, non la duplica.
    Chiamato da `_timeline_pick_due` in cima al soft-sync check."""
    try:
        now = datetime.now(timezone.utc)
        to_dt = now + timedelta(seconds=window_sec)
        templates = await db.timeline_events.find(
            {"status": "template", "rrule": {"$ne": None}},
            {"_id": 0},
        ).to_list(200)
        for tpl in templates:
            occurrences = _rrule_expand(tpl.get("rrule") or {}, now, to_dt)
            for occ in occurrences:
                occ_iso = occ.isoformat()
                # Dedup: la coppia (parent_id, scheduled_at) è unica
                existing = await db.timeline_events.find_one(
                    {"parent_id": tpl["id"], "scheduled_at": occ_iso},
                    {"_id": 0, "id": 1},
                )
                if existing:
                    continue
                # Nuovo child concreto — copia il template ma override id/status/scheduled_at
                child = {k: v for k, v in tpl.items() if k not in ("_id", "id", "status", "rrule", "created_at")}
                child["id"] = f"tl-{uuid.uuid4().hex[:12]}"
                child["scheduled_at"] = occ_iso
                child["status"] = "pending"
                child["parent_id"] = tpl["id"]
                child["from_rrule"] = True
                child["created_at"] = now.isoformat()
                await db.timeline_events.insert_one(child)
    except Exception as e:
        logger.debug(f"[rrule] materialize failed: {e}")


@api_router.post("/admin/timeline/rrule")
async def admin_timeline_create_rrule(payload: dict):
    """v13.29 · Crea un template rrule (parent) che genererà occorrenze
    concrete (children pending) man mano che le rispettive scadenze si
    avvicinano. Il calendar API espande le occorrenze future in modo
    virtuale per la visualizzazione a settimana/mese.

    Body: {kind, title?, audio_url, duration_sec?, dj_id?, dj_name?, video_url?,
           rrule: {start_hour, end_hour, anchor_minute?, frequency_minutes,
                   days_of_week?, start_date?, end_date?}, brief?}"""
    rrule = payload.get("rrule") or {}
    if not isinstance(rrule, dict) or rrule.get("frequency_minutes") is None:
        raise HTTPException(400, "rrule.frequency_minutes richiesto")
    audio_url = (payload.get("audio_url") or "").strip()
    if not audio_url:
        raise HTTPException(400, "audio_url richiesto per il template")
    # Risolvi DJ opzionale
    dj_id = (payload.get("dj_id") or "").strip() or None
    dj_name = (payload.get("dj_name") or "").strip() or None
    voice_key = None
    if dj_id or dj_name:
        q = {"id": dj_id} if dj_id else {"name": dj_name}
        dj_doc = await db.djs.find_one(q, {"_id": 0, "id": 1, "name": 1, "voice_key": 1})
        if dj_doc:
            dj_id = dj_doc.get("id"); dj_name = dj_doc.get("name"); voice_key = dj_doc.get("voice_key")
    # Sanitize rrule
    clean_rrule = {
        "start_hour": max(0, min(23, int(rrule.get("start_hour", 0)))),
        "end_hour": max(0, min(24, int(rrule.get("end_hour", 24)))),
        "anchor_minute": max(0, min(59, int(rrule.get("anchor_minute", 0)))),
        "frequency_minutes": max(1, min(1440, int(rrule.get("frequency_minutes", 60)))),
        "days_of_week": [int(d) for d in (rrule.get("days_of_week") or list(range(7))) if 0 <= int(d) <= 6],
        "start_date": (rrule.get("start_date") or datetime.now(timezone.utc).date().isoformat()),
        "end_date": (rrule.get("end_date") or None),
    }
    now = datetime.now(timezone.utc)
    tpl = {
        "id": f"tpl-{uuid.uuid4().hex[:12]}",
        "kind": (payload.get("kind") or "insert").strip()[:40],
        "title": (payload.get("title") or "").strip()[:120] or None,
        "audio_url": audio_url,
        "duration_sec": int(payload.get("duration_sec") or 30),
        "dj_id": dj_id, "dj_name": dj_name, "voice_key": voice_key,
        "brief": (payload.get("brief") or "").strip() or None,
        "video_url": (payload.get("video_url") or "").strip() or None,
        "rrule": clean_rrule,
        "status": "template",
        "scheduled_at": now.isoformat(),  # solo per ordinamento; il vero orario è dato da rrule
        "created_at": now.isoformat(),
    }
    await db.timeline_events.insert_one(tpl.copy())
    tpl.pop("_id", None)
    return {"ok": True, "template": tpl}


@api_router.get("/admin/timeline/calendar")
async def admin_timeline_calendar(from_ts: str, to_ts: str, limit_virtual: int = 500):
    """v13.29 · Espone eventi concreti + occorrenze virtuali dei template
    rrule nell'intervallo [from_ts, to_ts]. Le occorrenze già materializzate
    come children non vengono duplicate come virtual.

    Rileva anche conflitti (overlap): per ogni evento aggiunge una lista
    `conflicts` con gli id degli eventi che si sovrappongono.
    Precedenza: al conflitto vince il `created_at` più recente."""
    try:
        f_dt = datetime.fromisoformat(from_ts.replace("Z", "+00:00"))
        t_dt = datetime.fromisoformat(to_ts.replace("Z", "+00:00"))
        if f_dt.tzinfo is None: f_dt = f_dt.replace(tzinfo=timezone.utc)
        if t_dt.tzinfo is None: t_dt = t_dt.replace(tzinfo=timezone.utc)
    except Exception:
        raise HTTPException(400, "from_ts/to_ts ISO datetime richiesti")

    # 1) Eventi concreti in range (pending + consumed)
    concrete = await db.timeline_events.find(
        {"status": {"$in": ["pending", "consumed"]},
         "scheduled_at": {"$gte": f_dt.isoformat(), "$lte": t_dt.isoformat()}},
        {"_id": 0},
    ).sort("scheduled_at", 1).to_list(1000)

    # 2) Templates + expand virtuali
    templates = await db.timeline_events.find(
        {"status": "template", "rrule": {"$ne": None}}, {"_id": 0},
    ).to_list(200)
    # Set di (parent_id, scheduled_at) già materializzati → non duplicare come virtual
    materialized_keys = {(e.get("parent_id"), e.get("scheduled_at")) for e in concrete if e.get("parent_id")}
    virtuals = []
    for tpl in templates:
        occs = _rrule_expand(tpl.get("rrule") or {}, f_dt, t_dt)
        for occ in occs[:limit_virtual]:
            key = (tpl["id"], occ.isoformat())
            if key in materialized_keys:
                continue
            v = {k: v for k, v in tpl.items() if k not in ("_id", "id", "status", "rrule", "created_at")}
            v["id"] = f"virt-{tpl['id']}-{int(occ.timestamp())}"
            v["scheduled_at"] = occ.isoformat()
            v["status"] = "virtual"
            v["parent_id"] = tpl["id"]
            v["is_virtual"] = True
            virtuals.append(v)

    events = concrete + virtuals
    events.sort(key=lambda e: e.get("scheduled_at") or "")

    # 3) Conflict detection: overlap con evento più recente vince
    def _end(e):
        try:
            s = datetime.fromisoformat((e.get("scheduled_at") or "").replace("Z", "+00:00"))
            return s + timedelta(seconds=int(e.get("duration_sec") or 0))
        except Exception:
            return None
    starts = []
    for e in events:
        try:
            starts.append(datetime.fromisoformat((e.get("scheduled_at") or "").replace("Z", "+00:00")))
        except Exception:
            starts.append(None)
    for i, e in enumerate(events):
        s_i, en_i = starts[i], _end(e)
        if s_i is None or en_i is None:
            continue
        confs = []
        for j, e2 in enumerate(events):
            if i == j: continue
            s_j, en_j = starts[j], _end(e2)
            if s_j is None or en_j is None: continue
            # overlap check
            if s_i < en_j and s_j < en_i:
                confs.append(e2.get("id"))
        if confs:
            e["conflicts"] = confs

    return {
        "from": f_dt.isoformat(),
        "to": t_dt.isoformat(),
        "events": events,
        "counts": {"concrete": len(concrete), "virtual": len(virtuals), "total": len(events)},
        "templates": [{"id": t["id"], "kind": t.get("kind"), "title": t.get("title"), "rrule": t.get("rrule")} for t in templates],
    }



_DJ_EVERY_N_TRACKS = 3       # v13.16 · un jingle DJ ogni 3 brani musicali


async def _probe_tts_duration(url: Optional[str], pad_sec: float = 0.0) -> Optional[float]:
    """v13.18 · Ritorna la durata reale (ffprobe) di un file TTS locale, o
    None se il file non esiste su disco — MAI un valore indovinato. Prima di
    questa fix un file TTS mancante produceva comunque un elemento in coda
    con una durata di ripiego, puntando a un URL che risponde 404: il player
    hls.js andava in errore fatale a metà riproduzione e restava fermo per
    sempre (nessun listener di recovery). Restituire None qui permette al
    chiamante di scartare il segmento invece di mandarlo in onda.

    v13.20 · `pad_sec` (default 0, stesso comportamento di prima per i
    chiamanti esistenti che già applicano il proprio padding, es. la
    Timeline). I chiamanti del clock DJ passano pad_sec=2.0 — stessa coda
    di sicurezza già usata da `/api/admin/timeline` — perché ffprobe su
    MP3 VBR può sottostimare la durata reale: senza il padding il clock
    passava al segmento successivo un attimo prima che l'audio finisse
    davvero, tagliando le ultime parole del DJ.

    v13.25 · esteso a QUALSIASI audio locale (/api/tts/, /api/suno_audio/,
    /api/audio/, /api/community_audio/): stessa logica, resolve del path
    su disco + probe ffprobe. Rimpiazza la vecchia stima 0.25s/parola per
    tutte le tracce ingerite → il clock virtuale non taglia più l'inizio
    della prossima traccia perché la durata è sempre reale."""
    if not url:
        return None
    try:
        path: Optional[Path] = None
        if url.startswith("/api/tts/"):
            fname = url.replace("/api/tts/", "").split("?")[0]
            path = elevenlabs_service.TTS_DIR / fname
        elif url.startswith("/api/suno_audio/"):
            fname = url.replace("/api/suno_audio/", "").split("?")[0]
            path = SUNO_AUDIO_DIR / fname
        elif url.startswith("/api/community_audio/"):
            fname = url.replace("/api/community_audio/", "").split("?")[0]
            path = COMMUNITY_AUDIO_DIR / fname
        elif url.startswith("/api/audio/"):
            fname = url.replace("/api/audio/", "").split("?")[0]
            path = AUDIO_DIR / fname
        else:
            return None
        if not path or not path.exists():
            return None
        probe = await video_service.probe_video(str(path))
        d = (probe or {}).get("duration_sec")
        return float(d) + pad_sec if d else None
    except Exception:
        return None


# ============================================================================
# v13.25 · AUDIO NORMALIZATION PIPELINE
# ----------------------------------------------------------------------------
# Riprocessa un file audio in un formato broadcast-safe consistente:
#   • MP3 (libmp3lame)  · 44.1 kHz  · stereo · 128 kbps CBR
#   • rimozione tag ID3 non essenziali (ffmpeg -map_metadata -1)
#   • riscrittura header/index frame (write_xing) → durata VBR affidabile
# Serve a evitare glitch/click al confine formato tra canzone→voce→canzone
# specie sui decoder Bluetooth per auto e Chromecast, che sono meno tolleranti
# alle variazioni di sample-rate/canali all'interno di un flusso HLS EVENT.
# ============================================================================
_NORMALIZE_SAMPLE_RATE = 44100
_NORMALIZE_CHANNELS = 2
_NORMALIZE_BITRATE = "128k"


def _normalize_audio_file_sync(src_path: str) -> Optional[dict]:
    """Sincrona (chiamare via asyncio.to_thread). Ritorna dict con
    duration_sec + normalized_bytes (bytes) o None se ffmpeg fallisce.
    Il file di partenza NON viene toccato in place — il chiamante decide."""
    import subprocess, tempfile, shutil, os as _os
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        return None
    if not _os.path.exists(src_path):
        return None
    tmp_dir = tempfile.mkdtemp(prefix="norm_")
    dst_path = _os.path.join(tmp_dir, "out.mp3")
    try:
        cmd = [
            "ffmpeg", "-nostdin", "-y", "-i", src_path,
            "-vn", "-map_metadata", "-1",
            "-ar", str(_NORMALIZE_SAMPLE_RATE),
            "-ac", str(_NORMALIZE_CHANNELS),
            "-codec:a", "libmp3lame",
            "-b:a", _NORMALIZE_BITRATE,
            "-write_xing", "1",
            dst_path,
        ]
        r = subprocess.run(cmd, capture_output=True, timeout=180)
        if r.returncode != 0 or not _os.path.exists(dst_path):
            return None
        # Probe della durata REALE del file normalizzato
        pr = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", dst_path],
            capture_output=True, timeout=30,
        )
        try:
            duration = float(pr.stdout.decode().strip())
        except Exception:
            duration = 0.0
        with open(dst_path, "rb") as f:
            data = f.read()
        return {"duration_sec": duration, "normalized_bytes": data, "size": len(data)}
    except Exception:
        return None
    finally:
        try: shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception: pass


async def _normalize_audio_file(src_path: str) -> Optional[dict]:
    return await asyncio.to_thread(_normalize_audio_file_sync, src_path)


def _resolve_local_path_from_url(url: str) -> Optional[Path]:
    """Traduce un URL audio locale (/api/tts/*, /api/suno_audio/*, ...) al
    percorso fisico su disco. Ritorna None se URL non riconosciuto."""
    if not url or not url.startswith("/api/"):
        return None
    if url.startswith("/api/tts/"):
        return elevenlabs_service.TTS_DIR / url.replace("/api/tts/", "").split("?")[0]
    if url.startswith("/api/suno_audio/"):
        return SUNO_AUDIO_DIR / url.replace("/api/suno_audio/", "").split("?")[0]
    if url.startswith("/api/community_audio/"):
        return COMMUNITY_AUDIO_DIR / url.replace("/api/community_audio/", "").split("?")[0]
    if url.startswith("/api/audio/"):
        return AUDIO_DIR / url.replace("/api/audio/", "").split("?")[0]
    return None


@api_router.post("/admin/audio/reprobe-durations")
async def admin_audio_reprobe_durations(limit: int = 500):
    """v13.25 · Ricalcola `duration_sec` per le tracce esistenti usando
    ffprobe sul file fisico. Aggiunge 0.4s di margine di sicurezza per
    evitare che lo `station_clock` avanzi un attimo prima che l'audio finisca
    (taglio dell'inizio del brano successivo su decoder Bluetooth).
    Idempotente: si può rilanciare in sicurezza dopo ogni ingest."""
    updated = 0
    scanned = 0
    skipped_missing = 0
    async for t in db.tracks.find({}, {"_id": 0, "id": 1, "audio_url": 1, "duration_sec": 1}).limit(limit):
        scanned += 1
        url = t.get("audio_url") or ""
        p = _resolve_local_path_from_url(url)
        if not p or not p.exists():
            skipped_missing += 1
            continue
        try:
            probe = await video_service.probe_video(str(p))
            d = (probe or {}).get("duration_sec")
            if not d or d <= 0:
                continue
            real = float(d) + 0.4  # safety margin
            # Aggiorna solo se scostamento >0.5s per non thrashare il DB
            if abs(real - float(t.get("duration_sec") or 0)) < 0.5:
                continue
            await db.tracks.update_one(
                {"id": t["id"]},
                {"$set": {"duration_sec": round(real), "duration_probed_at": now_iso()}},
            )
            updated += 1
        except Exception as e:
            logger.debug(f"[reprobe] fail {t.get('id')}: {e}")
    return {"ok": True, "scanned": scanned, "updated": updated, "skipped_missing": skipped_missing}


@api_router.post("/admin/audio/normalize/{track_id}")
async def admin_audio_normalize_one(track_id: str):
    """v13.25 · Normalizza in place UN singolo file audio (44.1kHz stereo
    128kbps MP3), sovrascrive il file locale e aggiorna `duration_sec` sul
    record `tracks`. Non chiama nessuna AI. Rispetta il kill-switch: se
    il file non è locale (URL esterno) ritorna un errore chiaro."""
    t = await db.tracks.find_one({"id": track_id}, {"_id": 0, "id": 1, "audio_url": 1})
    if not t:
        raise HTTPException(404, "Track non trovata")
    p = _resolve_local_path_from_url(t.get("audio_url") or "")
    if not p or not p.exists():
        raise HTTPException(400, f"File locale non trovato per URL {t.get('audio_url')!r}")
    result = await _normalize_audio_file(str(p))
    if not result:
        raise HTTPException(500, "ffmpeg normalize fallito (verifica installazione ffmpeg)")
    try:
        with open(str(p), "wb") as f:
            f.write(result["normalized_bytes"])
    except Exception as e:
        raise HTTPException(500, f"Scrittura file fallita: {e}")
    real = float(result["duration_sec"]) + 0.4
    await db.tracks.update_one(
        {"id": track_id},
        {"$set": {"duration_sec": round(real, 3),
                  "normalized_at": now_iso(),
                  "duration_probed_at": now_iso()}},
    )
    return {"ok": True, "duration_sec": round(real, 3), "size": result["size"]}


async def _clock_pick_spoken_segment() -> Optional[dict]:
    """v13.17 · Pesca un segmento parlato pronto dalla priority_queue
    (Dual-Brain, Pillole FM, Voice Live/community) e lo normalizza in un
    elemento riproducibile dal clock sincronizzato (stesso shape usato da
    _clock_pick_track/_clock_pick_dj_jingle: id/title/artist/audio_url/
    duration_sec). Prima di questa fix i segmenti parlati restavano
    intrappolati in priority_queue perché _clock_advance() leggeva solo
    tracce musicali e jingle preregistrati, mai la coda prioritaria — quindi
    la voce dei DJ non arrivava mai al player live anche con FM MODE attivo.

    Se il documento contiene più voci (es. Dual-Brain Leo+Max) ne riproduce
    una e rimette la restante in coda per il prossimo turno DJ. v13.18 · se
    il file audio manca su disco il segmento viene scartato (mai una durata
    indovinata su un URL che punta a un 404)."""
    pq_doc = await db.priority_queue.find_one_and_delete({}, sort=[("created_at", 1)])
    if not pq_doc:
        return None

    kind = pq_doc.get("kind")
    if kind == "dual_brain":
        leo_url = pq_doc.get("leo_speech_url")
        max_url = pq_doc.get("max_speech_url")
        if leo_url:
            dur = await _probe_tts_duration(leo_url, pad_sec=2.0)
            if dur is not None:
                if max_url:
                    # rimette Max in coda (created_at aggiornato) per il prossimo turno DJ
                    remainder = dict(pq_doc)
                    remainder["leo_speech_url"] = None
                    remainder["created_at"] = now_iso()
                    await db.priority_queue.insert_one(remainder)
                return {
                    "id": f"{pq_doc['id']}-leo", "title": pq_doc.get("title") or "Dual-Brain · Leo",
                    "artist": "Leo", "audio_url": leo_url, "duration_sec": dur,
                }
            leo_url = None  # file mancante: prova Max sotto
        if max_url:
            dur = await _probe_tts_duration(max_url, pad_sec=2.0)
            if dur is not None:
                return {
                    "id": f"{pq_doc['id']}-max", "title": pq_doc.get("title") or "Dual-Brain · Max",
                    "artist": "Max", "audio_url": max_url, "duration_sec": dur,
                }
        return None
    if kind in ("pill_past", "pill_future"):
        url = pq_doc.get("speech_url")
        dur = await _probe_tts_duration(url, pad_sec=2.0)
        if dur is None:
            return None
        return {
            "id": pq_doc["id"], "title": pq_doc.get("title") or "Pillola R-A.I.",
            "artist": "R-A.I.", "audio_url": url, "duration_sec": dur,
        }
    # fallback generico: segmenti tipo "answer"/voice_live con audio già pronto
    # (musica caricata dall'utente / storage esterno, non un file TTS locale
    # da probare — usiamo la duration_sec già presente sul documento)
    url = pq_doc.get("music_audio_url") or pq_doc.get("audio_url")
    if not url:
        return None
    return {
        "id": pq_doc.get("id") or str(uuid.uuid4()),
        "title": pq_doc.get("title") or "Segmento DJ",
        "artist": pq_doc.get("dj_name") or "R-A.I.",
        "audio_url": url,
        "duration_sec": float(pq_doc.get("duration_sec") or 30),
    }


_ON_DEMAND_DJ_RUBRICS = ["talk", "history", "interview", "joke", "motivation", "horoscope", "news"]
_dj_pregen_task: Optional[asyncio.Task] = None  # v13.20 · un solo pregen in volo alla volta


async def _clock_pick_dj_voice_segment() -> Optional[dict]:
    """v13.20 · Turno DJ: legge SOLO un segmento parlato già pronto in
    priority_queue (fast path, nessuna generazione bloccante). La coda viene
    rifornita in anticipo da `_dj_pregen_ticker` in background, non più qui.

    Prima della v13.20 la generazione on-demand (script LLM + TTS ElevenLabs,
    ~4-5s) girava SINCRONA dentro `_clock_advance()`, che è chiamato da
    `/api/stream/now` — l'endpoint che OGNI client polla per sincronizzarsi.
    Se la coda era vuota nel momento esatto del turno DJ, quella richiesta
    (e quindi lo stream per tutti) restava bloccata per la durata della
    generazione, producendo il buco/silenzio segnalato dal cliente. Ora, se
    la coda è vuota, si ripiega subito (non-bloccante) sul jingle preregistrato
    e il pregen in background prepara la prossima voce in anticipo."""
    return await _clock_pick_spoken_segment()


async def _dj_pregen_ticker():
    """v13.20 · Rifornisce priority_queue in background, MAI dentro una
    richiesta HTTP. Gira ogni 5s; genera un nuovo segmento DJ on-demand solo
    se la coda è sotto soglia e non c'è già una generazione in volo, così
    _clock_pick_dj_voice_segment trova quasi sempre l'audio già pronto invece
    di dover ripiegare sul jingle per il turno corrente.

    v13.21 · KILL-SWITCH & BACKOFF (SENZA SPRECHI):
      • Se l'AI-switch `ai_openai_talk` è OFF, salta il tick senza toccare
        LLM/TTS. Difesa contro il bug che aveva bruciato la Universal Key.
      • Se il tick precedente è fallito (nessun audio prodotto), aspetta
        5 minuti prima di riprovare invece dei 5 secondi standard: evita
        di martellare provider LLM/TTS in disservizio.
    """
    global _dj_pregen_task
    _PREGEN_MIN_QUEUED = 1
    _last_task_failed = False
    while True:
        try:
            # Backoff: se l'ultima pregen è fallita, attesa lunga (5 min).
            await asyncio.sleep(300 if _last_task_failed else 5)
            # KILL-SWITCH: se il toggle "AI OpenAI Talk" è OFF, non chiamare
            # generate_segment(), non chiamare alcun LLM. Passa al tick dopo.
            try:
                _ai = await _get_ai_controls()
            except Exception:
                _ai = {}
            if not _ai.get("ai_openai_talk"):
                # Log periodicamente (~ogni 5min) quando il kill-switch è attivo,
                # così la regia ha prova che il ticker rispetta il toggle.
                _last_task_failed = False
                import time as _time
                if int(_time.time()) % 300 < 6:
                    logger.info("[dj-pregen] SKIP tick · ai_openai_talk=OFF (kill-switch attivo, zero LLM)")
                continue
            if _dj_pregen_task and not _dj_pregen_task.done():
                continue
            queued = await db.priority_queue.count_documents({})
            if queued >= _PREGEN_MIN_QUEUED:
                _last_task_failed = False
                continue
            _dj_pregen_task = asyncio.create_task(_dj_pregen_once())
            # Osserva l'esito per decidere il backoff del prossimo giro.
            async def _watch(t):
                nonlocal_ref["failed"] = False
                try:
                    r = await t
                    nonlocal_ref["failed"] = not bool(r)
                except Exception:
                    nonlocal_ref["failed"] = True
            nonlocal_ref = {"failed": False}
            try:
                await _watch(_dj_pregen_task)
            except Exception:
                nonlocal_ref["failed"] = True
            _last_task_failed = bool(nonlocal_ref.get("failed"))
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.warning(f"[clock] dj pregen tick error: {e}")
            _last_task_failed = True


async def _dj_pregen_once():
    """Genera un segmento DJ (script LLM + TTS ElevenLabs) e lo mette in
    priority_queue per un turno DJ futuro. Fallisce in silenzio (es. credito
    LLM/TTS esaurito) — il chiamante del turno corrente ripiega sul jingle
    comunque, questa è solo pre-produzione best-effort.

    Ritorna `True` se ha effettivamente prodotto e accodato un segmento,
    `False` altrimenti (usato dal ticker per attivare il backoff 5min).
    """
    # v13.21 · KILL-SWITCH DIFENSIVO — anche se il ticker ci chiama, ricontrolla
    # l'AI switch all'inizio: nessun LLM/TTS se `ai_openai_talk` è OFF.
    try:
        _ai = await _get_ai_controls()
    except Exception:
        _ai = {}
    if not _ai.get("ai_openai_talk"):
        return False
    try:
        rubric = random.choice(_ON_DEMAND_DJ_RUBRICS)
        seg = await generate_segment(kind=rubric)
        if not seg or not seg.speech_audio_url:
            return False
        dur = await _probe_tts_duration(seg.speech_audio_url, pad_sec=2.0)
        if dur is None:
            return False
        await db.priority_queue.insert_one({
            "id": seg.id, "kind": "answer", "title": seg.title or "R-A.I. Talk",
            "dj_name": seg.dj_name or "R-A.I.", "audio_url": seg.speech_audio_url,
            "duration_sec": dur, "created_at": now_iso(),
        })
        return True
    except Exception as e:
        logger.warning(f"[clock] on-demand DJ pregen failed: {e}")
        return False


async def _clock_pick_dj_jingle() -> Optional[dict]:
    """Pesca un jingle DJ dalla libreria (`tracks.is_jingle=true`). Sono file
    audio brevi (10-25s) preregistrati con le voci Leo/Aria/Max — permettono
    di avere la voce dei DJ nel flusso HLS senza dipendere da TTS live."""
    _now_iso_s = datetime.now(timezone.utc).isoformat()
    q = {
        "is_jingle": True, "status": "ready", "audio_url": {"$ne": None},
        "on_air": {"$ne": False}, "deleted_at": None,
        "$or": [{"start_date": {"$exists": False}}, {"start_date": None}, {"start_date": {"$lte": _now_iso_s}}],
        "$and": [{"$or": [{"end_date": {"$exists": False}}, {"end_date": None}, {"end_date": {"$gte": _now_iso_s}}]}],
    }
    tr = await db.tracks.find_one(q, {"_id": 0, "id": 1, "title": 1, "artist": 1,
                                       "audio_url": 1, "duration_sec": 1},
                                   sort=[("last_played_at", 1)])
    if not tr:
        return None
    tr["duration_sec"] = int(tr.get("duration_sec") or 20)
    tr["is_dj_jingle"] = True
    return tr


async def _clock_pick_track() -> Optional[dict]:
    """Pesca il prossimo brano rispettando day/night. Non decrementa altro."""
    # v13.7 · Human Priority: se ON, community tracks in cima
    try:
        _ai = await _get_ai_controls()
    except Exception:
        _ai = {}
    if _ai.get("ai_human_priority"):
        _sources = ["community", "suno", "admin_upload"]
    else:
        _sources = ["suno", "admin_upload"]
    try:
        from zoneinfo import ZoneInfo
        now_local = datetime.now(ZoneInfo("Europe/Rome"))
    except Exception:
        now_local = datetime.now(timezone.utc)
    is_night = (now_local.hour >= 22 or now_local.hour < 4)
    dp = ({"$or": [{"daypart_night": {"$ne": False}}, {"daypart_night": {"$exists": False}}]}
          if is_night else
          {"$or": [{"daypart_day": {"$ne": False}}, {"daypart_day": {"$exists": False}}]})
    # v13.9 · Finestra temporale (start_date/end_date) per campagne/sponsor
    _now_iso_s = datetime.now(timezone.utc).isoformat()
    _window = {
        "$or": [{"start_date": {"$exists": False}}, {"start_date": None},
                {"start_date": {"$lte": _now_iso_s}}],
    }
    _window_end = {
        "$or": [{"end_date": {"$exists": False}}, {"end_date": None},
                {"end_date": {"$gte": _now_iso_s}}],
    }
    # Se Human Priority ON, prova prima UNA sola community track non ancora
    # suonata di recente
    if _ai.get("ai_human_priority"):
        tr_com = await db.tracks.find_one(
            {"source": "community", "status": "ready", "audio_url": {"$ne": None},
             "on_air": {"$ne": False}, "deleted_at": None, **dp},
            {"_id": 0, "id": 1, "title": 1, "artist": 1, "audio_url": 1, "duration_sec": 1, "bpm": 1},
            sort=[("last_played_at", 1)],
        )
        if tr_com:
            tr_com["duration_sec"] = int(tr_com.get("duration_sec") or 180)
            return tr_com
    q = {
        "source": {"$in": _sources},
        "status": "ready", "audio_url": {"$ne": None},
        "on_air": {"$ne": False}, "deleted_at": None,
        "$and": [
            {"$or": [{"is_anthem": {"$exists": False}}, {"is_anthem": False}]},
            {"$or": [{"is_jingle": {"$exists": False}}, {"is_jingle": False}]},
            dp, _window, _window_end,
        ],
    }
    # v13.17 · Pesca a caso tra i brani meno recenti (pool + shuffle) invece
    # del rigido "meno recente" (FIFO), che produceva un ordine fisso e
    # prevedibile — poi aggiorniamo last_played_at come prima.
    _pool_size = 15
    tr_pool = await db.tracks.find(q, {"_id": 0, "id": 1, "title": 1, "artist": 1,
                                        "audio_url": 1, "duration_sec": 1, "bpm": 1}) \
                              .sort([("last_played_at", 1)]).limit(_pool_size).to_list(length=_pool_size)
    tr = random.choice(tr_pool) if tr_pool else None
    if not tr:
        tr_pool = await db.tracks.find(
            {"status": "ready", "audio_url": {"$ne": None}, "on_air": {"$ne": False}, "deleted_at": None},
            {"_id": 0, "id": 1, "title": 1, "artist": 1, "audio_url": 1, "duration_sec": 1, "bpm": 1},
        ).sort([("last_played_at", 1)]).limit(_pool_size).to_list(length=_pool_size)
        tr = random.choice(tr_pool) if tr_pool else None
    if not tr:
        return None
    tr["duration_sec"] = int(tr.get("duration_sec") or 180)
    return tr


async def _clock_advance(force: bool = False) -> dict:
    """Fa avanzare il clock se il brano corrente è scaduto (o se `force`).
    Ripopola `queue` fino a `_CLOCK_QUEUE_LOOKAHEAD`. Restituisce il clock aggiornato.
    NB: safe in caso di race — l'update Mongo è atomico sul singolo doc.

    v13.16 · DJ INJECTION: ogni `_DJ_EVERY_N_TRACKS` brani musicali viene
    inserito un jingle DJ (dalla libreria `tracks.is_jingle=true`) nella
    queue → il flusso HLS unico contiene voce+musica sincronizzata per tutti."""
    now = datetime.now(timezone.utc)
    clock = await db.station_clock.find_one({"_id": "clock"})
    changed = False
    if not clock:
        clock = {"_id": "clock", "current": None, "queue": [], "music_counter": 0, "updated_at": now.isoformat()}
        changed = True
    # Se non c'è current o è scaduto → promuovi dalla coda o pesca dal catalogo
    def _is_expired(cur):
        if not cur or not cur.get("started_at"):
            return True
        try:
            started = datetime.fromisoformat(cur["started_at"].replace("Z", "+00:00"))
        except Exception:
            return True
        return (now - started).total_seconds() >= float(cur.get("duration_sec") or 180)

    while force or _is_expired(clock.get("current")):
        force = False
        # v13.17 · Timeline priority — check eventi maturi PRIMA di pescare
        # dalla queue standard. Soft-sync: entriamo qui solo quando il brano
        # corrente è già terminato naturalmente (via _is_expired basato su
        # duration_sec). Zero troncamenti.
        promo = await _timeline_pick_due()
        # Se nessun evento timeline dovuto, procedi con queue standard
        if not promo:
            q = clock.get("queue") or []
            promo = q.pop(0) if q else None
        else:
            q = clock.get("queue") or []
        if not promo:
            promo = await _clock_pick_track()
        if not promo:
            break
        promo = dict(promo)
        promo["started_at"] = now.isoformat()
        # v13.24 · Follow-up injection · se l'entry appena promossa (Timeline
        # event, es. "Ora Esatta") ha un `follow_up`, spingi lo Spot in TESTA
        # alla queue. La transizione Ora Esatta → Spot diventa "zero gap":
        # il manifest HLS include già il segmento successivo mentre l'ora
        # esatta è ancora in onda (pre-buffer client).
        _followup = promo.pop("follow_up", None)
        if _followup and isinstance(_followup, dict) and _followup.get("audio_url"):
            fu_entry = {
                "id": _followup.get("id") or f"fu-{uuid.uuid4().hex[:10]}",
                "title": _followup.get("title") or "Spot",
                "artist": _followup.get("artist") or "R-A.I. Advertising",
                "audio_url": _followup["audio_url"],
                "duration_sec": float(_followup.get("duration_sec") or 20),
                "is_follow_up": True,
                "parent_id": promo.get("id"),
                "video_url": _followup.get("video_url"),
            }
            q = [fu_entry] + (q or [])
        clock["current"] = promo
        clock["queue"] = q
        changed = True
        # Segna last_played_at sulla track (rotazione FIFO)
        try:
            await db.tracks.update_one({"id": promo["id"]}, {"$set": {"last_played_at": now.isoformat()}})
        except Exception:
            pass
        # Se il current sarebbe ancora scaduto (advance grande dopo sleep pod),
        # il loop while continuerà a girare a costo trascurabile.

    # v13.18 · Cadenza DJ configurabile dall'utente (Regia → "voce ogni N
    # brani", campo station.state.dj_talk_every_n_songs). Prima di questa
    # fix il live clock ignorava del tutto questa impostazione e usava
    # sempre il valore fisso _DJ_EVERY_N_TRACKS=3 — la Regia non aveva
    # alcun effetto sulla diretta.
    try:
        _station_state = await db.station.find_one({"_id": "state"}, {"dj_talk_every_n_songs": 1}) or {}
        _dj_every_n = max(1, min(20, int(_station_state.get("dj_talk_every_n_songs") or _DJ_EVERY_N_TRACKS)))
    except Exception:
        _dj_every_n = _DJ_EVERY_N_TRACKS

    # Riempi la queue fino al lookahead con injection DJ ogni N brani
    while len(clock.get("queue") or []) < _CLOCK_QUEUE_LOOKAHEAD:
        # Decidi se inserire un jingle DJ o un brano musicale
        counter = int(clock.get("music_counter") or 0)
        need_dj = (counter > 0 and counter % _dj_every_n == 0)
        picked = None
        dj_slot_filled = False
        if need_dj:
            # v13.18 · prova prima un vero segmento parlato pronto, poi ne
            # genera uno al volo se la coda è vuota, e solo come ultima
            # risorsa ripiega sul jingle preregistrato dalla libreria tracce.
            picked = await _clock_pick_dj_voice_segment()
            if not picked:
                picked = await _clock_pick_dj_jingle()
            if picked:
                dj_slot_filled = True
        if not picked:
            picked = await _clock_pick_track()
            # incrementa counter musicale solo quando aggiungiamo musica reale
            if picked:
                clock["music_counter"] = counter + 1
        if not picked:
            break
        if dj_slot_filled:
            # v13.18 · azzera il contatore dopo un turno DJ riuscito. Prima di
            # questa fix il contatore non veniva mai azzerato qui: con una
            # cadenza di 1 ("voce dopo ogni brano") e una generazione DJ che
            # ora riesce quasi sempre (ID sempre nuovo, mai scartato dal
            # dedup anti-ripetizione), il turno DJ sarebbe rimasto "dovuto"
            # per sempre riempiendo l'intera coda di sola voce, zero musica.
            clock["music_counter"] = 0
        # Evita duplicati back-to-back col current e ultimi 2 in coda
        recent_ids = {(clock.get("current") or {}).get("id")}
        for t in (clock.get("queue") or [])[-2:]:
            recent_ids.add(t.get("id"))
        if picked["id"] in recent_ids:
            found_alt = False
            for _ in range(3):
                alt = await _clock_pick_track()
                if alt and alt["id"] not in recent_ids:
                    picked = alt; found_alt = True; break
            if not found_alt:
                break
        clock.setdefault("queue", []).append(picked)
        changed = True

    if changed:
        clock["updated_at"] = now.isoformat()
        await db.station_clock.update_one({"_id": "clock"}, {"$set": clock}, upsert=True)
    return clock


async def _clock_ticker():
    """Loop di manutenzione del clock — avanza appena scade la traccia.
    Su Tier 0 questo loop muore quando il pod dorme; alla prima richiesta il
    clock viene "risanato" chiamando `_clock_advance()` on-demand."""
    while True:
        try:
            await asyncio.sleep(2)
            await _clock_advance()
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.warning(f"[clock] tick error: {e}")


def _clock_now_offset(clock: dict) -> tuple[float, dict]:
    """Ritorna (secondi_dall_inizio, current)."""
    cur = (clock or {}).get("current") or {}
    if not cur.get("started_at"):
        return 0.0, cur
    try:
        started = datetime.fromisoformat(cur["started_at"].replace("Z", "+00:00"))
    except Exception:
        return 0.0, cur
    return max(0.0, (datetime.now(timezone.utc) - started).total_seconds()), cur


@api_router.get("/stream/now")
async def stream_now():
    """Verità unica su cosa sta suonando ORA. Il player Sync lo legge per
    posizionarsi allo stesso istante degli altri ascoltatori.

    v13.17 · Include `next_crossfade_ms` calcolato dai BPM di current→next
    quando entrambi disponibili. Formula: base 2000ms · scala per la
    differenza BPM (∆<8 = 3500ms, ∆<20 = 2500ms, altrimenti 1500ms).
    Il client hls.js/radioEngine usa questo valore per crossfade intelligente."""
    clock = await _clock_advance()   # self-heal se il pod ha dormito
    offset, cur = _clock_now_offset(clock)
    next_list = (clock.get("queue") or [])[:5]
    # BPM crossfade suggestion
    next_xfade_ms = None
    if cur and next_list:
        cur_bpm = cur.get("bpm")
        nxt_bpm = next_list[0].get("bpm")
        if cur_bpm and nxt_bpm:
            delta = abs(int(cur_bpm) - int(nxt_bpm))
            if delta < 8: next_xfade_ms = 3500
            elif delta < 20: next_xfade_ms = 2500
            else: next_xfade_ms = 1500
        else:
            next_xfade_ms = 2000
    return {
        "server_time": datetime.now(timezone.utc).isoformat(),
        "current": {
            "id": cur.get("id"),
            "title": cur.get("title"),
            "artist": cur.get("artist"),
            "audio_url": cur.get("audio_url"),
            "duration_sec": cur.get("duration_sec"),
            "started_at": cur.get("started_at"),
            "offset_sec": offset,
            "remaining_sec": max(0.0, float(cur.get("duration_sec") or 180) - offset),
            "bpm": cur.get("bpm"),
            "is_timeline": bool(cur.get("is_timeline")),
            "kind": cur.get("kind"),
        } if cur else None,
        "next": [{
            "id": t.get("id"), "title": t.get("title"), "artist": t.get("artist"),
            "audio_url": t.get("audio_url"), "duration_sec": t.get("duration_sec"),
            "bpm": t.get("bpm"), "is_timeline": bool(t.get("is_timeline")),
        } for t in next_list],
        "next_crossfade_ms": next_xfade_ms,
    }


@api_router.post("/admin/stream/skip")
async def admin_stream_skip():
    """Salta il brano corrente forzando l'advance. Solo admin."""
    clock = await _clock_advance(force=True)
    _, cur = _clock_now_offset(clock)
    return {"ok": True, "current_id": (cur or {}).get("id")}


# ============================================================================
# v13.9 · VIDEO CLOCK — rotazione stinger clip sincrona (HLS)
# ============================================================================
# Come `station_clock` per l'audio, ma per i mini-clip video (stinger/startup).
# Gli utenti connessi all'endpoint `/api/stream/video.m3u8` vedono la stessa
# clip allo stesso offset perché la playlist include `#EXT-X-START:TIME-OFFSET`.
_VIDEO_QUEUE_LOOKAHEAD = 5

async def _video_pick_clip() -> Optional[dict]:
    """Pesca un mp4 dalla libreria `ledwall_videos` marcato `is_stinger=true`
    o, in mancanza, uno qualsiasi. Rispetta finestre start_date/end_date."""
    now_iso_s = datetime.now(timezone.utc).isoformat()
    q = {
        "$or": [
            {"start_date": {"$exists": False}}, {"start_date": None}, {"start_date": {"$lte": now_iso_s}},
        ],
        "$and": [{"$or": [
            {"end_date": {"$exists": False}}, {"end_date": None}, {"end_date": {"$gte": now_iso_s}},
        ]}],
    }
    # Preferisci stinger
    tr = await db.ledwall_videos.find_one({**q, "is_stinger": True}, {"_id": 0}, sort=[("last_played_at", 1)])
    if not tr:
        tr = await db.ledwall_videos.find_one(q, {"_id": 0}, sort=[("last_played_at", 1)])
    if not tr:
        return None
    tr["duration_sec"] = float(tr.get("duration_sec") or 12.0)
    return tr


async def _video_advance(force: bool = False) -> dict:
    now = datetime.now(timezone.utc)
    clock = await db.station_video_clock.find_one({"_id": "video_clock"})
    changed = False
    if not clock:
        clock = {"_id": "video_clock", "current": None, "queue": [], "updated_at": now.isoformat()}
        changed = True

    def _expired(cur):
        if not cur or not cur.get("started_at"):
            return True
        try:
            st = datetime.fromisoformat(cur["started_at"].replace("Z", "+00:00"))
        except Exception:
            return True
        return (now - st).total_seconds() >= float(cur.get("duration_sec") or 12)

    while force or _expired(clock.get("current")):
        force = False
        q = clock.get("queue") or []
        promo = q.pop(0) if q else None
        if not promo:
            promo = await _video_pick_clip()
        if not promo:
            break
        promo = dict(promo)
        promo["started_at"] = now.isoformat()
        clock["current"] = promo
        clock["queue"] = q
        changed = True
        try:
            await db.ledwall_videos.update_one({"id": promo.get("id")}, {"$set": {"last_played_at": now.isoformat()}})
        except Exception:
            pass
    while len(clock.get("queue") or []) < _VIDEO_QUEUE_LOOKAHEAD:
        p = await _video_pick_clip()
        if not p:
            break
        recent = {(clock.get("current") or {}).get("id")}
        for t in (clock.get("queue") or [])[-2:]:
            recent.add(t.get("id"))
        if p.get("id") in recent:
            break
        clock.setdefault("queue", []).append(p)
        changed = True
    if changed:
        clock["updated_at"] = now.isoformat()
        await db.station_video_clock.update_one({"_id": "video_clock"}, {"$set": clock}, upsert=True)
    return clock


def _video_now_offset(clock: dict) -> tuple[float, dict]:
    cur = (clock or {}).get("current") or {}
    if not cur.get("started_at"):
        return 0.0, cur
    try:
        st = datetime.fromisoformat(cur["started_at"].replace("Z", "+00:00"))
    except Exception:
        return 0.0, cur
    return max(0.0, (datetime.now(timezone.utc) - st).total_seconds()), cur


@api_router.get("/stream/video-now")
async def stream_video_now():
    """Verità unica sul clip video ora in onda."""
    clock = await _video_advance()
    off, cur = _video_now_offset(clock)
    return {
        "server_time": datetime.now(timezone.utc).isoformat(),
        "current": {
            "id": cur.get("id"), "url": cur.get("url"),
            "duration_sec": cur.get("duration_sec"),
            "started_at": cur.get("started_at"),
            "offset_sec": off,
            "remaining_sec": max(0.0, float(cur.get("duration_sec") or 12) - off),
        } if cur.get("id") else None,
        "next": [{"id": t.get("id"), "url": t.get("url"),
                  "duration_sec": t.get("duration_sec")}
                 for t in (clock.get("queue") or [])[:3]],
    }


@api_router.get("/stream/video.m3u8")
async def stream_video_hls(request: Request):
    """HLS Live Playlist per i clip video (stinger rotation) — sincronizzata
    server-side via video_clock. Latenza ≈ durata di uno stinger."""
    clock = await _video_advance()
    off, cur = _video_now_offset(clock)
    proto = request.headers.get("x-forwarded-proto", "https")
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    base = f"{proto}://{host}"
    if not cur or not cur.get("url"):
        empty = "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:12\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:EVENT\n#EXT-X-ENDLIST\n"
        return Response(content=empty, media_type="application/vnd.apple.mpegurl",
                        headers={"Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"})
    entries = [cur] + [t for t in (clock.get("queue") or [])[:3]]
    lines = [
        "#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:60",
        "#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-PLAYLIST-TYPE:EVENT",
        f"#EXT-X-START:TIME-OFFSET={off:.3f},PRECISE=YES",
    ]
    try:
        run_dt = datetime.fromisoformat((cur.get("started_at") or "").replace("Z", "+00:00"))
    except Exception:
        run_dt = datetime.now(timezone.utc)
    for t in entries:
        dur = float(t.get("duration_sec") or 12)
        url = t.get("url") or ""
        if url.startswith("/"):
            url = f"{base.rstrip('/')}{url}"
        lines.append(f"#EXT-X-PROGRAM-DATE-TIME:{run_dt.isoformat().replace('+00:00','Z')}")
        lines.append(f"#EXTINF:{dur:.3f},clip-{t.get('id','')}")
        lines.append(url)
        run_dt = run_dt + timedelta(seconds=dur)
    lines.append("")
    return Response(content="\n".join(lines), media_type="application/vnd.apple.mpegurl",
                    headers={"Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"})


# ============================================================================
# v13.9 · UPLOAD UNIFICATO MP3+MP4 con metadata sponsor/finestra temporale
# ============================================================================
@api_router.post("/admin/media/upload")
async def admin_media_upload(
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    sponsor_note: Optional[str] = Form(None),
    start_date: Optional[str] = Form(None),   # ISO date/datetime (validità inizio)
    end_date: Optional[str] = Form(None),     # ISO date/datetime (validità fine)
    is_stinger: Optional[str] = Form(None),   # 'true' → mp4 va nella rotazione video
    daypart_day: Optional[str] = Form("true"),
    daypart_night: Optional[str] = Form("true"),
):
    """Endpoint UNIFICATO: sniffa il mime del file caricato e lo instrada:
      • audio/* → Track (`source=admin_upload`) su Object Storage 'suno/'
      • video/* → ledwall_videos su Object Storage 'ledwall/'
    Metadata comuni: `sponsor_note`, `start_date`, `end_date` (validità in
    palinsesto e rotazione), `is_stinger` (solo per video), `daypart_*`."""
    if not file:
        raise HTTPException(400, "File mancante")
    data = await file.read()
    if len(data) > 200 * 1024 * 1024:
        raise HTTPException(413, "File troppo grande (max 200MB)")
    if not object_storage.is_enabled():
        raise HTTPException(503, "Object Storage disabilitato")
    orig_name = (file.filename or "media").lower()
    ext = orig_name.rsplit(".", 1)[-1] if "." in orig_name else ""
    audio_exts = {"mp3", "wav", "m4a", "ogg", "flac"}
    video_exts = {"mp4", "webm", "mov", "m4v"}
    is_audio = ext in audio_exts
    is_video = ext in video_exts
    if not (is_audio or is_video):
        raise HTTPException(415, f"Estensione non supportata: {ext}")
    _bool = lambda v: str(v or "").strip().lower() in ("1", "true", "yes", "on")
    now_dt = datetime.now(timezone.utc)
    common = {
        "sponsor_note": (sponsor_note or "").strip()[:400] or None,
        "start_date": (start_date or "").strip() or None,
        "end_date":   (end_date or "").strip() or None,
    }

    if is_audio:
        # Analog to legacy Suno-admin upload — but simplified: goes to Tracks
        track_id = str(uuid.uuid4())
        local_name = f"track_{track_id}.mp3"
        # v13.28 · FIX (stesso encoding-mismatch del download Suno, ticket
        # #247410): normalizza anche gli upload manuali prima dello storage,
        # e calcola qui duration_sec reale invece di lasciarlo None ("popolato
        # al primo play" non era mai stato completato — causa diretta dei
        # crash di validazione Track/duration_sec int_type).
        upload_bytes = data
        real_duration = None
        try:
            import tempfile as _tempfile, os as _os
            with _tempfile.NamedTemporaryFile(suffix="." + ext, delete=False) as _tf:
                _tf.write(data)
                _raw_tmp_path = _tf.name
            try:
                norm = await _normalize_audio_file(_raw_tmp_path)
                if norm and norm.get("normalized_bytes"):
                    upload_bytes = norm["normalized_bytes"]
                    real_duration = norm.get("duration_sec")
            finally:
                try: _os.unlink(_raw_tmp_path)
                except Exception: pass
        except Exception as e:
            logger.warning(f"[upload] normalize error per {track_id}: {e}")
        stored = await object_storage.put_mp3(f"suno/{local_name}", upload_bytes)
        if not stored:
            raise HTTPException(502, "Upload audio fallito")
        # BPM
        detected_bpm = None
        try: detected_bpm = await bpm_service.detect_bpm_from_bytes(upload_bytes, ".mp3")
        except Exception: pass
        doc = {
            "id": track_id,
            "title": (name or orig_name.rsplit(".", 1)[0])[:80],
            "artist": "R-A.I. Upload",
            "source": "admin_upload",
            "kind": "music",
            "audio_url": f"/api/suno_audio/{local_name}",
            "status": "ready",
            "on_air": True,
            "daypart_day": _bool(daypart_day if daypart_day is not None else "true"),
            "daypart_night": _bool(daypart_night if daypart_night is not None else "true"),
            "bpm": detected_bpm,
            "bpm_source": ("server" if detected_bpm else None),
            "duration_sec": round(real_duration) if real_duration and real_duration > 0 else 30,
            "created_at": now_dt.isoformat(),
            "updated_at": now_dt.isoformat(),
            "deleted_at": None,
            **common,
        }
        await db.tracks.insert_one(doc.copy())
        doc.pop("_id", None)
        return {"ok": True, "type": "audio", "track": doc}

    # is_video
    vid_id = uuid.uuid4().hex[:12]
    local_name = f"ledwall_{vid_id}.{ext}"
    mime = {"mp4": "video/mp4", "webm": "video/webm",
            "mov": "video/quicktime", "m4v": "video/x-m4v"}[ext]
    stored = await object_storage.put_bytes(f"ledwall/{local_name}", data, mime)
    if not stored:
        raise HTTPException(502, "Upload video fallito")
    probe = None
    try: probe = await video_service.probe_video_from_bytes(data, "." + ext)
    except Exception: pass
    doc = {
        "id": vid_id,
        "filename": local_name,
        "display_name": (name or orig_name)[:80],
        "url": f"/api/ledwall_video/{local_name}",
        "size": len(data),
        "mime": mime,
        "duration_sec": (probe or {}).get("duration_sec"),
        "width": (probe or {}).get("width"),
        "height": (probe or {}).get("height"),
        "video_codec": (probe or {}).get("video_codec"),
        "audio_codec": (probe or {}).get("audio_codec"),
        "is_stinger": _bool(is_stinger),
        "uploaded_at": now_dt.isoformat(),
        "last_played_at": None,
        **common,
    }
    await db.ledwall_videos.insert_one(doc.copy())
    doc.pop("_id", None)
    return {"ok": True, "type": "video", "video": doc}



# ============================================================================
# v13.3 · AUTO-SCHEDULING PILLOLE (Master Clock → generazione automatica)
# ============================================================================
async def _pillole_scheduler():
    """Ogni 60s: se l'ora corrente ha slot kind=past_pill/future_pill e FM_MODE
    è ON, genera script + TTS e inietta nella priority_queue. Una volta per ora."""
    last_run_hour = None
    while True:
        try:
            await asyncio.sleep(60)
            st = await db.station.find_one({"_id": "state"}, {"fm_mode": 1}) or {}
            if not st.get("fm_mode"):
                continue
            # v13.23 · KILL-SWITCH · non genera pillole se `ai_claude_brain` OFF.
            try:
                _ai_pl = await _get_ai_controls()
            except Exception:
                _ai_pl = {}
            if not _ai_pl.get("ai_claude_brain"):
                continue
            try:
                from zoneinfo import ZoneInfo
                now_local = datetime.now(ZoneInfo("Europe/Rome"))
            except Exception:
                now_local = datetime.now(timezone.utc)
            hour = now_local.hour
            if hour == last_run_hour:
                continue
            slot = await db.program_schedule.find_one({"hour": hour}, {"_id": 0})
            if not slot or slot.get("kind") not in ("past_pill", "future_pill"):
                continue
            kind_short = "past" if slot["kind"] == "past_pill" else "future"
            system = _PILL_PAST_SYSTEM if kind_short == "past" else _PILL_FUTURE_SYSTEM
            hint = slot.get("subject") or slot.get("title") or ""
            try:
                script = await llm_generate("anthropic", "claude-sonnet-4-5-20250929", system, hint or "Scegli un argomento adatto alla rubrica.")
                tts_file = await elevenlabs_service.synth_speech(script, voice_key="male-1" if kind_short == "past" else "female-1", kind="pill")
                if tts_file:
                    seg = {
                        "id": str(uuid.uuid4()),
                        "kind": f"pill_{kind_short}",
                        "title": slot.get("title") or ("Pillola dal Passato" if kind_short == "past" else "Pillola dal Futuro"),
                        "script": script,
                        "speech_url": f"/api/tts/{tts_file}",
                        "priority": True,
                        "scheduled_hour": hour,
                        "created_at": now_iso(),
                    }
                    await db.priority_queue.insert_one(seg.copy())
                    last_run_hour = hour
                    logger.info(f"[pill-scheduler] Injected pill_{kind_short} for hour {hour}")
            except Exception as e:
                logger.warning(f"[pill-scheduler] Gen fail hour={hour}: {e}")
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.warning(f"[pill-scheduler] loop error: {e}")




@api_router.patch("/admin/tracks/{track_id}/rotation")
async def admin_toggle_rotation(track_id: str, payload: dict):
    """Include/escludi la traccia (tipicamente un FX/loop) dalla rotazione automatica."""
    val = bool(payload.get("include", True))
    r = await db.tracks.update_one(
        {"id": track_id},
        {"$set": {"include_in_rotation": val, "updated_at": now_iso()}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Traccia non trovata")
    return {"ok": True, "id": track_id, "include_in_rotation": val}



@api_router.get("/admin/approval-queue")
async def admin_approval_queue():
    """Elenco tracce inviate esternamente in attesa di OK admin."""
    docs = await db.tracks.find(
        {"is_pending_approval": True, "deleted_at": None},
        {"_id": 0},
        sort=[("created_at", -1)],
    ).to_list(200)
    return {"items": docs, "count": len(docs)}


@api_router.post("/admin/approval-queue/{track_id}/approve")
async def admin_approval_approve(track_id: str):
    r = await db.tracks.update_one(
        {"id": track_id, "is_pending_approval": True},
        {"$set": {"is_pending_approval": False, "on_air": True, "updated_at": now_iso()}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Richiesta non trovata")
    return {"ok": True, "id": track_id, "approved": True}


@api_router.post("/admin/approval-queue/{track_id}/reject")
async def admin_approval_reject(track_id: str):
    r = await db.tracks.update_one(
        {"id": track_id, "is_pending_approval": True},
        {"$set": {"is_pending_approval": False, "on_air": False, "status": "retired",
                  "deleted_at": now_iso(), "updated_at": now_iso()}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Richiesta non trovata")
    return {"ok": True, "id": track_id, "rejected": True}


@api_router.patch("/admin/tracks/{track_id}/sponsor-intro")
async def admin_toggle_sponsor_intro(track_id: str, payload: dict):
    """Marca/desmarca una traccia come jingle di intro sponsor orario
    ('Il segnale orario è offerto da...'). Viene consumata in LRP dopo il
    time_signal, prima dello spot pubblicitario."""
    val = bool(payload.get("value", True))
    r = await db.tracks.update_one(
        {"id": track_id, "deleted_at": None},
        {"$set": {"is_sponsor_intro": val, "updated_at": now_iso()}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Traccia non trovata")
    return {"ok": True, "id": track_id, "is_sponsor_intro": val}


@api_router.patch("/admin/tracks/{track_id}/loop-bind")
async def admin_loop_bind(track_id: str, payload: dict):
    """Aggancia un loop a uno speaker/rubrica (o rimuove il binding se null)."""
    bind = payload.get("speaker")
    r = await db.tracks.update_one(
        {"id": track_id, "is_loop": True},
        {"$set": {"loop_bind_speaker": (bind or None), "updated_at": now_iso()}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Loop non trovato")
    return {"ok": True, "id": track_id, "loop_bind_speaker": bind}


@api_router.post("/community/tracks/{track_id}/play")
async def community_track_play(track_id: str):
    """Incrementa play_count del brano community (chiamato dal player quando
    lo suona in trasmissione)."""
    r = await db.community_tracks.update_one(
        {"id": track_id}, {"$inc": {"play_count": 1}}
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Track non trovato")
    return {"ok": True}


# ----------------------- Partner / Sponsor -----------------------
class Partner(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    logo_url: Optional[str] = None
    link: Optional[str] = None
    description: Optional[str] = None
    active: bool = True
    created_at: str = Field(default_factory=now_iso)


class PartnerCreate(BaseModel):
    name: str
    logo_url: Optional[str] = None
    link: Optional[str] = None
    description: Optional[str] = None
    active: bool = True


@api_router.get("/partners/active")
async def get_active_partners():
    """Ritorna i partner attivi in ordine di creazione. Endpoint pubblico."""
    partners = await db.partners.find({"active": True}, {"_id": 0}).sort("created_at", 1).to_list(length=20)
    return {"partners": partners}


@api_router.get("/admin/partners")
async def admin_list_partners():
    partners = await db.partners.find({}, {"_id": 0}).sort("created_at", 1).to_list(length=100)
    return {"partners": partners}


@api_router.post("/admin/partners")
async def admin_create_partner(payload: PartnerCreate):
    p = Partner(**payload.dict())
    await db.partners.insert_one(p.dict())
    return p


@api_router.patch("/admin/partners/{partner_id}")
async def admin_update_partner(partner_id: str, payload: PartnerCreate):
    r = await db.partners.update_one(
        {"id": partner_id},
        {"$set": {k: v for k, v in payload.dict().items() if v is not None or k == "active"}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Partner not found")
    p = await db.partners.find_one({"id": partner_id}, {"_id": 0})
    return p


@api_router.delete("/admin/partners/{partner_id}")
async def admin_delete_partner(partner_id: str):
    r = await db.partners.delete_one({"id": partner_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "Partner not found")
    return {"deleted": partner_id}


# ----------------------- Utility -----------------------
@api_router.get("/")
async def root():
    return {"status": "AI Radio online", "time": now_iso()}


app.include_router(api_router)

# ============================================================================
# AUTH — Regia protetta (JWT, single-admin, password da .env)
# ----------------------------------------------------------------------------
# Middleware globale che blocca /api/admin/* senza token admin.
# Router pubblico per /api/auth/{login,logout,me}.
# ============================================================================
from auth import (  # noqa: E402
    make_auth_router as _make_auth_router,
    seed_admin as _seed_admin,
    admin_gate_middleware as _admin_gate,
)
app.include_router(_make_auth_router(db), prefix="/api")
app.middleware("http")(_admin_gate)

_cors_origins_env = os.environ.get('CORS_ORIGINS', '*').strip()
if _cors_origins_env and _cors_origins_env != '*':
    _cors_kwargs = {"allow_origins": [o.strip() for o in _cors_origins_env.split(',') if o.strip()]}
else:
    # FIX (ticket 220609): allow_origins=["*"] together with allow_credentials=True
    # is invalid per the Fetch/CORS spec and browsers reject it outright for any
    # credentialed cross-origin request (frontend's axios client sets
    # withCredentials=True in lib/api.js) — confirmed live: every /api/* call from a
    # cross-origin frontend (preview testing, custom domain) failed with
    # "Access-Control-Allow-Origin header ... must not be the wildcard '*' when the
    # request's credentials mode is 'include'". Same-origin calls (prod on r-ai.it)
    # were unaffected, which is why this stayed hidden. Echo this app's known
    # origins via regex instead of the wildcard so cross-origin calls actually work.
    _cors_kwargs = {"allow_origin_regex": r"^https://(www\.)?r-ai\.it$|^https://autoradio-ai\.(preview\.emergentagent\.com|emergent\.host)$|^http://localhost(:\d+)?$"}

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    **_cors_kwargs,
)


@api_router.get("/admin/background-tasks")
async def admin_bg_tasks_status():
    """Stato del kill-switch globale dei cicli AI in background."""
    enabled = os.environ.get("BACKGROUND_TASKS_ENABLED", "false").strip().lower() in ("1", "true", "yes", "on")
    return {
        "enabled": enabled,
        "tasks": ["suno_library_filler", "suno_integrity_check", "time_signal_pregenerator"],
        "note": "Richiede restart del backend per prendere effetto",
    }


@api_router.patch("/admin/background-tasks")
async def admin_bg_tasks_toggle(payload: dict):
    """Attiva/disattiva persistentemente i cicli AI in background.
    Riavvio backend richiesto per applicare (i loop vengono lanciati solo allo startup)."""
    enabled = bool(payload.get("enabled"))
    env_path = ROOT_DIR / ".env"
    try:
        lines = env_path.read_text().splitlines()
    except Exception:
        lines = []
    key = "BACKGROUND_TASKS_ENABLED"
    new_val = "true" if enabled else "false"
    found = False
    for i, ln in enumerate(lines):
        if ln.strip().startswith(f"{key}="):
            lines[i] = f"{key}={new_val}"
            found = True
            break
    if not found:
        lines.append(f"{key}={new_val}")
    env_path.write_text("\n".join(lines) + "\n")
    os.environ[key] = new_val
    logger.info(f"BACKGROUND_TASKS_ENABLED set to {new_val} via API")
    return {"enabled": enabled, "persisted": True, "restart_required": True}


@app.on_event("startup")
async def on_startup():
    await ensure_seeded()
    await _seed_admin(db)   # seed admin Regia (idempotente)
    await telegram_bot.start(db)
    # v13.13 · FM_MODE PERSISTENTE — se l'admin lo accende, resta acceso
    # anche dopo restart/chiusura app finché non lo spegne manualmente.
    _st_fm = await db.station.find_one({"_id": "state"}, {"fm_mode": 1}) or {}
    _fm_on = bool(_st_fm.get("fm_mode"))
    logger.info(f"[startup] FM_MODE caricato da Mongo · {'ON (Radio Vera premium)' if _fm_on else 'OFF (economy)'}")
    # v13.7 → v13.12 · AI MASTER CONTROL — PERSISTENTE su MongoDB.
    # Non forziamo più i toggle a OFF ad ogni startup: si conserva l'ultima
    # configurazione impostata dall'admin. Alla prima installazione i campi
    # sono assenti e `_get_ai_controls()` restituisce bool(None)=False in
    # automatico, quindi il comportamento default resta "tutti OFF".
    _st_ai = await db.station.find_one({"_id": "state"}, {k: 1 for k in _AI_CONTROLS_KEYS}) or {}
    _persisted = {k: bool(_st_ai.get(k)) for k in _AI_CONTROLS_KEYS}
    _active = [k for k, v in _persisted.items() if v]
    _invalidate_ai_controls_cache()
    if _active:
        logger.info(f"[startup] AI Master Control caricato da Mongo · {len(_active)}/7 ATTIVI: {_active}")
    else:
        logger.info("[startup] AI Master Control caricato da Mongo · tutti OFF (persistente)")
    # Kill switch globale per i cicli AI in background (Suno filler,
    # integrity check, time_signal pregen). Default: DISABILITATO.
    # Riattiva da regia via PATCH /api/admin/background-tasks.
    bg_enabled = os.environ.get("BACKGROUND_TASKS_ENABLED", "false").strip().lower() in ("1", "true", "yes", "on")
    if bg_enabled:
        asyncio.create_task(_suno_library_filler())
        asyncio.create_task(_suno_integrity_check())
        asyncio.create_task(_time_signal_pregenerator())
        # v13.21 · DJ voice pregen ticker — gated dal kill-switch di regia:
        # come gli altri background task, parte solo se BACKGROUND_TASKS_ENABLED
        # è ON, così una regia in economy non brucia crediti LLM/TTS di nascosto.
        asyncio.create_task(_dj_pregen_ticker())
        logger.info("[startup] Background AI tasks ENABLED (Suno filler, integrity, time_signal pregen, DJ voice pregen)")
    else:
        logger.info("[startup] Background AI tasks DISABLED (BACKGROUND_TASKS_ENABLED=false) — nessun consumo automatico")
    # Auto-scheduling Pillole (v13.3) — sempre attivo, ma internamente si
    # sospende se FM_MODE è OFF, quindi zero costi in economy.
    asyncio.create_task(_pillole_scheduler())
    logger.info("[startup] Pillole auto-scheduler running (gated by FM_MODE)")
    # v13.6 · TRUE BROADCASTER — clock ticker (avanza il brano corrente).
    # Su Tier 0 il pod dorme senza traffico: alla riattivazione il primo GET
    # su /api/stream/now o /api/stream/live.m3u8 richiama _clock_advance() e
    # ripristina lo stato coerente. Zero costi API ricorrenti.
    asyncio.create_task(_clock_ticker())
    logger.info("[startup] Station clock ticker running (in-pod, tier0-tolerant)")
    # v13.9 · VIDEO CLOCK ticker (stinger rotation sincrona HLS)
    async def _video_ticker():
        while True:
            try:
                await asyncio.sleep(3)
                await _video_advance()
            except asyncio.CancelledError: break
            except Exception as e: logger.debug(f"[video-clock] {e}")
    asyncio.create_task(_video_ticker())
    logger.info("[startup] Video clock ticker running (HLS stinger rotation)")


async def _suno_integrity_check():
    """Every 24h scan local Suno tracks; if the mp3 is missing or < 100KB
    (truncated/corrupted), re-download it from `original_audio_url` while the
    Suno CDN link is still valid."""
    await asyncio.sleep(60)
    while True:
        try:
            cursor = db.tracks.find({"source": "suno", "status": "ready", "audio_url": {"$regex": "^/api/suno_audio/"}}, {"_id": 0})
            fixed = 0
            async for t in cursor:
                p = SUNO_AUDIO_DIR / f"track_{t['id']}.mp3"
                if p.exists() and p.stat().st_size >= 100_000:
                    continue
                orig = t.get("original_audio_url")
                if not orig:
                    continue
                if await download_and_save_suno_audio(orig, t["id"]):
                    fixed += 1
            logger.info(f"Suno integrity check: {fixed} tracks re-downloaded")
        except Exception as e:
            logger.warning(f"Suno integrity check error: {e}")
        await asyncio.sleep(86400)  # 24h


async def _suno_library_filler():
    """Keep a small library of ready Suno tracks available for the radio.
    Focus on danceable electronic music.

    Behavior:
    - Skipped entirely if SUNO_API_KEY missing OR SUNO_AUTOGEN_ENABLED=false.
    - Target ready count from SUNO_LIBRARY_TARGET (default 10).
    - Triggers a new generation ONLY when ready < target AND pending < 3, so
      we never flood the Suno queue and never overspend when the library is
      already stocked.
    """
    if not suno_service.is_enabled():
        return
    await asyncio.sleep(5)
    dance_genres = [
        "tech house 126 bpm",
        "future house 128 bpm",
        "big room edm 128 bpm",
        "electro house 130 bpm",
        "melodic techno 124 bpm",
        "drum and bass 174 bpm",
        "bass house 128 bpm",
        "progressive house 128 bpm",
        "italo disco 122 bpm",
        "afro house 122 bpm",
        "dance pop 124 bpm",
    ]
    while True:
        try:
            if not _suno_autogen_enabled():
                # Kill-switch active: never call Suno automatically.
                await asyncio.sleep(120)
                continue
            # v13.23 · KILL-SWITCH · rispetta anche `ai_suno_engine` regia.
            try:
                _ai_su = await _get_ai_controls()
            except Exception:
                _ai_su = {}
            if not _ai_su.get("ai_suno_engine"):
                await asyncio.sleep(120)
                continue
            target = _suno_library_target()
            ready = await db.tracks.count_documents({"source": "suno", "status": "ready"})
            pending = await db.tracks.count_documents({"source": "suno", "status": "pending"})
            # Batch generation: se scendiamo sotto target genera 2 tracce alla volta
            # per tenere il buffer sempre pieno. Cap totale in-flight: 4.
            if ready < target and pending < 4:
                to_generate = min(2, target - ready, 4 - pending)
                for _ in range(max(1, to_generate)):
                    genre = random.choice(dance_genres)
                    logger.info(
                        f"Suno filler: generating {genre} "
                        f"(ready={ready}/{target}, pending={pending})"
                    )
                    await generate_track(genre=genre)
                    pending += 1
            await asyncio.sleep(30)
        except Exception as e:
            logger.warning(f"Suno filler error: {e}")
            await asyncio.sleep(60)


async def _time_signal_pregenerator():
    """FIX (v12.15 · silenzio dopo segnale orario): pre-genera script + audio
    del segnale orario ~60-90s PRIMA che scocchi l'ora, scrivendoli in
    time_signal_cache. Quando generate_segment rileva il cambio d'ora trova
    il segmento già pronto (script + speech_audio_url) e lo serve all'istante,
    senza attendere LLM+TTS in-request (misurati 3-25s a chiamata, fino a 37s
    in sequenza — la causa reale del silenzio riportato dopo segnale orario).
    Cache-miss (es. pod riavviato proprio sull'ora) → nessun impatto: il
    percorso sincrono originale in generate_segment resta invariato come
    rete di sicurezza.
    """
    await asyncio.sleep(10)
    while True:
        try:
            # v13.23 · KILL-SWITCH — se `ai_openai_talk` è OFF, il pre-gen è
            # completamente disabilitato: niente LLM, niente TTS, niente
            # bruciare crediti quando la Regia è in economy.
            try:
                _ai_ts = await _get_ai_controls()
            except Exception:
                _ai_ts = {}
            if not _ai_ts.get("ai_openai_talk"):
                await asyncio.sleep(30)
                continue
            from zoneinfo import ZoneInfo
            it_now = datetime.now(ZoneInfo("Europe/Rome"))
            seconds_left = 3600 - (it_now.minute * 60 + it_now.second)
            if seconds_left <= 90:
                upcoming = it_now + timedelta(seconds=seconds_left)
                hour_key = upcoming.strftime("%Y-%m-%d %H")
                exists = await db.time_signal_cache.find_one({"_id": hour_key})
                if not exists:
                    djs = await db.djs.find({}, {"_id": 0}).to_list(20)
                    dj = random.choice(djs) if djs else {}
                    provider = dj.get("llm_provider", "openai")
                    model = dj.get("llm_model", "gpt-5.2")
                    voice_key = dj.get("voice_key", "nova")
                    time_str = f"{upcoming.hour:02d}:00"
                    worlds = [
                        "Marte", "Giove", "una galassia parallela", "il futuro anteriore",
                        "il metaverso di Ferrara", "Alpha Centauri", "un satellite in orbita bassa",
                        "un data center segreto in Islanda", "la Luna", "un browser aperto ieri sera",
                        "un buco nero curioso", "una playlist dimenticata"
                    ]
                    world = random.choice(worlds)
                    system_prompt = (
                        "Sei uno speaker AI radiofonico ITALIANO di R-A.I. (radio dance/elettronica "
                        "del FUTURO). Energico, sorridente, mai robotico."
                    )
                    prompt = (
                        f"Segnale orario radiofonico in MAX 25 parole. In Italia stanno per scoccare "
                        f"le {time_str}. Devi dire ESATTAMENTE 'Sono le {time_str} su R-A.I. Radio' "
                        f"come prima frase, poi aggiungi UNA battuta cosmica dicendo che anche su "
                        f"{world} è la stessa ora. Tono altissimo, sorridente, esagerato. Italiano."
                    )
                    try:
                        script = await llm_generate(provider, model, system_prompt, prompt)
                    except Exception:
                        script = ""
                    if not script or not script.strip():
                        script = (
                            f"Sono le {time_str} su R-A.I. Radio! Anche su {world} è la stessa ora, "
                            "ma solo qui la festa non finisce mai!"
                        )
                    fn, subpath = await synth_speech(script, voice_key, kind="time_signal")
                    if fn:
                        await db.time_signal_cache.update_one(
                            {"_id": hour_key},
                            {"$set": {
                                "script": script,
                                "speech_audio_url": f"/api/{subpath}/{fn}",
                                "created_at": now_iso(),
                            }},
                            upsert=True,
                        )
                        logger.info(f"[time_signal_pregen] cached hour={hour_key}")
            await asyncio.sleep(15)
        except Exception as e:
            logger.warning(f"[time_signal_pregen] error: {e}")
            await asyncio.sleep(30)


@app.on_event("shutdown")
async def on_shutdown():
    client.close()
