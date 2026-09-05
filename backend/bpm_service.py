"""Beat / BPM detection server-side (v13.2).

Usa `librosa.beat.beat_track` sull'onset envelope: robusto per la maggior
parte dei generi (electronic, pop, rock). Restituisce un intero 60..200 BPM
oppure None se il file non è leggibile o l'analisi non è affidabile.

Uso: `detect_bpm_from_bytes(mp3_bytes)` chiamato al termine di un upload
(o dopo il download da Suno) — l'output va salvato nel campo `tracks.bpm`.
"""
from __future__ import annotations
import asyncio
import logging
import tempfile
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


def _detect_sync(path: str) -> Optional[int]:
    """Blocking analisi — chiamare in `asyncio.to_thread`."""
    try:
        import librosa  # heavy import, lazy
        y, sr = librosa.load(path, sr=22050, mono=True, duration=90.0)  # primi 90s
        if y is None or len(y) < sr * 5:
            return None
        # onset envelope + beat tracking
        tempo, _beats = librosa.beat.beat_track(y=y, sr=sr, units="frames")
        # `tempo` può essere numpy scalar/array — normalizza a float
        try:
            bpm = float(tempo) if hasattr(tempo, "__float__") else float(tempo[0])
        except Exception:
            return None
        if bpm != bpm:  # NaN
            return None
        # Clampa in un range musicale sensato. Se cade fuori raddoppia/dimezza
        # (librosa spesso ritorna octave-errors).
        while bpm > 200:
            bpm /= 2.0
        while bpm < 60:
            bpm *= 2.0
        return int(round(bpm))
    except Exception as e:
        logger.warning(f"[bpm] detect failed for {path}: {e}")
        return None


async def detect_bpm_from_bytes(data: bytes, suffix: str = ".mp3") -> Optional[int]:
    """Salva bytes in un file temp e lancia il detector in thread pool."""
    if not data:
        return None
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tf:
            tf.write(data)
            tmp = tf.name
        bpm = await asyncio.to_thread(_detect_sync, tmp)
        return bpm
    finally:
        if tmp:
            try:
                Path(tmp).unlink()
            except Exception:
                pass


async def detect_bpm_from_path(path: str) -> Optional[int]:
    return await asyncio.to_thread(_detect_sync, path)
