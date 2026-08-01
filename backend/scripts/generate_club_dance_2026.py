"""Genera 20 tracce dance-club variate (techno, house, tech-house, electro-house).
Testi minimi in inglese, accordi diversificati, BPM variato, titoli tutti diversi.
Al termine marca tutte con priority='high' + tag 'club_dance_2026' e
rotation_weight=3 per farle entrare subito in rotazione.
"""
import asyncio
import httpx
import os
from datetime import datetime

API = "http://localhost:8001"

# 20 prompt club-oriented, ciascuno con titolo suggerito diverso.
# Struttura tupla: (hint_suno, genre, suggested_title)
PROMPTS = [
    # --- TECHNO (5) ---
    ("driving techno 130 bpm dark warehouse synth stab minor key 4x4 kick sub bass minimal english vocal chant",
     "techno 130 bpm", "Iron Hour"),
    ("hypnotic techno 132 bpm rolling acid bassline arp minor 7 chords industrial reverb short english hook",
     "techno 132 bpm", "Grid Signal"),
    ("melodic techno 128 bpm emotional pad C minor to A minor progression airy female vocal chop",
     "techno 128 bpm", "Aurora Line"),
    ("peak time techno 134 bpm big room drop distorted lead maj7 progression stab loop short english hook",
     "techno 134 bpm", "Kilonova"),
    ("dub techno 126 bpm deep dub chord D minor 9 sparse kick space delay ambient english vocal snippet",
     "techno 126 bpm", "Undertow"),

    # --- HOUSE (5) ---
    ("classic house 124 bpm jazzy piano chord F maj7 groovy bass funky guitar loop feel-good english hook",
     "house 124 bpm", "Weekender"),
    ("deep house 122 bpm warm rhodes chord A minor 9 smooth bassline soulful vocal chop female one-word chant",
     "house 122 bpm", "Slow Neon"),
    ("afro house 123 bpm tribal percussion marimba melody G major shaker organic vocal ad-libs english",
     "house 123 bpm", "Kalima"),
    ("progressive house 126 bpm uplifting pluck chord Bb major shimmering pad huge drop short english hook",
     "house 126 bpm", "Skyliner"),
    ("french touch house 118 bpm filtered disco chord loop E minor 7 vocal chop repeated funky bass",
     "house 118 bpm", "Chromic"),

    # --- TECH-HOUSE (5) ---
    ("tech house 125 bpm rolling groove chopped vocal loop minor 7 stab minimal english word repeated",
     "tech-house 125 bpm", "Blackout Hour"),
    ("tech house 127 bpm bumpy bassline vocal chant one line repeated 8 times punchy kick",
     "tech-house 127 bpm", "Loop On Me"),
    ("tech house 126 bpm dark groove sub bass conga percussion tight snare english vocal snippet",
     "tech-house 126 bpm", "Nightform"),
    ("latin tech house 124 bpm spanish guitar sample chopped percussion catchy english hook",
     "tech-house 124 bpm", "Havana Rewire"),
    ("melodic tech house 128 bpm plucky lead chord C minor 9 emotional pad short female vocal cut",
     "tech-house 128 bpm", "Signal Bloom"),

    # --- ELECTRO-HOUSE (5) ---
    ("electro house 128 bpm big saw lead chord progression F minor Ab major heavy drop short english shout",
     "electro-house 128 bpm", "Lasercore"),
    ("electro house 130 bpm distorted synth chord D minor to Bb major sidechain pump crowd shout",
     "electro-house 130 bpm", "Overdrive"),
    ("future electro house 126 bpm plucked lead chord E major sunny catchy vocal chop english hook",
     "electro-house 126 bpm", "Coastline"),
    ("dark electro house 128 bpm growl bass minor chord stab aggressive drop short english chant",
     "electro-house 128 bpm", "Concrete Sky"),
    ("bass house 128 bpm heavy wobble G minor progression stuttered vocal chop punchy drop",
     "bass-house 128 bpm", "Static Bloom"),
]

LOG = "/app/backend/scripts/club_dance_2026.log"


async def main():
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    f = open(LOG, "w")

    def log(msg):
        line = f"[{datetime.now().isoformat(timespec='seconds')}] {msg}"
        print(line)
        f.write(line + "\n"); f.flush()

    log(f"Starting Club Dance batch: {len(PROMPTS)} tracks")
    # Map id → suggested title, so at the end we can rename tracks with
    # distinct human titles regardless of what the LLM auto-generated.
    id_to_title = {}
    id_to_genre = {}
    created = []
    ok = 0
    fail = 0
    async with httpx.AsyncClient(timeout=90) as c:
        for i, (hint, genre, title_hint) in enumerate(PROMPTS, 1):
            try:
                r = await c.post(
                    f"{API}/api/tracks/generate",
                    params={
                        "hint": f"{hint}, working title '{title_hint}'",
                        "genre": genre,
                        "lang": "en",
                        "lean": "true",
                    },
                )
                if r.status_code == 200:
                    d = r.json()
                    created.append(d["id"])
                    id_to_title[d["id"]] = title_hint
                    id_to_genre[d["id"]] = genre
                    ok += 1
                    log(f"[{i:02d}/{len(PROMPTS)}] OK id={d['id']} task={d.get('suno_task_id')} "
                        f"suggested_title={title_hint!r} api_title={d.get('title')!r}")
                else:
                    fail += 1
                    log(f"[{i:02d}/{len(PROMPTS)}] FAIL http={r.status_code} {r.text[:200]}")
            except Exception as e:
                fail += 1
                log(f"[{i:02d}/{len(PROMPTS)}] EXC {e}")
            if i < len(PROMPTS):
                # Rate-limit friendly delay between Suno requests
                await asyncio.sleep(5)

    log(f"\n=== SUMMARY === ok={ok}/{len(PROMPTS)} fail={fail}/{len(PROMPTS)}")
    log(f"IDs: {created}")

    if created:
        os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
        os.environ.setdefault("DB_NAME", "test_database")
        from motor.motor_asyncio import AsyncIOMotorClient
        db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
        # First: apply rotation metadata to the whole batch.
        r = await db.tracks.update_many(
            {"id": {"$in": created}},
            {"$set": {
                "priority": "high",
                "tags": ["club_dance_2026", "high_rotation", "en"],
                "playlist_batch": "club_dance_2026",
                "rotation_weight": 3,
            }},
        )
        log(f"Marked {r.modified_count} tracks priority=high, rotation_weight=3, tag=club_dance_2026")
        # Second: rename each track using the distinct suggested title, so
        # the LLM fallback that repeated 'Neon Rivière' is overridden.
        renamed = 0
        for tid, ttitle in id_to_title.items():
            g = id_to_genre.get(tid, "")
            await db.tracks.update_one(
                {"id": tid},
                {"$set": {"title": ttitle, "genre": g}},
            )
            renamed += 1
        log(f"Renamed {renamed} tracks with distinct titles from prompt list")

    f.close()


if __name__ == "__main__":
    asyncio.run(main())
