"""Genera un logo simbolo R-A.I. iconico e pulito.
Deve essere leggibile a 40x40 px. Cerchio + waveform orizzontale + antenna.
"""
import asyncio, base64, os
from pathlib import Path
from dotenv import load_dotenv
from emergentintegrations.llm.chat import LlmChat, UserMessage

load_dotenv(Path(__file__).parent.parent / ".env")
API_KEY = os.getenv("EMERGENT_LLM_KEY")
OUT = Path("/app/frontend/public/rai-logo.png")

PROMPT = (
    "Minimalist vector-style logo icon on FULLY TRANSPARENT PNG background. "
    "Square 1024x1024, perfectly centered. Design: a clean thin-line "
    "electric-blue neon circle (glow #00E5FF), and INSIDE the circle a simple "
    "horizontal audio waveform (5-7 symmetric vertical bars of varying height) "
    "forming a pulse. On top of the circle: a very thin vertical antenna line "
    "with a small orange (#FF6B1A) glowing dot at its tip (ON AIR indicator). "
    "STYLE: extremely clean, iconic, symmetric, geometric. Only electric blue "
    "neon lines with soft glow, plus one small orange dot at the antenna tip. "
    "TRANSPARENT background. Nothing else — no text/letters/numbers/watermark. "
    "Pure iconic symbol like an app icon."
)


async def main():
    chat = LlmChat(api_key=API_KEY, session_id="rai-visual-symbol-v3", system_message="Icon designer")
    chat.with_model("gemini", "gemini-3.1-flash-image-preview").with_params(modalities=["image", "text"])
    _, imgs = await chat.send_message_multimodal_response(UserMessage(text=PROMPT))
    if not imgs:
        print("NO IMAGE"); return
    from PIL import Image
    tmp = OUT.with_suffix(".raw.png")
    tmp.write_bytes(base64.b64decode(imgs[0]["data"]))
    # Se Nano Banana genera con fondo grigio/nero anziché trasparente, chroma-key out
    im = Image.open(tmp).convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            # neutral gray or black -> transparent
            if abs(r - g) < 10 and abs(g - b) < 10 and abs(r - b) < 10 and r < 130:
                px[x, y] = (0, 0, 0, 0)
    im.save(OUT, "PNG")
    tmp.unlink(missing_ok=True)
    print(f"Visual symbol saved: {OUT} ({OUT.stat().st_size//1024} KB)")


if __name__ == "__main__":
    asyncio.run(main())
