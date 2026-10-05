import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Play, Pause, SkipForward, Radio, Send, Volume2, Sparkles, Users,
  Music2, Newspaper, MessageCircle, Loader2, Heart, ExternalLink, X,
  Mic, AudioWaveform, Cpu, Signal, Waves, CircuitBoard, Disc3, Antenna,
  Building2, Mail, Headphones, Maximize2
} from "lucide-react";
import { endpoints } from "@/lib/api";
import radioEngine from "@/lib/radioEngine";
import { toast } from "sonner";
import PulsingBrand from "@/components/PulsingBrand";
import LedWall from "@/components/LedWall";
import { RaiOrbLogo } from "@/components/RaiOrbLogo";
import RadioErrorBoundary from "@/components/RadioErrorBoundary";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import BrandName from "@/components/BrandName";
import MicButton from "@/components/MicButton";
import Cue from "@/components/Cue";
import BigCue from "@/components/BigCue";
import LiveBrainTicker from "@/components/LiveBrainTicker";
import RadioscopoWidget from "@/components/RadioscopoWidget";
import SyncLivePlayer from "@/components/SyncLivePlayer";
import ChatMini from "@/components/ChatMini";
import CueThinking from "@/components/CueThinking";
import ServicesDock from "@/components/ServicesDock";
import LiveBrain from "@/components/LiveBrain";

