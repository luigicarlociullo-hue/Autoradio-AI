"""10 jingle R-A.I. brandizzati con [Outro] esplicito per chiusura pulita.
Suno V4 rispetta i tag di struttura — [Outro] con "yeah!" o "R-A-I!" finale
+ [End] risolve il problema del taglio brutto.
"""
import asyncio, httpx, os
from datetime import datetime

API = "http://localhost:8001"
LOG = "/app/backend/scripts/rai_jingles_clean.log"

# Struttura: [Intro] breve → [Hook] x3-4 → [Outro] con chiusura secca + [End]
def build_lyrics(hook_line, closer_line):
    return (
        "[Intro]\n"
        f"{hook_line}\n"
        "[Hook]\n"
        f"{hook_line}\n"
        f"{hook_line}\n"
        f"{hook_line}\n"
        "[Outro]\n"
        f"{closer_line}\n"
        "[End]\n"
    )

# 10 jingle: stile + genre + (hook_line, closer_line)
JINGLES = [
    (
        "upbeat radio jingle 25 seconds, punchy female voice, disco pop, big drums, clean ending",
        "radio jingle disco pop",
        ("R-A-I on the radio", "R-A-I!"),
    ),
    (
        "short male voice chant, house 128 bpm, minimal, 20 seconds, clean stop ending",
        "radio jingle house 128 bpm",
        ("R-A-I here we go", "Yeah! R-A-I!"),
    ),
    (
        "female choir big room drop 128 bpm, 20 seconds jingle, sharp ending",
        "radio jingle big room",
        ("R-A-I never stops", "R-A-I never stops!"),
    ),
    (
        "italo pop 100 bpm, voce femminile, jingle radio 20s, chiusura decisa",
        "jingle italo pop 100 bpm",
        ("R-A-I la radio del futuro", "R-A-I!"),
    ),
    (
        "electronic pop synths female voice, 20 second radio ident, sharp stop",
        "radio jingle electronic pop",
        ("R-A-I plays it all night", "R-A-I!"),
    ),
    (
        "acoustic guitar pop, male voice, 20 second radio ident, natural fade ending",
        "radio jingle acoustic pop",
        ("R-A-I is on the air", "on the air!"),
    ),
    (
        "soul funk brass female voice, 20 second radio ident, punchy final hit",
        "radio jingle soul funk",
        ("R-A-I turn it up", "Turn it up! R-A-I!"),
    ),
    (
        "italo disco 118 bpm voce femminile, jingle radio 20s, chiusura pulita",
        "jingle italo disco 118 bpm",
        ("R-A-I la notte è nostra", "R-A-I!"),
    ),
    (
        "indie rock guitar riff, male voice hook, 20 seconds radio jingle, clean stop ending",
        "radio jingle indie rock",
        ("R-A-I this is your sound", "R-A-I!"),
    ),
    (
        "electro pop synth female voice, 20 second radio ident, clean ending",
        "radio jingle electro pop 116 bpm",
        ("R-A-I loud and clear", "R-A-I!"),
    ),
]


async def main():
    f = open(LOG, "w")
    def log(m):
        line = f"[{datetime.now().isoformat(timespec='seconds')}] {m}"
        print(line); f.write(line + "\n"); f.flush()

    created = []; ok = 0; fail = 0
    async with httpx.AsyncClient(timeout=90) as c:
        for i, (hint, genre, (hook, closer)) in enumerate(JINGLES, 1):
            lyrics = build_lyrics(hook, closer)
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
                if r.status_code == 200:
                    d = r.json(); created.append(d["id"]); ok += 1
                    log(f"[{i:02d}/10] OK id={d['id']} hook='{hook}' title={d.get('title')!r}")
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
                "tags": ["rai_jingle_clean", "station_ident"],
                "playlist_batch": "jingles_clean_2026_02",
                "priority": "normal",
            }},
        )
        log(f"Marked {r.modified_count} as is_jingle=True (clean outro)")
    f.close()


if __name__ == "__main__":
    asyncio.run(main())
