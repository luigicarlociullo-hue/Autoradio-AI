"""Time-signal generation / regeneration / resolver (fake TTS, fake Object Storage, real ffmpeg, temp TTS dir).

- generation only accepts mp3 from ElevenLabs/OpenAI (never Bark), works with ai_openai_talk OFF, uploads to storage,
  re-fetches and validates the re-fetched bytes; validated=True only if everything passes
- a failed attempt never touches an existing (valid) document or its file
- hours=... / default (no force) regenerate only what is bad; good hours are untouched
- resolver: permanent -> same-hour cache -> clean skip; unreachable files are not served; no other hour's file; short cache
Run:  python -m pytest -n 0 tests/test_time_signal_generation.py   (from backend/)
"""
import subprocess
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException

import test_cadence_invariant as cad   # shares its event loop + `server` import

server = cad.server
_loop = cad._loop
run = _loop.run_until_complete
_TONE = {}


def _audio(kind):
    if kind in _TONE:
        return _TONE[kind]
    import tempfile, os
    fd, path = tempfile.mkstemp(suffix=".mp3"); os.close(fd)
    if kind == "tone":
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-q:a", "5", path], check=True)
    elif kind == "tone2":
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=660:duration=2", "-q:a", "5", path], check=True)
    elif kind == "silence":
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=22050:cl=mono", "-t", "2", "-q:a", "5", path], check=True)
    elif kind == "garbage":
        open(path, "wb").write(b"this is not audio at all" * 20)
    else:
        open(path, "wb").write(b"")
    _TONE[kind] = open(path, "rb").read()
    os.remove(path)
    return _TONE[kind]


class FakeStore:
    def __init__(self):
        self.objs, self.fail_put, self.get_calls, self.corrupt = {}, False, 0, None


@pytest.fixture
def store(monkeypatch, tmp_path):
    st = FakeStore()
    osm = server.object_storage

    async def put_mp3(key, data):
        if st.fail_put:
            return None
        st.objs[key] = data
        return f"r-a-i/{key}"

    async def get_bytes(key):
        st.get_calls += 1
        d = st.objs.get(key)
        return st.corrupt(d) if (st.corrupt and d) else d
    monkeypatch.setattr(osm, "is_enabled", lambda: True)
    monkeypatch.setattr(osm, "put_mp3", put_mp3)
    monkeypatch.setattr(osm, "get_bytes", get_bytes)
    monkeypatch.setattr(server.elevenlabs_service, "TTS_DIR", tmp_path)
    server._ts_reach_cache.clear()
    return st


@pytest.fixture(autouse=True)
def _clean():
    async def wipe():
        await server.db.client.drop_database("cadence_sim")
        await server.db.station.update_one({"_id": "state"}, {"$set": {"ai_openai_talk": False}}, upsert=True)
    run(wipe())
    server._invalidate_ai_controls_cache()
    server._ts_reach_cache.clear()
    yield


def _fake_tts(monkeypatch, plan=None, default="tone"):
    """plan: {hour: kind|None|'raise'}; records calls. Bark and the kill-switch must never be involved."""
    calls = []

    async def synth_bytes(text, voice_key, kind="", dj_id=None):
        h = int(text.split()[2][:2])
        calls.append(h)
        k = (plan or {}).get(h, default)
        if k == "raise":
            raise RuntimeError("provider down")
        return (_audio(k), "openai-tts-1-hd") if k else (None, None)

    async def bark_boom(*a, **k):
        raise AssertionError("Bark must never be used for permanent time signals")

    async def llm_boom(*a, **k):
        raise AssertionError("LLM must not be called")
    monkeypatch.setattr(server.elevenlabs_service, "synth_bytes", synth_bytes)
    monkeypatch.setattr(server, "bark_synth_speech", bark_boom)
    monkeypatch.setattr(server, "llm_generate", llm_boom)
    return calls


def _good_hour(store, tmp_path, h, kind="tone"):
    """A valid existing permanent for hour h: local file + storage object + doc."""
    name = f"tts_good{h:02d}.mp3"
    (tmp_path / name).write_bytes(_audio(kind))
    store.objs[f"tts/{name}"] = _audio(kind)
    doc = {"_id": h, "hour": h, "speech_audio_url": f"/api/tts/{name}", "validated": True, "bytes": 1, "duration_sec": 2.0}
    run(server.db.time_signal_permanent.insert_one(doc))
    return doc


def _gen(**kw):
    return run(server.admin_generate_permanent_time_signals(**kw))


