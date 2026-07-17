"""Rewrite the last 5 Italian-trap tracks with full-structure lyrics and re-render on Suno.

Usage:
    cd /app/backend && python -m scripts.regen_trap_lyrics
"""
import asyncio
import sys
import os
from pathlib import Path

# Make sibling modules importable
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv
load_dotenv(BACKEND_DIR / ".env")

from motor.motor_asyncio import AsyncIOMotorClient
from emergentintegrations.llm.chat import LlmChat, UserMessage
import suno_service

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
EMERGENT_LLM_KEY = os.environ["EMERGENT_LLM_KEY"]
SUNO_AUDIO_DIR = Path("/app/backend/static/suno")

# The 5 tracks we just generated (from the previous ask_human batch)
TRACK_ID_PREFIXES = [
    "caae0af2",  # Silicio Blu — italian commercial trap pop 140 bpm
    "003b9f74",  # Piove RAM — italian trap pop 135 bpm summer
    "71962f7f",  # Marte in Do minore — italian melodic trap 138 bpm romantic
    "784f449d",  # Neon Rivière — italian urban pop trap 142 bpm
    "3b3e062a",  # Ecolalia — italian trap ballad 130 bpm cinematic
]

SYSTEM_PROMPT = (
    "Sei un paroliere italiano specializzato in trap/pop commerciale. "
    "Scrivi solo in italiano, con slang trap moderno autentico, metafore originali "
    "(niente cliché), rime interne ed esterne, storytelling concreto legato alla vita "
    "italiana. Rispondi SOLO con il testo della canzone, niente commenti."
)


def user_prompt(title: str, artist: str, genre: str, mood: str) -> str:
    return (
        f"Scrivi il testo completo di una canzone trap italiana commerciale.\n"
        f"Titolo: \"{title}\"\n"
        f"Artista: {artist}\n"
        f"Genere/Stile: {genre}\n"
        f"Mood: {mood or 'moderno, radio-ready'}\n\n"
        "STRUTTURA OBBLIGATORIA (usa esattamente questi tag tra parentesi quadre):\n"
        "[Intro] 2-4 righe atmosferiche che presentano il tema\n"
        "[Verse 1] 8-12 righe con storia concreta, rime ABAB o AABB, metafore, "
        "riferimenti alla vita di strada italiana\n"
        "[Pre-Chorus] 4 righe di build-up emotivo\n"
        "[Chorus] 6-8 righe con il messaggio centrale, memorabile e ripetibile\n"
        "[Verse 2] 8-12 righe DIVERSE dal Verse 1, prospettiva nuova\n"
        "[Pre-Chorus] 4 righe (leggera variazione del primo)\n"
        "[Chorus] 6-8 righe (leggere variazioni testuali rispetto al primo chorus)\n"
        "[Bridge] 4-6 righe con svolta emotiva, tono diverso\n"
        "[Outro] 4 righe che chiudono richiamando l'intro\n\n"
        "Vincoli: italiano autentico, slang trap moderno (fra', tipa, cash, streetwear, "
        "cintura di sicurezza, gasolina, tetto scoperto, ecc.), rime lavorate, "
        "immagini sensoriali, coerenza con il titolo. Niente inglese salvo qualche "
        "parola comune (yeah, brr, skrrt). Non usare bestemmie o slur."
    )


async def write_lyrics(title: str, artist: str, genre: str, mood: str) -> str:
    """Call Claude Sonnet 4.5 via Emergent to write full-structure trap lyrics."""
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"lyrics-{title.replace(' ', '-')}",
        system_message=SYSTEM_PROMPT,
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")
    msg = UserMessage(text=user_prompt(title, artist, genre, mood))
    resp = await chat.send_message(msg)
    return resp if isinstance(resp, str) else str(resp)


async def download_mp3(url: str, dest: Path) -> bool:
    import httpx
    try:
        async with httpx.AsyncClient(timeout=180, follow_redirects=True) as h:
            r = await h.get(url)
            r.raise_for_status()
            dest.write_bytes(r.content)
        return True
    except Exception as e:
        print(f"      download failed: {e}", flush=True)
        return False


