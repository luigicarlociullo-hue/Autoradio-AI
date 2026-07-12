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

## What's implemented (2026-07-12)
- Public listener page `/`, admin `/dashboard`, HD open-source audio mode (Bark + Stable Audio Open), Emergent Google Auth, multi-LLM (GPT-5.2, Claude Sonnet 4.5, Gemini 3 Flash).
- **Monetization via PayPal ads** (2026-07-12):
  - Public page `/pubblicita` with 3 tiers (Basic 4,99€ / Standard 14,99€ / Premium 39,99€), advertiser form, PayPal checkout redirect.
  - `/ads/return` handles PayPal callback, captures payment, calls LLM for ad copy, generates real Bark audio, activates campaign.
  - Backend `paypal_service.py` with **three modes**: `live`, `sandbox`, `demo`. Demo mode active by default (empty PAYPAL_CLIENT_ID) so the whole flow can be tested without a Business account.
  - Ad campaigns auto-rotate into the segment loop (~22% of unqualified segments become paid spots) until `plays_remaining` reaches 0.
  - Admin dashboard shows revenue KPI, live campaign list with inline audio preview, "quick-create" button.
  - Endpoints: `GET /api/ads/tiers`, `POST /api/ads/create`, `POST /api/ads/{id}/confirm`, `GET /api/ads`, `GET /api/ads/next`, `POST /api/ads/{id}/mark_played`, `GET /api/ads/revenue`.

## Deferred / Backlog (P1 / P2)
- P1 — Upgrade PayPal from `demo` to `sandbox` (user creates dev app on developer.paypal.com — free, no Business account required) then to `live` (requires Business upgrade).
- P1 — PayPal webhook `/api/webhooks/paypal` for asynchronous events (refunds, disputes).
- P1 — Pre-render HD segments in background.
- P1 — Suno / ElevenLabs premium swap-in.
- P1 — Telegram bot ingestion (`/api/questions?source=telegram`).
- P1 — Twilio SMS + voice call ingestion.
- P2 — Ad performance analytics per campaign (plays served, timestamp history).
- P2 — Real streaming audio pipeline (HLS/Icecast).

## Next tasks
1. When user provides Suno API key → wire real music generation via `/api/tracks/generate` (backend already returns metadata compatible with Suno).
2. When user provides ElevenLabs key → add server-side TTS endpoint and use returned MP3 URL in the front-end player.
3. Add Telegram bot service listening for messages, POST to `/api/questions`.
4. Add Twilio inbound webhook.
