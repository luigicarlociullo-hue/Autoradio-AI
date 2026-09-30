"""Diagnostics: /api/health carries the build SHA; carries the build SHA.
Run:  python -m pytest -n 0 tests/test_diagnostics.py   (from backend/)
"""
import subprocess

import httpx
import pytest
from fastapi import FastAPI

import test_cadence_invariant as cad   # shares its event loop + `server` import (scratch DB cadence_sim)
import auth

server = cad.server
_loop = cad._loop


def _client():
    app = FastAPI()
    app.include_router(server.api_router)
    app.middleware("http")(auth.admin_gate_middleware)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")


def _admin():
    import os; os.environ.setdefault("JWT_SECRET", "test-secret-diag")
    return {"Authorization": f"Bearer {auth.create_access_token('u1', 'a@b.c', 'admin')}"}


def test_health_reports_sha(monkeypatch):
    async def run():
        await server.db.client.drop_database("cadence_sim")
        await server.db.station_clock.insert_one({"_id": "clock", "seq": 0})
        monkeypatch.setattr(server, "_STARTUP_READY", True)
        monkeypatch.setattr(server, "BUILD_SHA", "abc1234")
        async with _client() as c:
            return (await c.get("/api/health")).json()
    body = _loop.run_until_complete(run())
    assert body["ok"] is True and body["sha"] == "abc1234"


def test_build_sha_fallbacks(tmp_path, monkeypatch):
    real = subprocess.run
    monkeypatch.setattr(server.subprocess, "run", lambda *a, **k: (_ for _ in ()).throw(FileNotFoundError()))   # no git
    sha_file = server.Path(server.__file__).parent / "BUILD_SHA"
    assert not sha_file.exists()
    assert server._resolve_build_sha() == "unknown"
    sha_file.write_text("deadbee\n")
    try:
        assert server._resolve_build_sha() == "deadbee"
    finally:
        sha_file.unlink()
    monkeypatch.setattr(server.subprocess, "run", real)
    assert server._resolve_build_sha() != ""
