"""A pod that stalls past the 6 s claim expiry must NOT overwrite the pod that legitimately took over.

Pod A claims, consumes a due Timeline event and stalls (claim TTL shrunk to 0.3 s, stall 0.7 s). Pod B sees the expired
claim and promotes (seq 6, queue head). When A wakes, its final CAS fails; the rebase retry must notice the claim/seq
changed, abort, and hand the consumed Timeline event back (pending) instead of overwriting B with a second seq 6.
Run:  python -m pytest -n 0 tests/test_promote_stall.py   (from backend/)
"""
import asyncio
from datetime import datetime, timedelta, timezone

import test_cadence_invariant as cad   # shares its event loop + `server` import

server = cad.server
_loop = cad._loop


async def _seed(now):
    db = server.db
    await db.client.drop_database("cadence_sim")
    await db.tracks.insert_many([{"id": f"song{k}", "title": "S", "artist": "A", "audio_url": "/x.mp3", "duration_sec": 200.0,
                                  "status": "ready", "source": "suno", "on_air": True, "deleted_at": None} for k in range(10)])
    await db.timeline_events.insert_one({"id": "tl1", "kind": "insert", "title": "TL", "artist": "TL", "audio_url": "/api/x/tl.mp3",
                                         "duration_sec": 20.0, "status": "pending", "recurrence": "hourly",
                                         "scheduled_at": (now - timedelta(seconds=1)).isoformat()})
    q = [{"id": f"song{k}", "title": "S", "artist": "A", "audio_url": "/x.mp3", "duration_sec": 200.0} for k in (1, 2, 3)]
    await db.station_clock.insert_one({"_id": "clock", "seq": 5, "ver": 3, "queue": q, "music_counter": 0,
                                       "current": {"id": "song0", "title": "S", "audio_url": "/x.mp3", "duration_sec": 10.0,
                                                   "started_at": (now - timedelta(seconds=30)).isoformat()}})


def test_stalled_pod_aborts_instead_of_overwriting_the_new_owner(monkeypatch):
    monkeypatch.setattr(server, "_CLOCK_CLAIM_TTL_SEC", 0.3)
    real_pick = server._timeline_pick_due
    stalled = {"n": 0}

    async def stalling_pick():
        r = await real_pick()
        if r and not stalled["n"]:
            stalled["n"] += 1
            await asyncio.sleep(0.7)          # pod A: consumed tl1, then stalls past the claim expiry
        return r

    async def run():
        now = datetime.now(timezone.utc)
        await _seed(now)
        monkeypatch.setattr(server, "_timeline_pick_due", stalling_pick)

        async def pod_b():
            await asyncio.sleep(0.45)         # after A's claim expired, before A wakes
            return await server._clock_promote()
        await asyncio.gather(server._clock_promote(), pod_b())
        await asyncio.sleep(0.2)              # let the fire-and-forget play-log inserts land
        c = await server.db.station_clock.find_one({"_id": "clock"})
        ev = await server.db.timeline_events.find_one({"id": "tl1"})
        pending_clones = await server.db.timeline_events.count_documents({"parent_id": "tl1", "status": "pending"})
        logs = await server.db.station_play_log.find({"seq": 6}).to_list(10)
        return c, ev, pending_clones, logs

    c, ev, clones, logs = _loop.run_until_complete(run())
    assert c["seq"] == 6 and c["current"]["id"] == "song1"          # B's promotion stands; A did not overwrite it
    assert len(logs) == 1                                           # one promotion logged for seq 6, not two
    assert ev["status"] == "pending" and "consumed_at" not in ev     # A's consumed event is handed back, not lost
    assert clones == 0                                              # and the recurrence clone A made is removed (re-created on next pick)
    assert c.get("claim_by") is None and c.get("claim_until") is None
