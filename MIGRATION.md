# R-A.I. · MIGRAZIONE SU SERVER DEDICATO ESTERNO
_Data consegna_: 2026-02-06 · _Versione_: v13.16 True Broadcaster

## STATO CODICE — PRONTO PER EXPORT

L'intera codebase è indipendente dal Tier 0 di Emergent. Solo `.env`
governa gli endpoint e le chiavi. Nessuna chiamata a servizi interni
proprietari eccetto **Emergent Object Storage** (opzionale, sostituibile
con S3/R2/MinIO scrivendo un adapter in `backend/object_storage.py`).

## FILE CRITICI DA ESPORTARE

### Backend (FastAPI + Motor async MongoDB)
- `backend/server.py` — API + station_clock + video_clock + gate AI + endpoint HLS
- `backend/auth.py` — JWT admin login (bcrypt)
- `backend/elevenlabs_service.py` — TTS con cache Mongo hash-based
- `backend/suno_service.py` — Suno API integration
- `backend/object_storage.py` — layer astratto (sostituibile con S3)
- `backend/bpm_service.py` — beat detection librosa
- `backend/video_service.py` — probing ffprobe
- `backend/telegram_bot.py` — bot Telegram (se usato)
- `backend/requirements.txt` — dipendenze Python (librosa, motor, fastapi, ecc.)
- `backend/.env.example` — schema variabili (NON committare i valori reali)

### Frontend (React CRA + Tailwind)
- `frontend/src/` — tutto il tree components/pages/lib
- `frontend/package.json` — dipendenze (hls.js, lucide-react, sonner, ecc.)
- `frontend/tailwind.config.js` + `craco.config.js`
- `frontend/.env.example` — schema (REACT_APP_BACKEND_URL)

### Documentazione
- `memory/PRD.md`, `memory/test_credentials.md`
- `MIGRATION.md` (questo file)

## VARIABILI D'AMBIENTE RICHIESTE

### backend/.env
```
MONGO_URL=mongodb://user:pass@host:27017
DB_NAME=rai_production
JWT_SECRET=<generate con: openssl rand -hex 32>
ADMIN_EMAIL=admin
ADMIN_PASSWORD=<strong password>
EMERGENT_LLM_KEY=<opzionale, per LLM/TTS via Emergent gateway>
ELEVENLABS_API_KEY=<per TTS premium>
SUNO_API_KEY=<per generazione musicale>
USE_OBJECT_STORAGE=true
OBJECT_STORAGE_BASE=<endpoint bucket>
OBJECT_STORAGE_APP=rai
SUNO_AUTOGEN_ENABLED=false
BACKGROUND_TASKS_ENABLED=true   # su tier di produzione attiva i loop 24/7
```

### frontend/.env
```
REACT_APP_BACKEND_URL=https://api.tuodominio.com
```

## COMANDI DI DEPLOY (VPS Ubuntu 22.04+)

```bash
# 1. Sistema
apt update && apt install -y python3.11 python3.11-venv ffmpeg nodejs npm nginx mongodb

# 2. Backend
cd /var/www/rai/backend
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# supervisor o systemd unit → uvicorn server:app --host 0.0.0.0 --port 8001 --workers 4

# 3. Frontend
cd /var/www/rai/frontend
yarn install && yarn build
# nginx serve /var/www/rai/frontend/build/

# 4. nginx (proxy API + serve static + cache HLS)
# proxy_pass http://127.0.0.1:8001 per /api/
# proxy_cache per /api/stream/live.m3u8 con max-age 1s → scala a migliaia
```

## OTTIMIZZAZIONE PER MIGLIAIA DI CLIENT

`/api/stream/live.m3u8` è idempotente e statico per ~1s. Configurare nginx
o Cloudflare come cache edge:

```nginx
location /api/stream/live.m3u8 {
    proxy_pass http://127.0.0.1:8001;
    proxy_cache hls_cache;
    proxy_cache_valid 200 1s;
    proxy_cache_use_stale updating error;
    add_header X-Cache-Status $upstream_cache_status;
}
```

Un backend Uvicorn con 4 worker regge ~500 req/s sul m3u8. Con CDN edge
(Cloudflare piano free): 1 hit backend ogni 1s → **teoricamente
illimitato**.

I file mp3/mp4 servono con `Range` support già cablato in `object_storage.py`
e vengono serviti dal bucket (non toccano il backend Python).

## SYNC ARCHITECTURE — TRUE BROADCASTER

- **`station_clock`** (Mongo doc `_id="clock"`): current + queue + music_counter + started_at
- **`_clock_ticker`** (background 2s): avanza automaticamente
- **`_clock_pick_dj_jingle`**: ogni 3 brani musicali inietta un jingle DJ dalla libreria (`tracks.is_jingle=true`) → **musica + DJ sincronizzati**
- **`/api/stream/live.m3u8`**: emette playlist HLS EVENT con `#EXT-X-START:TIME-OFFSET` + `#EXT-X-PROGRAM-DATE-TIME` → tutti i client sullo stesso frame
- **Self-heal**: al primo request dopo pod dormiente, `_clock_advance` ricalcola in-memory saltando le tracce già scadute

## COSA RIMUOVERE PRIMA DEL DEPLOY PROD
- File `.git/` + `.emergent/` (metadata piattaforma sviluppo)
- Console.log di debug in frontend/src/lib/radioEngine.js
- File di test in `backend/tests/` se non servono in prod

## CREDENZIALI ADMIN CORRENTI (da cambiare in prod)
Vedi `memory/test_credentials.md`

## PROSSIMI PASSI POST-MIGRAZIONE
1. Sostituire `object_storage.py` con adapter S3 se non si usa Emergent OS
2. Configurare backup automatici Mongo (mongodump quotidiano)
3. Configurare Certbot per HTTPS gratuito
4. Attivare `BACKGROUND_TASKS_ENABLED=true` per Suno filler + Time signal pregenerator
5. Configurare monitoring (uptime + Sentry frontend)
