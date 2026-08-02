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
- **v11.2 · JINGLE FIX ROUND 2 — Full-length + hardStop reale** (2026-02, this session):
  - **`radioEngine.js`**:
    - `playJingle()`: cap safety-timeout alzato da **75s → 300s** (5 min) — jingle full-length non vengono più tagliati.
    - `playJingle()`: fade-in riportato da 40ms → **200ms** (rampa dolce anti-click).
    - `hardStopMusic()` RISCRITTO — ora ferma davvero il brano attivo (non solo il fade-out pendente):
      - **Caso 1 (playback attivo)**: fade rapido 200ms su `_currentMusicGain` esposto come proprietà d'istanza, poi pause+disconnect. Setta `stopRequested=true` per far uscire pulito il loop di `_playMusicWithVoice`.
      - **Caso 2 (fade-out finale in corso)**: tronca `_pendingMusicFadeOut` come prima.
      - **Caso 3 (voce/audio corrente)**: `stopAudio()` + `stopSpeech()`.
    - `_playMusicWithVoice()` espone `_currentMusicAudio`, `_currentMusicSrcNode`, `_currentMusicGain` durante il playback attivo (rilasciati allo step 6 quando entra in fade-out).
    - `_playMusicWithVoice()` step 5+6 saltano se `stopRequested` — no outro DJ orfano né doppio fade-out.
- **v11.1 · JINGLE ZERO OVERLAP** (2026-02, this session):
  - **`radioEngine.js`**:
    - `_playMusicWithVoice()` step 6 ora traccia il fade-out finale in `_pendingMusicFadeOut`, così può essere troncato dall'esterno.
    - Nuovo metodo pubblico `hardStopMusic()`: interrompe bruscamente il fade-out del brano precedente (pausa immediata, gain a 0, disconnect nodi). Nessun effetto se non c'è fade-out pendente.
    - `playJingle()` fade-in ridotto da 300ms → 40ms: il jingle parte pulito senza sovrapporsi.
  - **`PublicRadio.js`**:
    - Prima di ogni `radioEngine.playJingle(url)` viene chiamato `radioEngine.hardStopMusic()` → il jingle suona per intero, zero overlap con la coda del brano precedente.
  - Risultato: il jingle mantiene la sua coda naturale e viene sempre riprodotto per intero prima che parta l'elemento successivo. Fade-in del brano musicale successivo (1s) rimane invariato ma non causa overlap perché il jingle è ormai terminato.
