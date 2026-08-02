import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Play, Pause, SkipForward, Radio, Send, Volume2, Sparkles, Users, Music2, Newspaper, MessageCircle, Loader2, Heart, ExternalLink, X } from "lucide-react";
import { endpoints } from "@/lib/api";
import radioEngine from "@/lib/radioEngine";
import { toast } from "sonner";
import PulsingBrand from "@/components/PulsingBrand";
import RadioErrorBoundary from "@/components/RadioErrorBoundary";
import BrandName from "@/components/BrandName";

const HERO_BG = "https://images.unsplash.com/photo-1724185773486-0b39642e607e?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NTYxODd8MHwxfHNlYXJjaHwyfHxhYnN0cmFjdCUyMG5lb24lMjBzb3VuZCUyMHdhdmV8ZW58MHx8fHwxNzgzODAwMDI5fDA&ixlib=rb-4.1.0&q=85";

function Waveform({ active }) {
  const bars = 24;
  return (
    <div className="flex items-end h-10" data-testid="live-waveform">
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className="waveform-bar"
          style={{
            height: active ? `${20 + Math.abs(Math.sin(i * 0.7)) * 80}%` : "12%",
            animationDelay: `${i * 60}ms`,
            animationPlayState: active ? "running" : "paused",
            opacity: active ? 1 : 0.35,
          }}
        />
      ))}
    </div>
  );
}

function KindBadge({ kind }) {
  const map = {
    music:      { label: "MUSIC",      color: "#FF1493", Icon: Music2 },
    talk:       { label: "TALK",       color: "#22d3ee", Icon: MessageCircle },
    news:       { label: "NEWS",       color: "#8A2BE2", Icon: Newspaper },
    answer:     { label: "ANSWER",     color: "#007AFF", Icon: Sparkles },
    intro:      { label: "INTRO",      color: "#22d3ee", Icon: Radio },
    outro:      { label: "OUTRO",      color: "#22d3ee", Icon: Radio },
    weather:    { label: "METEO",      color: "#0EA5E9", Icon: Sparkles },
    horoscope:  { label: "OROSCOPO",   color: "#C084FC", Icon: Sparkles },
    history:    { label: "STORIA",     color: "#F59E0B", Icon: Sparkles },
    interview:  { label: "DIALOGO",    color: "#EC4899", Icon: MessageCircle },
    motivation: { label: "MOTIV",      color: "#84CC16", Icon: Sparkles },
    joke:       { label: "BATTUTA",    color: "#EF4444", Icon: Sparkles },
  };
  const m = map[kind] || map.talk;
  const { Icon } = m;
  return (
    <span
      className="chip"
      style={{ color: m.color, borderColor: `${m.color}55`, background: `${m.color}12` }}
    >
      <Icon className="w-3 h-3" /> {m.label}
    </span>
  );
}

