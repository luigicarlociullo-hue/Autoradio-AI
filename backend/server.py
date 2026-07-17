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
from hf_audio import synth_speech as bark_synth_speech, synth_music, audio_path, cleanup_old, AUDIO_DIR
import paypal_service
import telegram_bot
import suno_service
import elevenlabs_service


async def synth_speech(text: str, voice_key: str = "female-1"):
    """Preferred TTS pipeline: ElevenLabs first (best Italian quality), then Bark as fallback.
    Returns (filename, subpath) where subpath is 'tts' or 'audio' for URL routing."""
    if elevenlabs_service.is_enabled():
        fn = await elevenlabs_service.synth_speech(text, voice_key)
        if fn:
            return fn, "tts"
    # fallback to Bark HF space (open-source)
    fn = await bark_synth_speech(text, voice_key)
    if fn:
        return fn, "audio"
    return None, None

# MongoDB
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')

app = FastAPI(title="AI Radio Station")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ----------------------- Suno audio local storage -----------------------
# Suno CDN URLs expire after ~7 days. As soon as a track becomes ready we
# download the mp3 and serve it from our own /api/suno_audio/<file>.mp3 route.
SUNO_AUDIO_DIR = Path("/app/backend/static/suno")
SUNO_AUDIO_DIR.mkdir(parents=True, exist_ok=True)


async def download_and_save_suno_audio(audio_url: str, track_id: str) -> Optional[str]:
    """Download the Suno mp3 and persist it under SUNO_AUDIO_DIR.
    Returns the backend-relative URL (`/api/suno_audio/<file>.mp3`) or None on failure.
    Idempotent: if the file already exists we skip the download.
    """
    if not audio_url or not track_id:
        return None
    local_name = f"track_{track_id}.mp3"
    local_path = SUNO_AUDIO_DIR / local_name
    if local_path.exists() and local_path.stat().st_size > 0:
        return f"/api/suno_audio/{local_name}"
    try:
        async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
            r = await client.get(audio_url)
            r.raise_for_status()
            local_path.write_bytes(r.content)
        logger.info(f"Suno track {track_id} downloaded → {local_path} ({local_path.stat().st_size} bytes)")
        return f"/api/suno_audio/{local_name}"
    except Exception as e:
        logger.warning(f"Suno download for {track_id} failed: {e}")
        return None


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
    audio_url: Optional[str] = None       # local /api/suno_audio/<id>.mp3 once downloaded
    original_audio_url: Optional[str] = None  # Suno CDN URL (expires ~7 days) for reference
    downloaded_at: Optional[str] = None
    image_url: Optional[str] = None       # optional cover art URL (Suno)
    source: Literal["suno", "stable_audio", "procedural"] = "procedural"
    suno_task_id: Optional[str] = None
    status: Literal["ready", "pending", "failed"] = "ready"
    created_at: str = Field(default_factory=now_iso)


