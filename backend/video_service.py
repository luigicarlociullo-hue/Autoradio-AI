"""Video probe + HLS support helpers (v13.9).

- `probe_video(path_or_bytes)`: usa `ffprobe` per estrarre duration, width,
  height, codec del file. Ritorna dict o None.
- `probe_video_from_bytes(data, suffix)`: variante bytes.

Il transcoding vero e proprio verso .ts HLS non è necessario perché mp4
funziona come segmento HLS (hls.js li accetta come frammenti VOD). Quindi
usiamo solo il probing per popolare metadata reali (duration_sec).
"""
from __future__ import annotations
import asyncio
import json
import logging
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


def _probe_sync(path: str) -> Optional[dict]:
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json",
             "-show_format", "-show_streams", path],
            capture_output=True, text=True, timeout=20,
        )
        if r.returncode != 0:
            return None
        d = json.loads(r.stdout)
        fmt = d.get("format", {}) or {}
        video_s = next((s for s in d.get("streams", []) if s.get("codec_type") == "video"), None)
        audio_s = next((s for s in d.get("streams", []) if s.get("codec_type") == "audio"), None)
        return {
            "duration_sec": float(fmt.get("duration", 0.0)) if fmt.get("duration") else None,
            "size_bytes": int(fmt.get("size", 0)) if fmt.get("size") else None,
            "bit_rate": int(fmt.get("bit_rate", 0)) if fmt.get("bit_rate") else None,
            "format_name": fmt.get("format_name"),
            "width": (video_s or {}).get("width"),
            "height": (video_s or {}).get("height"),
            "video_codec": (video_s or {}).get("codec_name"),
            "audio_codec": (audio_s or {}).get("codec_name"),
            "has_video": bool(video_s),
            "has_audio": bool(audio_s),
        }
    except Exception as e:
        logger.warning(f"[ffprobe] failed for {path}: {e}")
        return None


async def probe_video(path: str) -> Optional[dict]:
    return await asyncio.to_thread(_probe_sync, path)


async def probe_video_from_bytes(data: bytes, suffix: str = ".mp4") -> Optional[dict]:
    if not data:
        return None
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tf:
            tf.write(data)
            tmp = tf.name
        return await asyncio.to_thread(_probe_sync, tmp)
    finally:
        if tmp:
            try: Path(tmp).unlink()
            except Exception: pass
