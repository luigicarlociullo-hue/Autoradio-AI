"""Text-to-Speech service.
Primary: OpenAI TTS-1 via Emergent Universal Key gateway
         (OPENAI_API_KEY + OPENAI_BASE_URL, endpoint /audio/speech).
Fallback: ElevenLabs (eleven_multilingual_v2) — solo se ELEVENLABS_API_KEY è presente
         E la Universal Key non è configurata / risponde errore.
Generated MP3s are stored in TTS_DIR and served through /api/tts/{filename}.
"""
import os
import uuid
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

# ElevenLabs fallback map (unchanged)
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
    """True se abbiamo OpenAI (via Universal Key) O ElevenLabs come fallback."""
    return bool(OPENAI_API_KEY and OPENAI_BASE_URL) or bool(ELEVENLABS_API_KEY)


async def _synth_openai(text: str, voice_key: str) -> bytes | None:
    """OpenAI TTS-1 via Emergent gateway. Ritorna bytes mp3 o None."""
    if not OPENAI_API_KEY or not OPENAI_BASE_URL:
        return None
    voice = VOICE_KEY_TO_OPENAI.get(voice_key, "nova")
    url = f"{OPENAI_BASE_URL}/audio/speech"
    body = {"model": "tts-1", "voice": voice, "input": text[:4000]}
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


async def _synth_elevenlabs(text: str, voice_key: str) -> bytes | None:
    """ElevenLabs fallback (eleven_multilingual_v2). Ritorna bytes mp3 o None."""
    if not ELEVENLABS_API_KEY:
        return None
    voice_id = VOICE_KEY_TO_ELEVEN.get(voice_key, DEFAULT_ELEVEN_ID)
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    headers = {"xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json", "Accept": "audio/mpeg"}
    body = {
        "text": text[:900],
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {"stability": 0.4, "similarity_boost": 0.8, "style": 0.5, "use_speaker_boost": True},
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


async def synth_speech(text: str, voice_key: str = "female-1") -> str | None:
    """
    Genera TTS. Primario OpenAI TTS-1 (Universal Key), fallback ElevenLabs.
    Ritorna il filename dentro TTS_DIR, o None se entrambi falliscono.
    """
    if not text or not text.strip():
        return None
    text = text.strip()

    # 1) OpenAI TTS-1 (primary)
    audio = await _synth_openai(text, voice_key)
    provider = "openai-tts-1"

    # 2) Fallback ElevenLabs (only if OpenAI failed / not configured)
    if not audio:
        audio = await _synth_elevenlabs(text, voice_key)
        provider = "elevenlabs"

    if not audio:
        return None

    filename = f"tts_{uuid.uuid4().hex}.mp3"
    (TTS_DIR / filename).write_bytes(audio)
    logger.info(f"TTS synthesized via {provider}: {filename} ({len(audio):,} bytes)")
    # Best-effort push to Emergent Object Storage (no-op unless USE_OBJECT_STORAGE=true).
    try:
        import object_storage
        if object_storage.is_enabled():
            await object_storage.put_mp3(f"tts/{filename}", audio)
    except Exception as e:
        logger.debug(f"objstore push skipped: {e}")
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


def cleanup_old(max_files: int = 200):
    files = sorted(TTS_DIR.glob("*.mp3"), key=lambda p: p.stat().st_mtime, reverse=True)
    for p in files[max_files:]:
        try: p.unlink()
        except Exception: pass
