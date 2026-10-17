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
            "pix_fmt": (video_s or {}).get("pix_fmt"),
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


# Ticket #247410: i browser (<video>) decodificano solo H.264/VP8/VP9/AV1 in
# yuv420p. Un MP4 "mpeg4" (MPEG-4 Part 2), HEVC o 10-bit viene accettato
# dall'upload ma il LedWall resta nero (Chrome: DEMUXER_ERROR_NO_SUPPORTED_STREAMS).
WEB_VIDEO_CODECS = {"h264", "vp8", "vp9", "av1"}


def is_web_playable(probe: Optional[dict]) -> bool:
    if not probe or not probe.get("has_video"):
        return False
    if (probe.get("video_codec") or "").lower() not in WEB_VIDEO_CODECS:
        return False
    pf = (probe.get("pix_fmt") or "yuv420p").lower()
    return pf in ("yuv420p", "yuvj420p")


def _transcode_h264_sync(src: str, dst: str) -> bool:
    r = subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", src,
         "-map", "0:v:0", "-map", "0:a:0?",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
         "-pix_fmt", "yuv420p", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
         "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", dst],
        capture_output=True, text=True, timeout=900,
    )
    if r.returncode != 0:
        logger.warning(f"[transcode] ffmpeg failed: {r.stderr[-400:]}")
    return r.returncode == 0 and Path(dst).exists() and Path(dst).stat().st_size > 0


async def ensure_web_playable(data: bytes, suffix: str = ".mp4"):
    """Ritorna (bytes, probe, transcoded). Se il video non e' riproducibile dal
    browser lo converte in MP4 H.264/AAC (faststart); altrimenti lo lascia
    intatto. In caso di errore ffmpeg ritorna l'originale."""
    probe = await probe_video_from_bytes(data, suffix)
    if not probe or not probe.get("has_video") or is_web_playable(probe):
        return data, probe, False
    with tempfile.TemporaryDirectory() as td:
        src, dst = str(Path(td) / f"in{suffix}"), str(Path(td) / "out.mp4")
        Path(src).write_bytes(data)
        ok = await asyncio.to_thread(_transcode_h264_sync, src, dst)
        if not ok:
            return data, probe, False
        out = Path(dst).read_bytes()
        new_probe = await asyncio.to_thread(_probe_sync, dst)
    logger.info(f"[transcode] {probe.get('video_codec')}/{probe.get('pix_fmt')} -> h264 ({len(data)} -> {len(out)} bytes)")
    return out, new_probe or probe, True
