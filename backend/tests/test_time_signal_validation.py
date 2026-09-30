"""Time-signal audio validation (mocked TTS/LLM, real ffmpeg/ffprobe).

- (generation itself is covered by test_time_signal_generation.py)
- the resolver serves validated (or legacy, unflagged) files, refuses validated=False,
  never reads the kill-switch, and logs an ERROR when it has nothing to serve
- /admin/time-signal/verify is read-only and lists bad hours
Run:  python -m pytest -n 0 tests/test_time_signal_validation.py   (from backend/)
"""
import logging
import os
import subprocess
from datetime import datetime

import pytest

import test_cadence_invariant as cad   # shares its event loop + `server` import

server = cad.server
_loop = cad._loop
TTS_DIR = server.elevenlabs_service.TTS_DIR
PREFIX = "test_ts_"


def _make(name, kind):
    p = TTS_DIR / f"{PREFIX}{name}.mp3"
    if kind == "tone":
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
                        "-q:a", "5", str(p)], check=True)
    elif kind == "silence":
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=22050:cl=mono",
                        "-t", "2", "-q:a", "5", str(p)], check=True)
    elif kind == "empty":
        p.write_bytes(b"")
    elif kind == "garbage":
        p.write_bytes(b"this is not audio at all" * 20)
    return p.name


@pytest.fixture(autouse=True)
def _storage_off(monkeypatch):
    """Independent of backend/.env: no Object Storage (and no network) unless a test installs its own fake."""
    monkeypatch.setattr(server.object_storage, "is_enabled", lambda: False)


@pytest.fixture(autouse=True)
def _clean():
    async def wipe():
        await server.db.client.drop_database("cadence_sim")
        await server.db.station.update_one({"_id": "state"}, {"$set": {"ai_openai_talk": False}}, upsert=True)
    _loop.run_until_complete(wipe())
    server._invalidate_ai_controls_cache()
    yield
    for f in TTS_DIR.glob(f"{PREFIX}*"):
        f.unlink()


def _no_llm(monkeypatch):
    calls = []

    async def boom(*a, **k):
        calls.append(a)
        raise AssertionError("LLM must not be called")
    monkeypatch.setattr(server, "llm_generate", boom)
    return calls


def test_resolver_serves_validated_and_legacy_never_reads_switch_and_is_loud(monkeypatch, caplog):
    llm = _no_llm(monkeypatch)

    async def switch_read(*a, **k):
        raise AssertionError("resolver must not read the kill-switch")
    monkeypatch.setattr(server, "_get_ai_controls", switch_read)
    from zoneinfo import ZoneInfo
    h = datetime.now(ZoneInfo("Europe/Rome")).hour
    perm = server.db.time_signal_permanent
    ok_name = _make("resolver_ok", "tone")                      # the served file must actually be reachable

    def resolve():
        return _loop.run_until_complete(server._resolve_current_hour_time_signal())

    _loop.run_until_complete(perm.insert_one({"_id": h, "speech_audio_url": f"/api/tts/{ok_name}", "validated": True}))
    assert resolve() == f"/api/tts/{ok_name}"
    _loop.run_until_complete(perm.update_one({"_id": h}, {"$unset": {"validated": ""}}))
    assert resolve() == f"/api/tts/{ok_name}"                       # legacy file (no flag): still served
    _loop.run_until_complete(perm.update_one({"_id": h}, {"$set": {"validated": False, "validation_reason": "silent"}}))
    with caplog.at_level(logging.ERROR):
        assert resolve() is None
    assert any("NESSUN AUDIO" in r.message and "silent" in r.message for r in caplog.records)
    caplog.clear()
    _loop.run_until_complete(perm.delete_one({"_id": h}))
    with caplog.at_level(logging.ERROR):
        assert resolve() is None
    assert any("NESSUN AUDIO" in r.message for r in caplog.records)
    assert llm == []


def test_verify_lists_bad_hours_and_writes_nothing():
    good, silent, empty = _make("v_good", "tone"), _make("v_silent", "silence"), _make("v_empty", "empty")
    docs = [
        {"_id": 0, "speech_audio_url": f"/api/tts/{good}"},
        {"_id": 1, "speech_audio_url": f"/api/tts/{silent}", "validated": True},        # flag says ok, file is silent
        {"_id": 2, "speech_audio_url": f"/api/tts/{empty}"},
        {"_id": 3, "speech_audio_url": "/api/tts/does_not_exist.mp3"},
    ]
    _loop.run_until_complete(server.db.time_signal_permanent.insert_many(docs))
    before = _loop.run_until_complete(server.db.time_signal_permanent.find({}).sort("_id", 1).to_list(50))
    res = _loop.run_until_complete(server.admin_verify_permanent_time_signals())
    after = _loop.run_until_complete(server.db.time_signal_permanent.find({}).sort("_id", 1).to_list(50))
    assert before == after                                      # read-only
    assert res["ok"] is False and res["bad_hours"] == [h for h in range(24) if h != 0]
    by = {r["hour"]: r for r in res["hours"]}
    assert by[0]["status"] == "ok" and by[0]["duration_sec"] > 0
    assert by[1]["reason"] == "silent" and by[2]["reason"] == "empty_file" and by[3]["reason"] == "file_missing"
    assert by[4]["status"] == "missing"


def test_verify_flags_local_only_file_missing_from_object_storage(monkeypatch):
    """With storage on, a file that exists only on this pod's disk is NOT good: other pods cannot serve it."""
    local_only, stored = _make("v_local_only", "tone"), _make("v_stored", "tone")
    objs = {f"tts/{stored}": (TTS_DIR / stored).read_bytes()}

    async def get_bytes(key):
        return objs.get(key)
    monkeypatch.setattr(server.object_storage, "is_enabled", lambda: True)
    monkeypatch.setattr(server.object_storage, "get_bytes", get_bytes)
    _loop.run_until_complete(server.db.time_signal_permanent.insert_many([
        {"_id": 0, "speech_audio_url": f"/api/tts/{stored}", "validated": True},
        {"_id": 1, "speech_audio_url": f"/api/tts/{local_only}", "validated": True},
        {"_id": 2, "speech_audio_url": "/api/audio/abc.wav", "validated": True}]))
    by = {r["hour"]: r for r in _loop.run_until_complete(server.admin_verify_permanent_time_signals())["hours"]}
    assert by[0]["status"] == "ok"
    assert by[1]["status"] == "bad" and by[1]["reason"] == "not_in_object_storage"
    assert by[2]["status"] == "bad" and by[2]["reason"] == "not_tts_mp3"
