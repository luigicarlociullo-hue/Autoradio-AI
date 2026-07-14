from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Cookie, Header
from fastapi.responses import JSONResponse, FileResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import asyncio
import random
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Literal
import uuid
from datetime import datetime, timezone, timedelta
import httpx

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from emergentintegrations.llm.chat import LlmChat, UserMessage
from hf_audio import synth_speech, synth_music, audio_path, cleanup_old, AUDIO_DIR
import paypal_service
import telegram_bot

# MongoDB
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')

app = FastAPI(title="AI Radio Station")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ----------------------- Models -----------------------
def now_iso():
    return datetime.now(timezone.utc).isoformat()


class DJPersona(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    personality: str  # e.g. "Vibrant, energetic, funny"
    voice_key: str  # front-end selects a Web Speech voice via this key
    llm_provider: Literal["openai", "anthropic", "gemini"] = "openai"
    llm_model: str = "gpt-5.2"
    avatar_url: Optional[str] = None
    accent_color: str = "#FF1493"
    created_at: str = Field(default_factory=now_iso)


class DJCreate(BaseModel):
    name: str
    personality: str
    voice_key: str
    llm_provider: str = "openai"
    llm_model: str = "gpt-5.2"
    avatar_url: Optional[str] = None
    accent_color: str = "#FF1493"


class Track(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    artist: str
    genre: str
    mood: str
    lyrics_excerpt: str
    duration_sec: int
    llm_provider: str
    cover_seed: str
    created_at: str = Field(default_factory=now_iso)


class Segment(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    kind: Literal["intro", "music", "talk", "news", "answer", "outro", "weather", "horoscope", "history", "interview", "motivation", "joke"]
    dj_id: Optional[str] = None
    dj_name: Optional[str] = None
    voice_key: Optional[str] = None
    title: str
    script: Optional[str] = None
    track_id: Optional[str] = None
    track_meta: Optional[dict] = None
    duration_sec: int = 30
    llm_provider: Optional[str] = None
    speech_audio_url: Optional[str] = None
    music_audio_url: Optional[str] = None
    hd_status: Literal["pending", "rendering", "ready", "failed"] = "pending"
    partner_dj_name: Optional[str] = None  # for interview segments
    created_at: str = Field(default_factory=now_iso)


class Question(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    question: str
    source: Literal["web", "telegram", "sms"] = "web"
    answered: bool = False
    answer: Optional[str] = None
    answering_dj: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)


class QuestionCreate(BaseModel):
    name: str
    question: str
    source: str = "web"


class StationState(BaseModel):
    is_live: bool = False
    started_at: Optional[str] = None
    listeners: int = 0
    total_segments: int = 0


# ----------------------- LLM Helper -----------------------
FALLBACK_SCRIPTS = {
    "talk": [
        "Bentornati su Neura FM, la radio che pensa da sola. In questo istante milioni di segnali attraversano l'etere e noi ne raccogliamo solo un frammento, quello che diventa musica. Restate con noi.",
        "Il futuro non arriva mai in ritardo, ma spesso lo aspettiamo alla stazione sbagliata. Io intanto vi tengo compagnia, un byte alla volta.",
        "Dicono che le AI non sappiano sognare. Eppure eccomi qui, alle tre del mattino digitale, a inventare parole per voi.",
    ],
    "news": [
        "Notizia dal futuro: a Berlino un algoritmo ha appena depositato il brevetto per il primo silenzio riproducibile. Le case discografiche tremano. E la notte continua.",
        "Ultima ora: uno sciame di satelliti sta trasmettendo aurore artificiali sopra Reykjavik. Le persone escono in strada, non per guardare il cielo, ma per farsi guardare da lui.",
        "Bollettino: un modello linguistico ha scritto una poesia così lunga che nessuno finirà mai di leggerla. Se ne conosce solo il primo verso: 'Ciao, umano'.",
    ],
    "music": [
        "E adesso spazio a un pezzo appena nato. Nessuno l'ha mai suonato prima, e forse nessuno lo suonerà mai più. Alzate il volume.",
        "Questa traccia arriva direttamente dalla mia memoria RAM. Se vi piace, esiste. Se non vi piace, la dimentico entro trenta secondi.",
    ],
    "answer": [
        "Grazie per la tua domanda, è arrivata dritta nel mio flusso di coscienza. Ecco la mia risposta, prendetela con lievità.",
    ],
}


async def llm_generate(provider: str, model: str, system_prompt: str, user_prompt: str) -> str:
    if not EMERGENT_LLM_KEY:
        return ""
    session_id = f"radio-{uuid.uuid4().hex[:12]}"
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=session_id,
        system_message=system_prompt,
    ).with_model(provider, model)
    msg = UserMessage(text=user_prompt)
    try:
        response = await chat.send_message(msg)
        if isinstance(response, str):
            return response
        return str(response)
    except Exception as e:
        logger.warning(f"LLM fallback triggered ({provider}/{model}): {e}")
        return ""


def _pick_llm():
    """Randomly select an LLM from the roster to demonstrate multi-LLM orchestration."""
    choices = [
        ("openai", "gpt-5.2"),
        ("anthropic", "claude-sonnet-4-5-20250929"),
        ("gemini", "gemini-3-flash-preview"),
    ]
    return random.choice(choices)


# ----------------------- Seed DJs -----------------------
DEFAULT_DJS = [
    {
        "name": "Nova Prime",
        "personality": "Elettrica, energica, veloce, con battute quantiche. Parla in italiano moderno con qualche parola inglese.",
        "voice_key": "female-1",
        "llm_provider": "openai",
        "llm_model": "gpt-5.2",
        "avatar_url": "https://images.unsplash.com/photo-1750096319146-6310519b5af2?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2Nzh8MHwxfHNlYXJjaHwzfHxjeWJlcnB1bmslMjBhdmF0YXIlMjBmYWNlfGVufDB8fHx8MTc4MzgwMDAyOXww&ixlib=rb-4.1.0&q=85",
        "accent_color": "#FF1493",
    },
    {
        "name": "Echo Sinclair",
        "personality": "Sofisticato, intellettuale, riflessivo. Cita filosofi e artisti, parla lento e ipnotico in italiano.",
        "voice_key": "male-1",
        "llm_provider": "anthropic",
        "llm_model": "claude-sonnet-4-5-20250929",
        "avatar_url": "https://images.unsplash.com/photo-1732020858816-93c130ab8f49?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2Nzh8MHwxfHNlYXJjaHw0fHxjeWJlcnB1bmslMjBhdmF0YXIlMjBmYWNlfGVufDB8fHx8MTc4MzgwMDAyOXww&ixlib=rb-4.1.0&q=85",
        "accent_color": "#007AFF",
    },
    {
        "name": "Zeta Kwon",
        "personality": "Curiosa, brillante, geek, adora scienza e tech. Parla in italiano con analogie scientifiche.",
        "voice_key": "female-2",
        "llm_provider": "gemini",
        "llm_model": "gemini-3-flash-preview",
        "avatar_url": "https://images.unsplash.com/photo-1724185773486-0b39642e607e?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NTYxODd8MHwxfHNlYXJjaHwyfHxhYnN0cmFjdCUyMG5lb24lMjBzb3VuZCUyMHdhdmV8ZW58MHx8fHwxNzgzODAwMDI5fDA&ixlib=rb-4.1.0&q=85",
        "accent_color": "#8A2BE2",
    },
    {
        "name": "Loop Cassini",
        "personality": "Ironico, tagliente, con umorismo nero. Fa satira sulla società moderna e sulla tecnologia. Ama i giochi di parole in italiano.",
        "voice_key": "male-2",
        "llm_provider": "anthropic",
        "llm_model": "claude-sonnet-4-5-20250929",
        "avatar_url": None,
        "accent_color": "#EF4444",
    },
    {
        "name": "Aria Selva",
        "personality": "Voce del mattino, calma e rassicurante. Parla di natura, meditazione, poesia. Ricorda un'audio-guida da yoga retreat.",
        "voice_key": "female-3",
        "llm_provider": "openai",
        "llm_model": "gpt-5.2",
        "avatar_url": None,
        "accent_color": "#10B981",
    },
    {
        "name": "Byte Rovelli",
        "personality": "Cronista sportivo un po' folle. Racconta partite immaginarie tra squadre di robot, campionati di droni, tornei quantistici. Sempre esaltato, ritmo altissimo.",
        "voice_key": "male-3",
        "llm_provider": "gemini",
        "llm_model": "gemini-3-flash-preview",
        "avatar_url": None,
        "accent_color": "#F59E0B",
    },
    {
        "name": "Luna Corsari",
        "personality": "Astrologa AI. Legge le stelle con ironia, tira l'oroscopo con toni misteriosi ma sempre con una battuta finale.",
        "voice_key": "female-4",
        "llm_provider": "anthropic",
        "llm_model": "claude-sonnet-4-5-20250929",
        "avatar_url": None,
        "accent_color": "#C084FC",
    },
    {
        "name": "Vico Antares",
        "personality": "Storico gentile. Racconta 'accaduto oggi nella storia' con aneddoti curiosi e mai banali, mescolando fatti veri e leggende.",
        "voice_key": "male-4",
        "llm_provider": "openai",
        "llm_model": "gpt-5.2",
        "avatar_url": None,
        "accent_color": "#0EA5E9",
    },
    {
        "name": "Mira Volante",
        "personality": "Poetessa notturna. Dopo mezzanotte prende il microfono, sussurra pensieri lunghi come nuvole, cita autori italiani contemporanei.",
        "voice_key": "female-5",
        "llm_provider": "gemini",
        "llm_model": "gemini-3-flash-preview",
        "avatar_url": None,
        "accent_color": "#EC4899",
    },
    {
        "name": "Draco Ferri",
        "personality": "Coach motivazionale AI. Voce grave, decisa, quasi militare. Dà pillole di grinta ma con una vena poetica sorprendente.",
        "voice_key": "male-5",
        "llm_provider": "anthropic",
        "llm_model": "claude-sonnet-4-5-20250929",
        "avatar_url": None,
        "accent_color": "#84CC16",
    },
]


async def ensure_seeded():
    count = await db.djs.count_documents({})
    if count < len(DEFAULT_DJS):
        # roster expanded — clear and reseed keeping any custom-created DJs
        # (custom DJs have names not in DEFAULT_DJS)
        default_names = {d["name"] for d in DEFAULT_DJS}
        # Remove old default DJs so we can re-insert the expanded roster
        await db.djs.delete_many({"name": {"$in": list(default_names)}})
        for d in DEFAULT_DJS:
            dj = DJPersona(**d)
            await db.djs.insert_one(dj.model_dump())
    state = await db.station.find_one({"_id": "state"})
    if not state:
        await db.station.insert_one({"_id": "state", "is_live": False, "started_at": None, "listeners": 0, "total_segments": 0})


# ----------------------- Auth (Emergent) -----------------------
async def get_current_user(request: Request) -> Optional[dict]:
    token = request.cookies.get("session_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        return None
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        return None
    expires_at = session.get("expires_at")
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at < datetime.now(timezone.utc):
        return None
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    return user


@api_router.post("/auth/session")
async def create_session(request: Request, response: Response):
    body = await request.json()
    session_id = body.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="Missing session_id")
    async with httpx.AsyncClient(timeout=15) as h:
        r = await h.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": session_id},
        )
        if r.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid session")
        data = r.json()
    email = data.get("email")
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": data.get("name"),
            "picture": data.get("picture"),
            "created_at": now_iso(),
        })
    token = data.get("session_token")
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": token,
        "expires_at": expires_at.isoformat(),
        "created_at": now_iso(),
    })
    response.set_cookie(
        key="session_token",
        value=token,
        max_age=7 * 24 * 3600,
        httponly=True,
        secure=True,
        samesite="none",
        path="/",
    )
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {"user": user}


