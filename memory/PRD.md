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

## What's implemented (2026-07-14 · v4 · expansion)
- Public listener page `/`, admin `/dashboard`, HD open-source audio mode (Bark + Stable Audio Open), Emergent Google Auth, multi-LLM (GPT-5.2, Claude Sonnet 4.5, Gemini 3 Flash).
- **Monetization via PayPal ads**: 3 tier, demo/sandbox/live modes, auto-rotation in segment loop, admin dashboard with revenue KPI.
- **Prefetch pipeline**: `hd=true` inline render + frontend prefetches next segment during playback.
- **Telegram Bot** long-poll worker (starts if `TELEGRAM_BOT_TOKEN` set).
- **Ad play analytics** with 24h hourly bar chart per campaign.
- **Roster expansion (v4)**: 10 DJ AI (Nova Prime, Echo Sinclair, Zeta Kwon, Loop Cassini, Aria Selva, Byte Rovelli, Luna Corsari, Vico Antares, Mira Volante, Draco Ferri) — each with distinct personality, dedicated LLM and Bark voice (10 IT speakers used).
- **6 new segment kinds**: `weather` (meteo poetico), `horoscope` (oroscopo del giorno), `history` (accaduto oggi), `interview` (dialogo LIVE tra due DJ diversi), `motivation` (pillola motivazionale), `joke` (battuta breve). Weighted random rotation in the palinsesto.
- Segment quick-generate buttons: Talk / Musica / News / Dialogo / Oroscopo / Storia / Meteo / Battuta / Motivazione.
- Dropdown 10 voci Bark disponibili nel form nuovo DJ.

## Deferred / Backlog (P1 / P2)
- P1 — Suno API integration (aspetta chiave sunoapi.org da utente) per musica vera pop/dance/hip-hop
- P1 — PayPal Sandbox/Live keys, Telegram bot token
- P1 — PayPal webhook per refund/dispute
- P1 — Groq/Cerebras integration per aggiungere 4° e 5° LLM provider gratuiti
- P2 — Twilio SMS + voice call
- P2 — Real streaming pipeline (HLS/Icecast) per ascoltatori sincronizzati
- P2 — Scheduler orario ("ogni ora, il TG delle 18")
- P2 — Widget embed `/embed` per distribuzione virale

## Next tasks
1. When user provides Suno API key → wire real music generation via `/api/tracks/generate` (backend already returns metadata compatible with Suno).
2. When user provides ElevenLabs key → add server-side TTS endpoint and use returned MP3 URL in the front-end player.
3. Add Telegram bot service listening for messages, POST to `/api/questions`.
4. Add Twilio inbound webhook.
