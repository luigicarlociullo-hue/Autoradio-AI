"""HuggingFace Spaces audio service.
Uses free public Gradio Spaces to synthesize speech (Bark) and generate music
(Stable Audio Open) so the AI radio can play real AI-generated audio without
paying for ElevenLabs or Suno.
"""
import os
import time
import uuid
import shutil
import asyncio
import logging
from pathlib import Path
from typing import Optional

from gradio_client import Client

logger = logging.getLogger(__name__)

HF_TOKEN = os.environ.get("HF_TOKEN", "")
AUDIO_DIR = Path(__file__).parent / "generated_audio"
AUDIO_DIR.mkdir(exist_ok=True)

# Italian bark speaker roster (open-source Suno Bark supports 10 IT speakers)
BARK_IT_SPEAKERS = [
    "Speaker 0 (it)", "Speaker 1 (it)", "Speaker 2 (it)", "Speaker 3 (it)",
    "Speaker 4 (it)", "Speaker 5 (it)", "Speaker 6 (it)", "Speaker 7 (it)",
    "Speaker 8 (it)", "Speaker 9 (it)",
]

VOICE_KEY_TO_BARK = {
    "female-1": "Speaker 3 (it)",
    "female-2": "Speaker 7 (it)",
    "female-3": "Speaker 5 (it)",
    "female-4": "Speaker 9 (it)",
    "female-5": "Speaker 2 (it)",
    "male-1":   "Speaker 4 (it)",
    "male-2":   "Speaker 1 (it)",
    "male-3":   "Speaker 6 (it)",
    "male-4":   "Speaker 8 (it)",
    "male-5":   "Speaker 0 (it)",
}


def _bark_client() -> Client:
    return Client("suno/bark")


def _music_client() -> Client:
    if HF_TOKEN:
        os.environ["HF_TOKEN"] = HF_TOKEN
    return Client("artificialguybr/Stable-Audio-Open-Zero")


def _store(src_path: str, ext: str) -> str:
    """Copy the transient gradio-generated file into our audio dir with a stable name."""
    if not src_path or not os.path.exists(src_path):
        return ""
    fname = f"{uuid.uuid4().hex}.{ext}"
    dest = AUDIO_DIR / fname
    shutil.copy(src_path, dest)
    return fname


async def synth_speech(text: str, voice_key: str = "female-1") -> Optional[str]:
    """Generate TTS via Bark space. Returns filename inside AUDIO_DIR, or None on failure."""
    if not text or not text.strip():
        return None
    # Bark works best with <200 chars per call
    text = text.strip()[:280]
    speaker = VOICE_KEY_TO_BARK.get(voice_key, "Speaker 3 (it)")

    def _run():
        try:
            c = _bark_client()
            t0 = time.time()
            result = c.predict(text=text, history_prompt=speaker, api_name="/gen_tts")
            logger.info(f"bark ok in {time.time()-t0:.1f}s -> {result}")
            return _store(result, "wav")
        except Exception as e:
            logger.warning(f"bark failed: {e}")
            return None

    return await asyncio.to_thread(_run)


async def synth_music(prompt: str, seconds: int = 15) -> Optional[str]:
    """Generate music via Stable Audio Open space. Returns filename or None."""
    if not prompt:
        prompt = "atmospheric electronic music, cinematic, warm synth"

    seconds = max(6, min(seconds, 20))

    def _run():
        try:
            c = _music_client()
            t0 = time.time()
            result = c.predict(
                prompt=prompt[:180],
                seconds_total=float(seconds),
                steps=30,
                cfg_scale=7,
                api_name="/predict",
            )
            logger.info(f"stable-audio ok in {time.time()-t0:.1f}s -> {result}")
            return _store(result, "wav")
        except Exception as e:
            logger.warning(f"stable-audio failed: {e}")
            return None

    return await asyncio.to_thread(_run)


def audio_path(filename: str) -> Optional[Path]:
    p = AUDIO_DIR / filename
    if not p.exists() or not p.is_file():
        return None
    # prevent path escape
    try:
        p.resolve().relative_to(AUDIO_DIR.resolve())
    except ValueError:
        return None
    return p


def cleanup_old(max_files: int = 100):
    """Keep only the newest N files to avoid disk bloat."""
    files = sorted(AUDIO_DIR.glob("*.*"), key=lambda p: p.stat().st_mtime, reverse=True)
    for p in files[max_files:]:
        try:
            p.unlink()
        except Exception:
            pass
