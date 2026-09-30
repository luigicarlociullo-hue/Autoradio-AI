"""Two pods promoting at the same instant must produce exactly ONE promotion.

Simulated in one process by running two `_clock_promote()` concurrently on the same
Mongo clock document (the asyncio lock only exists inside `_clock_advance`, so calling
`_clock_promote` directly behaves like two pods). A Timeline event that is due and gets
consumed must end up as the current item (or in the queue) - never silently lost.
Run:  python -m pytest -n 0 tests/test_promote_claim.py   (from backend/)
"""
import asyncio
import random
from datetime import datetime, timedelta, timezone

import test_cadence_invariant as cad   # shares its event loop + `server` import

server = cad.server
_loop = cad._loop
TRIALS = 20


async def _trial(i):
    db = server.db
    await db.client.drop_database("cadence_sim")
    now = datetime.now(timezone.utc)
    await db.tracks.insert_many([{"id": f"song{k}", "title": "S", "artist": "A", "audio_url": "/x.mp3", "duration_sec": 200.0,
                                  "status": "ready", "source": "suno", "on_air": True, "deleted_at": None} for k in range(10)])
    await db.timeline_events.insert_one({"id": "tl1", "kind": "insert", "title": "TL", "artist": "TL", "audio_url": "/api/x/tl.mp3",
                                         "duration_sec": 20.0, "status": "pending",
                                         "scheduled_at": (now - timedelta(seconds=1)).isoformat()})
    q = [{"id": f"song{k}", "title": "S", "artist": "A", "audio_url": "/x.mp3", "duration_sec": 200.0} for k in (1, 2, 3)]
    await db.station_clock.insert_one({"_id": "clock", "seq": 5, "ver": 3, "queue": q, "music_counter": 0,
                                       "current": {"id": "song0", "title": "S", "audio_url": "/x.mp3", "duration_sec": 10.0,
                                                   "started_at": (now - timedelta(seconds=30)).isoformat()}})
    # Widen the window between "claim" and "final write" (Timeline pick with a slow probe/rrule)
    # so the second pod deterministically arrives inside it.
    real_pick = server._timeline_pick_due

    async def slow_pick():
        r = await real_pick()
        await asyncio.sleep(0.05)
        return r

    async def late_pod():
        await asyncio.sleep(0.01 + random.uniform(0.0, 0.01))   # arrives after the first pod's claim
        return await server._clock_promote()
    server._timeline_pick_due = slow_pick
    try:
        await asyncio.gather(server._clock_promote(), late_pod())
    finally:
        server._timeline_pick_due = real_pick
    c = await db.station_clock.find_one({"_id": "clock"})
    ev = await db.timeline_events.find_one({"id": "tl1"})
    return c, ev


def test_concurrent_promotes_are_exclusive_and_lose_no_timeline_event():
    lost, double, seq_bad = 0, 0, 0
    for i in range(TRIALS):
        c, ev = _loop.run_until_complete(_trial(i))
        ids = [(c["current"] or {}).get("id")] + [t["id"] for t in c["queue"]]
        if ev["status"] == "consumed" and "tl1" not in ids:
            lost += 1                                   # consumed, then overwritten by the other pod
        if c["seq"] != 6:
            seq_bad += 1                                # exactly one promotion => seq 5 -> 6
        if len(set(ids)) != len(ids):
            double += 1                                 # same item promoted twice / duplicated
    assert (lost, seq_bad, double) == (0, 0, 0), f"lost timeline events={lost}, seq!=6={seq_bad}, duplicated={double} of {TRIALS}"


def _seed_expired_clock(extra=None):
    async def run():
        db = server.db
        await db.client.drop_database("cadence_sim")
        now = datetime.now(timezone.utc)
        await db.tracks.insert_many([{"id": f"song{k}", "title": "S", "artist": "A", "audio_url": "/x.mp3", "duration_sec": 200.0,
                                      "status": "ready", "source": "suno", "on_air": True, "deleted_at": None} for k in range(6)])
        doc = {"_id": "clock", "seq": 5, "ver": 3, "queue": [{"id": "song1", "title": "S", "audio_url": "/x.mp3", "duration_sec": 200.0}],
               "music_counter": 0, "current": {"id": "song0", "title": "S", "audio_url": "/x.mp3", "duration_sec": 10.0,
                                               "started_at": (now - timedelta(seconds=30)).isoformat()}}
        doc.update(extra or {})
        await db.station_clock.insert_one(doc)
        await server._clock_promote()
        return await db.station_clock.find_one({"_id": "clock"})
    return _loop.run_until_complete(run())


def test_live_foreign_claim_blocks_promotion_and_expired_claim_does_not():
    live = (datetime.now(timezone.utc) + timedelta(seconds=5)).isoformat()
    dead = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    c = _seed_expired_clock({"claim_by": "otherpod:abc", "claim_until": live})
    assert c["seq"] == 5 and c["current"]["id"] == "song0"                       # another pod is promoting: untouched
    c = _seed_expired_clock({"claim_by": "deadpod:abc", "claim_until": dead})
    assert c["seq"] == 6 and c["current"]["id"] == "song1"                       # crashed pod's claim expired: we promote
    assert c["claim_by"] is None and c["claim_until"] is None                    # final write released the claim


def test_claim_released_when_nothing_to_promote():
    async def run():
        db = server.db
        await db.client.drop_database("cadence_sim")           # no tracks, empty queue -> no promotion possible
        now = datetime.now(timezone.utc)
        await db.station_clock.insert_one({"_id": "clock", "seq": 5, "ver": 3, "queue": [], "music_counter": 0,
                                           "current": {"id": "x", "duration_sec": 10.0, "started_at": (now - timedelta(seconds=30)).isoformat()}})
        await server._clock_promote()
        return await db.station_clock.find_one({"_id": "clock"})
    c = _loop.run_until_complete(run())
    assert c["seq"] == 5 and c.get("claim_by") is None and c.get("claim_until") is None
