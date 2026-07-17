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
    "italian folk fusion opening with 10 seconds of PURE traditional salento tamburello "
    "solo (no other instruments, just tambourine and hand percussion, folk pizzica style), "
    "then gradually introduce electronic elements — sub bass, synth pad, kick drum — "
    "building into a powerful modern EDM anthem drop while the tamburello stays as the "
    "rhythmic backbone. Cinematic build, big room drop, hybrid folk-electronic, "
    "energetic 128 bpm on the drop. SPARSE VOCALS, chant-style, only the shouted "
    "phrases 'R-A-I' and 'Created by L and C' as anthemic hooks."
)

# Essential-only lyrics: chant/hook based, tamburello-first, very sparse
LYRICS = """[Intro — 10 seconds of PURE tamburello solo, no other instruments, no vocals]
(solo tamburello salentino tradizionale, mani sui bordi, ritmo pizzica 6/8)

[Build-up — synth pad enters slowly, sub bass rises under the tamburello]
(instrumental, il tamburello resta protagonista)

[Pre-Drop — one whispered chant]
R... A... I...

[Drop — Big Room EDM + tamburello, chant hook]
R-A-I!
R-A-I!
Created by L and C!
R-A-I!

[Break — tamburello solo returns for 4 bars]
(strumentale, solo tamburello + kick lontano)

[Drop 2 — full EDM + tamburello]
R-A-I!
R-A-I!
Created by L and C!
R-A-I!

[Outro — fade back to pure tamburello]
R-A-I... R-A-I..."""


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
