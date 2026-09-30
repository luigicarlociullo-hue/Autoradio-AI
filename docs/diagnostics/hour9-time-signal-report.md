# Issue E - 07:00 UTC (Italian hour 9) time signal aired as silence

Read-only code investigation. All line numbers refer to /diag-wt/backend/server.py as it is in the worktree
(chore/diagnostics; the tree is committed, so numbers match this commit and may differ from main).
FACT = read in code. HYP = hypothesis, not verified. Nothing was run against production.

## 0. Timezone: which UTC hour is Italian 9
- FACT: everything is converted with `datetime.now(ZoneInfo("Europe/Rome"))` (server.py:6223-6225 resolver, 3101-3105 legacy generate_segment, 10733-10734 pregen). Rome hour = `_it_now.hour`, so DST is handled by zoneinfo.
- Europe/Rome is CEST (UTC+2) until Sun 25 Oct 2026 (03:00 local -> 02:00), then CET (UTC+1). So Italian 9 = 07:00 UTC now (30 Sep 2026, and all September) and = 08:00 UTC from 25 Oct. The 07:00 UTC report is consistent with CEST.
- FACT: rrule templates and timeline `scheduled_at` are UTC (`_rrule_expand` server.py:6985+, `start_hour` iterated on UTC days). A timeline `time_signal` rule that is set to "start_hour 7" fires at 07:00 UTC = 09:00 CEST, but after 25 Oct it fires at 08:00 Rome. The AUDIO is re-resolved at pick time from the real Rome hour (6497), so audio hour stays right; only the scheduled moment drifts (not the cause of silence).
- Pre-generator: `time_signal_cache` key = Rome "YYYY-MM-DD HH" of the UPCOMING hour (10737-10738); permanent key = int hour 0-23 (6229, 10741).

## 1. How the audio is chosen / generated / stored
Collections:
- `time_signal_permanent`: `_id` = Rome hour int 0-23. Fields: hour, script, speech_audio_url, voice_key, dj_id, dj_name, created_at, validated, validated_at, bytes, duration_sec, max_volume_db (6404-6421). Written only by POST /api/admin/time-signal/generate-permanent (6351+). Text is fixed: `Sono le HH:00 su R-A.I. Radio!` (6385).
- `time_signal_cache`: `_id` = "YYYY-MM-DD HH" (Rome). Fields script, speech_audio_url, created_at. Written only by `_time_signal_pregenerator` (10779-10786). NO validation there (10777-10788: only `if fn:`).
- Also read by: arming endpoints /admin/timeline/ora-esatta (5540: takes the newest `_id` with any audio, i.e. maybe another hour) and POST /admin/timeline kind=time_signal (6698: same "latest _id" lookup). These freeze a possibly wrong-hour URL into the event `audio_url`; it is overwritten at pick time only if the resolver finds something (see below).
- Legacy path generate_segment (3116): `find_one_and_delete` on cache by current-hour key, else sync LLM/TTS.

Resolver `_resolve_current_hour_time_signal` (6208-6244), precedence:
1. permanent[Rome hour] if it has `speech_audio_url`:
   - `validated is False` -> NOT served, reason stored (6231-6232).
   - `validated` True -> served.
   - field absent (legacy doc created before v13.47) -> served with a WARNING "permanente NON validato" (6234-6236).
2. else `time_signal_cache[current "YYYY-MM-DD HH"]` if it has a url (6238-6241) - never validated.
3. else `logger.error("[time-signal] NESSUN AUDIO per ora Rome HH ...")` and return None (6242-6244).
Note the resolver only checks the DB field, NOT that the file exists or is non-silent (see 2). Permanent wins over cache; a `validated=False` permanent falls through to the cache.

