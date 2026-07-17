# NEURA·FM — AI Web Radio (Prototipo Beta)

## Original problem statement
Vorrei costruire un software di gestione radiofonica completamente automatizzato e gestito dalle A. I. Un software con un pannello che consenta di creare la prima webradio pensata e gestita esclusivamente da intelligenze artificiali che interfacciandosi tra loro creino una web radio esclusiva con musica inventata con interazioni vocali su argomenti vari attraverso le diverse sintesi vocali e che magari rispondano a quesiti proposti da umani attraverso social o numero di telefono dedicato.

## User personas
- **Station owner (admin)**: gestisce DJ AI, palinsesto, coda domande.
- **Public listener**: ascolta la radio in diretta dal browser e invia domande.

## Architecture
- Backend: FastAPI + MongoDB + `emergentintegrations` (multi-LLM router: OpenAI GPT-5.2, Anthropic Claude Sonnet 4.5, Google Gemini 3 Flash).
- Frontend: React 19 + Tailwind + Shadcn UI + lucide-react + framer-motion for animations, sonner for toasts.
- Audio: Browser Web Speech API (TTS) + Web Audio API procedural synthesis (music) — 100 % client-side, zero cost. Ready to swap in ElevenLabs / Suno when the user activates paid keys.
- Auth: Emergent Google OAuth (free) for admin.

## What's implemented (2026-08 · v10 · Stability fixes)
- **v10.8 · Ad Spot surreali** (2026-02, this session):
  - Nuovo `kind="ad_spot"` nel Segment `Literal` + peso **6** nel `random.choices` pool.
  - Anti-double: se l'ultimo segmento era `ad_spot` il prossimo viene forzato a `music`.
  - `StationState.recent_ads: List[str]` (buffer circolare max 10) + helper `get_recent_ads/push_recent_ad`.
  - Prompt LLM `ad_spot`: copywriter surreale, 60-80 parole, prodotto NON esistente, nome ridicolo/poetico, funzione impossibile, claim assurdo, tono anni '80 preso serissimamente, no marchi reali. Include gli ultimi 10 spot come "NON riproporre".
  - 5 spot fallback hand-written in `FALLBACK_SCRIPTS["ad_spot"]`: **SolarLuna** (crema solare per chi lavora di notte), **Silenzio Premium** (abbonamento al silenzio), **Le Pigrini** (sneakers per pigri certificati), **MemoriaLite** (corso per dimenticare cose inutili), **Codex Fresh** (profumo che odora di algoritmi). Fallback picker esclude quelli già in `recent_ads`.
  - **Frontend `radioEngine`**:
    - Nuovo `_playAdSpot(segment)`: `[jingle apertura 1.35s] → [voce TTS + bed strumentale a 0.15] → [jingle chiusura 1.0s]`.
    - Nuovo `_adJingle(variant)` procedurale (Web Audio API, zero credit Suno): `open` = fanfara ascendente A4→A5 con sparkle + chord pad; `close` = pinger discendente con bass thump.
    - `playSegment` gestisce `kind === "ad_spot"` prima dello speech-generic.
  - Verifica live: 5 richieste ad_spot consecutive → alternanza corretta ad_spot / music (SolarLuna, poi music, poi Codex Fresh, poi music, poi music), buffer `recent_ads` correttamente popolato e usato dal fallback picker per evitare ripetizioni.
