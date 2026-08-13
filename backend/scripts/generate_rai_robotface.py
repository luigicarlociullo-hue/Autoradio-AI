"""Genera il logo 'volto di R-A.I.' — testa di robot con R+I occhi.
Usato SOLO nell'header. Salvato in rai-logo.png.
"""
import asyncio, base64, os
from pathlib import Path
from dotenv import load_dotenv
from emergentintegrations.llm.chat import LlmChat, UserMessage
from PIL import Image

load_dotenv(Path(__file__).parent.parent / ".env")
API_KEY = os.getenv("EMERGENT_LLM_KEY")
OUT = Path("/app/frontend/public/rai-logo.png")

PROMPT = (
    "Iconic vector-style logo icon on SOLID BLACK background (#000000). "
    "Square 1024x1024, perfectly centered. "
    "Design: a minimalist friendly ROBOT FACE shaped as a clean thin-line "
    "electric-blue neon circle (like a helmet/head). "
    "INSIDE the circle, in the UPPER HALF, THREE capital letters aligned "
    "horizontally as a face-plate reading exactly: 'R - A . I .' "
    "Order left-to-right: capital R, small dash '-', capital A (slightly "
    "larger, central, like the nose bridge), small dot '.', capital I, "
    "small dot '.'. All three letters R, A, I are neon electric-blue (#00E5FF) "
    "in thin geometric hi-tech font, symmetric, proportional, glowing. "
    "The dash and dots are small orange glowing points (#FF6B1A). "
    "Below the letters, a horizontal audio waveform (5-7 symmetric vertical "
    "bars) as the ROBOT MOUTH, glowing blue. "
    "On top of the circle: a thin vertical ANTENNA line with an ORANGE "
    "glowing DOT at the tip (ON AIR indicator). "
    "STYLE: extremely clean, iconic, symmetric, geometric, minimal. Neon "
    "outline aesthetic. All main lines electric blue neon with soft glow, "
    "except antenna tip + dash + dots which are orange. Solid black "
    "background. The ONLY letters allowed are 'R', 'A', 'I' inside the "
    "circle — NO other text, no numbers, no watermark. Icon like an app icon."
)


async def main():
    chat = LlmChat(api_key=API_KEY, session_id="rai-robotface-v3-full", system_message="Icon designer")
    chat.with_model("gemini", "gemini-3.1-flash-image-preview").with_params(modalities=["image", "text"])
    _, imgs = await chat.send_message_multimodal_response(UserMessage(text=PROMPT))
    if not imgs:
        print("NO IMAGE"); return
    tmp = OUT.with_suffix(".raw.png")
    tmp.write_bytes(base64.b64decode(imgs[0]["data"]))
    # Rimuove il fondo NERO -> trasparente per rendering pulito nell'header
    im = Image.open(tmp).convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            # black-ish -> transparent
            if r < 30 and g < 30 and b < 40:
                px[x, y] = (0, 0, 0, 0)
    im.save(OUT, "PNG")
    tmp.unlink(missing_ok=True)
    # Copia anche in rai-face.png per uso specifico dell'header
    import shutil
    shutil.copy(OUT, OUT.parent / "rai-face.png")
    print(f"Robot-face logo saved: {OUT} + rai-face.png ({OUT.stat().st_size//1024} KB)")


if __name__ == "__main__":
    asyncio.run(main())