- **v11.0 · RIORDINO STRUTTURALE — Palinsesto posizionale + player robusto** (2026-02, this session):
  - **Backend `server.py`**:
    - Sostituito `random.choices` con **palinsesto posizionale** (`station.playlist_position` 0..5):
      - pos 0,1,3,4 → `music`
      - pos 2 → random tra `talk/history/interview/joke/motivation`
      - pos 5 → `time_signal` (se l'ora è cambiata) altrimenti `ad_spot`/`weather`
      - Posizione incrementa a ogni segmento e wrappa a 0. NON avanza se `kind` è forzato.
    - `time_signal` ora usa **ora italiana reale** via `zoneinfo("Europe/Rome")` (gestisce CET/CEST). Formato `HH:MM`. Prompt LLM include ESATTAMENTE "Sono le HH:MM su R-A.I. Radio" come prima frase.
    - Rimosso `background_loop` dai segmenti parlati → **voci nude, zero sottofondo musicale** (richiesta esplicita).
    - `_suno_library_filler` più aggressivo: intervallo **30s** (era 90s), target **10** (era 8), genera **2 tracce alla volta** se buffer sotto target (cap in-flight: 4).
  - **Frontend `radioEngine.js`**:
    - Riscritto `_playMusicWithVoice()` con logica robusta:
      - Nuovo `Audio` element ogni volta (niente cache preload → risolve errori `createMediaElementSource already used`)
      - Attende `canplaythrough` prima di `play()`
      - **Safety timeout 15s**: se il brano non parte, skip pulito e loop avanza
      - Pipeline lineare: fade-in duck → intro DJ (max 14s) → fade a full → attende fine -8s → outro DJ → fade-out finale
      - Nuovo helper `_fadeGain(nodeOrEl, from, to, ms)` per fade lineari su GainNode Web Audio o element.volume
    - Nuovo `_playVoiceOnly(segment)` per TUTTI i segmenti parlati:
      - Solo voce TTS, volume 1.0, ZERO sottofondo/bed/loop musicale
      - Safety timeout 25s + skip su errore
    - Rimosse rotte `_playSpeechWithBed`, `_playNewsSegment`, `_playAdSpot` dal flusso principale (mantenute in codice come dead code, non chiamate).
    - `preloadSegment` NON pre-carica più `music_audio_url` (causava conflitti con createMediaElementSource in `_playMusicWithVoice`).
  - **Frontend `PublicRadio.js`**:
    - Nuovo `fetchSegmentSafe`: **3 retry** con backoff 2s. Se il server è irraggiungibile, il loop attende 3s prima di riprovare invece di crashare.
    - Stinger di transizione **SOLO** su cambio blocco (`music ↔ speech`). Niente stinger tra due music consecutivi o due parlati consecutivi.
    - Console log per ogni segmento: `[R-A.I.] Playing segment kind=X title="Y"`
  - **Test regressione**: `/app/backend/tests/test_playlist_structure.py` (2/2 PASS):
    - `test_playlist_positional_sequence`: genera 6 segmenti da posizione 0 e verifica sequenza music,music,parlato,music,music,spot
    - `test_time_signal_italian_time`: verifica che time_signal contenga HH:MM
  - **Log sequenza verificata**: music → music → parlato → music → music → time_signal (11:44) → music → music ...

- **v10.10 · Suno cost optimization / Library-first caching** (precedente):
  - Nuovi env vars in `backend/.env`: `SUNO_AUTOGEN_ENABLED=true` (kill-switch globale per TUTTE le chiamate Suno automatiche) e `SUNO_LIBRARY_TARGET=10` (soglia minima tracce ready in libreria).
  - Helper `_suno_autogen_enabled()` / `_suno_library_target()` in `server.py` letti a runtime (nessun restart necessario dopo toggle).
  - `_suno_library_filler()` ora rispetta il kill-switch (skip loop se off) e usa target dinamico da env (10 ready, refill quando ready < 10 e pending < 3).
  - `generate_segment(kind="music")` fallback riscritto: se libreria ha ≥1 traccia esistente la riusa (round-robin `last_played_at`). Chiama `generate_track()` con Suno SOLO se `_suno_autogen_enabled()` è true e libreria totalmente vuota. Ultimo resort: `generate_track(_suno_call=False)` che genera solo metadata senza toccare Suno.
  - Nuovo parametro `_suno_call: bool = True` in `generate_track()`: quando False (chiamate interne di fallback) NON crea task Suno.
  - Nuovi endpoint:
    - `GET /api/library/stats` → snapshot completo (ready/pending/failed, file locali su disco in MB, anthem ready, `will_call_suno_next_music_slot: bool`).
    - `POST /api/library/autogen?enabled=true|false` → toggle runtime che PERSISTE in `backend/.env` (sopravvive al restart).
    - `GET /api/suno/status` ora espone anche `autogen_enabled` e `library_target`.
  - Stato attuale verificato: 24 tracce Suno ready + 1 anthem in `/app/backend/static/suno` (94.89 MB su disco). Filler dorme (nessuna chiamata Suno) fino a scendere sotto 10.
  - Test regressione: `/app/backend/tests/test_library_optimization.py` — 4/4 PASS (stats, status flags, no-new-suno-task per music slot, toggle persistenza).
- **v10.9 · LLM dual-path + testing 15/15** (precedente):
  - `.env` esteso con `OPENAI_API_KEY` e `OPENAI_BASE_URL` (gateway Emergent).
  - Nuovo `_llm_direct_openai(system, user, model)` in `server.py`: chiamata httpx diretta all'endpoint OpenAI-compatible del gateway Emergent.
  - `llm_generate` riscritto: prova `LlmChat` primario → in caso di errore (budget exhausted / rate / any) fallback automatico a `_llm_direct_openai` → se anche quello fallisce, si restituisce stringa vuota (che a sua volta triggera i FALLBACK_SCRIPTS statici).
  - **NOTA**: la chiave `OPENAI_API_KEY` fornita è identica alla `EMERGENT_LLM_KEY` (`sk-emergent-21aB…`) — punta allo stesso gateway. Entrambi i percorsi colpiscono lo stesso budget. Il codice però resta robusto e pronto per una key OpenAI reale in futuro.
  - **Testing agent iterazione 4**: 15/15 PASS backend + frontend, 60 s playback continuo senza errori. Report `/app/test_reports/iteration_4.json`, test suite regressione in `/app/backend/tests/test_rai_features.py`.
- **v10.8 · Ad Spot surreali** (precedente):
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

## 2026-02 — P0 fix `/api/analytics` crash
- **Bug**: Dashboard 500 su `GET /api/analytics` dopo introduzione slot jingle nel palinsesto (pos 2/7). I segmenti jingle inseriti senza `llm_provider` producevano `None.split('/')`.
- **Fix**:
  1. `server.py:1876` → `str(s.get("llm_provider") or "unknown").split("/")[0]` (guard su None).
  2. Slot jingle in palinsesto ora inserisce `llm_provider="jingle"` esplicitamente.
  3. Backfill una-tantum su 8 documenti esistenti con `llm_provider=None` → `"jingle"`.
- **Verifica**: `pytest backend/tests/test_palinsesto_jingle.py` 5/5 PASS + `curl /api/analytics` = 200 OK con `segments_by_provider` che include ora `"jingle"`.

## Backlog aggiornato (post-fix)
- **P1** — Migrazione file voce/jingle su MongoDB GridFS ("ORDINE DI RIPARAZIONE TOTALE" punto 4, rimandato — utente ha detto "vediamo in seguito").
- **P1** — Ticker social scrolling (Web Form + Telegram Bot + filtro parolacce).
- **P1** — Dedup jingle library (3x "Notte Analogica", 3x "Aurora Statica", 2x "Silicio Blu").
- **P1** — Nascondere/sostituire embed YouTube "Video unavailable" che appare sulla home.
- **P2** — Widget embed `/embed` iframe esterni.
- **P2** — Twilio SMS / call-in.
- **P2** — Split `radioEngine.js` (1279 righe) in moduli separati.
- **P2** — Alzare timeout axios frontend `fetchSegment` (30s → 60s) o pre-warm queue per evitare attesa 25-30s al primo play.


## 2026-02 — Preparazione infrastruttura shared preview↔production
- **Problema individuato**: preview e produzione hanno MongoDB e filesystem separati. Al Deploy passa solo il codice, non i dati. Conseguenza: le 121+ canzoni Premium generate in preview non esistono su r-ai.it.
- **Soluzione predisposta (DORMIENTE, feature-flagged)**:
  - Nuovo modulo `/app/backend/object_storage.py` che parla con Emergent Object Storage API centralizzato (bucket condiviso preview↔prod), usa `EMERGENT_LLM_KEY`.
  - `download_and_save_suno_audio()` e `elevenlabs_service.synth_speech()` ora pushano trasparentemente ogni nuovo mp3 sul bucket quando `USE_OBJECT_STORAGE=true`.
  - Endpoint `/api/suno_audio/{filename}` e `/api/tts/{filename}` fanno fallback trasparente: se il file locale manca, lo scaricano da object storage (e lo cachano localmente).
  - Script bulk migration `/app/backend/scripts/migrate_to_object_storage.py` per uploadare i 162 file .mp3 esistenti — dry-run di default, `--apply` per eseguire davvero.
- **Come attivare** (quando il supporto Emergent conferma o quando l'utente vuole procedere):
  1. Aggiungere `USE_OBJECT_STORAGE=true` a `/app/backend/.env` in preview.
  2. `python /app/backend/scripts/migrate_to_object_storage.py --apply` (upload iniziale).
  3. Aggiungere `USE_OBJECT_STORAGE=true` anche in produzione (Emergent dashboard → env vars) e ridiployare.
  4. Da quel momento, ogni nuovo brano generato in un ambiente è disponibile in entrambi.
- **Rischio zero**: con flag OFF (default attuale) il comportamento è identico a prima. Testato: `/api/analytics` 200, `/api/station` 200, `/api/suno_audio/*` 200 (5MB serviti).

## 2026-02 — Master Plan R-A.I. (5 task) COMPLETATO
### 1. Upload MP3 admin (Nuovo/Sostituisci)
- `POST /api/admin/tracks/upload` multipart (file, mode, target_id, title, artist, kind, tags)
- `GET /api/admin/tracks/searchable` per il picker di sostituzione
- Doc costruita con `Track(...)` model (fix regressione /api/tracks 500)
- Nuova sorgente `admin_upload` aggiunta al Literal di Track.source
- Rotation music pool include ora `source: {"$in": ["suno","admin_upload"]}` → gli upload girano davvero
- File pushato su Emergent Object Storage se USE_OBJECT_STORAGE=true (già attivo)
- Frontend: `UploadMp3Panel` in Dashboard con dropzone, selettore Nuovo/Sostituisci, dropdown ricerca brano, tipo song/jingle/anthem
### 2. Download ZIP piccoli categorizzati
- `GET /api/admin/export/category/{cat}?page=N&page_size=X` — 15 categorie
- ZIP_STORED (no ricompressione mp3) + paginazione (music default 25/pagina, ~100MB max)
- Frontend: `CategorizedExportPanel` con grid di 15 card + pulsanti ‹ / › per navigare pagine
### 3. Waveform in basso (discreto)
- Nuovo componente `BottomWaveform.js` — canvas fisso h=34px con gradient cyan→magenta
- Piazzato via fixed bottom, backdrop-blur, z-index 20
### 4. Logo pulsante R-A.I. (cuore visivo)
- Nuovo componente `PulsingBrand.js` — sostituisce vecchio `AudioVisualizer`
- 6 caratteri "R-A.I." mappati su 6 bande frequenza (sub-bass → treble)
- Reactive: transform scale, brightness, glow shadow, hue-shift per kind
- Palette magenta base + accento ciano (offset hue +240)
- Fallback breathing pulse quando audio idle
### 5. Object Storage produzione
- USE_OBJECT_STORAGE=true attivo in preview .env
- 362 file già sul bucket condiviso preview↔produzione
- Utente deve aggiungere la stessa env var alle env di produzione + redeploy (guida in ticket support)

### Fix di contorno (dal testing agent iteration_10)
- CSS: `.btn-primary:disabled` e `.btn-outline:disabled` ora hanno opacity + cursor:not-allowed
- Rimosso import morto `AudioVisualizer` da PublicRadio
- Sostituito embed YouTube rotto ("Video unavailable") con **fondo animato CSS** — 3 aloni neon fluttuanti (magenta/ciano/viola), zero dipendenze esterne, non si rompe mai
- Hue accent PulsingBrand da verde → ciano (offset hue +240 invece di +190)
- Default page_size music ZIP: 25 (era 50)

### Test
- `backend/tests/test_master_plan.py`: 23/23 PASS (inclusa regressione `/api/tracks` post-upload)
- `backend/tests/test_palinsesto_jingle.py`: 5/5 PASS (regressione)
- Preview: screenshot mostra logo pulsante ciano/magenta + waveform discreta + fondo animato (no YT unavailable)
