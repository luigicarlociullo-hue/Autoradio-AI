# NEURA·FM — AI Web Radio (Prototipo Beta)

> **⚠️ REGOLA PERMANENTE (SENZA SPRECHI):** Ogni azione deve andare dritta al valore.
> Zero image gen "creative", zero screenshot pleonastici, zero refactor non richiesti,
> zero rigenerazioni ridondanti. Riusare sempre asset esistenti prima di generare.
> Le domande all'utente sono ammesse SOLO se bloccanti. Applicare a ogni sessione futura.

## v13.17 · SMART FLOW TIMELINE · Coda elastica soft-sync (2026-02-10)
- **Backend verificato via curl E2E**: `POST /api/admin/timeline` inserisce evento con `scheduled_at` ISO, `kind`, `audio_url`, `duration_sec`. `GET /api/admin/timeline?status=pending|consumed|all` lista in ordine cronologico. `DELETE /api/admin/timeline/{id}` rimuove.
- **Soft-sync provato in produzione**: evento con `scheduled_at` nel passato è rimasto `pending` mentre "Lose Control Tonight" continuava (rem 69s → 9s), poi promosso a `current` (is_timeline=true) solo dopo fine naturale. Zero troncamenti. Coda ripristinata sul brano successivo.
- **Frontend `<SmartFlowTimelinePanel/>`** sostituisce `<MasterClockPanel/>` in Dashboard fascia "Tempi & Pensiero": input `datetime-local`, dropdown Kind (jingle/past_pill/future_pill/rubric/insert/ad), dropdown Sorgente da `/admin/tracks/searchable`, durata, tabs "In coda / Storico" con auto-refresh 8s, rimozione evento singola. Live current in header con `remaining_sec`.
- **File**: `/app/frontend/src/components/SmartFlowTimelinePanel.js`. Old `MasterClockPanel.js` conservato ma non più importato — candidato eliminazione.


## v13.4 · LE STELLE DI NEURONI · Perfezione Editoriale (2026-02-05)
- **Rinominato ovunque** `RADIOSCOPO` → **LE STELLE DI NEURONI** con sottotitolo "L'oroscopo tech di R-A.I." (Home widget + Regia panel). API path `/api/radioscope` resta invariato per compatibilità interna.
- **Widget compatto** in Home: max-w-3xl (era 7xl), altezza singolo segno h-14 (era aspect-square ~180px su desktop wide), 2 righe × 6 segni, celle piccole con icona base + label 4 caratteri. Sezione totale ~150px.
- **Respiro TEAM**: `pt-4 pb-3` (era `py-1`), container interno `px-4 py-3` (era `px-3 py-2`). Ora la strip staff ha aria attorno e non appare schiacciata contro il visualizzatore.
- **Regia "Stelle"**: nuovo pannello `<StellePanel/>` in Dashboard con lista 12 segni + testo attuale + bottone `↻` per singolo segno e "Rigenera tutto". Endpoint `POST /api/admin/radioscope/regenerate {sign?}`.
- **Streaming scalabile**: confermata coesistenza HLS interno (default) + `station.external_stream_url` per Icecast futuro. Nessuna migrazione richiesta il giorno che si sposta su VPS.


- **HLS Broadcast in-pod**: `GET /api/stream/live.m3u8` genera playlist `#EXTM3U` con i prossimi 5 brani (rispetta day/night filter). Universale (VLC, Safari, hls.js). Latenza ≈ durata brano.
- **External Streaming URL** (Icecast): field `station.external_stream_url`. Se popolato, `/stream/live.m3u8` risponde 302 → URL esterno. Endpoint `GET/PATCH /api/admin/external-stream`. UI `<BroadcasterPanel/>`.
- **DJ Dual-Brain**: `POST /api/admin/dual-brain/generate {subject}` genera Leo (difende) + Max (attacca) via Claude Sonnet 4.5, TTS ElevenLabs male-1/male-2 in parallelo. `POST /api/admin/dual-brain/inject` mette in priority_queue. Gate FM_MODE ON.
- **Identità Digitale Ascoltatori**: `POST /api/chat/avatar {browser_id, first_message, name?}` classifica archetipo (Guerriero Techno, Sognatore Ambient, Cantastorie Trap...) via Gemini Flash + genera avatar SVG procedurale gradient neon. Cache Mongo `listener_profiles` per browser_id. Integrato in `ChatMini.js`: al primo messaggio mostra toast "Benvenuto umano, per me sei un..." e badge con avatar+tagline nella chat.
- **Auto-scheduling Pillole**: loop `_pillole_scheduler` (60s tick) legge `program_schedule` per l'ora corrente; se kind=past_pill/future_pill e FM_MODE ON, genera script (Claude 4.5) + TTS ElevenLabs e inietta in priority_queue. Una sola esecuzione per ora.
- Endpoint frontend aggiunti in `endpoints`: `chatAvatar`, `externalStreamGet/Set`, `dualBrainGenerate/Inject`.


- **Layout header compattato**: `items-stretch` → `items-start` sul grid hero (PublicRadio riga 637). Vuoto nero eliminato.
- **Zero troncamento brani umani**: `radioEngine.js` ora rispetta l'ended naturale quando il segmento NON ha outro DJ pianificato. La logica `remaining<=8` scatta SOLO se c'è `outro_speech_url`/`outro_script`.
- **Logica Giorno/Notte per brano**: Track model ha `daypart_day` + `daypart_night` (default True). Rotazione musicale filtra per fascia oraria Europe/Rome (Notte 22-04, Giorno 04-22). Endpoint `PATCH /api/admin/tracks/{id}/daypart {day,night}`. Toggle ☀/🌙 nel track manager Dashboard.
- **Master Clock 24H**: collection `program_schedule`, endpoints `GET /api/admin/schedule`, `PATCH /api/admin/schedule/{hour}`. Slot: `{hour, title, subject, kind ∈ music|radioscope|past_pill|future_pill|rubric}`. UI `<MasterClockPanel/>` griglia 24 celle con ora corrente evidenziata.
- **Radioscopo**: 12 previsioni giornaliere con lessico "energia digitale/vibrazioni neurali". Endpoint `GET /api/radioscope` (cache Mongo `radioscope_cache` per data ISO). Widget `<RadioscopoWidget/>` in Home con griglia 12 segni zodiacali neon.
- **Pillole dal Passato/Futuro**: system prompt TASSATIVI in server.py (`_PILL_PAST_SYSTEM` = Leo, fatti storici verificabili, no invenzioni; `_PILL_FUTURE_SYSTEM` = Aria, trend scientifici reali estrapolati). Endpoint `POST /api/admin/pillole/genera {kind,hint}`. Usa Claude Sonnet 4.5 per qualità.
- **BPM auto-detection server-side**: nuovo `bpm_service.py` con librosa (`beat_track` su primi 90s, clamp 60-200). Detection integrata su Suno auto-download e admin upload. Endpoint backfill `POST /api/admin/bpm/scan {limit,force}` per brani legacy. Salva in `tracks.bpm` + `bpm_source="server"`.
- **Live Stream Icecast/HLS**: RIMANDATO — richiede infrastruttura esterna (VPS Icecast/Liquidsoap) o pipeline HLS con ffmpeg che segmenta in .m3u8+.ts su Object Storage. In attesa scelta strategica utente.


- **Toggle master `FM_MODE`** nella Dashboard (`<FmModePanel />` in cima, pill switch pink/cyan). Default **OFF** ad ogni startup/restart backend (safety-first).
- **Endpoints**: `GET/PATCH /api/admin/fm-mode` (protetti JWT). Persiste in `station.state.fm_mode` ma il valore viene **forzato a False all'avvio** in on_startup.
- **Routing dinamico LLM** in `llm_generate()`:
  • FM ON → `("anthropic", "claude-sonnet-4-5-20250929")` per ogni segmento
  • FM OFF → `("gemini", "gemini-3-flash-preview")` (economy)
  (override runtime, non tocca le DJ persona in DB)
- **Routing dinamico TTS** in `elevenlabs_service._synth_elevenlabs`:
  • FM ON → sempre ElevenLabs HD (alta espressività)
  • FM OFF → sempre OpenAI TTS-1-HD (Universal Key)
  Il toggle `tts_provider` (smart/eleven/openai) resta come opzione manuale ma FM_MODE ha priorità assoluta.
- Integrazione voci utenti nel discorso DJ: già supportata dal flusso Voice Live → priority queue (segmento `kind=answer`, `music_audio_url=vocale`).
- **Palinsesto Autore** (backlog): schema `program_schedule` ora → subject/title, CRUD Dashboard Autore da progettare come prossima P0 quando FM_MODE ON.


- **Object Storage-first**: Suno/Community/Community-Jingle/Beds/Voice-messages tutti salvati in Emergent Object Storage. Nessuna scrittura autoritativa su disco pod. Disco locale usato solo come cache lazy (populata da stream_mp3 on-read). Fix 4 lint-blocker deploy.
- Nuovo endpoint `GET /api/voice_audio/{filename}` streaming from objstore (Range-aware, no cache locale).
- Helper `object_storage.put_bytes(sub_path, data, content_type)` per file non-mp3 (voice webm/m4a/ogg).
- **TTS Cache**: `elevenlabs_service.synth_speech` ora usa hash SHA256(voice_key+kind+text) come filename deterministico. Prima di chiamare ElevenLabs/OpenAI TTS verifica `db.tts_cache` — riuso trasparente. Zero doppie chiamate per script identici.
- **Kill-switch Background AI**: env `BACKGROUND_TASKS_ENABLED=false` (default) blocca all'avvio Suno filler, integrity check, time_signal pregenerator. Toggle via `PATCH /api/admin/background-tasks`. `SUNO_AUTOGEN_ENABLED=false`. **Nessun consumo AI in background senza autorizzazione admin**.
- DB writes MongoDB: sono già real-time (motor async), nessuna cache in memoria — dati sicuri per passaggio produzione.


