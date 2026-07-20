"""20 brani italiani LEAN v2: hook ripetuto max 12 parole/versetto, durata 2:30-3:00.
Mix pop italiano moderno + dance italiana + hit orecchiabili.
Marca priority=normal (le english high sono ancora priority=high) — le italiane
compaiono "ogni tanto" come richiesto dall'utente.
"""
import asyncio, httpx, os
from datetime import datetime

API = "http://localhost:8001"
LOG = "/app/backend/scripts/italian_lean_v2.log"

PROMPTS = [
    ("pop italiano moderno 108 bpm hook ripetuto 8 volte 'vieni con me' catchy female vocal", "pop italiano 108 bpm"),
    ("disco pop italiano 116 bpm hook 'balla balla' repeated, brass punchy", "disco pop italiano 116 bpm"),
    ("dance italian 120 bpm short chant 'la notte è mia' hook, festival", "dance italiano 120 bpm"),
    ("tech house italian 126 bpm minimal vocal 'muoviti' repeated, groove", "tech house italiano 126 bpm"),
    ("pop rnb italiano 96 bpm smooth male hook 'resta con me' repeated", "pop rnb italiano 96 bpm"),
    ("italo dance 118 bpm chant 'stella stellare' hook, synth colorati", "italo dance 118 bpm"),
    ("reggaeton italiano 95 bpm hook 'ballerina' repeated, percussion", "reggaeton italiano 95 bpm"),
    ("indie pop italiano 105 bpm hook 'via da qui' repeated female vocal", "indie pop italiano 105 bpm"),
    ("future house italiano 125 bpm chopped vocal 'siamo noi' hook", "future house italiano 125 bpm"),
    ("italian summer pop 100 bpm hook 'sole sale' repeated 8 times", "summer pop italiano 100 bpm"),
    ("italian trap pop 92 bpm hook 'tutto ok' repeated male vocal", "trap pop italiano 92 bpm"),
    ("italian melodic techno 124 bpm hypnotic hook 'oltre il tempo' repeated", "melodic techno italiano 124 bpm"),
    ("italian synth pop 112 bpm 80s hook 'notte neon' repeated", "synth pop italiano 112 bpm"),
    ("italian afro house 122 bpm hook 'dammi tempo' chant repeated", "afro house italiano 122 bpm"),
    ("italian pop rock 110 bpm anthemic hook 'ancora noi' repeated male", "pop rock italiano 110 bpm"),
    ("italian dance pop 118 bpm euphoric drop 'senza fine' hook chant", "dance pop italiano 118 bpm"),
    ("italian big room 128 bpm massive drop hook 'sali sali' chant", "big room italiano 128 bpm"),
    ("italian deep house 122 bpm smooth 'aspetta me' hook loop", "deep house italiano 122 bpm"),
    ("italian tropical house 108 bpm marimba hook 'via mare' chant", "tropical house italiano 108 bpm"),
    ("italian electro pop 116 bpm punchy 'batti forte' hook repeated female", "electro pop italiano 116 bpm"),
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
                                 params={"hint": hint, "genre": genre, "lang": "it", "lean": "true"})
                if r.status_code == 200:
                    d = r.json(); created.append(d["id"]); ok += 1
                    log(f"[{i:02d}/20] OK id={d['id']} title={d.get('title')!r}")
                else:
                    fail += 1; log(f"[{i:02d}/20] FAIL {r.status_code} {r.text[:200]}")
            except Exception as e:
                fail += 1; log(f"[{i:02d}/20] EXC {e}")
            if i < 20:
                await asyncio.sleep(5)

    log(f"\n=== ok={ok}/20 fail={fail}/20")
    if created:
        os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
        os.environ.setdefault("DB_NAME", "test_database")
        from motor.motor_asyncio import AsyncIOMotorClient
        db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
        r = await db.tracks.update_many(
            {"id": {"$in": created}},
            {"$set": {
                "priority": "normal",  # italiane restano in normal_pool (35% rotazione)
                "tags": ["italian_lean_v2", "hit_italiane"],
                "playlist_batch": "italian_2026_02",
                "rotation_weight": 1,
            }},
        )
        log(f"Marked {r.modified_count} as italian_lean_v2 (priority=normal, appear ~35% of the time)")
    f.close()


if __name__ == "__main__":
    asyncio.run(main())
