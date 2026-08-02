"""10 pop songs in English, upbeat, ORGANIC (no synth, no arpeggios).
Live-band feel: guitars, drums, bass, piano, brass. Real vocals, real lyrics.
"""
import asyncio, httpx, os
from datetime import datetime

API = "http://localhost:8001"

PROMPTS = [
    ("upbeat guitar pop 118 bpm bright strummed acoustic guitar tight drums live band vocals hook english no synth no arpeggio",
     "guitar pop 118 bpm", "Sunlit Room"),
    ("motown revival pop 116 bpm brass horn stabs live drums walking bass female lead vocal english no synth",
     "motown pop 116 bpm", "Hometown Radio"),
    ("indie pop rock 122 bpm electric guitar riff big chorus male vocal drums bass english no synth no arpeggio",
     "indie pop-rock 122 bpm", "Paperback Heart"),
    ("piano-driven pop 108 bpm rhodes and grand piano warm bass tight snare uplifting female vocal english no synth",
     "piano pop 108 bpm", "Coffee & Chorus"),
    ("summer pop 120 bpm clean electric guitar handclaps live drums whistle hook english no synth no arpeggio",
     "summer pop 120 bpm", "Boardwalk Weekend"),
    ("funk pop 112 bpm slap bass rhythm guitar horns tight groove male lead english no synth",
     "funk pop 112 bpm", "Dial Me In"),
    ("folk pop 116 bpm acoustic guitar mandolin foot-stomp chorus male-female duet english no synth no arpeggio",
     "folk pop 116 bpm", "Backroad Radio"),
    ("britpop 120 bpm jangly electric guitars driving drums melodic bass male vocal chorus english no synth",
     "britpop 120 bpm", "London In Blue"),
    ("neo-soul pop 100 bpm rhodes electric piano wah guitar warm bass live drums female lead english no synth",
     "neo-soul pop 100 bpm", "Slow Bloom"),
    ("upbeat pop rock 128 bpm distorted electric guitar riff punchy drums anthem chorus english no synth no arpeggio",
     "pop-rock 128 bpm", "City Lights Alive"),
]

LOG = "/app/backend/scripts/pop_organic_2026.log"


async def main():
    f = open(LOG, "w")
    log = lambda m: (print(f"[{datetime.now().isoformat(timespec='seconds')}] {m}"),
                     f.write(f"[{datetime.now().isoformat(timespec='seconds')}] {m}\n"), f.flush())

    log(f"Starting POP ORGANIC batch: {len(PROMPTS)} tracks")
    id_to_title = {}
    id_to_genre = {}
    created = []
    ok = 0
    async with httpx.AsyncClient(timeout=90) as c:
        for i, (hint, genre, title) in enumerate(PROMPTS, 1):
            try:
                r = await c.post(f"{API}/api/tracks/generate", params={
                    "hint": f"{hint}, working title '{title}'",
                    "genre": genre, "lang": "en",
                })
                if r.status_code in (402, 502):
                    log(f"[{i:02d}] BUDGET/LLM error http={r.status_code} {r.text[:200]} — STOPPING BATCH to preserve Suno credits.")
                    break
                if r.status_code == 200:
                    d = r.json()
                    created.append(d["id"])
                    id_to_title[d["id"]] = title
                    id_to_genre[d["id"]] = genre
                    ok += 1
                    log(f"[{i:02d}/{len(PROMPTS)}] OK id={d['id']} title={title!r}")
                else:
                    log(f"[{i:02d}/{len(PROMPTS)}] FAIL {r.status_code} {r.text[:200]}")
            except Exception as e:
                log(f"[{i:02d}/{len(PROMPTS)}] EXC {e}")
            if i < len(PROMPTS): await asyncio.sleep(5)

    log(f"=== SUMMARY === ok={ok}/{len(PROMPTS)}")

    if created:
        os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
        os.environ.setdefault("DB_NAME", "test_database")
        from motor.motor_asyncio import AsyncIOMotorClient
        db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
        await db.tracks.update_many({"id": {"$in": created}}, {"$set": {
            "priority": "high", "tags": ["pop_organic_2026", "en", "high_rotation"],
            "playlist_batch": "pop_organic_2026", "rotation_weight": 3,
        }})
        for tid, tt in id_to_title.items():
            await db.tracks.update_one({"id": tid}, {"$set": {
                "title": tt, "genre": id_to_genre.get(tid, ""),
                "artist": "R-A.I. Pop",
            }})
        log(f"Renamed & tagged {len(id_to_title)} tracks")
    f.close()


if __name__ == "__main__":
    asyncio.run(main())
