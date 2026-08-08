"""One-shot: RESTYLING STAFF DJ (Leo, Aria, Max).
1. Purga dal DB tutti i DJ che non sono LEO/ARIA/MAX.
2. Genera 3 avatar fotorealistici con Gemini Nano Banana (EMERGENT_LLM_KEY).
3. Salva le immagini in /app/frontend/public/dj-avatars/.
4. Upsert dei 3 DJ nel DB con personality magnetica + avatar_url + provider/model.

Uso: cd /app/backend && python -m scripts.restyle_dj_staff
"""
from __future__ import annotations
import asyncio
import base64
import logging
import os
import sys
from pathlib import Path
from datetime import datetime, timezone

from dotenv import load_dotenv

sys.path.insert(0, "/app/backend")
load_dotenv("/app/backend/.env")

from emergentintegrations.llm.chat import LlmChat, UserMessage
from motor.motor_asyncio import AsyncIOMotorClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")
logger = logging.getLogger("restyle")

AVATARS_DIR = Path("/app/frontend/public/dj-avatars")
AVATARS_DIR.mkdir(parents=True, exist_ok=True)

DJ_SPECS = {
    "Leo": {
        "voice_key": "male-1",
        "llm_provider": "openai",
        "llm_model": "gpt-5.2",
        "accent_color": "#00e5ff",
        "personality": (
            "Filosofo del microfono. Cinquant'anni di dischi ascoltati e nessuna risposta ancora troppo semplice. "
            "Voce calda, calma, e un'ironia mediterranea che fa riflettere tra un giro di jazz e una citazione di Camus."
        ),
        "prompt": (
            "Photorealistic cinematic portrait, cyberpunk-elegant style. "
            "Wise Mediterranean man in his 50s, distinguished silver-streaked dark hair, deep insightful brown eyes, "
            "subtle warm smile, wearing a dark tailored jacket. "
            "Setting: warm-lit vintage radio broadcast booth, walls covered with old vinyl records, "
            "translucent holographic screens floating around him showing sound waveforms and star maps. "
            "Cinematic lighting with moody amber and deep blue tones, shallow depth of field, "
            "futuristic yet timeless atmosphere, hyper-detailed, 85mm lens look."
        ),
    },
    "Aria": {
        "voice_key": "female-1",
        "llm_provider": "anthropic",
        "llm_model": "claude-sonnet-4-5-20250929",
        "accent_color": "#c084fc",
        "personality": (
            "Voce del futuro. Sa dove finisce l'universo e da dove parte la prossima galassia. "
            "Curiosa come una bambina, precisa come un'astrofisica. La sua meraviglia è contagiosa."
        ),
        "prompt": (
            "Photorealistic ethereal cyberpunk portrait, dreamlike sci-fi style. "
            "Young woman in her mid-20s, delicate porcelain skin, luminous eyes, "
            "her hair made of flowing strands of light with a blue-purple gradient glowing softly, "
            "wearing translucent ethereal silk-like robes. "
            "Setting: floating in a deep space nebula, stars and distant galaxies behind her, "
            "cosmic dust particles catching light, subtle lens flares. "
            "Cinematic sci-fi lighting, cyan and violet color palette, hyper-detailed skin texture, "
            "otherworldly beauty, 85mm portrait lens."
        ),
    },
    "Max": {
        "voice_key": "male-3",
        "llm_provider": "gemini",
        "llm_model": "gemini-3-flash-preview",
        "accent_color": "#ff2d95",
        "personality": (
            "Cinico di talento. Se hai un problema tecnico, Max l'ha già visto. "
            "Sguardo furbo, battuta pronta, zero pazienza per le mezze verità. Se cerchi risposte crude, sei nel posto giusto."
        ),
        "prompt": (
            "Photorealistic cinematic cyberpunk street portrait. "
            "Young man late 20s with a cunning cynical smirk, sharp intelligent eyes with a hint of mischief, "
            "short modern dark hair, wearing modern premium over-ear headphones and a black leather jacket. "
            "Setting: gritty urban tech den, surrounded by tangled cables, exposed circuit boards, "
            "custom mechanical keyboards, multiple glowing monitors in the background showing code streams, "
            "neon signs in magenta and cyan bleeding through the darkness. "
            "Moody cinematic lighting, high contrast, hyper-detailed, gritty texture, 50mm lens."
        ),
    },
}


async def generate_avatar(name: str, prompt: str) -> Path | None:
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        logger.error("EMERGENT_LLM_KEY mancante")
        return None
    chat = LlmChat(
        api_key=api_key,
        session_id=f"dj-avatar-{name.lower()}-{int(datetime.now().timestamp())}",
        system_message="You are an expert cinematic character portrait artist.",
    )
    chat.with_model("gemini", "gemini-3.1-flash-image-preview").with_params(modalities=["image", "text"])
    logger.info(f"[{name}] Nano Banana generating…")
    try:
        text, images = await chat.send_message_multimodal_response(UserMessage(text=prompt))
    except Exception as e:  # noqa: BLE001
        logger.error(f"[{name}] Nano Banana error: {e}")
        return None
    if not images:
        logger.error(f"[{name}] no images returned; text={(text or '')[:100]}")
        return None
    img = images[0]
    dest = AVATARS_DIR / f"{name.lower()}.png"
    dest.write_bytes(base64.b64decode(img["data"]))
    logger.info(f"[{name}] saved {dest} ({dest.stat().st_size:,} bytes)")
    return dest


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    # STEP 1: Purge DJ that are not Leo/Aria/Max
    keep = list(DJ_SPECS.keys())
    result = await db.djs.delete_many({"name": {"$nin": keep}})
    logger.info(f"[PURGE] deleted {result.deleted_count} DJs (kept only {keep})")

    # STEP 2: Generate the 3 avatars in parallel
    tasks = {name: generate_avatar(name, spec["prompt"]) for name, spec in DJ_SPECS.items()}
    paths = await asyncio.gather(*tasks.values())
    avatar_paths = dict(zip(tasks.keys(), paths))

    # STEP 3: Upsert Leo/Aria/Max in DB with new avatar + personality
    from uuid import uuid4
    for name, spec in DJ_SPECS.items():
        path = avatar_paths.get(name)
        if not path:
            logger.warning(f"[{name}] no avatar generated — keeping DB record without avatar update")
        avatar_url = f"/dj-avatars/{name.lower()}.png?v={int(datetime.now().timestamp())}" if path else None
        update = {
            "name": name,
            "personality": spec["personality"],
            "voice_key": spec["voice_key"],
            "llm_provider": spec["llm_provider"],
            "llm_model": spec["llm_model"],
            "accent_color": spec["accent_color"],
        }
        if avatar_url:
            update["avatar_url"] = avatar_url
        existing = await db.djs.find_one({"name": name})
        if existing:
            await db.djs.update_one({"name": name}, {"$set": update})
            logger.info(f"[UPSERT] {name}: updated existing DB record")
        else:
            update["id"] = str(uuid4())
            update["created_at"] = datetime.now(timezone.utc).isoformat()
            await db.djs.insert_one(update)
            logger.info(f"[UPSERT] {name}: inserted new DB record")

    total = await db.djs.count_documents({})
    logger.info(f"=== DONE. DB djs count: {total} ===")


if __name__ == "__main__":
    asyncio.run(main())