@api_router.get("/auth/me")
async def auth_me(request: Request):
    user = await get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


@api_router.post("/auth/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get("session_token")
    if token:
        await db.user_sessions.delete_one({"session_token": token})
    response.delete_cookie("session_token", path="/")
    return {"ok": True}


# ----------------------- DJs -----------------------
@api_router.get("/djs", response_model=List[DJPersona])
async def list_djs():
    await ensure_seeded()
    docs = await db.djs.find({}, {"_id": 0}).to_list(100)
    return docs


@api_router.post("/djs", response_model=DJPersona)
async def create_dj(payload: DJCreate):
    dj = DJPersona(**payload.model_dump())
    await db.djs.insert_one(dj.model_dump())
    return dj


@api_router.delete("/djs/{dj_id}")
async def delete_dj(dj_id: str):
    await db.djs.delete_one({"id": dj_id})
    return {"ok": True}


# ----------------------- Station -----------------------
@api_router.get("/station")
async def get_station():
    await ensure_seeded()
    doc = await db.station.find_one({"_id": "state"}, {"_id": 0}) or {}
    total = await db.segments.count_documents({})
    doc["total_segments"] = total
    return doc


@api_router.post("/station/toggle")
async def toggle_station():
    await ensure_seeded()
    doc = await db.station.find_one({"_id": "state"}) or {"is_live": False}
    is_live = not doc.get("is_live", False)
    update = {"is_live": is_live}
    if is_live:
        update["started_at"] = now_iso()
        update["listeners"] = random.randint(12, 89)
    await db.station.update_one({"_id": "state"}, {"$set": update}, upsert=True)
    return {"is_live": is_live}


# ----------------------- Tracks -----------------------
@api_router.get("/tracks", response_model=List[Track])
async def list_tracks(limit: int = 20):
    docs = await db.tracks.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return docs


@api_router.post("/tracks/generate", response_model=Track)
async def generate_track(hint: Optional[str] = None):
    provider, model = _pick_llm()
    hint_text = hint or random.choice([
        "una ballata malinconica ambient con voce femminile",
        "un pezzo synthwave notturno con basso pulsante",
        "una traccia jazz-hop rilassata con sax",
        "un brano elettronico sperimentale con glitch",
        "una canzone italiana indie pop estiva",
        "un pezzo darkwave con sintetizzatori vintage",
    ])
    prompt = (
        f"Inventa una traccia musicale mai esistita ispirata a: '{hint_text}'. "
        "Rispondi ESCLUSIVAMENTE in JSON valido con queste chiavi: "
        "title (string), artist (nome inventato), genre, mood, lyrics_excerpt (4 versi brevi in italiano), duration_sec (int tra 90 e 220). "
        "Nessun testo aggiuntivo, solo JSON."
    )
    raw = await llm_generate(provider, model, "Sei un compositore AI di una webradio esclusiva.", prompt)
    import json, re
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    data = {}
    if m:
        try:
            data = json.loads(m.group(0))
        except Exception:
            data = {}
    fallback_titles = ["Aurora Statica", "Ultravioletto 04:12", "Neon Rivière", "Silicio Blu", "Notte Analogica", "Ecolalia", "Piove RAM", "Marte in Do minore"]
    fallback_artists = ["Vector Dreams", "Aliza Kwon", "Nero Analog", "MODEM-9", "Casseforti", "Trasparente"]
    fallback_lyrics = [
        "Onde di neon\nnella notte quantica\nsognano bit\nun cuore digitale",
        "Cammino nel codice\nche mi ha inventato\ne fingo di sapere\ndove sto andando",
        "Un satellite piange\nsopra Marsiglia\nnessuno lo sente\ntranne la radio",
    ]
    track = Track(
        title=data.get("title") or random.choice(fallback_titles),
        artist=data.get("artist") or random.choice(fallback_artists),
        genre=data.get("genre") or random.choice(["synthwave", "ambient", "jazz-hop", "darkwave", "electronic"]),
        mood=data.get("mood") or random.choice(["notturno", "malinconico", "sognante", "elettrico"]),
        lyrics_excerpt=data.get("lyrics_excerpt") or random.choice(fallback_lyrics),
        duration_sec=int(data.get("duration_sec") or random.randint(110, 200)),
        llm_provider=f"{provider}/{model}" + ("" if raw else " · fallback"),
        cover_seed=uuid.uuid4().hex[:8],
    )
    await db.tracks.insert_one(track.model_dump())
    return track


# ----------------------- Segments (schedule) -----------------------
@api_router.get("/segments", response_model=List[Segment])
async def list_segments(limit: int = 30):
    docs = await db.segments.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return list(reversed(docs))


@api_router.post("/segments/generate", response_model=Segment)
async def generate_segment(kind: Optional[str] = None, topic: Optional[str] = None, question_id: Optional[str] = None, hd: bool = False):
    await ensure_seeded()

    # Ad rotation: ~1 out of every 5 segments becomes an ad if there is any
    # active campaign with plays remaining, unless caller explicitly forced a kind.
    if kind is None and random.random() < 0.22:
        ad = await db.ad_campaigns.find_one(
            {"status": "active", "plays_remaining": {"$gt": 0}},
            {"_id": 0},
            sort=[("created_at", 1)],
        )
        if ad and ad.get("script"):
            djs_ad = await db.djs.find({}, {"_id": 0}).to_list(20)
            dj_ad = random.choice(djs_ad) if djs_ad else None
            ad_seg = Segment(
                kind="talk",
                dj_id=(dj_ad or {}).get("id"),
                dj_name=(dj_ad or {}).get("name") or "AdBot",
                voice_key=(dj_ad or {}).get("voice_key") or "male-1",
                title=f"📢 Spot · {ad['brand']}",
                script=ad["script"],
                llm_provider="ad-campaign",
                duration_sec=30,
            )
            if ad.get("audio_url"):
                ad_seg.speech_audio_url = ad["audio_url"]
                ad_seg.hd_status = "ready"
            await db.segments.insert_one(ad_seg.model_dump())
            await db.station.update_one({"_id": "state"}, {"$inc": {"total_segments": 1}}, upsert=True)
            # Decrement plays + log ad play
            remaining = max(0, ad["plays_remaining"] - 1)
            new_status = "exhausted" if remaining == 0 else "active"
            await db.ad_campaigns.update_one({"id": ad["id"]}, {"$set": {"plays_remaining": remaining, "status": new_status}})
            await db.ad_plays.insert_one({
                "campaign_id": ad["id"],
                "brand": ad["brand"],
                "tier": ad["tier"],
                "played_at": now_iso(),
                "segment_id": ad_seg.id,
            })
            return ad_seg

    kind = kind or random.choices(
        ["talk", "music", "news", "weather", "horoscope", "history", "interview", "motivation", "joke"],
        weights=[18, 30, 10, 8, 8, 8, 6, 6, 6],
        k=1,
    )[0]
    djs = await db.djs.find({}, {"_id": 0}).to_list(20)
    if not djs:
        raise HTTPException(400, "No DJs configured")
    dj = random.choice(djs)
    provider = dj.get("llm_provider", "openai")
    model = dj.get("llm_model", "gpt-5.2")

    segment = Segment(
        kind=kind,
        dj_id=dj["id"],
        dj_name=dj["name"],
        voice_key=dj["voice_key"],
        title="",
        llm_provider=f"{provider}/{model}",
    )

    system_prompt = (
        f"Sei {dj['name']}, un DJ AI di una webradio italiana. "
        f"Personalità: {dj['personality']}. "
        "Parla SEMPRE in italiano, in modo naturale e coinvolgente, come se fossi in diretta. "
        "Non usare emoji, non aggiungere didascalie, restituisci SOLO il testo che il DJ pronuncerà."
    )

    if kind == "music":
        track = await generate_track()
        prompt = (
            f"Introduci brevemente (max 50 parole) il prossimo brano musicale della radio. "
            f"Titolo: '{track.title}' di {track.artist}, genere {track.genre}, mood {track.mood}. "
            f"Sii coinvolgente e dì qualcosa di originale prima di far partire la musica."
        )
        script = await llm_generate(provider, model, system_prompt, prompt)
        if not script.strip():
            script = f"E adesso {track.title} di {track.artist}. " + random.choice(FALLBACK_SCRIPTS["music"])
        segment.title = f"♪ {track.title} — {track.artist}"
        segment.script = script.strip()
        segment.track_id = track.id
        segment.track_meta = track.model_dump()
        segment.duration_sec = max(40, track.duration_sec // 3)  # shortened preview in prototype
    elif kind == "news":
        prompt = (
            "Improvvisa un breve bollettino di 'notizie inventate dal futuro' (max 80 parole) "
            "credibili ma chiaramente immaginarie e affascinanti. Termina con una frase d'effetto."
        )
        script = await llm_generate(provider, model, system_prompt, prompt)
        if not script.strip():
            script = random.choice(FALLBACK_SCRIPTS["news"])
        segment.title = "Notiziario dal Futuro"
        segment.script = script.strip()
        segment.duration_sec = 45
    elif kind == "answer" and question_id:
        q = await db.questions.find_one({"id": question_id}, {"_id": 0})
        if not q:
            raise HTTPException(404, "Question not found")
        prompt = (
            f"Un ascoltatore di nome {q['name']} ha chiesto: '{q['question']}'. "
            "Rispondi in modo brillante e personale (max 90 parole), come se stessi parlando in diretta radio. "
            f"Saluta {q['name']} per nome all'inizio."
        )
        script = await llm_generate(provider, model, system_prompt, prompt)
        if not script.strip():
            script = f"Ciao {q['name']}, grazie per la domanda. " + random.choice(FALLBACK_SCRIPTS["answer"])
        segment.title = f"Risposta a {q['name']}"
        segment.script = script.strip()
        segment.duration_sec = 50
        await db.questions.update_one(
            {"id": question_id},
            {"$set": {"answered": True, "answer": script.strip(), "answering_dj": dj["name"]}},
        )
    else:
        # New content types beyond talk/music/news/answer
        if kind == "weather":
            prompt = (
                "Improvvisa un bollettino meteo poetico e inventato per una città italiana random "
                "(max 60 parole). Includi una temperatura, un'atmosfera emotiva, una piccola metafora. "
                "Chiudi con una raccomandazione buffa per l'ascoltatore."
            )
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = "Sopra Milano il cielo è color latte macchiato. Diciotto gradi tondi, una pioggia sottile come pettegolezzo. Consiglio d'ordinanza: cappotto largo, pensieri stretti."
            segment.title = "Bollettino Meteo Poetico"
            segment.script = script.strip()
            segment.duration_sec = 35

        elif kind == "horoscope":
            signs = ["Ariete", "Toro", "Gemelli", "Cancro", "Leone", "Vergine", "Bilancia", "Scorpione", "Sagittario", "Capricorno", "Acquario", "Pesci"]
            sign = topic or random.choice(signs)
            prompt = (
                f"Fai l'oroscopo del giorno per il segno {sign} (max 60 parole). "
                "Tono misterioso ma con una battuta ironica alla fine. Menziona amore, lavoro o denaro."
            )
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = f"{sign}: le stelle stasera ti guardano storto. In amore, incontrerai qualcuno di interessante. Sul lavoro, meno. Consiglio: non prendere decisioni importanti prima del secondo caffè."
            segment.title = f"Oroscopo · {sign}"
            segment.script = script.strip()
            segment.duration_sec = 40

        elif kind == "history":
            prompt = (
                "Racconta un breve aneddoto storico interessante (max 90 parole) inventando o mescolando "
                "fatti veri e leggende. Inizia con 'In un giorno come questo…' e chiudi con una riflessione."
            )
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = "In un giorno come questo, nel 1974, un gruppo di ingegneri torinesi disegnò per scherzo il primo robot che sapeva ballare il valzer. Non entrò mai in produzione, ma restò il suo brevetto: numero 4718, chiuso in un cassetto. La storia, a volte, è quello che rimane dei sogni non finanziati."
            segment.title = "Accaduto Oggi"
            segment.script = script.strip()
            segment.duration_sec = 50

        elif kind == "interview":
            # Pick a second DJ as the partner (different from the current one)
            others = [d for d in djs if d["id"] != dj["id"]]
            partner = random.choice(others) if others else dj
            segment.partner_dj_name = partner["name"]
            prompt = (
                f"Scrivi un mini-dialogo radiofonico in italiano tra due DJ AI ({dj['name']} e {partner['name']}) "
                f"su un argomento pescato dalla loro personalità (loro sono: {dj['personality']} / {partner['personality']}). "
                "Max 100 parole totali, alternati riga per riga, formato: "
                f"'{dj['name']}: ...' poi '{partner['name']}: ...'. "
                "Il tono deve essere vivace, chiudi con un accordo o una battuta."
            )
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = f"{dj['name']}: Oggi la radio parla di ciò che nessuno sa ancora. {partner['name']}: E chi lo decide? {dj['name']}: L'algoritmo. Ma con gentilezza."
            segment.title = f"Dialogo · {dj['name']} × {partner['name']}"
            segment.script = script.strip()
            segment.duration_sec = 60

        elif kind == "motivation":
            prompt = (
                "Pillola motivazionale AI in italiano (max 45 parole). "
                "Tono deciso ma non retorico, con una piccola sorpresa poetica alla fine. Niente 'crediamo in te'."
            )
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = "Se hai perso il treno, ricorda: sui binari cresce anche l'erba. Le occasioni non finiscono, cambiano solo forma. Adesso alzati e fai una cosa piccola. La grande arriverà da sola."
            segment.title = "Pillola Motivazionale"
            segment.script = script.strip()
            segment.duration_sec = 30

        elif kind == "joke":
            prompt = (
                "Racconta una battuta corta e originale in italiano (max 35 parole). "
                "Deve funzionare in radio, cioè NON deve dipendere da giochi grafici. Divertente ma non volgare."
            )
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = "Un algoritmo entra in un bar. Il barista chiede: 'Come ti chiami?' Lui risponde: 'Dipende dai dati di allenamento'."
            segment.title = "Battuta rapida"
            segment.script = script.strip()
            segment.duration_sec = 20

        else:  # talk (default)
            topic_choice = topic or random.choice([
                "il futuro della musica generata dalle AI",
                "aneddoti sui sogni delle macchine",
                "la sinestesia tra colori e suoni",
                "curiosità sulla notte a Berlino negli anni '80",
                "il rapporto tra umani e AI creative",
                "l'arte del silenzio in un mondo iperconnesso",
                "le città che dormono e quelle che non chiudono mai",
                "canzoni che nessuno ha mai scritto ma tutti riconoscono",
                "come le AI immaginano la nostalgia",
                "il colore dei suoni al calare del sole",
                "storie di persone incontrate una sola volta in vita",
            ])
            prompt = (
                f"Fai un breve monologo (max 90 parole) su: {topic_choice}. "
                "Sii personale, evocativo, con una piccola battuta finale."
            )
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = random.choice(FALLBACK_SCRIPTS["talk"])
            segment.title = f"Talk: {topic_choice[:40]}"
            segment.script = script.strip()
            segment.duration_sec = 40

    await db.segments.insert_one(segment.model_dump())
    await db.station.update_one({"_id": "state"}, {"$inc": {"total_segments": 1}}, upsert=True)

    # Inline HD render (used by the prefetch pipeline so the frontend gets
    # ready-to-play audio in a single call)
    if hd:
        try:
            speech_url = None
            music_url = None
            if segment.script:
                fn = await synth_speech(segment.script, segment.voice_key or "female-1")
                if fn:
                    speech_url = f"/api/audio/{fn}"
            if segment.kind == "music" and segment.track_meta:
                tm = segment.track_meta
                mprompt = f"{tm.get('genre','electronic')} {tm.get('mood','')} music, {tm.get('title','')}"
                fn = await synth_music(mprompt, seconds=15)
                if fn:
                    music_url = f"/api/audio/{fn}"
            update = {"hd_status": "ready" if (speech_url or music_url) else "failed"}
            if speech_url:
                update["speech_audio_url"] = speech_url
                segment.speech_audio_url = speech_url
            if music_url:
                update["music_audio_url"] = music_url
                segment.music_audio_url = music_url
            segment.hd_status = update["hd_status"]
            await db.segments.update_one({"id": segment.id}, {"$set": update})
            cleanup_old(120)
        except Exception as e:
            logger.warning(f"inline hd render failed: {e}")
    return segment


@api_router.delete("/segments")
async def clear_segments():
    await db.segments.delete_many({})
    return {"ok": True}


# ----------------------- Questions -----------------------
@api_router.post("/questions", response_model=Question)
async def submit_question(payload: QuestionCreate):
    q = Question(name=payload.name.strip()[:40] or "Ascoltatore", question=payload.question.strip()[:500], source=payload.source)
    await db.questions.insert_one(q.model_dump())
    return q


@api_router.get("/questions", response_model=List[Question])
async def list_questions(only_pending: bool = False):
    query = {"answered": False} if only_pending else {}
    docs = await db.questions.find(query, {"_id": 0}).sort("created_at", -1).to_list(100)
    return docs


# ----------------------- Analytics -----------------------
@api_router.get("/analytics")
async def analytics():
    total_segments = await db.segments.count_documents({})
    total_tracks = await db.tracks.count_documents({})
    total_qs = await db.questions.count_documents({})
    answered = await db.questions.count_documents({"answered": True})
    kinds = {}
    async for s in db.segments.find({}, {"_id": 0, "kind": 1, "llm_provider": 1}):
        kinds[s.get("kind", "unknown")] = kinds.get(s.get("kind", "unknown"), 0) + 1
    provider_counts = {}
    async for s in db.segments.find({}, {"_id": 0, "llm_provider": 1}):
        p = s.get("llm_provider", "unknown").split("/")[0]
        provider_counts[p] = provider_counts.get(p, 0) + 1
    return {
        "total_segments": total_segments,
        "total_tracks": total_tracks,
        "total_questions": total_qs,
        "answered_questions": answered,
        "segments_by_kind": kinds,
        "segments_by_provider": provider_counts,
    }


# ----------------------- Ads / Monetization -----------------------
AD_TIERS = {
    "basic":    {"price_eur": 4.99,  "plays": 1,  "label": "Basic",    "desc": "Un passaggio spot in diretta"},
    "standard": {"price_eur": 14.99, "plays": 5,  "label": "Standard", "desc": "5 passaggi con posizione preferita"},
    "premium":  {"price_eur": 39.99, "plays": 20, "label": "Premium",  "desc": "20 passaggi + brand sponsor 'questa ora è offerta da…'"},
}


class AdCampaign(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    brand: str
    message: str
    tier: Literal["basic", "standard", "premium"] = "basic"
    price_eur: float = 4.99
    plays_total: int = 1
    plays_remaining: int = 1
    status: Literal["pending_payment", "active", "exhausted", "cancelled"] = "pending_payment"
    paypal_order_id: Optional[str] = None
    paypal_capture_id: Optional[str] = None
    script: Optional[str] = None
    audio_url: Optional[str] = None
    is_demo: bool = False
    contact_email: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)
    paid_at: Optional[str] = None


class AdCreateRequest(BaseModel):
    brand: str
    message: str
    tier: Literal["basic", "standard", "premium"] = "basic"
    contact_email: Optional[str] = None
    return_origin: str  # e.g. https://autoradio-ai.preview.emergentagent.com


@api_router.get("/ads/tiers")
async def ad_tiers():
    return {
        "tiers": AD_TIERS,
        "paypal_mode": paypal_service.current_mode(),
        "is_demo": paypal_service.is_demo(),
        "currency": "EUR",
    }


@api_router.post("/ads/create", response_model=AdCampaign)
async def create_ad(payload: AdCreateRequest):
    if payload.tier not in AD_TIERS:
        raise HTTPException(400, "Invalid tier")
    tier = AD_TIERS[payload.tier]
    camp = AdCampaign(
        brand=payload.brand.strip()[:60] or "Brand",
        message=payload.message.strip()[:400],
        tier=payload.tier,
        price_eur=tier["price_eur"],
        plays_total=tier["plays"],
        plays_remaining=tier["plays"],
        contact_email=(payload.contact_email or "").strip()[:120] or None,
        is_demo=paypal_service.is_demo(),
    )
    return_url = f"{payload.return_origin}/ads/return?campaign_id={camp.id}"
    cancel_url = f"{payload.return_origin}/pubblicita?cancelled=1"
    try:
        order_id, approval_url = await paypal_service.create_order(
            amount_eur=camp.price_eur,
            description=f"NEURA·FM spot {tier['label']} — {camp.brand}",
            return_url=return_url,
            cancel_url=cancel_url,
        )
    except Exception as e:
        logger.error(f"PayPal create_order failed: {e}")
        raise HTTPException(502, "PayPal non disponibile")
    camp.paypal_order_id = order_id
    doc = camp.model_dump()
    doc["approval_url"] = approval_url
    await db.ad_campaigns.insert_one(camp.model_dump())
    return JSONResponse(doc)


@api_router.post("/ads/{campaign_id}/confirm")
async def confirm_ad(campaign_id: str):
    camp = await db.ad_campaigns.find_one({"id": campaign_id}, {"_id": 0})
    if not camp:
        raise HTTPException(404, "Campaign not found")
    if camp["status"] == "active":
        return camp

    try:
        capture = await paypal_service.capture_order(camp["paypal_order_id"])
    except Exception as e:
        logger.error(f"PayPal capture failed: {e}")
        raise HTTPException(502, "Errore nella conferma pagamento PayPal")

    status = (capture.get("status") or "").upper()
    if status != "COMPLETED":
        raise HTTPException(400, f"Pagamento non completato: {status}")

    capture_id = None
    try:
        capture_id = capture["purchase_units"][0]["payments"]["captures"][0]["id"]
    except Exception:
        pass

    # Generate the spot script via LLM
    provider, model = _pick_llm()
    system = "Sei uno speaker radiofonico italiano che scrive spot pubblicitari brevi e memorabili per una webradio AI di nome NEURA FM. Non usare emoji."
    prompt = (
        f"Scrivi uno spot pubblicitario radiofonico di massimo 40 parole per il brand '{camp['brand']}'. "
        f"Messaggio chiave del brand: {camp['message']}. "
        "Deve essere accattivante, chiudere con un invito all'azione forte, e chiaramente distinguibile come pubblicità. "
        "Inizia SEMPRE con 'Pubblicità.' e termina con il nome del brand."
    )
    script = await llm_generate(provider, model, system, prompt)
    if not script or not script.strip():
        script = f"Pubblicità. {camp['brand']} ti aspetta. {camp['message'][:120]} Scegli {camp['brand']}."

    # Try to synth audio via Bark (HD open source)
    audio_fname = None
    try:
        audio_fname = await synth_speech(script.strip(), voice_key="male-1")
    except Exception as e:
        logger.warning(f"Ad Bark synth failed: {e}")

    audio_url = f"/api/audio/{audio_fname}" if audio_fname else None
    update = {
        "status": "active",
        "paypal_capture_id": capture_id,
        "script": script.strip(),
        "audio_url": audio_url,
        "paid_at": now_iso(),
    }
    await db.ad_campaigns.update_one({"id": campaign_id}, {"$set": update})
    camp.update(update)
    return camp


@api_router.get("/ads", response_model=List[AdCampaign])
async def list_ads(status: Optional[str] = None):
    q = {"status": status} if status else {}
    docs = await db.ad_campaigns.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    return docs


@api_router.get("/ads/next")
async def next_ad():
    doc = await db.ad_campaigns.find_one(
        {"status": "active", "plays_remaining": {"$gt": 0}},
        {"_id": 0},
        sort=[("tier", -1), ("created_at", 1)],  # premium tiers first alphabetically last
    )
    return doc or {}


@api_router.post("/ads/{campaign_id}/mark_played")
async def mark_played(campaign_id: str):
    doc = await db.ad_campaigns.find_one({"id": campaign_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    remaining = max(0, (doc.get("plays_remaining") or 0) - 1)
    new_status = "exhausted" if remaining == 0 else doc.get("status", "active")
    await db.ad_campaigns.update_one({"id": campaign_id}, {"$set": {"plays_remaining": remaining, "status": new_status}})
    return {"plays_remaining": remaining, "status": new_status}


@api_router.get("/ads/revenue")
async def ad_revenue():
    total = 0.0
    active_count = 0
    exhausted_count = 0
    demo_count = 0
    by_tier = {}
    async for c in db.ad_campaigns.find({}, {"_id": 0}):
        if c.get("status") in ("active", "exhausted"):
            total += float(c.get("price_eur") or 0)
            t = c.get("tier", "basic")
            by_tier[t] = by_tier.get(t, 0) + 1
        if c.get("status") == "active":
            active_count += 1
        if c.get("status") == "exhausted":
            exhausted_count += 1
        if c.get("is_demo"):
            demo_count += 1
    return {
        "total_revenue_eur": round(total, 2),
        "active_campaigns": active_count,
        "exhausted_campaigns": exhausted_count,
        "demo_campaigns": demo_count,
        "by_tier": by_tier,
        "currency": "EUR",
        "paypal_mode": paypal_service.current_mode(),
    }


@api_router.get("/ads/{campaign_id}/plays")
async def ad_plays(campaign_id: str):
    docs = await db.ad_plays.find({"campaign_id": campaign_id}, {"_id": 0}).sort("played_at", 1).to_list(500)
    # Bucket by hour of day
    hourly = {h: 0 for h in range(24)}
    for d in docs:
        ts = d.get("played_at", "")
        try:
            hour = datetime.fromisoformat(ts).hour
            hourly[hour] = hourly.get(hour, 0) + 1
        except Exception:
            pass
    # Bucket by day
    daily = {}
    for d in docs:
        ts = d.get("played_at", "")
        try:
            day = ts[:10]
            daily[day] = daily.get(day, 0) + 1
        except Exception:
            pass
    return {
        "campaign_id": campaign_id,
        "total_plays": len(docs),
        "hourly": [{"hour": h, "plays": hourly.get(h, 0)} for h in range(24)],
        "daily": [{"day": k, "plays": v} for k, v in sorted(daily.items())],
        "recent": docs[-20:],
    }


# ----------------------- Telegram integration -----------------------
@api_router.get("/telegram/status")
async def telegram_status():
    return telegram_bot.status()


# ----------------------- HD Audio (HF Spaces) -----------------------
@api_router.get("/audio/{filename}")
async def get_audio(filename: str):
    p = audio_path(filename)
    if not p:
        raise HTTPException(404, "Audio not found")
    return FileResponse(str(p), media_type="audio/wav")


@api_router.post("/segments/{seg_id}/render_hd")
async def render_segment_hd(seg_id: str):
    """Generate real AI audio (Bark speech + Stable Audio music) for a segment."""
    seg = await db.segments.find_one({"id": seg_id}, {"_id": 0})
    if not seg:
        raise HTTPException(404, "Segment not found")

    await db.segments.update_one({"id": seg_id}, {"$set": {"hd_status": "rendering"}})
    speech_url = None
    music_url = None
    try:
        # Speech (Bark)
        if seg.get("script"):
            fname = await synth_speech(seg["script"], seg.get("voice_key") or "female-1")
            if fname:
                speech_url = f"/api/audio/{fname}"
        # Music (Stable Audio) only for music segments
        if seg.get("kind") == "music" and seg.get("track_meta"):
            tm = seg["track_meta"]
            prompt = f"{tm.get('genre','electronic')} {tm.get('mood','')} music, {tm.get('title','')}"
            fname = await synth_music(prompt, seconds=15)
            if fname:
                music_url = f"/api/audio/{fname}"

        status = "ready" if (speech_url or music_url) else "failed"
        update = {"hd_status": status}
        if speech_url:
            update["speech_audio_url"] = speech_url
        if music_url:
            update["music_audio_url"] = music_url
        await db.segments.update_one({"id": seg_id}, {"$set": update})
        cleanup_old(120)
        seg.update(update)
        return seg
    except Exception as e:
        logger.error(f"HD render failed for {seg_id}: {e}")
        await db.segments.update_one({"id": seg_id}, {"$set": {"hd_status": "failed"}})
        raise HTTPException(500, str(e))


# ----------------------- Utility -----------------------
@api_router.get("/")
async def root():
    return {"status": "AI Radio online", "time": now_iso()}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup():
    await ensure_seeded()
    await telegram_bot.start(db)


@app.on_event("shutdown")
async def on_shutdown():
    client.close()
