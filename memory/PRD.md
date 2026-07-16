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
