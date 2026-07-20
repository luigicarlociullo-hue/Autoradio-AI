"""Riprende la generazione dei 26 restanti brani pop/dance inglesi (dal #05)."""
import asyncio, httpx, os
from datetime import datetime

API = "http://localhost:8001"
LOG = "/app/backend/scripts/english_pop_dance_resume.log"

# I 26 rimanenti (indici 5..30 dallo script originale)
PROMPTS = [
    ("indie pop 105 bpm bright acoustic driven, catchy 3-word chorus repeated, female vocal", "indie pop 105 bpm"),
    ("electro pop 116 bpm punchy bass one-line refrain repeated, androgynous vocal", "electro pop 116 bpm"),
    ("dance pop 122 bpm euphoric drop, chant vocal hook, festival anthem", "dance pop 122 bpm"),
    ("pop trap 92 bpm modern trap beat, catchy 4-word hook, male vocal", "pop trap 92 bpm"),
    ("dream pop 100 bpm ethereal female vocal minimal words repeated, reverb heavy", "dream pop 100 bpm"),
    ("pop rock 110 bpm guitar driven anthemic hook repeated, male vocal", "pop rock 110 bpm"),
    ("k-pop style 115 bpm punchy chorus one-line hook chant, mixed vocal", "kpop style 115 bpm"),
    ("hyperpop 130 bpm distorted vocal short punchy hook repeated, energetic", "hyperpop 130 bpm"),
    ("uk garage pop 130 bpm chopped vocal loop hook, house percussion", "uk garage pop 130 bpm"),
    ("latin pop english 100 bpm bilingual short hook, tropical percussion", "latin pop english 100 bpm"),
    ("bedroom pop 88 bpm lo-fi female vocal minimal hook repeated", "bedroom pop 88 bpm"),
    ("summer pop 105 bpm bright synth acoustic mix catchy hook, radio hit", "summer pop 105 bpm"),
    ("alternative pop 108 bpm dark tone catchy 3-word hook, male vocal", "alternative pop 108 bpm"),
    ("future pop 120 bpm sci-fi synths one-word chant repeated, female vocal", "future pop 120 bpm"),
    ("progressive house 128 bpm euphoric drop, chant hook repeated, festival", "progressive house 128 bpm"),
    ("future house 125 bpm plucky lead, one-line vocal chop hook", "future house 125 bpm"),
    ("melodic techno 124 bpm hypnotic groove minimal vocal chant repeated", "melodic techno 124 bpm"),
    ("bass house 128 bpm heavy bass hook repeated, club anthem", "bass house 128 bpm"),
    ("big room edm 128 bpm massive drop, chant one-word hook, festival main stage", "big room edm 128 bpm"),
    ("drum and bass 174 bpm rolling break, catchy vocal cut repeated", "drum and bass 174 bpm"),
    ("electro house 130 bpm punchy synth, chant hook repeated, energetic", "electro house 130 bpm"),
    ("deep house 122 bpm smooth groove, short vocal loop repeated, soulful", "deep house 122 bpm"),
    ("tropical house 108 bpm marimba pluck, catchy 4-word hook, chill vibe", "tropical house 108 bpm"),
    ("uk dance 128 bpm speed garage bassline, chopped vocal hook repeated", "uk dance 128 bpm"),
    ("psytrance 138 bpm hypnotic acid line, chant vocal hook, trippy", "psytrance 138 bpm"),
    ("dubstep 140 bpm wobble bass drop, one-word chant hook repeated", "dubstep 140 bpm"),
]


async def main():
    f = open(LOG, "w")
    def log(m):
        line = f"[{datetime.now().isoformat(timespec='seconds')}] {m}"
        print(line); f.write(line + "\n"); f.flush()

    created = []; ok = 0; fail = 0
    async with httpx.AsyncClient(timeout=90) as c:
        for i, (hint, genre) in enumerate(PROMPTS, 5):
            try:
                r = await c.post(f"{API}/api/tracks/generate",
                                 params={"hint": hint, "genre": genre, "lang": "en", "lean": "true"})
                if r.status_code == 200:
                    d = r.json(); created.append(d["id"]); ok += 1
                    log(f"[{i:02d}/30] OK id={d['id']} title={d.get('title')!r}")
                else:
                    fail += 1; log(f"[{i:02d}/30] FAIL {r.status_code} {r.text[:200]}")
            except Exception as e:
                fail += 1; log(f"[{i:02d}/30] EXC {e}")
            if i < 30:
                await asyncio.sleep(5)

    log(f"\n=== ok={ok}/26 fail={fail}/26")
    if created:
        os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
        os.environ.setdefault("DB_NAME", "test_database")
        from motor.motor_asyncio import AsyncIOMotorClient
        db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
        r = await db.tracks.update_many(
            {"id": {"$in": created}},
            {"$set": {"priority": "high", "tags": ["english_pop_dance", "high_rotation"],
                      "playlist_batch": "english_2026_03", "rotation_weight": 3}},
        )
        log(f"Marked {r.modified_count} new tracks high priority")
    f.close()


if __name__ == "__main__":
    asyncio.run(main())
