"""Two pods + a Timeline event every 30s: each event must air EXACTLY once.

Usage:  python tests/soak_two_pods_timeline.py <backend_dir> [seconds=480] [port_base=8031] [db=tl_soak]
(run it from any cwd; pods are started from <backend_dir>). Pods start staggered.
Exit 0 = every event aired once, seq +1, no duplicate queue ids.
"""
import asyncio, os, subprocess, sys, time
from datetime import datetime, timezone, timedelta
import httpx
from motor.motor_asyncio import AsyncIOMotorClient

BACKEND = os.path.abspath(sys.argv[1]); DUR = int(sys.argv[2]) if len(sys.argv) > 2 else 480
PB = int(sys.argv[3]) if len(sys.argv) > 3 else 8031; DB = sys.argv[4] if len(sys.argv) > 4 else "tl_soak"
PORTS = (PB, PB + 1)
ENV = dict(os.environ, DB_NAME=DB, TELEGRAM_BOT_TOKEN="", BACKGROUND_TASKS_ENABLED="false")
procs = {}


def start(port):
    procs[port] = subprocess.Popen([sys.executable, "-m", "uvicorn", "server:app", "--port", str(port), "--workers", "1"],
                                   cwd=BACKEND, env=dict(ENV, HOSTNAME=f"tl{port}"), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


async def hammer(port, stop):
    async with httpx.AsyncClient(timeout=5) as h:
        while time.time() < stop:
            try: await h.get(f"http://localhost:{port}/api/stream/now")
            except Exception: await asyncio.sleep(0.5)
            await asyncio.sleep(0.05)


async def main():
    db = AsyncIOMotorClient("mongodb://localhost:27017")[DB]
    await db.client.drop_database(DB)
    await db.tracks.insert_many(
        [{"id": f"song{i}", "title": f"S{i}", "artist": "A", "audio_url": f"/api/x/s{i}.mp3", "duration_sec": 4.0 + (i % 3),
          "status": "ready", "source": "suno", "on_air": True, "deleted_at": None} for i in range(20)])
    await db.station.update_one({"_id": "state"}, {"$set": {"jingle_every_n_songs": 99, "ai_speaker_enabled": False}}, upsert=True)
    start(PORTS[0]); await asyncio.sleep(12); start(PORTS[1]); await asyncio.sleep(12)
    t0 = time.time(); stop = t0 + DUR
    tasks = [asyncio.create_task(hammer(p, stop)) for p in PORTS * 2]
    obs, last, dupq, n_ev, next_ev = [], None, 0, 0, t0 + 20
    while time.time() < stop:
        if time.time() >= next_ev and time.time() < stop - 20:
            n_ev += 1; next_ev += 30
            await db.timeline_events.insert_one({"id": f"tl{n_ev}", "kind": "insert", "title": f"TL{n_ev}", "artist": "TL",
                "audio_url": "/api/x/tl.mp3", "duration_sec": 4.0, "status": "pending",
                "scheduled_at": (datetime.now(timezone.utc) + timedelta(seconds=8)).isoformat()})
        c = await db.station_clock.find_one({"_id": "clock"})
        if c:
            q = [t["id"] for t in c.get("queue", [])]
            if len(q) != len(set(q)) or (c.get("current") or {}).get("id") in q: dupq += 1
            key = (c.get("seq"), (c.get("current") or {}).get("id"))
            if key != last: obs.append(key); last = key
        await asyncio.sleep(0.05)
    for t in tasks: t.cancel()
    for p in procs.values(): p.kill()
    ids = [o[1] for o in obs]; seqs = [o[0] for o in obs]
    jumps = [(a, b) for a, b in zip(seqs, seqs[1:]) if b - a != 1]
    counts = {f"tl{i}": ids.count(f"tl{i}") for i in range(1, n_ev + 1)}
    bad = {k: v for k, v in counts.items() if v != 1}
    print(f"backend={BACKEND} promotions={len(obs)} events_injected={n_ev} seq_jumps={jumps[:3]} dup_queue_samples={dupq}")
    print(f"timeline events not aired exactly once: {bad or 'none'}")
    ok = not bad and not jumps and not dupq and n_ev >= 5
    print("VERDICT:", "PASS" if ok else "FAIL"); sys.exit(0 if ok else 1)

asyncio.run(main())