- **v10.7 · Salto di qualità editoriale** (precedente):
  - **1. Speaker sempre originali (anti-ripetizione)**:
    - `StationState` esteso con `recent_intros: List[str]` (buffer circolare, max 20).
    - Nuovi helper `get_recent_intros(n)` e `push_recent_intro(line)` (usa `$push` con `$slice: -20`).
    - Nuova costante `DJ_TONES` con 10 toni distinti (poetico, ironico, cinematografico, minimalista, misterioso, energico, documentaristico, sognante, sarcastico, affettuoso).
    - Prompt music-intro e music-outro riscritti: includono le ultime 10 frasi già dette con istruzione "NON RIUSARE nulla di simile", tono estratto casualmente da `DJ_TONES`, "non usare mai il tono classico da annunciatore radio". Ogni intro+outro viene salvato nel buffer circolare.
  - **2. Stinger sonori tra rubriche**: nuovo metodo `radioEngine.playStinger(fromKind, toKind)` **procedurale** (Web Audio API, zero file esterni, zero crediti Suno). Palette dedicata per target: news→campanella a due toni discendenti, joke→boing playful, history/interview→noise-burst tipo vinyl scratch + thud, music→riser + kick "beat drop", talk generico→swoosh + blip. In `PublicRadio.js` il loop chiama `playStinger(prevKind, seg.kind)` solo se il tipo cambia tra un segmento e il successivo.
  - **3. Identità sonora per rubrica (LLM prompts)**:
    - **history**: tono documentaristico, DEVE iniziare con una data precisa o un luogo specifico (es. "15 giugno 1988", "In un sottoscala di Detroit").
    - **interview**: dialogo immaginario con un/una leggenda della musica elettronica (Aphex Twin, Daft Punk, Peggy Gou, Fred again.., ecc.).
    - **joke**: ironia intelligente su AI/tech/musica, livello New Yorker, mai barzellette da bambini.
    - **motivation**: aforisma originale (30-45 parole) che NON deve esistere su Google. Zero citazioni riciclate.
    - **weather**: meteo di città completamente inventate (New Roma Marte, Baia dei Cristalli Europa, Colonia Bassa Frequenza orbita di Saturno, ecc.). Mai il meteo reale.
    - **news**: notizie dell'anno 2087, plausibili nel loro mondo ma surreali.
  - **4. Lyrics Suno con struttura completa**: `generate_track()` ora, per brani vocali, chiama l'LLM **prima** di Suno per scrivere il testo completo con tag `[Intro][Verse 1][Pre-Chorus][Chorus][Verse 2][Pre-Chorus][Chorus][Bridge][Outro]` e lo passa come `custom_lyrics`. Se l'LLM fallisce, fallback al vecchio `lyrics_excerpt`.
  - ⚠️ **Nota LLM budget**: la Universal Key è a `$1.40/$1.40`. Tutte le nuove logiche sono operative ma cadono nei fallback statici finché l'utente non ricarica (Profilo → Universal Key → Add Balance). Circular buffer già populato al primo giro.
- **v10.6 · Rebrand R-A.I. + bed dinamico** (precedente):
  - **BUG 1 (home non caricava)**: nessun problema riscontrato — verificato con curl (`HOME 200`, `API 200`) e headless browser (title `R-A.I. · Web Radio AI`, root HTML 125 KB, 0 errori console). Era cache lato utente.
  - **Rebrand NEURA·FM → R-A.I.**: `sed` mass-replace su 7 file JS/JSX + `server.py` + `paypal_service.py` + `telegram_bot.py`. `<title>` aggiornato in `frontend/public/index.html`. `LogoWatermark.js` semplificato (rimossa orbita "FM", solo wordmark statico "R-A.I."). Migration DB Mongo: 98 segmenti storici aggiornati (script/outro_script/title) — 0 leftover. Prompt LLM riscritti (intro/outro musicali, ads, jingle, sundial, storia, interview, motivation) → ora dicono "R-A.I." nei nuovi segmenti.
  - **Bed dinamico sotto il parlato**: nuovo campo `Segment.background_loop`. In `generate_segment`, per `kind != "music"` si pesca la traccia Suno round-robin (sort `last_played_at` ASC) e si valorizza il campo con path locale `/api/suno_audio/...`. Frontend: `_playSpeechWithBed` prova prima `segment.background_loop` (loop reale Suno via nuovo helper `_startAudioBed(url, 0.25)` — `audio.loop=true`, GainNode fade-in 0.4s / fade-out 0.5s), fallback al bed procedurale se non presente. Frontend risolve automaticamente le URL `/api/*` in absolute.
  - **Integrity check settimanale**: nuovo `_suno_integrity_check()` (24h) che ri-scarica mp3 mancanti o < 100 KB da `original_audio_url`. Primo giro live: `0 tracks re-downloaded` su 18 tracce.
