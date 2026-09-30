"""Power Play minimum gap (same simulation style as test_cadence_invariant.py).

The daily Power Play track must never play twice with fewer than `gap` other
songs in between, where gap = max(_POWER_PLAY_ROTATION, station.state.pp_min_gap_songs
or 6). 3 simulated hours per case, no real time.
Run:  python -m pytest -n 0 tests/test_power_play_gap.py   (from backend/)
"""
import pytest

import test_cadence_invariant as cad   # reuses its event loop + `server` import (motor binds to one loop)

server = cad.server
_loop = cad._loop
PP_ID = "song0"
SIM_HOURS = 3


async def _simulate(dj, jingle, speaker, min_gap, ready_after=None, probe=None):
    db = server.db
    await db.client.drop_database("cadence_sim")
    await db.tracks.insert_many(
        [{"id": f"song{i}", "title": f"S{i}", "artist": "A", "audio_url": f"/x/s{i}.mp3", "duration_sec": 170.0 + i,
          "status": "ready", "source": "suno", "on_air": True, "deleted_at": None} for i in range(40)]
        + [{"id": f"jing{i}", "title": f"J{i}", "artist": "R", "audio_url": f"/x/j{i}.mp3", "duration_sec": 20.0,
            "status": "ready", "source": "suno", "is_jingle": True, "on_air": True, "deleted_at": None} for i in range(12)])
    state = {"jingle_every_n_songs": jingle, "dj_talk_every_n_songs": dj, "ai_speaker_enabled": speaker, "fx_every_n_songs": 0}
    if min_gap is not None:
        state["pp_min_gap_songs"] = min_gap
    await db.station.update_one({"_id": "state"}, {"$set": state}, upsert=True)
    await db.power_play_daily.insert_one({"_id": server._rome_today_key(), "track_id": PP_ID, "source": "library"})
    if ready_after is not None:   # Suno still generating: the PP track exists but is not ready yet
        await db.tracks.update_one({"id": PP_ID}, {"$set": {"status": "pending"}})
    await db.station_clock.insert_one({"_id": "clock", "current": None, "queue": [], "seq": 0,
                                       "music_counter": 0, "jingle_counter": 0, "fx_counter": 0})

    async def no_voice():
        return None

    real = server._clock_pick_dj_voice_segment
    server._clock_pick_dj_voice_segment = no_voice
    try:
        elapsed, played, step = 0.0, [], 0
        while elapsed < SIM_HOURS * 3600:
            await server._clock_refill_queue()
            c = await db.station_clock.find_one({"_id": "clock"})
            q = c["queue"]
            assert q, "queue empty after refill"
            head = q[0]
            await db.station_clock.update_one({"_id": "clock"}, {"$set": {"current": head, "queue": q[1:]}, "$inc": {"ver": 1}})
            if head["id"].startswith("song"):
                step += 1
                await db.tracks.update_one({"id": head["id"]}, {"$set": {"last_played_at": f"2026-01-01T{step // 3600:02d}:{(step // 60) % 60:02d}:{step % 60:02d}"}})
            elapsed += head["duration_sec"]
            played.append(head["id"])
            if ready_after is not None and len(played) == ready_after:
                clk = await db.station_clock.find_one({"_id": "clock"}, {"pp_since": 1})
                if probe is not None:
                    probe["pp_since_at_ready"] = clk.get("pp_since")
                    probe["ready_at_index"] = len(played)
                await db.tracks.update_one({"id": PP_ID}, {"$set": {"status": "ready"}})
        return played
    finally:
        server._clock_pick_dj_voice_segment = real


def _effective_gap(min_gap):
    return max(server._POWER_PLAY_ROTATION, 6 if min_gap is None else min_gap)


CASES = [
    pytest.param(1, 1, True, None, id="default-gap6 (production cadence dj1/j1)"),
    pytest.param(3, 2, True, None, id="default-gap6 dj3/j2"),
    pytest.param(1, 1, False, None, id="default-gap6 speaker-off"),
    pytest.param(1, 1, True, 10, id="configured-gap10"),
    pytest.param(1, 1, True, 1, id="configured-gap1 (floored to rotation)"),
]