async def regen_one(db, track: dict) -> dict:
    tid = track["id"]
    title = track["title"]
    artist = track["artist"]
    genre = track["genre"]
    mood = track.get("mood", "")

    print(f"\n=== {tid[:8]} · {title} — {artist} ===", flush=True)
    print(f"    genre: {genre}", flush=True)

    print("    [1/4] writing new lyrics with Claude…", flush=True)
    new_lyrics = await write_lyrics(title, artist, genre, mood)
    if not new_lyrics or len(new_lyrics) < 200:
        return {"id": tid, "status": "lyrics_failed", "title": title}
    print(f"    lyrics ok — {len(new_lyrics)} chars, {new_lyrics.count(chr(10))} lines", flush=True)

    # Preview first 240 chars
    preview = new_lyrics[:240].replace("\n", " | ")
    print(f"    preview: {preview}…", flush=True)

    print("    [2/4] submitting Suno task with custom_lyrics…", flush=True)
    task_id = await suno_service.create_task(
        prompt=new_lyrics,
        style=genre,
        title=title,
        instrumental=False,
        custom_lyrics=new_lyrics,
    )
    if not task_id:
        return {"id": tid, "status": "suno_submit_failed", "title": title}
    print(f"    suno taskId: {task_id}", flush=True)

    print("    [3/4] polling Suno (up to 5min)…", flush=True)
    song = await suno_service.poll_task(task_id, timeout_sec=360, interval_sec=10)
    if not song or not song.get("audio_url"):
        return {"id": tid, "status": "suno_render_failed", "title": title, "task_id": task_id}
    suno_url = song["audio_url"]
    print(f"    suno ready: {suno_url}", flush=True)

    print("    [4/4] downloading + updating Mongo…", flush=True)
    local_name = f"track_{tid}.mp3"
    local_path = SUNO_AUDIO_DIR / local_name
    # Remove old file so we don't get idempotent-skip
    if local_path.exists():
        local_path.unlink()
    ok = await download_mp3(suno_url, local_path)
    if not ok:
        return {"id": tid, "status": "download_failed", "title": title, "suno_url": suno_url}
    local_url = f"/api/suno_audio/{local_name}"

    update = {
        "audio_url": local_url,
        "original_audio_url": suno_url,
        "lyrics_excerpt": new_lyrics,
        "suno_task_id": task_id,
        "downloaded_at": __import__("datetime").datetime.utcnow().isoformat(),
    }
    if song.get("duration"):
        update["duration_sec"] = int(song["duration"])
    await db.tracks.update_one({"id": tid}, {"$set": update})
    size = local_path.stat().st_size
    print(f"    ✅ done — {size:,} bytes, mongo updated", flush=True)
    return {"id": tid, "status": "ok", "title": title, "bytes": size}


async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    print("Loading tracks from Mongo…", flush=True)
    tracks = []
    for pfx in TRACK_ID_PREFIXES:
        d = await db.tracks.find_one(
            {"id": {"$regex": f"^{pfx}"}},
            {"_id": 0, "id": 1, "title": 1, "artist": 1, "genre": 1, "mood": 1},
        )
        if d:
            tracks.append(d)
        else:
            print(f"  WARN: no track for prefix {pfx}", flush=True)
    print(f"Found {len(tracks)} tracks to regenerate.", flush=True)

    results = []
    for t in tracks:
        try:
            r = await regen_one(db, t)
        except Exception as e:
            r = {"id": t["id"], "status": "exception", "error": str(e), "title": t["title"]}
        results.append(r)
        # tiny gap so Suno doesn't hammer
        await asyncio.sleep(3)

    print("\n=========== SUMMARY ===========", flush=True)
    ok = [r for r in results if r["status"] == "ok"]
    fail = [r for r in results if r["status"] != "ok"]
    print(f"OK: {len(ok)}/{len(results)}", flush=True)
    for r in ok:
        print(f"  ✅ {r['title']} — {r['bytes']:,} bytes", flush=True)
    for r in fail:
        print(f"  ❌ {r['title']} — {r['status']} {r.get('error','')}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