- **v10.4 · Salvataggio permanente brani Suno su disco** (precedente):
  - Nuova costante `SUNO_AUDIO_DIR = /app/backend/static/suno` (creata all'avvio).
  - Nuova helper `download_and_save_suno_audio(url, track_id)`: scarica il mp3 con `httpx` (timeout 120 s, follow_redirects), lo salva come `track_<id>.mp3`, ritorna path relativo `/api/suno_audio/<file>.mp3` (idempotente: skip se il file esiste già).
  - `_poll_suno_and_update()` esteso: appena Suno restituisce `audio_url`, scarica subito il file, salva in Mongo `audio_url=<path locale>`, `original_audio_url=<CDN Suno>`, `downloaded_at=<iso timestamp>`. Fallback all'URL Suno se il download fallisce.
  - Nuovo `Track` model: campi `original_audio_url` e `downloaded_at` opzionali.
  - Nuovo endpoint `GET /api/suno_audio/{filename}` con `Cache-Control: public, max-age=604800`, `Accept-Ranges: bytes`, guard anti-path-traversal.
  - Nuovo endpoint `POST /api/admin/migrate_suno_audio?limit=200`: one-shot migration di tutte le tracce ready con audio_url ancora sulla CDN. **Risultato**: 18/18 tracce migrate, 0 fallimenti, ~67 MB su disco.
  - Il segment endpoint ora restituisce `music_audio_url=/api/suno_audio/track_<id>.mp3` (già gestito dal frontend che risolve automaticamente le URL `/api/*`).
- **v10.3 · Satellite logo + neon track overlay** (precedente):
  - Nuovo componente `frontend/src/components/SatelliteLogo.js`: watermark globale con `position: fixed` bottom-right (16 px), opacity 0.35 → 0.6 on hover, "NEURA" statico + "FM" in orbita ellittica (`@keyframes satOrbit` con `rotate + translateX(38px) + counter-rotate`). Cablato in `App.js` su tutte le route.
  - `AudioVisualizer.js`: nuova prop `trackOverlay={ visible, title, artist }` → sovrimpressione neon centrata (bottom 80 px) con `@keyframes neonPulse` (magenta ↔ cyan), `transition: opacity 0.8s`, `text-shadow` multipli. Titolo maiuscolo, artista in cyan.
  - `PublicRadio.js`: state `trackOverlay` + `overlayTimerRef`. All'inizio di ogni segmento `music` fa fade-in immediato con `track_meta.title/artist`, poi programma un `setTimeout(duration - 8s)` per il fade-out prima dell'outro. Reset garantito su unmount, stop e passaggio a segmento non-music.
- **v10.2 · Volume 1.0 esplicito + round-robin perfetto** (2026-02, precedente):
  - `radioEngine.playAudioUrl`: `audio.volume = 1.0` esplicito e nuovo `voiceGain` (GainNode a 1.0) tra `MediaElementSource` e `outputBus`. Catena voce: `src → voiceGain(1.0) → outputBus(1.0) → analyser → destination`. Nessun nodo intermedio attenua il segnale.
  - `outputBus.gain.value` confermato a `1.0` in `ensureAudioCtx()`.
  - `server.py` `generate_segment(kind="music")`: **round-robin puro** — `find(...).sort([("last_played_at", 1), ("created_at", 1)]).to_list(50)` prende sempre la traccia meno-suonata (i mai-suonati vengono prima grazie a `null < any`). Ogni brano gira una volta prima che qualsiasi altro si ripeta.
  - `_suno_library_filler`: `TARGET_READY=8`, `TRIGGER_THRESHOLD=5` (era `ready < 4`, `pending < 2`). Buffer più ampio + pending fino a 3 in parallelo per rifornire più velocemente.
  - Verifica curl: 6 chiamate consecutive con 5 tracce in libreria → tutte 5 tracce cyclano prima di ripetere Baila Sotto La Luna.
- **v10.1 · Loading spinner + random rotation** (2026-02, precedente):
  - `PublicRadio.js`: nuovo state `isPreparing`. Impostato a `true` all'avvio del loop, `false` non appena il primo segmento inizia a suonare, sempre resettato nel `finally` (successo/errore/eccezione) e su Stop. UI mostra `<Loader2 data-testid="loading-spinner">` cyan animato accanto al titolo durante la preparazione.
  - `server.py` `generate_segment(kind="music")`: sostituito `find_one` che pescava sempre l'ultima traccia con selezione **casuale** su fino a 20 candidate; cooldown di 2 ore via campo `last_played_at` (fallback all'intero pool se tutte suonate di recente). La traccia scelta viene marcata `last_played_at=now` in Mongo → niente più ripetizioni back-to-back.
- **v10 · Timeline stability + ducking tuning** (2026-02, precedente):
  - `PublicRadio.js`: introdotto helper `mergeSegments(prev, incoming)` che deduplica per `id` (con fallback sintetico) e limita la timeline a 30 elementi → elimina l'errore React `Failed to execute 'insertBefore' on 'Node'` causato da chiavi duplicate.
  - `refresh()` ora usa `mergeSegments` invece di sovrascrivere lo state, e il loop di playback usa lo stesso helper: nessun conflitto tra polling e push locale.
  - Cleanup completo dell'`useEffect`: `mountedRef`, `clearInterval`, `stopFlag=true`, `radioEngine.stopAll()` allo smontaggio.
  - Timeline `.map()` avvolta in nuovo `<RadioErrorBoundary>` (`/app/frontend/src/components/RadioErrorBoundary.js`) con `data-testid="radio-error-boundary"` per contenere eventuali errori di rendering.
  - `radioEngine._playMusicWithVoice`: ducking aggiornato a **INTRO_DUCK=0.55**, **FULL=1.0**, **OUTRO_DUCK=0.60**; `audio.volume=1.0` quando c'è la sorgente Web Audio (ducking gestito esclusivamente dal `GainNode`).
  - Verifica: `testing_agent_v3_fork` iterazione 3 → 100 % PASS su backend + frontend, 90 s di playback continuo senza errori console.

