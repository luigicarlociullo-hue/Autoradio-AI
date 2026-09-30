# Periodic / wall-clock tasks vs station_clock (read-only audit)

Source: /diag-wt/backend/server.py (worktree, branch chore/diagnostics; tree committed, line numbers are from this commit), telegram_bot.py. No other backend/*.py file starts tasks (auth, bpm_service, elevenlabs_service, hf_audio, object_storage, paypal_service, video_service: no create_task/sleep loops; suno_service only polls inside a request-spawned task). backend/scripts/*.py are manual CLI batch generators, not scheduled, none touch station_clock.

## Headline (FACT)
- NOTHING is scheduled at minute :50 (or any fixed "N min before the hour" other than the time-signal pregen at ~:58:30 Rome). No cron/apscheduler anywhere (grep). Suno integrity check is 24h from boot (server.py:10644), not wall-clock.
- The ONLY writers of db.station_clock are: `_clock_cas` (server.py:7887-7900, the single $set path), and the claim-release `update_one` (server.py:8151). Callers of `_clock_cas`: `_clock_promote_inner` claim (8206) and final write (8301); `_clock_refill_queue` (8479); `admin_ad_manager_flash` (10046). Entry points to promote: `_clock_advance` (8106) called from `_clock_ticker` (8501, every 0.5 s, leader), `/stream/now` (8529), `/stream/live.m3u8` (5904), `/admin/stream/skip` (8585, force=True), and startup `_clock_promote()` (10532).
- `current` is replaced only when `_is_expired` (8165-8188: now-started_at >= duration_sec, or duration_sec<=0/missing/unparseable started_at => expired immediately) or when `force=True` (admin skip only). The timeline (`_timeline_pick_due`, 6434) is consulted ONLY inside the `while _is_expired` loop (8215-8228), i.e. soft-sync: it cannot truncate a playing track (comment 6178-6180).
- Refill (`_clock_refill_queue`, 8334) only APPENDS picks to the queue, in one CAS with counters (8474-8485); on CAS conflict it discards its picks (8486-8487), it never removes queue items. Promote CAS conflict path rebases and keeps fresh-lead/post items (8307-8319); only after 4 failed CAS attempts it drops the promotion (8321-8322), leaving the DB clock untouched.
- Hence no periodic task found that shortens `current` or clears `queue` near :50. If songs really get cut ~05:51 / 06:52 UTC (07:51 / 08:52 Europe/Rome, CEST), the cause is not in the server's scheduled jobs; see hypotheses.

## Task inventory

| # | Task (file:line) | Schedule | What it does | Leader-only? | Writes station_clock? |
|---|---|---|---|---|---|
| 1 | `_leader_supervisor("scheduler")` 7967 (started 10619) | every 3 s (`_LEASE_RENEW_SEC` 7946), lease TTL 10 s in `station_leases` (7945, `_try_lead` 7949) | Acquires/renews lease; starts/cancels all loops below. Lease loss => all loops cancelled, new leader restarts them | every pod runs the supervisor; loops only on holder | No (only station_leases) |
| 2 | `_clock_ticker` 8492 (factory "clock", 10598) | every 0.5 s | calls `_clock_advance()` => promote if expired, schedule refill | leader | YES: promote (claim 8206, final 8301, claim release 8151) + refill (8479) via helpers |
| 3 | `_clock_refill_queue` 8334 (spawned by `_schedule_clock_refill` 8326, single in-flight) | whenever queue < `_CLOCK_QUEUE_LOOKAHEAD` after an advance; also awaited (10 s) on empty queue | Picks music/jingle/DJ/FX/Power Play, then CAS-appends queue + 4 counters | any pod that runs an advance (ticker on leader, /stream/* on every pod) | YES (append-only CAS, 8479) |
| 4 | `/stream/now` 8521, `/stream/live.m3u8` 5887, `/admin/stream/skip` 8583 | per client request (clients poll) | `_clock_advance` self-heal; skip forces promotion | every pod | YES (same promote/refill path); skip is the only force |
| 5 | `admin_ad_manager_flash` 10028 | on-demand POST | Prepends ad cluster to queue via CAS | any pod | YES (10046, queue only) |
| 6 | `_video_ticker` 10588 (via `_video_advance` 8620) | every 3 s | Video stinger clock | leader | NO (writes station_video_clock 8667, not station_clock) |
| 7 | `_pillole_scheduler` 8881 | poll every 60 s; fires at most once per Rome hour (`last_run_hour`), i.e. first tick after :00 if program_schedule slot is past/future_pill, fm_mode ON, ai_claude_brain ON | LLM+TTS pill, `priority_queue.insert_one` (8926) | leader | NO directly. Indirect: priority_queue is later consumed by `_clock_pick_spoken_segment` (7534, find_one_and_delete at 7548) during a DJ slot in refill |
| 8 | `_power_play_ticker` 10227 | every 60 s (after 30 s delay) | If no `power_play_daily` for today (Rome date) and Rome hour >= `_POWER_PLAY_LOCAL_HOUR`, generate (Suno or library pick) | leader | NO (power_play_daily only). Indirect: `_power_play_maybe_pick` (10328) read by refill |
| 9 | `_beatmatch_pregen_ticker` 9682 | every 30 s at night (`_is_night_hour`) if `beatmatch_enabled`, else sleep 120 s | READS station_clock (9697), renders transitions into a cache dir | leader | NO (read only) |
| 10 | `_time_signal_pregenerator` 10709 (`seconds_left = 3600 - (minute*60+second)` at 10735) | polls every 15 s (30 s if kill-switch off); acts when `seconds_left <= 90` in Europe/Rome, i.e. from :58:30 to :00 | LLM+TTS "Sono le HH:00", writes `time_signal_cache` (`_id`="YYYY-MM-DD HH"); skips if `time_signal_permanent` exists for that hour | leader; only if BACKGROUND_TASKS_ENABLED and ai_openai_talk | NO. Consumers: `_timeline_pick_due`/`_resolve_current_hour_time_signal` (6208ff) and legacy generate_segment(kind=time_signal) which `find_one_and_delete`s the cache (3116) |
| 11 | `_dj_pregen_ticker` 7622 | every 5 s (300 s after a failure); gated by BACKGROUND_TASKS_ENABLED and ai_openai_talk; acts only if priority_queue is empty | `_dj_pregen_once` 7685 generates one spoken segment -> priority_queue.insert_one | leader | NO (priority_queue only) |
| 12 | `_suno_library_filler` 10647 | every 30 s (120 s when switches off) if BACKGROUND_TASKS_ENABLED + SUNO key + switches | Generates Suno tracks if ready < target | leader | NO (tracks) |
| 13 | `_suno_integrity_check` 10623 | 60 s after boot, then every 86400 s (relative, not wall-clock) | Re-downloads truncated Suno mp3 (<100 KB) | leader | NO (files only; does not touch tracks.duration_sec) |
| 14 | `telegram_bot.run` (telegram_bot.py:116-129, poll_forever 41) | long-poll getUpdates 25 s loop, 3-5 s retry | Inserts questions into db.questions | leader (v13.45) | NO |
| 15 | `_schedule_reprobe` 7920 -> `admin_audio_reprobe_durations` | event-triggered from `_is_expired` (8186) / HLS (5952) when a clock entry has duration<=0; 600 s cooldown per track | ffprobe one track, updates tracks (not the clock copy) | any pod | NO (tracks only) |
| 16 | `_rrule_materialize_due` 7062 (window 90 s) and `_timeline_pick_due` 6434 | not a ticker: runs inside each promote that finds current expired. Wall-clock aspect: template rrule `anchor_minute` (default 0, `_rrule_expand` 6994) and `frequency_minutes`; hourly events scheduled at :00 UTC (`ora_esatta` 5537); recurrence clone +1 h (6466) | Inserts child timeline_events (pending) for occurrences due in <=90 s; consumes one due event (scheduled_at <= now, >= now-2h), returns it as `current` candidate | runs in whichever pod promotes | Indirectly YES: its result becomes `current` in the promote write. Cannot fire mid-track (only on expiry). Any rrule template with anchor_minute=50 would only matter as a queue-jump at the NEXT track boundary after :50 |
| 17 | one-shot spawned tasks: `_poll_suno_and_update` 1239 (from 1230), `_generate_answer_background` 3616 (spawned at 3733), bpm reprobe worker 9258, intro-detect worker 9330, `_play_log` writers 8046-8079 | on request | Suno poll, Q&A, batch analysis | request pod | NO (play_log inserts to station_play_log only) |
| 18 | `admin_trash_autoclean` 4884 | manual POST ("cron esterno" if the operator has one; NOT in repo) | Purges old trash | n/a | NO |
| 19 | startup one-shots 10508ff | boot only: `ensure_seeded`, `_clock_promote()` (10532), voice migration, play-log indexes | | every pod | YES only `_clock_promote()` (creates doc / promotes if expired) |

There is no cleanup ticker, no radio-stats ticker, no palinsesto/hourly job loop other than the items above (program_schedule is only READ by `_pillole_scheduler` and LedWall state, 5317ff). Reads of Rome hour for day/night (`_clock_pick_track` 7802, 2834) only filter picks, they do not change current.

## Assessment for D (cut short ~05:51 and ~06:52 UTC)

FACTS
- Minute :50-:52 matches no schedule above. Closest wall-clock jobs: time-signal pregen begins :58:30 Rome (10735), pillole/ora_esatta/timeline hourly at :00. Rome offset is +2 h (CEST, today 2026-09-30) so :51/:52 are the same minutes in Rome and UTC.
- Nothing scheduled calls `_clock_advance(force=True)`; the only force is POST /admin/stream/skip (8583).
- Timeline promotion, time-signal, DJ pregen, pillole, power-play, beatmatch, reprobe never write `current`; timeline is soft-sync (expiry-gated).
- A track whose `duration_sec` is missing/0 is treated as expired immediately (8181-8187) and a reprobe is scheduled; `_pad_short` pads only <_SHORT_AUDIO_SEC items.
- HLS uses `real_duration_sec or duration_sec` for EXTINF (5945) whereas the clock expires on `duration_sec` (8188): if `duration_sec` < real audio length, the server rolls over early relative to the real file, and clients that follow `stream/now` cut the song.

HYPOTHESES (not verified, no DB/log access)
- H1 (most plausible from code): declared `duration_sec` shorter than the real audio for those two tracks (bad ffprobe/reprobe/normalisation, or `_pad_short`/default paths). Check `station_play_log` rows for those seqs: `declared_duration` vs `real_duration`, `promote_lag_sec`, `reason`. The 05:51 -> 06:52 spacing of 61 min looks like coincidence of track lengths rather than an hourly job.
- H2: someone/something POSTs /admin/stream/skip (admin UI, external script). Play-log `reason` ending in `+skip` would prove it (8240, `_reason += "+skip"`).
- H3: multi-pod wall-clock skew: `_is_expired` uses each pod's own `datetime.now()` against a shared `started_at`; a pod whose clock runs ahead promotes early via /stream/* (claim CAS 8206 only serialises, not corrects). Compare `pod` and `seq` in play_log around those times.
- H4: leader lease flapping (TTL 10 s, renew 3 s): cancels/restarts ticker loops but does not touch clock; low relevance to truncation. It could delay promotion, not shorten.
- H5: client-side (hls.js discontinuity/media-sequence, player seeking to `TIME-OFFSET`) rather than server; window-sliding playlist with `MEDIA-SEQUENCE=seq` (5927-5934) is a client-visible change point at each promotion.
- H6: an ora_esatta/time_signal timeline event with a stale-but-due `scheduled_at` (window 2 h, 6449) is consumed at the next boundary, appearing as an unexpected item, not a cut.

COULD NOT VERIFY
- Actual DB contents (rrule templates with odd anchor_minute, timeline_events, station_play_log), production env vars (BACKGROUND_TASKS_ENABLED, number of pods), external cron hitting /admin/* endpoints, frontend timers, and deploy-side jobs outside the repo.
- The `_pillole_scheduler` priority_queue insert is at 8926 and the `_video_advance` write at 8667; the `_time_signal_pregenerator` def is at 10709 and `seconds_left` at 10735.

_Line refs verified against 4a1d1a8 (backend/server.py unless stated)._
