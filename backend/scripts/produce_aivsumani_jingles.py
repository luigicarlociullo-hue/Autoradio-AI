"""One-shot script: produce i 2 jingle "A.I. Vs Umani" (intro + outro).
- Suno: 2 basi strumentali 15s (tech-electronic, groovy-chill)
- OpenAI TTS-1-HD: 2 voci (nova=intro, shimmer=outro)
- ffmpeg: overla voce su base (musica -12dB, voce 0dB), taglia a 15s
- Salva su /app/backend/static/community/community_jingle_intro.mp3 (e outro)
- Aggiorna station.state URLs
- Salva anche su Object Storage se attivo

Uso: cd /app/backend && python -m scripts.produce_aivsumani_jingles
"""
from __future__ import annotations
import asyncio
import logging
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import httpx
from dotenv import load_dotenv

# Bootstrap: aggiungi /app/backend a sys.path per gli import
sys.path.insert(0, "/app/backend")

load_dotenv("/app/backend/.env")

import suno_service
import elevenlabs_service
import object_storage
from motor.motor_asyncio import AsyncIOMotorClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("aivsumani")

COMM_DIR = Path("/app/backend/static/community")
COMM_DIR.mkdir(parents=True, exist_ok=True)

INTRO_TEXT = (
    "State ascoltando A-I Versus Umani. La rubrica dove i talenti della nostra community sfidano l'intelligenza artificiale. "
    "Inviaci anche tu il tuo brano dal pulsante in Home!"
)
OUTRO_TEXT = (
    "Per ora la sfida si ferma qui. A-I Versus Umani torna più tardi. Amico umano, rimani con noi su R-A-I!"
)

INTRO_PROMPT = "Short radio ident sting, tech-electronic, futuristic synth pluck, driving 4/4 kick, uplifting energy, no vocals, 15 seconds"
INTRO_STYLE = "tech-electronic, futuristic, synth, radio ident, instrumental"
OUTRO_PROMPT = "Short radio outro sting, groovy chill lo-fi hop, mellow rhodes keys, laid-back kick, warm bass, no vocals, 15 seconds"
OUTRO_STYLE = "groovy chill, lo-fi, mellow, radio outro, instrumental"


async def download(url: str, dest: Path) -> bool:
    async with httpx.AsyncClient(timeout=120, follow_redirects=True) as c:
        r = await c.get(url)
        if r.status_code != 200 or len(r.content) < 5000:
            logger.error(f"Download failed {url}: {r.status_code} len={len(r.content)}")
            return False
        dest.write_bytes(r.content)
        return True


def mix_voice_over_music(voice_path: Path, music_path: Path, out_path: Path, duration_sec: int = 15) -> bool:
    """ffmpeg: musica loop se corta, taglio a `duration_sec`, musica a -12dB
    con leggero fade-in 0.5s / fade-out 1.5s. Voce full-volume normalizzata.
    Output: MP3 128 kbps."""
    filter_complex = (
        # Musica: prendi solo i primi `duration_sec` secondi, applica volume + fade
        f"[0:a]atrim=0:{duration_sec},asetpts=PTS-STARTPTS,volume=0.30,"
        f"afade=t=in:st=0:d=0.3,afade=t=out:st={duration_sec-1.5}:d=1.5[music];"
        # Voce: normalizza a -1dB peak (loudnorm-lite), pad silenzio finale se serve
        f"[1:a]loudnorm=I=-14:LRA=8:TP=-1.5,apad=pad_dur=1[voice];"
        # Mix con weights: voce protagonista, musica di sfondo
        f"[music][voice]amix=inputs=2:duration=first:weights=1 1.6:dropout_transition=0,"
        f"atrim=0:{duration_sec},asetpts=PTS-STARTPTS[out]"
    )
    cmd = [
        "ffmpeg", "-y",
        "-i", str(music_path),
        "-i", str(voice_path),
        "-filter_complex", filter_complex,
        "-map", "[out]",
        "-c:a", "libmp3lame", "-b:a", "128k",
        "-ar", "44100", "-ac", "2",
        str(out_path),
    ]
    logger.info(f"ffmpeg mix → {out_path.name}")
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
    if result.returncode != 0:
        logger.error(f"ffmpeg failed: {result.stderr[-500:]}")
        return False
    logger.info(f"✓ mix ok: {out_path} ({out_path.stat().st_size:,} bytes)")
    return True


