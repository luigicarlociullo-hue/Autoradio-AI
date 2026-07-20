"""30 pop/dance inglesi con testi LEAN (hook ripetuto).
Prima resetta priority delle 30 precedenti (summer_it + tech_house_lean).
Poi genera 30 nuove marcandole priority=high per alta rotazione.
"""
import asyncio, httpx, os
from datetime import datetime

API = "http://localhost:8001"
LOG = "/app/backend/scripts/english_pop_dance.log"

# Mix pop chart moderno + dance/electronic anthem
PROMPTS = [
    # POP CHART (18 tracks)
    ("modern pop 108 bpm catchy 4-word hook repeated, female vocal, radio-friendly, upbeat", "pop 108 bpm"),
    ("dance pop 118 bpm big drop, chant one-word hook, female vocal, festival vibe", "dance pop 118 bpm"),
    ("pop rnb 96 bpm smooth male vocal short hook repeated, glossy production", "pop rnb 96 bpm"),
    ("synth pop 112 bpm 80s inspired short chant hook, male vocal, neon", "synth pop 112 bpm"),
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
    # DANCE / ELECTRONIC (12 tracks)
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


async def reset_previous_priority():
    """Rimuove priority=high dai 30 brani precedenti (summer_it + tech_house_lean)"""
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "test_database")
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    r = await db.tracks.update_many(
        {"tags": {"$in": ["summer_it", "tech_house_lean"]}},
        {"$set": {"priority": "normal", "rotation_weight": 1}},
    )
    return r.modified_count


async def main():
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    f = open(LOG, "w")

    def log(msg):
        line = f"[{datetime.now().isoformat(timespec='seconds')}] {msg}"
        print(line)
        f.write(line + "\n"); f.flush()

    reset = await reset_previous_priority()
    log(f"Reset priority=normal on {reset} previous tracks (summer_it + tech_house_lean)")

    created = []
    ok, fail = 0, 0
    async with httpx.AsyncClient(timeout=90) as c:
        for i, (hint, genre) in enumerate(PROMPTS, 1):
            try:
                r = await c.post(
                    f"{API}/api/tracks/generate",
                    params={"hint": hint, "genre": genre, "lang": "en", "lean": "true"},
                )
                if r.status_code == 200:
                    d = r.json()
                    created.append(d["id"])
                    ok += 1
                    log(f"[{i:02d}/30] OK id={d['id']} title={d.get('title')!r}")
                else:
                    fail += 1
                    log(f"[{i:02d}/30] FAIL http={r.status_code} {r.text[:200]}")
            except Exception as e:
                fail += 1
                log(f"[{i:02d}/30] EXC {e}")
            if i < len(PROMPTS):
                await asyncio.sleep(5)

    log(f"\n=== SUMMARY === ok={ok}/30 fail={fail}/30")

    if created:
        os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
        os.environ.setdefault("DB_NAME", "test_database")
        from motor.motor_asyncio import AsyncIOMotorClient
        db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
        r = await db.tracks.update_many(
            {"id": {"$in": created}},
            {"$set": {
                "priority": "high",
                "tags": ["english_pop_dance", "high_rotation"],
                "playlist_batch": "english_2026_03",
                "rotation_weight": 3,
            }},
        )
        log(f"Marked {r.modified_count} new tracks priority=high, rotation_weight=3")

    f.close()


if __name__ == "__main__":
    asyncio.run(main())