@pytest.mark.parametrize("dj,jingle,speaker,min_gap", CASES)
def test_power_play_min_gap(dj, jingle, speaker, min_gap):
    played = _loop.run_until_complete(_simulate(dj, jingle, speaker, min_gap))
    gap = _effective_gap(min_gap)
    songs = [p for p in played if p.startswith("song")]
    pp_idx = [i for i, s in enumerate(songs) if s == PP_ID]
    assert len(pp_idx) >= 2, "Power Play never rotated in 3 simulated hours"
    for a, b in zip(pp_idx, pp_idx[1:]):
        between = b - a - 1
        assert between >= gap, f"Power Play repeated after only {between} songs (min {gap}): {songs[max(0, a - 1):b + 1]}"
    # not dead: roughly one PP per (gap + 1) songs
    assert len(pp_idx) >= len(songs) // (gap + 1) // 2


def test_not_ready_power_play_neither_resets_nor_stalls():
    """PP track not ready (Suno generating): never served, pp_since keeps counting
    (no reset), it is served as soon as it becomes ready, and the gap holds after."""
    probe = {}
    played = _loop.run_until_complete(_simulate(1, 1, True, None, ready_after=40, probe=probe))
    gap = _effective_gap(None)
    assert PP_ID not in played[:40], "served while not ready"
    assert probe["pp_since_at_ready"] >= gap, f"counter was reset/stalled while not ready: {probe}"
    first = played.index(PP_ID)
    songs_before_first = sum(1 for p in played[40:first] if p.startswith("song"))
    assert songs_before_first <= 6, f"PP delayed {songs_before_first} songs after becoming ready (queued items only)"
    songs = [p for p in played if p.startswith("song")]
    pp_idx = [i for i, s in enumerate(songs) if s == PP_ID]
    assert len(pp_idx) >= 2
    for a, b in zip(pp_idx, pp_idx[1:]):
        assert b - a - 1 >= gap


def test_new_field_absent_on_old_clock_document():
    """The clock document of a running station has no pp_since yet: it must default to 0 safely."""
    async def run():
        db = server.db
        await db.client.drop_database("cadence_sim")
        await db.tracks.insert_many([{"id": f"song{i}", "title": "S", "artist": "A", "audio_url": "/x.mp3", "duration_sec": 200.0,
                                      "status": "ready", "source": "suno", "on_air": True, "deleted_at": None} for i in range(20)])
        await db.power_play_daily.insert_one({"_id": server._rome_today_key(), "track_id": PP_ID})
        await db.station_clock.insert_one({"_id": "clock", "current": None, "queue": [], "seq": 3, "ver": 7,
                                           "music_counter": 5, "jingle_counter": 1, "fx_counter": 0})   # no pp_since
        await server._clock_refill_queue()
        return await db.station_clock.find_one({"_id": "clock"})
    c = _loop.run_until_complete(run())
    assert 1 <= c["pp_since"] <= len(c["queue"])                                    # counted from 0, written back
    assert len(c["queue"]) == server._CLOCK_QUEUE_LOOKAHEAD
    assert PP_ID not in [t["id"] for t in c["queue"][:6]]                         # first PP only after the gap


def test_missing_duration_default_is_logged(caplog):
    async def run():
        db = server.db
        await db.client.drop_database("cadence_sim")
        await db.tracks.insert_one({"id": PP_ID, "title": "PP", "artist": "A", "audio_url": "/x.mp3", "duration_sec": 0,
                                    "status": "ready", "source": "suno", "on_air": True, "deleted_at": None})
        return await server._power_play_resolve_track({"track_id": PP_ID})
    import logging
    with caplog.at_level(logging.WARNING):
        tr = _loop.run_until_complete(run())
    assert tr["duration_sec"] == 180.0 and tr["is_power_play"]
    assert any("power_play track" in r.message and "default 180" in r.message for r in caplog.records)
