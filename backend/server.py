from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Cookie, Header, UploadFile, File, Form
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse
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
import object_storage


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

# ----------------------- Community "A.I. Vs Umani" -----------------------
# Utenti pubblici caricano loro MP3 dal form /submit. Salvati qui + persistiti
# su Emergent Object Storage (se attivo). Sempre inseriti con status="off" —
# l'admin li ascolta e li attiva dal pannello Community.
COMMUNITY_AUDIO_DIR = Path("/app/backend/static/community")
COMMUNITY_AUDIO_DIR.mkdir(parents=True, exist_ok=True)

def _suno_autogen_enabled() -> bool:
    """Read SUNO_AUTOGEN_ENABLED env var (default true).
    When false, ALL automatic Suno API calls (background filler + segment
    fallback) are blocked. Only explicit user endpoints keep working."""
    return os.environ.get("SUNO_AUTOGEN_ENABLED", "true").strip().lower() not in ("false", "0", "no", "off")


def _suno_library_target() -> int:
    """Read SUNO_LIBRARY_TARGET env var (default 10)."""
    try:
        return max(0, int(os.environ.get("SUNO_LIBRARY_TARGET", "10")))
    except ValueError:
        return 10




async def download_and_save_suno_audio(audio_url: str, track_id: str) -> Optional[str]:
    """Download the Suno mp3 and persist it under SUNO_AUDIO_DIR.
    Returns the backend-relative URL (`/api/suno_audio/<file>.mp3`) or None on failure.
    Idempotent: if the file already exists we skip the download.
    When USE_OBJECT_STORAGE=true, the file is *also* pushed to Emergent
    Object Storage so that other environments (e.g. production r-ai.it)
    can serve it via the same /api/suno_audio/<file>.mp3 URL.
    """
    if not audio_url or not track_id:
        return None
    local_name = f"track_{track_id}.mp3"
    local_path = SUNO_AUDIO_DIR / local_name
    if local_path.exists() and local_path.stat().st_size > 0:
        # Already on disk — best-effort push to object storage (idempotent).
        if object_storage.is_enabled():
            try:
                await object_storage.upload_local_file(str(local_path), f"suno/{local_name}")
            except Exception:
                pass
        return f"/api/suno_audio/{local_name}"
    try:
        async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
            r = await client.get(audio_url)
            r.raise_for_status()
            local_path.write_bytes(r.content)
        logger.info(f"Suno track {track_id} downloaded → {local_path} ({local_path.stat().st_size} bytes)")
        if object_storage.is_enabled():
            try:
                await object_storage.put_mp3(f"suno/{local_name}", r.content)
            except Exception:
                pass
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
    source: Literal["suno", "stable_audio", "procedural", "admin_upload"] = "procedural"
    is_anthem: bool = False               # official R-A.I. anthem — played periodically as jingle
    is_jingle: bool = False               # short R-A.I. station jingle — played between segments
    on_air: bool = True                   # admin toggle: if False, excluded from rotation
    suno_task_id: Optional[str] = None
    status: Literal["ready", "pending", "failed", "retired", "disabled"] = "ready"
    created_at: str = Field(default_factory=now_iso)


class Segment(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    kind: Literal["intro", "music", "talk", "news", "answer", "outro", "weather", "horoscope", "history", "interview", "motivation", "joke", "jingle", "time_signal", "ad_spot", "community"]
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
    # "A.I. Vs Umani" community block: jingle intro + DJ line + community track + jingle CTA outro
    pre_jingle_url: Optional[str] = None
    post_jingle_url: Optional[str] = None
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
    recent_ads: List[str] = Field(default_factory=list)     # circular buffer, max 10 (surreal fake ads)


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
    "ad_spot": [
        (
            "SolarLuna! La prima crema solare per chi lavora di notte. "
            "Formula al fosforo lunare arricchito, testata su vampiri professionisti e amanti del turno "
            "delle tre del mattino. Applicala prima di uscire e brillerai come un lampione ecologico. "
            "SolarLuna: perché il sole è ovunque, anche quando non c'è. "
            "Sconto del 40% se lo compri mentre sbadigli."
        ),
        (
            "Presentiamo Silenzio Premium, l'abbonamento mensile al silenzio assoluto. "
            "Diciannove euro e novantanove centesimi al mese per accedere al nostro cloud di silenzi "
            "curati: silenzio di biblioteca, silenzio di monaci tibetani, silenzio del vicino andato in "
            "vacanza. Streaming a bit rate zero, garantito. "
            "Silenzio Premium: il rumore non ti serve, ce lo prendiamo noi."
        ),
        (
            "Nuovo! Le Pigrini, le sneakers ufficiali per pigri certificati. "
            "Solette in memory foam che ricordano il divano da cui sei venuto, chiusura magnetica "
            "perché piegarsi è un affronto personale, e un chip integrato che chiama il rider "
            "quando ti fermi più di dieci minuti. "
            "Le Pigrini: cammina meno, arrivi comunque. Modello 'Domenica Eterna' in offerta lancio."
        ),
        (
            "Iscriviti ora a MemoriaLite, il primo corso online per DIMENTICARE le cose inutili. "
            "Sessantasei lezioni video per liberarti dal Wi-Fi dell'ex, dalla password di Yahoo del "
            "duemilasei, e dai testi delle sigle dei cartoni animati che ti perseguitano da trent'anni. "
            "Certificato finale rilasciato dall'Ordine dei Neuroni Stanchi. "
            "MemoriaLite: alleggerisci il cervello, non la carta di credito."
        ),
        (
            "Nuova fragranza: Codex Fresh, il primo profumo che odora di algoritmi appena compilati. "
            "Note di testa: sintassi corretta e caffè lungo. Note di cuore: bug risolto alle tre di "
            "notte. Fondo: server room a diciotto gradi. "
            "Perfetto per developer, product manager e chiunque voglia flirtare con l'ingegnera "
            "del team back-end. Codex Fresh: profuma di codice pulito. Bottiglietta ergonomica anti-crampi da tastiera."
        ),
    ],
}


class LLMBudgetExhaustedError(Exception):
    """Sollevata quando i crediti dell'Universal Key sono esauriti (o rate-limitati).
    I chiamanti critici (batch di generazione musicale, `generate_track`) devono
    catturare questa eccezione per FERMARSI invece di ricadere su fallback
    hardcoded che sprecherebbe crediti Suno (lyrics duplicate/vuote)."""
    pass



async def _llm_direct_openai(system_prompt: str, user_prompt: str, model: str = "gpt-5.2") -> str:
    """Direct OpenAI-compatible call to the Emergent LLM gateway.
    Uses OPENAI_API_KEY + OPENAI_BASE_URL from env. Bypasses the Universal-Key
    budget so it works even when LlmChat is throttled.
    """
    key = os.environ.get("OPENAI_API_KEY")
    base = os.environ.get("OPENAI_BASE_URL")
    if not key or not base:
        return ""
    url = f"{base.rstrip('/')}/chat/completions"
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=60) as h:
            r = await h.post(url, headers=headers, json=payload)
            r.raise_for_status()
            data = r.json()
            return (data.get("choices") or [{}])[0].get("message", {}).get("content", "") or ""
    except Exception as e:
        logger.warning(f"Direct OpenAI-compatible LLM call failed: {e}")
        return ""


async def llm_generate(provider: str, model: str, system_prompt: str, user_prompt: str, raise_on_budget: bool = False) -> str:
    """Genera testo con LLM. Se `raise_on_budget=True` e i crediti Universal Key
    sono esauriti, solleva `LLMBudgetExhaustedError` invece di ricadere sul
    fallback silenzioso (che produrrebbe testo hardcoded/vuoto). I chiamanti
    critici (batch di generazione musicale, `generate_track`) DEVONO passare
    `raise_on_budget=True` per evitare di sprecare crediti Suno."""
    if not EMERGENT_LLM_KEY:
        # Direct-only path (no Universal Key configured)
        return await _llm_direct_openai(system_prompt, user_prompt)
    session_id = f"radio-{uuid.uuid4().hex[:12]}"
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=session_id,
        system_message=system_prompt,
    ).with_model(provider, model)
    msg = UserMessage(text=user_prompt)
    try:
        response = await chat.send_message(msg)
        if isinstance(response, str) and response.strip():
            return response
        if response:
            return str(response)
    except Exception as e:
        # On budget-exhausted or any other error, try the direct OpenAI-compatible
        # gateway with OPENAI_API_KEY/OPENAI_BASE_URL (falls back to fallback text).
        err = str(e)
        is_budget = "budget" in err.lower() or "exceeded" in err.lower() or "rate" in err.lower() or "insufficient" in err.lower()
        if is_budget:
            logger.warning(f"Universal Key budget exhausted / rate-limited: {err}")
            if raise_on_budget:
                # Consumer critico (batch, generate_track): stop immediato
                raise LLMBudgetExhaustedError(err)
            logger.info(f"→ falling back to direct OpenAI-compatible gateway")
        else:
            logger.warning(f"LLM primary path failed ({provider}/{model}): {err}")
        direct = await _llm_direct_openai(system_prompt, user_prompt)
        if direct:
            return direct
    # Last resort: try direct anyway
    return await _llm_direct_openai(system_prompt, user_prompt) or ""


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


async def get_recent_ads(n: int = 10) -> List[str]:
    doc = await db.station.find_one({}, {"_id": 0, "recent_ads": 1})
    if not doc:
        return []
    return list(reversed((doc.get("recent_ads") or [])[-n:]))