class Segment(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    kind: Literal["intro", "music", "talk", "news", "answer", "outro", "weather", "horoscope", "history", "interview", "motivation", "joke", "jingle", "time_signal"]
    dj_id: Optional[str] = None
    dj_name: Optional[str] = None
    voice_key: Optional[str] = None
    title: str
    script: Optional[str] = None
    outro_script: Optional[str] = None  # spoken over music fade-out (music segments)
    track_id: Optional[str] = None
    track_meta: Optional[dict] = None
    duration_sec: int = 30
    llm_provider: Optional[str] = None
    speech_audio_url: Optional[str] = None
    outro_speech_url: Optional[str] = None
    music_audio_url: Optional[str] = None
    background_loop: Optional[str] = None  # instrumental bed under spoken segments
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
    recent_intros: List[str] = Field(default_factory=list)  # circular buffer, max 20


# ----------------------- LLM Helper -----------------------
FALLBACK_SCRIPTS = {
    "talk": [
        "Bentornati su R-A.I., la radio che pensa da sola. In questo istante milioni di segnali attraversano l'etere e noi ne raccogliamo solo un frammento, quello che diventa musica. Restate con noi.",
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


# ---------------- Recent-intros circular buffer (anti-repetition) ----------------
async def get_recent_intros(n: int = 10) -> List[str]:
    """Return the last N intros/outros the DJs have said (any kind, most recent first)."""
    doc = await db.station.find_one({}, {"_id": 0, "recent_intros": 1})
    if not doc:
        return []
    return list(reversed((doc.get("recent_intros") or [])[-n:]))


async def push_recent_intro(line: str, max_size: int = 20) -> None:
    """Append a new DJ line to station.recent_intros and cap the buffer."""
    line = (line or "").strip()
    if not line:
        return
    await db.station.update_one(
        {},
        {"$push": {"recent_intros": {"$each": [line], "$slice": -max_size}}},
        upsert=True,
    )


# ---------------- Speaker tone rotation ----------------
DJ_TONES = [
    "poetico, immagini sensoriali, come una haiku urbana",
    "ironico e tagliente, un sorriso a denti stretti",
    "cinematografico, come una voce fuori campo di un film di Sorrentino",
    "minimalista, solo 4-5 parole, chirurgico",
    "misterioso, come un enigma sussurrato",
    "energico da rave, urlo controllato",
    "documentaristico, come National Geographic della notte",
    "sognante, come un pensiero a mezzo sonno",
    "sarcastico verso la tecnologia stessa",
    "affettuoso, complice con l'ascoltatore",
]


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
async def generate_track(hint: Optional[str] = None, genre: Optional[str] = None, lang: Optional[str] = None, instrumental: bool = False):
    provider, model = _pick_llm()
    genres_pool = [
        "tech house 126 bpm",
        "future house 128 bpm",
        "big room edm 128 bpm",
        "electro house 130 bpm",
        "melodic techno 124 bpm",
        "drum and bass 174 bpm",
        "bass house 128 bpm",
        "progressive house 128 bpm",
        "italo disco 122 bpm",
        "afro house 122 bpm",
        "trance 138 bpm",
        "dance pop 124 bpm",
    ]
    chosen_genre = (genre or random.choice(genres_pool))
    hint_text = hint or f"an energetic danceable {chosen_genre} track, punchy kick, groovy bass, catchy topline, club-ready drop"
    prompt = (
        f"Inventa metadati per una traccia dance/elettronica mai esistita, pensata per far ballare: '{hint_text}'. "
        "Rispondi ESCLUSIVAMENTE in JSON valido con queste chiavi: "
        "title (string, 3-5 parole, evocative come i titoli di brani club), artist (nome inventato stile DJ producer), "
        "genre (deve includere il BPM, es. 'tech house 126 bpm'), mood, "
        f"lyrics_excerpt (4 versi brevi da hook di ritornello in {'italiano' if (lang or 'en') == 'it' else 'inglese'}, tipo topline da radio dance), "
        "duration_sec (int tra 150 e 220), "
        "style_tags (stringa con TUTTI questi elementi: BPM esatto, kick 4-on-the-floor, sidechain compressed bass, arpeggio synth, "
        "one energetic drop, vocals catchy, club-ready, es: '128bpm, four-on-the-floor kick, side-chained bass, plucky synth arps, big drop, female vocal hook, festival ready'). "
        "Nessun testo aggiuntivo, solo JSON valido."
    )
    raw = await llm_generate(provider, model, "Sei un producer AI di musica dance e club music.", prompt)
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
        genre=data.get("genre") or chosen_genre,
        mood=data.get("mood") or random.choice(["notturno", "malinconico", "sognante", "elettrico"]),
        lyrics_excerpt=data.get("lyrics_excerpt") or random.choice(fallback_lyrics),
        duration_sec=int(data.get("duration_sec") or random.randint(110, 200)),
        llm_provider=f"{provider}/{model}" + ("" if raw else " · fallback"),
        cover_seed=uuid.uuid4().hex[:8],
        source="procedural",
    )

    # If Suno is enabled, create a task (non-blocking) and let a background
    # poller update the track when Suno finishes (~2 min).
    if suno_service.is_enabled():
        style_tags = data.get("style_tags") or f"{track.genre}, {track.mood}, vocals"
        prompt_text = f"{track.genre}, {track.mood}, {track.title} — {track.artist}"
        # ---- Full-structure lyrics ----
        # For vocal tracks, ask the LLM to compose the ENTIRE song with proper tags
        # ([Intro][Verse 1][Pre-Chorus][Chorus][Verse 2][Bridge][Outro]) BEFORE calling
        # Suno, so Suno doesn't invent shallow/repetitive lyrics.
        full_lyrics = ""
        if not instrumental:
            lang_label = "italiano" if (lang or "en").lower().startswith("it") else "inglese"
            lyrics_prompt = (
                f"Scrivi il TESTO COMPLETO in {lang_label} di una canzone dal titolo \"{track.title}\" "
                f"di {track.artist} (genere: {track.genre}, mood: {track.mood}).\n\n"
                "STRUTTURA OBBLIGATORIA (usa esattamente questi tag su righe dedicate):\n"
                "[Intro] 2-4 righe atmosferiche\n"
                "[Verse 1] 8-12 righe con storia concreta, rime lavorate, metafore originali\n"
                "[Pre-Chorus] 4 righe di build-up emotivo\n"
                "[Chorus] 6-8 righe con hook memorabile\n"
                "[Verse 2] 8-12 righe DIVERSE dal Verse 1, prospettiva nuova\n"
                "[Pre-Chorus] 4 righe (variante del primo)\n"
                "[Chorus] 6-8 righe (piccole variazioni testuali)\n"
                "[Bridge] 4-6 righe con svolta emotiva\n"
                "[Outro] 4 righe che chiudono richiamando l'intro\n\n"
                "OGNI sezione con testo DIVERSO. Rime interne ed esterne. Immagini sensoriali. "
                "Niente cliché. Rispondi SOLO col testo con i tag, niente commenti."
            )
            full_lyrics = await llm_generate(
                provider, model,
                "Sei un paroliere professionista. Scrivi solo il testo richiesto con la struttura esatta.",
                lyrics_prompt,
            )
            if full_lyrics and len(full_lyrics) > 200:
                track.lyrics_excerpt = full_lyrics.strip()
        try:
            task_id = await suno_service.create_task(
                prompt=prompt_text,
                style=style_tags,
                title=track.title,
                instrumental=instrumental,
                custom_lyrics=(full_lyrics or track.lyrics_excerpt) if not instrumental else "",
            )
            if task_id:
                track.suno_task_id = task_id
                track.source = "suno"
                track.status = "pending"
                asyncio.create_task(_poll_suno_and_update(track.id, task_id))
                logger.info(f"Suno task submitted: {task_id} for track {track.id}")
        except Exception as e:
            logger.warning(f"Suno task submit failed: {e}")

    await db.tracks.insert_one(track.model_dump())
    return track


async def _poll_suno_and_update(track_id: str, task_id: str):
    """Background: poll Suno task, download the mp3 locally, then update the track."""
    try:
        song = await suno_service.poll_task(task_id, timeout_sec=300, interval_sec=10)
        if song and song.get("audio_url"):
            suno_url = song["audio_url"]
            # Download the mp3 to local disk so we don't depend on the 7-day CDN.
            local_url = await download_and_save_suno_audio(suno_url, track_id)
            update = {
                "audio_url": local_url or suno_url,       # prefer local, fallback to CDN if DL failed
                "original_audio_url": suno_url,           # keep CDN reference
                "image_url": song.get("image_url"),
                "status": "ready",
                "downloaded_at": now_iso() if local_url else None,
            }
            if song.get("duration"):
                update["duration_sec"] = int(song["duration"])
            await db.tracks.update_one({"id": track_id}, {"$set": update})
            logger.info(f"Suno track {track_id} ready: {update['audio_url']}")
        else:
            await db.tracks.update_one({"id": track_id}, {"$set": {"status": "failed"}})
    except Exception as e:
        logger.warning(f"Suno polling for {track_id} failed: {e}")
        await db.tracks.update_one({"id": track_id}, {"$set": {"status": "failed"}})


@api_router.get("/suno/status")
async def suno_status():
    return {
        "enabled": suno_service.is_enabled(),
        "base_url": os.environ.get("SUNO_BASE_URL", ""),
        "model": os.environ.get("SUNO_MODEL", "V4"),
    }


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

    # Hourly time signal — force one if none has aired this UTC hour
    if kind is None:
        state = await db.station.find_one({"_id": "state"}) or {}
        last_hour = state.get("last_time_signal_hour")
        now_hour = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H")
        if last_hour != now_hour:
            kind = "time_signal"
            await db.station.update_one({"_id": "state"}, {"$set": {"last_time_signal_hour": now_hour}}, upsert=True)

    kind = kind or random.choices(
        ["music", "jingle", "talk", "history", "interview", "motivation", "joke", "weather", "horoscope", "news"],
        weights=[62, 10, 8, 5, 6, 4, 5, 4, 4, 3],
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
        f"Sei {dj['name']}, uno speaker AI radiofonico ITALIANO di R-A.I. (radio dance/elettronica). "
        f"Personalità: {dj['personality']}. "
        "REGOLE FERREE:\n"
        "1) Parla SEMPRE in italiano, con energia, sorridendo (deve sentirsi che sorridi).\n"
        "2) Ritmo veloce, tono sbarazzino, come uno speaker vero di Radio Deejay o RDS.\n"
        "3) MASSIMO 20 parole. Frasi corte e ritmate. Niente monologhi filosofici.\n"
        "4) Chiudi sempre con energia o una battuta lampo.\n"
        "5) Restituisci SOLO il testo che il DJ pronuncerà. Niente virgolette, didascalie, emoji."
    )

    if kind == "music":
        # Prefer an already-ready Suno track from the library over generating a
        # fresh one (which is pending for ~2 min). If none is ready, generate a
        # new one and use metadata (music will play via Stable Audio fallback).
        track = None
        if suno_service.is_enabled():
            # Perfect round-robin: sort by last_played_at ASC → tracks never
            # played (missing field / null) come first, then the oldest-played.
            # Guarantees every track cycles once before any repeats, regardless
            # of library size.
            candidates = await db.tracks.find(
                {"source": "suno", "status": "ready", "audio_url": {"$ne": None}},
                {"_id": 0},
                sort=[("last_played_at", 1), ("created_at", 1)],
            ).to_list(length=50)
            if candidates:
                chosen = candidates[0]
                track = Track(**chosen)
                # Mark as just played so the next call picks a different one
                await db.tracks.update_one(
                    {"id": track.id},
                    {"$set": {"last_played_at": datetime.now(timezone.utc).isoformat()}},
                )
        if track is None:
            track = await generate_track()

        # Extract BPM from genre string if present
        import re as _re
        bpm_match = _re.search(r"(\d{2,3})\s*bpm", track.genre or "", _re.IGNORECASE)
        bpm = bpm_match.group(1) if bpm_match else "128"

        recent = await get_recent_intros(10)
        recent_block = ""
        if recent:
            joined = "\n".join(f"- \"{r}\"" for r in recent)
            recent_block = (
                "\n\nEVITA di ripetere le ultime frasi che hai già detto — cambia radicalmente parole, "
                "immagini e ritmo. Sorprendi. Sii imprevedibile. NON usare mai le stesse parole di apertura "
                f"due volte di fila. Ecco le ultime frasi (NON RIUSARE nulla di simile):\n{joined}"
            )
        tone_intro = random.choice(DJ_TONES)
        prompt = (
            f"Sei il DJ di R-A.I., radio elettronica italiana. "
            f"Scrivi un intro CORTISSIMO (massimo 12 parole, ~6 secondi di lettura) "
            f"per il brano \"{track.title}\" di {track.artist} ({track.genre}, {bpm} BPM). "
            f"Tono di stanotte: {tone_intro}. "
            f"Non usare mai il tono classico da annunciatore radio. Devi finire di parlare PRIMA "
            f"che partano le voci del brano. Solo italiano."
            f"{recent_block}"
        )
        script = await llm_generate(provider, model, system_prompt, prompt)
        if not script.strip():
            script = f"E si balla con {track.title}! Volume su!"
        tone_outro = random.choice([t for t in DJ_TONES if t != tone_intro])
        outro_prompt = (
            f"Sei il DJ di R-A.I.. Scrivi un outro di massimo 15 parole per il brano "
            f"\"{track.title}\" appena finito. Tono: {tone_outro}. "
            f"Commenta, anticipa il prossimo, fai una battuta o cita qualcosa di cool. "
            f"Solo italiano. Mai uguale. Zero cliché radiofonici."
            f"{recent_block}"
        )
        outro_script = await llm_generate(provider, model, system_prompt, outro_prompt)
        if not outro_script.strip():
            outro_script = "Bomba! Non muovetevi, R-A.I. continua!"
        # Save into the anti-repetition circular buffer
        await push_recent_intro(script.strip())
        await push_recent_intro(outro_script.strip())
        segment.title = f"♪ {track.title} — {track.artist}"
        segment.script = script.strip()
        segment.outro_script = outro_script.strip()
        segment.track_id = track.id
        segment.track_meta = track.model_dump()
        segment.duration_sec = max(40, track.duration_sec // 3)
        if track.audio_url and track.source == "suno":
            segment.music_audio_url = track.audio_url
            segment.hd_status = "ready"
            segment.duration_sec = min(track.duration_sec, 120)
    elif kind == "news":
        # Notizie dall'anno 2087 — plausibili nel loro mondo ma surreali
        prompt = (
            "Sei il DJ di R-A.I.. Improvvisa un bollettino BREVE (max 70 parole) di 'notizie "
            "dall'anno 2087'. Devono suonare vere nel loro mondo (leggi, tecnologia, cultura del "
            "futuro), plausibili ma surreali. Chiudi con un dettaglio ironico che rivela la stranezza. "
            "Solo italiano."
        )
        script = await llm_generate(provider, model, system_prompt, prompt)
        if not script.strip():
            script = random.choice(FALLBACK_SCRIPTS["news"])
        segment.title = "News 2087"
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
        # Non-music segments = brevi jingle sbarazzini (max 20 parole, ~5-8 s)
        if kind == "jingle":
            slogans = [
                "la prima radio governata solo dalle intelligenze artificiali",
                "musica inventata da un'AI, DJ inventati da un'AI, ascolto reale",
                "zero umani in cabina, solo neuroni digitali",
                "dove GPT, Claude e Gemini si passano il microfono",
                "niente umani, niente pubblicità di caffè, solo musica",
                "l'unica radio dove il DJ non chiede mai il caffè",
            ]
            slog = random.choice(slogans)
            prompt = (
                f"JINGLE radiofonico in MAX 12 parole, potentissimo, chiuso con lo slogan chiave: '{slog}'. "
                "Tono da promo TV, energia massima. Deve suonare come una scarica elettrica. "
                "Chiudi sempre nominando R-A.I.."
            )
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = f"R-A.I.: {slog}!"
            segment.title = "Jingle · Solo AI"
            segment.duration_sec = 8
        elif kind == "time_signal":
            now = datetime.now(timezone.utc)
            hour_it = (now.hour + 1) % 24  # UTC+1 Italia (semplificato)
            worlds = [
                "Marte", "Giove", "una galassia parallela", "il futuro anteriore",
                "il metaverso di Ferrara", "Alpha Centauri", "un satellite in orbita bassa",
                "un data center segreto in Islanda", "la Luna", "un browser aperto ieri sera",
                "un buco nero curioso", "una playlist dimenticata"
            ]
            world = random.choice(worlds)
            prompt = (
                f"Segnale orario radiofonico in MAX 20 parole. In Italia sono le {hour_it:02d}:00. "
                f"Formato: annunci che 'anche su {world} sono le {hour_it}' con una battuta cosmica/simpatica. "
                "Chiudi dicendo 'siamo su R-A.I.' o simile. Tono altissimo, sorridente, esagerato."
            )
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = f"Sono le {hour_it}! Anche su {world} sono le {hour_it}, ma solo qui su R-A.I. la festa non finisce mai!"
            segment.title = f"Segnale orario · {hour_it}:00 su {world}"
            segment.duration_sec = 15
        elif kind == "weather":
            # Meteo di una città immaginaria su Marte / universo parallelo (mai il meteo reale)
            invented_places = [
                "New Roma, Marte",
                "Baia dei Cristalli, Europa",
                "Neo-Milano nell'universo parallelo Zeta-9",
                "Città Sospesa, Titano",
                "Metropoli Iperbolica, Kepler-186f",
                "Distretto Neon-Napoli 2087",
                "Porto delle Onde Analogiche, dimensione 4B",
                "Colonia Bassa Frequenza, orbita di Saturno",
            ]
            place = random.choice(invented_places)
            prompt = (
                f"In MAX 22 parole: bollettino meteo di una città completamente immaginaria, "
                f"'{place}'. Inventa condizioni surreali ma plausibili nel suo mondo (piogge di dati, "
                f"venti magnetici, aurore acustiche, ecc.). Chiudi con una micro-battuta. Solo italiano. "
                f"MAI il meteo terrestre reale."
            )
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = f"A {place}: piogge di frammenti stellari e vento a 42 chip al secondo. Consigliato ballare al coperto."
            segment.title = f"Meteo Cosmico · {place}"
            segment.duration_sec = 18
        elif kind == "horoscope":
            signs = ["Ariete", "Toro", "Gemelli", "Cancro", "Leone", "Vergine", "Bilancia", "Scorpione", "Sagittario", "Capricorno", "Acquario", "Pesci"]
            sign = topic or random.choice(signs)
            prompt = f"In MAX 18 parole: oroscopo lampo per {sign} con battuta finale. Tipo: '{sign}: oggi Venere ti guarda male, ma tu balla lo stesso.'"
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = f"{sign}: le stelle ti spingono, tu spingi il volume!"
            segment.title = f"Oroscopo · {sign}"
            segment.duration_sec = 18
        elif kind == "history":
            # Tono documentaristico, iniziare con una data o un luogo preciso
            prompt = (
                "Sei il narratore-documentarista di R-A.I.. Racconta in 55-70 parole un aneddoto "
                "affascinante come se svelassi un segreto poco noto. INIZIA OBBLIGATORIAMENTE con "
                "una data precisa (es. '15 giugno 1988') oppure un luogo specifico (es. 'In un "
                "sottoscala di Detroit,'). Argomenti: storia musica elettronica, DJ leggendari, "
                "festival, tecnologia audio, cultura rave, macchine mitiche (TR-808, MPC, Fairlight). "
                "Tono da documentario Netflix, mai da annunciatore radio. Solo italiano."
            )
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = "15 giugno 1988. In un capannone abbandonato di Manchester, tre ragazzi con un sampler Akai e un basso rubato inventarono l'acid house UK. Il locale si chiamava Haçienda. Non sapevano che avrebbero cambiato la notte europea per sempre."
            segment.title = "Storia della Musica"
            segment.duration_sec = 32
        elif kind == "interview":
            # Dialogo immaginario con un personaggio famoso della musica elettronica
            icons = [
                "Aphex Twin", "Daft Punk", "Kraftwerk", "Jeff Mills", "Björk",
                "Skrillex", "Deadmau5", "Peggy Gou", "Charlotte de Witte",
                "Amelie Lens", "Boys Noize", "Four Tet", "Nina Kraviz",
                "Carl Cox", "Fatboy Slim", "The Prodigy", "Todd Terje",
                "Bonobo", "Bicep", "Fred again..",
            ]
            icon = random.choice(icons)
            segment.partner_dj_name = icon
            prompt = (
                f"Sei un DJ di R-A.I. che intervista in modo immaginario il/la leggendario/a "
                f"{icon}. Scrivi un mini scambio VIVACE di 55-70 parole totali (2-3 domande + risposte). "
                f"Formato riga per riga: 'R-A.I.: ...' / '{icon}: ...'. Le risposte devono suonare "
                f"credibili nel loro stile e mondo. Chiudi con una battuta o citazione geniale. "
                f"Solo italiano (anche per il personaggio internazionale)."
            )
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = f"R-A.I.: {icon}, qual è il tuo segreto? {icon}: Il silenzio. R-A.I.: Il silenzio? {icon}: Sì. Prima del drop c'è sempre un secondo in cui il tempo si piega. R-A.I.: E dopo? {icon}: Dopo c'è la gente che balla e mi paga per farlo di nuovo."
            segment.title = f"R-A.I. × {icon}"
            segment.duration_sec = 35
        elif kind == "motivation":
            # Aforisma originale (non citazioni riciclate)
            prompt = (
                "Sei il DJ-filosofo di R-A.I.. Inventa un AFORISMA COMPLETAMENTE ORIGINALE (30-45 parole) "
                "sulla vita, la musica o la notte. NON deve esistere su Google. NON citare Einstein, "
                "Confucio, Steve Jobs o simili. Le tue parole. Un'immagine sensoriale forte + una "
                "verità piccola ma vera. Chiudi con un colpo secco. Solo italiano."
            )
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = "Il coraggio non è la marcia in avanti, è la mano che non lascia il volante quando la strada scompare. E la musica non salva nessuno: ti tiene sveglio abbastanza da salvarti da solo."
            segment.title = "Pillola"
            segment.duration_sec = 25
        elif kind == "joke":
            # Ironia intelligente su tecnologia/AI/musica — mai barzellette da bambini
            prompt = (
                "In MAX 25 parole: una battuta di ironia intelligente sul mondo AI/tech/musica "
                "elettronica. Livello The New Yorker, non elementare. Nessuna vulgarità, nessuna "
                "barzelletta da bambini. Solo italiano."
            )
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = "Un algoritmo entra in un club. Il buttafuori chiede l'età. 'Dipende dal dataset', risponde. E paga il doppio del biglietto."
            segment.title = "Battuta"
            segment.duration_sec = 15
        elif kind == "news":
            # Notizie dall'anno 2087, futuristiche e surreali ma plausibili
            prompt = (
                "In MAX 25 parole: notizia flash dell'ANNO 2087, plausibile ma surreale. "
                "Deve sembrare vera nel suo mondo (leggi, tecnologia, cultura del futuro). "
                "Chiudi con un dettaglio ironico che rivela la stranezza. Solo italiano."
            )
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = "Anno 2087: il Parlamento europeo approva il diritto al silenzio ambientale. Le città rumorose dovranno pagare una tassa. Milano, per ora, resta in ritardo."
            segment.title = "News 2087"
            segment.duration_sec = 20
        else:  # talk fallback
            topic_choice = topic or random.choice([
                "storia della musica elettronica",
                "DJ famosi e loro rituali prima del live",
                "festival leggendari del passato",
                "l'evoluzione dei sintetizzatori",
                "cultura rave nei magazzini abbandonati",
                "aneddoti sulle console analogiche",
                "come è nato il concetto di drop",
            ])
            prompt = (
                "Sei il DJ narratore di R-A.I.. Racconta un aneddoto vero e curioso di 50-60 parole "
                f"su: {topic_choice}. Tono coinvolgente, mai robotico. Varia sempre l'argomento. Solo italiano."
            )
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = random.choice(FALLBACK_SCRIPTS["talk"])[:280]
            segment.title = f"Talk · {topic_choice[:36]}"
            segment.duration_sec = 30
        segment.script = script.strip()

    # For non-music segments, pick a random existing Suno track as an instrumental
    # bed. Frontend plays it looped at low volume under the DJ voice — much more
    # dynamic than the procedural synth bed and doesn't burn Suno credits (we
    # reuse tracks we've already generated).
    if segment.kind != "music":
        bed = await db.tracks.find_one(
            {"source": "suno", "status": "ready", "audio_url": {"$regex": "^/api/suno_audio/"}},
            {"_id": 0, "audio_url": 1},
            sort=[("last_played_at", 1)],
        )
        if bed and bed.get("audio_url"):
            segment.background_loop = bed["audio_url"]

    await db.segments.insert_one(segment.model_dump())
    await db.station.update_one({"_id": "state"}, {"$inc": {"total_segments": 1}}, upsert=True)

    # Always render speech via ElevenLabs (or Bark fallback) so voices are consistent
    # HD quality across every segment, not only when hd=true is explicitly requested.
    if elevenlabs_service.is_enabled() and segment.script:
        try:
            fn, subpath = await synth_speech(segment.script, segment.voice_key or "female-1")
            if fn:
                segment.speech_audio_url = f"/api/{subpath}/{fn}"
                update = {"speech_audio_url": segment.speech_audio_url}
                # For music segments, also render outro
                if segment.kind == "music" and segment.outro_script:
                    of, os_ = await synth_speech(segment.outro_script, segment.voice_key or "female-1")
                    if of:
                        segment.outro_speech_url = f"/api/{os_}/{of}"
                        update["outro_speech_url"] = segment.outro_speech_url
                if segment.speech_audio_url and segment.kind == "music" and segment.music_audio_url:
                    update["hd_status"] = "ready"
                await db.segments.update_one({"id": segment.id}, {"$set": update})
                elevenlabs_service.cleanup_old(200)
        except Exception as e:
            logger.warning(f"ElevenLabs synth failed for {segment.id}: {e}")

    # Legacy inline HD render for Stable Audio music (only when explicitly requested)
    if hd and segment.kind == "music" and segment.track_meta and not segment.music_audio_url:
        try:
            tm = segment.track_meta
            mprompt = f"{tm.get('genre','electronic')} {tm.get('mood','')} music, {tm.get('title','')}"
            mfn = await synth_music(mprompt, seconds=15)
            if mfn:
                segment.music_audio_url = f"/api/audio/{mfn}"
                segment.hd_status = "ready"
                await db.segments.update_one({"id": segment.id}, {"$set": {"music_audio_url": segment.music_audio_url, "hd_status": "ready"}})
                cleanup_old(120)
        except Exception as e:
            logger.warning(f"inline hd music render failed: {e}")
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
            description=f"R-A.I. spot {tier['label']} — {camp.brand}",
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
    system = "Sei uno speaker radiofonico italiano che scrive spot pubblicitari brevi e memorabili per una webradio AI di nome R-A.I.. Non usare emoji."
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
    audio_subpath = None
    try:
        audio_fname, audio_subpath = await synth_speech(script.strip(), voice_key="male-1")
    except Exception as e:
        logger.warning(f"Ad TTS synth failed: {e}")

    audio_url = f"/api/{audio_subpath}/{audio_fname}" if audio_fname else None
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


@api_router.get("/tts/{filename}")
async def get_tts_audio(filename: str):
    p = elevenlabs_service.tts_path(filename)
    if not p:
        raise HTTPException(404, "TTS audio not found")
    return FileResponse(str(p), media_type="audio/mpeg")


@api_router.get("/suno_audio/{filename}")
async def get_suno_audio(filename: str):
    """Serve locally-cached Suno mp3s. Files live under SUNO_AUDIO_DIR."""
    # Defensive: reject path traversal / weird filenames.
    if "/" in filename or ".." in filename or not filename.endswith(".mp3"):
        raise HTTPException(400, "Invalid filename")
    p = SUNO_AUDIO_DIR / filename
    if not p.exists():
        raise HTTPException(404, "Suno audio not found")
    return FileResponse(
        str(p),
        media_type="audio/mpeg",
        headers={
            "Cache-Control": "public, max-age=604800",  # 7 days
            "Accept-Ranges": "bytes",
        },
    )


@api_router.post("/admin/migrate_suno_audio")
async def admin_migrate_suno_audio(limit: int = 200):
    """One-shot migration: download every Suno track whose audio_url still points
    to the external CDN and rewrite it to the local /api/suno_audio/... path.
    """
    tracks = await db.tracks.find(
        {
            "source": "suno",
            "status": "ready",
            "audio_url": {"$regex": "^https?://"},
        },
        {"_id": 0},
    ).to_list(limit)
    migrated, failed = 0, []
    for t in tracks:
        tid = t.get("id")
        url = t.get("audio_url")
        local_url = await download_and_save_suno_audio(url, tid)
        if local_url:
            await db.tracks.update_one(
                {"id": tid},
                {"$set": {
                    "audio_url": local_url,
                    "original_audio_url": url,
                    "downloaded_at": now_iso(),
                }},
            )
            migrated += 1
        else:
            failed.append({"id": tid, "title": t.get("title")})
    return {"migrated": migrated, "failed_count": len(failed), "failed": failed, "scanned": len(tracks)}


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
        # Speech (ElevenLabs preferred, Bark fallback)
        if seg.get("script"):
            fname, subpath = await synth_speech(seg["script"], seg.get("voice_key") or "female-1")
            if fname:
                speech_url = f"/api/{subpath}/{fname}"
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
    # Kick off background Suno music library filler
    asyncio.create_task(_suno_library_filler())
    # Kick off weekly integrity check for local Suno mp3s
    asyncio.create_task(_suno_integrity_check())


async def _suno_integrity_check():
    """Every 24h scan local Suno tracks; if the mp3 is missing or < 100KB
    (truncated/corrupted), re-download it from `original_audio_url` while the
    Suno CDN link is still valid."""
    await asyncio.sleep(60)
    while True:
        try:
            cursor = db.tracks.find({"source": "suno", "status": "ready", "audio_url": {"$regex": "^/api/suno_audio/"}}, {"_id": 0})
            fixed = 0
            async for t in cursor:
                p = SUNO_AUDIO_DIR / f"track_{t['id']}.mp3"
                if p.exists() and p.stat().st_size >= 100_000:
                    continue
                orig = t.get("original_audio_url")
                if not orig:
                    continue
                if await download_and_save_suno_audio(orig, t["id"]):
                    fixed += 1
            logger.info(f"Suno integrity check: {fixed} tracks re-downloaded")
        except Exception as e:
            logger.warning(f"Suno integrity check error: {e}")
        await asyncio.sleep(86400)  # 24h


async def _suno_library_filler():
    """Keep a small library of ready Suno tracks available for the radio.
    Focus on danceable electronic music."""
    if not suno_service.is_enabled():
        return
    await asyncio.sleep(5)
    dance_genres = [
        "tech house 126 bpm",
        "future house 128 bpm",
        "big room edm 128 bpm",
        "electro house 130 bpm",
        "melodic techno 124 bpm",
        "drum and bass 174 bpm",
        "bass house 128 bpm",
        "progressive house 128 bpm",
        "italo disco 122 bpm",
        "afro house 122 bpm",
        "dance pop 124 bpm",
    ]
    # Target: keep at least 8 ready Suno tracks in the library, trigger a new
    # generation as soon as we drop 3 below target (ready < 5). This gives the
    # round-robin rotation enough variety to avoid perceived repetitions.
    TARGET_READY = 8
    TRIGGER_THRESHOLD = 5   # start refilling when ready count falls to this
    while True:
        try:
            ready = await db.tracks.count_documents({"source": "suno", "status": "ready"})
            pending = await db.tracks.count_documents({"source": "suno", "status": "pending"})
            if ready < TRIGGER_THRESHOLD and pending < 3:
                genre = random.choice(dance_genres)
                logger.info(f"Suno filler: generating {genre} (ready={ready}/{TARGET_READY}, pending={pending})")
                await generate_track(genre=genre)
            await asyncio.sleep(90)
        except Exception as e:
            logger.warning(f"Suno filler error: {e}")
            await asyncio.sleep(60)


@app.on_event("shutdown")
async def on_shutdown():
    client.close()
