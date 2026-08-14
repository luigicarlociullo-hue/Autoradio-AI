"""Genera la cover 'Club Night' per la home."""
import asyncio, base64, os
from pathlib import Path
from dotenv import load_dotenv
from emergentintegrations.llm.chat import LlmChat, UserMessage

load_dotenv(Path(__file__).parent.parent / ".env")
API_KEY = os.getenv("EMERGENT_LLM_KEY")
OUT = Path("/app/frontend/public/cards/club-night.png")
OUT.parent.mkdir(parents=True, exist_ok=True)

PROMPT = (
    "Ultra-detailed cinematic 16:9 futuristic underground TECHNO CLUB scene. "
    "Deep dark warehouse space filled with volumetric fog. A DJ silhouette "
    "behind a glowing holographic mixing console at center-frame, hands on "
    "the deck. Massive laser light beams cutting through the fog in electric "
    "blue (#00E5FF, #00BFFF) with orange strobes (#FF6B1A) accents. "
    "Speakers and modular synths visible, subtle circuit patterns glowing on "
    "walls. Cyberpunk crowd shadows at the edges. Rim-lighting cinematic, "
    "shallow depth of field. Feels like 3 AM in an afterhours club, "
    "hypnotic and immersive. No text, no letters, no watermark. "
    "Photorealistic 3D render."
)


async def main():
    chat = LlmChat(api_key=API_KEY, session_id="club-night-cover-v1", system_message="Image generator")
    chat.with_model("gemini", "gemini-3.1-flash-image-preview").with_params(modalities=["image", "text"])
    _, imgs = await chat.send_message_multimodal_response(UserMessage(text=PROMPT))
    if not imgs:
        print("NO IMAGE"); return
    OUT.write_bytes(base64.b64decode(imgs[0]["data"]))
    print(f"Cover saved: {OUT} ({OUT.stat().st_size//1024} KB)")


if __name__ == "__main__":
    asyncio.run(main())