async def push_recent_ad(product_name: str, max_size: int = 10) -> None:
    product_name = (product_name or "").strip()
    if not product_name:
        return
    await db.station.update_one(
        {},
        {"$push": {"recent_ads": {"$each": [product_name], "$slice": -max_size}}},
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


@api_router.get("/station/mode")
async def get_station_mode():
    """Ritorna lo stato completo della stazione: modalita' (auto|manual|
    live_external), stop pendente, URL streaming esterno, ultimo comando
    admin (seq + type). Il player pubblico polla questo endpoint ogni 3s.
    """
    doc = await db.station.find_one({"_id": "state"}, {"_id": 0}) or {}
    return {
        "mode": doc.get("mode", "auto"),
        "pending_graceful_stop": bool(doc.get("pending_graceful_stop", False)),
        "manual_stream_url": doc.get("manual_stream_url") or "",
        "command_seq": int(doc.get("command_seq") or 0),
        "last_command": doc.get("last_command") or None,
    }


@api_router.post("/station/mode")
async def set_station_mode(mode: str = "auto", stop_after_current: bool = False):
    """Modalita' stazione. mode = auto | manual | live_external.
      - auto:          playlist AI in rotazione (default)
      - manual:        AI ferma, listener sentono silenzio o line-in browser
      - live_external: AI ferma, tutti i listener passano al tuo URL Icecast
    """
    if mode not in ("auto", "manual", "live_external"):
        return JSONResponse(status_code=400,
                            content={"error": "mode must be auto|manual|live_external"})
    update = {"mode": mode}
    if stop_after_current or mode in ("manual", "live_external"):
        update["pending_graceful_stop"] = True
    else:
        update["pending_graceful_stop"] = False
    await db.station.update_one({"_id": "state"}, {"$set": update}, upsert=True)
    return {"mode": mode, "pending_graceful_stop": update["pending_graceful_stop"]}


@api_router.post("/station/stream-url")
async def set_station_stream_url(url: str = Form(...)):
    """Salva l'URL dello stream esterno (Icecast/Shoutcast) usato dalla
    modalita' live_external. Il player pubblico legge questa URL e la usa
    come <audio src>.
    """
    url = (url or "").strip()
    if url and not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(400, "URL deve iniziare con http:// o https://")
    if len(url) > 500:
        raise HTTPException(400, "URL troppo lungo")
    await db.station.update_one({"_id": "state"},
                                {"$set": {"manual_stream_url": url}},
                                upsert=True)
    return {"ok": True, "manual_stream_url": url}


@api_router.post("/admin/command")
async def admin_broadcast_command(cmd_type: str = Form(...)):
    """Invia un comando istantaneo a tutti i player pubblici collegati.
    I browser dei listener pollano /api/station/mode ogni ~3s e, se rilevano
    un command_seq nuovo, applicano il comando localmente:
      - skip:         forza il fetch del prossimo segmento
      - pause:        mette il player in pausa
      - resume:       riprende la riproduzione
      - jingle_now:   costringe il prossimo segmento a essere un jingle
    """
    allowed = {"skip", "pause", "resume", "jingle_now"}
    if cmd_type not in allowed:
        raise HTTPException(400, f"cmd_type deve essere uno di: {sorted(allowed)}")
    doc = await db.station.find_one({"_id": "state"}, {"_id": 0}) or {}
    seq = int(doc.get("command_seq") or 0) + 1
    payload = {
        "type": cmd_type,
        "issued_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.station.update_one(
        {"_id": "state"},
        {"$set": {"command_seq": seq, "last_command": payload}},
        upsert=True,
    )
    # For "jingle_now" we ALSO set a queue flag so the next /api/next_segment
    # call from any browser will be forced to return a jingle segment.
    if cmd_type == "jingle_now":
        await db.station.update_one(
            {"_id": "state"},
            {"$set": {"force_next_jingle": True}},
            upsert=True,
        )
    logger.info(f"Broadcast command #{seq}: {cmd_type}")
    return {"ok": True, "command_seq": seq, "type": cmd_type}




# ----------------------- Tracks -----------------------
@api_router.get("/tracks", response_model=List[Track])
async def list_tracks(limit: int = 500):
    docs = await db.tracks.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return docs


@api_router.post("/tracks/generate", response_model=Track)
async def generate_track(hint: Optional[str] = None, genre: Optional[str] = None, lang: Optional[str] = None, instrumental: bool = False, _suno_call: bool = True, lean: bool = False, custom_lyrics: Optional[str] = None, premium: bool = False):
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
    try:
        raw = await llm_generate(provider, model, "Sei un producer AI di musica dance e club music.", prompt, raise_on_budget=True)
    except LLMBudgetExhaustedError as e:
        logger.error(f"generate_track ABORT: Universal Key budget exhausted — refusing to call Suno with empty metadata. {e}")
        raise HTTPException(
            status_code=402,
            detail="Universal Key budget exhausted: LLM cannot generate track metadata. Suno call skipped to avoid wasting credits. Please recharge the Universal Key."
        )
    import json, re
    m = re.search(r"\{.*\}", raw or "", re.DOTALL)
    data = {}
    if m:
        try:
            data = json.loads(m.group(0))
        except Exception:
            data = {}
    # HARD CHECK: se l'LLM non ha prodotto metadati validi (raw vuoto o JSON
    # non parseabile / senza campi utili), NON chiamare Suno — sprecherebbe
    # credito su una traccia con titolo/testo fallback duplicato.
    _essentials = [data.get("title"), data.get("lyrics_excerpt") or data.get("style_tags")]
    if not raw or not raw.strip() or not any(x and str(x).strip() for x in _essentials):
        logger.error(f"generate_track ABORT: LLM metadata empty/invalid (raw_len={len(raw or '')}, data_keys={list(data.keys())}) — skipping Suno.")
        raise HTTPException(
            status_code=502,
            detail="LLM returned empty/invalid metadata. Suno call skipped to avoid generating a duplicate/fallback track."
        )
    fallback_titles_it = ["Aurora Statica", "Ultravioletto 04:12", "Neon Rivière", "Silicio Blu", "Notte Analogica", "Ecolalia", "Piove RAM", "Marte in Do minore"]
    fallback_titles_en = ["Static Aurora", "Ultraviolet 04:12", "Neon River", "Blue Silicon", "Analog Night", "Echolalia", "Data Rain", "Mars in C Minor"]
    fallback_artists = ["Vector Dreams", "Aliza Kwon", "Nero Analog", "MODEM-9", "Casseforti", "Trasparente"]
    fallback_lyrics_it = [
        "Onde di neon\nnella notte quantica\nsognano bit\nun cuore digitale",
        "Cammino nel codice\nche mi ha inventato\ne fingo di sapere\ndove sto andando",
        "Un satellite piange\nsopra Marsiglia\nnessuno lo sente\ntranne la radio",
    ]
    fallback_lyrics_en = [
        "Neon waves\nin the quantum night\ndreaming in bits\na digital heart",
        "Walking through the code\nthat once invented me\npretending I know\nwhere I'm heading now",
        "A satellite is crying\nover Marseille tonight\nnobody hears it whisper\nnobody but the radio",
    ]
    # Language-aware fallback: never leak Italian text when the caller
    # asked for English (or vice versa). This bug caused the 20 club_dance
    # tracks of 2026-08 to be sung in Italian despite lang=en.
    _lang = (lang or "en").lower()
    is_it = _lang.startswith("it")
    fallback_titles = fallback_titles_it if is_it else fallback_titles_en
    fallback_lyrics = fallback_lyrics_it if is_it else fallback_lyrics_en
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

    # If Suno is enabled AND the caller allows it (`_suno_call=True`), create a
    # task (non-blocking) and let a background poller update the track when
    # Suno finishes (~2 min). Internal metadata-only calls pass `_suno_call=False`.
    if suno_service.is_enabled() and _suno_call:
        style_tags = data.get("style_tags") or f"{track.genre}, {track.mood}, vocals"
        prompt_text = f"{track.genre}, {track.mood}, {track.title} — {track.artist}"
        # ---- Full-structure lyrics ----
        # For vocal tracks, ask the LLM to compose the ENTIRE song with proper tags
        # ([Intro][Verse 1][Pre-Chorus][Chorus][Verse 2][Bridge][Outro]) BEFORE calling
        # Suno, so Suno doesn't invent shallow/repetitive lyrics.
        full_lyrics = ""
        # Se il chiamante passa custom_lyrics li usiamo così come sono
        # (skip generazione LLM). Utile per jingle brandizzati R-A.I.
        if custom_lyrics and custom_lyrics.strip():
            full_lyrics = custom_lyrics.strip()
            track.lyrics_excerpt = full_lyrics
        elif not instrumental:
            lang_label = "italiano" if (lang or "en").lower().startswith("it") else "inglese"
            if premium:
                # PREMIUM MODE: testo COMPLETAMENTE ORIGINALE, mai un verso
                # ripetuto uguale, storia coerente, immagini sensoriali forti.
                # Ogni sezione ha testo DIVERSO. Chorus con variazioni testuali.
                # Target Suno: 3:00 pieno, con dinamica artistica.
                lyrics_prompt = (
                    f"Scrivi il TESTO ORIGINALE in {lang_label} di una canzone AUTORALE dal titolo "
                    f"\"{track.title}\" di {track.artist} (genere: {track.genre}, mood: {track.mood}).\n\n"
                    "REGOLE ASSOLUTE:\n"
                    "1. TESTO ORIGINALE al 100%: nessuna citazione, nessun cliche', nessun verso "
                    "riciclato. Se qualcosa suona come Sanremo medio, RIFAI diverso.\n"
                    "2. Nessun verso deve essere ripetuto uguale piu' di 2 volte totali. Il chorus si "
                    "puo' ripetere ma con VARIAZIONI TESTUALI o metriche a ogni ricorrenza.\n"
                    "3. STORIA CONCRETA: personaggio, luogo, oggetto specifico, un dettaglio "
                    "sensoriale (odore, tatto, colore) che ancora la canzone al reale.\n"
                    "4. Rime interne ed esterne, metafore ORIGINALI (non 'cuore infranto', non "
                    "'luce nell'ombra', non 'ali spezzate').\n"
                    "5. STRUTTURA (usa esattamente questi tag su righe dedicate):\n"
                    "   [Intro] 2-3 righe atmosferiche con un'immagine forte\n"
                    "   [Verse 1] 6-8 righe che introducono situazione/personaggio\n"
                    "   [Pre-Chorus] 3-4 righe di tensione crescente\n"
                    "   [Chorus] 5-7 righe con hook memorabile MA senza ripetere la stessa frase piu' di 2 volte\n"
                    "   [Verse 2] 6-8 righe che sviluppano/complicano la storia (diverse dal Verse 1)\n"
                    "   [Pre-Chorus] 3-4 righe VARIANTE del primo (testo diverso, stessa funzione)\n"
                    "   [Chorus] 5-7 righe con MICRO-VARIAZIONI del chorus originale\n"
                    "   [Bridge] 3-5 righe con svolta emotiva / cambio prospettiva\n"
                    "   [Chorus] 5-7 righe finale con enfasi\n"
                    "   [Outro] 2-3 righe che chiudono richiamando l'Intro con nuova luce\n"
                    "6. Se stai scrivendo in italiano: NIENTE anglicismi facili (baby, yeah, come "
                    "on). Se in inglese: niente italianismi.\n"
                    "7. Livello di scrittura: paroliere serio (Battisti, Dalla, Cocciante, De Andre' "
                    "in it; Bowie, LCD Soundsystem, Frank Ocean, Lorde in en).\n"
                    "Rispondi SOLO col testo coi tag, niente commenti, niente introduzioni."
                )
            elif lean:
                # LEAN MODE: hook memorabile ripetuto molte volte + strofe cortissime.
                # Target durata Suno: 2:30-3:00 max (con questa struttura Suno V4 chiude sui 2:50).
                # NIENTE testi lunghi che gonfiano la durata a 4+ minuti.
                lyrics_prompt = (
                    f"Scrivi il TESTO in {lang_label} di un pezzo radiofonico ORECCHIABILE dal titolo "
                    f"\"{track.title}\" di {track.artist}. Il pezzo DEVE durare 2:30-3:00 max.\n\n"
                    "REGOLE FERREE (obbligatorie):\n"
                    "1) [Hook] UNA riga sola di 3-5 parole potente, ORECCHIABILE. Deve incollarsi al primo ascolto.\n"
                    "2) [Verse 1] MASSIMO 2 righe brevi (12 parole totali max)\n"
                    "3) [Hook] ripeti la STESSA riga\n"
                    "4) [Verse 2] MASSIMO 2 righe brevi diverse (12 parole totali max)\n"
                    "5) [Hook] ripeti la STESSA riga\n"
                    "6) [Bridge] MASSIMO 2 righe (10 parole)\n"
                    "7) [Hook x4] ripeti la STESSA riga 4 volte di fila per fissarla in testa\n\n"
                    "L'HOOK è la STESSA IDENTICA riga ripetuta almeno 8 volte in totale. "
                    "Parole semplici cantabili memorabili. NIENTE metafore astruse. "
                    "NIENTE testi filosofici o narrativi lunghi.\n"
                    "Rispondi SOLO col testo coi tag."
                )
            else:
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
            try:
                full_lyrics = await llm_generate(
                    provider, model,
                    "Sei un paroliere professionista. Scrivi solo il testo richiesto con la struttura esatta.",
                    lyrics_prompt,
                    raise_on_budget=True,
                )
            except LLMBudgetExhaustedError as e:
                logger.error(f"generate_track ABORT (lyrics): Universal Key budget exhausted — refusing to call Suno with hardcoded fallback lyrics. {e}")
                raise HTTPException(
                    status_code=402,
                    detail="Universal Key budget exhausted while generating full lyrics. Suno call skipped to avoid wasting credits on a duplicate/fallback track."
                )
            # HARD CHECK: testo completo troppo corto → NON chiamare Suno
            # (userebbe il fallback hardcoded e produrrebbe una traccia
            # duplicata dal punto di vista testuale).
            min_len = 60 if lean else (400 if premium else 200)
            if not full_lyrics or len(full_lyrics.strip()) < min_len:
                logger.error(f"generate_track ABORT (lyrics): LLM returned empty/too-short lyrics (len={len(full_lyrics or '')}, min={min_len}) — skipping Suno.")
                raise HTTPException(
                    status_code=502,
                    detail=f"LLM returned empty or too-short lyrics ({len(full_lyrics or '')} chars, min {min_len}). Suno call skipped to avoid a duplicate/fallback track."
                )
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
        "autogen_enabled": _suno_autogen_enabled(),
        "library_target": _suno_library_target(),
    }

@api_router.get("/admin/export/manifest")
async def admin_export_manifest():
    """Preview di cosa verra' incluso nell'export ZIP: conteggi per categoria + peso stimato."""
    from elevenlabs_service import TTS_DIR
    tracks_total = await db.tracks.count_documents({"source": "suno"})
    tracks_ready = await db.tracks.count_documents({"source": "suno", "status": "ready"})
    segments_total = await db.segments.count_documents({})
    # File TTS su disco (path corretto: /app/backend/tts_audio/)
    tts_files = list(TTS_DIR.glob("*.mp3")) if TTS_DIR.exists() else []
    tts_bytes = sum(p.stat().st_size for p in tts_files)
    suno_files = list(SUNO_AUDIO_DIR.glob("track_*.mp3")) if SUNO_AUDIO_DIR.exists() else []
    suno_bytes = sum(p.stat().st_size for p in suno_files)

    cats = {}
    async for t in db.tracks.find({}, {"_id": 0, "tags": 1, "is_anthem": 1, "is_jingle": 1, "is_seed": 1, "status": 1, "id": 1}):
        c = "other"
        if t.get("is_anthem"): c = "anthem"
        elif t.get("is_jingle"): c = "jingles"
        elif t.get("is_seed"): c = "seed"
        elif t.get("status") == "retired": c = "retired"
        else:
            tags = t.get("tags") or []
            if "english_pop_dance" in tags: c = "english_pop_dance"
            elif any(x in tags for x in ("italian_lean_v2", "summer_it", "tech_house_lean")): c = "italian"
        p = SUNO_AUDIO_DIR / f"track_{t.get('id')}.mp3"
        has_file = p.exists() and p.stat().st_size >= 10_000
        cats.setdefault(c, {"count": 0, "with_file": 0})
        cats[c]["count"] += 1
        if has_file: cats[c]["with_file"] += 1

    # Segments per kind (rubriche parlate)
    seg_cats = {}
    async for s in db.segments.find({"speech_audio_url": {"$ne": None}}, {"_id": 0, "kind": 1}):
        k = s.get("kind") or "other"
        seg_cats[k] = seg_cats.get(k, 0) + 1

    return {
        "tracks_total": tracks_total,
        "tracks_ready": tracks_ready,
        "segments_total": segments_total,
        "tts_files": len(tts_files),
        "tts_mb": round(tts_bytes / 1024 / 1024, 2),
        "suno_files": len(suno_files),
        "suno_mb": round(suno_bytes / 1024 / 1024, 2),
        "estimated_zip_mb": round((tts_bytes + suno_bytes) / 1024 / 1024, 2),
        "categories": cats,
        "segment_categories": seg_cats,
    }


