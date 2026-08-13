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
OUT = Path("/app/frontend/public/rai-face.png")

PROMPT = (
    "Iconic vector-style logo icon on SOLID BLACK background (#000000). "
    "Square 1024x1024, perfectly centered. "
    "Design: a minimalist ROBOT FACE shaped as a clean thin-line "
    "electric-blue neon circle (like a helmet/head). "
    "INSIDE the circle, in the UPPER HALF, a horizontal face-plate reading "
    "EXACTLY 6 characters left-to-right, clearly separated and readable: "
    "  'R'   '-'   'A'   '.'   'I'   '.' "
    "So the sequence is: capital R (left EYE), then small dash '-' (nose), "
    "then capital A (central, slightly larger, like a second EYE or nose "
    "bridge), then small dot '.', then capital I (right EYE), then final "
    "small dot '.'. "
    "R, A and I are electric-blue neon (#00E5FF) in a thin geometric hi-tech "
    "font, symmetric, well-proportioned, glowing softly. The dash '-' and "
    "the two dots '.' are ORANGE glow (#FF6B1A). "
    "Below the letters, occupying the lower half of the circle, a horizontal "
    "AUDIO WAVEFORM (5-7 symmetric vertical bars of varying heights forming "
    "a pulse) as the ROBOT MOUTH, glowing electric blue. "
    "Sprinkled inside the face (around cheeks / below the mouth): 2-3 tiny "
    "ORANGE glowing dots as small LED SENSORS. "
    "On top of the circle: a thin vertical ANTENNA line with an ORANGE "
    "glowing DOT at its tip (ON AIR indicator). "
    "STYLE: extremely clean, iconic, symmetric, geometric, minimal. Neon "
    "outline aesthetic. Main lines electric blue; the dash, dots and antenna "
    "tip are orange. Solid black background. The ONLY letters allowed are "
    "one 'R', one 'A' and one 'I' with the correct punctuation between them "
    "as described. NO other letters, no words, no numbers, no watermark."
)


async def main():
    chat = LlmChat(api_key=API_KEY, session_id="rai-robotface-v5-rai-full", system_message="Icon designer")
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
    print(f"Header face logo saved: {OUT} ({OUT.stat().st_size//1024} KB)")


if __name__ == "__main__":
    asyncio.run(main())
