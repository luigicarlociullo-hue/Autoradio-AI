"""Batch 20 tracce dance/club STRUMENTALI (nessun testo cantato).
Genero techno, house, tech-house, electro-house, bass-house in lingua neutra
usando instrumental=true → Suno restituisce solo la parte musicale.
Al termine marca priority=high, rotation_weight=3 e tag 'club_dance_instr_2026'
per la rotazione, e RINOMINA con i title_hint per evitare duplicati LLM.
"""
import asyncio
import httpx
import os
from datetime import datetime

API = "http://localhost:8001"

PROMPTS = [
    # --- TECHNO (5) ---
    ("driving techno 130 bpm dark warehouse synth stab minor key 4x4 kick sub bass instrumental",
     "techno 130 bpm", "Iron Hour"),
    ("hypnotic techno 132 bpm rolling acid bassline arp minor 7 chords industrial reverb instrumental",
     "techno 132 bpm", "Grid Signal"),
    ("melodic techno 128 bpm emotional pad C minor to A minor progression airy synth instrumental",
     "techno 128 bpm", "Aurora Line"),
    ("peak time techno 134 bpm big room drop distorted lead maj7 progression stab loop instrumental",
     "techno 134 bpm", "Kilonova"),
    ("dub techno 126 bpm deep dub chord D minor 9 sparse kick space delay ambient instrumental",
     "techno 126 bpm", "Undertow"),

    # --- HOUSE (5) ---
    ("classic house 124 bpm jazzy piano chord F maj7 groovy bass funky guitar loop feel-good instrumental",
     "house 124 bpm", "Weekender"),
    ("deep house 122 bpm warm rhodes chord A minor 9 smooth bassline soulful piano instrumental",
     "house 122 bpm", "Slow Neon"),
    ("afro house 123 bpm tribal percussion marimba melody G major shaker organic instrumental",
     "house 123 bpm", "Kalima"),
    ("progressive house 126 bpm uplifting pluck chord Bb major shimmering pad huge drop instrumental",
     "house 126 bpm", "Skyliner"),
    ("french touch house 118 bpm filtered disco chord loop E minor 7 funky bass instrumental",
     "house 118 bpm", "Chromic"),

    # --- TECH-HOUSE (5) ---
    ("tech house 125 bpm rolling groove minor 7 stab punchy kick tight snare instrumental",
     "tech-house 125 bpm", "Blackout Hour"),
    ("tech house 127 bpm bumpy bassline punchy kick loop congas percussion instrumental",
     "tech-house 127 bpm", "Loop On Me"),
    ("tech house 126 bpm dark groove sub bass conga percussion tight snare instrumental",
     "tech-house 126 bpm", "Nightform"),
    ("latin tech house 124 bpm spanish guitar sample chopped percussion instrumental",
     "tech-house 124 bpm", "Havana Rewire"),
    ("melodic tech house 128 bpm plucky lead chord C minor 9 emotional pad instrumental",
     "tech-house 128 bpm", "Signal Bloom"),

    # --- ELECTRO-HOUSE (5) ---
    ("electro house 128 bpm big saw lead chord progression F minor Ab major heavy drop instrumental",
     "electro-house 128 bpm", "Lasercore"),
    ("electro house 130 bpm distorted synth chord D minor to Bb major sidechain pump instrumental",
     "electro-house 130 bpm", "Overdrive"),
    ("future electro house 126 bpm plucked lead chord E major sunny catchy instrumental",
     "electro-house 126 bpm", "Coastline"),
    ("dark electro house 128 bpm growl bass minor chord stab aggressive drop instrumental",
     "electro-house 128 bpm", "Concrete Sky"),
    ("bass house 128 bpm heavy wobble G minor progression stuttered chop punchy drop instrumental",
     "bass-house 128 bpm", "Static Bloom"),
]

LOG = "/app/backend/scripts/club_dance_instr_2026.log"


async def main():
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    f = open(LOG, "w")

    def log(msg):
        line = f"[{datetime.now().isoformat(timespec='seconds')}] {msg}"
        print(line); f.write(line + "\n"); f.flush()

    log(f"Starting INSTRUMENTAL Club batch: {len(PROMPTS)} tracks")
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
                        "instrumental": "true",  # <── ZERO lyrics
                        # No lean, no premium: just instrumental mode
                    },
                )
                if r.status_code == 200:
                    d = r.json()
                    created.append(d["id"])
                    id_to_title[d["id"]] = title_hint
                    id_to_genre[d["id"]] = genre
                    ok += 1
                    log(f"[{i:02d}/{len(PROMPTS)}] OK id={d['id']} task={d.get('suno_task_id')} "
                        f"title={title_hint!r}")
                else:
                    fail += 1
                    log(f"[{i:02d}/{len(PROMPTS)}] FAIL http={r.status_code} {r.text[:200]}")
            except Exception as e:
                fail += 1
                log(f"[{i:02d}/{len(PROMPTS)}] EXC {e}")
            if i < len(PROMPTS):
                await asyncio.sleep(5)

    log(f"\n=== SUMMARY === ok={ok}/{len(PROMPTS)} fail={fail}/{len(PROMPTS)}")
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
                "tags": ["club_dance_instr_2026", "instrumental", "high_rotation"],
                "playlist_batch": "club_dance_instr_2026",
                "rotation_weight": 3,
            }},
        )
        log(f"Marked {r.modified_count} tracks priority=high, rotation_weight=3")
        renamed = 0
        for tid, ttitle in id_to_title.items():
            g = id_to_genre.get(tid, "")
            await db.tracks.update_one(
                {"id": tid},
                {"$set": {"title": ttitle, "genre": g, "artist": "R-A.I. Club"}},
            )
            renamed += 1
        log(f"Renamed {renamed} tracks with distinct titles")

    f.close()


if __name__ == "__main__":
    asyncio.run(main())