- Firma Audiowide 8-10px, rotazione -8°, cliccabile → FB profilo L&C.
- Track: campi `genre`, `bpm`, `bpm_source`, `deleted_at` (soft-delete).
- Cestino: `DELETE /admin/tracks/{id}` = soft; `POST .../restore`; `DELETE .../purge`; `GET /admin/tracks/trash`; `POST /admin/trash/auto-clean {days:30}`.
- Rotazione esclude `deleted_at != None`.
- Beat Detection client-side (`web-audio-beat-detector`) al preload dei music segments in Club Night → `PATCH /admin/tracks/{id}/bpm source=client`. Struttura pronta per `manual` e `server`.
- Wall Community: `play_count` su CommunityTrack, `GET /community/wall`, `POST /community/tracks/{id}/play`. `<CommunityWallPublic>` sulla home, `<CommunityWallPanel>` in Regia.
- Filtro Archivio Pro nel TrackManager: chip Pop/Rock/HipHop/Dance/Relax/Ambient/Varie + 🌙 Night Mix. Select/input in-cell per assegnare genere/BPM.
- preload="auto" su tutti gli `<audio>` component-level. Fix silenzio time_signal attivo. Crossfade night 2500ms.

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
- **v12.12 · LOGO 3D + HOLOBRAND — Marchio R-A.I. reattivo integrato** (2026-02, this session):
  - **Nuovo logo simbolo** generato con Nano Banana in `/app/frontend/public/rai-logo.png`: cerchio neon blu elettrico con anello luminoso, antenna sottile con LED arancione (ON AIR indicator), waveform interna che disegna sottilmente "R" e "A". Sfondo trasparente per uso overlay.
  - **Firma "Powered by *L&C Project*"**: font Google `Great Vibes` (script/autografo) con gradient blu→arancione, `skewX(-8deg)` diagonale, drop-shadow neon, delimitatori sfumati. Integrata sotto "AI CONTROL ROOM" nell'header.
  - **`<HoloBrand>`** — nuovo componente in `/app/frontend/src/components/HoloBrand.js` che sostituisce `PulsingBrand` nell'hero:
    - Marchio scomposto in **6 glyph indipendenti** (R, -, A, ., I, .) — trattino e punti evidenti, i punti "." in arancione ON AIR mentre R/I in cyan e A in bianco brillante
    - Ogni glyph ha un `band` di frequenze dedicato (bassi 2-14 per R, medi 12-22 per A, acuti 40-100 per I) → scale/glow/translateZ reattivi in tempo reale via `radioEngine.getAnalyser()`
    - Container 3D con `perspective: 1200px` + `rotateX(4deg) rotateY(±)` che oscilla in base ai bassi
    - Antenna simbolica in alto con LED arancione blinking
    - Aura ring pulsante con 2 cerchi tratteggiati che ruotano in direzioni opposte
    - **Info brani integrate come parte dell'hologramma**: chip "◂ KIND · DJ ▸" + titolo brano in font Orbitron con text-shadow neon + artista in Share Tech Mono arancione. Lo stesso stile neon del logo → tutto amalgamato.
    - Riflesso pavimento (gradient inferiore) + scanlines CRT + badge ON AIR/STAND-BY nel corner
    - Marquee opzionale in basso quando `trackOverlay.visible` (titolo scroll infinito).
    - Idle breath sinusoidale quando `analyser` non è disponibile (radio ferma) → il logo sembra sempre "vivo".
  - `PulsingBrand` non è stato eliminato (conservato come componente alternativo) ma non è più usato nel visual centrale.
  - Nessuna modifica a `radioEngine.js` (solo lettura dell'analyser).
- **v12.11 · AUTONOMIA + REGIA NOTTURNA — 4 fasi complete** (2026-02, this session):

  ### FASE 1 · Play First + Firma + Chat aperta + Main Partner
  - **Firma "Powered by L&C Project"** mono-tech affianco al logo/label AI CONTROL ROOM.
  - **Header e hero rimpiccioliti**: layout grid `lg:grid-cols-5` con visual (2 col) + Now Playing (3 col) → **PLAY sopra la piega** su desktop e mobile. Mini display LIVE/SEGS/DJ integrati al lato del PLAY.
  - **Card Chat LED SEMPRE APERTA** (span md:col-span-2), fuori dal set CoverCard che espande al click. Le altre 3 card (Esperimento/Disco/Human vs AI) restano cover cinematografiche.
  - **Nuovo modello backend `Partner`** (id, name, logo_url, link, description, active). Endpoints: `GET /api/partners/active` (pubblico), `GET/POST/PATCH/DELETE /api/admin/partners`.
  - **`<MainPartnerSlot>`** in header: mostra il partner attivo con neon glow arancione+cyan, alterna ogni 8s se più di uno, cliccabile se link presente.
  - **`<PartnersPanel>`** in Dashboard: form create/edit/delete + toggle attivo/OFF + preview logo.

  ### FASE 2 · TTS Smart Routing
  - Nuovo modo **`smart`** (default v12.11+) nel toggle admin TTS: ElevenLabs SOLO per `kind=='answer'` (risposte agli ascoltatori), OpenAI TTS-1-HD per tutti gli altri segmenti.
  - `synth_speech()` in server.py + `_synth_elevenlabs()` in elevenlabs_service.py ora accettano parametro `kind` e leggono `station.state.tts_provider ∈ {smart, elevenlabs, openai}`.
  - Endpoint `/api/admin/tts/provider` ora accetta 3 valori. UI in Regia Audio: 3 pill buttons Smart/11Labs/OpenAI con colori distinti.
  - **Prompt anti-ripetizione DJ rinforzato**: buffer allargato a 20 intro recenti, blocco esplicito "non iniziare con le stesse 3 parole, cambia metafore, cambia struttura ritmica".

  ### FASE 3 · Club Night 22:00-04:00
  - **Campo `night_slot: Optional[int] ∈ {1,2,3}`** su `DJPersona`. Campo `is_night_jingle: bool` su `Track`.
  - **Endpoint `PATCH /api/djs/{id}`** per aggiornare campi liberi (usato per night_slot).
  - **Endpoint `PATCH /api/tracks/{id}/night-jingle`** per marcare/smarcare jingle notturni.
  - **Scheduler backend** in `/api/segments/generate?hour_local=N`:
    - hour ∈ [22-23] → slot 1
    - hour ∈ [0-1]   → slot 2
    - hour ∈ [2-3]   → slot 3
    - hour ∈ [4-21]  → DJ diurni (esclude night_slot)
  - **Jingle notturni**: `/api/jingles/random?hour_local=N` filtra `is_night_jingle=true` in Club Night, altrimenti solo diurni. Fallback su qualunque jingle se il set è vuoto.
  - **Frontend passa `hour_local`** in `PublicRadio.js` (fuso browser dell'ascoltatore): a mezzogiorno CET LUMA suona in Giappone alle sue 20:00 ma NYX solo dopo le 22:00 giapponesi.
  - **`scripts/seed_night_djs.py`**: genera 3 DJ notturni con avatar cyberpunk clubbing via Nano Banana (NYX slot 1 techno cinematica, HEX slot 2 industrial dark, LUMA slot 3 ambient afterhours). Salvati in `/app/frontend/public/djs/night-*.png`.
  - **`ensure_seeded()` fix**: preserva i DJ con `night_slot` durante il purge (prima li cancellava).
  - **`<NightDJsPanel>`** in Dashboard: 3 slot visuali con DJ assegnato + tabella completa con `<select>` slot 1/2/3/diurno + tasto "Cancella".

  ### FASE 4 · Regia · Kill Switch + Delete Forever
  - **`POST /api/admin/automation/kill-switch`** con payload `{enabled, stop_after_current}`: ferma la generazione automatica dei segmenti (mode=manual) con opzione stop dolce (finisce il segmento in corso).
  - **`DELETE /api/admin/tracks/{id}`**: cancella definitivamente dalla DB + best-effort dei file locali (SUNO_AUDIO_DIR, AUDIO_DIR, COMMUNITY_AUDIO_DIR).
  - **`<KillSwitchPanel>`** in Dashboard: display "AUTOMAZIONE ATTIVA / MANUALE · L'AI È FERMA" con colore switch (cyan/arancione glow), bottoni "Stop dolce" (esce con conferma dopo il segmento corrente) e "KILL SWITCH" (stop immediato). Conferme obbligatorie via `window.confirm`.
  - **Colonna "Elimina" arancione** in TrackManagerPanel (chiama `endpoints.trackDelete`) + colonna "Notte" (toggle 🌙 NOTTE / ☀ Giorno per jingle).
  - **Bottone "Elimina" arancione** in NightDJsPanel per ogni DJ (chiama `DELETE /djs/{id}`).
  - Il `<CommunityPanel>` e `<PartnersPanel>` avevano già il delete: uniformati con `<Trash2>` arancione e conferma.
- **v12.10 · COVER CARDS CINEMATOGRAFICHE — 4 immagini AI-native + expand on click** (2026-02, this session):
  - **Nuovo script** `backend/scripts/generate_card_covers.py`: usa `emergentintegrations` + `gemini-3.1-flash-image-preview` (Nano Banana) per generare in parallelo 4 cover 16:9 fotorealistiche coerenti con la palette console (blu elettrico + arancione ON AIR, no testo, no watermark).
  - **Immagini generate** salvate in `/app/frontend/public/cards/`:
    - `human-vs-ai.png` — braccio robotico chromato vs braccio umano in braccio-di-ferro, scintille arancioni al contatto, ON AIR sign sullo sfondo
    - `disco-del-giorno.png` — vinile futuristico di puro laser blu, rotante, con anelli sonori
    - `esperimento.png` — cervello sezionato con circuiti + antenne radio, sinapsi blu, spark arancione al centro
    - `chat-led.png` — onda sonora digitale scultorea, barre verticali blu/cyan con spike arancioni
  - **`HomeCards` refactor**: nuovo componente `CoverCard` riutilizzabile che:
    - Mostra l'immagine come sfondo full-bleed (aspect-ratio 16:10 → 16:6.5 quando aperta)
    - Overlay in top-left: icona hi-tech grande (CircuitBoard/Disc3/Users/MessageCircle) con glow accent colore modulo
    - Overlay in top-right: `MOD · X · TAG` tab hi-tech
    - Corner-accents a 4 angoli
    - Vignette + scanlines CRT + hover-scale (1.04x) sull'immagine
    - Titolo + eyebrow + hint "▶ APRI MODULO" / "▼ CHIUDI" sempre in overlay basso
    - **Click → espansione con animazione**: la cover si contrae verticalmente (aspect ratio riduce), l'immagine viene desaturata + oscurata (`brightness 0.65`), un body slide dal basso con `max-height` 0 → 720px in 500ms cubic-bezier + il contenuto interno appare con opacity/translateY 150ms delay.
    - Click di nuovo (o ESC) → chiude smooth.
    - `stopPropagation` sui form/link interni per non chiudere accidentalmente.
  - **Card Chat LED** conserva il led-screen scanlines interno (altezza ridotta a 40 per stare nel body); input form ancora funzionante.
  - **CSS nuovo**: `.cover-card`, `.cover-card-btn`, `.cover-card-img`, `.cover-card-vignette`, `.cover-card-scan`, `.cover-card-tag`, `.cover-card-icon`, `.cover-card-title-wrap`, `.cover-card-body` (max-height transition), `.spin-slow` (per icona Disc3).
- **v12.9 · CONSOLE DI CONTROLLO AI — Restyling ispirato a plancia radio hi-tech** (2026-02, this session):
  - **Palette rifatta** (`index.css`): dominante **blu elettrico** (`#00BFFF` / `#00E5FF`) su nero profondo (`#02040A`), **arancione** (`#FF6B1A`) **riservato esclusivamente** agli avvisi ON AIR / alert. Rimosso il vecchio rosa/magenta/violetto dallo scheletro (retro-compat via alias `--neon-*`).
  - **Nuovi utility CSS**: `.console-panel` (cornice modulo con scanlines interne + module-tag), `.on-air-badge` (arancione pulsante), `.standby-badge` (blu), `.led-screen` (display CRT con scanlines + fosforo), `.glow-blue`/`.glow-orange`/`.text-glow-*`, `.vu-meter`, `.corner-accent` (4 angoli hi-tech), `.btn-alert` (arancione), `.rai-bg-grid` (griglia tecnica), `.rai-bg-scan`.
  - **Font aggiunti**: `Share Tech Mono`, `VT323` per label console + LED CRT.
  - **Header trasformato**: antenna icon con glow, "AI CONTROL ROOM" label, badge **ON AIR arancione pulsante** quando trasmette (con dot nero interno), **STANDBY blu** quando off, bottone "Regia" con icona Cpu.
  - **Hero**: logo "R-A.I." glow blu diviso (`R` cyan + `-A.I.` white), sottotitolo minimal con mic-icon, VU meter decorativo, chip "LIVE SIGNAL".
  - **Now Playing panel**: `.console-panel` con `module-tag` "MOD · A · NOW PLAYING", corner accents, KindBadge palette blu-cyan (uso arancione solo per NEWS), 3 mini-display LCD con numeri zero-padded (069/1663/003) in `Share Tech Mono` cyan glow.
  - **4 moduli Home** (`HomeCards`): ognuno è `.console-panel` con `module-tag` "MOD · B/C/D/E · ...", icona hi-tech grande in box con glow (`CircuitBoard` per Manifesto, `Disc3` rotante per Daily Track, `Users` arancione per Human vs AI, `MessageCircle` per Chat LED). Testo ridotto ai bullet essenziali con `▸` cyan.
  - **Chat LED**: display CRT con scanlines + fosforo. Utenti in cyan (`>[USER]`), DJ in ambra (`<[DJ]`), sys line verde. Font `VT323`, uppercase, cursor lampeggiante quando vuoto ("IN ATTESA DI SEGNALE_").
  - **DJ roster**: card `.console-panel` con `module-tag CH·XXX` per canale, avatar con scanlines overlay + glow accent_color, VU meter decorativo, tag `Cpu` per LLM provider.
  - **Timeline**: entries come `.console-panel` con chip Mic + Cpu + KindBadge (blu family). Dialog scuro con border blu-glow.
  - **Sfondo animato**: orbi ora **blu/cyan/deep-blue** (era pink/purple/cyan), griglia tecnica sottile + scanlines globali.
  - **Bottone donate**: mantenuto orange gradient (coerente con palette alert). Modale come `.console-panel` con module-tag arancione.
  - **PulsingBrand**: bordo aggiornato a blu console (era `rgba(80,160,255,0.15)`).
  - Nessuna modifica alla logica audio, alle API o al radioEngine. Solo palette/layout/typografia.
- **v12.8 · HOME RESTYLING — 4 card + Chat LED + Disco del giorno** (2026-02, this session):
  - **Backend**: `Track.is_daily` nuovo field, `GET /api/tracks/daily` (ultimo track con is_daily=true), `GET /api/questions/recent?limit=N` (feed pubblico per Chat LED).
  - **Home ristrutturata** (`PublicRadio.js`):
    - Rimosso: barra slim "Chiedi ai DJ AI", pulsante "Inviaci il tuo brano" dall'header.
    - Visual PulsingBrand rimpicciolito a `max-w-2xl` centrato.
    - 4 card informative in grid 2×2 sotto il player:
      1. **L'ESPERIMENTO** — testo manifesto integrale
      2. **IL DISCO DEL GIORNO** — mostra track più recente con is_daily=true + player HTML5, placeholder se assente
      3. **HUMAN VS AI** — con pulsante "Inviaci il tuo brano" (link `/submit`) integrato
      4. **CHAT LED** — display retro-futurista verde fosforo, feed live delle domande (verde) + risposte DJ (rosa) con auto-scroll, poller 6s, input inline che triggera il multi-brain Q&A esistente
- **v12.7 · UX SMART — Pausa istantanea + Admin new-tab + Timeline Dialog + TTS toggle** (2026-02, this session):
  - **Pausa istantanea**: `radioEngine.stopAll()` ora chiama `hardStopMusic()` come primo step → taglio netto del brano corrente senza attendere il fade-out di 1s. Zero latenza percepita al click di Pausa/Stop.
  - **Admin in nuova tab**: `Link` sostituito con `<a href="/dashboard" target="_blank" rel="noopener noreferrer">` → cliccare "Pannello Admin" apre la Dashboard in una nuova scheda; la radio continua a suonare nella tab principale.
  - **Timeline con Dialog**: sezione "Cosa è appena successo in radio" — ogni segmento è ora un `<Dialog>` shadcn/ui. Click → modale con avatar DJ (glow con `accent_color`), nome DJ, kind + LLM provider, e testo integrale del copione (`s.script`) in area scrollabile.
  - **Toggle sorgente voce**:
    - Backend: nuovi endpoint `GET/PATCH /api/admin/tts/provider` con payload `{provider: 'elevenlabs'|'openai'}` → salvato in `station.state.tts_provider`.
    - `elevenlabs_service._synth_elevenlabs()` consulta il DB a ogni chiamata: se `tts_provider='openai'` ritorna `None` → fallback automatico su OpenAI TTS-1-HD.
    - Kill-switch env `TTS_DISABLE_ELEVENLABS` rimosso dal `.env` (soft switch admin lo sostituisce; l'env var resta come override permanente se serve).
    - UI: pulsante nel pannello Regia Audio (in alto a destra) che alterna colore (fucsia = ElevenLabs HD, ciano = OpenAI TTS-1-HD).
- **v12.6 · REGIA AUDIO — Mixer live + Crossfade + Beds + Kill-switch ElevenLabs** (2026-02, this session):
  - **Backend `server.py`** — nuovo blocco endpoints:
    - `GET /api/station/mix` (pubblico, no-cache) → volume 4 canali + crossfade + `active_bed_url`
    - `PATCH /api/admin/mix` (clamp 0-100 su volumi, 0-5000 su crossfade_ms)
    - `POST /api/admin/beds/upload` (MP3 ≤10MB + magic-bytes), `GET /api/admin/beds`, `PATCH /admin/beds/{id}/activate`, `PATCH /admin/beds/deactivate`, `DELETE /admin/beds/{id}`
    - `GET /api/beds/{filename}` con streaming Object Storage + Accept-Ranges
  - **Frontend `radioEngine.js`** riscritto sul mix bus:
    - 3 nuovi bus Web Audio (`musicBus`, `voiceBus`, `bedBus`) inseriti tra source e outputBus.
    - Music track → musicBus. Voice/speech/jingle/stinger → voiceBus. Procedural + admin bed → bedBus. Master → outputBus (2.4× × master/100).
    - `_startMixPoller()` fetch `/api/station/mix` ogni 2s con rampa 100ms lineare anti-click. Nessun reload richiesto — l'admin muove uno slider, entro 2s l'audio si adatta.
    - `CROSSFADE_MS` dinamico dal poller (`this._crossfadeMs`, default 1000).
    - `_playSpeechWithBed` priorità: (1) `segment.background_loop` esplicito → (2) `_activeBedUrl` dal poller → (3) fallback procedurale.
  - **Frontend Dashboard `RegiaAudioPanel`**: 4 slider vol + slider crossfade con debounce 250ms sul PATCH, upload Loop MP3 con nome, lista bed con player HTML5 e pulsanti Attiva/Elimina.
  - **Kill-switch ElevenLabs** (ordine utente prima di questa task): `TTS_DISABLE_ELEVENLABS=true` nel `.env` blocca ogni chiamata a ElevenLabs; fallback automatico su OpenAI TTS-1-HD via Universal Key. Riattivabile impostando `TTS_DISABLE_ELEVENLABS=false`.
  - Nome progetto: già "R-A.I." ovunque. DJ nel DB: già solo Leo/Aria/Max — i copioni LLM li usano automaticamente.
- **v12.5 · RESTYLING STAFF DJ — Solo Leo/Aria/Max con avatar Nano Banana** (2026-02, this session):
  - **DB scremato**: purge di 19 DJ vecchi; `DEFAULT_DJS` riscritto a soli 3 (Leo, Aria, Max) con provider LLM allineati al multi-brain router: `Leo→openai/gpt-5.2`, `Aria→anthropic/claude-sonnet-4-5`, `Max→gemini/gemini-3-flash-preview`.
  - **`ensure_seeded()` riscritto** con **purge attivo** dei DJ non nel roster ufficiale su ogni avvio → impossibile reintrodurre DJ vecchi via cache/deploy.
  - **Avatar fotorealistici generati** con Gemini Nano Banana (`gemini-3.1-flash-image-preview` via EMERGENT_LLM_KEY):
    - `/dj-avatars/leo.png` (822KB) — Uomo saggio 50 anni, cabina radio con vinili + schermi olografici
    - `/dj-avatars/aria.png` (875KB) — Donna con capelli di luce nella nebulosa cosmica
    - `/dj-avatars/max.png` (922KB) — Ragazzo cinico con cuffie + giacca di pelle, hardware futuristico
  - **Descrizioni magnetiche** allineate ai temi del multi-brain (Leo filosofo, Aria futuro/scienza, Max cinico tecnico).
  - **Sezione "Chi siamo"** in `PublicRadio.js` ridisegnata: card grandi 1:1 con avatar aspect-square, glow accent-color per DJ, titolo "Tre voci. Tre cervelli. Nessun umano in cabina."
  - Script one-shot riutilizzabile: `/app/backend/scripts/restyle_dj_staff.py` — se in futuro l'utente vuole rigenerare gli avatar, basta rieseguirlo.
- **v12.4 · INTERAZIONE "WOW" — Multi-brain DJ Q&A + priority queue + cache** (2026-02, this session):
  - **UI slim in cima Home** (`PublicRadio.js`): nuovo `ask-dj-slim-bar` con "Chiedi ai DJ AI" (nome opz + input + pulsante fucsia). Minimale, ~50px altezza, subito sotto header.
  - **Multi-brain routing deterministico** (`_classify_question_topic()` in server.py): keyword-based zero-cost per topic:
    - `philosophy` → **Leo** (voice `male-1`) → **openai/gpt-5.2**
    - `future_science` → **Aria** (voice `female-1`) → **anthropic/claude-sonnet-4-5**
    - `tech_cynical` → **Max** (voice `male-3`) → **gemini/gemini-3-flash-preview**
    - Fallback round-robin via hash della domanda (nessuna keyword match).
  - **Flusso `POST /api/questions` riscritto**:
    1. Classifica topic → DJ → salva su DB con `answering_dj` + `dj_voice_key`
    2. Ritorna al client subito con `{id, answering_dj, topic_category, ...}` (< 100ms)
    3. Spawna task background (`_generate_answer_background`) che fa: LLM answer (con `raise_on_budget=True`) → TTS ElevenLabs (indipendente da Universal Key, via chiave `xi-api-key` diretta) → segmento kind="answer" → **priority queue**.
  - **Priority queue** (`db.priority_queue` collection): letta come priorità **#1** in `pick_next_segment` (prima di time_signal, community, jingle, dj_talk, music). Ogni domanda risposta interrompe il flusso normale e va in onda.
  - **Cache riuso** (`db.question_cache`): hash SHA256 della domanda normalizzata (lowercase + no punctuation + whitespace collassato). Cache HIT → riusa `answer_audio_url` esistente, status="cached", zero LLM+TTS. Testato: 2 utenti stessa domanda → identico audio.
  - **Toast "effetto sorpresa"** (`submitQuestion` in PublicRadio.js): dopo submit mostra "{Leo|Aria|Max} sta ascoltando... la risposta tra pochi istanti!" (5s).
  - **ElevenLabs indipendente confermato**: `elevenlabs_service._synth_elevenlabs` chiama `https://api.elevenlabs.io/v1/text-to-speech/{voice_id}` con `xi-api-key: ELEVENLABS_API_KEY` diretto — nessun passaggio dall'Universal Key. Modello HD `eleven_multilingual_v2` (non low-latency).
  - **Extended Question model**: `topic_category`, `dj_voice_key`, `answer_audio_url`, `question_hash`, `processing_status: queued|processing|done|cached|failed`.
  - Test end-to-end verificato: 5 domande → 5 DJ routing corretti → 5 segmenti in priority queue → cache hit sulla domanda ripetuta.
- **v12.3 · JINGLE "A.I. Vs UMANI" PRODUZIONE E REGIA** (2026-02, this session):
  - ffmpeg installato (`apt install ffmpeg`) — abilita missaggio voce+musica lato server.
  - Nuovo script one-shot `scripts/produce_aivsumani_jingles.py`:
    - Suno API: 2 basi strumentali 15s (tech-electronic per intro, groovy-chill per outro) generate in parallelo.
    - OpenAI TTS-1-HD via Universal Key: voce **Nova** su intro, voce **Shimmer** su outro.
    - ffmpeg overlay: musica a 30% vol + fade-in 0.3s / fade-out 1.5s, voce loudnorm normalizzata e in primo piano, tutto tagliato a 15s, MP3 128kbps 44.1kHz stereo.
    - Push automatico su disco locale + Emergent Object Storage.
    - Aggiornamento automatico `station.state` con gli URL.
  - Rotazione palinsesto attivata: `frequency=8` (blocco community A.I. Vs Umani ogni 8 canzoni AI ≈ ogni 30 min).
  - Testo intro: *"State ascoltando A-I Versus Umani. La rubrica dove i talenti della nostra community sfidano l'intelligenza artificiale. Inviaci anche tu il tuo brano dal pulsante in Home!"*
  - Testo outro: *"Per ora la sfida si ferma qui. A-I Versus Umani torna più tardi. Amico umano, rimani con noi su R-A-I!"*
- **v12.2 · MASTER PLAN "A.I. Vs UMANI" V2 — Palinsesto integrato** (2026-02, this session):
  - **Segment model esteso**: nuovo `kind='community'` + campi `pre_jingle_url`, `post_jingle_url`.
  - **Backend `server.py`** — logica iniezione blocco community in `pick_next_segment`:
    - Nuovo contatore `songs_since_community` in `station.state`.
    - Se `community_frequency > 0` e `songs_since_community >= community_frequency` E c'è almeno 1 community track con `status='on'`, emette un Segment `kind='community'` con: (A) `pre_jingle_url` admin, (B) `script` DJ template client-side (nessun consumo LLM), (C) `music_audio_url` del brano community, (D) `post_jingle_url` CTA admin.
    - DJ scelto random tra Leo/Aria/Max con `voice_key` mappato (onyx/nova/echo per HD TTS).
    - Reset contatore. Fallback: se nessun community track ON → salta al normale palinsesto.
  - **Nuovi endpoint admin config**:
    - `GET /api/admin/community/config` — frequency + jingle URLs + counter
    - `PATCH /api/admin/community/config` (payload: `{frequency: 0-50}`, 0 = disabilitato; clamp permissivo)
    - `POST /api/admin/community/config/jingle_intro` — upload MP3 (max 5MB + magic-bytes check)
    - `POST /api/admin/community/config/jingle_outro` — idem
    - `GET /api/community_jingle/{filename}` — serving whitelisted (solo `community_jingle_intro.mp3` e `community_jingle_outro.mp3`) con streaming immediato + Accept-Ranges.
  - **Frontend**:
    - `radioEngine.js`: nuovo `_playCommunityBlock(segment)` che orchestra A→B→C→D senza overlap (usa `hardStopMusic` + `playJingle` + `speak` + `_playMusicWithVoice` per il brano).
    - Dispatcher `playSegment()` aggiornato con il nuovo branch per `kind='community'`.
    - `Dashboard.js` — `CommunityPanel` esteso con sezione **"Palinsesto A.I. Vs Umani"**: input frequenza, contatore live, 2 slot upload jingle (intro/outro CTA) con player HTML5 di preview.
    - `api.js`: nuovi helper `communityConfigGet/Set` e `communityUploadJingle(role, formData)`.
  - **Test backend**: 38/39 assertions passate (97%). L'unica non-conformità è comportamento intenzionale (clamp permissivo 0-50 invece di 400). Regressione 23/23 test community pre-esistenti passata.
- **v12.1 · OTTIMIZZAZIONE AUDIO — 4 punti anti-glitch** (2026-02, this session):
  - **(1) Streaming immediato dall'Object Storage** (`object_storage.py::stream_mp3()`): nuovo async generator che apre httpx stream verso il bucket e pusha chunk da 64KB al browser NON APPENA arrivano. Cache lazy locale in file `.part` → `os.replace` atomico al termine. Latenza tipo TTFB ~200ms invece di 3-8s attesa download completo.
  - **(2) Zero double-download** (`radioEngine.js::prewarmAudio()`): riscritto — ora fa `fetch(url).blob()` una volta sola, crea un `blob://` URL locale. Nel `_playMusicWithVoice` il tag `<audio>` usa direttamente il blob URL (zero secondi request HTTP). Blob revocato dopo l'uso o via GC timeout 6 min.
  - **(3) `Accept-Ranges: bytes`** su TUTTI gli endpoint audio (`/api/suno_audio`, `/api/tts`, `/api/community_audio`) — sia dal FileResponse locale sia dallo StreamingResponse remoto.
  - **(4) Buffer gate 5s** (`radioEngine.js::_playMusicWithVoice()`): `audio.play()` viene chiamato SOLO quando `audio.buffered.end(0) >= 5s` di contenuto contiguo (fallback: intero file o `readyState=HAVE_ENOUGH_DATA`). Polling ogni 250ms + eventi `progress/canplay/canplaythrough/loadeddata`. Safety skip a 20s. Elimina glitch iniziali.
  - Test backend 23/23 passati. Smoke frontend: zero errori console.
- **v12.0 · "A.I. Vs UMANI" + PWA + Media Session** (2026-02, this session):
  - **Modulo Community "A.I. Vs Umani"**:
    - Backend: nuova collection `community_tracks` + endpoints `POST /api/community/submit` (multipart form: author, title, copyright_ok, MP3 max 15MB con magic-bytes check), `GET /api/community_audio/{filename}` (con verifica DB — revoca file dopo delete), `GET/PATCH/DELETE /api/admin/community[/{id}[/toggle]]`.
    - Frontend: nuova pagina `/submit` (Nome autore, Titolo, file MP3, checkbox copyright obbligatoria) + pulsante fucsia "Inviaci il tuo brano" in header Home (visibile anche mobile).
    - Admin `Dashboard.js`: nuovo `CommunityPanel` con tabella brani, HTML5 player integrato per ascolto, toggle ON/OFF, delete con conferma.
    - Salvataggio duale su `/app/backend/static/community/` + Emergent Object Storage; DELETE revoca l'accesso via check DB.
    - Test backend pytest: **23/23 passati** (`/app/backend/tests/backend_test.py`).
  - **PWA installabile**:
    - `public/manifest.json` (name, short_name R-A.I., icons 192/512/maskable, theme_color #000, display standalone, lang it-IT).
    - Icone generate da `rai-visual-bg.png` (crop centrato quadrato + maskable con safe zone 72%).
    - Meta tag PWA in `index.html` (apple-touch-icon, apple-mobile-web-app-capable, mobile-web-app-capable).
  - **Media Session API**:
    - `radioEngine.js`: metodi `setupMediaSession({play, pause, next})`, `updateMediaMetadata({title, artist})`, `setMediaPlaybackState(state)`.
    - `PublicRadio.js`: registrazione handlers all'mount + update metadata su cambio segmento + playbackState su isPlaying → titolo/artista appaiono su lockscreen Android/iOS, pulsanti play/pause/next funzionano da cuffie/volante Bluetooth quando la tab è aperta.
    - **NOTA**: NON garantisce playback in background su iOS Safari (limitazione strutturale Web Audio API). Motore audio esistente (crossfade, ducking, jingle full-length) mantenuto invariato per scelta esplicita utente.
- **v11.5 · TRACK OVERLAY NEON — Singolo rigo marquee fucsia** (2026-02, this session):
  - **`PulsingBrand.js`**: sostituito il vecchio overlay title+artist a due righe con **un solo rigo marquee scorrevole**:
    - Testo unico `TITOLO · ARTISTA` (con separatore `•`) che scorre in loop continuo (22s, `raiTrackMarquee`), duplicato per un effetto seamless.
    - **Colore neon fucsia** `#FF1493` (palette `--neon-pink` del sito) con pulsazione del glow (`raiNeonPulse` 2.4s) — come il primo visual.
    - Posizionato a `top: 60%` con `translateY(-50%)` → cade esattamente nella banda scura tra l'immagine e il suo riflesso basso.
    - Maschera gradient laterale (`maskImage`) per un fade-in/out ai bordi che sfuma dolcemente l'entrata/uscita del testo scorrevole.
- **v11.4 · JINGLE INTEGRALE — Rimosso fade-out finale** (2026-02, this session):
  - **`radioEngine.js` `playJingle()`**: **rimosso** l'`outroWatcher` che sfumava il jingle negli ultimi 1.2s. Ora il jingle suona per **intero** fino alla coda naturale del file audio; l'evento `ended` chiude tutto senza decrescendo. Fade-in di 200ms mantenuto solo all'attacco per evitare click.
- **v11.3 · BUDGET GUARDRAIL — Stop-on-Empty-LLM prima di chiamare Suno** (2026-02, this session):
  - **`server.py`**:
    - Nuova eccezione dedicata `LLMBudgetExhaustedError` per crediti Universal Key esauriti.
    - `llm_generate()`: nuovo parametro `raise_on_budget: bool = False`. Se `True`, invece del fallback silenzioso solleva `LLMBudgetExhaustedError` quando l'errore contiene "budget/exceeded/rate/insufficient".
    - `generate_track()`: entrambe le chiamate LLM (metadati JSON + lyrics completi) passano `raise_on_budget=True`. Cattura l'eccezione → risponde **HTTP 402**. Doppio hard-check: (a) se raw metadata è vuoto/non-parseable **NON chiama Suno** → HTTP 502; (b) se `full_lyrics` è troppo corto → HTTP 502. Zero rischio di chiamare Suno con testo fallback duplicato.
  - **12 script di batch** (`scripts/generate_*.py`): iniettato check `if r.status_code in (402, 502): log(...); break` PRIMA del branch `== 200`. Il ciclo si ferma al primo errore di budget/LLM vuoto, preservando i crediti Suno rimanenti.
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

---

## 2026-08-22 · Blocco Regia (Auth JWT admin)

**Implementato:**
- Backend: `/app/backend/auth.py` con bcrypt + PyJWT (HS256, TTL 8h)
- Middleware globale che protegge tutti gli endpoint `/api/admin/*` (401 senza JWT admin)
- Endpoint auth: `POST /api/regia/login`, `GET /api/regia/me`, `POST /api/regia/logout`
- Brute-force: 5 tentativi/15min per IP:email → 429
- Seed admin idempotente all'avvio (aggiorna hash se `ADMIN_PASSWORD` cambia in `.env`)
- Frontend: `AuthProvider` (context), `AuthGuard` (redirect `/admin/login`), pagina `/admin/login` in stile Console
- Bottone "Regia · Logout" nell'header Dashboard
- Interceptor Axios: fallback `Authorization: Bearer` da localStorage per browser che bloccano cookie SameSite=None cross-site
- `backend/.env` aggiornato con `JWT_SECRET`, `ADMIN_EMAIL="admin@r-ai.it"`, `ADMIN_PASSWORD="RAI-Regia-2026!"`
- `/app/memory/test_credentials.md` aggiornato

**Test manuali (curl):** login OK 200, wrong pwd 401, `/api/admin/*` senza cookie 401, con cookie passa (200/405).

**Azioni utente rimaste:**
1. Sostituire `ADMIN_PASSWORD` in `.env` con password forte propria
2. Deploy su `r-ai.it` + copiare le 3 env vars in Produzione (Emergent settings)

## v13.30 · REGIA MORBIDA + DISCO DEL GIORNO (2026-09-18)

**Ordine ricevuto**: "REGIA MORBIDA E CODA ELASTICA" + "MOTORE DISCO DEL GIORNO" + stabilizzazione UI.

**Implementato**:
- **Regia Morbida (Coda Elastica)**: `_clock_advance` era già soft-sync (no hard-cut), rinforzato con endpoint `GET /api/stream/queue` che espone al frontend i prossimi 5 elementi + prossimi 3 eventi Timeline pending (soft-preview). Zero interruzioni del brano in corso: gli eventi Timeline attendono la fine naturale.
- **Transizioni Organiche**: `next_crossfade_ms` ora garantisce sempre un valore (2000ms music, 1200ms talk/orario) anche in assenza di BPM. Il client fade fluido su OGNI confine.
- **Motore Disco del Giorno**: `_power_play_ticker` gira in background, alle 05:00 (Europe/Rome) genera/sceglie il PP. Se `ai_suno_engine` ON → Suno con mood pool uplifting mattutino; altrimenti library pick. Persiste in `power_play_daily` (`_id=YYYY-MM-DD`).
- **Alternanza 1:1 human ↔ algoritmo**: `_power_play_maybe_pick` intercala il PP nel clock ogni `_POWER_PLAY_ROTATION=2` brani. Se PP non ancora `ready` (Suno in generazione), NON resetta il counter → fedele alternanza dopo il download.
- **Endpoint Power Play**:
  - `GET /api/admin/power-play/today` → doc PP + track resolved + rotation info
  - `POST /api/admin/power-play/regenerate` → VETO: cancella e rigenera (contatore veti persistente)
- **UI Regia Command Center**:
  - Nuovo `PowerPlayMonitor.js`: mostra titolo/artista/durata/mood, badge sorgente (AI · SUNO / LIBRARY), status "IN GENERAZIONE", contatore veti, pulsante RIGENERA
  - Nuovo `ElasticQueuePreview.js`: prossimi 5 elementi coda + prossimi 3 eventi Timeline programmati (soft-sync banner)
- **Stabilizzazione UI**: soppressore globale in `index.js` per il warning benign "ResizeObserver loop completed with undelivered notifications" — non nasconde errori reali.
- **Fix collaterale critico**: `app.include_router(api_router)` era chiamato a metà file (~L7583), quindi tutte le rotte definite più in basso (`/api/admin/background-tasks`, e prima ancora le nuove Power Play/queue) NON risultavano registrate. Spostato dentro `on_startup()` dopo tutte le definizioni. Openapi passa da 134 a 138+ paths con le nuove rotte visibili.

**Testing** (senza sprechi):
- `curl /api/stream/live.m3u8` → playlist HLS con `#EXT-X-DISCONTINUITY` corretti ✅
- `curl /api/stream/now` → `next_crossfade_ms=2500`, BPM-aware ✅
- `curl /api/stream/queue` → queue_len=5, upcoming=0 ✅
- `curl /api/admin/power-play/today` (con token) → PP "Notti di Sole" (Suno pending) ✅
- Screenshot Dashboard: `power-play-monitor` + `elastic-queue-preview` render OK con dati live ✅
- Endpoint `regenerate` NON testato in preview (eviterei burn Suno).


## Previous LEDWALL / Team / Sponsor / Chat Neurale / CUE / Whisper features
Vedi turni precedenti in questa sessione:
- LEDWALL Canvas 60fps multi-layer (nebulosa + console PNG breathing 40s + sinusoidi + stelle cadenti sottili dai 4 bordi + Neural Sphere talk + Atomic Clock + Night mode)
- R-A.I. TEAM unificato 6 chip (3 speaker + 3 DJ notte)
- DIVENTA PARTNER + Coda di Approvazione + Sponsor scheduling (spot_start/end/freq)
- Sequenza oraria sponsorizzata: time_signal → sponsor_intro (LRP) → ad_spot (LRP) → ora PARI community LRP / ora DISPARI Disco del Giorno
- CHAT NEURALE con mic Whisper (`whisper-1` via `EMERGENT_LLM_KEY`) + tabula rasa messaggi all'avvio
- CUE piccolo pixel-art (card TEAM) + BigCue SVG arancione con blink casuale 8-16s in header
- LiveBrainTicker marquee LCD nell'header
- Fix cache preascolto + cestino sotto MP3 list

## v13.31 · BROADCAST MASTER & NIGHT VIRTUAL CLUB (2026-09-18)

**Ordine ricevuto**: "DJ-Sync + Jingle Matrix + LedWall Virtual Club + Night Control Center".
**Scelte utente**: A-a (Pre-render notturno), B-a (Ducking client-side), C-a (Emergent Object Storage).

**Implementato**:
- **AI SPEAKER toggle** (`station.state.ai_speaker_enabled`, default ON). Endpoint `GET/PATCH /api/admin/ai-speaker`. In `_clock_advance`, `need_dj` è azzerato quando OFF → zero costo LLM/TTS. La radio va con sola musica + jingle instrumentali.
- **BPM reprobe batch offline** (`POST /api/admin/audio/reprobe-bpm-all`, background). Legge dai file locali `/api/suno_audio/`, invoca `bpm_service.detect_bpm_from_path` (librosa). Zero ECU.
- **Intro detection** (`POST /api/admin/audio/detect-intros`, background). ffprobe pkt_size + rolling avg detect primo picco energetico → salva `intro_sec` su `tracks`. Fallback 8s se non affidabile.
- **Jingle Library**: nuova collection `jingle_library` con `kind ∈ {voice_over, station_break}`. Endpoint upload/list/delete + `/api/jingles/voice-over/random` + `/api/jingles/station-break/random`. Normalizzazione ffmpeg + duration reale su upload.
- **Night Assets Library**: nuova collection `night_assets` per LedWall Virtual Club, con `kind ∈ {mp4, photo, fx}` + peso weighted-random. Endpoint upload/list/delete.
- **Night LedWall rotation**: nuovo `GET /api/ledwall/night-state` — durante 22-06 (Europe/Rome) pesca weighted-random e ruota ogni ~20s tramite `night_ledwall_clock` in Mongo (sync tra client). Se libreria vuota → fallback a comportamento standard.
- **Ken Burns photo layer** in `LedWall.js`: `<img>` con animazione CSS `kenburns` (pan+zoom) 22s alternate → applica al kind=photo.
- **Beat-Match pre-render notturno**: nuovo `_beatmatch_pregen_ticker` attivo solo 22-06 se `station.state.beatmatch_enabled=true`. Guarda i prossimi 2 elementi della coda `station_clock`, pre-renderizza mp3 transizione (ultimi 20s A + acrossfade 8s + primi 20s B con `atempo` correction se |ΔBPM|≤8) via ffmpeg. Cache locale `/app/backend/static/beatmatch/`, servita via `/api/beatmatch/{fname}` con `Cache-Control: 1h`.
- **Voice-Over ducking client-side** in `SyncLivePlayer.js`: listener `rai:voice-over:play` → fetch jingle random → crea `<audio>` parallelo → duck main a 25% con ramp 300ms → ripristina al termine. Zero re-encoding server.
- **Serve endpoints**: `GET /api/jingle_audio/{kind}/{filename}` + `GET /api/night_media/{kind}/{filename}` (Object Storage + Range).
- **Night Control Center** (`NightControlCenter.js`): pannello unificato in Regia con AI Speaker toggle, Beatmatch toggle, Jingle Library (upload + preview `<audio controls>` + delete), Night Assets (upload mp4/photo/fx con weight + delete), Manutenzione (Scan BPM · Rileva Intro · Test Voice-Over).

**Testing** (senza sprechi):
- `curl` su tutti gli endpoint nuovi (12+ paths registrati in openapi) ✅
- Toggle AI Speaker ON/OFF ✅
- Upload FX "neon_pulse" via curl → visibile in UI ✅
- 1 screenshot Dashboard mostra tutto il Night Control Center ✅
- Nessun test agent, nessun burn Suno.

**Note operative**:
- Il beatmatch ticker resta idle 06-22 per default (verificato con `is_night_now=false`).
- Cache beatmatch cresce ~2-4MB per transizione; sarà ~40-80MB per una nottata full-catalog → gestibile su disk pod.
- Se Object Storage disabilitato in prod, upload jingle/night-assets returna 503 pulito (no crash).

**API totali**: da 138 → 155 paths.

## v13.32 · AD MANAGER — CLUSTER INTRO→SPOT→OUTRO (2026-09-18)

**Ordine ricevuto**: "Ad Manager con audio+visual, cluster [Intro]+[N random Spot]+[Outro], LedWall sync, Flash AD in Regia, evento Break Pubblicitario nel Calendar. **NO HEALTH-CHECK / NO TEST AGENT**".

**Implementato**:
- **Collection `ad_manager_spots`**: `{id, kind: intro|spot|outro, name, audio_url, video_url, duration_sec, weight, sponsor_note, start_date, end_date, created_at, deleted_at}`. Ogni AD ha coppia audio + visual (video/img) opzionale.
- **Endpoint backend** (6 nuovi):
  - `GET /api/admin/ad-manager` — list con filtro `kind`
  - `POST /api/admin/ad-manager/upload` — upload audio (obbligatorio) + visual (opzionale) con normalizzazione audio ffmpeg
  - `DELETE /api/admin/ad-manager/{spot_id}` — soft delete + rimozione fisica storage
  - `POST /api/admin/ad-manager/flash` — FLASH AD: inserisce IMMEDIATAMENTE cluster in coda (`count` 1-6)
  - `POST /api/admin/ad-manager/preview-cluster` — DRY-RUN cluster sample
  - `GET /api/ad_media/{audio|visual}/{intro|spot|outro}/{filename}` — Object Storage stream con Range
- **Motore cluster** (`_ad_build_cluster`): weighted-random pick per ruolo, `[intro?] + [N spot random] + [outro?]` concatenati via `follow_up` a cascata (zero-gap tra segmenti, HLS pre-buffer continuo). Deduplication back-to-back nel cluster.
- **Timeline integration** (`kind=ad_break`):
  - `POST /api/admin/timeline` accetta `kind=ad_break` con `ad_break_count` (default 2), senza audio_url né DJ
  - `_timeline_pick_due` intercetta `kind=ad_break` al momento del pick e espande al volo il cluster completo, marcando skip se library vuota
  - Master Calendar Pro mostra il kind con icona 📢 e badge arancione
- **LedWall sync**: già supportato via `current.video_url` esposto nel clock — quando un segmento AD ha visual, `/api/ledwall/state` lo mostra automaticamente per la durata del segmento e torna al default alla fine.
- **UI `AdManagerPanel.js`**:
  - Banda dedicata "📢 AD MANAGER" nel Dashboard (dopo Night Control)
  - Form upload: kind selector, audio file, visual file, weight, sponsor_note, start/end date
  - Filtro per ruolo (All/Intro/Spot/Outro) + contatori
  - Lista con audio inline preview + badge VISUAL + delete
  - Bar FLASH AD con `count` input + pulsante "FLASH ADESSO" (disabled se manca almeno 1 spot)
- **SmartFlowTimelinePanel**: nuovo kind `📢 Break Pubblicitario` con campo dedicato "N. Spot Random" (1-6) visibile solo per ad_break. Submit funziona senza audio_url/DJ.

**Testing**: solo compilazione (backend `python -c "import server"` OK, frontend `webpack compiled` OK). Nessun test agent, nessun health check, nessun burn Suno.

**API totali**: da 155 → 178 paths.

## v13.33 · FIX RE-PROBE DURATIONS + FILTRO SILENZI (2026-09-20)

**Ordine ricevuto**: Fix chirurgico dell'endpoint `/admin/audio/reprobe-durations` che in produzione saltava ~50 tracce/jingle perché `USE_OBJECT_STORAGE=true` mantiene il disco locale come sola cache differita. Aggiungere anche filtro `duration_sec > 0` nella rotazione + trattare durata mancante come già scaduta.

**Implementato** (6 punti seguiti alla lettera):
1. **`/admin/audio/reprobe-durations` con fallback Object Storage**: quando `_resolve_local_path_from_url()` non trova il file localmente, l'endpoint scarica via `object_storage.fetch_mp3()` (mappatura URL→storage-key: `suno_audio→suno`, `tts→tts`, `community_audio→community`; `/api/audio/` resta local-only), scrive un tempfile, esegue ffprobe, salva `duration_sec = round(real + 0.4)`, poi rimuove il tempfile nel `finally`. Response ora ritorna 4 conteggi separati (`probed_local`, `probed_storage`, `unreadable`, `skipped_no_url`) + log warning per ogni track_id fallito. **Test preview: 194 scanned, 175 local + 15 storage, 23 update, 2 unreadable con warning nominato.**
2. **`_clock_pick_track` main query**: aggiunto `"duration_sec": {"$gt": 0}` — la rotazione principale non pesca più tracce con durata 0/null. La fallback query "if not tr" resta invariata (rotazione mai vuota).
3. **`_clock_pick_dj_jingle`**: stesso filtro applicato ai jingle DJ.
4. **`_clock_advance._is_expired`**: `duration_sec` mancante o `<= 0` → SCADUTA immediata (prima teneva silenzio 180s). Log warning con id+title del brano problematico.
5. **`hls_live_playlist` + `stream_now`**: `or 180` lasciato in posto come safety net + log WARNING quando scatta — così se una traccia sfugge ai filtri (2) e (3) lo vediamo subito nei log di produzione.
6. **Startup sanity check**: `shutil.which("ffmpeg"/"ffprobe")` all'avvio; log ERROR grosso se manca almeno uno, log INFO con path se OK. **Test preview: `[startup] ffmpeg=/bin/ffmpeg ffprobe=/bin/ffprobe — audio pipeline pronta`**.

**NON toccati** (come da ordine): `_beatmatch_render_pair`, `_ad_build_cluster`, `/admin/tracks/upload`, path di ingestione Suno.

**Regressioni**: nessuna. Il router (161 openapi paths) e il flusso HLS restano identici.

## v13.34 · SMART RECURRENCE CONSOLIDATA + SEQUENZE CONCATENATE (2026-09-21)
- **UI** (`SmartFlowTimelinePanel.js`): rimosso pannello "SEQUENZA ORA ESATTA + SPOT / ARMA" e opzione "Ogni ora" dal menu Ricorrenza. Tutta la ricorrenza passa da Smart Recurrence (rrule). Endpoint `/admin/timeline/ora-esatta` mantenuto lato backend (compat, nessuna UI).
- **follow_ups** (lista ordinata `[{audio_url,title,artist,duration_sec,video_url}]`): accettato da `POST /admin/timeline` e `POST /admin/timeline/rrule` (`_sanitize_follow_ups`), propagato ai figli via `_rrule_materialize_due`, esposto da `_timeline_pick_due`, iniettato in blocco in testa alla coda in `_clock_advance` (pattern `admin_ad_manager_flash`). `follow_up` singolo legacy ancora supportato (va per primo).
- **ad_break**: catena convertita da follow_up annidati (bug: si fermava al 1° elemento) a lista piatta `follow_ups`.
- **time_signal live**: `_timeline_pick_due` ri-risolve l'audio dell'ora corrente (Europe/Rome) per `kind in (ora_esatta, time_signal)`; rrule con `kind=time_signal` senza audio salva marker `time_signal:live` (skippato se cache miss). Helper `_resolve_current_hour_time_signal`.
- **UI Smart Recurrence**: controllo ripetibile "＋ aggiungi MP3 concatenato" (qualsiasi kind, con/senza DJ), `data-testid` `rr-followup-add`, `rr-followup-row-{i}`, `rr-followup-remove-{i}`.
- Verifica: curl + script in-process (materializzazione, pick, iniezione reale nel clock: 2 follow-up in testa in ordine). Nessun testing agent (ZERO WASTE).
- Backlog: Dual-Brain DJ (P1), Identità Digitale avatar (P2).

## v13.35 · KILL-SWITCH VISIBILE + SPOKEN_TEXT ISOLATO (2026-09-21)
- Flag `ai_openai_talk`: vive in `station.state` (Mongo, persistente), letto via `_get_ai_controls()` (cache 3s), GET/PATCH `/admin/ai-controls`. In produzione risultava OFF → `[dj-pregen] SKIP tick`.
- UI: banner rosso "⛔ Generazione IA disattivata · OPENAI TALK = OFF" in SmartFlowTimelinePanel (poll 8s) con bottone "Attiva ora" (`ai-talk-disabled-banner`, `ai-talk-enable-btn`); badge verde quando ON.
- `POST /admin/timeline` (talk a tema con DJ): se OFF → **409** chiaro PRIMA di chiamare LLM; se il DJ non ha `voice_key` → 409; TTS con `strict_voice=True` (nessun fallback Bark/voce generica, nessun audio di altri speaker) → 502 esplicito se il provider fallisce.
- `synth_speech(..., strict_voice)` + `AITalkDisabledError` nel wrapper server.py.
- `_extract_spoken_text()`: isola SOLO il parlato (rimuove fence, markdown, [didascalie], *azioni*, (ride), etichette, righe che riecheggiano il prompt). Evento timeline salva `spoken_text` + `llm_prompt{system,user,raw_output}`; `Segment.spoken_text` nuovo campo; TTS (generate_segment, render_hd, timeline) riceve esclusivamente spoken_text.

## v13.38 · AUDIT PIPELINE VOCE DJ (2026-09-23)
- **Toggle persistono** (verificato: 7 PATCH manuali alle 20:15 del 22/09 li hanno messi OFF; sopravvissuti a 4 restart). `ai_voice_to_air` gate SOLO il mic ascoltatori (`/voice/transcribe`); la voce DJ dipende da `ai_openai_talk` (+ `ai_speaker_enabled`, `dj_talk_every_n_songs`). Label/descrizioni UI corrette; PATCH ritorna read-back Mongo; `ai_controls_updated_at`.
- **Voice L&C**: `nse3woUFSMa13Q3ZFI3y` rifiutata (voice_not_fine_tuned, tutti i modelli); `WtpgJy6CcOKH2K50eVfg` = voice_not_found. Sostituita con `VR6AewLTigWG4xSOukaG` (HTTP 200). Migrazione startup idempotente + purge tts_cache male-4.
- **Fail loud**: `VoiceRejectedError` (elevenlabs_service) → log ERROR + `station.state.tts_voice_error` + banner in AI Master Control; nessun fallback OpenAI/Bark.
- **Testo DJ**: prompt intro/outro music riscritti (18-28 parole, frasi complete, titolo+artista), DJ_TONES sobri, anti-ripetizione soft, regola 5 system prompt "chiaro al primo ascolto". Test reale: "Centoventiquattro battiti al minuto... DJ VantaRay ci regala Neon Pulse Tonight...".
- **Gate a monte**: `elevenlabs_service.synth_speech` e `generate_segment` controllano `ai_openai_talk` PRIMA di qualsiasi chiamata provider. In preview con switch OFF: 0 LLM / 0 TTS dal 22/09 20:16 (log).
- **NOTA FM_MODE**: con `fm_mode=false` la TTS va SEMPRE su OpenAI TTS-1-HD: i Voice ID ElevenLabs non vengono usati. UI mostra la route attiva.

## v13.39 · BULK ASSET MANAGER + ZIP ONE-SHOT (2026-09-23)
- Magazzino Universale (`CommandCenter2Panels.js`): checkbox su righe MP3 e Video, "Seleziona tutti", "⬇ SCARICA SELEZIONATI (n)", link ZIP one-shot. testid: `bulk-asset-toolbar`, `bulk-select-all`, `bulk-download-btn`, `bulk-check-audio-{id}`, `bulk-check-video-{id}`, `bulk-zip-link`.
- Backend: `POST /admin/assets/zip` {items:[{url,title}]} (max 80, legge via URL interna → riusa serving + objstore fallback) → `/tmp/rai_zip/<token>.zip`; `GET /admin/assets/zip/{token}` FileResponse + BackgroundTask unlink (cancellato dopo il download, 404 al secondo tentativo); janitor 30 min. Protetto dal middleware admin.
- Verificato via curl: 2 MP3 → ZIP 6.7 MB valido, residuo server 0 file, one-shot 404, senza login 401.

## v13.40 · LEDWALL EFFETTI VISIVI SELEZIONABILI (2026-09-25)
- PublicRadio.js: tendina "Effetto visivo" (`ledwall-effect-select`) in alto a sx sul LedWall: Auto | Gradiente animato | Anelli/particelle | Barre EQ/waveform | Starfield/warp | Sfera olografica; persistita in localStorage `rai:ledwall:effect`; prop `effect` → LedWall.
- LedWall.js: `drawEffect()` con 5 modalità nel loop rAF; `effectRef` (no restart loop), `bpmRef` da GET /api/stream/now (poll 10s, current.bpm). Beat = decadimento sul BPM server se presente, altrimenti ampiezza bass/mid/high (fallback getFakeAmplitude già esistente). Effetti attivi anche in standby (Auto resta identico: canvas vuoto prima del PLAY).
- Verifica preview (Playwright): 5 effetti disegnano (canvas lit), 0 errori JS, Auto invariato.

## v13.41 · LOGO ANIMATO SFERA 3D (2026-09-25)
- Nuovo `components/RaiOrbLogo.js` (CSS 3D puro): sfera wireframe (6 meridiani + 3 paralleli, preserve-3d) rotazione Y continua 9s + nucleo pulsante + anello testo "R-AI · R-AI ·" (14 span) che orbita in senso inverso 14s. Colori brand ciano/blu, glow. testid `rai-orb-logo`.
- PublicRadio.js header: `<img rai-face.png>` sostituito da `<RaiOrbLogo size={56}/>` dentro `rai-logo` (w-14 h-14 e drop-shadow invariati). Keyframes `raiLogoFloat` rimossi da index.css (nessun altro uso).
- HoloBrand.js NON toccato: lì `rai-face.png` è il volto robot audio-reattivo (warm ring/bocca), feature distinta.
- Verifica preview: box 56x56, sfera e testo in movimento (transform cambia), 14 lettere, nessun errore.

## v13.42 · RE-LAYOUT REGIA "PILOTA PROFESSIONALE" (2026-09-28) — solo UI
- Dashboard.js: griglia xl:12 → colonna principale (9) + sidebar sticky (3). Bande: LIVE COMMAND (BroadcastControlBar, AIMasterControlPanel 7 switch, LiveQuickBar [Soggetto globale + FLASH AD], FmModePanel) → WAREHOUSE & ASSETS (Magazzino full-width, AdManager, RegiaAudio/bed, TrackManager, Cestino) → SCHEDULING (SmartFlowTimeline, PowerPlay, RotationRules) → NIGHT & LIVE SOURCES (NightControl, Broadcaster HLS/Icecast, NightDJs, GoLive, LedWall mini, LiveExternal, ManualMode) → COMMUNITY & PARTNERS → SECONDARY UTILITIES (Control room generatori Talk/News/Oroscopo/Meteo, Stelle, KillSwitch, DbSync, KPI, Ads, Telegram, LLM, DJ mgmt, Questions, Tracks, Recent).
- Sidebar: bottone Palinsesto full-screen + `TimelineMiniPanel` (read-only, GET /admin/timeline pending+template) + ElasticQueuePreview.
- Nuovi componenti UI in Dashboard.js: `LiveQuickBar` (GET/PATCH /admin/regia/config, POST /admin/ad-manager/flash), `TimelineMiniPanel`. Nessuna logica backend toccata.
- CSS: `.regia-col { contain: layout style }` per isolare i re-layout (ResizeObserver), `.regia-flat`.
- Fix warning React `<option>` multi-child (SmartFlowTimelinePanel riga 496, LiveQuickBar).
- Verifica Playwright: ordine bande corretto, LIVE COMMAND 99→1044px (player+7 switch+Soggetto+FLASH AD visibili con uno scroll minimo), 0 sovrapposizioni, Magazzino carica 195 MP3.

## v13.43 · RIORDINO UI REGIA (2026-09-28) — solo Dashboard.js
- LIVE COMMAND: BroadcastControlBar, AIMasterControlPanel, LiveQuickBar, FmModePanel + riga GoLivePanel|LedWallMiniPreview affiancati + BroadcasterPanel. Poi SCHEDULING (SmartFlowTimeline, PowerPlay, RotationRules), poi WAREHOUSE, Night (senza GoLive/LedWall/Broadcaster), Community, Secondary (Control Room generatori e StellePanel affiancati 2+2, funzioni distinte).
- Rimosso codice mai renderizzato: LibraryDownloader (+FilterChip usato solo da esso), UploadMp3Panel, CategorizedExportPanel; import lucide `Archive`, `Package` rimossi. Dashboard.js 4266 → ~3720 righe.
- Dedup: unico "APRI PALINSESTO FULL-SCREEN" (sidebar, `sidebar-open-master-calendar`); rimosso quello nell'header.
- Verifica Playwright: ordine bande, GoLive+LedWall mini affiancati in alto, 1 solo bottone palinsesto, Stelle accanto a Control Room; home con effetto "Logo rotante a ritmo" (aggiunto dal supporto, ticket #247410): orb 174px centrato e in rotazione. Compilazione: solo warning pre-esistente loadDevices.

## v13.44 · REGIA BROADCAST AUTONOMA (2026-09-29)
- **Matrice temporale**: `Track.broadcast_slot` (always|day 06-22|night 22-06). Migrazione startup idempotente → 197 tracce ALWAYS. `PATCH /admin/tracks/{id}/broadcast-slot`. `_clock_pick_track` filtra in tempo reale (ora Roma) su community/main/fallback. Pulsanti ☀GIORNO/☾NOTTE/∞SEMPRE per riga nel Magazzino (`slot-{day|night|always}-{id}`).
- **Cassetti Magazzino**: chip TUTTI/MUSICA/JINGLE/SPOT/VOCALI/BASI(LOOP)/FX (`magazzino-drawer-*`), ricerca (`magazzino-search`), ordine alfabetico. Helper esportati `assetCategory/ASSET_CATEGORIES/assetLabel/sortAssets` (CommandCenter2Panels).
- **AssetPicker** (SmartFlowTimelinePanel): ricerca + categoria + select alfabetico per sorgente (`timeline-input-source[-search|-cat]`), MP3 concatenati (`rr-followup-add`), modifica evento.
- **Coda di Successione** per OGNI evento: pannello follow_ups sempre visibile, `follow_ups` nel POST /admin/timeline singolo (prima solo rrule).
- **Upload libero**: kind `billboard` (→ is_spot + is_billboard, senza date); pulsante "📣 Billboard (libero)" nel modal Track Manager. Spot già senza obbligo date.
- **Dual-mode**: `_get_ai_controls` default ON per chiave assente (AI 360 = stato di default); OFF esplicito = esclusione manuale (prod resta OFF finché non si riaccende).
- Layout: WAREHOUSE al centro (2ª banda), SCHEDULING 3ª. Verifica Playwright: ordine, cassetto JINGLE 26, ricerca, slot click, picker 196→7 con ricerca, follow-ups senza Smart Recurrence, 0 errori.

## v13.45 · HOME REDESIGN BROADCAST (2026-10-02) — solo PublicRadio.js
- Hero 3 colonne (`home-hero`): SX 3/12 player + brano in onda (`home-player-col`: ON AIR/STANDBY, copertina `image_url` o BigCue, titolo/artista, waveform, SyncLivePlayer); CENTRO 6/12 LedWall dominante (`home-ledwall-col`, min-height min(62vw,560px), tendina effetti); DX 3/12 info (`home-info-col`: A seguire da `/api/stream/now.next[0]`, stato Regia, ultimo messaggio DJ `lastDjLine`) + Chat Neurale.
- Mobile: order LedWall (piena larghezza, 390px) → player → info → chat. LiveBrainTicker e CueThinking non renderizzati (`{false && …}`, codice intatto); nessun testo tecnico nella hero (verificato regex).
- `displayCurrent = effectiveCurrent || timelineNow` per mostrare il brano sul clock anche in standby. Nuovi stati `streamNext`, `lastDjLine`.
- Verifica Playwright desktop 1920 + mobile 390: layout, ordine, assenza testo tecnico, 0 errori JS. Nessun'altra pagina toccata.
- v13.46 · Live Brain (componente `LiveBrain`, terminale operazioni AI) reinserito in home in sezione dedicata `home-live-brain` tra hero e "Le Stelle di Neuroni"; props `current={effectiveCurrent}` `segments={segments}`. LiveBrainTicker/CueThinking restano nascosti nel player. Nessun componente eliminato.

## v13.47 · LOGO R-AI CENTRALE NEL LEDWALL (2026-10-03)
- Default "logo" per nuovi visitatori (già v13.41, localStorage rispettato). Orb DOM `RaiOrbLogo` 60% del riquadro (prima 34%, cap 520px), fade-in `raiOrbFadeIn` 1.4s, perspective proporzionale, lettere orbitali scalate (font em). Alone olografico canvas dietro l'orb (glow radiale, anello orbitale inclinato a tempo, scanline).
- `drawRaiMark()`: watermark sfera stilizzata + "R-AI" in basso a dx, pulsante a tempo, in gradient/rings/eq/starfield/holo (via drawEffect) e in auto (solo se `alphas.clock < 0.05` e non standby → mai sopra l'orologio). Verifica Playwright: 5 effetti 9/9 campioni accesi; auto in standby 0 (canvas vuoto by design).
- Invariati: detectMode, forzatura "auto" quando target=clock, selettore effetti.

## v13.48 · SEGNALE ORARIO CON MINUTI (2026-10-04) — solo codice, clip da generare in Regia
- Decisioni utente: automatismo orario INVARIATO; minuti solo per eventi `time_signal`/`ora_esatta` Timeline/rrule; testi ORA "Segnale orario. Sono le nove" (00→"È mezzanotte", 01→"È l'una"), MINUTO "e tre minuti, su R-A.I. Radio, sincronizzata con l'orologio atomico di Singapore!" (00→"in punto, …", 01→"e un minuto, …"); generazione dal pulsante dopo il deploy.
- Backend: collezione `time_signal_parts` (_id h00-h23, m00-m59), `POST /admin/time-signal/generate-parts?force&voice_key&dj_id&which=all|hours|minutes&dry_run&allow_local_only` (riusa `_generate_time_signal_hour(..., tag=)`: sintesi→validazione→storage→re-fetch), `GET /admin/time-signal/parts-status`. `_resolve_time_signal_with_minutes()`; in `_timeline_pick_due` ORA = audio evento, MINUTO = primo follow_up (zero-gap), poi gli altri follow_ups (spot); fallback al permanente orario se una clip manca.
- UI: box "Ora esatta CON MINUTI" nel form kind=time_signal (stato n/84, Genera / Rigenera). testid `timeline-generate-ts-parts`, `ts-parts-status`.
- Verifica (zero TTS): dry-run 84 testi corretti (ventuno/ventotto/trentuno), pick con clip seed → follow_ups [minuto, spot]; senza clip → fallback invariato. Test docs rimossi.

## v13.49 · ARCHIVIO BRANI · CONTROLLO TOTALE (2026-10-06)
- Fusione "Tutte le risorse della radio" (MagazzinoUniversale) + "Archivio Brani · Gestione unificata" (TrackManagerPanel) in `components/ArchivioControlloTotale.js`, montata subito dopo LIVE COMMAND in `Dashboard.js`. I vecchi componenti restano nel codice (TrackManagerPanel non montato; MagazzinoUniversale montato in modalità `embedded` per Upload/Cestino/Vocali).
- Riga: TOGGLE ON/OFF (on_air, già rispettato dal motore) → 6 FASCE → MATITA (EditPanel, APPROVA E SALVA / ANNULLA) → CESTINO (popup conferma) → pulsanti preesistenti (ZIP, Preview/PLAY LIVE, MP3, Sostituisci, Genere, BPM, Giorno/Notte, Night-jingle). Lista alfabetica, ricerca + filtro categoria + filtri genere in cima.
- Backend (chirurgico, approvato dall'utente): `broadcast_slot` esteso a `always|morning 06-11|afternoon 11-19|day 06-19|evening 19-22|night 22-04`; `_broadcast_slots_active(hour)` usato in `_slot_q` di `_clock_pick_track`; nuovo `PATCH /api/admin/tracks/{id}/meta` (title/artist/kind). Nota: 04-06 suona solo `always` (NOTTE finisce alle 04 per specifica utente). Tracce già `day` ora suonano 06-19 (non più fino alle 22).
- Verifica: py_compile + ruff (solo warning preesistenti), webpack compilato, curl autenticato su slot/meta (200/400/401 corretti). Nessun test_agent/screenshot.

## v13.50 · LED WALL NEWS (2026-10-07)
- LedWall.js: `LedWallNewsTicker` — banda fissa in basso (32px, sfondo scuro, testo #39FF14 mono con glow, scorrimento continuo dx→sx, separatore •, loop). Si ferma prima dello spazio del marchio R-AI (stesso calcolo di drawRaiMark), z-40 sopra video/foto/effetti/orologio. Sparisce se la coda è vuota. Poll 15s su `GET /api/ledwall/news`, re-render solo se `version` cambia. Nessuna modifica a player/audio.
- Backend: collezione `ledwall_news` {id,text,order,active,source manual|ai,created_at,updated_at}. Pubblico `GET /api/ledwall/news`; Regia `GET/POST /api/admin/ledwall/news`, `PATCH/DELETE /{id}`, `PUT /reorder`, `GET /token?regenerate=`; ingest esterno `POST /api/ledwall/news/ingest` con header `X-LedWall-Token` (token salvato in `station.state.ledwall_news_token`). Nessuna IA collegata.
- Regia: `components/LedWallNewsPanel.js` nella banda LIVE COMMAND (sotto Go Live / Mini Preview): input, Aggiungi con conferma, lista con ▲▼, ON/OFF, elimina con conferma, badge fonte, box Endpoint esterno (URL/token mascherato/copia/rigenera con conferma).
- Verifica: py_compile/ruff ok, webpack ok (solo warning preesistenti), curl completo su tutti gli endpoint (add/reorder/toggle/delete/ingest 401/200/unauth 401). Dati di test rimossi.

## v13.51 · LED WALL NEWS · banda 56px, full-width in "logo", velocità+colore da Regia (2026-10-07)
- LedWall.js: banda 56px, testo 24px; con `effect==="logo"` niente spazio riservato al watermark (bordo a bordo); altri effetti invariati. Velocità/colore letti da `GET /api/ledwall/news.settings` (inclusi nella `version`) e cachati in localStorage `rai:ledwall:news:settings`. Helper rinominato `newsRgb` (riusa `hexToRgb` già esistente nel file).
- Backend: `station.state.ledwall_news_settings` {speed ∈ 40/55/70/100/140 px/s, color #RRGGBB}; `PUT /api/admin/ledwall/news/settings`; `GET /admin/ledwall/news` espone settings/speeds/defaults.
- Regia (LedWallNewsPanel): controlli VELOCITÀ −/+ (×0.6…×2.0) e COLORE TESTO (color picker + ↺ verde neon). Scelta utente: controlli solo in Regia, non sulla barra pubblica del LedWall.
- Verifica: py_compile/ruff ok, webpack ok (solo warning preesistenti), curl su settings (200/400/401).

## v13.52 · LED WALL NEWS · full-width anche in standby (2026-10-07)
- LedWall.js: `isStandbyMode` (detectMode === "standby", motori spenti → watermark non disegnato) → banda bordo a bordo come con effetto "logo" (`fullWidth` prop). Altri casi invariati.

## v13.53 · MODALITÀ DEMO (2026-10-07)
- `station.state.demo_mode` (bool) + `demo_every_min/max` (default 2–3). `GET/PUT /api/admin/demo-mode` (voices_available = segmenti con voce, kind ∈ talk/news/joke/interview/horoscope/motivation/history/answer; esclusi music/time_signal/ad_spot/jingle/weather).
- `_clock_pick_demo_voice`: $sample su db.segments, probe ffprobe (scarta file mancanti), item con kind "talk", `is_demo_voice`, id `demo-<seg>-<rand>`.
- `_clock_refill_queue`: blocco addizionale eseguito solo con demo ON (contatori `demo_counter`/`demo_target` nel clock, target random in [min,max]); demo_slot_filled gating su jingle/FX per evitare stacchi consecutivi. OFF → identico a prima; non tocca ai_speaker_enabled/ai_openai_talk/cadenze/time signal/player.
- Regia: `components/DemoModePanel.js` in LIVE COMMAND subito sotto AI Master Control, toggle grande "MODALITÀ DEMO — Usa vocali esistenti", campi min–max + SALVA.
- Verifica: compile/ruff ok, webpack ok, curl GET/PUT (200/400/401), picker in-process con 3 pick reali (durate ffprobe). Nessuna generazione. Demo lasciata OFF in preview.

## v13.54 · APPUNTAMENTO LIBERO (Smart Flow Timeline) (2026-10-09)
- Backend: `kind="appointment"`, blocco `appointment` (description, source disco_del_giorno|umani_vs_algoritmo|fixed, fixed_track_id, suno_genre/mood/lang, suno_lead_minutes, jingle_before/after, dj_present, dj_comment, max_duration_sec). Sentinel `appointment:live` accettato da POST /admin/timeline e /admin/timeline/rrule (tutti i campi rrule). Nessuna generazione alla creazione.
- `_timeline_pick_due`: `_appointment_resolve` → catena jingle prima → intro DJ (solo se ai_openai_talk ON, LLM+TTS strict, fallisce → saltata) → brano (cap max_duration) → jingle dopo → follow_ups; entry kind = primo elemento. `_appointment_suno_prepare` ad ogni tick: con ai_suno_engine ON + Suno configurato materializza in anticipo i figli rrule disco e lancia `generate_track` (1 per tick, claim atomico `suno_track_id`); all'orario usa il brano Suno se ready, altrimenti random tra ultimi 10 brani pronti. Community: random tra status on, esclusi is_night di giorno se esistono alternative, play_count++.
- `_rrule_materialize_due` refactor: loop body → `_rrule_materialize_template(tpl, from_dt, to_dt, now)` (comportamento invariato).
- Presets: `timeline_presets`, GET/POST/DELETE /admin/timeline/presets.
- Frontend: `components/AppuntamentoLiberoForm.js` in cima a SmartFlowTimelinePanel (form esistente intatto); KIND_LABEL/COLOR "✨ Appuntamento". Badge Suno/Voci DJ/Community.
- Verifica: compile/ruff, webpack ok, curl creazione singola/rrule/presets, in-process resolve fisso (catena+cap OK), prepare no-op con Suno OFF. Community non testabile in preview (0 brani). Nessuna chiamata Suno/LLM/TTS. Eventi test rimossi.

## v13.55 · SEGMENTI VOCALI DJ nel Magazzino (2026-10-10)
- Backend: `GET /admin/segments/voice` (filtri dj, kind, q su title/script/spoken_text, date_from/to, paginazione; facets djs/kinds), `GET /admin/segments/voice/duplicates` (gruppi per testo normalizzato via `_normalize_question`, voci diverse incluse), `PATCH /admin/segments/voice/{id}` (title/text → script+spoken_text), `POST .../{id}/audio` (upload mp3/wav/m4a/ogg → tts_dir `tts_user_*` + Object Storage `tts/`, probe durata, previous_speech_audio_url), `POST /admin/segments/voice/delete` {ids} (file locale rimosso solo se non referenziato; storage intatto), `POST .../{id}/copy-to-jingle` (Track is_jingle con lo stesso audio_url, source admin_upload — il Literal non ammette altri valori).
- Frontend: `components/VoiceSegmentsPanel.js`, tab "🗣️ Segmenti vocali DJ" in MagazzinoUniversale (normale + embedded). Ascolto, modifica, sostituisci, copia nei jingle, download, elimina singolo/multiplo con popup di conferma, vista doppioni con radio "tieni" per gruppo + elimina non scelti (confermato).
- Verifica: compile/ruff, webpack ok, curl completo con segmento di test (poi rimosso). In preview: 2160 segmenti, 73 gruppi doppioni / 275 in eccesso. Nessuna generazione audio.

## v13.56 · BED SOTTO LA VOCE lato server (2026-10-10)
- `_bed_for_speaker(dj_name)`: loop Magazzino/bed con loop_bind_speaker = DJ → bed attivo (`station.state.active_bed_url`) se universale o agganciato a quel DJ → None.
- `_bed_mix_voice(voice_url, bed_url)`: ffmpeg `-stream_loop -1` sul bed, volume 0.20, afade in 1s / out 1.5s, `sidechaincompress` (ducking sotto la voce), `amix duration=first normalize=0`, `-t` = durata voce (delta 0.000s). Output `static/bedmix/mix_<sha1>.mp3` + Object Storage `bedmix/`; rotta `GET /api/bedmix/{file}` (Range ok). Cache per coppia; lock per file; timeout 60s; qualunque errore → voce originale.
- `_bed_mix_item(item, dj_name)`: hook in `_clock_refill_queue` (turno DJ e turno Demo), `_timeline_pick_due` (eventi con dj_id, audio /api/tts|/api/audio, esclusi jingle/time_signal/ad/ad_break/appointment), `_appointment_resolve` (intro DJ). `duration_sec` invariato → sync/buffer/recovery player intatti. `is_dj_jingle` e item già mixati esclusi.
- `_audio_local_file(url)`: resolve locale + fetch da storage per /api/tts|suno_audio|community_audio|audio|beds|bedmix.
- Verifica in-process con voce reale + bed attivo preview: mix 1.0s, durata identica, cache hit, servito 200/206. Nota: molti vecchi tts dei segmenti non esistono né in locale né in storage (già scartati a monte dal probe).

## v13.57 · FASCE MULTIPLE + ORARIO PERSONALIZZATO (2026-10-10)
- Track: `broadcast_slots: [..]` (OR tra fasce) + `broadcast_custom: {from,to,from_min,to_min,wrap}` (si AGGIUNGE alle fasce, anche a cavallo di mezzanotte). Legacy `broadcast_slot` mantenuto allineato ("always" se presente, altrimenti prima fascia); lista vuota → ["always"].
- Endpoint: `PATCH /admin/tracks/{id}/broadcast-slot` accetta `slots` (lista), `slot` (legacy), `custom` ({from,to}|null); `PATCH /meta` accetta `broadcast_slots`, `broadcast_custom`. Searchable espone entrambi.
- Motore: `_broadcast_query(now_local)` sostituisce `_slot_q` in `_clock_pick_track` (query principale + fallback): nessuna info → ok · slots ∩ attive · legacy slot · custom (wrap/non-wrap). Verificato in-process su 8 orari con 6 tracce di prova (rimosse).
- Frontend Archivio: SlotPicker multi-toggle, chip "⏱ ORARIO" per riga con editor inline (dalle–alle, OK/rimuovi), EditPanel con fasce multiple + orario personalizzato (APPROVA E SALVA).

## v13.58 · SIGLE APPUNTAMENTI (is_appointment_jingle) (2026-10-10)
- Track flag `is_appointment_jingle`; upload `kind=appointment_jingle` (no contratto, `include_in_rotation=False`, is_jingle False); searchable kind "appointment_jingle"; meta kind ammesso (aggiorna include_in_rotation).
- Esclusa dalla rotazione: `_clock_pick_track` (query principale + fallback), Power Play fallback (12454), legacy palinsesto queries (3021/3039), `_APPT_MUSIC_FLAGS`. Non è `is_jingle` → mai nel picker jingle di rotazione.
- Frontend: `assetCategory` → "appointment_jingle", chip "SIGLE APPUNTAMENTI" in ASSET_CATEGORIES (Magazzino + AssetPicker Timeline pre/post-jingle e follow-up), TrackModal pulsante "✨ Sigla Appuntamenti", Archivio KINDS/filtro, AppuntamentoLiberoForm jingle picker include le sigle (in testa, prefisso ✨).
- Verifica: upload reale (poi rimossa), flags/kind corretti, 20 pick di rotazione senza la sigla, meta switch ok.

## v13.59 · Appuntamento Libero · campo LedWall (2026-10-11)
- `AppuntamentoLiberoForm.js`: select "🖥️ LedWall durante l'appuntamento" (nessuno / fx:effects / video da /admin/ledwall/videos) → `video_url` in POST /admin/timeline e /admin/timeline/rrule; incluso nei modelli (payload form). Nessuna modifica backend. Verificato via curl: video_url salvato su evento singolo e template rrule (poi rimossi).

## v13.60 · SOTTOFONDO CASUALE (2026-10-12)
- `station.state.bed_random_mode` + `bed_rotation_recent`; `GET/PATCH /admin/beds/random-mode`. `_bed_pick_random()`: loop Magazzino (is_loop, deleted_at None) senza ripetizioni finché il ciclo non è completo (poi riparte evitando l'ultimo). In `_bed_for_speaker`: loop agganciato allo speaker → (se ON) random → bed attivo. Pool vuoto → fallback bed attivo. OFF → identico a prima.
- Regia → Audio: toggle "🎲 Sottofondo casuale" con stato ON/OFF, pool e progresso ciclo. Verifica in-process con loop di prova (rimossi) e curl. Preview lasciata OFF.

## v13.61 · CONCATENA DOPO + PRIORITÀ (Appuntamenti) (2026-10-14)
- `appointment.chain_after` none|time_signal|any, `appointment.priority` 1-9 (default 5), salvati nei modelli (payload form).
- `_timeline_pick_due`: candidati dovuti ordinati con `_timeline_order_key` (scheduled_at al minuto, priority) + claim atomico per candidato; `_appointment_should_wait` rimanda un appuntamento chain se un evento compatibile (pending o occorrenza rrule) è atteso entro 15 min (CHAIN_WAIT_MINUTES); scaduta l'attesa parte da solo (stale check esteso a 10+15 min).
- `_attach_chained_appointments(doc, entry, now)`: dopo la promozione di qualunque evento, gli appuntamenti pending compatibili con orario in [ev−15min, ev] vengono claimati, risolti con `_appointment_resolve` e accodati dopo i follow_ups dell'evento (ordine minuto/priorità), `chained_after_event` sul doc.
- Frontend: select "⛓ Concatena dopo" + "Priorità" in AppuntamentoLiberoForm; badge ⛓ e P<n> in "Serie ricorrenti attive".
- Verifica in-process con eventi di prova (rimossi): wait/ordine/attach/scadenza corretti. Clock e player non toccati.

## v13.62 · DISCLAIMER CONTENUTI UTENTE (2026-10-15)
- `components/UserContentDisclaimer.js`: checkbox obbligatoria + testo (responsabilità utente, divieto contenuti offensivi/illegali/violazione diritti, R-A.I. non responsabile), `useUgcAccepted` persistente in sessionStorage `rai:ugc:accepted`.
- Applicato a: ChatMini (testo + vocale MicButton disabilitato finché non accettato), Advertise (/pubblicita form campagna), Partner (/partner upload spot). Submit (/submit Umani vs Algoritmo) aveva già la dichiarazione obbligatoria → non toccato. Senza spunta: pulsanti disabilitati + guard nel submit.

## v13.63 · PRE-SEGNALE ORARIO (2026-10-16)
- `station.state.time_signal_pre_audio` = {track_id,title,artist,audio_url,duration_sec} · endpoint Regia `GET/PUT/DELETE /api/admin/time-signal/pre-audio` (PUT body {track_id} dal Magazzino, qualsiasi categoria).
- Unico aggancio: `_timeline_pick_due` → `_ts_pre_audio_wrap(entry)` SOLO per eventi ora_esatta/time_signal con audio risolto: il pre-file diventa la entry promossa (kind=time_signal → LedWall orologio) e il segnale orario + i suoi follow-up (minuto, spot, appuntamenti) passano come follow_ups (zero-gap, stesso meccanismo ORA→MINUTO). Senza config → inerte. Logica TS/player//api/stream non toccati.
- UI: `PreTimeSignalBox` in `SmartFlowTimelinePanel.js` (visibile con kind=Segnale orario): stato, AssetPicker, Imposta/Sostituisci, Rimuovi con conferma. testid `ts-pre-audio-*`.
- Verifica: curl 401 unauth, GET/PUT/DELETE ok, 404 su track inesistente; test in-process wrap (ordine pre→TS→minuto→spot, inerte senza config). E2E su evento reale NON possibile in preview (nessun segnale orario permanente per l'ora corrente: evento saltato, pre-file correttamente NON inserito). Config di test rimossa: in preview nessun pre-file impostato.

## v13.64 · HOME REDESIGN (2026-10-16) — solo `PublicRadio.js` + CSS + export dialog in `ServicesDock.js`
- Layout: (1) HERO 100svh con LedWall come sfondo (fillHeight, effetti in **rotazione automatica** ogni 22s: gradient/rings/eq/starfield/holo/auto; select manuale conservato, default "rotate"), logo RaiOrbLogo centrato + firma L&C, frase d'impatto, SyncLivePlayer (play grande) + riga "In onda"; pulsante discreto **Schermo intero** (Fullscreen API nativa + fallback CSS fixed inset-0 per iOS, Wake Lock best-effort, Esc/`Esci` per uscire, donate nascosto in FS). (2) **Barra nav fissa in alto** (`.rai-topnav`): Home, Partner, Re-Play, Studios (dialog), Contatti (dialog), Sostieni, Regia + badge ON AIR/STANDBY; `ServicesDock` non montato (`{false && …}`), i suoi dialog esportati con prop `trigger`. (3) Sezione "In diretta ora": info essenziali + ChatMini + LiveBrain; poi Radioscopo, Team strip, Sponsor CTA. (4) **Rubriche**: CoverCard con TITOLO grande (rubrica) e sottotitolo piccolo; eyebrow spostato dentro il body. (5) **CTA finale PDF** placeholder (`cta-download-pdf` → toast "disponibile a breve"). Footer, donate modal invariati.
- Nessun componente eliminato; nessun backend/API/player toccato.
- Verifica: webpack ok (solo warning preesistenti); screenshot desktop+mobile; fullscreen open/exit testato su 390px e 1920px (nativo attivo, Esc chiude), select effetto persistente, dialog Contatti da nav, toast CTA. Bug trovato e corretto: il contenuto hero copriva i controlli LedWall (ora `pointer-events-none` sul layer testo, `auto` sui blocchi interattivi).
- Quando il PDF sarà disponibile: sostituire l'`onClick` del bottone con `<a href="/progetto.pdf" download>`.

## v13.65 · LIVE MODE Home (2026-10-16) — solo `PublicRadio.js` + CSS
- All'evento `rai:sync:play` (playing=true, emesso dal SyncLivePlayer al click "Entra in diretta") o al play legacy: `liveMode` ON → burst (flash + 2 onde d'urto + scritta "SEI DENTRO · R-A.I. LIVE"), scroll a top, vibrazione. LedWall `.rai-ledlayer`: in vetrina scala .94/angoli tondi/più scuro → in diretta scala 1, bordo a bordo, più luminoso (transizione .9s). Contenuto hero (logo/frase/player) svanisce ma resta montato (audio intatto). Veil off.
- Barra player fissa in basso (`live-bar`): play/stop (stop → `rai:sync:pause`, play → `rai:sync:skip` = riaggancio al clock; nessuna modifica a SyncLivePlayer), titolo/artista da `displayCurrent`, mute + slider volume (imposta `.volume` sull'`<audio data-testid="sync-live-audio">`, persistito in localStorage `rai:volume`, riapplicato dopo il fade-in del player), fullscreen LedWall, X "Esci dalla diretta" (ferma audio e torna alla vetrina).
- Nav in diretta: solo icone, h-11, auto-hide dopo 3s di inattività (pointermove/touch/scroll/key la fanno riapparire). Donate flottante nascosto in diretta (c'è "Sostieni" in nav). `onAir` ora include `syncPlaying` (badge ON AIR corretto).
- Verifica (screenshot 1920/390): bar visibile con titolo reale, nav hidden dopo idle e riapparsa al movimento, stop/play dalla barra (audio paused true/false), volume 0.4 applicato, exit → vetrina + audio fermo. Build ok con soli warning preesistenti.

## v13.66 · FULLSCREEN "stile YouTube" + barra sempre in overlay (2026-10-17) — solo `PublicRadio.js` + CSS
- `LiveBar` estratta come componente; in fullscreen è montata DENTRO il layer LedWall (`z-[120]`, il fullscreen nativo mostra solo quel sottoalbero), sempre visibile ancorata al bordo inferiore (safe-area), senza tasti fullscreen/X (c'è "Esci" in alto). Fuori dal fullscreen resta `fixed bottom-0 z-[55]` in modalità diretta.
- Layer fullscreen `.rai-fs-active`: 100vw × 100dvh (fallback iOS), LedWall/canvas/video forzati a inset 0 100%/100% + object-fit cover → nessuna banda nera né taglio.
- Verifica screenshot 390×844, 820×1180, 1920×800: wall rect = viewport, barra bottom = viewport height, `barInsideFs: true`; uscita riporta la barra fuori dal layer.

## v13.67 · STATO DIRETTA semplificato (2026-10-17) — sostituisce v13.65 (solo `PublicRadio.js`)
- VETRINA invariata. Al click "Entra in diretta": nessuna trasformazione/burst/scroll, parte solo l'audio. Cambia solo: il layer LedWall diventa cliccabile (`data-clickable`, cursor-pointer, role=button) → fullscreen; select effetto e tasto fullscreen fanno `stopPropagation`.
- Barra player SOLO dentro il fullscreen (`LiveBar inFullscreen`): titolo/artista, play/stop, mute+volume, tasto "Esci" dal fullscreen (`live-bar-exit-fullscreen`). Rimossi: liveMode, nav auto-hide/icone, burst, barra fuori dal fullscreen (CSS v13.65 lasciato, inerte).
- Mobile landscape: `onClickCapture` sul wrapper del player intercetta il click su `sync-live-toggle` nel gesto utente → `enterLedFs()` (fullscreen nativo consentito); inoltre `orientationchange` → landscape mentre suona → fullscreen (fallback CSS). Criterio: `(orientation: landscape)` e (`pointer: coarse` o innerHeight<500).
- Verifica 1920×800: dopo play hero intatto/scrollY 0/nessuna barra; click sul LedWall → fullscreen nativo con barra e titolo reale; "Esci" dalla barra chiude FS senza fermare l'audio; select non apre FS. 844×390: auto-fullscreen al click su Entra in diretta.

## v13.68 · DUE STATI HOME: VETRINA + CONSOLLE RIPRISTINATA (2026-10-17) — solo `PublicRadio.js` + CSS
- Root unico `.rai-home[data-home-state=vetrina|diretta]`. VETRINA (prima del play) invariata. DIRETTA = consolle precedente ripristinata VERBATIM dal commit `4de1250` (header glass + ServicesDock + griglia player/LedWall/info + LiveBrain + Radioscopo + team + sponsor + rubriche + wall + footer + donate). Zero animazioni/scroll.
- **SyncLivePlayer montato una sola volta** in un host stabile (`sync-player-host`, wrapper `display:contents` come primo figlio del root); `useLayoutEffect` sposta il nodo DOM nello slot attivo (`vetrina-player-slot` / `console-player-slot`) → l'elemento `<audio>` è lo stesso prima/dopo il cambio stato (verificato: `same: true`, `paused: false`). `onClickCapture` sul wrapper host intercetta "Entra in diretta" per l'auto-fullscreen su mobile orizzontale (`enterLedFs` ora usa `flushSync` per montare il layer FS nel gesto utente).
- **Fullscreen = layer unico a livello root** (`home-ledwall-fs`, montato solo quando `ledFs`; i LedWall inline non vengono renderizzati mentre è aperto). Controlli (select effetto `ledwall-fs-effect-select`, "Esci") visibili solo al tocco/pointermove e nascosti dopo 3s (`data-controls-visible`). Info brano (`fs-track-info`) al centro ad ogni cambio titolo/artista, sparisce dopo 4.5s. Nessun overlay permanente in diretta; la `LiveBar` resta solo nel FS pre-play (vetrina).
- Consolle: colonna LedWall cliccabile → fullscreen (select con stopPropagation). Ogni ingresso in diretta → `setLedEffect("logo")`.
- Verifica 1920×800 e 844×390: flusso vetrina→play→consolle (audio continuo, effetto logo, scrollY 0), click LedWall→FS nativo, controlli nascosti dopo idle e riapparsi al movimento, info brano scomparsa, Esci, stop→vetrina con stesso audio element; mobile landscape auto-FS al play.

## v13.69 · DISCO DEL GIORNO in home (2026-10-18)
- Backend (approvato dall'utente): `GET /api/power-play/today` pubblico read-only → `{date, track:{id,title,artist,image_url}|null}`; riusa `_power_play_get_today()` (stesso dato della Regia, `power_play_daily`), nessuna generazione lazy, nessuna logica palinsesto toccata.
- Frontend `PublicRadio.js`: stato `discoDelGiorno` (poll 120s), componente `DiscoDelGiornoBadge` (`disco-del-giorno-badge/-title/-artist`), mostrato in VETRINA sotto il player nel hero e in DIRETTA nella colonna info della consolle sopra "A seguire". Se `track` è null non viene renderizzato nulla. Fix: aggiunto import `api` da `@/lib/api`.
- Verificato: endpoint 200 con il PP di oggi; badge visibile in entrambi gli stati.

## v13.70 · REGIA: "COMANDI IN ALTO" + Dual Brain in AI Master (2026-10-18) — solo UI
- `Dashboard.js`: prima sezione rinominata **COMANDI IN ALTO** (testid `band-live-command` invariato). Dopo le griglie Live Command, nuova griglia `band-top-commands` con: `LiveExternalPanel` (Pilota AI / Broadcaster esterno, da NIGHT & LIVE SOURCES), `ManualModePanel` (Trasmissione manuale, da NIGHT), blocco Control Room "Pilota la webradio AI" (toggle stazione + generatori, da SECONDARY), `KillSwitchPanel` (Automazione attiva, da SECONDARY). Sottotitoli NIGHT/SECONDARY aggiornati. Nessun endpoint/testid/logica modificato.
- Dual-Brain (Leo vs Max): stato + `genDualBrain`/`injectDual` + JSX spostati da `BroadcasterPanel.js` (ora solo HLS + Icecast) a `AIMasterControlPanel.js` (blocco in fondo). Stessi endpoint `dualBrainGenerate/dualBrainInject` e testid `dual-brain-*`.
- Verifica: webpack compilato (solo warning preesistente), eslint ok. Zero screenshot (regola utente dal 2026-10-18: solo compile/build/curl/in-process).

## v13.71 · REGIA: Coda di approvazione in Ad Manager + Vocali ascoltatori unificati (2026-10-18) — solo UI
- `AdManagerPanel` accetta `children`; Dashboard monta `<AdManagerPanel><ApprovalQueuePanel embedded /></AdManagerPanel>` in WAREHOUSE & ASSETS. `ApprovalQueuePanel({embedded})` → variante annidata (stesso testid `approval-queue-panel`, stessi endpoint). Rimosso dalla banda COMMUNITY.
- Vocali ascoltatori: unico pannello = `VoiceQueuePanel` (COMMUNITY & PARTNERS, titolo "Vocali ascoltatori · pannello unico"). Il cassetto duplicato "🎙️ Vocali" del Magazzino (lista read-only della stessa `/admin/voice-queue`) è nascosto via filtro tabs (codice/stato conservati). Label Archivio/band aggiornate ("Segmenti vocali DJ" resta: è altra cosa, voci DJ).
- Verifica: webpack ok (warning preesistente). Zero screenshot.

## v13.72 · A.I. vs Umani — rimosso upload jingle pre/post dall'UI (2026-10-18)
- `Dashboard.js` CommunityPanel: eliminato solo il blocco JSX "Upload jingles" (APERTURA / CTA FINALE). Frequenza, stato contatore e tabella brani invariati. `cfg.intro/outro_jingle_url`, `uploadJingle`, `endpoints.communityUploadJingle` e backend intatti (nessun dato/endpoint toccato).
- Verifica: webpack ok (warning preesistente).

## v13.73 · InOverride LedWall (GoLivePanel) rinnovato (2026-10-18)
- Backend (approvato: opzione a + set_at): `/admin/ledwall/upload-video` accetta anche jpg/jpeg/png/gif/webp (mime image/*, niente transcodifica), `/ledwall_video/{filename}` serve il mime immagine corretto, `/ledwall/state` espone `set_at` dell'override. Nessun'altra logica toccata.
- `LedWall.js`: `isImageUrl()` → un override `video_source=video` con URL immagine è reso come foto full-screen (blocco Ken Burns esistente) invece di un `<video>` nero. `LedWallMiniPreview` idem.
- `GoLivePanel` (CommandCenter2Panels.js): upload video+foto nel pannello (stessa libreria `ledwall_videos`), lista con thumbnail ordinata per `uploaded_at` desc, selezione → monitor PREVIEW, "▶ MANDA IN DIRETTA" (override permanente; video in loop già nel LedWall), "⏹ RIMUOVI OVERRIDE" separato con conferma inline, indicatore di stato sempre visibile (thumb, nome, tipo foto/video/stream, "da Xs/min" da `set_at`, evento automatico se `from_event`). URL cam/stream invariato. testid: `go-live-upload-input`, `go-live-media-<id>`, `go-live-preview`, `go-live-send`, `go-live-clear`, `go-live-clear-yes/no`, `go-live-status-*`.
- Verifica curl: upload png → mime image/png, servito 200 image/png, estensione sconosciuta 415, override+state con `set_at`, lista ordinata (recenti in cima), delete con storage_removed. ATTENZIONE: il test ha temporaneamente rimosso l'override preesistente in preview (video ledwall_0aefd18e8ec4.mp4) → ripristinato subito dopo (set_at nuovo).

## v13.74 · Badge Disco del Giorno → appuntamento Timeline (2026-10-19)
- Nuovo endpoint pubblico read-only `GET /api/appointments/disco-del-giorno/today`: eventi `kind=appointment` con `appointment.source=disco_del_giorno` o titolo ~ "disco del giorno", giornata Rome. Priorità: (1) già trasmesso oggi → `appointment_resolution.track` (`status: aired`); (2) occorrenza pending di oggi con brano fisso → `scheduled`; (3) template rrule con occorrenza oggi e brano fisso → `scheduled`; altrimenti `none`/track null. Power Play, palinsesto, player, appuntamenti non toccati (`/power-play/today` resta disponibile ma non più usato dalla home).
- `PublicRadio.js`: badge legge il nuovo endpoint; mostra titolo/artista + "trasmesso oggi" o "alle HH:MM". Nascosto se `track` null.
- Test in-process con eventi temporanei (rimossi): none → scheduled da template → aired vince → aired di ieri ignorato. In preview oggi nessun appuntamento DdG → badge nascosto (corretto).

## v13.75 · Copertina/Video per brano sul LedWall (2026-10-19)
- Dati: `Track.cover_url`, `Track.video_url` opzionali. `PATCH /admin/tracks/{id}/meta` accetta/rimuove (null) entrambi; `POST /admin/tracks/upload` form `cover_url`/`video_url` (new + replace); `/admin/tracks/searchable` li espone. `/admin/ledwall/upload-video`: immagini max 10 MB (413), video max 200 MB (già).
- `/ledwall/state`: nuovo livello 2b "brano in onda" (lookup read-only `tracks[cur.id]`, solo se non `is_timeline`): `video_url` → `video_source=video` loop muto; solo `cover_url` → `video_source=photo` (Ken Burns LedWall). Precedenza finale (scelta b, non cambia l'esistente): evento con video > override Regia > **brano** > palinsesto > default > effetti. Il cambio brano è automatico (LedWall polla ogni 8 s, segue il clock). Clock/coda/player/palinsesto non toccati.
- UI: nuovo `components/CoverVideoPicker.js` (per campo: anteprima + Rimuovi, Carica nuovo con validazione tipo/dimensione, "Scegli tra i caricati" = vetrina orizzontale dalla libreria LedWall filtrata immagini/video). Montato in `ArchivioControlloTotale` EditPanel (salvato con APPROVA E SALVA via meta) e in `TrackModal` (Dashboard, AGGIUNGI NUOVO). `LedWallMiniPreview` mostra anche `photo`.
- Verifica: curl meta set/remove + searchable, 413 immagine >10MB; in-process `get_ledwall_state()` con cover/video temporanei sul brano corrente (ripristinato) → photo/video from_track; build ok.

## v13.76 · LedWall fluido "TV" (2026-10-20) — solo `LedWall.js` (+ prop `nowInfo` da PublicRadio)
- (1) Layer media (video/cam/foto) gestiti come lista `mediaLayers` con crossfade 1.2s (il layer uscente resta montato ~1.3s a opacità 0); cambio effetto → velo nero `ledwall-fx-veil` (in 0.45s / out 0.9s) invece del taglio secco. (5) Senza media del brano: solo FX con dissolvenza tra effetti.
- (2) Copertine: `object-contain` con Ken Burns "soft" `kenburnsSoft` (scala 0.72 → 0.88 in 48s alternato) sopra una copia sfocata/scurita della stessa immagine come backdrop (niente bande piatte).
- (3) Titolo+artista = overlay DOM `ledwall-track-title` (z-35, sopra i media) visibile nei primi 6.5s e negli ultimi 6.5s del brano, fade 0.9s; fasi calcolate da `nowInfo` (`offset_sec` + tempo dal poll, `duration_sec`). Il titolo canvas resta solo come fallback quando `nowInfo` è assente (Dashboard mini). Solo brani non timeline con durata >30s.
- (4) Interludio FX: se il brano ha media proprio (`from_track`) e dura ≥90s, a metà brano il layer media sfuma (1.2s) per 26s mostrando l'FX attivo, poi rientra.
- `PublicRadio.js`: `nowInfo={timelineNow}` sui 3 LedWall (vetrina, consolle, fullscreen). Backend/player/coda/palinsesto non toccati. Verifica: webpack + eslint ok (zero screenshot).
