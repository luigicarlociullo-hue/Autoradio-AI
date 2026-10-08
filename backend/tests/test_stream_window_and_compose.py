"""Stream timing + composed time signal (pure functions, no network/DB writes).

Run: cd backend && /root/.venv/bin/python -m pytest tests/test_stream_window_and_compose.py -q
"""
import asyncio
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_database")
import server as S  # noqa: E402

NOW = datetime(2026, 10, 8, 12, 0, 0, tzinfo=timezone.utc)


def _entry(seq, started_ago, dur, kind=None):
    return {"id": f"e{seq}", "seq": seq, "audio_url": f"/api/x/{seq}.mp3", "title": f"t{seq}",
            "duration_sec": dur, "real_duration_sec": dur, "kind": kind,
            "started_at": (NOW - timedelta(seconds=started_ago)).isoformat()}


def _clock(cur_ago, cur_dur, hist, queue_n=4):
    seq = 100
    cur = _entry(seq, cur_ago, cur_dur)
    return {"seq": seq, "current": cur, "history": hist,
            "queue": [_entry(seq + 1 + i, -10 * i, 30) for i in range(queue_n)]}


def test_history_keeps_items_until_nobody_can_still_be_playing_them():
    # 3 short items finished 5/8/11s ago + one that finished 200s ago
    hist = [_entry(96, 215, 15), _entry(97, 40, 10), _entry(98, 25, 8), _entry(99, 18, 5)]
    c = _clock(cur_ago=3, cur_dur=60, hist=hist)
    w = S._clock_window_history(c, 100, NOW)
    ids = [h["seq"] for h in w]
    assert ids[-1] == 99 and 98 in ids and 97 in ids           # ended <65s ago -> kept
    assert 96 not in ids                                        # ended long ago -> dropped
    assert ids == sorted(ids)


def test_window_always_has_min_segments():
    c = _clock(cur_ago=500, cur_dur=600, hist=[_entry(99, 2000, 100), _entry(98, 2200, 100)], queue_n=0)
    w = S._clock_window_history(c, 100, NOW)
    assert len(w) + 1 + 0 >= S._HLS_MIN_SEGMENTS


def test_history_stops_at_seq_gap():
    c = _clock(cur_ago=3, cur_dur=60, hist=[_entry(90, 20, 10), _entry(99, 10, 5)])
    assert [h["seq"] for h in S._clock_window_history(c, 100, NOW)] == [99]


def test_delayed_view_is_current_when_far_enough_into_it():
    c = _clock(cur_ago=50, cur_dur=200, hist=[_entry(99, 60, 10)])
    cur, off, nxt = S._clock_delayed_view(c, NOW)
    assert cur["seq"] == 100 and abs(off - (50 - S._HLS_LIVE_DELAY_SEC)) < 1e-6
    assert nxt[0]["seq"] == 101


def test_delayed_view_walks_back_into_previous_items():
    # current started 5s ago; listener is 20s behind -> 15s before current started, inside item 99 (dur 30)
    c = _clock(cur_ago=5, cur_dur=200, hist=[_entry(99, 35, 30)])
    cur, off, nxt = S._clock_delayed_view(c, NOW)
    assert cur["seq"] == 99 and abs(off - (30 - 15)) < 1e-6
    assert nxt[0]["seq"] == 100        # next after the delayed item is the live-edge current


def _ff(args):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=True)


def _mk(path, freq, secs, sr, ch=1):
    _ff(["-f", "lavfi", "-i", f"sine=f={freq}:d={secs}:r={sr}", "-ac", str(ch), "-c:a", "libmp3lame", "-b:a", "128k", str(path)])


def test_compose_copy_path_no_reencode(tmp_path):
    h, m = tmp_path / "h.mp3", tmp_path / "m.mp3"
    _mk(h, 440, 2.0, 44100); _mk(m, 660, 1.5, 44100)
    r = asyncio.run(S._ts_compose_bytes(h.read_bytes(), m.read_bytes()))
    assert r and not r["reencoded"] and r["sample_rate"] == 44100
    # one file: lead-in (1.0s, source has no leading silence) + 2.0 + 1.5, within MP3 frame granularity
    assert abs(r["duration_sec"] - (S._TS_LEAD_SEC + 3.5)) < 0.15, r


def test_compose_low_sample_rate_is_raised_to_44k(tmp_path):
    h, m = tmp_path / "h.mp3", tmp_path / "m.mp3"
    _mk(h, 440, 2.0, 22050); _mk(m, 660, 1.5, 22050)
    r = asyncio.run(S._ts_compose_bytes(h.read_bytes(), m.read_bytes()))
    assert r and r["reencoded"] and r["sample_rate"] == 44100
    assert abs(r["duration_sec"] - (S._TS_LEAD_SEC + 3.5)) < 0.15, r


