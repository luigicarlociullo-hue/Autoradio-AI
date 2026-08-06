"""
Emergent Object Storage abstraction for R-A.I.

Purpose:
  Store Suno .mp3 tracks and OpenAI TTS .mp3 voice files on Emergent's
  centralized object storage instead of the local container filesystem.
  This is what allows PREVIEW and PRODUCTION to serve the SAME audio
  library — because the storage bucket is shared across environments.

Design:
  * Feature-flagged via env var `USE_OBJECT_STORAGE` (default: false).
    When false, this module is inert and the app keeps writing/reading
    local files exactly as before. Zero behavior change.
  * When true:
      - New Suno downloads and new TTS files are also pushed to object
        storage; the DB stores a `objstore://<path>` URL.
      - The /api/suno_audio/{filename} and /api/tts/{filename} endpoints
        transparently fetch from object storage if the local file is
        missing (so already-uploaded tracks keep working after a redeploy
        into a fresh container).
  * Uses the sync `requests` library from the official playbook, wrapped
    in `asyncio.to_thread` so we never block the FastAPI event loop.

Env vars:
  EMERGENT_LLM_KEY       — required (already present in .env)
  USE_OBJECT_STORAGE     — "true" to activate (default: "false")
  OBJSTORE_APP_NAME      — bucket prefix (default: "r-a-i")
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Optional, Tuple

import requests

logger = logging.getLogger("r-a-i.objstore")

STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
APP_NAME = os.environ.get("OBJSTORE_APP_NAME", "r-a-i")

_storage_key: Optional[str] = None


def is_enabled() -> bool:
    """True when USE_OBJECT_STORAGE env var opts in.  Off by default."""
    return os.environ.get("USE_OBJECT_STORAGE", "false").strip().lower() in ("true", "1", "yes", "on")


def _init_storage_sync() -> str:
    """Blocking init. Uses module-level cache — call once, reuse forever."""
    global _storage_key
    if _storage_key:
        return _storage_key
    emergent_key = os.environ.get("EMERGENT_LLM_KEY")
    if not emergent_key:
        raise RuntimeError("EMERGENT_LLM_KEY is missing — cannot init object storage")
    resp = requests.post(
        f"{STORAGE_URL}/init",
        json={"emergent_key": emergent_key},
        timeout=30,
    )
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


async def init_storage() -> Optional[str]:
    """Idempotent async init. Returns None (and logs) if disabled or fails."""
    if not is_enabled():
        return None
    try:
        return await asyncio.to_thread(_init_storage_sync)
    except Exception as e:  # noqa: BLE001
        logger.warning(f"Object storage init failed: {e}")
        return None


def _put_object_sync(path: str, data: bytes, content_type: str) -> dict:
    key = _init_storage_sync()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=180,
    )
    if resp.status_code == 409:
        # Object already exists — treat as success and return path.
        return {"path": path, "size": len(data), "etag": "existing"}
    resp.raise_for_status()
    return resp.json()


def _get_object_sync(path: str) -> Tuple[bytes, str]:
    key = _init_storage_sync()
    resp = requests.get(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key},
        timeout=120,
    )
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


async def put_mp3(sub_path: str, data: bytes) -> Optional[str]:
    """Upload an mp3 and return the canonical storage path (no leading slash),
    e.g. 'r-a-i/suno/track_xxx.mp3'.  Returns None if disabled or failed."""
    if not is_enabled():
        return None
    full_path = f"{APP_NAME}/{sub_path.lstrip('/')}"
    try:
        result = await asyncio.to_thread(_put_object_sync, full_path, data, "audio/mpeg")
        logger.info(f"objstore ← uploaded {full_path} ({result.get('size')} bytes)")
        return result["path"]
    except Exception as e:  # noqa: BLE001
        logger.warning(f"objstore upload failed for {full_path}: {e}")
        return None


async def fetch_mp3(sub_path: str) -> Optional[bytes]:
    """Download an mp3 from object storage.  Returns raw bytes or None."""
    if not is_enabled():
        return None
    full_path = f"{APP_NAME}/{sub_path.lstrip('/')}"
    try:
        data, _ct = await asyncio.to_thread(_get_object_sync, full_path)
        return data
    except Exception as e:  # noqa: BLE001
        logger.warning(f"objstore fetch failed for {full_path}: {e}")
        return None


async def upload_local_file(local_path: str, sub_path: str) -> Optional[str]:
    """Read a local file from disk and upload it. Convenience for migration."""
    if not is_enabled():
        return None
    try:
        def _read() -> bytes:
            with open(local_path, "rb") as f:
                return f.read()
        data = await asyncio.to_thread(_read)
        return await put_mp3(sub_path, data)
    except FileNotFoundError:
        logger.warning(f"upload_local_file: {local_path} not found")
        return None


async def stream_mp3(sub_path: str, cache_to: Optional[str] = None):
    """Streaming immediato da Object Storage al client.

    Restituisce (async_generator, content_length_str_or_None) oppure None se
    disabilitato/errore.  I chunk vengono pushati al browser NON APPENA
    arrivano dal bucket (nessun download completo in memoria), permettendo
    latenza tipo TTFB ~200ms invece di 3-8s per un MP3 da qualche MB.

    Se `cache_to` è fornito, i chunk vengono anche scritti in un file
    temporaneo che al termine viene rinominato in `cache_to` (populamento
    lazy della cache locale — tutte le richieste successive saranno servite
    da disco con supporto Range nativo di FileResponse).
    """
    if not is_enabled():
        return None
    key = await asyncio.to_thread(_init_storage_sync)
    full_path = f"{APP_NAME}/{sub_path.lstrip('/')}"
    import httpx
    client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=120.0))
    try:
        req = client.build_request(
            "GET",
            f"{STORAGE_URL}/objects/{full_path}",
            headers={"X-Storage-Key": key},
        )
        response = await client.send(req, stream=True)
        if response.status_code != 200:
            await response.aclose()
            await client.aclose()
            logger.warning(f"objstore stream: got {response.status_code} for {full_path}")
            return None
        content_length = response.headers.get("Content-Length")
    except Exception as e:  # noqa: BLE001
        try: await client.aclose()
        except Exception: pass
        logger.warning(f"objstore stream open failed for {full_path}: {e}")
        return None

    async def _generator():
        import os as _os
        tmp_path = None
        f = None
        if cache_to:
            try:
                tmp_path = cache_to + ".part"
                f = open(tmp_path, "wb")
            except Exception:
                f = None
                tmp_path = None
        try:
            async for chunk in response.aiter_bytes(chunk_size=64 * 1024):
                if chunk:
                    if f is not None:
                        try:
                            f.write(chunk)
                        except Exception:
                            try: f.close()
                            except Exception: pass
                            f = None
                    yield chunk
        finally:
            try: await response.aclose()
            except Exception: pass
            try: await client.aclose()
            except Exception: pass
            if f is not None:
                try:
                    f.close()
                    if tmp_path and cache_to:
                        _os.replace(tmp_path, cache_to)
                        logger.info(f"objstore cache populated: {cache_to}")
                except Exception as e:  # noqa: BLE001
                    logger.debug(f"cache write finalize failed: {e}")

    return _generator(), content_length