async def produce_jingle(role: str, prompt: str, style: str, voice_key: str, tts_text: str) -> str | None:
    """Produce un singolo jingle. Ritorna il path locale finale o None."""
    logger.info(f"[{role}] STEP 1: Suno base '{style}'…")
    suno_result = await suno_service.generate_song(
        prompt, style=style, title=f"A.I. Vs Umani {role.upper()}",
        instrumental=True,
    )
    if not suno_result or not suno_result.get("audio_url"):
        logger.error(f"[{role}] Suno FAILED")
        return None
    music_url = suno_result["audio_url"]
    logger.info(f"[{role}] Suno OK: {music_url}")

    with tempfile.TemporaryDirectory() as td:
        tdp = Path(td)
        music_tmp = tdp / f"{role}_music.mp3"
        voice_tmp = tdp / f"{role}_voice.mp3"

        # Download music
        if not await download(music_url, music_tmp):
            return None

        # Generate TTS
        logger.info(f"[{role}] STEP 2: OpenAI TTS-1-HD voice={voice_key}…")
        voice_bytes = await elevenlabs_service._synth_openai(tts_text, voice_key)
        if not voice_bytes:
            logger.error(f"[{role}] TTS FAILED")
            return None
        voice_tmp.write_bytes(voice_bytes)
        logger.info(f"[{role}] TTS OK: {len(voice_bytes):,} bytes")

        # Mix con ffmpeg
        logger.info(f"[{role}] STEP 3: ffmpeg mix…")
        final_name = f"community_jingle_{role}.mp3"
        final_path = COMM_DIR / final_name
        if not mix_voice_over_music(voice_tmp, music_tmp, final_path, duration_sec=15):
            return None

    # Object Storage push
    try:
        if object_storage.is_enabled():
            data = final_path.read_bytes()
            await object_storage.put_mp3(f"community/{final_name}", data)
            logger.info(f"[{role}] Object Storage push OK")
    except Exception as e:
        logger.warning(f"[{role}] objstore push failed: {e}")

    return f"/api/community_jingle/{final_name}"


async def main():
    if not suno_service.is_enabled():
        logger.error("Suno non configurato (SUNO_API_KEY mancante)")
        return
    logger.info("=== PRODUZIONE JINGLE A.I. VS UMANI ===")

    # Genera in parallelo per risparmiare tempo (Suno = 60-90s ciascuno)
    intro_task = produce_jingle("intro", INTRO_PROMPT, INTRO_STYLE, "female-1", INTRO_TEXT)
    outro_task = produce_jingle("outro", OUTRO_PROMPT, OUTRO_STYLE, "female-2", OUTRO_TEXT)
    intro_url, outro_url = await asyncio.gather(intro_task, outro_task)

    if not intro_url and not outro_url:
        logger.error("Entrambi i jingle FAILED — nessuna scrittura DB")
        return

    # Aggiorna station.state con URLs
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    update = {}
    if intro_url:
        update["community_intro_jingle_url"] = intro_url
    if outro_url:
        update["community_outro_jingle_url"] = outro_url
    await db.station.update_one({"_id": "state"}, {"$set": update}, upsert=True)
    logger.info(f"✓ station.state aggiornato: {update}")
    logger.info(f"=== FATTO ===")
    logger.info(f"Intro: {intro_url or 'FAILED'}")
    logger.info(f"Outro: {outro_url or 'FAILED'}")


if __name__ == "__main__":
    asyncio.run(main())