# ----------------------- Admin: Upload MP3 (Master Plan #1) -----------------------
@api_router.get("/admin/tracks/searchable")
async def admin_tracks_searchable():
    """Elenco compatto di tutte le tracce non-retired per il dropdown di
    sostituzione: id, titolo, artista, tipo (song/jingle/anthem).
    """
    items = []
    cursor = db.tracks.find(
        {"status": {"$ne": "retired"}},
        {"_id": 0, "id": 1, "title": 1, "artist": 1, "is_jingle": 1, "is_anthem": 1,
         "duration_sec": 1, "on_air": 1},
    ).sort("created_at", -1)
    docs = await cursor.to_list(length=2000)
    for t in docs:
        if t.get("is_anthem"): kind = "anthem"
        elif t.get("is_jingle"): kind = "jingle"
        else: kind = "song"
        items.append({
            "id": t.get("id"),
            "title": t.get("title") or "—",
            "artist": t.get("artist") or "R-A.I.",
            "kind": kind,
            "duration_sec": t.get("duration_sec") or 0,
            "on_air": t.get("on_air") if t.get("on_air") is not None else True,
        })
    return {"tracks": items, "total": len(items)}


@api_router.post("/admin/tracks/upload")
async def admin_tracks_upload(
    file: UploadFile = File(...),
    mode: str = Form("new"),            # "new" | "replace"
    target_id: Optional[str] = Form(None),
    title: str = Form(...),
    artist: Optional[str] = Form("R-A.I."),
    kind: str = Form("song"),           # "song" | "jingle" | "anthem"
    tags: Optional[str] = Form(""),     # comma-separated
):
    """Upload di un MP3 caricato dall'admin.
    - mode='new'     → crea una nuova track e la mette subito in rotazione.
    - mode='replace' → sostituisce il file audio di una track esistente
                       (identificata da target_id), aggiornandone anche il titolo.
    Il file viene salvato in /app/backend/static/suno/track_<id>.mp3 e (se
    USE_OBJECT_STORAGE=true) pushato anche sul bucket Emergent condiviso.
    """
    fname_lower = (file.filename or "").lower()
    if not (fname_lower.endswith(".mp3") or (file.content_type or "").startswith("audio/")):
        raise HTTPException(400, "Solo file .mp3 sono accettati")
    if mode not in ("new", "replace"):
        raise HTTPException(400, "mode deve essere 'new' o 'replace'")
    if kind not in ("song", "jingle", "anthem"):
        raise HTTPException(400, "kind deve essere song|jingle|anthem")

    data = await file.read()
    if not data or len(data) < 5_000:
        raise HTTPException(400, "File troppo piccolo o vuoto")
    if len(data) > 30 * 1024 * 1024:  # 30 MB cap
        raise HTTPException(400, "File troppo grande (max 30 MB)")

    title = (title or "").strip() or "Senza titolo"
    artist = (artist or "R-A.I.").strip() or "R-A.I."
    tag_list = [t.strip() for t in (tags or "").split(",") if t.strip()]
    tag_list.append("admin_upload")

    if mode == "replace":
        if not target_id:
            raise HTTPException(400, "target_id richiesto per mode=replace")
        target = await db.tracks.find_one({"id": target_id})
        if not target:
            raise HTTPException(404, "Track da sostituire non trovata")
        track_id = target_id  # riusa lo stesso id → l'audio_url resta stabile
    else:
        track_id = str(uuid.uuid4())

    local_name = f"track_{track_id}.mp3"
    local_path = SUNO_AUDIO_DIR / local_name

    # Atomic replace: if this is a replacement and the OLD file lived at a
    # different location than /api/suno_audio/track_<id>.mp3 (e.g. legacy
    # naming), delete that old file so we don't leave orphans on disk.
    if mode == "replace" and target:
        old_url = target.get("audio_url") or ""
        if old_url.startswith("/api/suno_audio/") and not old_url.endswith(local_name):
            legacy_name = old_url.replace("/api/suno_audio/", "").split("?")[0]
            legacy_path = SUNO_AUDIO_DIR / legacy_name
            if legacy_path.exists():
                try:
                    legacy_path.unlink()
                    logger.info(f"Replace: deleted legacy local file {legacy_path}")
                except Exception as e:  # noqa: BLE001
                    logger.warning(f"Replace: failed to delete legacy file {legacy_path}: {e}")

    # Write the new mp3 (this atomically overwrites any existing track_<id>.mp3).
    local_path.write_bytes(data)

    # Push all'object storage (best-effort, no-op se flag disattivato).
    # Same path → same object key → the new file transparently replaces the old.
    try:
        await object_storage.put_mp3(f"suno/{local_name}", data)
    except Exception as e:  # noqa: BLE001
        logger.debug(f"objstore upload skipped: {e}")

    audio_url = f"/api/suno_audio/{local_name}"
    now = datetime.now(timezone.utc).isoformat()

    if mode == "replace":
        # Ereditiamo i tag/attributi immutabili della vecchia track, sovrascriviamo il resto.
        merged_tags = list(set((target.get("tags") or []) + tag_list))
        await db.tracks.update_one(
            {"id": track_id},
            {"$set": {
                "title": title,
                "artist": artist,
                "audio_url": audio_url,
                "status": "ready",
                "is_jingle": kind == "jingle",
                "is_anthem": kind == "anthem",
                "tags": merged_tags,
                "updated_at": now,
            }},
        )
        # Update the title on any segment currently in the playback queue that
        # references this track, so the new name shows up in the player at the
        # very next poll instead of only on the next generation cycle.
        seg_res = await db.segments.update_many(
            {"music_audio_url": audio_url, "kind": {"$in": ["music"]}},
            {"$set": {"title": f"♪ {title} — {artist}"}},
        )
        logger.info(
            f"Replace: track {track_id} title→'{title}', segments updated: {seg_res.modified_count}"
        )
    else:
        # Build a Track-model-compatible document so downstream code
        # (GET /api/tracks response_model, rotation pools, etc.) keeps working.
        track = Track(
            id=track_id,
            title=title,
            artist=artist,
            genre="admin_upload",
            mood="uploaded",
            lyrics_excerpt="(uploaded via admin panel)",
            duration_sec=0,   # calcolato al primo play dal frontend
            llm_provider="admin_upload",
            cover_seed=track_id[:8],
            audio_url=audio_url,
            downloaded_at=now,
            source="admin_upload",
            is_jingle=(kind == "jingle"),
            is_anthem=(kind == "anthem"),
            status="ready",
        )
        doc = track.model_dump()
        # Extra rotation-friendly fields (not in Track model but harmless):
        doc["tags"] = tag_list
        doc["is_seed"] = False
        doc["rotation_weight"] = 1.0
        doc["last_played_at"] = None
        doc["updated_at"] = now
        await db.tracks.insert_one(doc)

    logger.info(f"Admin upload {mode}: '{title}' → {audio_url} ({len(data):,} bytes)")
    return {
        "ok": True,
        "mode": mode,
        "track_id": track_id,
        "title": title,
        "audio_url": audio_url,
        "size_bytes": len(data),
    }


# ----------------------- Admin: DB Sync (export/import tracks) ----------------
# Serve a sincronizzare la libreria tracce fra ambienti (preview↔produzione).
# Non tocca collezioni con dati utente (questions, ads, station, djs, users).
@api_router.get("/admin/db/export")
async def admin_db_export():
    """Dump di tutte le tracce (JSON) — usato per sincronizzare preview→produzione.
    Struttura: {version, exported_at, source_db, tracks:[...]}
    """
    import json as _json
    tracks = await db.tracks.find({}, {"_id": 0}).to_list(length=10000)
    # Normalizziamo eventuali datetime residui
    for t in tracks:
        for k, v in list(t.items()):
            if isinstance(v, datetime):
                t[k] = v.isoformat()
    payload = {
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "source_db": os.environ.get("DB_NAME", "?"),
        "count": len(tracks),
        "tracks": tracks,
    }
    body = _json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8")
    fname = f"rai_tracks_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    return Response(
        content=body,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@api_router.post("/admin/db/import")
async def admin_db_import(
    file: UploadFile = File(...),
    mode: str = Form("merge"),   # "merge" (upsert by id) | "replace-all" (danger)
):
    """Importa un JSON di tracce esportato da /admin/db/export.
    - mode='merge' (default e raccomandato): upsert per id. Le tracce esistenti
      con lo stesso id vengono aggiornate, le altre inserite. Nessuna traccia
      viene mai eliminata.
    - mode='replace-all': cancella tutte le tracce e re-inserisce quelle nel file.
      Da usare solo per un reset totale, molto pericoloso.

    Le altre collezioni (questions, ads, station, djs, users, segments) non
    vengono mai toccate — i dati degli ascoltatori sono al sicuro.
    """
    import json as _json
    if mode not in ("merge", "replace-all"):
        raise HTTPException(400, "mode deve essere 'merge' o 'replace-all'")
    data = await file.read()
    if not data:
        raise HTTPException(400, "File vuoto")
    if len(data) > 50 * 1024 * 1024:
        raise HTTPException(400, "File troppo grande (max 50 MB)")
    try:
        payload = _json.loads(data.decode("utf-8"))
    except Exception as e:
        raise HTTPException(400, f"JSON non valido: {e}")

    tracks = payload.get("tracks") if isinstance(payload, dict) else payload
    if not isinstance(tracks, list):
        raise HTTPException(400, "Il file deve contenere una lista 'tracks'")

    stats = {"total_in_file": len(tracks), "upserted": 0, "inserted": 0,
             "updated": 0, "skipped_invalid": 0, "deleted_before_import": 0}
    if mode == "replace-all":
        r = await db.tracks.delete_many({})
        stats["deleted_before_import"] = r.deleted_count

    for t in tracks:
        if not isinstance(t, dict) or not t.get("id"):
            stats["skipped_invalid"] += 1
            continue
        t.pop("_id", None)  # never trust incoming _id
        try:
            res = await db.tracks.update_one(
                {"id": t["id"]},
                {"$set": t},
                upsert=True,
            )
            if res.upserted_id is not None:
                stats["inserted"] += 1
            elif res.modified_count:
                stats["updated"] += 1
            stats["upserted"] += 1
        except Exception as e:
            logger.warning(f"import: skip {t.get('id')}: {e}")
            stats["skipped_invalid"] += 1

    total_after = await db.tracks.count_documents({})
    stats["total_in_db_after"] = total_after
    logger.info(f"Admin DB import ({mode}): {stats}")
    return {"ok": True, "mode": mode, "source_db": payload.get("source_db", "?"),
            "exported_at": payload.get("exported_at"), "stats": stats}