## What's implemented (2026-07-16 · v9 · ElevenLabs)
- **v9 · ElevenLabs TTS in tutta la radio** (2026-07-16):
  - `elevenlabs_service.py` — chiama `https://api.elevenlabs.io/v1/text-to-speech/{voice_id}` con `eleven_multilingual_v2` (miglior qualità italiana).
  - 10 voice_id pubblici ElevenLabs mappati sui 10 DJ (Bella/Domi/Elli/Charlotte/Rachel + Antoni/Adam/Josh/Arnold/Sam).
  - `synth_speech()` wrapper con **fallback automatico Bark** se ElevenLabs fallisce.
  - `generate_segment()` ora rende **ogni** speech via ElevenLabs (script + outro_script per music segments), non solo in modalità HD.
  - Nuovo campo Segment `outro_speech_url` + endpoint `GET /api/tts/{filename}` che serve gli mp3.
  - **Ducking aggiornato** a 0.40 (intro) / 0.45 (outro) — voce meglio in evidenza.
- **v9 · Prompt intro/outro musica** ora includono BPM esatto estratto dal genre e chiedono tono variabile (entusiasta/ironico/poetico/energico/misterioso).
- **v9 · Rubriche talk/history/interview/motivation** allungate a **50-60 parole** con aneddoti veri su musica elettronica, DJ, festival, cultura rave, tecnologia audio.
- **v9 · Palinsesto rebilanciato**: music=62, jingle=10, talk=8, history=5, interview=6, motivation=4, joke=5, weather=4, horoscope=4, news=3.
- **v8 · Palinsesto dinamico**: musica al 70 %, interventi corti (max 20 parole), tono sbarazzino/sorridente.
- Musica segments hanno **intro + outro speech** distinti (2 LLM call).
- Frontend `_playMusicWithVoice`: ducking automatico (musica a 0.28 sotto voce, a 1.0 durante il brano, a 0.32 per l'outro, fade-out a 0). Nessun vuoto tra segmenti.
- LLM system prompt riscritto: "sorridi mentre parli, ritmo veloce, max 20 parole, chiudi con energia o battuta".
- Suno LIVE dance (v7): 1000 crediti, background filler mantiene 4 canzoni ready, genre pool tech-house/future-house/big-room-EDM/drum-and-bass/melodic-techno/italo-disco/etc con BPM esatto nel prompt.
- Public listener page `/`, admin `/dashboard`, HD open-source audio mode (Bark + Stable Audio Open), Emergent Google Auth, multi-LLM (GPT-5.2, Claude Sonnet 4.5, Gemini 3 Flash).
- Monetization PayPal ads (demo/sandbox/live modes) + prefetch pipeline + Telegram bot + ad analytics + 10 DJ AI + 6 new segment kinds + audio visualizer + persistent NEURA·FM watermark.
- **v7 Suno LIVE MUSIC** (2026-07-16):
  - `suno_service.py` — provider-agnostic client (works with sunoapi.org, kie.ai, musicapi.ai, etc. via `SUNO_BASE_URL`).
  - `SUNO_API_KEY=45e3e418a826ba198e13efe02df25fba` on sunoapi.org, balance ~1000 credits (~100 songs).
  - `POST /api/tracks/generate` now **submits a Suno task and returns immediately** (status=pending). Background poller `_poll_suno_and_update` updates the track when Suno finishes (~90-150s).
  - Startup task `_suno_library_filler` keeps a small library of ~3 ready Suno tracks always available (auto-generates when pool falls below 3).
  - Music segments **prefer already-ready Suno tracks** over generating fresh ones → zero latency in the radio flow.
  - Frontend player auto-plays the Suno mp3 via `music_audio_url` (routed through the AudioContext bus so the visualizer reacts).
  - `GET /api/suno/status` shows enabled/base/model for the admin dashboard.

## Deferred / Backlog (P1 / P2)
- P1 — PayPal Sandbox/Live keys, Telegram bot token
- P1 — Webhook PayPal refund/dispute
- P1 — Admin panel "Libreria Suno" con preview + genere/lingua/instrumental picker
- P2 — Twilio SMS + voice call
- P2 — Streaming pipeline HLS/Icecast
- P2 — Widget embed `/embed`
- P2 — DJ leaderboard con like ❤️
- P2 — "Cattura clip 15s" per TikTok/Reels

## Next tasks
1. When user provides Suno API key → wire real music generation via `/api/tracks/generate` (backend already returns metadata compatible with Suno).
2. When user provides ElevenLabs key → add server-side TTS endpoint and use returned MP3 URL in the front-end player.
3. Add Telegram bot service listening for messages, POST to `/api/questions`.
4. Add Twilio inbound webhook.
