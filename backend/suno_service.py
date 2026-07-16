"""Suno music generation service — provider-agnostic client that works with
any Suno-compatible API (sunoapi.org, musicapi.ai, kie.ai, apiframe.ai).

Uses two env vars for configuration:
    SUNO_API_KEY    — the Bearer token
    SUNO_BASE_URL   — provider base URL, e.g. https://api.sunoapi.org
    SUNO_MODEL      — optional model version (defaults to V4)

Endpoints assumed (sunoapi.org / kie.ai family):
    POST {BASE}/api/v1/generate            → returns {code, msg, data: {taskId}}
    GET  {BASE}/api/v1/generate/record-info?taskId=X → returns {code, data: {status, response: {sunoData: [{audioUrl, ...}]}}}

If your provider uses different paths, adjust the SUNO_CREATE_PATH and
SUNO_STATUS_PATH env variables. Default paths match sunoapi.org.
"""
import os
import time
import uuid
import asyncio
import logging
import httpx
from typing import Optional

logger = logging.getLogger(__name__)


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name, default) or default).strip()


def is_enabled() -> bool:
    return bool(_env("SUNO_API_KEY"))


def _base() -> str:
    return _env("SUNO_BASE_URL", "https://api.sunoapi.org").rstrip("/")


def _model() -> str:
    return _env("SUNO_MODEL", "V4")


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {_env('SUNO_API_KEY')}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


async def create_task(prompt: str, *, style: str = "", title: str = "",
                       instrumental: bool = False, custom_lyrics: str = "",
                       negative_tags: str = "") -> Optional[str]:
    """Submit a generation request. Returns taskId or None on failure."""
    if not is_enabled():
        return None
    create_path = _env("SUNO_CREATE_PATH", "/api/v1/generate")
    url = f"{_base()}{create_path}"
    # sunoapi.org payload
    payload = {
        "prompt": prompt[:2000],
        "customMode": bool(custom_lyrics),
        "instrumental": instrumental,
        "model": _model(),
        # Providers require callBackUrl even if we poll instead. Some accept "" or a dummy.
        "callBackUrl": _env("SUNO_CALLBACK_URL", "https://webhook.site/none"),
    }
    if custom_lyrics:
        payload["prompt"] = custom_lyrics[:2000]
        payload["style"] = style[:200] or "pop"
        payload["title"] = title[:80] or "Untitled"
    if negative_tags:
        payload["negativeTags"] = negative_tags[:200]
    try:
        async with httpx.AsyncClient(timeout=45) as h:
            r = await h.post(url, headers=_headers(), json=payload)
        data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        if r.status_code != 200 or data.get("code") not in (200, 0, None):
            logger.warning(f"Suno create failed: {r.status_code} {data}")
            return None
        task_id = (data.get("data") or {}).get("taskId") or data.get("task_id") or data.get("id")
        return task_id
    except Exception as e:
        logger.warning(f"Suno create exception: {e}")
        return None


async def poll_task(task_id: str, *, timeout_sec: int = 240, interval_sec: int = 8) -> Optional[dict]:
    """Poll for completion. Returns dict with audioUrl + metadata on success."""
    if not is_enabled() or not task_id:
        return None
    status_path = _env("SUNO_STATUS_PATH", "/api/v1/generate/record-info")
    url = f"{_base()}{status_path}"
    started = time.time()
    async with httpx.AsyncClient(timeout=30) as h:
        while time.time() - started < timeout_sec:
            try:
                r = await h.get(url, headers=_headers(), params={"taskId": task_id})
                data = r.json() if r.status_code == 200 else {}
                d = data.get("data") or {}
                status = (d.get("status") or "").upper()
                if status in ("SUCCESS", "COMPLETED", "SUCCESSFUL"):
                    # sunoapi.org: response.sunoData[0].audioUrl
                    resp = d.get("response") or {}
                    songs = resp.get("sunoData") or resp.get("data") or []
                    if songs:
                        first = songs[0]
                        return {
                            "audio_url": first.get("audioUrl") or first.get("audio_url"),
                            "image_url": first.get("imageUrl") or first.get("image_url"),
                            "title": first.get("title") or "",
                            "duration": first.get("duration") or 0,
                            "tags": first.get("tags") or "",
                            "prompt": first.get("prompt") or "",
                        }
                    return None
                if status in ("FAILED", "ERROR"):
                    logger.warning(f"Suno task {task_id} failed: {d}")
                    return None
            except Exception as e:
                logger.debug(f"Suno poll error: {e}")
            await asyncio.sleep(interval_sec)
    logger.warning(f"Suno task {task_id} polling timeout")
    return None


async def generate_song(prompt: str, *, style: str = "", title: str = "",
                         instrumental: bool = False, custom_lyrics: str = "") -> Optional[dict]:
    """One-shot: create + poll. Returns audio_url dict or None."""
    task_id = await create_task(prompt, style=style, title=title,
                                  instrumental=instrumental, custom_lyrics=custom_lyrics)
    if not task_id:
        return None
    return await poll_task(task_id)