def test_generation_switch_off_uploads_refetches_and_saves_only_validated(monkeypatch, store, tmp_path):
    calls = _fake_tts(monkeypatch, {3: "tone2", 4: "empty", 5: "silence", 6: "garbage", 7: None, 8: "raise"}, default="tone")
    res = _gen(force=True, hours="3-8")                      # ai_openai_talk is OFF (fixture) -> must still work
    assert sorted(res["failed"]) == [4, 5, 6, 7, 8] and res["generated"] == [3] and calls == [3, 4, 5, 6, 7, 8]
    reasons = {r["hour"]: r["reason"] for r in res["results"] if r["status"] == "failed"}
    assert reasons[4] == "tts_returned_nothing" and reasons[5] == "audio_invalid:silent" and reasons[6] == "audio_invalid:no_duration"
    assert reasons[7] == "tts_returned_nothing" and reasons[8].startswith("tts_error")
    d = run(server.db.time_signal_permanent.find_one({"_id": 3}))
    assert d["validated"] is True and d["storage_verified"] is True and d["max_volume_db"] > -50
    assert d["speech_audio_url"].startswith("/api/tts/tts_ts03_") and d["speech_audio_url"].endswith(".mp3")
    assert f"tts/{d['speech_audio_url'].rsplit('/', 1)[-1]}" in store.objs
    assert run(server.db.time_signal_permanent.count_documents({})) == 1        # failures saved nothing


@pytest.mark.parametrize("mode", ["upload_failed", "refetch_failed", "refetch_mismatch", "tts_nothing"])
def test_failed_attempt_never_touches_existing_valid_hour(monkeypatch, store, tmp_path, mode):
    good = _good_hour(store, tmp_path, 5)
    before_files = {p.name: p.read_bytes() for p in tmp_path.iterdir()}
    before_store = dict(store.objs)
    _fake_tts(monkeypatch, {5: None} if mode == "tts_nothing" else {5: "tone2"})
    if mode == "upload_failed":
        store.fail_put = True
    elif mode == "refetch_failed":
        store.corrupt = lambda d: None
    elif mode == "refetch_mismatch":
        store.corrupt = lambda d: d + b"x"
    res = _gen(force=True, hours="5")
    assert res["failed"] == [5] and res["generated"] == []
    assert run(server.db.time_signal_permanent.find_one({"_id": 5})) == good        # document untouched
    assert {p.name: p.read_bytes() for p in tmp_path.iterdir() if p.name in before_files} == before_files   # old file untouched


def test_hours_selection_regenerates_only_bad_hours_and_leaves_good_ones(monkeypatch, store, tmp_path):
    docs = {h: _good_hour(store, tmp_path, h) for h in range(8, 24)}
    for h in range(0, 8):                                   # the production picture: .wav docs that no pod can serve
        run(server.db.time_signal_permanent.insert_one({"_id": h, "hour": h, "speech_audio_url": f"/api/audio/{h}.wav", "validated": True}))
    calls = _fake_tts(monkeypatch)
    dry = _gen(dry_run=True)
    assert calls == [] and [r["hour"] for r in dry["results"] if r["status"] == "would_regenerate"] == list(range(8))
    assert {r["because"] for r in dry["results"] if r["status"] == "would_regenerate"} == {"not_tts_mp3"}
    res = _gen()                                            # no force, no hours: only the invalid ones
    assert res["generated"] == list(range(8)) and res["skipped_existing"] == list(range(8, 24)) and calls == list(range(8))
    for h in range(8, 24):
        assert run(server.db.time_signal_permanent.find_one({"_id": h})) == docs[h]
    assert run(server.admin_verify_permanent_time_signals())["ok"] is True


def test_hours_spec_without_force_skips_good_and_force_redoes_selected_only(monkeypatch, store, tmp_path):
    for h in (1, 2, 3):
        _good_hour(store, tmp_path, h)
    calls = _fake_tts(monkeypatch)
    assert _gen(hours="1-3")["skipped_existing"] == [1, 2, 3] and calls == []
    assert _gen(hours="2", force=True)["generated"] == [2] and calls == [2]


def test_bad_hours_spec_is_400(monkeypatch, store):
    _fake_tts(monkeypatch)
    for bad in ("24", "5-2", "a", "-1"):
        with pytest.raises(HTTPException) as e:
            _gen(hours=bad)
        assert e.value.status_code == 400


def test_storage_disabled_is_an_error_unless_local_only_is_explicit(monkeypatch, store, tmp_path):
    monkeypatch.setattr(server.object_storage, "is_enabled", lambda: False)
    _fake_tts(monkeypatch)
    assert _gen(hours="4")["results"][0]["reason"] == "object_storage_disabled"
    ok = _gen(hours="4", allow_local_only=True)
    assert ok["generated"] == [4] and ok["results"][0]["storage_verified"] is False
    assert (tmp_path / ok["results"][0]["url"].rsplit("/", 1)[-1]).stat().st_size > 0


