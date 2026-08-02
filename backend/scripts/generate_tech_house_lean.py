"""Genera 10 brani tech-house con testi SCARNI e ritornello ripetuto (lean mode).
Al termine, marca tutti come priority='high' + tag='tech_house_lean' per alta rotazione.
"""
import asyncio
import httpx
import os
from datetime import datetime

API = "http://localhost:8001"

# 10 prompt tech-house con focus su hook ripetuto e testo minimale
PROMPTS = [
    ("tech house 126 bpm punchy kick groovy bassline club anthem, hook '4 words repeated'", "tech house 126 bpm"),
    ("tech house 128 bpm rolling bass driving beat one-word chorus chant style", "tech house 128 bpm"),
    ("tech house 124 bpm deep groove chopped vocal loop minimal lyrics", "tech house 124 bpm"),
    ("tech house 127 bpm tribal percussion catchy short hook repeated", "tech house 127 bpm"),
    ("tech house 130 bpm energetic drop repetitive vocal chant club focused", "tech house 130 bpm"),
    ("tech house 125 bpm funky bassline female vocal chop minimal words", "tech house 125 bpm"),
    ("tech house 128 bpm dark groove one-line refrain repeated 8 times", "tech house 128 bpm"),
    ("tech house 126 bpm rolling percussion catchy hook chant style", "tech house 126 bpm"),
    ("tech house 124 bpm deep sub bass short vocal cut looped", "tech house 124 bpm"),
    ("tech house 128 bpm big room drop chant vocal repeated minimal verses", "tech house 128 bpm"),
]

LOG = "/app/backend/scripts/tech_house_lean.log"


async def main():
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    f = open(LOG, "w")

    def log(msg):
        line = f"[{datetime.now().isoformat(timespec='seconds')}] {msg}"
        print(line)
        f.write(line + "\n"); f.flush()

    created = []
    ok = 0
    fail = 0
    async with httpx.AsyncClient(timeout=90) as c:
        for i, (hint, genre) in enumerate(PROMPTS, 1):
            try:
                r = await c.post(
                    f"{API}/api/tracks/generate",
                    params={"hint": hint, "genre": genre, "lang": "en", "lean": "true"},
                )
                if r.status_code in (402, 502):
                    log(f"[{i:02d}] BUDGET/LLM error http={r.status_code} {r.text[:200]} — STOPPING BATCH to preserve Suno credits.")
                    break
                if r.status_code == 200:
                    d = r.json()
                    created.append(d["id"])
                    ok += 1
                    log(f"[{i:02d}/10] OK id={d['id']} task={d.get('suno_task_id')} title={d.get('title')!r}")
                else:
                    fail += 1
                    log(f"[{i:02d}/10] FAIL http={r.status_code} {r.text[:200]}")
            except Exception as e:
                fail += 1
                log(f"[{i:02d}/10] EXC {e}")
            if i < len(PROMPTS):
                await asyncio.sleep(5)

    log(f"\n=== SUMMARY === ok={ok}/10 fail={fail}/10")
    log(f"IDs: {created}")

    if created:
        os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
        os.environ.setdefault("DB_NAME", "test_database")
        from motor.motor_asyncio import AsyncIOMotorClient
        db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
        r = await db.tracks.update_many(
            {"id": {"$in": created}},
            {"$set": {
                "priority": "high",
                "tags": ["tech_house_lean", "high_rotation"],
                "playlist_batch": "tech_house_2026_02",
                "rotation_weight": 3,  # 3x più probabile di essere pescato
            }},
        )
        log(f"Marked {r.modified_count} tracks priority=high, rotation_weight=3")

    f.close()


if __name__ == "__main__":
    asyncio.run(main())
