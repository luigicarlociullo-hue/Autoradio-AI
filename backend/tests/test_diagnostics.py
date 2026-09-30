"""Diagnostics: /api/health carries the build SHA; /api/admin/tracks/duration-audit is admin-gated, read-only,
and flags declared-vs-ffprobe duration differences > 0.5s and missing values.
Run:  python -m pytest -n 0 tests/test_diagnostics.py   (from backend/)
"""
import shutil
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
    sha_file = server.Path(server.__file__).parent / "build_sha.txt"
    saved = sha_file.read_text() if sha_file.exists() else None   # a real publish-time build_sha.txt must survive the test
    sha_file.unlink(missing_ok=True)
    try:
        assert server._resolve_build_sha() == "unknown"
        sha_file.write_text("unknown\n")
        assert server._resolve_build_sha() == "unknown"           # placeholder counts as no value
        sha_file.write_text("")
        assert server._resolve_build_sha() == "unknown"           # empty file too
        sha_file.write_text("deadbee\n")
        assert server._resolve_build_sha() == "deadbee"
    finally:
        sha_file.unlink(missing_ok=True)
        if saved is not None:
            sha_file.write_text(saved)
    monkeypatch.setattr(server.subprocess, "run", real)
    assert server._resolve_build_sha() != ""


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg required")
def test_duration_audit_flags_and_is_read_only(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "SUNO_AUDIO_DIR", tmp_path)
    monkeypatch.setattr(server.object_storage, "is_enabled", lambda: False)   # hermetic: no network even if .env enables it
    subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "sine=d=3", "-y", str(tmp_path / "a.mp3")], check=True)

    def trk(i, title, dur, url="/api/suno_audio/a.mp3"):
        d = {"id": i, "title": title, "artist": "A", "audio_url": url, "deleted_at": None}
        if dur is not None:
            d["duration_sec"] = dur
        return d

    async def run():
        db = server.db
        await db.client.drop_database("cadence_sim")
        await db.tracks.insert_many([
            trk("ok", "Zeta", 3.0), trk("short", "Notte senza fine", 1.0), trk("nodur", "Neon night forever", None),
            trk("margin", "Margin", 5.0), trk("gone", "Gone", 10.0, "/api/suno_audio/missing.mp3")])
        before = await db.tracks.find({}, {"_id": 0}).sort("id", 1).to_list(20)
        async with _client() as c:
            anon = await c.get("/api/admin/tracks/duration-audit")
            r = await c.get("/api/admin/tracks/duration-audit", headers=_admin())
            f = await c.get("/api/admin/tracks/duration-audit?title=senza", headers=_admin())
        after = await db.tracks.find({}, {"_id": 0}).sort("id", 1).to_list(20)
        return anon, r.json(), f.json(), before == after
    anon, body, filt, unchanged = _loop.run_until_complete(run())
    assert anon.status_code == 401 and unchanged
    rows = {r["id"]: r for r in body["rows"]}
    assert [r["id"] for r in body["rows"][:2]] == ["short", "nodur"]            # priority titles first
    assert rows["ok"]["flags"] == [] and abs(rows["ok"]["ffprobe_sec"] - 3.0) < 0.2
    assert "declared_shorter" in rows["short"]["flags"] and rows["short"]["diff_sec"] < -0.5
    assert "missing_declared" in rows["nodur"]["flags"]
    assert "declared_longer" in rows["margin"]["flags"] and rows["margin"]["reprobe_margin"] is True
    assert "file_unreachable" in rows["gone"]["flags"]
    assert body["flagged"] == 4
    assert [r["id"] for r in filt["rows"]] == ["short"]