def _rome_hour():
    return datetime.now(ZoneInfo("Europe/Rome")).hour


def _resolve():
    return run(server._resolve_current_hour_time_signal())


def test_resolver_falls_back_to_same_hour_cache_then_skips_and_never_uses_other_hours(monkeypatch, store, tmp_path, caplog):
    h = _rome_hour()
    other = (h + 1) % 24
    _good_hour(store, tmp_path, other)                       # a perfectly good file for ANOTHER hour: must never be used
    perm = server.db.time_signal_permanent
    run(perm.insert_one({"_id": h, "speech_audio_url": "/api/tts/gone.mp3", "validated": True}))   # not local, not in storage
    key = datetime.now(ZoneInfo("Europe/Rome")).strftime("%Y-%m-%d %H")
    assert _resolve() is None                                # permanent unreachable, no cache -> clean skip
    (tmp_path / "cache_ok.mp3").write_bytes(_audio("tone"))
    run(server.db.time_signal_cache.insert_one({"_id": key, "speech_audio_url": "/api/tts/cache_ok.mp3"}))
    server._ts_reach_cache.clear()
    assert _resolve() == "/api/tts/cache_ok.mp3"             # reachable same-hour cache wins over the dead permanent
    (tmp_path / "perm_ok.mp3").write_bytes(_audio("tone"))
    run(perm.update_one({"_id": h}, {"$set": {"speech_audio_url": "/api/tts/perm_ok.mp3"}}))
    server._ts_reach_cache.clear()
    assert _resolve() == "/api/tts/perm_ok.mp3"


def test_resolver_reachability_is_cached_per_hour_and_timeouts_fail_open(monkeypatch, store, tmp_path):
    h = _rome_hour()
    store.objs["tts/remote.mp3"] = _audio("tone")
    run(server.db.time_signal_permanent.insert_one({"_id": h, "speech_audio_url": "/api/tts/remote.mp3", "validated": True}))
    assert _resolve() == "/api/tts/remote.mp3" and store.get_calls == 1
    assert _resolve() == "/api/tts/remote.mp3" and store.get_calls == 1          # second pick within the TTL: no storage hit
    server._ts_reach_cache.clear()

    async def slow(key):
        import asyncio
        await asyncio.sleep(1)
    monkeypatch.setattr(server.object_storage, "get_bytes", slow)
    monkeypatch.setattr(server, "_TS_REACH_TIMEOUT", 0.05)
    run(server.db.time_signal_permanent.update_one({"_id": h}, {"$set": {"speech_audio_url": "/api/tts/slow.mp3"}}))
    assert _resolve() == "/api/tts/slow.mp3"                 # unknown (slow storage) does not silence the signal


def test_pick_skips_time_signal_instead_of_playing_a_frozen_url(monkeypatch, store):
    now = datetime.now(timezone.utc)
    run(server.db.timeline_events.insert_one({"id": "tsx", "kind": "time_signal", "title": "Ora", "audio_url": "/api/tts/other_hour.mp3",
                                              "duration_sec": 12.0, "status": "pending",
                                              "scheduled_at": (now - timedelta(seconds=1)).isoformat()}))
    assert run(server._timeline_pick_due()) is None          # nothing servable for this hour -> skipped, not the frozen file
    assert run(server.db.timeline_events.find_one({"id": "tsx"}))["status"] == "skipped_no_audio"


def test_tts_layer_bypasses_the_switch_only_for_synth_bytes_and_live_chatter_stays_gated(monkeypatch):
    es = server.elevenlabs_service
    monkeypatch.setattr(es, "OPENAI_API_KEY", "k"); monkeypatch.setattr(es, "OPENAI_BASE_URL", "http://x")

    async def switch_off():
        return False
    monkeypatch.setattr(es, "_talk_switch_on", switch_off)

    class Resp:
        status_code, content, text = 200, b"m" * 500, ""

    class Client:
        posts = 0

        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, *a, **k):
            Client.posts += 1
            return Resp()
    monkeypatch.setattr(es.httpx, "AsyncClient", Client)

    async def no_eleven(*a, **k):
        return None
    monkeypatch.setattr(es, "_synth_elevenlabs", no_eleven)
    assert run(es._synth_openai("ciao", "nova")) is None and Client.posts == 0            # live chatter: still gated
    assert run(es.synth_speech("ciao", "nova", kind="dj")) is None and Client.posts == 0  # ...through the public entry point too
    audio, provider = run(es.synth_bytes("ciao", "nova", kind="time_signal"))
    assert audio == b"m" * 500 and provider == "openai-tts-1-hd" and Client.posts == 1     # explicit admin generation: allowed
