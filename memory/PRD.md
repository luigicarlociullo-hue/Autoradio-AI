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

## What's implemented (2026-07-14 · v5)
- Public listener page `/`, admin `/dashboard`, HD open-source audio mode (Bark + Stable Audio Open), Emergent Google Auth, multi-LLM (GPT-5.2, Claude Sonnet 4.5, Gemini 3 Flash).
- **Monetization via PayPal ads**: 3 tier, demo/sandbox/live modes, auto-rotation in segment loop, admin dashboard with revenue KPI.
- **Prefetch pipeline** `hd=true` + Telegram Bot long-poller + Ad play analytics (24h hourly bar chart).
- **v4 Roster expansion**: 10 DJ AI, 6 new segment kinds (weather, horoscope, history, interview, motivation, joke).
- **v5 Audio Visualizer** (2026-07-14): canvas-based reactive visual on the home page.
  - Uses AudioContext `AnalyserNode` (fftSize 512) sitting on a shared audio bus.
  - Procedural music, HD Bark/Stable Audio (via `MediaElementAudioSourceNode`), and simulated Web Speech signals all feed the analyser.
  - Renders: rotating radial spectrum (96 bars, hue-mapped to segment kind), pulsing pink/purple orb, waveform ring (cyan, time-domain), motion trails, grain overlay.
  - **Clickable**: opens `REACT_APP_YOUTUBE_URL` (currently empty; toast placeholder shown). Add YouTube URL later without code changes.
  - Hover reveals "Guarda anche su YouTube" CTA with YouTube icon.

## Deferred / Backlog (P1 / P2)
- P1 — Utente collega URL YouTube reale in `REACT_APP_YOUTUBE_URL`
- P1 — Suno API integration (attende chiave sunoapi.org)
- P1 — PayPal Sandbox/Live keys, Telegram bot token
- P1 — Webhook PayPal refund/dispute
- P1 — Groq/Cerebras integration per 4°/5° LLM provider gratuito
- P2 — Twilio SMS + voice call
- P2 — Streaming pipeline HLS/Icecast (ascoltatori sincronizzati)
- P2 — Widget embed `/embed`
- P2 — DJ leaderboard con like ❤️ (fidelizzazione ascoltatori)

## Next tasks
1. When user provides Suno API key → wire real music generation via `/api/tracks/generate` (backend already returns metadata compatible with Suno).
2. When user provides ElevenLabs key → add server-side TTS endpoint and use returned MP3 URL in the front-end player.
3. Add Telegram bot service listening for messages, POST to `/api/questions`.
4. Add Twilio inbound webhook.