Pregen only runs if `BACKGROUND_TASKS_ENABLED=true` (10582, 10608-10615) AND `ai_openai_talk` ON (10726-10730), and skips if a permanent doc exists for the hour (10741-10742), even if that permanent is validated=False or stale (HYP relevant: for a bad permanent of hour 9 the pregen will NOT create a replacement, so fallback #2 is empty).

## 2. Missing / zero-byte / silent file: where is validation done
- Generation time (permanent): YES. `_validate_audio_url` -> `_validate_audio_file` (6262-6302, `_TS_SILENCE_MAX_DB=-50`, 6249): bytes>0 (6266-6273), ffprobe duration>0 (6277-6286), volumedetect peak >= -50 dB (6287-6301). Invalid -> not saved (6397-6403). It falls back to object storage copy when the local file is absent (6311-6317).
- Generation time (cache via pregen, 10777-10788): NO validation.
- Pick time (`_timeline_pick_due` 6496-6507 and resolver): NO file check. The resolver returns the URL string. Only DB-flag `validated is False` is honoured. A permanent written before v13.47 (no `validated` key), or one whose file was later deleted/replaced/truncated, is served as-is. Only `GET /api/admin/time-signal/verify` (6330-6348) re-validates on disk/storage, and only on demand (read-only; no scheduled job calls it).
- After the resolver, pick time calls `_probe_tts_duration(url)` for kind time_signal only, not ora_esatta (6500-6503; impl 7258-7305). FACT: it only checks LOCAL disk (`path.exists()`), it has NO object-storage fallback, and returns None if missing. On None the event keeps `doc["duration_sec"]` (frozen value from arming; template default 30 s, 7150 rrule template and 6668 timeline create `int(payload.get("duration_sec") or 30)`, ora_esatta default 12 at 5571) padded by `_pad_short` (6171-6175, applied at 6514). So with a missing local file (typical on a fresh pod when USE_OBJECT_STORAGE serves lazily) the entry still goes on air for 12-30 s +1.5 s.
- What is served then: HLS playlist (5887-5983) emits the URL; `/api/tts/{filename}` (4062-4089) serves local, else streams from object storage, else HTTP 404. So:
  * file missing everywhere -> segment 404 for the whole declared duration = audible silence/hls error, then clock advances normally (no fallback, no skip). Nothing in the server notices.
  * zero-byte file (if it slipped in) -> 200 with empty body, same silence.
  * silent-but-valid mp3 (legacy/unvalidated or cache doc) -> plays silence for its duration.
- Fallback when resolver returns None: for kind time_signal/ora_esatta with a frozen `audio_url` the code logs `uso audio_url congelato come fallback` (6506-6507) and plays the frozen URL (which may be a different hour's file or a marker); if frozen is "time_signal:live" it is set None (6504-6505) -> `skipped_no_audio` status set (6583-6586) and `_timeline_pick_due` returns None -> promote falls to the next queue item (`promo = q.pop(0)` 8228). So "no audio at all" -> next queue item, not silence. But "audio URL exists yet file bad" -> silence, no fallback. The customer report (silence, not a skipped signal) fits the second case, HYP.
- Frontend: the public player is HLS; the clock entry is played from the manifest. The older radioEngine (`frontend/src/lib/radioEngine.js:593` `onerror -> resolve()`, 830, 859) swallows 404/errors and moves on; it does not choose time signals itself. No client-side time-signal selection found (grep in frontend/src: only labels/colors in LedWall, AdminCalendar, PublicRadio, LiveBrain).

## 3. Could `_is_expired` / promote claim skip or lose it
Promotion flow `_clock_promote_inner` (8157-8323):
- Trigger: `force or _is_expired(current)` (8193). `_is_expired` (8165-8188): no started_at/unparseable -> expired; duration_sec missing/<=0 -> expired immediately (logged `[clock] current id=... duration_sec=... trattato come scaduto`, 8181-8187); else `now-started >= duration_sec`. So an item with a wrong/short `duration_sec` ends early. Not a cause of a *skipped* signal by itself, but it shortens: a time-signal entry whose declared duration is short (padded probe result) would be cut.
- Timeline is checked BEFORE the queue every time the current expires (8224), so a due signal waits for the current song to end (soft-sync, max song length delay), never dropped by time. `_timeline_pick_due` window: `scheduled_at <= now` and `>= now-2h` (6444-6450). An event older than 2 h stays pending forever (never picked, never marked) - if the pod/leader was down >2h across 07:00 UTC it is silently missed (HYP, low likelihood).
- There is no grace/duration window on the event itself: once due it is consumed at the first promote after the current item ends. `status='consumed'` is set atomically in the pick (6447-6454) BEFORE audio resolution, BEFORE the clock write. Consequences (FACT from ordering):
  * exception/kill between pick (8224) and final write (8300-8306) -> event consumed but never on air (no rollback).
  * `audio_url` empty -> status `skipped_no_audio`, event lost for good (6583-6586); ad_break without spots -> `skipped_no_ads` (6556-6562).
  * If final CAS fails 4 times: `promote CAS fallito dopo 4 tentativi - promozione scartata` (ERROR, 8321-8322): the consumed event is discarded, no requeue (FACT; the queue-rebase loop 8307-8319 only preserves queue items, not the new `current`).
- Recurrence: `hourly/daily/weekly` clone is inserted BEFORE returning (6457-6482), independent of whether this instance airs, so the next hour is not affected by a loss.
- Claim (v13.47, 8139-8154, 8193-8208): only one pod holds `claim_by/claim_until` (TTL `_CLOCK_CLAIM_TTL_SEC=6 s`, 8131). A second pod seeing a live claim returns the unchanged clock (8195-8199) - it does not consume. A claim whose owner died expires after 6 s; if pod A claimed, consumed the event and then died before the final write, the event is consumed and lost (new pod re-promotes from queue), HYP for hour 9 if a deploy/restart happened at 07:00 UTC. Claim TTL shorter than a slow promote (LLM/TTS-free path, but `_timeline_pick_due` does ffprobe + Mongo; the test uses 50 ms) - if promote takes >6 s a second pod can also claim; the final CAS by `ver` then fails for one of them (rebase). The failed one re-reads and may drop its own consumed event (see 4 CAS-fail above) - narrow race, HYP.
- Chained start (8244-8250): `started_at` = previous end if <= 15 s late, else now. Not a loss cause.
- The while-loop (8215) can promote several items if the pod slept; a time signal promoted then immediately expired (very short duration) is skipped over by a later loop iteration within the same call (only the last `current` is written; `_play_log(..., promoted)` records `skipped_before = promoted-1`, 8064). This is a real way for a signal to be "promoted" yet never written: HYP requires a wake-up gap.

## 4. Existing tests
backend/tests/test_time_signal_validation.py (135 lines, mocked TTS/LLM, real ffmpeg):
- Covers: generate-permanent with kill-switch OFF saves only valid files; empty / silent / garbage / TTS-none / TTS-raise are rejected with per-hour reasons; resolver serves validated and legacy unflagged docs, refuses `validated=False`, never touches `_get_ai_controls`, logs ERROR "NESSUN AUDIO"; `/admin/time-signal/verify` flags silent/empty/missing and writes nothing.
- Does NOT cover: `time_signal_cache` (pregen path, unvalidated) or the permanent->cache precedence; `_timeline_pick_due` with kind time_signal (audio_url re-resolve, `_probe_tts_duration` returning None, duration fallback, `skipped_no_audio`); a validated=True doc whose file later disappears/gets truncated; object-storage-only files at pick time or in `_probe_tts_duration`; DST / Rome-hour vs UTC mapping; HLS/`/api/tts` 404 behaviour; the pregen skip when a bad permanent exists.

backend/tests/test_promote_claim.py (106 lines):
- Covers: two concurrent `_clock_promote` on one Mongo clock -> exactly one promotion (seq 5->6), no duplicated ids, a due generic `insert` Timeline event is never lost (20 trials); live foreign claim blocks promotion, expired claim does not and final write clears it; claim released when nothing to promote.
- Does NOT cover: kind time_signal / recurrence clone; crash (exception) between pick and final CAS; 4x CAS failure discarding a consumed event; `_is_expired` with duration<=0 or padded durations; long-sleep multi-promote loop skipping a short item; claim TTL (6 s) shorter than a slow promote; events older than 2 h; real timeline resolution of audio.

## 5. How to verify in production
Logs (grep):
- `[time-signal] NESSUN AUDIO per ora Rome 09` (6242) - resolver had nothing (then either skipped_no_audio or the frozen fallback).
- `[time-signal] ora 9: permanente NON validato` (6235) - legacy doc served unchecked.
- `[time-signal] uso audio_url congelato come fallback per tl-...` (6507) - resolver empty, frozen URL played.
- `[clock] promote CAS fallito dopo 4 tentativi` / `promote CAS conflict -> rebase` (8321/8319) around 07:00 UTC.
- `[clock] current id=... duration_sec=... trattato come scaduto`, `[duration] ...: default` warnings.
- `[timeline] ricorrente hourly: ...`; `[time_signal_pregen] cached hour=2026-... 09` (10788) for the cache path; `[time_signal_pregen] error`.
- 404 on `GET /api/tts/<file>` at ~07:00 UTC in the access log = missing file.
Admin endpoints:
- GET /api/admin/time-signal/verify -> row for hour 9: status, reason (`file_missing`/`empty_file`/`silent`/`no_duration`), bytes, max_volume_db, `stored_validated`. This is the single fastest check.
- GET /api/admin/play-log?limit=50 (10344) -> rows around 07:00 UTC: `kind` = `timeline:time_signal`, `reason` (`timeline`/`queue`), `skipped_before`, `promote_lag_sec`, `declared_duration`, `started_at`, `pod`, `queue_ids`. Absence of a `timeline:time_signal` row (or a `skipped_before>0` one) tells lost vs aired. Play-log is TTL 14 days so 07:00 UTC of today is still there.
- Timeline collection (via GET /api/admin/timeline* or Mongo): event at `scheduled_at` 07:00Z: `status` (`consumed` + `consumed_at` = picked; `skipped_no_audio`; still `pending` = never picked), `audio_url` (frozen, and does that file exist?), `duration_sec`, `parent_id`, `from_rrule`, `recurrence`.
- Mongo: `time_signal_permanent._id=9` (speech_audio_url, validated, bytes, max_volume_db), `time_signal_cache._id="2026-09-30 09"`; then `HEAD /api/tts/<file>` and, if object storage is used, check key `tts/<file>` exists and size > 0; `station_clock` claim_by/claim_until/ver/seq.
- Compare `promote_lag_sec` and the previous item end: if `consumed_at` present but no play-log row, the event was consumed and lost (race/crash/CAS failure).

## 6. Most likely explanations (all HYP, ranked)
1. A `time_signal_permanent` (or cache) doc for hour 9 points to a file that is missing locally/in storage, zero-byte, or silent, and was never (re)validated (legacy unflagged doc, or file removed on redeploy). Resolver returns the URL, `_probe_tts_duration` returns None, the entry airs 12-30 s of 404/silence. Fits "aired as silence".
2. Cache fallback for hour 9 created by pregen without validation (TTS returned a bad file).
3. Consumed-then-lost (crash/redeploy/CAS failure) - would show `consumed` with no play-log row; would look like a skipped, not silent, signal.

## 7. Could not verify
- No access to production DB, logs, object storage, or the affected file.
- Whether BACKGROUND_TASKS_ENABLED / USE_OBJECT_STORAGE are set in prod, and which audio URL hour 9 actually holds.
- Behaviour of the HLS player on a 404 segment (only server side read; hls.js config not analysed).
- Tests were not run.

_Line refs verified against 4a1d1a8 (backend/server.py unless stated)._
