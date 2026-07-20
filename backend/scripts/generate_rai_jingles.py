"""Genera 10 jingle R-A.I. brandizzati (short sung station idents).
Testi ULTRA-scarni con "R-A.I." nel refrain ripetuto molte volte.
Marca is_jingle=True per esclusione dalla rotazione music normale.
"""
import asyncio, httpx, os
from datetime import datetime

API = "http://localhost:8001"
LOG = "/app/backend/scripts/rai_jingles.log"

# 10 jingle brandizzati R-A.I. — stile + hook cortissimo
PROMPTS = [
    ("upbeat radio jingle 30 seconds only, catchy chant 'R-A-I on the radio' repeated, disco pop", "radio jingle disco pop"),
    ("short female vocal chant 'R-A-I' hook only, house 128 bpm, 20 seconds", "radio jingle house 128 bpm"),
    ("male voice singing 'R-A-I here we go' repeated, retro pop 30s ident", "radio jingle retro pop"),
    ("children choir 'R-A-I' chant, funky pop 20 seconds ident", "radio jingle funky pop"),
    ("electronic pop female voice 'we are R-A-I' hook repeated", "radio jingle electronic pop"),
    ("acoustic guitar radio ident, sung 'R-A-I plays it all' catchy", "radio jingle acoustic pop"),
    ("dance chant 'R-A-I R-A-I' repeated hook, big room drop 128 bpm short", "radio jingle big room"),
    ("smooth soul voice singing 'R-A-I on your radio' short 20s", "radio jingle soul"),
    ("indie rock guitar riff sung 'R-A-I never stops' hook", "radio jingle indie rock"),
    ("italo disco female voice 'ecco R-A-I' catchy chant 20s ident", "radio jingle italo disco"),
]


async def main():
    f = open(LOG, "w")
    def log(m):
        line = f"[{datetime.now().isoformat(timespec='seconds')}] {m}"
        print(line); f.write(line + "\n"); f.flush()

    created = []; ok = 0; fail = 0
    async with httpx.AsyncClient(timeout=90) as c:
        for i, (hint, genre) in enumerate(PROMPTS, 1):
            try:
                r = await c.post(f"{API}/api/tracks/generate",
                                 params={"hint": hint, "genre": genre, "lang": "en", "lean": "true"})
                if r.status_code == 200:
                    d = r.json(); created.append(d["id"]); ok += 1
                    log(f"[{i:02d}/10] OK id={d['id']} title={d.get('title')!r}")
                else:
                    fail += 1; log(f"[{i:02d}/10] FAIL {r.status_code} {r.text[:200]}")
            except Exception as e:
                fail += 1; log(f"[{i:02d}/10] EXC {e}")
            if i < 10:
                await asyncio.sleep(5)

    log(f"\n=== ok={ok}/10 fail={fail}/10")
    if created:
        os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
        os.environ.setdefault("DB_NAME", "test_database")
        from motor.motor_asyncio import AsyncIOMotorClient
        db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
        r = await db.tracks.update_many(
            {"id": {"$in": created}},
            {"$set": {
                "is_jingle": True,
                "tags": ["rai_jingle", "station_ident"],
                "playlist_batch": "jingles_2026_02",
                "priority": "normal",
            }},
        )
        log(f"Marked {r.modified_count} as is_jingle=True (exclude from music rotation)")
    f.close()


if __name__ == "__main__":
    asyncio.run(main())
