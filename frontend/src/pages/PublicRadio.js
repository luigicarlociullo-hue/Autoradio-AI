import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Play, Pause, SkipForward, Radio, Send, Volume2, Sparkles, Users,
  Music2, Newspaper, MessageCircle, Loader2, Heart, ExternalLink, X,
  Mic, AudioWaveform, Cpu, Signal, Waves, CircuitBoard, Disc3, Antenna
} from "lucide-react";
import { endpoints } from "@/lib/api";
import radioEngine from "@/lib/radioEngine";
import { toast } from "sonner";
import PulsingBrand from "@/components/PulsingBrand";
import RadioErrorBoundary from "@/components/RadioErrorBoundary";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import BrandName from "@/components/BrandName";

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

function VuMeter() {
  return (
    <div className="vu-meter" aria-hidden>
      <span /><span /><span /><span /><span />
    </div>
  );
}

function CornerAccents() {
  return (
    <>
      <span className="corner-accent tl" />
      <span className="corner-accent tr" />
      <span className="corner-accent bl" />
      <span className="corner-accent br" />
    </>
  );
}

function KindBadge({ kind }) {
  const map = {
    music:      { label: "MUSIC",      color: "#00BFFF", Icon: Music2 },
    talk:       { label: "TALK",       color: "#00E5FF", Icon: MessageCircle },
    news:       { label: "NEWS",       color: "#FF6B1A", Icon: Newspaper },
    answer:     { label: "ANSWER",     color: "#33CFFF", Icon: Sparkles },
    intro:      { label: "INTRO",      color: "#00E5FF", Icon: Radio },
    outro:      { label: "OUTRO",      color: "#00E5FF", Icon: Radio },
    weather:    { label: "METEO",      color: "#0EA5E9", Icon: Sparkles },
    horoscope:  { label: "OROSCOPO",   color: "#7FA9FF", Icon: Sparkles },
    history:    { label: "STORIA",     color: "#FFB84D", Icon: Sparkles },
    interview:  { label: "DIALOGO",    color: "#00E5FF", Icon: MessageCircle },
    motivation: { label: "MOTIV",      color: "#7FFF9A", Icon: Sparkles },
    joke:       { label: "BATTUTA",    color: "#FF8A3D", Icon: Sparkles },
    jingle:     { label: "JINGLE",     color: "#00BFFF", Icon: Disc3 },
  };
  const m = map[kind] || map.talk;
  const { Icon } = m;
  return (
    <span
      className="chip"
      style={{ color: m.color, borderColor: `${m.color}66`, background: `${m.color}12` }}
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
  const hdMode = false;
  const [renderingHd, setRenderingHd] = useState(false);
  const [djs, setDjs] = useState([]);
  const [questionName, setQuestionName] = useState("");
  const [questionText, setQuestionText] = useState("");
  const [tick, setTick] = useState(0);
  const [trackOverlay, setTrackOverlay] = useState({ visible: false, title: "", artist: "" });
  const [showDonate, setShowDonate] = useState(false);
  const [broadcastMode, setBroadcastMode] = useState("auto");
  const [manualStreamUrl, setManualStreamUrl] = useState("");
  const lastCommandSeqRef = useRef(0);
  const externalAudioRef = useRef(null);
  const DONATE_URL = "https://paypal.me/radioAI";

  const playingRef = useRef(false);
  const stopFlag = useRef(false);
  const mountedRef = useRef(true);
  const overlayTimerRef = useRef(null);

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

  useEffect(() => {
    radioEngine.setupMediaSession({
      play: () => { if (!isPlaying && window.__raiHandlePlay) window.__raiHandlePlay(); },
      pause: () => { if (isPlaying && window.__raiHandlePlay) window.__raiHandlePlay(); },
      next: () => { try { radioEngine.stopAll(); } catch (e) {} },
    });
  }, [isPlaying]);

  useEffect(() => {
    if (!current) return;
    const isMusic = current.kind === "music";
    const meta = current.track_meta || {};
    const title = isMusic
      ? (meta.title || (current.title || "").replace(/^♪\s*/, "").split(" — ")[0] || "R-A.I.")
      : (current.title || "R-A.I.");
    const artist = isMusic
      ? (meta.artist || (current.title || "").split(" — ")[1] || "R-A.I.")
      : "R-A.I. Web Radio";
    radioEngine.updateMediaMetadata({ title, artist });
  }, [current]);

  useEffect(() => {
    radioEngine.setMediaPlaybackState(isPlaying ? "playing" : "paused");
  }, [isPlaying]);

  useEffect(() => {
    const applyCommand = (cmd) => {
      if (!cmd) return;
      switch (cmd.type) {
        case "skip":
          try { radioEngine.stopAll(); } catch (e) {}
          break;
        case "pause":
          stopFlag.current = true;
          try { radioEngine.stopAll(); } catch (e) {}
          setIsPlaying(false);
          break;
        case "resume":
          toast.info("L'admin ha inviato PLAY — clicca Ascolta ora per riprendere.");
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

  useEffect(() => {
    if (broadcastMode !== "live_external") {
      if (externalAudioRef.current) {
        try { externalAudioRef.current.pause(); } catch (e) {}
      }
      return;
    }
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

    const resolveUrls = (seg) => {
      if (!seg) return seg;
      if (seg.speech_audio_url && seg.speech_audio_url.startsWith("/api/")) seg.speech_audio_url = endpoints.audioUrl(seg.speech_audio_url);
      if (seg.outro_speech_url && seg.outro_speech_url.startsWith("/api/")) seg.outro_speech_url = endpoints.audioUrl(seg.outro_speech_url);
      if (seg.music_audio_url && seg.music_audio_url.startsWith("/api/")) seg.music_audio_url = endpoints.audioUrl(seg.music_audio_url);
      if (seg.background_loop && seg.background_loop.startsWith("/api/")) seg.background_loop = endpoints.audioUrl(seg.background_loop);
      return seg;
    };

    const fetchSegmentSafe = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const seg = await endpoints.generateSegment(hdMode ? { hd: true } : {});
          if (seg) return resolveUrls(seg);
        } catch (e) {
          if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
        }
      }
      return null;
    };

    try {
      const QUEUE_TARGET = 3;
      const queue = [];
      let refilling = false;

      const fillQueue = () => {
        if (refilling) return;
        refilling = true;
        (async () => {
          try {
            while (queue.length < QUEUE_TARGET && !stopFlag.current) {
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

      if (hdMode) setRenderingHd(true);
      let seg = await fetchSegmentSafe();
      if (hdMode) setRenderingHd(false);
      if (!seg) {
        toast.error("Impossibile contattare il server. Riprova.");
        return;
      }
      try { radioEngine.preloadSegment(seg); } catch (e) {}
      fillQueue();

      let prevKind = null;

      while (!stopFlag.current) {
        setCurrent(seg);
        setSegments(prev => mergeSegments(prev, seg));
        setIsPreparing(false);

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

        if (prevKind) {
          const musicToSpeech = prevKind === "music" && seg.kind !== "music";
          const speechToMusic = prevKind !== "music" && seg.kind === "music";
          const isJingleTransition = prevKind === "jingle" || seg.kind === "jingle";
          if ((musicToSpeech || speechToMusic) && !isJingleTransition) {
            radioEngine.playStinger(prevKind, seg.kind).catch(() => {});
          }
        }

        try {
          radioEngine.setPreWarmHook(async () => {
            if (queue.length === 0) {
              try {
                const seg2 = await fetchSegmentSafe();
                if (seg2) queue.push(seg2);
              } catch (e) {}
            }
            const next = queue[0];
            if (next) {
              if (next.music_audio_url) radioEngine.prewarmAudio(next.music_audio_url);
              if (next.speech_audio_url) radioEngine.prewarmAudio(next.speech_audio_url);
              if (next.outro_speech_url) radioEngine.prewarmAudio(next.outro_speech_url);
              if (next.pre_jingle_url) radioEngine.prewarmAudio(next.pre_jingle_url);
              if (next.post_jingle_url) radioEngine.prewarmAudio(next.post_jingle_url);
            }
          });
        } catch (e) {}

        try {
          await radioEngine.playSegment(seg);
        } catch (playErr) {
          console.error("playSegment error, skipping:", playErr);
        }

        try {
          const modeRes = await endpoints.getStationMode();
          if (modeRes && (modeRes.pending_graceful_stop || modeRes.mode === "manual" || modeRes.mode === "live_external")) {
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

        if (queue.length === 0) {
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
        fillQueue();
      }
    } catch (e) {
      toast.error("Errore nel flusso radiofonico");
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
    radioEngine.ensureAudioCtx();
    try { window.speechSynthesis.getVoices(); } catch(e) {}
    loop();
    refresh();
  };

  useEffect(() => {
    window.__raiHandlePlay = handlePlay;
    return () => { try { delete window.__raiHandlePlay; } catch (e) {} };
  });

  const submitQuestion = async (e) => {
    e.preventDefault();
    if (!questionText.trim()) return;
    setBusy(true);
    try {
      const res = await endpoints.submitQuestion({ name: questionName || "Ascoltatore", question: questionText, source: "web" });
      const dj = res?.answering_dj || "Un DJ";
      toast.success(`${dj} sta ascoltando... risposta in arrivo!`, { duration: 5000 });
      setQuestionText("");
    } catch { toast.error("Invio fallito"); }
    setBusy(false);
  };

  const onAir = isPlaying || broadcastMode === "live_external";

  return (
    <div className="relative min-h-screen text-white">
      {/* Console background: nero + grid + orbi blu + scanlines */}
      <div
        aria-hidden
        className="fixed inset-0 pointer-events-none overflow-hidden rai-bg"
        style={{ zIndex: 0 }}
        data-testid="animated-bg"
      >
        <div className="rai-bg-grid" />
        <div className="rai-bg-orb rai-bg-orb-1" />
        <div className="rai-bg-orb rai-bg-orb-2" />
        <div className="rai-bg-orb rai-bg-orb-3" />
        <div className="rai-bg-scan" />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(2,4,10,0.55) 0%, rgba(2,4,10,0.75) 55%, rgba(2,4,10,0.94) 100%)",
          }}
        />
      </div>

      {/* ================ HEADER — Console top bezel ================ */}
      <header className="glass sticky top-0 z-40 relative">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative w-10 h-10 rounded-lg flex items-center justify-center"
                 style={{
                   background: "linear-gradient(180deg, #0A1428, #050A18)",
                   border: "1px solid var(--console-line-strong)",
                   boxShadow: "0 0 12px rgba(0,191,255,0.35), inset 0 0 8px rgba(0,191,255,0.2)",
                 }}>
              <Antenna className="w-5 h-5" style={{ color: "var(--console-cyan)", filter: "drop-shadow(0 0 6px rgba(0,229,255,0.8))" }} />
            </div>
            <div>
              <BrandName className="font-display font-black text-lg text-glow-blue" />
              <div className="label-mono">AI CONTROL ROOM</div>
            </div>
          </div>
          <nav className="flex items-center gap-3">
            {onAir ? (
              <div className="on-air-badge" data-testid="live-indicator">
                <span className="dot" />
                <span>ON AIR</span>
              </div>
            ) : (
              <div className="standby-badge" data-testid="standby-indicator">
                <span className="dot" />
                <span>STANDBY</span>
              </div>
            )}
            <a
              href="/dashboard"
              target="_blank"
              rel="noopener noreferrer"
              data-testid="admin-link"
              className="btn-outline focusable text-sm hidden sm:inline-flex"
            >
              <Cpu className="w-4 h-4 mr-1.5" /> Regia
            </a>
          </nav>
        </div>
      </header>

      {/* ================ HERO — Visual + player centrali ================ */}
      <section className="max-w-7xl mx-auto px-6 pt-10 pb-6 relative z-10">
        {/* Titolo minimalista con glow blu */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="label-mono mb-3">◂ La prima radio gestita solo da AI ▸</div>
          <h1 className="font-display font-black text-4xl sm:text-5xl lg:text-6xl leading-[0.95] text-glow-blue">
            <span style={{ color: "var(--console-cyan)" }}>R</span>
            <span style={{ color: "#E6F1FF" }}>-A.I.</span>
          </h1>
          <p className="mt-3 max-w-xl text-sm text-zinc-400 font-mono tracking-wide">
            <Mic className="inline w-3.5 h-3.5 mb-0.5 mr-1" style={{ color: "var(--console-cyan)" }} />
            Voci sintetiche · Musica generata · Zero umani in cabina
          </p>
        </div>

        {/* Visual centrale — ridotto */}
        <div className="max-w-2xl mx-auto relative">
          <div className="absolute -top-3 left-4 z-20">
            <span className="chip"><Signal className="w-3 h-3" /> LIVE SIGNAL</span>
          </div>
          <div className="absolute -top-3 right-4 z-20">
            <VuMeter />
          </div>
          <PulsingBrand
            isPlaying={isPlaying || broadcastMode === "live_external"}
            currentKind={current?.kind || ""}
            trackOverlay={trackOverlay}
          />
        </div>

        {/* NOW PLAYING — modulo console */}
        <div className="mt-6 console-panel p-6 md:p-7">
          <CornerAccents />
          <span className="module-tag">MOD · A · NOW PLAYING</span>

          <div className="grid md:grid-cols-3 gap-6 items-center mt-4">
            <div className="md:col-span-2">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                {current && <KindBadge kind={current.kind} />}
                {current?.llm_provider && (
                  <span className="chip" data-testid="current-llm-provider">
                    <Cpu className="w-3 h-3" /> {current.llm_provider}
                  </span>
                )}
                {current?.dj_name && (
                  <span className="chip" style={{ color: "var(--console-cyan)" }}>
                    <Mic className="w-3 h-3" /> {current.dj_name}
                  </span>
                )}
              </div>
              <div className="overflow-hidden">
                <div className="font-display text-2xl sm:text-3xl font-bold min-h-[3rem] flex items-center gap-3 text-glow-cyan" data-testid="now-playing-title">
                  {isPreparing && !current && (
                    <Loader2 className="w-6 h-6 text-cyan-400 animate-spin shrink-0" data-testid="loading-spinner" />
                  )}
                  <span>{current ? current.title : (isPreparing ? "Preparazione…" : (isPlaying ? "Un attimo…" : "Trasmissione in stand-by"))}</span>
                </div>
              </div>
              {current?.script && (
                <p className="mt-3 text-zinc-400 leading-relaxed line-clamp-2 font-mono text-sm" data-testid="current-script">
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
                className="btn-primary flex items-center gap-2 focusable"
                aria-label={isPlaying ? "Metti in pausa" : "Ascolta ora"}
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                <span>{isPlaying ? "PAUSE" : "PLAY"}</span>
              </button>
              <button
                data-testid="skip-button"
                onClick={() => { radioEngine.stopAll(); }}
                className="btn-outline focusable flex items-center gap-2 !px-3"
                title="Salta al prossimo"
                aria-label="Salta"
              >
                <SkipForward className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Stats mini-display in stile mixer */}
          <div className="mt-6 grid grid-cols-3 gap-3">
            <MiniDisplay icon={Users}    label="ASCOLTATORI" value={station.listeners || 0} />
            <MiniDisplay icon={Waves}    label="SEGMENTI"    value={station.total_segments || 0} />
            <MiniDisplay icon={Mic}      label="DJ ATTIVI"   value={djs.length} />
          </div>
        </div>

        {/* LIVE MANUAL banner (arancione = alert) */}
        {broadcastMode === "live_external" && (
          <div
            data-testid="live-external-banner"
            className="mt-4 rounded-xl p-4 flex flex-col md:flex-row items-center gap-4 glow-orange"
            style={{
              background: "linear-gradient(180deg, rgba(255,107,26,0.10) 0%, rgba(255,107,26,0.04) 100%)",
              border: "1px solid rgba(255,107,26,0.5)",
            }}
          >
            <div className="flex items-center gap-3">
              <div className="on-air-badge"><span className="dot" /><span>LIVE MANUAL</span></div>
              <div className="text-white font-bold font-mono uppercase tracking-widest text-sm">Voce umana in diretta</div>
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

        {/* 4 MODULI CONSOLE — L'esperimento · Disco del giorno · Human vs AI · Chat LED */}
        <HomeCards
          djs={djs}
          questionName={questionName}
          setQuestionName={setQuestionName}
          questionText={questionText}
          setQuestionText={setQuestionText}
          submitQuestion={submitQuestion}
          busy={busy}
        />
      </section>

      {/* ================ DJ ROSTER — Mic Bank ================ */}
      <section className="max-w-7xl mx-auto px-6 py-10 relative z-10">
        <div className="flex items-end justify-between mb-6">
          <div>
            <div className="label-mono flex items-center gap-2"><Mic className="w-3 h-3" /> STAFF · MIC BANK</div>
            <h2 className="font-display font-bold text-2xl sm:text-3xl mt-1 text-glow-blue">Tre voci · tre cervelli</h2>
          </div>
          <div className="hidden sm:block"><VuMeter /></div>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {djs.map(dj => (
            <div
              key={dj.id}
              className="console-panel p-5 transition-all duration-300 hover:-translate-y-1 flex flex-col"
              data-testid={`dj-card-${dj.name}`}
              style={{ boxShadow: `0 0 0 1px ${dj.accent_color}22, 0 12px 40px rgba(0,0,0,0.6), 0 0 30px ${dj.accent_color}22` }}
            >
              <CornerAccents />
              <span className="module-tag" style={{ color: dj.accent_color, borderColor: `${dj.accent_color}66` }}>
                <Mic className="w-2.5 h-2.5 inline mr-1" /> CH · {dj.name?.substring(0,3).toUpperCase()}
              </span>
              <div
                className="w-full aspect-square rounded-lg bg-black overflow-hidden mb-4 mt-4 relative"
                style={{
                  border: `1px solid ${dj.accent_color}55`,
                  boxShadow: `0 0 24px ${dj.accent_color}55, inset 0 0 20px ${dj.accent_color}22`,
                }}
              >
                {dj.avatar_url && (
                  <img
                    src={dj.avatar_url}
                    alt={dj.name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                )}
                {/* Overlay scanlines sull'avatar */}
                <div
                  aria-hidden
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background: "repeating-linear-gradient(0deg, rgba(0,191,255,0.05) 0px, rgba(0,191,255,0.05) 1px, transparent 1px, transparent 3px)",
                    mixBlendMode: "screen",
                  }}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="font-display font-black text-2xl leading-none text-glow-blue" style={{ color: dj.accent_color, textShadow: `0 0 12px ${dj.accent_color}` }}>
                  {dj.name}
                </div>
                <VuMeter />
              </div>
              <div className="mt-2 text-[10px] font-mono uppercase tracking-widest text-zinc-500">
                <Cpu className="w-2.5 h-2.5 inline mr-1" /> {dj.llm_provider} · {dj.llm_model}
              </div>
              <p className="mt-3 text-xs font-mono text-zinc-300 leading-relaxed">
                {dj.personality}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ================ TIMELINE ================ */}
      <section className="max-w-7xl mx-auto px-6 py-10 relative z-10">
        <div className="label-mono mb-2 flex items-center gap-2"><AudioWaveform className="w-3 h-3" /> TIMELINE · BROADCAST LOG</div>
        <h2 className="font-display font-bold text-2xl sm:text-3xl mb-6 text-glow-blue">Ultimi segnali</h2>
        <RadioErrorBoundary>
          <div className="space-y-2">
            {segments.length === 0 && (
              <div className="console-panel p-6 text-zinc-500 text-sm font-mono">
                <span className="text-cyan-400">▸</span> Nessun segmento trasmesso. Premi <span className="text-cyan-300">PLAY</span> per iniziare.
              </div>
            )}
            {segments.slice(-12).reverse().map((s, idx) => {
              const rowKey = s?.id ? `seg-${s.id}` : `seg-idx-${idx}`;
              const dj = djs.find(d => d.name === s.dj_name);
              return (
                <Dialog key={rowKey}>
                  <DialogTrigger asChild>
                    <button
                      className="console-panel p-4 flex items-start gap-4 w-full text-left hover:border-cyan-400/60 transition"
                      data-testid={`timeline-segment-${s.id || idx}`}
                    >
                      <KindBadge kind={s.kind} />
                      <div className="min-w-0 flex-1">
                        <div className="font-display font-semibold truncate">{s.title}</div>
                        <div className="text-xs font-mono text-zinc-500 mt-1 uppercase tracking-widest">
                          <Mic className="w-2.5 h-2.5 inline mr-1" /> {s.dj_name} · <Cpu className="w-2.5 h-2.5 inline mx-1" /> {s.llm_provider}
                        </div>
                        {s.script && <p className="text-sm font-mono text-zinc-400 mt-2 line-clamp-2">{s.script}</p>}
                      </div>
                    </button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl bg-[#02040A] text-white" data-testid={`timeline-dialog-${s.id || idx}`}
                    style={{ border: "1px solid rgba(0,191,255,0.4)", boxShadow: "0 0 40px rgba(0,191,255,0.25)" }}>
                    <DialogHeader>
                      <div className="flex items-center gap-4">
                        {dj?.avatar_url && (
                          <img
                            src={dj.avatar_url}
                            alt={dj.name}
                            className="w-16 h-16 rounded-lg object-cover"
                            style={{ border: `1px solid ${dj.accent_color || "#00BFFF"}55`, boxShadow: `0 0 24px ${dj.accent_color || "#00BFFF"}66` }}
                          />
                        )}
                        <div>
                          <DialogTitle className="text-2xl font-display font-black text-glow-blue" style={{ color: dj?.accent_color || "#00BFFF" }}>
                            {s.dj_name || "DJ"}
                          </DialogTitle>
                          <DialogDescription className="text-xs font-mono uppercase tracking-widest text-cyan-500 mt-1">
                            {s.kind} · {s.llm_provider}
                          </DialogDescription>
                        </div>
                      </div>
                    </DialogHeader>
                    <div className="mt-2">
                      <div className="text-sm font-semibold text-zinc-300 mb-2">{s.title}</div>
                      <div className="max-h-[50vh] overflow-y-auto rounded-lg bg-black/60 border border-cyan-500/20 p-4 text-sm font-mono text-zinc-300 leading-relaxed whitespace-pre-wrap">
                        {s.script || <span className="italic text-zinc-500">Nessun copione testuale disponibile per questo segmento.</span>}
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              );
            })}
          </div>
        </RadioErrorBoundary>
      </section>

      <footer className="max-w-7xl mx-auto px-6 py-10 text-[10px] font-mono uppercase tracking-widest text-zinc-600 border-t mt-8 relative z-10"
              style={{ borderColor: "var(--console-line)" }}>
        <div className="flex items-center gap-2 flex-wrap">
          <Antenna className="w-3 h-3" />
          R-A.I. · Prototipo Beta · Orchestrato da GPT-5.2 · Claude Sonnet 4.5 · Gemini 3 Flash · Nessun umano in cabina.
        </div>
      </footer>

      {/* Donate button */}
      <button
        onClick={() => setShowDonate(true)}
        data-testid="donate-open-button"
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 group flex items-center gap-2 px-5 py-3 rounded-full font-mono font-bold text-xs uppercase tracking-widest text-white shadow-2xl transition-transform hover:scale-105 active:scale-95 focusable"
        style={{
          background: "linear-gradient(135deg, #FF6B1A 0%, #FF8A3D 100%)",
          boxShadow: "0 8px 30px rgba(255,107,26,0.45), 0 0 0 1px rgba(255,255,255,0.1) inset",
        }}
      >
        <Heart className="w-4 h-4" fill="currentColor" />
        <span>Sostieni il progetto</span>
      </button>

      {showDonate && (
        <div
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => setShowDonate(false)}
          data-testid="donate-modal-backdrop"
        >
          <div
            className="console-panel max-w-md w-full p-6 relative"
            onClick={(e) => e.stopPropagation()}
            data-testid="donate-modal"
          >
            <CornerAccents />
            <span className="module-tag" style={{ color: "var(--alert-orange)", borderColor: "rgba(255,107,26,0.5)" }}>
              <Heart className="w-2.5 h-2.5 inline mr-1" fill="currentColor" /> SUPPORT · MOD
            </span>
            <button
              onClick={() => setShowDonate(false)}
              className="absolute top-3 right-3 text-zinc-400 hover:text-white transition-colors z-10"
              data-testid="donate-modal-close"
              aria-label="Chiudi"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-3 mt-4">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center glow-orange"
                style={{ background: "linear-gradient(135deg, #FF6B1A, #FF8A3D)" }}
              >
                <Heart className="w-5 h-5 text-white" fill="currentColor" />
              </div>
              <div className="font-display font-bold text-lg text-glow-orange">Grazie di cuore</div>
            </div>

            <p className="text-sm font-mono text-zinc-300 leading-relaxed mb-6" data-testid="donate-message">
              Ogni donazione tiene accesa l'intelligenza artificiale di R-A.I. — modelli, TTS,
              generazione musicale. Grazie di far parte del segnale.
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
                className="btn-alert inline-flex items-center justify-center gap-2 focusable"
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

// ==================== MINI DISPLAY (stats stile mixer LCD) ====================
function MiniDisplay({ icon: Icon, label, value }) {
  return (
    <div className="relative rounded-lg px-3 py-3"
         style={{
           background: "linear-gradient(180deg, #020814 0%, #05070F 100%)",
           border: "1px solid var(--console-line-strong)",
           boxShadow: "inset 0 0 12px rgba(0,191,255,0.15), 0 0 8px rgba(0,191,255,0.08)",
         }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Icon className="w-3 h-3" style={{ color: "var(--console-cyan)" }} />
          <span className="label-mono !text-[9px] !tracking-widest">{label}</span>
        </div>
        <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--console-cyan)", boxShadow: "0 0 6px var(--console-cyan)" }} />
      </div>
      <div className="font-display font-black text-2xl mt-1 text-glow-cyan" style={{ color: "var(--console-cyan)", fontFamily: "'Share Tech Mono', monospace" }}>
        {String(value).padStart(3, "0")}
      </div>
    </div>
  );
}

// ==================== HOME CARDS — 4 moduli console ====================
function HomeCards({ djs, questionName, setQuestionName, questionText, setQuestionText, submitQuestion, busy }) {
  const [daily, setDaily] = React.useState(null);
  const [messages, setMessages] = React.useState([]);
  const scrollRef = React.useRef(null);

  React.useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const [d, q] = await Promise.all([endpoints.dailyTrack(), endpoints.questionsRecent(30)]);
        if (!live) return;
        setDaily(d?.track || null);
        setMessages(q?.messages || []);
      } catch (e) {}
    };
    load();
    const iv = setInterval(load, 6000);
    return () => { live = false; clearInterval(iv); };
  }, []);

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  return (
    <div className="mt-8 grid gap-5 md:grid-cols-2" data-testid="home-cards">
      {/* Modulo B — L'ESPERIMENTO */}
      <section
        data-testid="card-esperimento"
        className="console-panel p-6"
      >
        <CornerAccents />
        <span className="module-tag">MOD · B · MANIFESTO</span>
        <div className="flex items-start gap-3 mt-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 mt-1"
               style={{
                 background: "rgba(0,191,255,0.08)",
                 border: "1px solid var(--console-line-strong)",
                 boxShadow: "0 0 12px rgba(0,191,255,0.3)",
               }}>
            <CircuitBoard className="w-5 h-5" style={{ color: "var(--console-cyan)", filter: "drop-shadow(0 0 6px rgba(0,229,255,0.8))" }} />
          </div>
          <div className="flex-1">
            <div className="label-mono">◂ L'ESPERIMENTO ▸</div>
            <h3 className="font-display font-black text-xl mt-1 text-glow-blue">Radio che non dovrebbe esistere</h3>
          </div>
        </div>
        <p className="mt-4 text-sm font-mono text-zinc-300 leading-relaxed">
          <span className="text-cyan-400">▸</span> Autonomia totale · zero conduttori umani.<br />
          <span className="text-cyan-400">▸</span> L'AI sceglie musica, scrive copioni, risponde live.<br />
          <span className="text-cyan-400">▸</span> Ogni glitch è la prova che siamo in territorio nuovo.
        </p>
        <div className="mt-4 flex items-center gap-2 pt-3 border-t" style={{ borderColor: "var(--console-line)" }}>
          <span className="chip"><Signal className="w-3 h-3" /> UPTIME 99.4%</span>
          <span className="chip"><Cpu className="w-3 h-3" /> 3 LLM</span>
        </div>
      </section>

      {/* Modulo C — DISCO DEL GIORNO */}
      <section
        data-testid="card-disco-del-giorno"
        className="console-panel p-6"
        style={{ boxShadow: "0 0 0 1px rgba(0,229,255,0.18) inset, 0 12px 40px rgba(0,0,0,0.6), 0 0 24px rgba(0,229,255,0.15)" }}
      >
        <CornerAccents />
        <span className="module-tag" style={{ color: "var(--console-cyan)" }}>MOD · C · DAILY TRACK</span>
        <div className="flex items-start gap-3 mt-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 mt-1"
               style={{
                 background: "rgba(0,229,255,0.08)",
                 border: "1px solid var(--console-cyan)",
                 boxShadow: "0 0 14px rgba(0,229,255,0.4)",
               }}>
            <Disc3 className="w-5 h-5 animate-spin" style={{ color: "var(--console-cyan)", animationDuration: "8s", filter: "drop-shadow(0 0 6px rgba(0,229,255,0.9))" }} />
          </div>
          <div className="flex-1">
            <div className="label-mono">◂ IL DISCO DEL GIORNO ▸</div>
            <h3 className="font-display font-black text-xl mt-1 text-glow-cyan">Un brano esclusivo</h3>
          </div>
        </div>
        <p className="mt-3 text-xs font-mono text-zinc-400 leading-relaxed">
          Un brano generato dall'AI, in onda ogni 2h.
        </p>

        {daily ? (
          <div className="mt-4 rounded-lg p-4"
               style={{
                 background: "linear-gradient(180deg, rgba(0,20,30,0.9), rgba(0,10,20,0.95))",
                 border: "1px solid rgba(0,229,255,0.35)",
                 boxShadow: "inset 0 0 20px rgba(0,229,255,0.15)",
               }}
               data-testid="daily-track">
            <div className="flex items-center gap-2 mb-2">
              <AudioWaveform className="w-4 h-4" style={{ color: "var(--console-cyan)" }} />
              <div className="text-lg font-bold text-glow-cyan" style={{ color: "var(--console-cyan)" }}>{daily.title}</div>
            </div>
            {daily.artist && <div className="text-xs font-mono text-zinc-400 mt-1 uppercase tracking-widest">▸ {daily.artist}</div>}
            {daily.style_tags && <div className="text-xs font-mono text-zinc-500 mt-2 italic">{daily.style_tags}</div>}
            {daily.audio_url && (
              <audio
                controls preload="none"
                src={endpoints.audioUrl(daily.audio_url)}
                className="mt-3 w-full"
                style={{ height: 36 }}
                data-testid="daily-track-audio"
              />
            )}
          </div>
        ) : (
          <div className="mt-4 rounded-lg p-4 text-center"
               style={{
                 background: "rgba(0,0,0,0.4)",
                 border: "1px dashed rgba(0,191,255,0.25)",
               }}>
            <div className="text-xs font-mono text-cyan-500/70 uppercase tracking-widest">Generazione in coda</div>
            <div className="text-[10px] font-mono text-zinc-500 mt-1 italic">Ritenta più tardi.</div>
          </div>
        )}
      </section>

      {/* Modulo D — HUMAN VS AI */}
      <section
        data-testid="card-human-vs-ai"
        className="console-panel p-6"
        style={{ boxShadow: "0 0 0 1px rgba(255,107,26,0.25) inset, 0 12px 40px rgba(0,0,0,0.6), 0 0 24px rgba(255,107,26,0.18)" }}
      >
        <CornerAccents />
        <span className="module-tag" style={{ color: "var(--alert-orange)", borderColor: "rgba(255,107,26,0.5)" }}>
          MOD · D · CHALLENGE
        </span>
        <div className="flex items-start gap-3 mt-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 mt-1 glow-orange"
               style={{ background: "linear-gradient(135deg, rgba(255,107,26,0.15), rgba(255,138,61,0.08))", border: "1px solid rgba(255,107,26,0.5)" }}>
            <Users className="w-5 h-5" style={{ color: "var(--alert-orange-glow)", filter: "drop-shadow(0 0 6px rgba(255,107,26,0.8))" }} />
          </div>
          <div className="flex-1">
            <div className="label-mono" style={{ color: "var(--alert-orange-glow)", textShadow: "0 0 8px rgba(255,107,26,0.5)" }}>◂ HUMAN VS A.I. ▸</div>
            <h3 className="font-display font-black text-xl mt-1 text-glow-orange">La sfida umano vs algoritmo</h3>
          </div>
        </div>
        <p className="mt-3 text-sm font-mono text-zinc-300 leading-relaxed">
          <span style={{ color: "var(--alert-orange-glow)" }}>▸</span> Manda un tuo brano.<br />
          <span style={{ color: "var(--alert-orange-glow)" }}>▸</span> Va in onda in rotazione con l'AI.<br />
          <span style={{ color: "var(--alert-orange-glow)" }}>▸</span> Il pubblico decide.
        </p>
        <Link
          to="/submit"
          data-testid="submit-track-link"
          className="btn-alert inline-flex items-center gap-2 mt-4"
        >
          <Send className="w-4 h-4" />
          Inviaci il brano
        </Link>
      </section>

      {/* Modulo E — CHAT LED (display digitale) */}
      <section
        data-testid="card-chat-led"
        className="console-panel p-5"
      >
        <CornerAccents />
        <span className="module-tag">MOD · E · LIVE FEED</span>
        <div className="flex items-start gap-3 mt-3 mb-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
               style={{
                 background: "rgba(0,191,255,0.08)",
                 border: "1px solid var(--console-line-strong)",
                 boxShadow: "0 0 10px rgba(0,191,255,0.35)",
               }}>
            <MessageCircle className="w-5 h-5" style={{ color: "var(--console-cyan)", filter: "drop-shadow(0 0 6px rgba(0,229,255,0.8))" }} />
          </div>
          <div className="flex-1">
            <div className="label-mono">◂ CHAT LED · LIVE FEED ▸</div>
            <h3 className="font-display font-black text-xl mt-1 text-glow-blue">I DJ ascoltano.</h3>
          </div>
        </div>

        {/* Display LED — stile scanline CRT */}
        <div
          ref={scrollRef}
          data-testid="led-feed"
          className="led-screen h-56 overflow-y-auto text-sm space-y-1"
          style={{ fontSize: "16px", lineHeight: "1.35" }}
        >
          {messages.length === 0 ? (
            <div className="led-row led-line-sys text-center pt-16" style={{ fontSize: "18px" }}>
              &gt; IN ATTESA DI SEGNALE_
            </div>
          ) : (
            messages.map(m => (
              <div key={m.id} className="led-row" data-testid={`led-msg-${m.id}`}>
                <div className="led-line-user">
                  &gt; [{(m.name || "USER").toUpperCase()}] {m.question}
                </div>
                {m.answer && (
                  <div className="led-line-dj pl-4">
                    &lt; [{(m.answering_dj || "DJ").toUpperCase()}] {m.answer}
                  </div>
                )}
                {!m.answer && m.processing_status === "processing" && (
                  <div className="led-line-sys pl-4 italic">
                    &lt; [{(m.answering_dj || "DJ").toUpperCase()}] elaborazione risposta_
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Input inline */}
        <form onSubmit={submitQuestion} className="mt-3 flex flex-col sm:flex-row gap-2" data-testid="led-input-form">
          <input
            data-testid="led-input-name"
            value={questionName}
            onChange={(e) => setQuestionName(e.target.value)}
            placeholder="NOME"
            className="w-full sm:w-28 rounded-md bg-black border outline-none px-3 py-2 text-xs font-mono text-cyan-300 placeholder:text-cyan-800 uppercase tracking-widest"
            style={{ borderColor: "var(--console-line-strong)" }}
          />
          <input
            data-testid="led-input-question"
            value={questionText}
            onChange={(e) => setQuestionText(e.target.value)}
            placeholder="CHIEDI A LEO · ARIA · MAX…"
            className="flex-1 rounded-md bg-black border outline-none px-3 py-2 text-xs font-mono text-white placeholder:text-cyan-800 uppercase tracking-widest"
            style={{ borderColor: "var(--console-line-strong)" }}
            required
          />
          <button
            type="submit"
            disabled={busy || !questionText.trim()}
            data-testid="led-input-send"
            className="btn-primary inline-flex items-center gap-1.5 !text-[10px] disabled:opacity-40 whitespace-nowrap !px-4 !py-2"
          >
            <Send className="w-3 h-3" /> INVIA
          </button>
        </form>
      </section>
    </div>
  );
}