export default function PublicRadio() {
  const [station, setStation] = useState({ is_live: false, listeners: 0, total_segments: 0 });
  const [segments, setSegments] = useState([]);
  const [current, setCurrent] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  // HD mode è sempre implicitamente ON per tutti (Suno + ElevenLabs = qualità piena).
  // Il vecchio toggle "HD Bark/Stable Audio" (open-source, 20-35s per segmento) è stato
  // rimosso dalla UI: gli utenti hanno un'esperienza uniforme in alta qualità.
  const hdMode = false;   // false = Suno mp3 + ElevenLabs TTS (il path veloce e HQ)
  const [renderingHd, setRenderingHd] = useState(false);
  const [djs, setDjs] = useState([]);
  const [questionName, setQuestionName] = useState("");
  const [questionText, setQuestionText] = useState("");
  const [tick, setTick] = useState(0);
  const [trackOverlay, setTrackOverlay] = useState({ visible: false, title: "", artist: "" });
  const [showDonate, setShowDonate] = useState(false);
  // Broadcast state (mode + admin command tracking) — polled every 3s so
  // any click in the admin Control Room propagates to this browser.
  const [broadcastMode, setBroadcastMode] = useState("auto");
  const [manualStreamUrl, setManualStreamUrl] = useState("");
  const lastCommandSeqRef = useRef(0);
  const externalAudioRef = useRef(null);
  const DONATE_URL = "https://paypal.me/radioAI";

  const playingRef = useRef(false);
  const stopFlag = useRef(false);
  const mountedRef = useRef(true);
  const overlayTimerRef = useRef(null);

  // Merge helper: dedupe segments by id (fallback to a stable synthetic id when
  // backend didn't send one) and cap the timeline length so React never has to
  // reconcile huge arrays with colliding keys.
  const mergeSegments = (prev, incoming) => {
    const list = Array.isArray(incoming) ? [...prev, ...incoming] : [...prev, incoming];
    const map = new Map();
    list.forEach((s, i) => {
      if (!s) return;
      const key = s.id || `${s.kind || "seg"}-${s.created_at || ""}-${i}`;
      map.set(key, { ...s, id: key });
    });
    return Array.from(map.values()).slice(-30);
  };

  const refresh = async () => {
    try {
      const [s, seg, d] = await Promise.all([endpoints.station(), endpoints.segments(), endpoints.djs()]);
      if (!mountedRef.current) return;
      setStation(s);
      setSegments(prev => mergeSegments(prev, seg || []));
      setDjs(d || []);
    } catch (e) { /* noop */ }
  };

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    const iv = setInterval(() => setTick(t => t + 1), 5000);
    return () => {
      mountedRef.current = false;
      clearInterval(iv);
      stopFlag.current = true;
      try { radioEngine.stopAll(); } catch (e) {}
      if (overlayTimerRef.current) { clearTimeout(overlayTimerRef.current); overlayTimerRef.current = null; }
    };
  }, []);

  // Broadcast state poller: mirrors admin commands (skip/pause/resume/jingle)
  // and mode changes (auto ↔ live_external) into this listener browser.
  useEffect(() => {
    const applyCommand = (cmd) => {
      if (!cmd) return;
      switch (cmd.type) {
        case "skip":
          console.log("[R-A.I.] admin SKIP received");
          try { radioEngine.stopAll(); } catch (e) {}
          break;
        case "pause":
          console.log("[R-A.I.] admin PAUSE received");
          stopFlag.current = true;
          try { radioEngine.stopAll(); } catch (e) {}
          setIsPlaying(false);
          break;
        case "resume":
          console.log("[R-A.I.] admin RESUME received");
          // Give a hint to the UI; a real resume requires a user gesture on
          // some browsers so we surface a toast.
          toast.info("L'admin ha inviato PLAY — clicca Ascolta ora per riprendere.");
          break;
        case "jingle_now":
          console.log("[R-A.I.] admin JINGLE NOW — next segment will be a jingle");
          break;
        default: break;
      }
    };

    const poll = async () => {
      try {
        const r = await endpoints.getStationMode();
        if (!r) return;
        setBroadcastMode(r.mode || "auto");
        setManualStreamUrl(r.manual_stream_url || "");
        const seq = Number(r.command_seq || 0);
        if (seq > lastCommandSeqRef.current) {
          if (lastCommandSeqRef.current !== 0) applyCommand(r.last_command);
          lastCommandSeqRef.current = seq;
        }
      } catch (e) { /* silent */ }
    };
    poll();
    const iv = setInterval(poll, 3000);
    return () => clearInterval(iv);
  }, []);

  // Auto-manage external stream <audio> when in live_external mode.
  useEffect(() => {
    if (broadcastMode !== "live_external") {
      // Leaving live_external: stop the external audio.
      if (externalAudioRef.current) {
        try { externalAudioRef.current.pause(); } catch (e) {}
      }
      return;
    }
    // Entering live_external: ensure AI player is stopped.
    stopFlag.current = true;
    try { radioEngine.stopAll(); } catch (e) {}
    setIsPlaying(false);
  }, [broadcastMode]);

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [tick]);

  const loop = async () => {
    if (playingRef.current) return;
    playingRef.current = true;
    stopFlag.current = false;
    setIsPlaying(true);
    setIsPreparing(true);

    // Safety pad rimosso: era percepibile come rumore di fondo. Ora la
    // continuita' audio si affida al crossfade 1s DJ<->music + queue di 2.
    // try { radioEngine.startSafetyPad(); } catch (e) {}

    const resolveUrls = (seg) => {
      if (!seg) return seg;
      if (seg.speech_audio_url && seg.speech_audio_url.startsWith("/api/")) seg.speech_audio_url = endpoints.audioUrl(seg.speech_audio_url);
      if (seg.outro_speech_url && seg.outro_speech_url.startsWith("/api/")) seg.outro_speech_url = endpoints.audioUrl(seg.outro_speech_url);
      if (seg.music_audio_url && seg.music_audio_url.startsWith("/api/")) seg.music_audio_url = endpoints.audioUrl(seg.music_audio_url);
      if (seg.background_loop && seg.background_loop.startsWith("/api/")) seg.background_loop = endpoints.audioUrl(seg.background_loop);
      return seg;
    };

    // Fetch resiliente con 3 retry e backoff 2s. Ritorna null solo se tutti i tentativi falliscono.
    const fetchSegmentSafe = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const seg = await endpoints.generateSegment(hdMode ? { hd: true } : {});
          if (seg) return resolveUrls(seg);
        } catch (e) {
          console.warn(`fetchSegment attempt ${attempt + 1}/3 failed:`, e);
          if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
        }
      }
      return null;
    };

    const fetchSegment = fetchSegmentSafe;  // alias per retrocompatibilità

    try {
      // ============================================================
      // CODA DI 2 SEGMENTI PRE-GENERATI (zero silenzio tra segmenti)
      // ------------------------------------------------------------
      // Manteniamo SEMPRE 2 segmenti pronti nella coda. Appena uno viene
      // consumato, ne richiediamo subito uno nuovo in background così il
      // buffer è pieno prima che il segmento corrente finisca.
      // ============================================================
      const queue = [];
      let refilling = false;

      const fillQueue = () => {
        if (refilling) return;
        refilling = true;
        (async () => {
          try {
            while (queue.length < 2 && !stopFlag.current) {
              const seg = await fetchSegmentSafe();
              if (!seg) break;
              try { radioEngine.preloadSegment(seg); } catch (e) {}
              queue.push(seg);
            }
          } finally {
            refilling = false;
          }
        })();
      };

      // Riempi la coda PRIMA di iniziare (blocca sul primo, poi riempi il resto async)
      if (hdMode) setRenderingHd(true);
      let seg = await fetchSegmentSafe();
      if (hdMode) setRenderingHd(false);
      if (!seg) {
        toast.error("Impossibile contattare il server. Riprova.");
        return;
      }
      try { radioEngine.preloadSegment(seg); } catch (e) {}
      // Kick off riempimento coda in parallelo
      fillQueue();

      let prevKind = null;

      while (!stopFlag.current) {
        setCurrent(seg);
        setSegments(prev => mergeSegments(prev, seg));
        setIsPreparing(false);

        // Neon track overlay
        if (overlayTimerRef.current) { clearTimeout(overlayTimerRef.current); overlayTimerRef.current = null; }
        if (seg.kind === "music") {
          const meta = seg.track_meta || {};
          const rawTitle = meta.title || (seg.title || "").replace(/^♪\s*/, "").split(" — ")[0];
          const rawArtist = meta.artist || (seg.title || "").split(" — ")[1] || "";
          setTrackOverlay({ visible: true, title: rawTitle, artist: rawArtist });
          const duration = Math.max(20, seg.duration_sec || 60);
          const hideAfterMs = Math.max(2000, (duration - 8) * 1000);
          overlayTimerRef.current = setTimeout(() => {
            if (mountedRef.current) setTrackOverlay(o => ({ ...o, visible: false }));
          }, hideAfterMs);
        } else {
          setTrackOverlay(o => (o.visible ? { ...o, visible: false } : o));
        }

        // ============================================================
        // Stinger transizionale NON BLOCCANTE + JINGLE occasionale
        // ------------------------------------------------------------
        // Ai cambi di blocco (music ↔ speech), 45% di probabilità di infilare
        // un jingle R-A.I. cantato PRIMA del prossimo segmento. Altrimenti sting
        // procedurale breve non bloccante.
        // ============================================================
        if (prevKind) {
          const musicToSpeech = prevKind === "music" && seg.kind !== "music";
          const speechToMusic = prevKind !== "music" && seg.kind === "music";
          if (musicToSpeech || speechToMusic) {
            const wantJingle = Math.random() < 0.45;
            if (wantJingle) {
              try {
                const jr = await endpoints.getJingleRandom();
                const jingle = jr && jr.jingle;
                if (jingle && jingle.audio_url) {
                  const url = jingle.audio_url.startsWith("/api/")
                    ? endpoints.audioUrl(jingle.audio_url)
                    : jingle.audio_url;
                  console.log(`[R-A.I.] Jingle intro: ${jingle.title}`);
                  // ZERO OVERLAP: tronca bruscamente il fade-out del brano
                  // precedente PRIMA che parta il jingle, così il jingle
                  // suona per intero senza sovrapporsi a nulla.
                  try { radioEngine.hardStopMusic(); } catch (e) {}
                  await radioEngine.playJingle(url);
                } else {
                  radioEngine.playStinger(prevKind, seg.kind).catch(() => {});
                }
              } catch (e) {
                radioEngine.playStinger(prevKind, seg.kind).catch(() => {});
              }
            } else {
              radioEngine.playStinger(prevKind, seg.kind).catch(() => {});
            }
          }
        }

        console.log(`[R-A.I.] Playing segment kind=${seg.kind} title="${seg.title}" queue=${queue.length}`);
        // Registra un hook che scatta 5s prima della fine del brano corrente:
        // pre-warma il file audio del prossimo segmento (task explicit request).
        try {
          radioEngine.setPreWarmHook(() => {
            const next = queue[0];
            if (next) {
              if (next.music_audio_url) radioEngine.prewarmAudio(next.music_audio_url);
              if (next.speech_audio_url) radioEngine.prewarmAudio(next.speech_audio_url);
              if (next.outro_speech_url) radioEngine.prewarmAudio(next.outro_speech_url);
            }
          });
        } catch (e) {}

        try {
          await radioEngine.playSegment(seg);
        } catch (playErr) {
          console.error("playSegment error, skipping:", playErr);
        }

        // ============================================================
        // GRACEFUL STOP: dopo ogni segmento verifica se admin ha chiesto
        // switch a modalita' manuale. Se si', esci pulito dal loop.
        // ============================================================
        try {
          const modeRes = await endpoints.getStationMode();
          if (modeRes && (modeRes.pending_graceful_stop || modeRes.mode === "manual" || modeRes.mode === "live_external")) {
            console.log("[R-A.I.] Graceful stop requested by admin — exiting loop.");
            toast.success(modeRes.mode === "live_external"
              ? "Passaggio in LIVE MANUALE · streaming esterno in onda"
              : "Trasmissione automatica messa in pausa. Modalità manuale attiva.");
            stopFlag.current = true;
            break;
          }
        } catch (e) {}

        if (stopFlag.current) break;
        setTrackOverlay(o => (o.visible ? { ...o, visible: false } : o));

        prevKind = seg.kind;

        // Preleva il prossimo dalla coda (già pronto) e richiedi refill immediato
        if (queue.length === 0) {
          // Emergency: nessun segmento in coda → attesa attiva breve poi hard-fetch
          console.warn("[R-A.I.] Queue empty at segment end — fetching sync");
          const start = Date.now();
          while (queue.length === 0 && Date.now() - start < 4000 && !stopFlag.current) {
            fillQueue();
            await new Promise(r => setTimeout(r, 200));
          }
          if (queue.length === 0) {
            const emergency = await fetchSegmentSafe();
            if (emergency) queue.push(emergency);
            else {
              await new Promise(r => setTimeout(r, 3000));
              const retry = await fetchSegmentSafe();
              if (retry) queue.push(retry);
              else { toast.error("Server irraggiungibile"); break; }
            }
          }
        }
        seg = queue.shift();
        // Richiedi immediatamente il refill in background
        fillQueue();
      }
    } catch (e) {
      toast.error("Errore nel flusso radiofonico");
      console.error(e);
    } finally {
      try { radioEngine.stopSafetyPad(); } catch (e) {}
      radioEngine.stopAll();
      playingRef.current = false;
      setIsPlaying(false);
      setIsPreparing(false);
      setCurrent(null);
      setRenderingHd(false);
      if (overlayTimerRef.current) { clearTimeout(overlayTimerRef.current); overlayTimerRef.current = null; }
      setTrackOverlay({ visible: false, title: "", artist: "" });
    }
  };

  const handlePlay = async () => {
    if (isPlaying) {
      stopFlag.current = true;
      radioEngine.stopAll();
      setIsPlaying(false);
      setIsPreparing(false);
      return;
    }
    if (!station.is_live) {
      await endpoints.toggle();
    }
    // must be user gesture for audio context
    radioEngine.ensureAudioCtx();
    // preload voices
    try { window.speechSynthesis.getVoices(); } catch(e) {}
    loop();
    refresh();
  };

  const submitQuestion = async (e) => {
    e.preventDefault();
    if (!questionText.trim()) return;
    setBusy(true);
    try {
      await endpoints.submitQuestion({ name: questionName || "Ascoltatore", question: questionText, source: "web" });
      toast.success("Domanda inviata! I DJ AI risponderanno presto in diretta.");
      setQuestionText("");
    } catch { toast.error("Invio fallito"); }
    setBusy(false);
  };

  return (
    <div className="relative min-h-screen text-white">
      {/* Animated neon background — replaces the previous YouTube embed
          which is blocked by the video owner on external sites. Pure CSS
          gradient + radial glows, aligned with the R-A.I. neon palette. */}
      <div
        aria-hidden
        className="fixed inset-0 pointer-events-none overflow-hidden rai-bg"
        style={{ zIndex: 0 }}
        data-testid="animated-bg"
      >
        <div className="rai-bg-orb rai-bg-orb-1" />
        <div className="rai-bg-orb rai-bg-orb-2" />
        <div className="rai-bg-orb rai-bg-orb-3" />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(5,5,10,0.55) 0%, rgba(5,5,10,0.72) 50%, rgba(5,5,10,0.90) 100%)",
          }}
        />
      </div>

      {/* Header */}
      <header className="glass sticky top-0 z-40 relative">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Radio className="w-6 h-6 text-pink-500" />
            <div>
              <BrandName className="font-display font-black text-lg" />
              <div className="label-mono">Web Radio · AI Only</div>
            </div>
          </div>
          <nav className="flex items-center gap-3">
            {station.is_live && (
              <div className="flex items-center gap-2" data-testid="live-indicator">
                <span className="live-dot" />
                <span className="font-mono text-xs uppercase tracking-widest text-pink-400">Live</span>
              </div>
            )}
            <Link to="/pubblicita" data-testid="advertise-link" className="btn-outline focusable text-sm hidden sm:inline-flex">Sponsorizza</Link>
            <Link to="/dashboard" data-testid="admin-link" className="btn-outline focusable text-sm">Pannello Admin</Link>
          </nav>
        </div>
      </header>

      {/* Hero / Player */}
      <section className="max-w-7xl mx-auto px-6 pt-16 pb-10 relative z-10">
        <div className="label-mono mb-4">La prima radio governata solo da AI</div>
        <h1 className="font-display font-black text-4xl sm:text-5xl lg:text-6xl leading-[0.95] max-w-4xl">
          Voci sintetiche.<br />
          Musica inventata.<br />
          <span className="text-pink-500">Zero umani in cabina.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-zinc-400 leading-relaxed">
          Dieci DJ AI si passano il microfono: satira, dialoghi in diretta, oroscopo, storia, meteo poetico, dialoghi tra due modelli e brani mai esistiti. GPT · Claude · Gemini scrivono i copioni; <span className="text-cyan-400">Bark</span> presta la voce e <span className="text-cyan-400">Stable Audio Open</span> compone la musica — tutto rigorosamente open source.
        </p>

        {/* Live visual — pulsating R-A.I. brand reacts to live audio */}
        <div className="mt-10">
          <PulsingBrand
            isPlaying={isPlaying || broadcastMode === "live_external"}
            currentKind={current?.kind || ""}
            trackOverlay={trackOverlay}
          />
        </div>

        {/* LIVE MANUAL — external Icecast/Shoutcast stream takes over for
            everyone whenever the admin flips the switch in the Control Room. */}
        {broadcastMode === "live_external" && (
          <div
            data-testid="live-external-banner"
            className="mt-4 rounded-2xl border border-cyan-400/40 bg-cyan-500/10 p-4 flex flex-col md:flex-row items-center gap-4"
          >
            <div className="flex items-center gap-3">
              <span className="live-dot" style={{ background: "#22d3ee", boxShadow: "0 0 12px #22d3ee" }} />
              <div>
                <div className="font-mono text-xs tracking-widest text-cyan-300 uppercase">LIVE MANUALE</div>
                <div className="text-white font-bold">Voce umana in diretta</div>
              </div>
            </div>
            {manualStreamUrl ? (
              <audio
                ref={externalAudioRef}
                data-testid="external-audio"
                src={manualStreamUrl}
                controls
                autoPlay
                crossOrigin="anonymous"
                className="flex-1 min-w-[220px] w-full"
                style={{ maxWidth: 640 }}
              />
            ) : (
              <div className="text-amber-300 text-sm">
                URL stream non ancora impostato — l'admin lo configura dalla Control Room.
              </div>
            )}
          </div>
        )}

        {/* Now playing panel */}
        <div className="mt-6 glass rounded-2xl p-6 md:p-8">
          <div className="grid md:grid-cols-3 gap-6 items-center">
            <div className="md:col-span-2">
              <div className="flex items-center gap-3 mb-3">
                {current && <KindBadge kind={current.kind} />}
                {current?.llm_provider && (
                  <span className="chip" data-testid="current-llm-provider">
                    <Sparkles className="w-3 h-3" /> {current.llm_provider}
                  </span>
                )}
                {current?.dj_name && (
                  <span className="chip" style={{ color: "#fff", borderColor: "rgba(255,255,255,0.2)" }}>
                    <Users className="w-3 h-3" /> {current.dj_name}
                  </span>
                )}
              </div>
              <div className="overflow-hidden">
                <div className="font-display text-2xl sm:text-3xl font-bold min-h-[3rem] flex items-center gap-3" data-testid="now-playing-title">
                  {isPreparing && !current && (
                    <Loader2 className="w-6 h-6 text-cyan-400 animate-spin shrink-0" data-testid="loading-spinner" />
                  )}
                  <span>{current ? current.title : (isPreparing ? "Preparazione…" : (isPlaying ? "Un attimo…" : "Radio in stand-by"))}</span>
                </div>
              </div>
              {current?.script && (
                <p className="mt-3 text-zinc-400 leading-relaxed line-clamp-3" data-testid="current-script">
                  {current.script}
                </p>
              )}
              <div className="mt-5">
                <Waveform active={isPlaying} />
              </div>
            </div>
            <div className="flex md:justify-end items-center gap-3">
              <button
                data-testid="play-pause-button"
                onClick={handlePlay}
                className="btn-primary flex items-center gap-2 text-base px-6 py-4 focusable"
                aria-label={isPlaying ? "Metti in pausa" : "Ascolta ora"}
              >
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                <span>{isPlaying ? "Pausa" : "Ascolta ora"}</span>
              </button>
              <button
                data-testid="skip-button"
                onClick={() => { radioEngine.stopAll(); }}
                className="btn-outline focusable flex items-center gap-2"
                title="Salta al prossimo"
              >
                <SkipForward className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-4">
            <Stat label="Ascoltatori" value={station.listeners || 0} />
            <Stat label="Segmenti" value={station.total_segments || 0} />
            <Stat label="DJ attivi" value={djs.length} />
          </div>
        </div>
      </section>

      {/* DJ roster */}
      <section className="max-w-7xl mx-auto px-6 py-10 relative z-10">
        <div className="flex items-end justify-between mb-6">
          <div>
            <div className="label-mono">La squadra</div>
            <h2 className="font-display font-bold text-2xl sm:text-3xl">DJ · Solo AI, mai gli stessi due secondi</h2>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {djs.map(dj => (
            <div key={dj.id} className="card-surface p-5 transition-transform duration-300 hover:-translate-y-1" data-testid={`dj-card-${dj.name}`}>
              <div className="flex items-start gap-4">
                <div
                  className="w-14 h-14 rounded-lg bg-zinc-800 shrink-0 overflow-hidden border border-white/10"
                  style={{ boxShadow: `0 0 16px ${dj.accent_color}55` }}
                >
                  {dj.avatar_url && <img src={dj.avatar_url} alt={dj.name} className="w-full h-full object-cover" />}
                </div>
                <div className="min-w-0">
                  <div className="font-display font-bold text-lg" style={{ color: dj.accent_color }}>{dj.name}</div>
                  <div className="text-xs font-mono text-cyan-400 uppercase tracking-widest">{dj.llm_provider} · {dj.llm_model}</div>
                  <p className="mt-2 text-sm text-zinc-400 leading-relaxed line-clamp-3">{dj.personality}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Timeline */}
      <section className="max-w-7xl mx-auto px-6 py-10 relative z-10">
        <div className="label-mono mb-2">Timeline</div>
        <h2 className="font-display font-bold text-2xl sm:text-3xl mb-6">Cosa è appena successo in radio</h2>
        <RadioErrorBoundary>
          <div className="space-y-3">
            {segments.length === 0 && (
              <div className="card-surface p-6 text-zinc-500 text-sm">
                Nessun segmento ancora trasmesso. Premi <span className="text-pink-400">Ascolta ora</span> per far partire la radio.
              </div>
            )}
            {segments.slice(-12).reverse().map((s, idx) => {
              const rowKey = s?.id ? `seg-${s.id}` : `seg-idx-${idx}`;
              return (
                <div key={rowKey} className="card-surface p-4 flex items-start gap-4" data-testid={`timeline-segment-${s.id || idx}`}>
                  <KindBadge kind={s.kind} />
                  <div className="min-w-0 flex-1">
                    <div className="font-display font-semibold truncate">{s.title}</div>
                    <div className="text-xs font-mono text-zinc-500 mt-1">
                      {s.dj_name} · {s.llm_provider}
                    </div>
                    {s.script && <p className="text-sm text-zinc-400 mt-2 line-clamp-2">{s.script}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </RadioErrorBoundary>
      </section>

      {/* Ask the AI */}
      <section className="max-w-7xl mx-auto px-6 py-10 relative z-10">
        <div className="glass rounded-2xl p-6 md:p-10">
          <div className="grid md:grid-cols-2 gap-8 items-center">
            <div>
              <div className="label-mono mb-2">Fatti sentire</div>
              <h2 className="font-display font-bold text-2xl sm:text-3xl">Manda una domanda ai DJ AI</h2>
              <p className="mt-3 text-zinc-400 leading-relaxed max-w-md">
                Un DJ prenderà la tua domanda in diretta, deciderà quale modello (GPT · Claude · Gemini) è più adatto e ti risponderà a voce.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="chip">Web · attivo</span>
                <span className="chip" style={{ color: "#a1a1aa", borderColor: "rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)" }}>Telegram · in arrivo</span>
                <span className="chip" style={{ color: "#a1a1aa", borderColor: "rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)" }}>SMS · in arrivo</span>
              </div>
            </div>
            <form onSubmit={submitQuestion} className="space-y-3" data-testid="question-form">
              <input
                data-testid="question-name-input"
                value={questionName}
                onChange={e => setQuestionName(e.target.value)}
                placeholder="Il tuo nome (opzionale)"
                className="w-full bg-[#0F0F14] border border-white/10 rounded-lg px-4 py-3 focusable font-mono text-sm"
              />
              <textarea
                data-testid="question-text-input"
                value={questionText}
                onChange={e => setQuestionText(e.target.value)}
                placeholder="La tua domanda…"
                rows={4}
                required
                className="w-full bg-[#0F0F14] border border-white/10 rounded-lg px-4 py-3 focusable text-sm resize-none"
              />
              <button data-testid="submit-question-button" disabled={busy} className="btn-primary flex items-center gap-2 focusable">
                <Send className="w-4 h-4" /> {busy ? "Invio…" : "Invia in diretta"}
              </button>
            </form>
          </div>
        </div>
      </section>

      <footer className="max-w-7xl mx-auto px-6 py-10 text-xs font-mono text-zinc-600 border-t border-white/5 mt-8 relative z-10">
        R-A.I. · prototipo beta · orchestrato da GPT-5.2 · Claude Sonnet 4.5 · Gemini 3 Flash · nessun umano è stato usato per registrare quest'audio.
      </footer>

      {/* Floating "Sostieni il progetto" button — fixed bottom-center */}
      <button
        onClick={() => setShowDonate(true)}
        data-testid="donate-open-button"
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 group flex items-center gap-2 px-5 py-3 rounded-full font-display font-bold text-sm text-white shadow-2xl transition-transform hover:scale-105 active:scale-95 focusable"
        style={{
          background: "linear-gradient(135deg, #ff2d95 0%, #ff8a3d 100%)",
          boxShadow: "0 8px 30px rgba(255, 45, 149, 0.45), 0 0 0 1px rgba(255,255,255,0.08) inset",
        }}
      >
        <Heart className="w-4 h-4" fill="currentColor" />
        <span>Sostieni il progetto</span>
      </button>

      {/* Donation confirmation modal */}
      {showDonate && (
        <div
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setShowDonate(false)}
          data-testid="donate-modal-backdrop"
        >
          <div
            className="card-surface max-w-md w-full p-6 relative"
            onClick={(e) => e.stopPropagation()}
            data-testid="donate-modal"
            style={{
              background: "linear-gradient(180deg, rgba(20,10,25,0.98) 0%, rgba(15,10,20,0.98) 100%)",
              border: "1px solid rgba(255, 45, 149, 0.35)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.6), 0 0 40px rgba(255, 45, 149, 0.15)",
            }}
          >
            <button
              onClick={() => setShowDonate(false)}
              className="absolute top-3 right-3 text-zinc-400 hover:text-white transition-colors"
              data-testid="donate-modal-close"
              aria-label="Chiudi"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, #ff2d95, #ff8a3d)" }}
              >
                <Heart className="w-5 h-5 text-white" fill="currentColor" />
              </div>
              <div className="font-display font-bold text-lg text-white">Grazie di cuore</div>
            </div>

            <p className="text-sm text-zinc-300 leading-relaxed mb-6" data-testid="donate-message">
              Ogni tua donazione aiuta a mantenere attiva l'intelligenza artificiale di questa
              radio. Grazie per far parte di questo viaggio!
            </p>

            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <button
                onClick={() => setShowDonate(false)}
                className="btn-outline text-sm focusable"
                data-testid="donate-cancel"
              >
                Non ora
              </button>
              <a
                href={DONATE_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setShowDonate(false)}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full font-display font-bold text-sm text-white transition-transform hover:scale-[1.02] active:scale-95 focusable"
                style={{
                  background: "linear-gradient(135deg, #ff2d95 0%, #ff8a3d 100%)",
                  boxShadow: "0 6px 20px rgba(255, 45, 149, 0.4)",
                }}
                data-testid="donate-confirm-paypal"
              >
                <span>Vai a PayPal</span>
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="card-surface px-4 py-3">
      <div className="label-mono">{label}</div>
      <div className="font-display font-bold text-2xl mt-1">{value}</div>
    </div>
  );
}
