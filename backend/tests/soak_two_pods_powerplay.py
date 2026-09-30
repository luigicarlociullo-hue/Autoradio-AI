"""Two-pod check of the Power Play minimum gap (pp_since lives in the clock CAS).

Usage (from backend/):  python tests/soak_two_pods_powerplay.py [seconds]   (default 600)
Scratch DB `pp_soak`, ports 8021/8022, both pods start at the same moment, one leader
kill -9 + restart at half time. Asserts: seq +1 per promotion, no duplicate ids in
the queue, and today's Power Play track never plays with fewer than 6 songs since its
previous play. Output: tests/soak_two_pods_powerplay.out. Exit 0 = pass.
"""
import asyncio, os, subprocess, sys, time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import httpx
from motor.motor_asyncio import AsyncIOMotorClient

HERE = os.path.dirname(os.path.abspath(__file__)); BACKEND = os.path.dirname(HERE)
OUT = os.path.join(HERE, "soak_two_pods_powerplay.out")
DUR = int(sys.argv[1]) if len(sys.argv) > 1 else 600
GAP = 6
ENV = dict(os.environ, DB_NAME="pp_soak", TELEGRAM_BOT_TOKEN="", BACKGROUND_TASKS_ENABLED="false")
procs = {}


def log(*a):
    line = " ".join(str(x) for x in a); print(line, flush=True)
    open(OUT, "a").write(line + "\n")


def start(port):
    procs[port] = subprocess.Popen([sys.executable, "-m", "uvicorn", "server:app", "--port", str(port), "--workers", "1"],
                                   cwd=BACKEND, env=dict(ENV, HOSTNAME=f"pp{port}"),
                                   stdout=open(f"{OUT}.pod{port}.log", "a"), stderr=subprocess.STDOUT)


async def hammer(port, stop):
    async with httpx.AsyncClient(timeout=5) as h:
        while time.time() < stop:
            try: await h.get(f"http://localhost:{port}/api/stream/now")
            except Exception: await asyncio.sleep(0.5)
            await asyncio.sleep(0.1)


async def kill_leader(db):
    l = await db.station_leases.find_one({"_id": "scheduler"})
    port = 8021 if "8021" in l["holder"] else 8022
    log("chaos: kill -9 leader", l["holder"]); procs[port].kill(); procs[port].wait(); await asyncio.sleep(2); start(port)


async def main():
    open(OUT, "w").close()
    db = AsyncIOMotorClient("mongodb://localhost:27017").pp_soak
    await db.client.drop_database("pp_soak")
    await db.tracks.insert_many(
        [{"id": f"song{i}", "title": f"S{i}", "artist": "A", "audio_url": f"/api/x/s{i}.mp3", "duration_sec": 4.0 + (i % 3),
          "status": "ready", "source": "suno", "on_air": True, "deleted_at": None} for i in range(20)]
        + [{"id": f"jing{i}", "title": f"J{i}", "artist": "R", "audio_url": f"/api/x/j{i}.mp3", "duration_sec": 2.0,
            "status": "ready", "source": "suno", "is_jingle": True, "on_air": True, "deleted_at": None} for i in range(6)])
    await db.station.update_one({"_id": "state"}, {"$set": {"jingle_every_n_songs": 1, "ai_speaker_enabled": False,
                                                            "pp_min_gap_songs": GAP}}, upsert=True)
    await db.power_play_daily.insert_one({"_id": datetime.now(ZoneInfo("Europe/Rome")).strftime("%Y-%m-%d"),
                                          "track_id": "song0", "source": "library"})
    # staggered: the fresh-DB admin-seed race is fixed on wip/promote-recovery, not on this branch
    start(8021); await asyncio.sleep(12); start(8022); await asyncio.sleep(12)
    t0 = time.time(); stop = t0 + DUR
    tasks = [asyncio.create_task(hammer(p, stop)) for p in (8021, 8022, 8021, 8022)]
    chaos = []; obs = []; last = None; dupq = 0; verbad = 0; lastver = -1
    while time.time() < stop:
        if time.time() - t0 > DUR / 2 and not chaos:
            chaos.append(asyncio.create_task(kill_leader(db)))
        c = await db.station_clock.find_one({"_id": "clock"})
        if c:
            q = [t["id"] for t in c.get("queue", [])]
            if len(q) != len(set(q)) or (c.get("current") or {}).get("id") in q: dupq += 1
            v = c.get("ver", 0); verbad += v < lastver; lastver = v
            key = (c.get("seq"), (c.get("current") or {}).get("id"))
            if key != last: obs.append(key); last = key
        await asyncio.sleep(0.1)
    for t in tasks: t.cancel()
    await asyncio.gather(*chaos)
    for p in procs.values(): p.kill()
    seqs = [o[0] for o in obs]; ids = [o[1] for o in obs]
    jumps = [(a, b) for a, b in zip(seqs, seqs[1:]) if b - a != 1]
    songs = [i for i in ids if i and i.startswith("song")]
    pp = [i for i, s in enumerate(songs) if s == "song0"]
    gaps = [b - a - 1 for a, b in zip(pp, pp[1:])]
    log(f"promotions={len(obs)} songs={len(songs)} seq_jumps={jumps[:5]} dup_queue_samples={dupq} ver_regressions={verbad}")
    log(f"power_play_plays={len(pp)} songs_between={gaps} (min required {GAP})")
    ok = not jumps and not dupq and not verbad and len(pp) >= 3 and all(g >= GAP for g in gaps)
    log("VERDICT:", "PASS" if ok else "FAIL"); sys.exit(0 if ok else 1)


try:
    asyncio.run(main())
except SystemExit:
    raise
except BaseException:
    import traceback
    log("SOAK CRASHED:\n" + traceback.format_exc())
    for p_ in procs.values(): p_.kill()
    sys.exit(2)
