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


def _refine_bpm(y, sr: int, coarse: float) -> float:
    import librosa
    import numpy as np
    hop = 64
    oenv = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    oenv = oenv - oenv.mean()
    ac = np.correlate(oenv, oenv, mode="full")[len(oenv) - 1:]
    fps = sr / hop
    lag = fps * 60.0 / coarse
    lo, hi = int(lag * 0.93), int(lag * 1.07) + 1
    if lo < 2 or hi >= len(ac) - 1:
        return coarse
    i = lo + int(np.argmax(ac[lo:hi]))
    a, b, c = ac[i - 1], ac[i], ac[i + 1]
    den = a - 2 * b + c
    d = (a - c) / (2 * den) if den != 0 else 0.0
    refined = 60.0 * fps / (i + d)
    return refined if 60 <= refined <= 200 else coarse


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
        # Ticket #247410: con NumPy 2.x float() su un array di 1 elemento solleva
        # TypeError → ogni scansione BPM tornava None senza log.
        try:
            import numpy as _np
            bpm = float(_np.asarray(tempo, dtype=float).reshape(-1)[0])
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
        # Ticket #247410: beat_track a hop 512 ha una griglia di ~6 BPM attorno a 128
        # (126 → 123, 140 → 144): troppo grezza per il beat-match. Rifinitura con
        # autocorrelazione dell'onset a hop 64 + interpolazione sub-frame (±0.1 BPM).
        try:
            bpm = _refine_bpm(y, sr, bpm)
        except Exception:
            pass
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
