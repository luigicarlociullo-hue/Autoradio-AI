"""Genera 20 brani estivi italiani via /api/tracks/generate con 5s di spacing.
Al termine, marca tutti i brani creati con priority='high'.
"""
import asyncio
import httpx
import json
import time
import os
from datetime import datetime

# Uso backend locale per il POST (bypass proxy)
API = "http://localhost:8001"

PROMPTS = [
    ("disco-pop italiano estate, stile Annalisa, ritmo ballabile 110 bpm, testo italiano romantico estivo, chitarra elettrica e synth", "disco-pop italiano 110 bpm"),
    ("funky estivo italiano, stile The Kolors, basso groovy, 108 bpm, voce femminile, estate mare sole", "funky italiano 108 bpm"),
    ("reggaeton leggero italiano, stile Boomdabash, 95 bpm, testo allegro estate, fiati e percussioni", "reggaeton italiano 95 bpm"),
    ("electro-pop mediterraneo, testo italiano estate 2024, 112 bpm, synth colorati, voce pop femminile", "electro-pop italiano 112 bpm"),
    ("pop italiano estivo, stile Elodie, ritmo incalzante 106 bpm, testo passione estate, produzione moderna", "pop italiano 106 bpm"),
    ("summer vibes italiano, chitarra acustica e beat elettronico, 100 bpm, testo spiaggia tramonto", "summer pop italiano 100 bpm"),
    ("italo disco moderno, stile anni 80 rivisitato, 114 bpm, testo italiano festa estate", "italo disco 114 bpm"),
    ("tropical house italiano, 104 bpm, marimba e synth, testo italiano relax vacanze", "tropical house italiano 104 bpm"),
    ("pop funk italiano, stile Fedez, 110 bpm, testo ironico estate city, basso funk", "pop funk italiano 110 bpm"),
    ("ballad estiva pop italiana, 96 bpm, chitarra e piano, testo italiano nostalgia estate", "pop ballad italiana 96 bpm"),
    ("dance pop italiano, 118 bpm, drop energico, voce femminile, testo libertà estate", "dance pop italiano 118 bpm"),
    ("afrobeat italiano, 102 bpm, percussioni africane e melodia italiana, testo sole mare", "afrobeat italiano 102 bpm"),
    ("indie pop italiano estivo, 98 bpm, chitarra reverb, testo malinconico ma ballabile", "indie pop italiano 98 bpm"),
    ("hip hop pop italiano estate, 105 bpm, beat trap leggero, testo italiano vacanza divertimento", "hip hop italiano 105 bpm"),
    ("synthpop italiano, stile anni 80 ma moderno, 116 bpm, tastiere e voce androgina, testo notte estate", "synthpop italiano 116 bpm"),
    ("pop acustico estivo italiano, 92 bpm, chitarra fingerpicking, testo amore estivo", "pop acustico italiano 92 bpm"),
    ("house italiana con voce pop, 122 bpm, piano house, testo italiano festa notte", "house italiana 122 bpm"),
    ("bossa nova italiana moderna, 88 bpm, chitarra classica e beat sottile, testo estate italiana", "bossa nova italiana 88 bpm"),
    ("electro swing italiano, 106 bpm, fiati jazz e beat elettronico, testo giocoso estate", "electro swing italiano 106 bpm"),
    ("pop italiano con influenze latine, 108 bpm, testo passione vacanze, chitarra e percussioni", "latin pop italiano 108 bpm"),
]

LOG_PATH = "/app/backend/scripts/summer_batch.log"


async def main():
    os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
    log = open(LOG_PATH, "w")

    def w(msg):
        line = f"[{datetime.now().isoformat(timespec='seconds')}] {msg}"
        print(line)
        log.write(line + "\n")
        log.flush()

    created_ids = []
    successes = 0
    failures = 0

    async with httpx.AsyncClient(timeout=90) as client:
        for i, (hint, genre) in enumerate(PROMPTS, 1):
            try:
                r = await client.post(
                    f"{API}/api/tracks/generate",
                    params={"hint": hint, "genre": genre, "lang": "it"},
                )
                if r.status_code == 200:
                    data = r.json()
                    tid = data.get("id")
                    task_id = data.get("suno_task_id")
                    created_ids.append(tid)
                    successes += 1
                    w(f"[{i:02d}/20] OK id={tid} suno_task={task_id} title={data.get('title')!r}")
                else:
                    failures += 1
                    w(f"[{i:02d}/20] FAIL http={r.status_code} body={r.text[:200]}")
            except Exception as e:
                failures += 1
                w(f"[{i:02d}/20] EXC {e}")
            # 5 secondi tra chiamate come richiesto
            if i < len(PROMPTS):
                await asyncio.sleep(5)

    w(f"\n=== SUMMARY ===")
    w(f"Successes: {successes}/20")
    w(f"Failures:  {failures}/20")
    w(f"Created IDs: {created_ids}")

    # Marca priority='high' + tag='summer_it' su tutti i brani creati
    if created_ids:
        os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
        os.environ.setdefault("DB_NAME", "test_database")
        from motor.motor_asyncio import AsyncIOMotorClient
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
        r = await c.tracks.update_many(
            {"id": {"$in": created_ids}},
            {"$set": {"priority": "high", "tags": ["summer_it", "italiano"], "playlist_batch": "summer_2026"}},
        )
        w(f"Marked {r.modified_count} tracks as priority=high, tag=summer_it")

    log.close()


if __name__ == "__main__":
    asyncio.run(main())
