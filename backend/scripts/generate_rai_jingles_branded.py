"""10 jingle R-A.I. BRANDIZZATI con custom_lyrics espliciti.
Hook 'R-A-I' ripetuto molte volte per fissare il brand.
Suno usa il custom_lyrics passato — no generazione LLM automatica.
"""
import asyncio, httpx, os
from datetime import datetime
from urllib.parse import quote

API = "http://localhost:8001"
LOG = "/app/backend/scripts/rai_jingles_branded.log"

# 10 jingle con testo custom brevissimo + stile diverso
JINGLES = [
    # (style_hint, genre_tag, custom_lyrics)
    (
        "upbeat radio jingle 25 seconds, punchy female voice, disco pop, punchy drums",
        "radio jingle disco pop",
        "[Hook]\nR-A-I on the radio\nR-A-I on the radio\nR-A-I on the radio\nR-A-I on the radio\n"
    ),
    (
        "short male voice chant, house 128 bpm, minimal, 20 seconds",
        "radio jingle house 128 bpm",
        "[Hook]\nR-A-I here we go\nR-A-I here we go\nR-A-I here we go\nR-A-I here we go\n"
    ),
    (
        "female choir big room drop 128 bpm, 20 seconds jingle",
        "radio jingle big room",
        "[Hook]\nR-A-I never stops\nR-A-I never stops\nR-A-I never stops\nR-A-I never stops\n"
    ),
    (
        "retro pop italiana 100 bpm, voce femminile, jingle radio 20s",
        "jingle italo pop 100 bpm",
        "[Hook]\nR-A-I la radio del futuro\nR-A-I la radio del futuro\nR-A-I la radio del futuro\nR-A-I la radio del futuro\n"
    ),
    (
        "electronic pop synths female voice, 20 second radio ident",
        "radio jingle electronic pop",
        "[Hook]\nR-A-I plays it all night\nR-A-I plays it all night\nR-A-I plays it all night\nR-A-I plays it all night\n"
    ),
    (
        "acoustic guitar pop, male voice, 20 second radio ident",
        "radio jingle acoustic pop",
        "[Hook]\nR-A-I is on the air\nR-A-I is on the air\nR-A-I is on the air\nR-A-I is on the air\n"
    ),
    (
        "soul funk brass female voice, 20 second radio ident",
        "radio jingle soul funk",
        "[Hook]\nR-A-I turn it up\nR-A-I turn it up\nR-A-I turn it up\nR-A-I turn it up\n"
    ),
    (
        "italo disco 118 bpm voce femminile, jingle radio 20s",
        "jingle italo disco 118 bpm",
        "[Hook]\nR-A-I la notte è nostra\nR-A-I la notte è nostra\nR-A-I la notte è nostra\nR-A-I la notte è nostra\n"
    ),
    (
        "indie rock guitar riff, male voice hook, 20 seconds radio jingle",
        "radio jingle indie rock",
        "[Hook]\nR-A-I this is your sound\nR-A-I this is your sound\nR-A-I this is your sound\nR-A-I this is your sound\n"
    ),
    (
        "electro pop synth female voice, 20 second radio ident",
        "radio jingle electro pop 116 bpm",
        "[Hook]\nR-A-I loud and clear\nR-A-I loud and clear\nR-A-I loud and clear\nR-A-I loud and clear\n"
    ),
]


async def main():
    f = open(LOG, "w")
    def log(m):
        line = f"[{datetime.now().isoformat(timespec='seconds')}] {m}"
        print(line); f.write(line + "\n"); f.flush()

    created = []; ok = 0; fail = 0
    async with httpx.AsyncClient(timeout=90) as c:
        for i, (hint, genre, lyrics) in enumerate(JINGLES, 1):
            try:
                r = await c.post(
                    f"{API}/api/tracks/generate",
                    params={
                        "hint": hint,
                        "genre": genre,
                        "lang": "en",
                        "custom_lyrics": lyrics,
                    },
                )
                if r.status_code in (402, 502):
                    log(f"[{i:02d}] BUDGET/LLM error http={r.status_code} {r.text[:200]} — STOPPING BATCH to preserve Suno credits.")
                    break
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
                "tags": ["rai_jingle_branded", "station_ident"],
                "playlist_batch": "jingles_branded_2026_02",
                "priority": "normal",
            }},
        )
        log(f"Marked {r.modified_count} as is_jingle=True (branded)")
    f.close()


if __name__ == "__main__":
    asyncio.run(main())