def test_compose_does_not_double_existing_lead_silence(tmp_path):
    h, m, pad = tmp_path / "h.mp3", tmp_path / "m.mp3", tmp_path / "hp.mp3"
    _mk(h, 440, 2.0, 44100); _mk(m, 660, 1.5, 44100)
    _ff(["-f", "lavfi", "-t", "2.5", "-i", "anullsrc=r=44100:cl=mono", "-i", str(h), "-filter_complex",
         "[0:a][1:a]concat=n=2:v=0:a=1", "-c:a", "libmp3lame", "-b:a", "128k", str(pad)])
    r = asyncio.run(S._ts_compose_bytes(pad.read_bytes(), m.read_bytes()))
    assert r and r["lead_added_sec"] == 0.0
    assert abs(r["duration_sec"] - (2.5 + 2.0 + 1.5)) < 0.2, r


def test_compose_hour_only(tmp_path):
    h = tmp_path / "h.mp3"; _mk(h, 440, 2.0, 44100)
    r = asyncio.run(S._ts_compose_bytes(h.read_bytes(), None))
    assert r and abs(r["duration_sec"] - (S._TS_LEAD_SEC + 2.0)) < 0.15


class _Req:
    headers = {"x-forwarded-proto": "https", "host": "t"}


def _playlist(clock, monkeypatch):
    async def fake_adv(force=False):
        return clock

    class _Coll:
        async def find_one(self, *a, **k):
            return {}

    class _DB:
        station = _Coll()
    monkeypatch.setattr(S, "_clock_advance", fake_adv)
    monkeypatch.setattr(S, "db", _DB())
    return asyncio.run(S.hls_live_playlist(_Req())).body.decode()


def _parse(pl):
    lines = pl.splitlines()
    start = float(next(l for l in lines if l.startswith("#EXT-X-START")).split("TIME-OFFSET=")[1].split(",")[0])
    durs = [float(l.split(":")[1].split(",")[0]) for l in lines if l.startswith("#EXTINF")]
    mseq = int(next(l for l in lines if l.startswith("#EXT-X-MEDIA-SEQUENCE")).split(":")[1])
    return start, durs, mseq


def test_playlist_starts_behind_edge_and_keeps_finished_items(monkeypatch):
    # jingle (5s) + time signal (8s) just finished, a new track started 4s ago
    hist = [_entry(98, 17, 8, "time_signal"), _entry(99, 9, 5)]
    now = datetime.now(timezone.utc)
    c = _clock(cur_ago=4, cur_dur=200, hist=hist)
    for e in c["history"] + [c["current"]] + c["queue"]:     # re-anchor to real now
        e["started_at"] = (now + (datetime.fromisoformat(e["started_at"]) - NOW)).isoformat()
    start, durs, mseq = _parse(_playlist(c, monkeypatch))
    assert mseq == 98 and len(durs) >= S._HLS_MIN_SEGMENTS
    live_pos = 8 + 5 + 4
    assert abs(start - max(0, live_pos - S._HLS_LIVE_DELAY_SEC)) < 0.6     # behind the edge...
    assert start < live_pos                                                 # ...never at it
    assert start + 1e-6 < sum(durs[:2]) + 4                                 # still inside already-known audio
    assert durs[0] == 8.0 and durs[1] == 5.0                                # real durations, not padded


def test_playlist_cold_start_still_has_buffer(monkeypatch):
    now = datetime.now(timezone.utc)
    c = _clock(cur_ago=0, cur_dur=200, hist=[])
    for e in [c["current"]] + c["queue"]:
        e["started_at"] = (now + (datetime.fromisoformat(e["started_at"]) - NOW)).isoformat()
    start, durs, mseq = _parse(_playlist(c, monkeypatch))
    assert start == 0.0 and len(durs) >= S._HLS_MIN_SEGMENTS


def test_resolver_returns_one_composed_clip_and_no_minute_followup(monkeypatch):
    async def parts():
        import zoneinfo
        n = datetime.now(zoneinfo.ZoneInfo("Europe/Rome"))
        return {f"h{n.hour:02d}": {"speech_audio_url": "/api/tts/h.mp3", "duration_sec": 2.0},
                f"m{n.minute:02d}": {"speech_audio_url": "/api/tts/m.mp3", "duration_sec": 1.5}}

    async def comp(hd, md, key):
        return {"url": "/api/tts/tscomp.mp3", "duration_sec": 4.5}

    async def src():
        return "upload"
    monkeypatch.setattr(S, "_ts_parts_ready", parts)
    monkeypatch.setattr(S, "_ts_compose_cached", comp)
    monkeypatch.setattr(S, "_ts_source", src)
    r = asyncio.run(S._resolve_time_signal_with_minutes())
    if r and r["minute"] is None and r.get("composed") is not None:
        assert r["hour_url"] == "/api/tts/tscomp.mp3" and r["hour_dur"] == 4.5
    else:
        assert r["hour_url"] == "/api/tts/tscomp.mp3"   # minute 00 branch uses ho-part or composed
