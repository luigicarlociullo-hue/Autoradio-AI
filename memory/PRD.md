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

## What's implemented (2026-07-11)
- Public listener page `/` with hero, live player, DJ roster, timeline, question form.
- Admin dashboard `/dashboard` with station toggle, KPI, LLM orchestration chart, DJ CRUD, track library, question queue with in-diretta answer generation.
- Backend endpoints: `/api/station`, `/api/station/toggle`, `/api/djs` (CRUD), `/api/segments/generate` (music/talk/news/answer), `/api/segments/{id}/render_hd`, `/api/audio/{filename}`, `/api/tracks/generate`, `/api/questions`, `/api/analytics`, `/api/auth/{session,me,logout}`.
- Multi-LLM roster: each DJ persona bound to a different provider; segment generation dispatches to that DJ's LLM.
- Fallback scripts (Italian) if LLM budget is exhausted, so radio never goes silent.
- **HD open-source audio mode** (2026-07-12): toggling "HD" in the player calls Bark (Suno OSS, Italian speakers) for TTS and Stable Audio Open (Stability AI OSS) for music, via HuggingFace Gradio Spaces free tier. Non-HD mode still uses browser Web Speech / Web Audio for instant playback.
- Emergent Google Auth wiring (session-cookie based).

## Deferred / Backlog (P1 / P2)
- P1 — Pre-render HD segments in the background so listeners don't wait 20–35s per segment.
- P1 — Suno / ElevenLabs premium swap-in when the user provides paid keys.
- P1 — Telegram bot ingestion (`/api/questions?source=telegram`).
- P1 — Twilio SMS + voice call ingestion.
- P2 — Real streaming audio pipeline (HLS/Icecast) so listeners hear the same stream in sync.
- P2 — Scheduler / crontab palinsesto (programmed segments).
- P2 — Multi-channel (news channel, chill channel).
- P2 — Playlist history + skip/like buttons + analytics per DJ.

## Next tasks
1. When user provides Suno API key → wire real music generation via `/api/tracks/generate` (backend already returns metadata compatible with Suno).
2. When user provides ElevenLabs key → add server-side TTS endpoint and use returned MP3 URL in the front-end player.
3. Add Telegram bot service listening for messages, POST to `/api/questions`.
4. Add Twilio inbound webhook.
