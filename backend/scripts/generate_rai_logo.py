"""Genera il logo simbolo R-A.I. con Nano Banana.
Salva in /app/frontend/public/rai-logo.png (sfondo trasparente).
"""
import asyncio, base64, os
from pathlib import Path
from dotenv import load_dotenv
from emergentintegrations.llm.chat import LlmChat, UserMessage

load_dotenv(Path(__file__).parent.parent / ".env")
API_KEY = os.getenv("EMERGENT_LLM_KEY")
OUT = Path("/app/frontend/public/rai-logo.png")

PROMPT = (
    "Iconic minimalistic logo symbol for a futuristic AI web radio called R-A.I. "
    "Square 1024x1024, transparent background. The mark: a circular emblem where "
    "a stylised sound wave transforms into a heartbeat pulse spelling the letters "
    "'R' and 'A' subtly integrated; a thin antenna diode point on top of the ring, "
    "small orange LED dot on the ring (like an ON AIR indicator). "
    "Electric blue (#00BFFF, #00E5FF) neon lines glowing softly, deep black core. "
    "Thin bright outline, hi-tech precision, sci-fi console feel. "
    "Sharp geometric lines, minimal, iconic, memorable. No text, no letters other "
    "than the R and A subtly embedded. No watermark. Pure vector-style icon."
)


async def main():
    chat = LlmChat(api_key=API_KEY, session_id="rai-logo-v1", system_message="Logo designer")
    chat.with_model("gemini", "gemini-3.1-flash-image-preview").with_params(modalities=["image", "text"])
    _, imgs = await chat.send_message_multimodal_response(UserMessage(text=PROMPT))
    if not imgs:
        print("NO IMAGE")
        return
    OUT.write_bytes(base64.b64decode(imgs[0]["data"]))
    print(f"Logo saved: {OUT} ({OUT.stat().st_size//1024} KB)")


if __name__ == "__main__":
    asyncio.run(main())