// SineWaveVisualizer — 3 onde sinusoidali blu neon, reattive all'audio (AnalyserNode).
// Piccolo canvas leggero sopra il feed della CHAT NEURALE.
function SineWaveVisualizer() {
  const canvasRef = React.useRef(null);
  const rafRef = React.useRef(null);
  React.useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const r = cvs.getBoundingClientRect();
      cvs.width = Math.floor(r.width * dpr);
      cvs.height = Math.floor(r.height * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cvs);
    const draw = () => {
      const analyser = radioEngine.getAnalyser();
      const bins = analyser ? analyser.frequencyBinCount : 128;
      const freq = new Uint8Array(bins);
      if (analyser) analyser.getByteFrequencyData(freq);
      let bass = 0, mid = 0, high = 0;
      if (analyser) {
        for (let i = 2; i < 14; i++) bass += freq[i];
        for (let i = 14; i < 60; i++) mid += freq[i];
        for (let i = 60; i < Math.min(120, bins); i++) high += freq[i];
        bass /= (12 * 255); mid /= (46 * 255); high /= (60 * 255);
      }
      const t = performance.now() * 0.001;
      const w = cvs.width, h = cvs.height;
      ctx.clearRect(0, 0, w, h);
      const draws = [
        { amp: 0.30 + bass * 0.55, freq: 1.6, speed: 1.3, color: "rgba(0,229,255,0.95)",  glow: 12 },
        { amp: 0.18 + mid  * 0.45, freq: 2.8, speed: 1.9, color: "rgba(0,150,255,0.75)",  glow: 8  },
        { amp: 0.10 + high * 0.55, freq: 4.4, speed: 2.6, color: "rgba(180,236,255,0.65)", glow: 6  },
      ];
      draws.forEach(({ amp, freq: f, speed, color, glow }) => {
        ctx.beginPath();
        ctx.lineWidth = 1.5 * dpr;
        ctx.strokeStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = glow;
        for (let x = 0; x <= w; x += 2 * dpr) {
          const phase = (x / w) * Math.PI * 2 * f + t * speed;
          const y = h / 2 + Math.sin(phase) * (h * 0.32 * amp);
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });
      ctx.shadowBlur = 0;
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(rafRef.current); ro.disconnect(); };
  }, []);
  return (
    <div
      data-testid="chat-sine-visualizer"
      className="rounded-lg mb-3 overflow-hidden"
      style={{
        background: "linear-gradient(180deg, rgba(0,20,30,0.55) 0%, rgba(0,10,20,0.85) 100%)",
        border: "1px solid rgba(0,229,255,0.28)",
        boxShadow: "inset 0 0 20px rgba(0,229,255,0.10), 0 0 12px rgba(0,229,255,0.15)",
        height: 44,
      }}
    >
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
}


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
  const fxLastRef = useRef(null);
  // v13.35 · FX di transizione persistente (Regia). Al cambio segmento
  // music↔talk, se configurato, viene iniettato tramite radioEngine.injectFx.
  const transitionFxRef = useRef(null);
  const [segments, setSegments] = useState([]);
  const [current, setCurrent] = useState(null);
  // Fix: "current" sopra viene dal loop /api/segments/generate, che non sa
  // nulla della Smart Flow Timeline (station_clock/timeline_events). Questo
  // stato separato legge /api/stream/now così un evento Timeline in onda
  // (es. kind="time_signal") può comunque raggiungere il titolo e il LedWall.
  const [timelineNow, setTimelineNow] = useState(null);
  const [streamNext, setStreamNext] = useState(null);   // v13.45 · prossimo brano da /api/stream/now
  const [lastDjLine, setLastDjLine] = useState("");     // v13.45 · ultimo parlato DJ visto
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
  // v13.40 · Effetto visivo LedWall (persistito in localStorage)
  const [ledEffect, setLedEffect] = useState(() => { try { return localStorage.getItem("rai:ledwall:effect") || "logo"; } catch { return "logo"; } });  // v13.41 · default: logo rotante a ritmo (ticket #247410), non piu' le onde sinusoidali
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
      // ⚡ PLAY LIVE FX: se admin ha pubblicato uno slot pending_fx e non è già stato consumato in questa sessione, riproducilo con ducking.
      const fx = s?.pending_fx;
      if (fx && fx.ts && fx.ts !== fxLastRef.current) {
        fxLastRef.current = fx.ts;
        try {
          const audioUrl = (fx.audio_url && fx.audio_url.startsWith("/api/"))
            ? endpoints.audioUrl(fx.audio_url)
            : fx.audio_url;
          if (audioUrl && radioEngine.injectFx) {
            radioEngine.injectFx(audioUrl);
          }
          // Consuma lo slot (best-effort)
          await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/admin/fx/consume`, { method: "POST" }).catch(() => {});
        } catch (e) {}
      }
    } catch (e) { /* noop */ }
  };

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    const iv = setInterval(() => setTick(t => t + 1), 5000);
    // v13.35 · Poll leggero (60s) per l'FX di transizione persistente.
    // Salvato in ref → nessun re-render, e disponibile subito al cambio segmento.
    const fetchTransitionFx = async () => {
      try {
        const r = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/station/transition-fx`);
        const d = await r.json();
        if (d && d.audio_url) {
          const abs = d.audio_url.startsWith("/api/")
            ? endpoints.audioUrl(d.audio_url)
            : d.audio_url;
          transitionFxRef.current = abs;
        } else {
          transitionFxRef.current = null;
        }
      } catch { /* noop */ }
    };
    fetchTransitionFx();
    const ivFx = setInterval(fetchTransitionFx, 60000);
    return () => {
      mountedRef.current = false;
      clearInterval(iv);
      clearInterval(ivFx);
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

  // Fix: poll separato di /api/stream/now (station_clock) per sapere se un
  // evento Smart Flow Timeline (time_signal, jingle, ora_esatta, ecc.) è
  // attualmente in onda, a prescindere dal loop segments/generate qui sopra.
  useEffect(() => {
    const pollTimelineNow = async () => {
      try {
        const r = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/stream/now`);
        const d = await r.json();
        if (!mountedRef.current) return;
        setTimelineNow(d?.current || null);
        setStreamNext(Array.isArray(d?.next) ? (d.next[0] || null) : (d?.next || null));
      } catch (e) { /* silent */ }
    };
    pollTimelineNow();
    const iv = setInterval(pollTimelineNow, 5000);
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
          // v13.36 · FIX (ticket #247410): l'FX di transizione era limitato
          // a music<->talk. Il cliente chiedeva esplicitamente l'FX anche
          // "tra segmenti e song" (song-to-song incluso) — aggiunta la
          // terza condizione musicToMusic.
          const musicToMusic = prevKind === "music" && seg.kind === "music";
          const isJingleTransition = prevKind === "jingle" || seg.kind === "jingle";
          if ((musicToSpeech || speechToMusic || musicToMusic) && !isJingleTransition) {
            // v13.35 · Se il Direttore ha configurato un FX di transizione
            // persistente, usa quello (file caricato) invece dello stinger
            // procedurale. Fallback allo stinger se il fetch è ancora
            // pending o non c'è un FX attivo.
            const fxUrl = transitionFxRef.current;
            if (fxUrl && radioEngine.injectFx) {
              try { radioEngine.injectFx(fxUrl); } catch (e) {
                radioEngine.playStinger(prevKind, seg.kind).catch(() => {});
              }
            } else {
              radioEngine.playStinger(prevKind, seg.kind).catch(() => {});
            }
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

  // Fix: quando un evento Timeline (time_signal, jingle, ora_esatta, ecc.) è
  // in onda su station_clock, mostra quello come "current" invece del
  // segmento del loop legacy — così titolo e LedWall riflettono l'evento
  // realmente trasmesso. Il loop segments/generate resta invariato per il
  // resto (musica/talk generati on-demand) quando nessun evento è attivo.
  const effectiveCurrent = (timelineNow && timelineNow.is_timeline) ? timelineNow : current;
  const displayCurrent = effectiveCurrent || timelineNow;  // v13.45 · in standby mostra comunque il brano in onda sul clock
  const _djScript = effectiveCurrent?.spoken_text || effectiveCurrent?.script || "";
  useEffect(() => { if (_djScript && _djScript.trim()) setLastDjLine(_djScript.trim()); }, [_djScript]);

  return (
    <div className="relative min-h-screen text-white">
      <ServicesDock />
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
          <div className="flex items-center gap-3 min-w-0 relative header-brand-group">
            {/* SIMBOLO GRAFICO R-A.I. — con firma autografo attaccata al bordo */}
            <div
              className="w-14 h-14 shrink-0 flex items-center justify-center"
              data-testid="rai-logo"
              style={{ filter: "drop-shadow(0 0 10px rgba(0,229,255,0.55))" }}
            >
              <RaiOrbLogo size={56} />
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
              className="btn-outline focusable !py-1.5 !px-2.5 !text-[11px] inline-flex items-center"
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

      {/* ================ HERO — Stazione broadcast 3-col (v13.45) ================
          Desktop: SX player + brano in onda · CENTRO LedWall dominante · DX info essenziali.
          Mobile: LedWall a piena larghezza per primo, poi player, poi info, poi chat. */}
      <section className="max-w-7xl mx-auto px-3 sm:px-4 pt-2 pb-0 relative z-10" data-testid="home-hero">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 lg:gap-4 items-stretch">

          {/* ── SX (3/12): PLAYER + BRANO IN ONDA ── */}
          <div className="order-2 lg:order-1 lg:col-span-3 console-panel p-4 flex flex-col min-w-0" data-testid="home-player-col">
            <CornerAccents />
            <div className="flex items-center justify-between gap-2">
              {onAir ? (
                <span className="on-air-badge !py-0.5 !px-2 !text-[10px]"><span className="dot" /> ON AIR</span>
              ) : (
                <span className="standby-badge !py-0.5 !px-2 !text-[10px]"><span className="dot" /> STANDBY</span>
              )}
              {displayCurrent?.kind && <KindBadge kind={displayCurrent.kind} />}
            </div>

            {/* Copertina (se disponibile) oppure avatar R-AI */}
            <div className="mt-4 flex items-center gap-3">
              {displayCurrent?.image_url ? (
                <img src={displayCurrent.image_url} alt="" className="w-20 h-20 rounded-lg object-cover shrink-0"
                  style={{ boxShadow: "0 0 18px rgba(0,229,255,0.35)" }} data-testid="now-playing-cover" />
              ) : (
                <BigCue
                  size={80}
                  mode={(function () {
                    const k = (effectiveCurrent?.kind || "").toLowerCase();
                    if (!isPlaying && !isPreparing) return "idle";
                    if (isPreparing) return "thinking";
                    if (["talk","joke","weather","horoscope","interview","motivation","history","news","answer","community"].includes(k)) return "speaking";
                    if (k === "music") return "happy";
                    if (k === "time_signal") return "alert";
                    if (k === "jingle") return "listen";
                    return "idle";
                  })()}
                />
              )}
              <div className="min-w-0 flex-1" data-testid="now-playing-title">
                <div className="text-[9px] font-mono uppercase tracking-[0.3em] text-cyan-400/80">In onda</div>
                <div className="font-display text-xl sm:text-2xl font-black text-white leading-tight line-clamp-2" data-testid="current-title">
                  {displayCurrent?.title || "R-A.I. Radio"}
                </div>
                <div className="text-sm text-zinc-300 truncate mt-0.5" data-testid="current-artist">
                  {displayCurrent?.artist || displayCurrent?.dj_name || "La radio che pensa da sola"}
                </div>
              </div>
            </div>

            <div className="mt-3"><Waveform active={isPlaying} /></div>

            <div className="mt-4">
              <SyncLivePlayer />
            </div>

            {/* elementi tecnici nascosti dalla home (restano nel codice) */}
            {/* Ticket #247410: ripristinato su richiesta esplicita del cliente —
                era stato disattivato durante un redesign non collegato a questo
                ticket, non per un bug. */}
            <LiveBrainTicker current={effectiveCurrent} />
            {false && <CueThinking current={effectiveCurrent} />}
          </div>

          {/* ── CENTRO (6/12): LEDWALL dominante · su mobile per primo, piena larghezza ── */}
          <div className="order-1 lg:order-2 lg:col-span-6 relative flex flex-col min-w-0 -mx-3 sm:mx-0" data-testid="home-ledwall-col"
            style={{ minHeight: "min(62vw, 560px)" }}>
            <div className="absolute -top-2 right-3 z-20 hidden sm:block"><VuMeter /></div>
            <div className="absolute top-2 left-3 z-20 flex items-center gap-1.5" data-testid="ledwall-effect-control">
              <label className="sr-only" htmlFor="ledwall-effect-select">Effetto visivo</label>
              <select
                id="ledwall-effect-select"
                value={ledEffect}
                onChange={(e) => { setLedEffect(e.target.value); try { localStorage.setItem("rai:ledwall:effect", e.target.value); } catch {} }}
                data-testid="ledwall-effect-select"
                className="bg-black/70 border border-cyan-400/30 rounded px-1.5 py-0.5 text-[10px] font-mono text-cyan-100"
              >
                <option value="logo">Logo rotante a ritmo</option>
                <option value="auto">Auto (onde sinusoidali)</option>
                <option value="gradient">Gradiente animato</option>
                <option value="rings">Anelli/particelle a ritmo</option>
                <option value="eq">Barre EQ/waveform</option>
                <option value="starfield">Starfield/warp</option>
                <option value="holo">Sfera olografica</option>
              </select>
            </div>
            <LedWall
              isPlaying={isPlaying || broadcastMode === "live_external"}
              current={effectiveCurrent}
              trackOverlay={trackOverlay}
              djs={djs}
              fillHeight
              effect={ledEffect}
            />
          </div>

          {/* ── DX (3/12): INFO ESSENZIALI + chat ── */}
          <div className="order-3 lg:order-3 lg:col-span-3 flex flex-col gap-3 min-w-0" data-testid="home-info-col">
            <div className="console-panel p-4 flex flex-col gap-4">
              <CornerAccents />
              <div data-testid="home-next-track">
                <div className="text-[9px] font-mono uppercase tracking-[0.3em] text-zinc-500">A seguire</div>
                <div className="font-display font-bold text-white text-base leading-tight mt-1 line-clamp-2">
                  {streamNext?.title || "In preparazione…"}
                </div>
                {streamNext?.artist && <div className="text-xs text-zinc-400 truncate">{streamNext.artist}</div>}
              </div>
              <div data-testid="home-regia-status">
                <div className="text-[9px] font-mono uppercase tracking-[0.3em] text-zinc-500">Regia</div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="font-display font-bold text-white text-base">
                    {broadcastMode === "live_external" ? "Diretta manuale" : onAir ? "Automazione AI attiva" : "In attesa del Play"}
                  </span>
                  <span className="w-2 h-2 rounded-full" style={{ background: onAir ? "#FF6B1A" : "#00BFFF", boxShadow: `0 0 10px ${onAir ? "#FF6B1A" : "#00BFFF"}` }} />
                </div>
                <div className="text-xs text-zinc-400 mt-0.5">
                  {effectiveCurrent?.dj_name ? `Al microfono: ${effectiveCurrent.dj_name}` : `${djs.length} speaker in studio`} · {station.listeners || 0} in ascolto
                </div>
              </div>
              <div data-testid="home-last-dj-message">
                <div className="text-[9px] font-mono uppercase tracking-[0.3em] text-zinc-500">Ultimo messaggio del DJ</div>
                <p className="text-sm text-zinc-200 leading-relaxed mt-1 line-clamp-4 italic">
                  {lastDjLine ? `“${lastDjLine}”` : "I DJ stanno per prendere la parola…"}
                </p>
              </div>
            </div>
            <div className="flex flex-col flex-1 min-h-[220px] lg:min-h-0" style={{ maxHeight: 360 }} data-testid="home-chat-col">
              <ChatMini heightClass="h-full" />
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

      </section>

      {/* ================ LIVE BRAIN — terminale operazioni AI, prima delle Stelle (v13.46) ================ */}
      <section className="max-w-7xl mx-auto px-3 sm:px-4 pt-3 pb-1 relative z-10" data-testid="home-live-brain">
        <LiveBrain current={effectiveCurrent} segments={segments} />
      </section>

      {/* ================ LE STELLE DI NEURONI — barretta spie tra hero e team (v13.5) ================ */}
      <div data-testid="radioscope-section" className="relative z-10">
        <RadioscopoWidget />
      </div>

      {/* ================ TEAM STRIP — attaccato al mixer (v13.5) ================ */}
      <section className="max-w-7xl mx-auto px-4 pt-1 pb-2 relative z-10" data-testid="rai-team-strip">
        <div
          className="flex items-center gap-3 rounded-xl px-4 py-3 overflow-x-auto"
          style={{
            background: "linear-gradient(180deg, rgba(4,10,22,0.35) 0%, rgba(2,6,15,0.55) 100%)",
            backdropFilter: "blur(14px) saturate(1.2)",
            WebkitBackdropFilter: "blur(14px) saturate(1.2)",
            border: "1px solid rgba(0,229,255,0.20)",
            boxShadow: "0 0 18px rgba(0,191,255,0.12), inset 0 0 10px rgba(0,229,255,0.08)",
          }}
        >
          <div className="shrink-0 flex flex-col leading-none pr-2 border-r border-cyan-500/15">
            <span className="text-[9px] font-mono uppercase tracking-widest text-cyan-500">STAFF</span>
            <span
              className="text-[11px] font-bold text-glow-blue"
              data-testid="rai-team-heading"
              style={{ fontFamily: '"Orbitron","Share Tech Mono",ui-monospace,monospace', letterSpacing: "0.08em" }}
            >
              R-A.I. TEAM
            </span>
          </div>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {djs
              .slice()
              .sort((a, b) => (a.night_slot ? 1 : 0) - (b.night_slot ? 1 : 0) || (a.night_slot || 0) - (b.night_slot || 0))
              .map(dj => (
                <Dialog key={dj.id}>
                  <DialogTrigger asChild>
                    <button
                      type="button"
                      data-testid={`team-chip-${dj.name}`}
                      className="flex flex-col items-center gap-0.5 shrink-0 hover:-translate-y-0.5 transition-transform focusable"
                      title={dj.name}
                    >
                      <div
                        className="w-11 h-11 rounded-full overflow-hidden bg-black"
                        style={{
                          border: `1px solid ${dj.accent_color || "#00BFFF"}99`,
                          boxShadow: `0 0 10px ${dj.accent_color || "#00BFFF"}88`,
                        }}
                      >
                        {dj.avatar_url && (
                          <img src={dj.avatar_url} alt={dj.name} className="w-full h-full object-cover" loading="lazy" />
                        )}
                      </div>
                      <span
                        className="text-[10px] font-black leading-none dj-name-force"
                        style={{
                          fontFamily: '"Orbitron","Share Tech Mono",ui-monospace,monospace',
                          letterSpacing: "0.05em",
                          color: dj.accent_color || "#00BFFF",
                          textShadow: `0 0 6px ${dj.accent_color || "#00BFFF"}`,
                        }}
                      >
                        {dj.name}
                      </span>
                    </button>
                  </DialogTrigger>
                  <DialogContent
                    className="max-w-lg bg-[#02040A] text-white"
                    data-testid={`team-dialog-${dj.name}`}
                    style={{
                      border: `1px solid ${dj.accent_color || "#00BFFF"}66`,
                      boxShadow: `0 0 40px ${dj.accent_color || "#00BFFF"}44`,
                    }}
                  >
                    <DialogHeader>
                      <div className="flex items-center gap-4">
                        {dj.avatar_url && (
                          <img
                            src={dj.avatar_url}
                            alt={dj.name}
                            className="w-20 h-20 rounded-lg object-cover"
                            style={{
                              border: `1px solid ${dj.accent_color || "#00BFFF"}77`,
                              boxShadow: `0 0 24px ${dj.accent_color || "#00BFFF"}66`,
                            }}
                          />
                        )}
                        <div>
                          <DialogTitle
                            className="text-2xl font-display font-black"
                            style={{ color: dj.accent_color || "#00BFFF", textShadow: `0 0 12px ${dj.accent_color || "#00BFFF"}` }}
                          >
                            {dj.name}
                          </DialogTitle>
                          <DialogDescription className="text-xs font-mono uppercase tracking-widest text-cyan-500 mt-1">
                            {dj.llm_provider} · {dj.llm_model}
                            {dj.night_slot ? ` · ${dj.night_slot === 1 ? "22:00-00:00" : dj.night_slot === 2 ? "00:00-02:00" : "02:00-04:00"}` : " · SPEAKER"}
                          </DialogDescription>
                        </div>
                      </div>
                    </DialogHeader>
                    <p className="text-sm font-mono text-zinc-300 leading-relaxed mt-2">
                      {dj.personality || "Nessuna bio disponibile."}
                    </p>
                  </DialogContent>
                </Dialog>
              ))}
          </div>
          <div className="shrink-0 pl-2 border-l border-cyan-500/15">
            <NextEventChip />
          </div>
        </div>
      </section>

      {/* ================ R-A.I. TEAM — 3 SPEAKER + 3 DJ CLUB, compatto orizzontale ================ */}
      {/* ================ SPONSOR CTA — DIVENTA PARTNER (sponsor-grade) ================ */}
      <section className="max-w-7xl mx-auto px-6 py-1 relative z-10" data-testid="sponsor-cta-section">
        <Link
          to="/partner"
          data-testid="card-diventa-partner"
          className="relative flex items-center gap-4 rounded-2xl px-5 py-4 group focusable overflow-hidden"
          style={{
            border: "1px solid rgba(255,184,77,0.45)",
            background: "linear-gradient(120deg, rgba(255,107,26,0.10) 0%, rgba(0,0,0,0.55) 55%, rgba(255,184,77,0.10) 100%)",
            backdropFilter: "blur(16px) saturate(1.25)",
            WebkitBackdropFilter: "blur(16px) saturate(1.25)",
            boxShadow: "0 0 0 1px rgba(255,184,77,0.28) inset, 0 18px 44px rgba(0,0,0,0.6), 0 0 44px rgba(255,184,77,0.20)",
          }}
        >
          <CornerAccents />
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
            style={{
              background: "rgba(255,184,77,0.12)",
              border: "1px solid rgba(255,184,77,0.6)",
              boxShadow: "0 0 18px rgba(255,184,77,0.55), inset 0 0 12px rgba(255,184,77,0.18)",
            }}
          >
            <Building2 className="w-6 h-6" style={{ color: "#FFD79A", filter: "drop-shadow(0 0 6px rgba(255,184,77,0.9))" }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="label-mono" style={{ color: "#FFB84D" }}>◂ SPONSOR PARTNER ▸</div>
            <h3
              className="font-display font-black text-lg sm:text-xl leading-tight"
              data-testid="diventa-partner-title"
              style={{
                fontFamily: '"Orbitron","Share Tech Mono",ui-monospace,monospace',
                letterSpacing: "0.05em",
                color: "#FFD79A",
                textShadow: "0 0 10px rgba(255,184,77,0.75), 0 0 22px rgba(255,107,26,0.35)",
              }}
            >
              DIVENTA PARTNER · SPONSORIZZA R-A.I.
            </h3>
            <p className="text-[11px] font-mono text-zinc-200 mt-0.5">
              <span style={{ color: "#FFB84D" }}>▸</span> Spot MP3 o generato dall'AI · scheduling per data + frequenza · approvazione admin.
            </p>
          </div>
          <div
            className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-md text-[11px] font-mono uppercase tracking-widest shrink-0"
            style={{
              border: "1px solid rgba(255,184,77,0.55)",
              color: "#FFD79A",
              background: "rgba(0,0,0,0.35)",
              textShadow: "0 0 6px rgba(255,184,77,0.7)",
            }}
          >
            <Send className="w-3.5 h-3.5" /> Invia richiesta →
          </div>
        </Link>
      </section>

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

      {/* ================ WALL COMMUNITY — brani approvati con play counter ================ */}
      <CommunityWallPublic />

      <footer className="max-w-7xl mx-auto px-6 py-4 text-[10px] font-mono uppercase tracking-widest text-zinc-600 border-t mt-8 relative z-10"
              style={{ borderColor: "var(--console-line)" }}>
        <div className="flex items-center gap-2 flex-wrap">
          <Antenna className="w-3 h-3" />
          R-A.I. · Prototipo Beta · Orchestrato da GPT-5.2 · Claude Sonnet 4.5 · Gemini 3 Flash · Nessun umano in cabina.
        </div>
      </footer>

      {/* Donate button — corner-anchored on mobile (ticket 239289: a fixed,
          dead-center bottom pill sat on top of whatever content/status panel
          happened to be at the bottom of the viewport at any scroll
          position). Desktop keeps the wide centered pill; mobile shrinks to
          an icon-first pill tucked in the bottom-right corner, out of the
          main content column, with safe-area padding for notched devices. */}
      <button
        onClick={() => setShowDonate(true)}
        data-testid="donate-open-button"
        className="fixed z-50 group flex items-center gap-2 px-3.5 py-2.5 sm:px-5 sm:py-3 rounded-full font-mono font-bold text-xs uppercase tracking-widest text-white shadow-2xl transition-transform hover:scale-105 active:scale-95 focusable right-3 bottom-3 sm:right-1/2 sm:bottom-6 sm:translate-x-1/2"
        style={{
          background: "linear-gradient(135deg, #FF6B1A 0%, #FF8A3D 100%)",
          boxShadow: "0 8px 30px rgba(255,107,26,0.45), 0 0 0 1px rgba(255,255,255,0.1) inset",
          marginBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        <Heart className="w-4 h-4 shrink-0" fill="currentColor" />
        <span className="hidden sm:inline">Sostieni il progetto</span>
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
  // Chat Neurale: pulisci messaggi all'avvio → mostra solo i nuovi arrivati dopo il mount.
  const sessionStartRef = React.useRef(new Date().toISOString());

  React.useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const [d, q] = await Promise.all([endpoints.dailyTrack(), endpoints.questionsRecent(30)]);
        if (!live) return;
        setDaily(d?.track || null);
        const startedAt = sessionStartRef.current;
        const fresh = (q?.messages || []).filter(m => (m.created_at || "") >= startedAt);
        setMessages(fresh);
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
    <section className="max-w-7xl mx-auto px-6 py-1 relative z-10" data-testid="wall-community-public">
      <div className="flex items-end justify-between mb-3">
        <div>
          <div className="label-mono flex items-center gap-2"><Users className="w-3 h-3" /> WALL · COMMUNITY BOARD</div>
          <h2 className="font-display font-bold text-xl sm:text-2xl mt-0.5 text-glow-blue">Brani umani in onda</h2>
          <p className="text-[11px] font-mono text-zinc-400 mt-1 max-w-xl">Chi ha caricato la sua musica e sta girando nella rotazione R-A.I. — contatore ascolti live.</p>
        </div>
      </div>
      <div
        className="rounded-xl p-3"
        style={{
          background: "rgba(0,0,0,0.35)",
          border: "1px solid rgba(0,191,255,0.18)",
          maxHeight: "22rem",
          overflowY: "auto",
        }}
        data-testid="wall-community-scroll"
      >
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {tracks.map(t => (
            <div
              key={t.id}
              className="console-panel p-3 flex items-center gap-3"
              data-testid={`wall-card-${t.id}`}
              style={{
                boxShadow: t.is_night
                  ? "0 0 0 1px rgba(0,229,255,0.35) inset, 0 0 18px rgba(0,229,255,0.16)"
                  : "0 0 0 1px rgba(255,255,255,0.06) inset",
              }}
            >
              <div className="flex-1 min-w-0">
                <div className="font-display font-bold text-sm truncate flex items-center gap-1.5">
                  {t.is_night && <span title="Club Night">🌙</span>}
                  {t.title}
                </div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mt-0.5 truncate">
                  ▸ {t.author}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-mono text-xl font-black text-glow-cyan" style={{ color: "var(--console-cyan)" }}>
                  {String(t.play_count || 0).padStart(3, "0")}
                </div>
                <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest">plays</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}



// ==================== NextEventChip — rubrica in arrivo all'ora successiva ====================
function NextEventChip() {
  const [now, setNow] = React.useState(new Date());
  React.useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(iv);
  }, []);
  const nextHour = (now.getHours() + 1) % 24;
  // Convenzione backend: ora PARI → Umani Vs Algoritmo · DISPARI → Disco del Giorno
  const isEven = nextHour % 2 === 0;
  const label = isEven ? "Umani Vs Algoritmo" : "Il Disco del Giorno";
  const color = isEven ? "#00E5FF" : "#FFB84D";
  const hh = String(nextHour).padStart(2, "0");
  return (
    <div
      data-testid="next-event-chip"
      className="hidden md:flex flex-col items-end px-3 py-1.5 rounded-lg"
      style={{
        border: `1px solid ${color}55`,
        background: "rgba(0,0,0,0.4)",
        boxShadow: `0 0 12px ${color}33`,
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
      title={`Prossima rubrica alle ${hh}:00`}
    >
      <div className="text-[9px] font-mono uppercase tracking-widest" style={{ color: `${color}bb` }}>
        ▸ NEXT EVENT · {hh}:00
      </div>
      <div
        className="text-xs font-mono font-bold"
        style={{
          color,
          fontFamily: '"Share Tech Mono","VT323",ui-monospace,monospace',
          textShadow: `0 0 6px ${color}aa`,
        }}
      >
        {label}
      </div>
    </div>
  );
}
