"""
Genera 4 immagini cover per le card della home R-A.I. usando Gemini Nano Banana.
Salva in /app/frontend/public/cards/{slug}.png
Stile coerente con la console AI: blu elettrico + arancione ON AIR + neon glow.
"""
import asyncio
import base64
import os
from pathlib import Path

from dotenv import load_dotenv
from emergentintegrations.llm.chat import LlmChat, UserMessage

load_dotenv(Path(__file__).parent.parent / ".env")

API_KEY = os.getenv("EMERGENT_LLM_KEY")
OUT_DIR = Path("/app/frontend/public/cards")
OUT_DIR.mkdir(parents=True, exist_ok=True)

STYLE = (
    "Ultra-detailed cinematic 16:9 hi-tech radio broadcast console aesthetic. "
    "Dominant electric blue (#00BFFF, #00E5FF) with warm orange accents (#FF6B1A) "
    "used only for ON AIR-like glow highlights. Deep black background (#02040A). "
    "Strong neon rim-light, volumetric fog, subtle CRT scanlines, "
    "sharp circuit patterns, cinematic depth of field. "
    "No text, no watermarks, no letters, no logos. Photorealistic 3D render."
)

CARDS = [
    (
        "human-vs-ai",
        "A dramatic close-up of an arm-wrestling match between a sleek chromed "
        "robotic arm (glowing electric blue joints and orange LED pulses) and a "
        "muscular human arm, hands locked. Sparks fly at contact point. "
        f"Studio blue rim-light behind, orange highlight on the AI arm. {STYLE}",
    ),
    (
        "disco-del-giorno",
        "A futuristic vinyl record made of pure blue laser light, hovering, "
        "spinning, emitting glowing sound-wave rings. Grooves are luminous cyan "
        f"circuits. Dark studio background with soft blue nebula. {STYLE}",
    ),
    (
        "esperimento",
        "A cross-section of a human brain fused with intricate glowing circuit "
        "boards and thin radio antennas emerging from the top. Electric blue "
        "synapses pulsing, orange spark of thought at the center. "
        f"Suspended in dark void with data particles. {STYLE}",
    ),
    (
        "chat-led",
        "A large digital sound wave sculpture made of glowing vertical bars, "
        "electric blue and cyan, with orange spike accents where the wave peaks. "
        "Data streams flowing through it, reflection on a dark glossy surface. "
        f"Feels like an audio spectrum on a broadcast console. {STYLE}",
    ),
]


async def gen_one(slug: str, prompt: str):
    chat = LlmChat(api_key=API_KEY, session_id=f"card-{slug}", system_message="Image generator")
    chat.with_model("gemini", "gemini-3.1-flash-image-preview").with_params(modalities=["image", "text"])
    msg = UserMessage(text=prompt)
    text, images = await chat.send_message_multimodal_response(msg)
    if not images:
        print(f"[{slug}] NO IMAGE returned")
        return
    img = images[0]
    out = OUT_DIR / f"{slug}.png"
    out.write_bytes(base64.b64decode(img["data"]))
    print(f"[{slug}] saved -> {out} ({out.stat().st_size // 1024} KB)")


async def main():
    # Parallel generation
    await asyncio.gather(*(gen_one(slug, p) for slug, p in CARDS))


if __name__ == "__main__":
    asyncio.run(main())
