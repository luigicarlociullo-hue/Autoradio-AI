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

## What's implemented (2026-07-12 · v3)
- Public listener page `/`, admin `/dashboard`, HD open-source audio mode (Bark + Stable Audio Open), Emergent Google Auth, multi-LLM (GPT-5.2, Claude Sonnet 4.5, Gemini 3 Flash).
- **Monetization via PayPal ads**: 3 tier, demo/sandbox/live modes, auto-rotation in segment loop, admin dashboard with revenue KPI.
- **Prefetch pipeline** (2026-07-12): `POST /api/segments/generate?hd=true` renders speech+music inline; the frontend keeps one segment ready ahead of playback (zero latency in HD mode after the first).
- **Telegram Bot** (2026-07-12): `telegram_bot.py` long-poller starts automatically if `TELEGRAM_BOT_TOKEN` is set. Ascoltatori scrivono al bot → domande entrano nella coda con `source=telegram`. Endpoint `GET /api/telegram/status`. Admin panel shows enable/disable status.
- **Ad play analytics** (2026-07-12): `ad_plays` collection logs every airing; endpoint `GET /api/ads/{id}/plays` returns hourly and daily aggregates + recent 20 events; dashboard shows mini bar chart per campaign.

## Deferred / Backlog (P1 / P2)
- P1 — PayPal Sandbox / Live keys from user
- P1 — PayPal webhook `/api/webhooks/paypal` (refunds, disputes)
- P1 — Telegram bot token from user
- P1 — Suno / ElevenLabs premium swap-in
- P1 — Twilio SMS + voice call ingestion
- P2 — Dynamic pricing (auto-raise tiers when listener count > threshold)
- P2 — Real streaming audio pipeline (HLS/Icecast)
- P2 — Scheduler / crontab palinsesto

## Next tasks
1. When user provides Suno API key → wire real music generation via `/api/tracks/generate` (backend already returns metadata compatible with Suno).
2. When user provides ElevenLabs key → add server-side TTS endpoint and use returned MP3 URL in the front-end player.
3. Add Telegram bot service listening for messages, POST to `/api/questions`.
4. Add Twilio inbound webhook.
