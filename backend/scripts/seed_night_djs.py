"""
Seed dei 3 DJ notturni per Club Night 22:00-04:00.
Genera avatar cyberpunk clubbing con Nano Banana e li registra sul DB.

Slot:
  1 · 22:00-00:00 → NYX (techno cinematica, voice_key=female-2)
  2 · 00:00-02:00 → HEX (dark synth / industrial, voice_key=male-2)
  3 · 02:00-04:00 → LUMA (ambient / afterhours, voice_key=female-1)
"""
import asyncio
import base64
import os
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from emergentintegrations.llm.chat import LlmChat, UserMessage

load_dotenv(Path(__file__).parent.parent / ".env")

API_KEY = os.getenv("EMERGENT_LLM_KEY")
MONGO_URL = os.getenv("MONGO_URL")
DB_NAME = os.getenv("DB_NAME")
OUT_DIR = Path("/app/frontend/public/djs")
OUT_DIR.mkdir(parents=True, exist_ok=True)

STYLE = (
    "Cinematic square portrait, ultra-detailed, cyberpunk clubbing aesthetic. "
    "Dominant electric blue (#00BFFF) neon rim-light with warm orange accents (#FF6B1A). "
    "Deep black background. Subtle CRT scanlines, volumetric fog, holographic hi-tech "
    "wearable devices. Sharp facial features. No text, no letters, no logos, no watermarks."
)

NIGHT_DJS = [
    {
        "name": "NYX",
        "night_slot": 1,
        "voice_key": "female-2",
        "personality": "Techno cinematica, ipnotica. Voce grave e ritmica, come una regina della notte che apre le porte del club.",
        "llm_provider": "openai", "llm_model": "gpt-5.2",
        "accent_color": "#00E5FF",
        "prompt": (
            "Portrait of NYX, a mysterious female techno DJ, mid-30s, sharp jawline, "
            "wet-look black hair, glowing cyan neural implants on temple, sleek black "
            "leather high-collar jacket, standing behind a modular synth console glowing blue. "
            f"Blue rim light dominant, orange LED flashes from side. {STYLE}"
        ),
    },
    {
        "name": "HEX",
        "night_slot": 2,
        "voice_key": "male-2",
        "personality": "Dark synth industrial. Voce ruvida, sarcastica, distorta. Il ragazzo del ferro e del glitch delle 2 di notte.",
        "llm_provider": "anthropic", "llm_model": "claude-sonnet-4.5",
        "accent_color": "#FF6B1A",
        "prompt": (
            "Portrait of HEX, a male industrial-techno DJ, late-20s, buzz-cut with shaved "
            "circuit patterns, chrome septum piercing, tactical dark jacket with orange "
            "LED strips at collar, holographic AR visor half-covering left eye, standing "
            "in a foggy dark warehouse club. Deep blue with strong orange side-light. "
            f"{STYLE}"
        ),
    },
    {
        "name": "LUMA",
        "night_slot": 3,
        "voice_key": "female-1",
        "personality": "Ambient afterhours. Voce sussurrata, lenta, sensuale. La DJ che ti tiene compagnia mentre il resto del mondo dorme.",
        "llm_provider": "gemini", "llm_model": "gemini-3-flash",
        "accent_color": "#7FA9FF",
        "prompt": (
            "Portrait of LUMA, a female ambient DJ, late-20s, long silver-blue holographic "
            "hair, dreamy expression, soft eye makeup with cyan glow tears, translucent "
            "cyber-silk hoodie with subtle circuit patterns, hands gently on a glowing "
            "vinyl-laser deck. Cold blue moonlight with warm orange candle glow from side. "
            f"{STYLE}"
        ),
    },
]


async def gen_avatar(dj):
    print(f"[{dj['name']}] generating avatar…")
    chat = LlmChat(api_key=API_KEY, session_id=f"dj-night-{dj['name']}", system_message="Portrait generator")
    chat.with_model("gemini", "gemini-3.1-flash-image-preview").with_params(modalities=["image", "text"])
    msg = UserMessage(text=dj["prompt"])
    _text, images = await chat.send_message_multimodal_response(msg)
    if not images:
        print(f"[{dj['name']}] NO IMAGE — skipping avatar")
        return None
    out = OUT_DIR / f"night-{dj['name'].lower()}.png"
    out.write_bytes(base64.b64decode(images[0]["data"]))
    print(f"[{dj['name']}] avatar saved ({out.stat().st_size // 1024} KB)")
    return f"/djs/night-{dj['name'].lower()}.png"


async def seed_one(db, dj):
    avatar_url = await gen_avatar(dj)
    doc = {
        "name": dj["name"],
        "personality": dj["personality"],
        "voice_key": dj["voice_key"],
        "llm_provider": dj["llm_provider"],
        "llm_model": dj["llm_model"],
        "avatar_url": avatar_url,
        "accent_color": dj["accent_color"],
        "night_slot": dj["night_slot"],
    }
    existing = await db.djs.find_one({"name": dj["name"]})
    if existing:
        await db.djs.update_one({"name": dj["name"]}, {"$set": doc})
        print(f"[{dj['name']}] UPDATED (slot {dj['night_slot']})")
    else:
        import uuid
        from datetime import datetime, timezone
        doc["id"] = str(uuid.uuid4())
        doc["created_at"] = datetime.now(timezone.utc).isoformat()
        await db.djs.insert_one(doc)
        print(f"[{dj['name']}] CREATED (slot {dj['night_slot']})")


async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    # Genera avatar in parallelo, poi salva su DB seriale
    await asyncio.gather(*(seed_one(db, dj) for dj in NIGHT_DJS))
    print("---")
    for d in await db.djs.find({"night_slot": {"$ne": None}}, {"_id": 0, "name": 1, "night_slot": 1}).to_list(10):
        print(f" ✔ {d['name']} · slot {d['night_slot']}")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
