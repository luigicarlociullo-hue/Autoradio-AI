"""ElevenLabs Text-to-Speech service.
Uses httpx directly (no SDK dependency) to convert text to speech via
eleven_multilingual_v2 (best Italian model). Generated MP3s are stored in
TTS_DIR and served through /api/tts/{filename}.
"""
import os
import uuid
import logging
from pathlib import Path
import httpx

logger = logging.getLogger(__name__)

ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "").strip()
TTS_DIR = Path(__file__).parent / "tts_audio"
TTS_DIR.mkdir(exist_ok=True)

# Map internal voice_key → ElevenLabs public voice_id (multilingual v2 handles Italian for all)
VOICE_KEY_TO_ELEVEN = {
    "female-1": "EXAVITQu4vr4xnSDxMaL",   # Bella   – bright energetic
    "female-2": "AZnzlk1XvdvUeBnXmlld",   # Domi    – youthful confident
    "female-3": "MF3mGyEYCl7XYWbV9V6O",   # Elli    – warm friendly
    "female-4": "XB0fDUnXU5powFXDhCwa",   # Charlotte – calm poetic
    "female-5": "21m00Tcm4Tlm3f5Y58nb",   # Rachel  – classic radio
    "male-1":   "ErXwobaYiN019PkySvjV",   # Antoni  – smooth
    "male-2":   "pNInz6obpgDQGcFmaJgB",   # Adam    – deep confident (default)
    "male-3":   "TxGEqnHWrfWFTfGW9XjX",   # Josh    – young dynamic
    "male-4":   "VR6AewLTigWG4xSOukaG",   # Arnold  – strong
    "male-5":   "yoZ06aMxZJJ28mfd3POQ",   # Sam     – narrator
}

DEFAULT_VOICE_ID = "pNInz6obpgDQGcFmaJgB"


def is_enabled() -> bool:
    return bool(ELEVENLABS_API_KEY)


async def synth_speech(text: str, voice_key: str = "female-1") -> str | None:
    """Generate TTS via ElevenLabs. Returns filename inside TTS_DIR, or None."""
    if not is_enabled() or not text or not text.strip():
        return None
    text = text.strip()[:900]  # ElevenLabs cost is per-char, be reasonable
    voice_id = VOICE_KEY_TO_ELEVEN.get(voice_key, DEFAULT_VOICE_ID)
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    headers = {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    }
    body = {
        "text": text,
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {
            "stability": 0.4,
            "similarity_boost": 0.8,
            "style": 0.5,
            "use_speaker_boost": True,
        },
    }
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            r = await client.post(url, headers=headers, json=body)
        if r.status_code != 200:
            logger.warning(f"ElevenLabs {r.status_code}: {r.text[:200]}")
            return None
        filename = f"tts_{uuid.uuid4().hex}.mp3"
        (TTS_DIR / filename).write_bytes(r.content)
        return filename
    except Exception as e:
        logger.warning(f"ElevenLabs error: {e}")
        return None


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
