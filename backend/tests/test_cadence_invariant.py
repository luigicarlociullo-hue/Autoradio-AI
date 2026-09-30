"""Cadence invariant for the clock queue builder (_clock_refill_queue).

Invariant: between two consecutive songs there is AT MOST ONE jingle, and the
queue never goes more than two non-song items in a row. A jingle that fills a
DJ slot (no voice ready) must reset the jingle cadence too.

Runs 3 simulated hours per case against scratch DB `cadence_sim`, no real time:
each step refills the queue, then promotes the head like _clock_promote would.
Run:  python -m pytest -n 0 tests/test_cadence_invariant.py   (from backend/)
"""
import asyncio
import os

import pytest

os.environ["DB_NAME"] = "cadence_sim"
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
_loop = asyncio.new_event_loop()      # motor binds to the loop that exists at import time
asyncio.set_event_loop(_loop)

import server  # noqa: E402

SIM_HOURS = 3


def _kind(e):
    i = e["id"]
    return "S" if i.startswith("song") else "J" if i.startswith("jing") else "V"


async def _simulate(dj, jingle, speaker, voice):
    db = server.db
    await db.client.drop_database("cadence_sim")
    await db.tracks.insert_many(
        [{"id": f"song{i}", "title": f"S{i}", "artist": "A", "audio_url": f"/x/s{i}.mp3", "duration_sec": 200.0 + i,
          "status": "ready", "source": "suno", "on_air": True, "deleted_at": None} for i in range(40)]
        + [{"id": f"jing{i}", "title": f"J{i}", "artist": "R", "audio_url": f"/x/j{i}.mp3", "duration_sec": 20.0,
            "status": "ready", "source": "suno", "is_jingle": True, "on_air": True, "deleted_at": None} for i in range(12)])
    await db.station.update_one({"_id": "state"}, {"$set": {
        "jingle_every_n_songs": jingle, "dj_talk_every_n_songs": dj, "ai_speaker_enabled": speaker, "fx_every_n_songs": 0}}, upsert=True)
    await db.station_clock.insert_one({"_id": "clock", "current": None, "queue": [], "seq": 0,
                                       "music_counter": 0, "jingle_counter": 0, "fx_counter": 0})
    n_voice = [0]

    async def fake_voice():
        if not voice:
            return None
        n_voice[0] += 1
        return {"id": f"voice{n_voice[0]}", "title": "V", "artist": "DJ", "audio_url": "/x/v.mp3", "duration_sec": 20.0}

    async def no_pp():
        return None

    real = (server._clock_pick_dj_voice_segment, server._power_play_maybe_pick)
    server._clock_pick_dj_voice_segment, server._power_play_maybe_pick = fake_voice, no_pp
    try:
        elapsed, played, step = 0.0, [], 0
        while elapsed < SIM_HOURS * 3600:
            await server._clock_refill_queue()
            c = await db.station_clock.find_one({"_id": "clock"})
            q = c["queue"]
            assert q, "queue empty after refill"
            head = q[0]
            await db.station_clock.update_one({"_id": "clock"}, {"$set": {"current": head, "queue": q[1:]}, "$inc": {"ver": 1}})
            if _kind(head) == "S":
                step += 1
                await db.tracks.update_one({"id": head["id"]}, {"$set": {"last_played_at": f"2026-01-01T00:{step // 60:02d}:{step % 60:02d}"}})
            elapsed += head["duration_sec"]
            played.append(_kind(head))
        return "".join(played)
    finally:
        server._clock_pick_dj_voice_segment, server._power_play_maybe_pick = real


def _check_invariant(seq):
    between = seq.strip("VJ").split("S")          # items between consecutive songs
    worst = max(x.count("J") for x in between)
    assert worst <= 1, f"{worst} jingles between two songs: {seq[:60]}"
    assert "JJ" not in seq, f"adjacent jingles: {seq[:60]}"
    assert max(len(x) for x in between) <= 2, f"more than 2 non-song items in a row: {seq[:60]}"
    assert seq.count("S") >= len(seq) // 3


def _is_repeat_of(seq, unit):
    """seq is `unit` repeated (allowing a truncated last repetition)."""
    return seq.startswith(unit * (len(seq) // len(unit)))


# (dj, jingle, speaker, voice ready, expected repeating unit or None)
CASES = [
    pytest.param(1, 1, True, False, "SJ", id="dj1-j1-no-voice (production state)"),
    pytest.param(1, 1, True, True, "SVJ", id="dj1-j1-voice-ready"),
    pytest.param(2, 1, True, False, "SJ", id="dj2-j1-no-voice"),
    pytest.param(2, 1, True, True, None, id="dj2-j1-voice-ready"),
    pytest.param(1, 2, True, False, "SJ", id="dj1-j2-no-voice"),
    pytest.param(1, 2, True, True, None, id="dj1-j2-voice-ready"),
    pytest.param(3, 2, True, False, "SSJSJ", id="dj3-j2-no-voice"),
    pytest.param(3, 2, True, True, None, id="dj3-j2-voice-ready"),
    pytest.param(1, 1, False, False, "SJ", id="speaker-off-j1"),
    pytest.param(3, 2, False, False, "SSJ", id="speaker-off-j2"),
]


@pytest.mark.parametrize("dj,jingle,speaker,voice,unit", CASES)
def test_at_most_one_jingle_between_songs(dj, jingle, speaker, voice, unit):
    seq = _loop.run_until_complete(_simulate(dj, jingle, speaker, voice))
    _check_invariant(seq)
    if unit:
        assert _is_repeat_of(seq, unit), f"expected repeating {unit!r}, got {seq[:40]}"
