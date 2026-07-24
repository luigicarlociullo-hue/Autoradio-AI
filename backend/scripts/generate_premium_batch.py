"""BATCH PREMIUM: 20 canzoni con testi ORIGINALI, mai ripetitivi.
- 5 pop italiane autorali (Elodie/Annalisa moderna con testo di livello)
- 5 pop inglesi (Lorde/Frank Ocean/Bowie style, storia concreta)
- 5 trap commerciale italiana (Sfera/Lazza/Rhove ma con testo di qualita')
- 5 dance-pop inglesi con testo autorale

Passa lean=false, premium=true → prompt LLM sblocca la modalita' autorale.
Ritira le tracce precedenti mal-generate.
"""
import asyncio, httpx, os
from datetime import datetime

API = "http://localhost:8001"
LOG = "/app/backend/scripts/premium_batch.log"

# Prompt Suno = stile (mai testo, il testo lo genera il nostro LLM in modalita' premium)
PROMPTS = [
    # === POP ITALIANE AUTORALI (5) ===
    ("pop italiano cinematico 96 bpm, chitarra elettrica e archi, voce femminile intensa, produzione radio hit 2025", "pop italiano autorale 96 bpm", "it"),
    ("pop italiano moderno 104 bpm, synth analogici e batteria live, voce maschile tesa, arrangiamento sofisticato", "pop italiano 104 bpm", "it"),
    ("pop italiano indie 92 bpm, pianoforte e beat vintage, voce femminile intimista, mood malinconico ma ballabile", "indie pop italiano 92 bpm", "it"),
    ("pop italiano elettronico 108 bpm, cori stratificati e bass sintetico, voce androgina, sound cinematografico", "electro pop italiano 108 bpm", "it"),
    ("pop italiano funk 106 bpm, basso groovy e archi, voce femminile potente, produzione radio internazionale", "pop funk italiano 106 bpm", "it"),

    # === POP INGLESI AUTORALI (5) ===
    ("indie pop 100 bpm, warm analog synths lush production, male vocal storyteller style, cinematic bridge, radio hit 2025", "indie pop en 100 bpm", "en"),
    ("art pop 92 bpm, layered vocal harmonies experimental production, female lead like Lorde, moody but danceable", "art pop en 92 bpm", "en"),
    ("alt pop 108 bpm, punchy drums and shimmering guitars, androgynous vocal, emotionally charged chorus", "alt pop en 108 bpm", "en"),
    ("pop rock 110 bpm, distorted guitars and driving beat, male vocal with grit, huge chorus radio-ready", "pop rock en 110 bpm", "en"),
    ("dream pop 95 bpm, reverb heavy female vocal, dreamy synths and slow build, cinematic outro", "dream pop en 95 bpm", "en"),

    # === TRAP COMMERCIALE ITALIANA (5) ===
    ("trap italiano commerciale 130 bpm dark 808 e hi-hat rullanti, voce maschile autotune leggero, storytelling street ma raffinato", "trap italiano commerciale 130 bpm", "it"),
    ("trap italiano melodico 140 bpm, piano trap e 808, voce femminile con autotune, mood malinconico romantico", "trap melodica italiana 140 bpm", "it"),
    ("trap italiano moderno 128 bpm, sample orchestrale e 808 pulite, voce maschile flow tecnico, produzione USA", "trap moderna italiana 128 bpm", "it"),
    ("drill italiano commerciale 145 bpm UK style drums, voce maschile ritmica, atmosfera notturna urbana", "drill italiano 145 bpm", "it"),
    ("trap italiano radio hit 132 bpm, coretti melodici e beat pulito, voce con vocal chop, refrain di forte impatto emotivo", "trap italiano radio 132 bpm", "it"),

    # === DANCE POP INGLESI AUTORALI (5) ===
    ("dance pop 118 bpm euphoric synth lead, female vocal storytelling, cinematic build to drop, radio anthem", "dance pop en 118 bpm", "en"),
    ("electro pop 122 bpm arpeggiated synths and punchy drums, male vocal emotional, big chorus", "electro pop en 122 bpm", "en"),
    ("nu-disco 115 bpm groovy bass and funky guitar, female vocal soulful, sophisticated arrangement", "nu-disco en 115 bpm", "en"),
    ("synth pop 116 bpm 80s inspired but modern production, male vocal reflective, atmospheric bridge", "synth pop en 116 bpm", "en"),
    ("indie dance 120 bpm live drums and analog synth, androgynous vocal, dynamic arrangement builds and breaks", "indie dance en 120 bpm", "en"),
]


async def main():
    f = open(LOG, "w")
    def log(m):
        line = f"[{datetime.now().isoformat(timespec='seconds')}] {m}"
        print(line); f.write(line + "\n"); f.flush()

    # 1) Ritira le tracce lean-v1 problematiche (english_pop_dance)
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "test_database")
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    ret = await db.tracks.update_many(
        {"tags": "english_pop_dance", "status": {"$ne": "retired"}},
        {"$set": {"status": "retired", "retired_reason": "lean_v1_replaced_by_premium"}},
    )
    log(f"Ritirate {ret.modified_count} tracce lean-v1 (english_pop_dance)")

    # 2) Genera batch premium
    created = []; ok = 0; fail = 0
    async with httpx.AsyncClient(timeout=120) as c:
        for i, (hint, genre, lang) in enumerate(PROMPTS, 1):
            try:
                r = await c.post(f"{API}/api/tracks/generate",
                                 params={"hint": hint, "genre": genre, "lang": lang, "premium": "true"})
                if r.status_code == 200:
                    d = r.json(); created.append(d["id"]); ok += 1
                    log(f"[{i:02d}/{len(PROMPTS)}] OK id={d['id']} title={d.get('title')!r}")
                else:
                    fail += 1; log(f"[{i:02d}/{len(PROMPTS)}] FAIL {r.status_code} {r.text[:200]}")
            except Exception as e:
                fail += 1; log(f"[{i:02d}/{len(PROMPTS)}] EXC {e}")
            if i < len(PROMPTS):
                await asyncio.sleep(5)

    log(f"\n=== ok={ok}/{len(PROMPTS)} fail={fail}/{len(PROMPTS)}")

    if created:
        r = await db.tracks.update_many(
            {"id": {"$in": created}},
            {"$set": {
                "priority": "high",
                "tags": ["premium_batch_2026_02", "high_rotation"],
                "playlist_batch": "premium_2026_02",
                "rotation_weight": 3,
            }},
        )
        log(f"Marked {r.modified_count} premium tracks high priority")

    f.close()


if __name__ == "__main__":
    asyncio.run(main())
