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

## What's implemented (2026-07-14 · v6)
- Public listener page `/`, admin `/dashboard`, HD open-source audio mode (Bark + Stable Audio Open), Emergent Google Auth, multi-LLM (GPT-5.2, Claude Sonnet 4.5, Gemini 3 Flash).
- **Monetization via PayPal ads**: 3 tier, demo/sandbox/live modes.
- **Prefetch pipeline** `hd=true` + Telegram Bot long-poller + Ad play analytics.
- **v4 Roster expansion**: 10 DJ AI + 6 new segment kinds.
- **v5 Audio Visualizer**: canvas radial spectrum + orb + waveform ring.
- **v6 Logo Watermark** (2026-07-14):
  - `LogoWatermark.js` component with static `NEURA` text + `FM` orbiting in elliptical path (CSS keyframes, 3.2s cycle, scale 0.86→1.12 to fake 3D depth), pink neural pulse dot, cyan dashed ellipse guide.
  - Placed **top-right of the visualizer** (TV channel bug style, size 1.15, opacity 0.92).
  - **Global fixed watermark bottom-right** visible on every route (public radio, dashboard, advertise, ad return) — brands all content permanently.
  - YouTube URL wired to `REACT_APP_YOUTUBE_URL=https://youtube.com/@neurafm`; clicking the visualizer opens the channel in a new tab.

## Deferred / Backlog (P1 / P2)
- P1 — Suno API integration (attende chiave sunoapi.org)
- P1 — PayPal Sandbox/Live keys, Telegram bot token
- P1 — Webhook PayPal refund/dispute
- P1 — Groq/Cerebras free LLM providers
- P2 — Twilio SMS + voice call
- P2 — Streaming pipeline HLS/Icecast
- P2 — Widget embed `/embed`
- P2 — DJ leaderboard con like ❤️
- P2 — "Cattura clip 15s" per condivisione TikTok/Reels/Shorts

## Next tasks
1. When user provides Suno API key → wire real music generation via `/api/tracks/generate` (backend already returns metadata compatible with Suno).
2. When user provides ElevenLabs key → add server-side TTS endpoint and use returned MP3 URL in the front-end player.
3. Add Telegram bot service listening for messages, POST to `/api/questions`.
4. Add Twilio inbound webhook.
