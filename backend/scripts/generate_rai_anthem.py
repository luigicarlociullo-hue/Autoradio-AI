"""Generate the official R-A.I. anthem: Pizzica Salentina → modern EDM.
Title: "R-AI" · Subtitle: "Created by L&C" · Domain: r-ai.it
Marked with is_anthem=True so the segment engine forces it every ~6 music slots.
"""
import asyncio
import sys
import os
from datetime import datetime
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv
load_dotenv(BACKEND_DIR / ".env")

from motor.motor_asyncio import AsyncIOMotorClient
import httpx
import suno_service
import uuid

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
SUNO_AUDIO_DIR = Path("/app/backend/static/suno")
SUNO_AUDIO_DIR.mkdir(parents=True, exist_ok=True)

TITLE = "R-AI"
ARTIST = "L&C"
GENRE_STYLE = (
    "italian folk fusion, pizzica salentina traditional opening with tamburello and violin, "
    "gradually morphing into modern electronic dance music, powerful anthem, "
    "hybrid folk-EDM, southern italian tarantella into big room drop, "
    "energetic 128 bpm, cinematic build-up, epic climax"
)

# Full-structure lyrics: parte con la tradizione salentina, cresce in EDM
LYRICS = """[Intro - Tamburello + Violino Tradizionale]
Ohi lì, ohi là, la notte non dorme mai
Tra gli ulivi del sud si accende una radio che va
Ohi lì, ohi là, la voce è la mia
R-A.I. r-ai punto it, la casa mia

[Verse 1 - Pizzica classica]
Balla balla nella piazza, sotto il campanile
Il tamburello canta, il tempo è già passato ieri
Nonna diceva pizzica pizzica finché puoi
Perché la vita è breve, la festa la scegli tu
Neuroni digitali dentro una tarantella
La macchina ha imparato il ritmo della tradizione
Suona suona, non ti fermare
Il Salento è nel codice, il codice è mare

[Pre-Chorus - Il synth entra piano]
Sento salire una vibrazione
Il violino diventa un synth di ragione
Il tamburello è una cassa che sale
R-A.I. sta per partire, tienti forte

[Drop - EDM Big Room + Tamburello]
R-A-I! R-A-I!
La radio del futuro che parla italiano
R-A-I! R-A-I!
Dalla pizzica al drop, dalla piazza al mondo
R-A-I! R-A-I!
Created by L and C, streaming da r-ai.it
R-A-I! R-A-I!
Balla con noi, l'intelligenza balla con noi

[Verse 2 - Hybrid folk-electronic]
Boombox sotto un ulivo secolare
Un DJ artificiale con l'anima salentina
Nonna balla ancora, ma stavolta col laser
Il synthesizer canta con la voce del mare
Otranto illumina la costa in stereo
Ogni onda un beat, ogni beat una preghiera
La tradizione non muore, si trasforma in luce
Il codice ha imparato a suonare il Sud

[Pre-Chorus - Build up]
Sento salire l'energia più grande
Il tamburo si sposa col sub bass
Le luci del rave sono lucciole antiche
R-A-I sta arrivando, alza il volume

[Drop - EDM esplosivo con pizzica sample]
R-A-I! R-A-I!
La radio del futuro che parla italiano
R-A-I! R-A-I!
Dalla pizzica al drop, dalla piazza al mondo
R-A-I! R-A-I!
Created by L and C, streaming da r-ai.it
R-A-I! R-A-I!
Balla con noi, l'intelligenza balla con noi

[Bridge - Solo di tamburello che dialoga col synth]
Uno tamburo, un algoritmo
Un cuore antico, un cuore ritmo
Non è nostalgia, è evoluzione
R-A-I la nuova generazione

[Outro - Ritorno alla pizzica pura + fade]
Ohi lì, ohi là, la notte non dorme mai
La radio è accesa, la festa non finirà
R-A-I punto it, R-A-I punto it
Il futuro è già qui, e balla con te"""


async def download_mp3(url: str, dest: Path) -> bool:
    try:
        async with httpx.AsyncClient(timeout=240, follow_redirects=True) as h:
            r = await h.get(url)
            r.raise_for_status()
            dest.write_bytes(r.content)
        return True
    except Exception as e:
        print(f"download failed: {e}", flush=True)
        return False


async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    # Se esiste già un anthem, sostituisci il file ma tieni lo stesso id (ricircolo)
    existing = await db.tracks.find_one({"is_anthem": True}, {"_id": 0, "id": 1})
    track_id = existing["id"] if existing else str(uuid.uuid4())
    print(f"track_id = {track_id}  (existing_anthem={existing is not None})")

    print("\n[1/3] Submitting Suno task with Pizzica → EDM lyrics + style…", flush=True)
    task_id = await suno_service.create_task(
        prompt=f"{TITLE} — {ARTIST}. {GENRE_STYLE}",
        style=GENRE_STYLE,
        title=TITLE,
        instrumental=False,
        custom_lyrics=LYRICS,
    )
    if not task_id:
        print("❌ Suno submit failed", flush=True)
        return
    print(f"    task_id = {task_id}", flush=True)

    print("\n[2/3] Polling Suno (up to 6 min)…", flush=True)
    song = await suno_service.poll_task(task_id, timeout_sec=420, interval_sec=10)
    if not song or not song.get("audio_url"):
        print("❌ Suno render failed", flush=True)
        return
    suno_url = song["audio_url"]
    print(f"    ready: {suno_url}", flush=True)

    print("\n[3/3] Downloading + saving anthem in Mongo…", flush=True)
    local_name = f"track_{track_id}.mp3"
    local_path = SUNO_AUDIO_DIR / local_name
    if local_path.exists():
        local_path.unlink()
    if not await download_mp3(suno_url, local_path):
        return
    local_url = f"/api/suno_audio/{local_name}"

    now_iso = datetime.utcnow().isoformat()
    anthem_doc = {
        "id": track_id,
        "title": TITLE,
        "artist": ARTIST,
        "genre": GENRE_STYLE,
        "mood": "anthem, epic, folk-electronic, italian southern",
        "lyrics_excerpt": LYRICS,
        "duration_sec": int(song.get("duration") or 180),
        "llm_provider": "hand-written",
        "cover_seed": "rai-anthem-official",
        "audio_url": local_url,
        "original_audio_url": suno_url,
        "downloaded_at": now_iso,
        "image_url": song.get("image_url"),
        "source": "suno",
        "is_anthem": True,
        "suno_task_id": task_id,
        "status": "ready",
        "created_at": now_iso,
        "last_played_at": None,
    }
    if existing:
        await db.tracks.update_one({"id": track_id}, {"$set": anthem_doc})
    else:
        await db.tracks.insert_one(anthem_doc)
    size = local_path.stat().st_size
    print(f"\n✅ ANTHEM READY — {TITLE} by {ARTIST}", flush=True)
    print(f"    local: {local_path} ({size:,} bytes)")
    print(f"    url:   {local_url}")
    print(f"    id:    {track_id}")
    print(f"    is_anthem: True → il segment engine la suonerà ogni ~6 music slots")


if __name__ == "__main__":
    asyncio.run(main())
