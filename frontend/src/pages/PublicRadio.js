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
import HoloBrand from "@/components/HoloBrand";
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
          const hourLocal = new Date().getHours();  // 0-23, browser locale (Club Night 22-04)
          // Enable night crossfade quando siamo in Club Night (22-04)
          try { radioEngine.setNightMixing(hourLocal >= 22 || hourLocal <= 3); } catch (e) {}
          const params = { hour_local: hourLocal };
          if (hdMode) params.hd = true;
          const seg = await endpoints.generateSegment(params);
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
      // Beat detection client-side per brani musica in Club Night (v12.14)
      try {
        const hourLocal = new Date().getHours();
        const isNight = hourLocal >= 22 || hourLocal <= 3;
        if (isNight && seg.kind === "music" && seg.track_id && seg.music_audio_url && !seg.track_meta?.bpm) {
          const apiBase = process.env.REACT_APP_BACKEND_URL;
          radioEngine.analyzeBpmAndReport(seg.music_audio_url, seg.track_id, apiBase).catch(() => {});
        }
      } catch (e) { /* silent */ }
      fillQueue();

      let prevKind = null;

      while (!stopFlag.current) {
        setCurrent(seg);
        setSegments(prev => mergeSegments(prev, seg));
        setIsPreparing(false);
        // v12.14 · Incrementa play_count per brani community (fire-and-forget)
        if (seg.kind === "community" && seg.track_id) {
          endpoints.communityTrackPlay(seg.track_id).catch(() => {});
        }

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
        <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            {/* SIMBOLO GRAFICO R-A.I. — con firma autografo attaccata al bordo */}
            <div
              className="relative w-14 h-14 shrink-0 flex items-center justify-center"
              data-testid="rai-logo"
              style={{ filter: "drop-shadow(0 0 10px rgba(0,229,255,0.55))" }}
            >
              <img
                src="/rai-face.png"
                alt="R-A.I. symbol"
                className="w-full h-full object-contain"
                style={{ animation: "raiLogoFloat 6s ease-in-out infinite" }}
              />
              {/* Firma autografo — appena sopra-destra del cerchio, in diagonale */}
              <a
                href="https://www.facebook.com/profile.php?id=61592908061493"
                target="_blank"
                rel="noopener noreferrer"
                className="powered-by-signature focusable"
                data-testid="powered-by"
                title="L&C Project · Facebook"
              >
                Powered by <span className="lc-brand">L&amp;C Project</span>
              </a>
            </div>
            <div className="min-w-0">
              <BrandName className="font-display font-black text-lg sm:text-xl text-glow-blue" />
              <div className="label-mono !text-[9px] !tracking-widest mt-0.5">
                AI CONTROL ROOM
              </div>
            </div>
          </div>

          {/* Main Partner slot inline nell'header */}
          <div className="hidden md:flex flex-1 justify-center min-w-0">
            <MainPartnerSlot />
          </div>

          <nav className="flex items-center gap-2">
            {onAir ? (
              <div className="on-air-badge !py-1 !px-3 !text-[11px]" data-testid="live-indicator">
                <span className="dot" />
                <span>ON AIR</span>
              </div>
            ) : (
              <div className="standby-badge !py-1 !px-3 !text-[11px]" data-testid="standby-indicator">
                <span className="dot" />
                <span>STANDBY</span>
              </div>
            )}
            <a
              href="/dashboard"
              target="_blank"
              rel="noopener noreferrer"
              data-testid="admin-link"
              className="btn-outline focusable !py-1.5 !px-3 !text-[11px] hidden sm:inline-flex"
            >
              <Cpu className="w-3.5 h-3.5 mr-1.5" /> Regia
            </a>
          </nav>
        </div>
        {/* Main Partner mobile — sotto header */}
        <div className="md:hidden px-4 pb-2">
          <MainPartnerSlot />
        </div>
      </header>

      {/* ================ HERO — Visual + player centrali (compatto) ================ */}
      <section className="max-w-7xl mx-auto px-4 pt-4 pb-4 relative z-10">
        {/* Layout compatto: visual + now-playing affiancati su desktop */}
        <div className="grid lg:grid-cols-5 gap-4 items-stretch">
          {/* Visual centrale — HoloBrand 3D reattivo */}
          <div className="lg:col-span-2 relative">
            <div className="absolute -top-2 right-3 z-20">
              <VuMeter />
            </div>
            <HoloBrand
              isPlaying={isPlaying || broadcastMode === "live_external"}
              current={current}
              trackOverlay={trackOverlay}
            />
          </div>

          {/* NOW PLAYING — pannello compatto */}
          <div className="lg:col-span-3 console-panel p-4 md:p-5 flex flex-col">
            <CornerAccents />
            <span className="module-tag">MOD · A · NOW PLAYING</span>

            <div className="flex items-center gap-2 mt-3 mb-2 flex-wrap">
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

            <div className="font-display text-xl sm:text-2xl font-bold min-h-[2.5rem] flex items-center gap-3 text-glow-cyan flex-1" data-testid="now-playing-title">
              {isPreparing && !current && (
                <Loader2 className="w-5 h-5 text-cyan-400 animate-spin shrink-0" data-testid="loading-spinner" />
              )}
              <span>{current ? current.title : (isPreparing ? "Preparazione…" : (isPlaying ? "Un attimo…" : "Trasmissione in stand-by"))}</span>
            </div>

            {current?.script && (
              <p className="mt-2 text-zinc-400 leading-relaxed line-clamp-2 font-mono text-xs" data-testid="current-script">
                {current.script}
              </p>
            )}
            <div className="mt-2">
              <Waveform active={isPlaying} />
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button
                data-testid="play-pause-button"
                onClick={handlePlay}
                className="btn-primary flex items-center gap-2 focusable !text-base !px-6 !py-3"
                aria-label={isPlaying ? "Metti in pausa" : "Ascolta ora"}
              >
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                <span>{isPlaying ? "PAUSE" : "PLAY"}</span>
              </button>
              <button
                data-testid="skip-button"
                onClick={() => { radioEngine.stopAll(); }}
                className="btn-outline focusable flex items-center gap-2 !px-3 !py-3"
                title="Salta al prossimo"
                aria-label="Salta"
              >
                <SkipForward className="w-4 h-4" />
              </button>
              <div className="flex-1 grid grid-cols-3 gap-2">
                <MiniDisplay icon={Users}    label="LIVE"    value={station.listeners || 0} />
                <MiniDisplay icon={Waves}    label="SEGS"    value={station.total_segments || 0} />
                <MiniDisplay icon={Mic}      label="DJ"      value={djs.length} />
              </div>
            </div>
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

      {/* ================ DJ ROSTER — DAY (Leo · Aria · Max) ================ */}
      <section className="max-w-7xl mx-auto px-6 py-10 relative z-10" data-testid="dj-roster-day">
        <div className="flex items-end justify-between mb-6">
          <div>
            <div className="label-mono flex items-center gap-2"><Mic className="w-3 h-3" /> STAFF · MIC BANK · DAY</div>
            <h2 className="font-display font-bold text-2xl sm:text-3xl mt-1 text-glow-blue" data-testid="day-djs-heading">3 VOCI. 3 CERVELLI.</h2>
          </div>
          <div className="hidden sm:block"><VuMeter /></div>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {djs.filter(d => !d.night_slot).map(dj => (
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

      {/* ================ DJ ROSTER — NIGHT (Nyx · Hex · Luma) ================ */}
      <section className="max-w-7xl mx-auto px-6 py-4 relative z-10" data-testid="dj-roster-night">
        <div className="flex items-end justify-between mb-6">
          <div>
            <div className="label-mono flex items-center gap-2"><Disc3 className="w-3 h-3" /> STAFF · MIC BANK · CLUB NIGHT</div>
            <h2 className="font-display font-bold text-2xl sm:text-3xl mt-1 text-glow-cyan" style={{ color: "var(--console-cyan)" }} data-testid="night-djs-heading">3 DJ. 3 RITMI. L'ANIMA DEL CLUB.</h2>
          </div>
          <div className="hidden sm:block"><VuMeter /></div>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {djs.filter(d => d.night_slot).sort((a,b) => a.night_slot - b.night_slot).map(dj => (
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
                <div
                  aria-hidden
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background: "repeating-linear-gradient(0deg, rgba(0,229,255,0.06) 0px, rgba(0,229,255,0.06) 1px, transparent 1px, transparent 3px)",
                    mixBlendMode: "screen",
                  }}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="font-display font-black text-2xl leading-none" style={{ color: dj.accent_color, textShadow: `0 0 12px ${dj.accent_color}` }}>
                  {dj.name}
                </div>
                <VuMeter />
              </div>
              <div className="mt-2 text-[10px] font-mono uppercase tracking-widest text-zinc-500">
                <Cpu className="w-2.5 h-2.5 inline mr-1" /> {dj.llm_provider} · {dj.llm_model} · {dj.night_slot === 1 ? "22:00-00:00" : dj.night_slot === 2 ? "00:00-02:00" : "02:00-04:00"}
              </div>
              <p className="mt-3 text-xs font-mono text-zinc-300 leading-relaxed">
                {dj.personality}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ================ WALL COMMUNITY — brani approvati con play counter ================ */}
      <CommunityWallPublic />

      {/* ================ RE-PLAY · Archivio Storico ================ */}
      <section className="max-w-7xl mx-auto px-6 py-10 relative z-10" data-testid="replay-section">
        <div className="label-mono mb-2 flex items-center gap-2"><AudioWaveform className="w-3 h-3" /> RE-PLAY · ARCHIVIO STORICO</div>
        <h2 className="font-display font-bold text-2xl sm:text-3xl mb-2 text-glow-blue" data-testid="replay-heading">RE-PLAY (Archivio Storico)</h2>
        <p className="text-xs font-mono text-zinc-400 mb-6 max-w-2xl">
          Galleria per riascoltare i set dei DJ, i dischi del giorno e i momenti talk andati in onda.
        </p>
        <RadioErrorBoundary>
          <div className="space-y-2">
            {segments.length === 0 && (
              <div className="console-panel p-6 text-zinc-500 text-sm font-mono">
                <span className="text-cyan-400">▸</span> Archivio vuoto. Premi <span className="text-cyan-300">PLAY</span> per iniziare la trasmissione.
              </div>
            )}
            {segments.slice(-24).reverse().map((s, idx) => {
              const rowKey = s?.id ? `seg-${s.id}` : `seg-idx-${idx}`;
              const dj = djs.find(d => d.name === s.dj_name);
              const replayUrl = s.speech_audio_url || s.music_audio_url || null;
              return (
                <Dialog key={rowKey}>
                  <DialogTrigger asChild>
                    <button
                      className="console-panel p-4 flex items-start gap-4 w-full text-left hover:border-cyan-400/60 transition"
                      data-testid={`replay-segment-${s.id || idx}`}
                    >
                      <KindBadge kind={s.kind} />
                      <div className="min-w-0 flex-1">
                        <div className="font-display font-semibold truncate">{s.title}</div>
                        <div className="text-xs font-mono text-zinc-500 mt-1 uppercase tracking-widest">
                          <Mic className="w-2.5 h-2.5 inline mr-1" /> {s.dj_name} · <Cpu className="w-2.5 h-2.5 inline mx-1" /> {s.llm_provider}
                          {replayUrl && <span className="ml-2 text-cyan-400">· ▶ RE-PLAY</span>}
                        </div>
                        {s.script && <p className="text-sm font-mono text-zinc-400 mt-2 line-clamp-2">{s.script}</p>}
                      </div>
                    </button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl bg-[#02040A] text-white" data-testid={`replay-dialog-${s.id || idx}`}
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
                      {replayUrl && (
                        <audio
                          controls
                          preload="none"
                          src={replayUrl}
                          className="w-full mb-3"
                          style={{ height: 34 }}
                          data-testid={`replay-audio-${s.id || idx}`}
                        />
                      )}
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

// ==================== HOME CARDS — 4 moduli cover cinematografici ====================
function HomeCards({ djs, questionName, setQuestionName, questionText, setQuestionText, submitQuestion, busy }) {
  const [daily, setDaily] = React.useState(null);
  const [messages, setMessages] = React.useState([]);
  const [openId, setOpenId] = React.useState(null); // id della card espansa
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
  }, [messages, openId]);

  // Chiudi la card espansa con ESC
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") setOpenId(null); };
    if (openId) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId]);

  const toggle = (id) => setOpenId(prev => (prev === id ? null : id));

  return (
    <div className="mt-8 grid gap-5 md:grid-cols-2" data-testid="home-cards">
      {/* ====== MOD · B — L'ESPERIMENTO ====== */}
      <CoverCard
        id="esperimento"
        open={openId === "esperimento"}
        onToggle={() => toggle("esperimento")}
        image="/cards/esperimento.png"
        moduleTag="MOD · B · MANIFESTO"
        badgeColor="#00BFFF"
        icon={CircuitBoard}
        eyebrow="◂ L'ESPERIMENTO ▸"
        title="Radio che non dovrebbe esistere"
        testId="card-esperimento"
      >
        <p className="text-sm font-mono text-zinc-200 leading-relaxed">
          <span className="text-cyan-400">▸</span> Autonomia totale · zero conduttori umani.<br />
          <span className="text-cyan-400">▸</span> L'AI sceglie musica, scrive copioni, risponde live.<br />
          <span className="text-cyan-400">▸</span> Ogni glitch è la prova che siamo in territorio nuovo.
        </p>
        <div className="mt-4 flex items-center gap-2">
          <span className="chip"><Signal className="w-3 h-3" /> UPTIME 99.4%</span>
          <span className="chip"><Cpu className="w-3 h-3" /> 3 LLM</span>
        </div>
      </CoverCard>

      {/* ====== MOD · C — DISCO DEL GIORNO ====== */}
      <CoverCard
        id="disco"
        open={openId === "disco"}
        onToggle={() => toggle("disco")}
        image="/cards/disco-del-giorno.png"
        moduleTag="MOD · C · DAILY TRACK"
        badgeColor="#00E5FF"
        icon={Disc3}
        iconSpin
        eyebrow="◂ IL DISCO DEL GIORNO ▸"
        title="Un brano esclusivo"
        testId="card-disco-del-giorno"
      >
        <p className="text-xs font-mono text-zinc-300 leading-relaxed">
          Un brano generato dall'AI, in onda ogni 2 ore.
        </p>
        {daily ? (
          <div className="mt-3 rounded-lg p-3"
               style={{
                 background: "linear-gradient(180deg, rgba(0,20,30,0.85), rgba(0,10,20,0.9))",
                 border: "1px solid rgba(0,229,255,0.4)",
                 boxShadow: "inset 0 0 20px rgba(0,229,255,0.18)",
               }}
               data-testid="daily-track">
            <div className="flex items-center gap-2 mb-1.5">
              <AudioWaveform className="w-4 h-4" style={{ color: "var(--console-cyan)" }} />
              <div className="text-base font-bold text-glow-cyan" style={{ color: "var(--console-cyan)" }}>{daily.title}</div>
            </div>
            {daily.artist && <div className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest">▸ {daily.artist}</div>}
            {daily.style_tags && <div className="text-[10px] font-mono text-zinc-500 mt-1 italic">{daily.style_tags}</div>}
            {daily.audio_url && (
              <audio
                controls preload="auto"
                src={endpoints.audioUrl(daily.audio_url)}
                className="mt-2 w-full"
                style={{ height: 32 }}
                data-testid="daily-track-audio"
              />
            )}
          </div>
        ) : (
          <div className="mt-3 rounded-lg p-3 text-center"
               style={{
                 background: "rgba(0,0,0,0.5)",
                 border: "1px dashed rgba(0,191,255,0.3)",
               }}>
            <div className="text-[10px] font-mono text-cyan-500/80 uppercase tracking-widest">Generazione in coda</div>
            <div className="text-[9px] font-mono text-zinc-500 mt-0.5 italic">Ritenta più tardi.</div>
          </div>
        )}
      </CoverCard>

      {/* ====== MOD · D — HUMAN VS AI ====== */}
      <CoverCard
        id="human-vs-ai"
        open={openId === "human-vs-ai"}
        onToggle={() => toggle("human-vs-ai")}
        image="/cards/human-vs-ai.png"
        moduleTag="MOD · D · CHALLENGE"
        badgeColor="#FF6B1A"
        icon={Users}
        eyebrow="◂ HUMAN VS A.I. ▸"
        title="Umano contro algoritmo"
        titleGlow="orange"
        testId="card-human-vs-ai"
      >
        <p className="text-sm font-mono text-zinc-200 leading-relaxed">
          <span style={{ color: "var(--alert-orange-glow)" }}>▸</span> Manda un tuo brano.<br />
          <span style={{ color: "var(--alert-orange-glow)" }}>▸</span> Va in onda in rotazione con l'AI.<br />
          <span style={{ color: "var(--alert-orange-glow)" }}>▸</span> Il pubblico decide chi vince.
        </p>
        <Link
          to="/submit"
          data-testid="submit-track-link"
          className="btn-alert inline-flex items-center gap-2 mt-4"
          onClick={(e) => e.stopPropagation()}
        >
          <Send className="w-4 h-4" />
          Inviaci il brano
        </Link>
      </CoverCard>

      {/* ====== MOD · F — CLUB NIGHT (22:00-04:00) ====== */}
      <CoverCard
        id="club-night"
        open={openId === "club-night"}
        onToggle={() => toggle("club-night")}
        image="/cards/club-night.png"
        moduleTag="MOD · F · CLUB NIGHT"
        badgeColor="#00E5FF"
        icon={Disc3}
        iconSpin
        eyebrow="◂ CLUB NIGHT · 22:00-04:00 ▸"
        title="Techno & House · 6 ore di mixaggio AI"
        subtitle={djs.filter(d => d.night_slot).sort((a, b) => a.night_slot - b.night_slot).map(d => d.name).join(" · ")}
        testId="card-club-night"
      >
        <div className="text-sm font-mono text-zinc-200 leading-relaxed">
          <div className="mb-3">Tre DJ AI si passano il microfono ogni 2 ore:</div>
          <div className="space-y-2">
            {djs.filter(d => d.night_slot).sort((a,b) => a.night_slot - b.night_slot).map(dj => (
              <div key={dj.id} className="flex items-center gap-3 rounded-md p-2"
                   style={{ background: "rgba(0,191,255,0.06)", border: `1px solid ${dj.accent_color || "#00E5FF"}44` }}
                   data-testid={`club-dj-${dj.name}`}>
                {dj.avatar_url && <img src={dj.avatar_url} alt={dj.name} className="w-11 h-11 rounded object-cover"
                                       style={{ boxShadow: `0 0 10px ${dj.accent_color}88` }} />}
                <div className="flex-1 min-w-0">
                  <h3
                    className="font-display font-black text-sm dj-name-force"
                    data-testid={`club-dj-name-${dj.name}`}
                  >
                    {dj.name} <span className="text-[10px] font-mono text-zinc-400">
                      · {dj.night_slot === 1 ? "22:00-00:00" : dj.night_slot === 2 ? "00:00-02:00" : "02:00-04:00"}
                    </span>
                  </h3>
                  <div className="text-[10px] font-mono text-zinc-400 leading-tight truncate">{dj.personality}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <Link
          to="/submit"
          data-testid="submit-night-track-link"
          className="btn-primary inline-flex items-center gap-2 mt-4 !text-[11px]"
          onClick={(e) => e.stopPropagation()}
        >
          <Send className="w-3.5 h-3.5" />
          Manda il tuo brano techno/house
        </Link>
      </CoverCard>
      <section
        data-testid="card-chat-led"
        className="console-panel p-5 md:col-span-2"
        style={{ boxShadow: "0 0 0 1px rgba(0,191,255,0.28) inset, 0 14px 40px rgba(0,0,0,0.6), 0 0 32px rgba(0,191,255,0.22)" }}
      >
        <CornerAccents />
        <span className="module-tag">MOD · E · INTERAZIONE NEURALE LIVE</span>

        <div className="flex items-start gap-3 mt-3 mb-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
               style={{
                 background: "rgba(0,191,255,0.08)",
                 border: "1px solid var(--console-line-strong)",
                 boxShadow: "0 0 12px rgba(0,191,255,0.4)",
               }}>
            <MessageCircle className="w-5 h-5" style={{ color: "var(--console-cyan)", filter: "drop-shadow(0 0 6px rgba(0,229,255,0.8))" }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="label-mono">◂ INTERAZIONE NEURALE LIVE ▸</div>
            <h3 className="font-display font-black text-xl mt-0.5 text-glow-blue" data-testid="interazione-neurale-title">INTERAZIONE NEURALE LIVE</h3>
            <p className="text-[11px] font-mono text-zinc-400 leading-snug mt-1" data-testid="interazione-neurale-sub">
              Dialoga in tempo reale con il cervello di R-A.I. Scrivi, sfida o chiedi: ti risponderemo a voce in diretta.
            </p>
          </div>
          <div className="hidden sm:block"><VuMeter /></div>
        </div>

        {/* Display LED */}
        <div
          ref={scrollRef}
          data-testid="led-feed"
          className="led-screen h-44 overflow-y-auto text-sm space-y-1"
          style={{ fontSize: "15px", lineHeight: "1.35" }}
        >
          {messages.length === 0 ? (
            <div className="led-row led-line-sys text-center pt-12" style={{ fontSize: "16px" }}>
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
            placeholder="Cosa vuoi dire a R-A.I.?"
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
            <Send className="w-3 h-3" /> ENTRA IN ONDA
          </button>
        </form>
      </section>
    </div>
  );
}

// ==================== CoverCard — Card cover con espansione al click ====================
function CoverCard({
  id, open, onToggle, image, moduleTag, badgeColor = "#00BFFF",
  icon: Icon, iconSpin = false, eyebrow, title, titleGlow = "blue",
  subtitle, testId, children,
}) {
  const titleGlowClass = titleGlow === "orange" ? "text-glow-orange" : "text-glow-blue";
  return (
    <section
      data-testid={testId}
      className="cover-card"
      data-open={open}
      style={{
        boxShadow: open
          ? `0 0 0 1px ${badgeColor}66, 0 20px 60px rgba(0,0,0,0.7), 0 0 40px ${badgeColor}55`
          : `0 0 0 1px ${badgeColor}22, 0 14px 40px rgba(0,0,0,0.6), 0 0 22px ${badgeColor}22`,
      }}
    >
      {/* Cover image */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`${open ? "Chiudi" : "Apri"} ${title}`}
        className="cover-card-btn"
        data-testid={`${testId}-toggle`}
      >
        <img src={image} alt="" className="cover-card-img" loading="lazy" />

        {/* Vignette + scanlines overlay */}
        <span className="cover-card-vignette" aria-hidden />
        <span className="cover-card-scan" aria-hidden />

        {/* Corner accents */}
        <span className="corner-accent tl" />
        <span className="corner-accent tr" />
        <span className="corner-accent bl" />
        <span className="corner-accent br" />

        {/* Module tag */}
        <span className="cover-card-tag" style={{ color: badgeColor, borderColor: `${badgeColor}66` }}>
          {moduleTag}
        </span>

        {/* Icona hi-tech in alto a sinistra */}
        <span className="cover-card-icon" style={{ color: badgeColor, borderColor: `${badgeColor}55`, boxShadow: `0 0 16px ${badgeColor}66` }}>
          <Icon className={`w-5 h-5 ${iconSpin ? "spin-slow" : ""}`} />
        </span>

        {/* Titolo in overlay in basso */}
        <div className="cover-card-title-wrap">
          <div className="cover-card-eyebrow" style={{ color: badgeColor, textShadow: `0 0 8px ${badgeColor}` }}>
            {eyebrow}
          </div>
          <h3 className={`cover-card-title ${titleGlowClass}`}>
            {title}
          </h3>
          {subtitle && (
            <div className="cover-card-subtitle" data-testid={`${testId}-subtitle`}>
              {subtitle}
            </div>
          )}
          <div className="cover-card-hint">
            {open ? "▼ CHIUDI" : "▶ APRI MODULO"}
          </div>
        </div>
      </button>

      {/* Contenuto — slide dal basso al click */}
      <div
        className="cover-card-body"
        data-testid={`${testId}-body`}
        aria-hidden={!open}
      >
        <div className="cover-card-body-inner">
          {children}
        </div>
      </div>
    </section>
  );
}



// ==================== Main Partner Slot ====================
// Slot dinamico "MAIN PARTNER" nell'header. Se attivi >1 partner, alterna
// automaticamente ogni 8s con cross-fade.
function MainPartnerSlot() {
  const [partners, setPartners] = React.useState([]);
  const [idx, setIdx] = React.useState(0);

  React.useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const r = await endpoints.partnersActive();
        if (!live) return;
        setPartners(r?.partners || []);
      } catch (e) {}
    };
    load();
    const iv = setInterval(load, 60000);
    return () => { live = false; clearInterval(iv); };
  }, []);

  React.useEffect(() => {
    if (partners.length <= 1) return;
    const iv = setInterval(() => setIdx(i => (i + 1) % partners.length), 8000);
    return () => clearInterval(iv);
  }, [partners.length]);

  if (!partners || partners.length === 0) return null;
  const p = partners[Math.min(idx, partners.length - 1)];

  const inner = (
    <div
      className="flex items-center gap-2.5 px-3 py-1.5 rounded-md transition-all"
      style={{
        background: "linear-gradient(180deg, rgba(255,107,26,0.10), rgba(0,191,255,0.05))",
        border: "1px solid rgba(255,107,26,0.35)",
        boxShadow: "0 0 12px rgba(255,107,26,0.25), inset 0 0 8px rgba(0,191,255,0.1)",
      }}
    >
      <span className="font-mono text-[9px] tracking-[0.28em] uppercase" style={{ color: "var(--alert-orange-glow)", textShadow: "0 0 6px rgba(255,107,26,0.6)" }}>
        MAIN PARTNER
      </span>
      <span className="w-px h-4" style={{ background: "rgba(255,107,26,0.45)" }} />
      {p.logo_url && (
        <img
          src={p.logo_url}
          alt={p.name}
          className="h-6 max-w-[80px] object-contain"
          style={{ filter: "drop-shadow(0 0 6px rgba(0,229,255,0.5))" }}
        />
      )}
      <span className="font-display font-black text-sm text-glow-cyan truncate max-w-[180px]" style={{ color: "var(--console-cyan)" }}>
        {p.name}
      </span>
      {p.description && (
        <span className="hidden lg:inline font-mono text-[10px] text-zinc-400 truncate max-w-[180px]">
          · {p.description}
        </span>
      )}
    </div>
  );

  return p.link ? (
    <a href={p.link} target="_blank" rel="noopener noreferrer" data-testid="main-partner-slot" className="focusable">
      {inner}
    </a>
  ) : (
    <div data-testid="main-partner-slot">{inner}</div>
  );
}

// ==================== Wall Community pubblico ====================
function CommunityWallPublic() {
  const [tracks, setTracks] = React.useState([]);
  React.useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const r = await endpoints.communityWall();
        if (live) setTracks(r?.tracks || []);
      } catch (e) {}
    };
    load();
    const iv = setInterval(load, 15000);
    return () => { live = false; clearInterval(iv); };
  }, []);

  if (!tracks || tracks.length === 0) return null;

  return (
    <section className="max-w-7xl mx-auto px-6 py-10 relative z-10" data-testid="wall-community-public">
      <div className="flex items-end justify-between mb-6">
        <div>
          <div className="label-mono flex items-center gap-2"><Users className="w-3 h-3" /> WALL · COMMUNITY BOARD</div>
          <h2 className="font-display font-bold text-2xl sm:text-3xl mt-1 text-glow-blue">Brani umani in onda</h2>
          <p className="text-xs font-mono text-zinc-400 mt-2 max-w-xl">Chi ha caricato la sua musica e sta girando nella rotazione R-A.I. — contatore ascolti live.</p>
        </div>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tracks.slice(0, 12).map(t => (
          <div
            key={t.id}
            className="console-panel p-4 flex items-center gap-4"
            data-testid={`wall-card-${t.id}`}
            style={{
              boxShadow: t.is_night
                ? "0 0 0 1px rgba(0,229,255,0.35) inset, 0 0 24px rgba(0,229,255,0.2)"
                : "0 0 0 1px rgba(255,255,255,0.06) inset",
            }}
          >
            <div className="flex-1 min-w-0">
              <div className="font-display font-bold text-base truncate flex items-center gap-1.5">
                {t.is_night && <span title="Club Night">🌙</span>}
                {t.title}
              </div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mt-1 truncate">
                ▸ {t.author}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="font-mono text-2xl font-black text-glow-cyan" style={{ color: "var(--console-cyan)" }}>
                {String(t.play_count || 0).padStart(3, "0")}
              </div>
              <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest">plays</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