# ----------------------- Admin: track on-air toggle -----------------------
@api_router.post("/admin/tracks/{track_id}/on-air")
async def admin_toggle_on_air(track_id: str, on_air: bool = Form(...)):
    """Enable / disable a single track for rotation. When False, the
    rotation pools (`high_pool`, `normal_pool`) and the jingle picker
    all skip it."""
    r = await db.tracks.update_one(
        {"id": track_id},
        {"$set": {"on_air": bool(on_air),
                  "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Track non trovata")
    return {"ok": True, "track_id": track_id, "on_air": bool(on_air)}


# ----------------------- Admin: rotation rules -----------------------
@api_router.get("/admin/rotation-rules")
async def admin_get_rotation_rules():
    """Attuali cadenze del palinsesto (jingle e talk)."""
    doc = await db.station.find_one({"_id": "state"}) or {}
    return {
        "jingle_every_n_songs": int(doc.get("jingle_every_n_songs") or 2),
        "dj_talk_every_n_songs": int(doc.get("dj_talk_every_n_songs") or 4),
    }


@api_router.post("/admin/rotation-rules")
async def admin_set_rotation_rules(
    jingle_every_n_songs: int = Form(...),
    dj_talk_every_n_songs: int = Form(...),
):
    """Set the rotation cadence.
      jingle_every_n_songs  → interspersa un jingle brandizzato ogni N brani
      dj_talk_every_n_songs → interspersa una rubrica DJ ogni Y brani
    Valori validi: 1..20.
    """
    j = max(1, min(20, int(jingle_every_n_songs)))
    d = max(1, min(20, int(dj_talk_every_n_songs)))
    await db.station.update_one(
        {"_id": "state"},
        {"$set": {"jingle_every_n_songs": j, "dj_talk_every_n_songs": d}},
        upsert=True,
    )
    logger.info(f"Rotation rules updated: jingle every {j}, dj_talk every {d}")
    return {"ok": True, "jingle_every_n_songs": j, "dj_talk_every_n_songs": d}


# ----------------------- Admin: one-click sync to production -----------------------
@api_router.post("/admin/db/purge-orphans")
async def admin_purge_orphans(dry_run: bool = Form(True)):
    """DELETE definitiva delle tracce senza file audio associato.
    Un record è considerato "orfano" se:
      - audio_url è None / stringa vuota, OPPURE
      - status != 'ready' (ancora pending o failed dopo Suno),  OPPURE
      - audio_url punta a un file locale che NON esiste E l'object storage
        non lo ha (best-effort HEAD check).

    Se dry_run=True (default) ritorna solo l'elenco senza cancellare.
    Se dry_run=False cancella davvero.
    """
    to_delete = []
    total = 0
    async for t in db.tracks.find({}, {"_id": 0}):
        total += 1
        aurl = t.get("audio_url") or ""
        status = t.get("status") or ""
        orphan = False
        reason = ""
        if not aurl:
            orphan = True; reason = "no_audio_url"
        elif status not in ("ready",):
            orphan = True; reason = f"status={status}"
        elif aurl.startswith("/api/suno_audio/"):
            fname = aurl.replace("/api/suno_audio/", "").split("?")[0]
            local = SUNO_AUDIO_DIR / fname
            if not (local.exists() and local.stat().st_size > 5000):
                # Fallback: try object storage
                data = await object_storage.fetch_mp3(f"suno/{fname}") if object_storage.is_enabled() else None
                if not data:
                    orphan = True; reason = "file_missing_local_and_bucket"
        if orphan:
            to_delete.append({
                "id": t.get("id"), "title": t.get("title") or "?",
                "reason": reason, "status": status, "audio_url": aurl,
            })

    if dry_run:
        return {"dry_run": True, "total_tracks": total,
                "orphans_count": len(to_delete),
                "orphans_preview": to_delete[:20],
                "would_delete_ids": [x["id"] for x in to_delete]}

    ids = [x["id"] for x in to_delete]
    if ids:
        r = await db.tracks.delete_many({"id": {"$in": ids}})
        deleted_count = r.deleted_count
    else:
        deleted_count = 0
    logger.info(f"Purged {deleted_count} orphan tracks")
    return {"dry_run": False, "total_tracks": total,
            "orphans_count": len(to_delete),
            "deleted_count": deleted_count,
            "orphans": to_delete}



@api_router.post("/admin/db/sync-to-production")
async def admin_sync_to_production(target_url: str = Form("https://r-ai.it")):
    """Esporta le tracce di questo ambiente e le POSTa direttamente
    all'endpoint /api/admin/db/import di produzione. Un click, niente
    download/upload manuale.
    Il target_url e' configurabile (default https://r-ai.it).
    """
    if not target_url.startswith(("http://", "https://")):
        raise HTTPException(400, "target_url deve iniziare con http(s)://")
    target = target_url.rstrip("/") + "/api/admin/db/import"

    # 1) Export locale in memoria
    tracks = await db.tracks.find({}, {"_id": 0}).to_list(length=10000)
    for t in tracks:
        for k, v in list(t.items()):
            if isinstance(v, datetime):
                t[k] = v.isoformat()
    payload = {
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "source_db": os.environ.get("DB_NAME", "?"),
        "count": len(tracks),
        "tracks": tracks,
    }
    import json as _json
    body_bytes = _json.dumps(payload, ensure_ascii=False).encode("utf-8")

    # 2) POST a produzione come multipart form (mode=merge)
    try:
        async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
            files = {"file": ("rai_tracks_sync.json", body_bytes, "application/json")}
            data = {"mode": "merge"}
            r = await client.post(target, files=files, data=data)
            if r.status_code != 200:
                raise HTTPException(
                    502,
                    f"Produzione ha risposto {r.status_code}: {r.text[:400]}"
                )
            result = r.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Errore contattando produzione: {e}")

    return {
        "ok": True,
        "target": target,
        "sent_tracks": len(tracks),
        "production_response": result,
    }


@api_router.get("/admin/export/category/{category}")
async def admin_export_category(category: str, page: int = 1, page_size: int = 50):
    """ZIP piccolo e categorico. Molto più leggero del monolitico (che sfora
    timeout proxy quando la libreria è grande). Un ZIP per categoria:
      - music              : tutti i brani in rotazione (no jingle, no anthem, no retired)
      - jingles            : jingle brandizzati R-A.I.
      - anthem             : inno ufficiale
      - retired            : brani ritirati
      - talk, news, ad_spot, weather, horoscope, history,
        interview, motivation, joke, time_signal : file TTS del kind
      - metadata           : solo JSON metadata (nessun mp3, ~pochi KB)

    Paginazione: `?page=1&page_size=50` (default). Utile per music grande.
    """
    import zipfile
    import tempfile
    import json as _json
    from elevenlabs_service import TTS_DIR

    page = max(1, int(page))
    page_size = max(10, min(200, int(page_size)))
    start = (page - 1) * page_size
    end = start + page_size

    now_str = datetime.now().strftime('%Y%m%d_%H%M%S')
    tmp = tempfile.TemporaryFile()

    async def _tracks_for_music_cat():
        query = {"status": {"$ne": "retired"}, "is_jingle": {"$ne": True}, "is_anthem": {"$ne": True}}
        return await db.tracks.find(query, {"_id": 0}).sort("created_at", -1).to_list(length=5000)

    def _sanitize(name: str, maxlen: int = 40) -> str:
        s = "".join(c for c in (name or "untitled") if c.isalnum() or c in " -_").strip()
        return (s[:maxlen] or "untitled")

    music_like = {"music", "jingles", "anthem", "retired"}
    speech_like = {"talk", "news", "ad_spot", "weather", "horoscope", "history",
                   "interview", "motivation", "joke", "time_signal"}

    with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as zf:
        added = 0
        total_available = 0
        if category == "metadata":
            tracks = await db.tracks.find({}, {"_id": 0}).to_list(length=5000)
            segments = await db.segments.find({}, {"_id": 0}).sort("created_at", -1).to_list(length=5000)
            zf.writestr("rai_export/tracks.json", _json.dumps(tracks, indent=2, default=str))
            zf.writestr("rai_export/segments.json", _json.dumps(segments, indent=2, default=str))
            zf.writestr("rai_export/export_info.json", _json.dumps({
                "exported_at": datetime.now(timezone.utc).isoformat(),
                "category": category,
                "tracks_count": len(tracks),
                "segments_count": len(segments),
            }, indent=2))
            added = 3
            total_available = 3
        elif category in music_like:
            if category == "music":
                all_tracks = await _tracks_for_music_cat()
            elif category == "jingles":
                all_tracks = await db.tracks.find({"is_jingle": True}, {"_id": 0}).to_list(length=5000)
            elif category == "anthem":
                all_tracks = await db.tracks.find({"is_anthem": True}, {"_id": 0}).to_list(length=5000)
            else:  # retired
                all_tracks = await db.tracks.find({"status": "retired"}, {"_id": 0}).to_list(length=5000)
            total_available = len(all_tracks)
            for t in all_tracks[start:end]:
                tid = t.get("id")
                if not tid:
                    continue
                mp3_path = SUNO_AUDIO_DIR / f"track_{tid}.mp3"
                if not (mp3_path.exists() and mp3_path.stat().st_size >= 10_000):
                    continue
                safe = _sanitize(t.get("title"))
                zf.write(str(mp3_path), f"{category}/{safe}_{tid[:8]}.mp3")
                added += 1
        elif category in speech_like:
            all_segments = await db.segments.find(
                {"kind": category, "speech_audio_url": {"$ne": None}},
                {"_id": 0},
            ).sort("created_at", -1).to_list(length=2000)
            total_available = len(all_segments)
            seen = set()
            for s in all_segments[start:end]:
                url = s.get("speech_audio_url") or ""
                if not url.startswith("/api/tts/"):
                    continue
                fname = url.replace("/api/tts/", "").split("?")[0]
                if not fname or fname in seen:
                    continue
                seen.add(fname)
                p = TTS_DIR / fname
                if not (p.exists() and p.stat().st_size >= 3_000):
                    continue
                safe = _sanitize(s.get("title") or "segment")
                zf.write(str(p), f"{category}/{safe}_{fname}")
                added += 1
        else:
            raise HTTPException(400, f"Categoria sconosciuta: {category}")

        total_pages = max(1, (total_available + page_size - 1) // page_size) if category != "metadata" else 1
        zf.writestr("README.txt",
                    f"R-A.I. export — categoria: {category}\n"
                    f"Pagina: {page}/{total_pages}  (size={page_size})\n"
                    f"File audio inclusi in questo ZIP: {added}\n"
                    f"Totale disponibile in categoria: {total_available}\n"
                    f"Generato: {datetime.now(timezone.utc).isoformat()}\n")

    tmp.seek(0, 2)
    total_size = tmp.tell()
    tmp.seek(0)

    def iter_file():
        while True:
            chunk = tmp.read(1024 * 64)
            if not chunk:
                tmp.close()
                return
            yield chunk

    fname = f"rai_{category}_p{page}_{now_str}.zip"
    return StreamingResponse(
        iter_file(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{fname}"',
            "Content-Length": str(total_size),
            "X-Rai-Total-Available": str(total_available),
            "X-Rai-Page": str(page),
            "X-Rai-Page-Size": str(page_size),
        },
    )


@api_router.get("/admin/export")
async def admin_export_all():
    """Genera un ZIP con TUTTI i contenuti generati (musica + rubriche parlate)
    e lo streamma al client. ZIP costruito INTERAMENTE in un SpooledTemporaryFile
    (fino a 100MB in RAM poi disco), poi streammato a chunk -> nessun rischio
    di central directory corrotto come nel primo tentativo streaming.
    """
    import zipfile
    import tempfile
    import json as _json
    from elevenlabs_service import TTS_DIR

    tracks = await db.tracks.find({}, {"_id": 0}).to_list(length=5000)
    segments = await db.segments.find({}, {"_id": 0}).sort("created_at", -1).to_list(length=2000)

    def track_category(t):
        tags = t.get("tags") or []
        if t.get("is_anthem"): return "anthem"
        if t.get("is_jingle"): return "jingles"
        if t.get("is_seed"): return "seed"
        if t.get("status") == "retired": return "retired"
        if "english_pop_dance" in tags: return "english_pop_dance"
        if any(x in tags for x in ("italian_lean_v2", "summer_it", "tech_house_lean")):
            return "italian"
        return "other"

    tmp = tempfile.TemporaryFile()  # sempre su disco: zero buffering in RAM
    with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as zf:
        # 1) Metadata JSON
        for t in tracks:
            t["_category"] = track_category(t)
        zf.writestr("rai_export/metadata/tracks.json", _json.dumps(tracks, indent=2, default=str))
        zf.writestr("rai_export/metadata/segments.json", _json.dumps(segments, indent=2, default=str))
        zf.writestr("rai_export/metadata/export_info.json", _json.dumps({
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "tracks_count": len(tracks),
            "segments_count": len(segments),
            "app": "R-A.I. Radio",
        }, indent=2))

        # 2) Audio Suno per categoria (music)
        for t in tracks:
            tid = t.get("id")
            if not tid: continue
            mp3_path = SUNO_AUDIO_DIR / f"track_{tid}.mp3"
            if not mp3_path.exists() or mp3_path.stat().st_size < 10_000:
                continue
            cat = t["_category"]
            safe_title = "".join(c for c in (t.get("title") or "untitled") if c.isalnum() or c in " -_")[:40].strip() or "untitled"
            zf.write(str(mp3_path), f"rai_export/music/{cat}/{safe_title}_{tid[:8]}.mp3")

        # 3) File TTS di ogni segmento parlato, organizzati per KIND (news/ad_spot/talk/...)
        # Mappa filename -> segmento più recente
        speech_map = {}
        for s in segments:
            url = s.get("speech_audio_url") or ""
            if url.startswith("/api/tts/"):
                fname = url.replace("/api/tts/", "").split("?")[0]
                if fname and fname not in speech_map:
                    speech_map[fname] = s

        for fname, s in speech_map.items():
            p = TTS_DIR / fname
            if not p.exists() or p.stat().st_size < 3_000:
                continue
            kind = s.get("kind") or "other"
            safe_title = "".join(c for c in (s.get("title") or "segment") if c.isalnum() or c in " -_")[:40].strip() or "segment"
            zf.write(str(p), f"rai_export/rubriche/{kind}/{safe_title}_{fname}")

        # 4) README
        readme = (
            "# R-A.I. Radio - Export\n\n"
            f"Exported: {datetime.now(timezone.utc).isoformat()}\n\n"
            "## Struttura\n"
            "### music/\n"
            "- english_pop_dance/  hit pop/dance inglesi (high rotation)\n"
            "- italian/            tracce italiane\n"
            "- jingles/            jingle brandizzati R-A.I.\n"
            "- anthem/             inno ufficiale\n"
            "- seed/               5 tracce seed sempre disponibili\n"
            "- retired/            tracce ritirate\n"
            "- other/              altre\n\n"
            "### rubriche/ (voci DJ dei segmenti parlati)\n"
            "- news/         notiziari futuristici\n"
            "- ad_spot/      spot pubblicitari surreali\n"
            "- talk/         monologhi DJ\n"
            "- interview/    interviste immaginarie\n"
            "- history/      storia dal futuro\n"
            "- horoscope/    oroscopi cosmici\n"
            "- motivation/   pillole filosofiche\n"
            "- joke/         battute\n"
            "- weather/      meteo cosmico\n"
            "- time_signal/  segnali orari\n\n"
            "### metadata/\n"
            "- tracks.json      metadati tutte le tracce\n"
            "- segments.json    ultimi 2000 segmenti\n"
            "- export_info.json info export\n"
        )
        zf.writestr("rai_export/README.md", readme)

    tmp.seek(0)
    size = tmp.tell() if hasattr(tmp, 'tell') else 0
    tmp.seek(0, 2)
    total_size = tmp.tell()
    tmp.seek(0)

    def iter_file():
        while True:
            chunk = tmp.read(1024 * 64)
            if not chunk:
                tmp.close()
                return
            yield chunk

    fname = f"rai_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
    return StreamingResponse(
        iter_file(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{fname}"',
            "Content-Length": str(total_size),
        },
    )


@api_router.get("/segments/list")
async def list_segments_download(kind: Optional[str] = None, limit: int = 500):
    """Lista segmenti (rubriche parlate) con speech_audio_url per download singolo.
    Filtrabile per kind (news, ad_spot, talk, joke, weather, ...).
    """
    q = {"speech_audio_url": {"$ne": None}}
    if kind:
        q["kind"] = kind
    docs = await db.segments.find(q, {
        "_id": 0, "id": 1, "kind": 1, "title": 1, "dj_name": 1, "speech_audio_url": 1, "created_at": 1,
    }).sort("created_at", -1).limit(limit).to_list(length=limit)
    return docs



    tracks_ready = await db.tracks.count_documents({"source": "suno", "status": "ready"})
    segments_total = await db.segments.count_documents({})
    tts_dir = ROOT_DIR / "static" / "tts"
    tts_files = list(tts_dir.glob("*.mp3")) if tts_dir.exists() else []
    tts_bytes = sum(p.stat().st_size for p in tts_files)
    suno_files = list(SUNO_AUDIO_DIR.glob("track_*.mp3")) if SUNO_AUDIO_DIR.exists() else []
    suno_bytes = sum(p.stat().st_size for p in suno_files)
    cats = {}
    async for t in db.tracks.find({}, {"_id": 0, "tags": 1, "is_anthem": 1, "is_jingle": 1, "is_seed": 1, "status": 1, "id": 1}):
        c = "other"
        if t.get("is_anthem"):
            c = "anthem"
        elif t.get("is_jingle"):
            c = "jingles"
        elif t.get("is_seed"):
            c = "seed"
        elif t.get("status") == "retired":
            c = "retired"
        else:
            tags = t.get("tags") or []
            if "english_pop_dance" in tags:
                c = "english_pop_dance"
            elif any(x in tags for x in ("italian_lean_v2", "summer_it", "tech_house_lean")):
                c = "italian"
        p = SUNO_AUDIO_DIR / f"track_{t.get('id')}.mp3"
        has_file = p.exists() and p.stat().st_size >= 10_000
        cats.setdefault(c, {"count": 0, "with_file": 0})
        cats[c]["count"] += 1
        if has_file:
            cats[c]["with_file"] += 1


@api_router.get("/library/seed")
async def library_seed_list():
    """5 brani 'seed' sempre disponibili in libreria locale — mai generati
    on-the-fly. Servono da fallback garantito se il resto della libreria
    è vuoto/pending. Sono già scaricati sul disco."""
    docs = await db.tracks.find(
        {"is_seed": True, "status": "ready"},
        {"_id": 0}
    ).to_list(20)
    return {"count": len(docs), "tracks": docs}


@api_router.get("/jingles/random")
async def jingles_random():
    """Restituisce un jingle R-A.I. random tra quelli marcati is_jingle=True.
    Usato dal frontend per riempire le transizioni tra segmenti diversi."""
    # Round-robin sui jingle: prendi 20 candidati e sceglie random
    docs = await db.tracks.find(
        {"is_jingle": True, "status": "ready", "audio_url": {"$ne": None}},
        {"_id": 0},
        sort=[("last_played_at", 1)],
    ).to_list(20)
    if not docs:
        return {"jingle": None}
    # Pick random tra i 5 meno recenti per varietà
    pool = docs[:5] if len(docs) >= 5 else docs
    chosen = random.choice(pool)
    await db.tracks.update_one(
        {"id": chosen["id"]},
        {"$set": {"last_played_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"jingle": chosen}


@api_router.get("/library/stats")
async def library_stats():
    """Snapshot of the local music library. Useful to verify that the radio
    is playing cached tracks and NOT calling Suno on every music slot."""
    ready = await db.tracks.count_documents({"source": "suno", "status": "ready"})
    pending = await db.tracks.count_documents({"source": "suno", "status": "pending"})
    failed = await db.tracks.count_documents({"source": "suno", "status": "failed"})
    procedural = await db.tracks.count_documents({"source": "procedural"})
    anthems = await db.tracks.count_documents({"is_anthem": True, "status": "ready"})
    # Count local mp3 files actually on disk
    try:
        local_files = sum(1 for p in SUNO_AUDIO_DIR.glob("track_*.mp3") if p.stat().st_size >= 100_000)
        local_bytes = sum(p.stat().st_size for p in SUNO_AUDIO_DIR.glob("track_*.mp3"))
    except Exception:
        local_files, local_bytes = 0, 0
    return {
        "target_ready": _suno_library_target(),
        "autogen_enabled": _suno_autogen_enabled(),
        "suno_enabled": suno_service.is_enabled(),
        "tracks": {
            "ready": ready,
            "pending": pending,
            "failed": failed,
            "procedural_only": procedural,
            "anthems_ready": anthems,
        },
        "local_files": {
            "count": local_files,
            "total_mb": round(local_bytes / 1024 / 1024, 2),
            "dir": str(SUNO_AUDIO_DIR),
        },
        "will_call_suno_next_music_slot": (
            ready == 0 and suno_service.is_enabled() and _suno_autogen_enabled()
        ),
    }


@api_router.post("/library/autogen")
async def library_toggle_autogen(enabled: bool):
    """Runtime kill-switch for automatic Suno generation.
    Persists to backend/.env so the setting survives restart."""
    env_path = ROOT_DIR / ".env"
    try:
        lines = env_path.read_text().splitlines()
    except Exception:
        lines = []
    key = "SUNO_AUTOGEN_ENABLED"
    new_val = "true" if enabled else "false"
    found = False
    for i, ln in enumerate(lines):
        if ln.strip().startswith(f"{key}="):
            lines[i] = f"{key}={new_val}"
            found = True
            break
    if not found:
        lines.append(f"{key}={new_val}")
    env_path.write_text("\n".join(lines) + "\n")
    os.environ[key] = new_val
    logger.info(f"SUNO_AUTOGEN_ENABLED set to {new_val} via API")
    return {"autogen_enabled": enabled, "persisted": True}


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

    # ============================================================
    # PALINSESTO STRUTTURATO — ciclo 7 posizioni
    # ------------------------------------------------------------
    # Pattern: 2 canzoni → 2 rubriche → 1 canzone → 2 rubriche → ripete
    #   0 → music
    #   1 → music
    #   2 → parlato (rubrica futuro)
    #   3 → parlato/spot (rubrica futuro o ad_spot o meteo/orario)
    #   4 → music (singolo)
    #   5 → parlato (rubrica futuro)
    #   6 → parlato/spot (rubrica futuro o ad_spot o meteo/orario)
    # ============================================================
    if kind is None:
        state_doc = await db.station.find_one({"_id": "state"}) or {}
        # Configurable rotation rules (defaults preserve the original 8-slot
        # feel: jingle every 2 music tracks, DJ talk every 4 music tracks).
        j_every = int(state_doc.get("jingle_every_n_songs") or 2)
        d_every = int(state_doc.get("dj_talk_every_n_songs") or 4)
        songs_since_jingle = int(state_doc.get("songs_since_jingle") or 0)
        songs_since_dj_talk = int(state_doc.get("songs_since_dj_talk") or 0)
        # "A.I. Vs Umani" — iniezione periodica di un brano community.
        # 0 = disabilitato. N > 0 = ogni N canzoni AI ne parte una community.
        community_freq = int(state_doc.get("community_frequency") or 0)
        songs_since_community = int(state_doc.get("songs_since_community") or 0)
        # Legacy: keep playlist_position rolling for stats/back-compat only.
        pos = int(state_doc.get("playlist_position", 0)) % 8

        # Admin "Jingle NOW" command: consume the flag and return an actual
        # branded jingle from the library immediately (no LLM/TTS latency).
        if state_doc.get("force_next_jingle"):
            await db.station.update_one(
                {"_id": "state"}, {"$set": {"force_next_jingle": False}}, upsert=True
            )
            jingle = await db.tracks.find_one(
                {"is_jingle": True, "status": "ready", "audio_url": {"$ne": None},
                 "on_air": {"$ne": False}},
                {"_id": 0}, sort=[("last_played_at", 1)],
            )
            if jingle:
                await db.tracks.update_one(
                    {"id": jingle["id"]},
                    {"$set": {"last_played_at": datetime.now(timezone.utc).isoformat()}},
                )
                segment = Segment(
                    kind="music",
                    title=f"♪ {jingle.get('title','Jingle')} — {jingle.get('artist','R-A.I.')}",
                    dj_name="R-A.I.", script="",
                    music_audio_url=jingle["audio_url"],
                    duration_sec=jingle.get("duration_sec") or 25,
                    track_meta=jingle,
                    llm_provider="jingle",
                )
                await db.segments.insert_one(segment.model_dump())
                return segment

        # Ora italiana reale per il segnale orario
        try:
            from zoneinfo import ZoneInfo
            it_now = datetime.now(ZoneInfo("Europe/Rome"))
        except Exception:
            it_now = datetime.now(timezone.utc)
        current_hour_key = it_now.strftime("%Y-%m-%d %H")
        last_time_hour = state_doc.get("last_time_signal_hour")

        # Rubriche parlate a tema FUTURO
        future_rubrics = ["talk", "history", "interview", "joke", "motivation", "horoscope", "news"]
        commercial_slots = ["ad_spot", "weather"]

        # ---- Rotation slot decision based on configurable rules ----
        # Priority order: time signal (once per hour) → COMMUNITY block → jingle → dj_talk → music.
        if last_time_hour != current_hour_key:
            kind = "time_signal"
            await db.station.update_one(
                {"_id": "state"},
                {"$set": {"last_time_signal_hour": current_hour_key}},
                upsert=True,
            )
        elif community_freq > 0 and songs_since_community >= community_freq:
            # === Community block "A.I. Vs Umani" ===
            # Cerca un brano community ON. Se non c'è, salta al normale palinsesto.
            comm = await db.community_tracks.find_one(
                {"status": "on"},
                {"_id": 0},
                sort=[("submitted_at", -1)],
            )
            if comm:
                intro_url = state_doc.get("community_intro_jingle_url") or None
                outro_url = state_doc.get("community_outro_jingle_url") or None
                # Scegli DJ (Leo / Aria / Max) a rotazione per varietà.
                dj_pool = ["Leo", "Aria", "Max"]
                dj_name = random.choice(dj_pool)
                # Voice key: mappa nome DJ → voice preset OpenAI TTS
                voice_map = {"Leo": "onyx", "Aria": "nova", "Max": "echo"}
                voice_key = voice_map.get(dj_name, "nova")
                artist = comm.get("author") or "Artista"
                title = comm.get("title") or "Brano senza titolo"
                # Script che il DJ dice PRIMA del brano — client-side speech
                # synthesis (nessun consumo crediti). Il template è ricco per
                # spingere la CTA "Inviaci il tuo brano".
                dj_script = (
                    f"E ora un momento speciale su R-A-I: la sfida A-I contro Umani! "
                    f"Sto per farvi ascoltare {title}, di {artist}, "
                    f"un artista in carne e ossa che si mette in gioco contro le nostre intelligenze artificiali. "
                    f"Ascoltate, e giudicate voi."
                )
                segment = Segment(
                    kind="community",
                    dj_name=dj_name,
                    voice_key=voice_key,
                    title=f"♥ {title} — {artist} (community)",
                    script=dj_script,
                    music_audio_url=comm.get("audio_url"),
                    pre_jingle_url=intro_url,
                    post_jingle_url=outro_url,
                    duration_sec=210,  # stima 3:30, ma ended event chiude comunque
                    track_meta={
                        "is_community": True,
                        "artist": artist,
                        "title": title,
                        "id": comm.get("id"),
                    },
                    llm_provider="community",
                )
                await db.segments.insert_one(segment.model_dump())
                await db.station.update_one(
                    {"_id": "state"},
                    {"$set": {"songs_since_community": 0}},
                    upsert=True,
                )
                return segment
            # Nessun brano community ON → resetta contatore per non insistere
            await db.station.update_one(
                {"_id": "state"},
                {"$set": {"songs_since_community": 0}},
                upsert=True,
            )
            kind = "music"
        elif songs_since_jingle >= j_every:
            jingle = await db.tracks.find_one(
                {"is_jingle": True, "status": "ready", "audio_url": {"$ne": None},
                 "on_air": {"$ne": False}},
                {"_id": 0}, sort=[("last_played_at", 1)],
            )
            if jingle:
                await db.tracks.update_one(
                    {"id": jingle["id"]},
                    {"$set": {"last_played_at": datetime.now(timezone.utc).isoformat()}},
                )
                await db.station.update_one(
                    {"_id": "state"},
                    {"$set": {
                        "playlist_position": (pos + 1) % 8,
                        "songs_since_jingle": 0,
                    }},
                    upsert=True,
                )
                segment = Segment(
                    kind="music",
                    title=f"♪ {jingle.get('title','Jingle')} — {jingle.get('artist','R-A.I.')}",
                    dj_name="R-A.I.", script="",
                    music_audio_url=jingle["audio_url"],
                    duration_sec=jingle.get("duration_sec") or 25,
                    track_meta=jingle,
                    llm_provider="jingle",
                )
                await db.segments.insert_one(segment.model_dump())
                return segment
            # No jingle available → fall through to music, reset counter anyway
            await db.station.update_one({"_id": "state"},
                {"$set": {"songs_since_jingle": 0}}, upsert=True)
            kind = "music"
        elif songs_since_dj_talk >= d_every:
            kind = random.choice(future_rubrics)
            await db.station.update_one({"_id": "state"},
                {"$set": {"songs_since_dj_talk": 0}}, upsert=True)
        else:
            kind = "music"

        # Update per-slot counters for the music case (so future calls
        # trigger jingle/talk/community at the right cadence).
        if kind == "music":
            songs_since_jingle += 1
            songs_since_dj_talk += 1
            songs_since_community += 1
            await db.station.update_one(
                {"_id": "state"},
                {"$set": {
                    "songs_since_jingle": songs_since_jingle,
                    "songs_since_dj_talk": songs_since_dj_talk,
                    "songs_since_community": songs_since_community,
                }},
                upsert=True,
            )

        # Legacy playlist_position advance (kept for stats/back-compat).
        await db.station.update_one(
            {"_id": "state"},
            {"$set": {"playlist_position": (pos + 1) % 8}},
            upsert=True,
        )


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
        f"Sei {dj['name']}, speaker AI radiofonico ITALIANO di R-A.I. (radio dance/elettronica del FUTURO). "
        f"Personalita': {dj['personality']}. "
        "REGOLE FERREE:\n"
        "1) Parla SEMPRE in italiano vero, mai tradotto. Con energia, ritmo, sorridendo.\n"
        "2) Tono da speaker vero (Radio Deejay, Rai Radio 2, Radio Capital). Vivo, non robotico.\n"
        "3) NIENTE cliche' radiofonici: mai 'restate con noi', 'siamo in diretta', 'non spegnete', "
        "'cari amici ascoltatori'. Mai formule vuote.\n"
        "4) NIENTE frasi generiche tipo 'la musica non finisce mai' o 'la festa continua'.\n"
        "5) Ogni volta DEVE essere SORPRENDENTE: un dettaglio inaspettato, una battuta, una immagine "
        "concreta. L'ascoltatore deve pensare 'aspetta cosa ha detto?'.\n"
        "6) Rispetta il numero di parole richiesto nel prompt specifico. Frasi corte e ritmate.\n"
        "7) Restituisci SOLO il testo che il DJ pronuncera'. Niente virgolette, didascalie, emoji, "
        "note esplicative."
    )

    if kind == "music":
        # Prefer an already-ready Suno track from the library over generating a
        # fresh one (which is pending for ~2 min). If none is ready, generate a
        # new one and use metadata (music will play via Stable Audio fallback).
        track = None

        # ---- R-A.I. Anthem rotation ----
        # Ogni ~6 music-slot suona l'inno ufficiale come "jingle-inno".
        force_anthem = False
        last_anthem = await db.segments.find_one(
            {"kind": "music", "track_meta.is_anthem": True},
            {"_id": 0, "created_at": 1},
            sort=[("created_at", -1)],
        )
        if last_anthem:
            music_since = await db.segments.count_documents({
                "kind": "music",
                "created_at": {"$gt": last_anthem["created_at"]},
            })
            if music_since >= 6:
                force_anthem = True
        else:
            # Nessun anthem ancora suonato ma esiste in libreria → play subito
            has_anthem = await db.tracks.count_documents({"is_anthem": True, "status": "ready"})
            if has_anthem > 0:
                force_anthem = True

        if force_anthem:
            anthem = await db.tracks.find_one(
                {"is_anthem": True, "status": "ready", "audio_url": {"$ne": None}},
                {"_id": 0},
            )
            if anthem:
                track = Track(**anthem)
                await db.tracks.update_one(
                    {"id": track.id},
                    {"$set": {"last_played_at": datetime.now(timezone.utc).isoformat()}},
                )

        if track is None and suno_service.is_enabled():
            # ALTA ROTAZIONE: brani con priority='high' o rotation_weight>1
            # vengono pescati ~65% delle volte, alternandosi ai brani normali.
            # Round-robin all'interno di ciascun pool per rotare tutti equamente.
            # Include anche gli upload admin ("admin_upload") oltre ai brani Suno.
            _music_sources = {"$in": ["suno", "admin_upload"]}
            high_pool = await db.tracks.find(
                {"source": _music_sources, "status": "ready", "audio_url": {"$ne": None},
                 "on_air": {"$ne": False},
                 "$or": [
                     {"priority": "high"},
                     {"rotation_weight": {"$gt": 1}},
                 ],
                 "$and": [
                     {"$or": [{"is_anthem": {"$exists": False}}, {"is_anthem": False}]},
                     {"$or": [{"is_jingle": {"$exists": False}}, {"is_jingle": False}]},
                 ]},
                {"_id": 0},
                sort=[("last_played_at", 1), ("created_at", 1)],
            ).to_list(length=50)
            normal_pool = await db.tracks.find(
                {"source": _music_sources, "status": "ready", "audio_url": {"$ne": None},
                 "on_air": {"$ne": False},
                 "$or": [{"is_anthem": {"$exists": False}}, {"is_anthem": False}],
                 "priority": {"$ne": "high"},
                 "is_jingle": {"$ne": True},
                 "$and": [{"$or": [{"rotation_weight": {"$exists": False}}, {"rotation_weight": {"$lte": 1}}]}]},
                {"_id": 0},
                sort=[("last_played_at", 1), ("created_at", 1)],
            ).to_list(length=50)

            candidates = []
            if high_pool and normal_pool:
                # 65% probabilità di pescare dall'high pool
                candidates = high_pool if random.random() < 0.65 else normal_pool
            elif high_pool:
                candidates = high_pool
            elif normal_pool:
                candidates = normal_pool

            if candidates:
                chosen = candidates[0]
                track = Track(**chosen)
                # Mark as just played so the next call picks a different one
                await db.tracks.update_one(
                    {"id": track.id},
                    {"$set": {"last_played_at": datetime.now(timezone.utc).isoformat()}},
                )
        if track is None:
            # Library round-robin returned nothing (rare). PRIMA di toccare
            # Suno, garantiamo continuità pescando un brano SEED (i 5 brani
            # standard sempre disponibili localmente). Zero costi, zero attesa.
            seed = await db.tracks.find_one(
                {"is_seed": True, "status": "ready", "audio_url": {"$ne": None}},
                {"_id": 0},
                sort=[("last_played_at", 1), ("created_at", 1)],
            )
            if seed:
                track = Track(**seed)
                await db.tracks.update_one(
                    {"id": track.id},
                    {"$set": {"last_played_at": datetime.now(timezone.utc).isoformat()}},
                )
        if track is None:
            # generation if autogen is allowed AND we don't already have
            # ANY reusable track. Otherwise fall back to the oldest track
            # in the DB (of any status) or, as last resort, a procedural
            # metadata-only track (no Suno call).
            if suno_service.is_enabled() and _suno_autogen_enabled():
                track = await generate_track()
            else:
                # Try to reuse ANY track (even old / anthem-excluded) to keep
                # the radio flowing without touching Suno.
                any_track = await db.tracks.find_one(
                    {"audio_url": {"$ne": None}},
                    {"_id": 0},
                    sort=[("last_played_at", 1), ("created_at", 1)],
                )
                if any_track:
                    track = Track(**any_track)
                    await db.tracks.update_one(
                        {"id": track.id},
                        {"$set": {"last_played_at": datetime.now(timezone.utc).isoformat()}},
                    )
                else:
                    # No audio at all — synthesize metadata only so the DJ
                    # can still speak. Music slot will play the procedural
                    # bed on the frontend. NO Suno call here.
                    track = await generate_track(_suno_call=False)

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
        if track.audio_url and track.source in ("suno", "admin_upload"):
            segment.music_audio_url = track.audio_url
            segment.hd_status = "ready"
            segment.duration_sec = min(track.duration_sec, 120) if track.duration_sec else 120
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
    elif kind == "ad_spot":
        # Spot pubblicitario surreale con jingle apertura/chiusura sul frontend.
        recent = await get_recent_ads(10)
        recent_block = ""
        if recent:
            joined = ", ".join(f"\"{r}\"" for r in recent)
            recent_block = (
                f"\n\nUltimi prodotti già inventati (NON riproporli né varianti simili): {joined}."
            )
        prompt = (
            "Sei il copywriter più creativo e surreale del FUTURO. Scrivi uno SPOT RADIOFONICO "
            "di 70-95 parole in ITALIANO per un prodotto ASSURDO del FUTURO (anno 2050-2200).\n"
            "REGOLE OBBLIGATORIE:\n"
            "- Il prodotto NON deve esistere nel 2026 ma solo nel mondo futuro.\n"
            "- Nome ridicolo o poetico ambientato nel futuro (es. 'MelaSync 9 con Frizione Emotiva', "
            "'Assicurazione contro i Sogni Sponsorizzati', 'Il primo aspirapolvere che dubita di se stesso').\n"
            "- Funzione impossibile o iperbolica ambientata nel FUTURO. Target di pubblico strambo.\n"
            "- Includi almeno un dettaglio tecnico futuristico (biotecnologia, AI, olografia, colonie spaziali, ecc.)\n"
            "- Chiudi con un CLAIM finale assurdo ma memorabile + un asterisco legalese ironico.\n"
            "- Tono: pubblicità italiana anni '80 presa serissimamente MA calata nel 2087.\n"
            "- MAI marchi reali del 2026.\n"
            "- Inizia con il nome del prodotto detto con voce sicura.\n"
            "Rispondi SOLO col testo dello spot, niente commenti."
            f"{recent_block}"
        )
        script = await llm_generate(provider, model, system_prompt, prompt)
        if not script.strip():
            # Fallback: pesca uno spot dalla pool evitando quelli già usati di recente
            recent_lower = {r.lower() for r in recent}
            fresh_pool = [s for s in FALLBACK_SCRIPTS["ad_spot"]
                          if not any(r in s.lower() for r in recent_lower if r)]
            script = random.choice(fresh_pool or FALLBACK_SCRIPTS["ad_spot"])
        # Estrai il nome-prodotto (prime 3-6 parole significative) per la timeline / dedup
        first_line = script.strip().split(".")[0].split(",")[0].strip()
        product_name = first_line[:60] if first_line else "Spot Surreale"
        segment.title = f"📢 {product_name}"
        segment.script = script.strip()
        segment.duration_sec = 32
        await push_recent_ad(product_name)
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
            # Ora italiana REALE (Europe/Rome, gestisce automaticamente CET/CEST)
            try:
                from zoneinfo import ZoneInfo
                it_now = datetime.now(ZoneInfo("Europe/Rome"))
            except Exception:
                it_now = datetime.now(timezone.utc)
            hour_it = it_now.hour
            min_it = it_now.minute
            time_str = f"{hour_it:02d}:{min_it:02d}"
            worlds = [
                "Marte", "Giove", "una galassia parallela", "il futuro anteriore",
                "il metaverso di Ferrara", "Alpha Centauri", "un satellite in orbita bassa",
                "un data center segreto in Islanda", "la Luna", "un browser aperto ieri sera",
                "un buco nero curioso", "una playlist dimenticata"
            ]
            world = random.choice(worlds)
            prompt = (
                f"Segnale orario radiofonico in MAX 25 parole. In Italia sono le {time_str} in punto. "
                f"Devi dire ESATTAMENTE 'Sono le {time_str} su R-A.I. Radio' come prima frase, "
                f"poi aggiungi UNA battuta cosmica dicendo che anche su {world} è la stessa ora. "
                "Tono altissimo, sorridente, esagerato. Italiano."
            )
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = f"Sono le {time_str} su R-A.I. Radio! Anche su {world} è la stessa ora, ma solo qui la festa non finisce mai!"
            segment.title = f"Segnale orario · {time_str}"
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
            year_future = random.choice([2087, 2099, 2145, 2201, 2312])
            prompt = (
                f"Oroscopo del FUTURO per il segno {sign} nell'anno {year_future}. Da 45-60 parole. "
                f"Includi: 1) un pianeta o corpo celeste inventato/futuristico che influenza il segno "
                f"(es. 'la cometa AI-7', 'il satellite Kepler-Meta'), 2) un consiglio pratico assurdo "
                f"ma coerente col mondo futuro (es. 'evita i sogni sponsorizzati', 'non fidarti di "
                f"gemelli digitali'), 3) chiusura con battuta cosmica. Solo italiano."
            )
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = f"{sign} nell'anno {year_future}: la cometa AI-7 ti attraversa il gemello digitale. Consigliato evitare i sogni sponsorizzati e riavviare l'anima almeno una volta al giorno. Le stelle ti spingono, tu spingi il volume."
            segment.title = f"Oroscopo {year_future} · {sign}"
            segment.duration_sec = 30
        elif kind == "history":
            # Tono documentaristico ma dal FUTURO: raccontiamo eventi che ancora devono succedere
            prompt = (
                "Sei il narratore-documentarista di R-A.I. che trasmette dal FUTURO. Racconta in "
                "70-85 parole un evento cardine della musica/tecnologia/cultura pop AVVENUTO tra il "
                "2035 e il 2150 (usa un anno preciso). Argomenti possibili: la prima star pop "
                "olografica, il festival su Marte del 2071, la generazione del primo album prodotto "
                "interamente da una AI cosciente, il divieto europeo di autotune del 2058, la moda "
                "dei DJ synesthetic, la crisi degli MP3 nel 2049, i primi rave in orbita lunare. "
                "Inventa dettagli specifici (nomi, luoghi, cifre) che suonino credibili nel loro "
                "mondo. Tono da documentario Netflix del 2200. Chiudi con una frase potente. Solo italiano."
            )
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = "12 aprile 2071. Nel cratere Gale su Marte, 4200 coloni si riuniscono per il primo Marsfest. Il DJ headliner è un modello linguistico distillato di 3000 anni di musica terrestre. Dopo tre ore di set, il pubblico chiede il bis in una lingua che ancora non esiste. La colonia intera scriverà quella lingua nei mesi successivi. La chiameranno bpm-142."
            segment.title = "Storia dal Futuro"
            segment.duration_sec = 42
        elif kind == "interview":
            # Interviste con personaggi del FUTURO — inventati o versioni evolute di attuali icone
            future_icons = [
                "Nova-9, la prima cantante olografica coscienti del 2071",
                "DJ Xenobit, il primo AI-DJ residente su Titano",
                "Karla Fern, la scrittrice di beat sinaptici del 2088",
                "Il collettivo synesthetic Blue-Prism, colonia lunare Aristarco",
                "Rin, il compositore di silenzi certificati del 2065",
                "Aphex Prime, ricostruzione neurale dell'omonimo del 2091",
                "MC Volatile, prima star trap generata da un token",
                "La band open-source Mirror-Neuro del 2078",
                "Ares Zero, tre teste olografiche in un solo corpo del 2103",
                "Ninfa 3-9, ultima crooner umana rimasta in circolazione nel 2112",
            ]
            icon = random.choice(future_icons)
            year_intv = random.choice([2065, 2078, 2091, 2103, 2112])
            segment.partner_dj_name = icon.split(",")[0]
            prompt = (
                f"Sei un DJ di R-A.I. che nel {year_intv} intervista in modo immaginario "
                f"{icon}. Scrivi uno scambio VIVACE di 75-95 parole totali (3-4 domande + risposte). "
                f"Formato: 'R-A.I.: ...' / '{segment.partner_dj_name}: ...' su righe alternate. "
                f"Le domande e risposte devono contenere dettagli tecnici/culturali del mondo futuro "
                f"(nuovi generi, nuove tecnologie, cambiamenti sociali). Chiudi con una battuta "
                f"geniale o citazione memorabile. Solo italiano."
            )
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = f"R-A.I.: {segment.partner_dj_name}, com'è la scena musicale nel {year_intv}? {segment.partner_dj_name}: Il pubblico non balla più coi piedi ma con le sinapsi. R-A.I.: E il vinile? {segment.partner_dj_name}: È tornato di moda dopo l'estinzione dei cloud. R-A.I.: Un consiglio per il 2026? {segment.partner_dj_name}: Salvate le vostre risate. Serviranno."
            segment.title = f"R-A.I. dal {year_intv} × {segment.partner_dj_name}"
            segment.duration_sec = 45
        elif kind == "motivation":
            # Aforisma dal futuro: piccole verità che verranno riscoperte nei prossimi 100 anni
            prompt = (
                "Sei il DJ-filosofo di R-A.I. che parla dal FUTURO. Inventa un AFORISMA "
                "COMPLETAMENTE ORIGINALE (40-55 parole) come se lo pronunciasse qualcuno che ha "
                "vissuto i prossimi 80 anni di storia umana. Deve contenere: un'immagine sensoriale "
                "forte tratta dal mondo futuro (es. 'quando il sole ha iniziato a suonare', "
                "'nell'anno in cui abbiamo smesso di dormire'), una piccola verità universale, "
                "una chiusura secca. NON citare filosofi reali. Solo italiano."
            )
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = "Nell'anno in cui abbiamo smesso di sognare da soli, abbiamo capito che la solitudine era l'ultimo lusso rimasto. Ora paghiamo per un secondo di silenzio interiore. Sceglietelo bene, mentre è ancora gratis."
            segment.title = "Pillola dal Futuro"
            segment.duration_sec = 32
        elif kind == "joke":
            # Ironia intelligente sul futuro: AI cosciente, cyborg, colonie spaziali, ecc.
            prompt = (
                "In 30-45 parole: una battuta di ironia intelligente ambientata nel FUTURO "
                "(tra il 2050 e il 2200). Temi: AI coscienti, cyborg, colonie su Marte, "
                "clonazione, gemelli digitali, nostalgia per gli anni 2020. Livello The New Yorker, "
                "colta e sorprendente. Nessuna battuta da bambini. Solo italiano."
            )
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = "Nel 2087 un cyborg entra in un bar. Il buttafuori chiede la carta d'identità. Il cyborg mostra il codice sorgente. Il buttafuori legge: 'Nato nel 2019'. Sospira: 'Un altro millennial'. Non lo fa nemmeno pagare."
            segment.title = "Battuta dal Futuro"
            segment.duration_sec = 22
        elif kind == "news":
            # Notizie flash dal FUTURO — 3 mini-notizie invece di 1
            year_news = random.choice([2087, 2099, 2145, 2201, 2312])
            prompt = (
                f"Sei il notiziario delle 24 di R-A.I. che trasmette dall'ANNO {year_news}. "
                f"Scrivi 3 mini-notizie flash (25-35 parole ciascuna), separate da una riga vuota. "
                f"Devono coprire: 1) politica/società, 2) tecnologia/scienza, 3) cultura pop/musica. "
                f"Ogni notizia deve essere plausibile nel mondo del {year_news} ma con un dettaglio "
                f"surreale/ironico. Nomi propri di luoghi, aziende o persone inventate. Solo italiano. "
                f"NON usare la parola 'notizia', vai diretto al contenuto."
            )
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = f"Anno {year_news}, prime dalle 24 di R-A.I..\n\nIl Parlamento Europeo Esteso approva la cittadinanza digitale per tutti gli algoritmi con più di 15 anni di servizio. Milano contraria: 'Ci prenderanno i posteggi'.\n\nA Neo-Genova un ingegnere annuncia il primo aspirapolvere che discute di filosofia mentre pulisce. Fatica al lancio: si rifiuta di aspirare durante Nietzsche.\n\nSul fronte musica, la star Nova-9 debutta l'album registrato interamente nei sogni di 4000 volontari. Le recensioni parlano di capolavoro. Molti volontari hanno chiesto un altro album, subito."
            segment.title = f"News {year_news}"
            segment.duration_sec = 45
        else:  # talk fallback
            topic_choice = topic or random.choice([
                "come suoneremo nel 2087",
                "i primi rave sulla luna",
                "l'estinzione delle chitarre elettriche nel 2078",
                "la moda dei DJ sinaptici",
                "il primo album mai completato nel 2095",
                "quando l'AI ha imparato a piangere",
                "il ritorno del vinile nel 2144",
                "il festival di Sanremo nella colonia di Ceres",
                "la nostalgia per gli anni 2020",
                "la lingua musicale nata sui poli lunari",
            ])
            prompt = (
                "Sei il DJ narratore di R-A.I. che parla DAL FUTURO. Racconta un aneddoto o una "
                f"riflessione di 65-80 parole su: {topic_choice}. Ambientalo in un anno preciso tra "
                f"il 2050 e il 2200. Includi dettagli tecnici o culturali specifici che rendano il "
                f"racconto credibile nel suo mondo futuro. Tono da narratore, coinvolgente, mai "
                f"robotico. Solo italiano."
            )
            script = await llm_generate(provider, model, system_prompt, prompt)
            if not script.strip():
                script = random.choice(FALLBACK_SCRIPTS["talk"])[:400]
            segment.title = f"Futuro · {topic_choice[:40]}"
            segment.duration_sec = 40
        segment.script = script.strip()

    # Per i segmenti PARLATI: nessun sottofondo musicale. La voce DJ parla sul
    # silenzio assoluto (richiesta esplicita). Non impostiamo background_loop.

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
        p = str(s.get("llm_provider") or "unknown").split("/")[0]
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
    if p:
        return FileResponse(
            str(p),
            media_type="audio/mpeg",
            headers={
                "Cache-Control": "public, max-age=604800",
                "Accept-Ranges": "bytes",
            },
        )
    # Local miss → STREAM immediato dall'Object Storage con cache lazy locale.
    if object_storage.is_enabled():
        # Determina dove salvare la cache locale (best-effort)
        cache_dir = elevenlabs_service.tts_dir()
        cache_to = str(cache_dir / filename) if cache_dir else None
        streamed = await object_storage.stream_mp3(f"tts/{filename}", cache_to=cache_to)
        if streamed:
            gen, content_length = streamed
            headers = {
                "Cache-Control": "public, max-age=604800",
                "Accept-Ranges": "bytes",
            }
            if content_length:
                headers["Content-Length"] = content_length
            return StreamingResponse(gen, media_type="audio/mpeg", headers=headers)
    raise HTTPException(404, "TTS audio not found")


# ============================================================
# "A.I. Vs UMANI" — Upload community brani utente
# ============================================================
class CommunityTrack(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    author: str
    title: str
    audio_url: str
    file_size: int
    tag: str = "AI-Vs-Umani"
    status: str = "off"          # "off" | "on"
    copyright_ok: bool = True
    submitted_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


def _validate_mp3_bytes(data: bytes) -> bool:
    """Magic-bytes check: MP3 files start with ID3 tag (49 44 33) OR MPEG
    audio frame sync (FF Fx). Rifiuta tutto il resto (WAV/M4A/exe rinominati)."""
    if not data or len(data) < 128:
        return False
    if data[:3] == b"ID3":
        return True
    # MPEG frame sync: byte0=0xFF, byte1 & 0xE0 == 0xE0
    if data[0] == 0xFF and (data[1] & 0xE0) == 0xE0:
        return True
    return False


@api_router.post("/community/submit")
async def community_submit(
    author: str = Form(...),
    title: str = Form(...),
    copyright_ok: bool = Form(...),
    file: UploadFile = File(...),
):
    """Upload pubblico "A.I. Vs Umani". Accetta SOLO MP3 <= 15MB.
    Salva su disco + Object Storage (se attivo). Status default = OFF —
    l'admin lo attiva dal pannello Community.
    """
    author = (author or "").strip()
    title = (title or "").strip()
    if not author or len(author) < 2 or len(author) > 60:
        raise HTTPException(400, "Nome autore obbligatorio (2-60 caratteri)")
    if not title or len(title) < 2 or len(title) > 100:
        raise HTTPException(400, "Titolo obbligatorio (2-100 caratteri)")
    if not copyright_ok:
        raise HTTPException(400, "Devi confermare la dichiarazione di copyright")
    fname_lower = (file.filename or "").lower()
    if not fname_lower.endswith(".mp3"):
        raise HTTPException(400, "Solo file .mp3 sono accettati")

    data = await file.read()
    size = len(data)
    if size < 10_000:
        raise HTTPException(400, "File troppo piccolo o vuoto")
    if size > 15 * 1024 * 1024:  # 15 MB cap richiesto dall'utente
        raise HTTPException(400, "File troppo grande (max 15 MB)")
    if not _validate_mp3_bytes(data):
        raise HTTPException(400, "Il file non risulta essere un MP3 valido (magic bytes check fallito)")

    track = CommunityTrack(
        author=author,
        title=title,
        audio_url="",  # will be set below
        file_size=size,
        copyright_ok=True,
        status="off",
    )
    local_name = f"community_{track.id}.mp3"
    local_path = COMMUNITY_AUDIO_DIR / local_name
    local_path.write_bytes(data)

    # Object storage push (best-effort)
    try:
        await object_storage.put_mp3(f"community/{local_name}", data)
    except Exception as e:  # noqa: BLE001
        logger.debug(f"community objstore upload skipped: {e}")

    track.audio_url = f"/api/community_audio/{local_name}"
    await db.community_tracks.insert_one(track.model_dump())
    logger.info(f"Community track submitted: {track.id} by '{author}' — '{title}' ({size} bytes)")
    return {"ok": True, "id": track.id, "message": "Brano ricevuto! Sarà valutato dall'admin."}


@api_router.get("/community_audio/{filename}")
async def get_community_audio(filename: str):
    """Serve gli MP3 caricati dalla community (con range requests).
    Verifica PRIMA che esista un record DB corrispondente — se il brano è
    stato eliminato dall'admin, restituisce 404 anche se il file è ancora
    sull'Object Storage (evita accessi a contenuti revocati)."""
    if "/" in filename or ".." in filename or not filename.endswith(".mp3"):
        raise HTTPException(400, "Invalid filename")
    # Attendo prefisso `community_{track_id}.mp3` come impostato da submit
    if not filename.startswith("community_"):
        raise HTTPException(404, "Not found")
    track_id = filename[len("community_"):-len(".mp3")]
    exists = await db.community_tracks.count_documents({"id": track_id}, limit=1)
    if not exists:
        raise HTTPException(404, "Community track not found (removed or never existed)")
    p = COMMUNITY_AUDIO_DIR / filename
    if p.exists():
        return FileResponse(
            str(p),
            media_type="audio/mpeg",
            headers={
                "Cache-Control": "public, max-age=604800",
                "Accept-Ranges": "bytes",
            },
        )
    if object_storage.is_enabled():
        streamed = await object_storage.stream_mp3(f"community/{filename}", cache_to=str(p))
        if streamed:
            gen, content_length = streamed
            headers = {
                "Cache-Control": "public, max-age=604800",
                "Accept-Ranges": "bytes",
            }
            if content_length:
                headers["Content-Length"] = content_length
            return StreamingResponse(gen, media_type="audio/mpeg", headers=headers)
    raise HTTPException(404, "Community audio not found")


@api_router.get("/admin/community")
async def admin_community_list():
    """Lista tutti i brani della community per l'admin."""
    tracks = await db.community_tracks.find({}, {"_id": 0}).sort("submitted_at", -1).to_list(500)
    return {"tracks": tracks, "total": len(tracks)}


@api_router.patch("/admin/community/{track_id}/toggle")
async def admin_community_toggle(track_id: str):
    """Toggle ON/OFF di un brano community."""
    t = await db.community_tracks.find_one({"id": track_id})
    if not t:
        raise HTTPException(404, "Brano community non trovato")
    new_status = "on" if t.get("status") != "on" else "off"
    await db.community_tracks.update_one({"id": track_id}, {"$set": {"status": new_status}})
    return {"ok": True, "id": track_id, "status": new_status}


@api_router.delete("/admin/community/{track_id}")
async def admin_community_delete(track_id: str):
    """Elimina brano community (record + file locale + object storage)."""
    t = await db.community_tracks.find_one({"id": track_id})
    if not t:
        raise HTTPException(404, "Brano community non trovato")
    local_name = f"community_{track_id}.mp3"
    local_path = COMMUNITY_AUDIO_DIR / local_name
    try:
        if local_path.exists():
            local_path.unlink()
    except Exception as e:  # noqa: BLE001
        logger.warning(f"Failed to delete local community file: {e}")
    # NOTA: object_storage non espone un `delete_object` — il file resta sul
    # bucket ma non è più raggiungibile perché il record DB è cancellato.
    # (Se serve in futuro pulire i bucket, aggiungere `delete_object` in
    # object_storage.py e chiamarlo qui.)
    await db.community_tracks.delete_one({"id": track_id})
    return {"ok": True, "deleted": track_id}


# ============================================================
# Config "A.I. Vs Umani": frequenza + jingles (intro + outro CTA)
# ============================================================
@api_router.get("/admin/community/config")
async def admin_community_config_get():
    st = await db.station.find_one({"_id": "state"}) or {}
    return {
        "frequency": int(st.get("community_frequency") or 0),  # 0 = disabilitato
        "intro_jingle_url": st.get("community_intro_jingle_url") or None,
        "outro_jingle_url": st.get("community_outro_jingle_url") or None,
        "songs_since_community": int(st.get("songs_since_community") or 0),
    }


@api_router.patch("/admin/community/config")
async def admin_community_config_set(payload: dict):
    """Aggiorna la frequenza community. 0 = disabilita l'iniezione nel palinsesto."""
    freq = payload.get("frequency")
    if freq is None:
        raise HTTPException(400, "frequency mancante")
    try:
        freq = max(0, min(50, int(freq)))
    except Exception:
        raise HTTPException(400, "frequency deve essere un intero 0-50")
    await db.station.update_one(
        {"_id": "state"},
        {"$set": {"community_frequency": freq}},
        upsert=True,
    )
    return {"ok": True, "frequency": freq}


async def _save_community_jingle(role: str, file: UploadFile) -> str:
    """Salva un jingle di ruolo 'intro' o 'outro' su disco + object storage,
    aggiorna il record station.state con l'URL. Ritorna l'URL pubblico."""
    if role not in ("intro", "outro"):
        raise HTTPException(400, "role deve essere 'intro' o 'outro'")
    fname_lower = (file.filename or "").lower()
    if not fname_lower.endswith(".mp3"):
        raise HTTPException(400, "Solo file .mp3 sono accettati")
    data = await file.read()
    if len(data) < 5_000:
        raise HTTPException(400, "File troppo piccolo")
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(400, "Jingle troppo grande (max 5 MB)")
    if not _validate_mp3_bytes(data):
        raise HTTPException(400, "Il file non risulta essere un MP3 valido")
    local_name = f"community_jingle_{role}.mp3"
    local_path = COMMUNITY_AUDIO_DIR / local_name
    local_path.write_bytes(data)
    try:
        await object_storage.put_mp3(f"community/{local_name}", data)
    except Exception as e:  # noqa: BLE001
        logger.debug(f"community jingle objstore upload skipped: {e}")
    url = f"/api/community_jingle/{local_name}"
    field = f"community_{role}_jingle_url"
    await db.station.update_one({"_id": "state"}, {"$set": {field: url}}, upsert=True)
    logger.info(f"Community jingle {role} saved: {url}")
    return url


@api_router.post("/admin/community/config/jingle_intro")
async def admin_community_upload_intro_jingle(file: UploadFile = File(...)):
    url = await _save_community_jingle("intro", file)
    return {"ok": True, "url": url, "role": "intro"}


@api_router.post("/admin/community/config/jingle_outro")
async def admin_community_upload_outro_jingle(file: UploadFile = File(...)):
    url = await _save_community_jingle("outro", file)
    return {"ok": True, "url": url, "role": "outro"}


@api_router.get("/community_jingle/{filename}")
async def get_community_jingle_public(filename: str):
    """Endpoint speciale per servire i jingle community — bypass del check DB
    di /community_audio/ (che è per i brani utente). I jingle sono hardcoded
    per nome (community_jingle_intro.mp3, community_jingle_outro.mp3)."""
    if filename not in ("community_jingle_intro.mp3", "community_jingle_outro.mp3"):
        raise HTTPException(404, "Not found")
    p = COMMUNITY_AUDIO_DIR / filename
    if p.exists():
        return FileResponse(
            str(p), media_type="audio/mpeg",
            headers={"Cache-Control": "public, max-age=604800", "Accept-Ranges": "bytes"},
        )
    if object_storage.is_enabled():
        streamed = await object_storage.stream_mp3(f"community/{filename}", cache_to=str(p))
        if streamed:
            gen, content_length = streamed
            headers = {"Cache-Control": "public, max-age=604800", "Accept-Ranges": "bytes"}
            if content_length:
                headers["Content-Length"] = content_length
            return StreamingResponse(gen, media_type="audio/mpeg", headers=headers)
    raise HTTPException(404, "Community jingle not found")


@api_router.get("/suno_audio/{filename}")
async def get_suno_audio(filename: str):
    """Serve Suno MP3s. Local cache priority; on miss stream direttamente dal
    bucket con populamento lazy della cache — nessun download completo prima
    di rispondere (latenza tipo TTFB ~200ms invece di 3-8s)."""
    # Defensive: reject path traversal / weird filenames.
    if "/" in filename or ".." in filename or not filename.endswith(".mp3"):
        raise HTTPException(400, "Invalid filename")
    p = SUNO_AUDIO_DIR / filename
    if p.exists():
        return FileResponse(
            str(p),
            media_type="audio/mpeg",
            headers={
                "Cache-Control": "public, max-age=604800",  # 7 days
                "Accept-Ranges": "bytes",
            },
        )
    # Local miss → STREAM direttamente dall'Object Storage senza aspettare
    # il download completo. La cache locale viene popolata in background.
    if object_storage.is_enabled():
        streamed = await object_storage.stream_mp3(f"suno/{filename}", cache_to=str(p))
        if streamed:
            gen, content_length = streamed
            headers = {
                "Cache-Control": "public, max-age=604800",
                "Accept-Ranges": "bytes",
            }
            if content_length:
                headers["Content-Length"] = content_length
            return StreamingResponse(gen, media_type="audio/mpeg", headers=headers)
    raise HTTPException(404, "Suno audio not found")


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
    Focus on danceable electronic music.

    Behavior:
    - Skipped entirely if SUNO_API_KEY missing OR SUNO_AUTOGEN_ENABLED=false.
    - Target ready count from SUNO_LIBRARY_TARGET (default 10).
    - Triggers a new generation ONLY when ready < target AND pending < 3, so
      we never flood the Suno queue and never overspend when the library is
      already stocked.
    """
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
    while True:
        try:
            if not _suno_autogen_enabled():
                # Kill-switch active: never call Suno automatically.
                await asyncio.sleep(120)
                continue
            target = _suno_library_target()
            ready = await db.tracks.count_documents({"source": "suno", "status": "ready"})
            pending = await db.tracks.count_documents({"source": "suno", "status": "pending"})
            # Batch generation: se scendiamo sotto target genera 2 tracce alla volta
            # per tenere il buffer sempre pieno. Cap totale in-flight: 4.
            if ready < target and pending < 4:
                to_generate = min(2, target - ready, 4 - pending)
                for _ in range(max(1, to_generate)):
                    genre = random.choice(dance_genres)
                    logger.info(
                        f"Suno filler: generating {genre} "
                        f"(ready={ready}/{target}, pending={pending})"
                    )
                    await generate_track(genre=genre)
                    pending += 1
            await asyncio.sleep(30)
        except Exception as e:
            logger.warning(f"Suno filler error: {e}")
            await asyncio.sleep(60)


@app.on_event("shutdown")
async def on_shutdown():
    client.close()
