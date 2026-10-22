import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link } from "react-router-dom";
import {
  Play, Pause, SkipForward, Radio, Send, Volume2, Sparkles, Users,
  Music2, Newspaper, MessageCircle, Loader2, Heart, ExternalLink, X,
  Mic, AudioWaveform, Cpu, Signal, Waves, CircuitBoard, Disc3, Antenna,
  Building2, Mail, Headphones, Maximize2, Minimize2, Home, ChevronDown, FileDown, VolumeX
} from "lucide-react";
import { api, endpoints } from "@/lib/api";
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
import ServicesDock, { StudiosDialog, ContattiDialog } from "@/components/ServicesDock";
import LiveBrain from "@/components/LiveBrain";

// v13.64 · Home: effetti LedWall in rotazione automatica nel hero (il logo R-A.I. è già nel DOM sopra il LedWall)
const LED_ROTATION = ["gradient", "rings", "eq", "starfield", "holo", "auto"];
const LED_ROTATION_MS = 22000;

// SineWaveVisualizer — 3 onde sinusoidali blu neon, reattive all'audio (AnalyserNode).
// Piccolo canvas leggero sopra il feed della CHAT NEURALE.
// v13.81 · Ticket #247410: il pulsante "Sostieni il progetto" (fisso in basso) copriva la banda
// news scorrevole del LedWall in home. Quando si sovrappongono, il pulsante sale sopra la banda.
function useLiftAboveNewsBand(btnRef) {
  const [lift, setLift] = useState(0);
  const liftRef = useRef(0);
  useEffect(() => {
    let raf = 0;
    const check = () => {
      raf = 0;
      const btn = btnRef.current;
      const band = document.querySelector('[data-testid="ledwall-news-band"]');
      let next = 0;
      if (btn && band) {
        const b = band.getBoundingClientRect();
        const r = btn.getBoundingClientRect();
        const top = r.top + liftRef.current, bottom = r.bottom + liftRef.current;   // posizione senza sollevamento
        if (b.height > 0 && b.left < r.right && b.right > r.left && b.top < bottom && b.bottom > top) next = Math.ceil(bottom - b.top + 10);
      }
      if (next !== liftRef.current) { liftRef.current = next; setLift(next); }
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(check); };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const iv = setInterval(schedule, 1000);   // la banda compare/sparisce con la coda news
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      clearInterval(iv);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [btnRef]);
  return lift;
}

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

// v13.81 · Contenitore notturno in onda (LUMA / HEX / NYX)
function ContainerBadge({ c }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-mono tracking-widest border"
      style={{ borderColor: `${c.color || "#7DF9FF"}88`, color: c.color || "#7DF9FF", background: `${c.color || "#7DF9FF"}14` }}
      title={`${c.description || "Contenitore notturno"} · ${c.start}–${c.end}`} data-testid="active-container-badge">
      <span className="font-display font-black">{c.name}</span><span className="opacity-70">{c.start}–{c.end}</span>
    </span>
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
  const [syncPlaying, setSyncPlaying] = useState(false);  // v13.65 · stato reale del Sync Live (evento rai:sync:play)
  const [discoDelGiorno, setDiscoDelGiorno] = useState(null);  // v13.74 · brano dell'appuntamento Timeline "Disco del Giorno" di oggi (aired/scheduled), lettura pubblica
  const [activeContainer, setActiveContainer] = useState(null);  // v13.81 · contenitore notturno in onda (LUMA/HEX/NYX), lettura pubblica
  useEffect(() => {
    let live = true;
    const load = async () => {
      try { const r = await api.get("/containers/active"); if (live) setActiveContainer(r.data?.container || null); }
      catch (e) { if (live) setActiveContainer(null); }
    };
    load();
    const iv = setInterval(load, 60000);
    return () => { live = false; clearInterval(iv); };
  }, []);
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const r = await api.get("/appointments/disco-del-giorno/today");
        const d = r.data || {};
        if (live) setDiscoDelGiorno(d.track?.title ? { ...d.track, status: d.status, scheduled_at: d.scheduled_at, aired_at: d.aired_at } : null);
      } catch (e) { if (live) setDiscoDelGiorno(null); }
    };
    load();
    const iv = setInterval(load, 120000);
    return () => { live = false; clearInterval(iv); };
  }, []);
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
  const [ledEffect, setLedEffect] = useState(() => { try { return localStorage.getItem("rai:ledwall:effect") || "rotate"; } catch { return "rotate"; } });  // v13.64 · default: rotazione automatica degli effetti
  const [showDonate, setShowDonate] = useState(false);
  const donateBtnRef = useRef(null);
  const donateLift = useLiftAboveNewsBand(donateBtnRef);   // v13.81
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

  // Ticket #247410: il player legacy (radioEngine, avviabile solo dai controlli
  // media del SO - lock screen, Bluetooth/autoradio) e SyncLivePlayer (bottone
  // in pagina) sono due motori audio del tutto indipendenti, senza alcun
  // coordinamento. Se uno parte mentre l'altro e' gia' attivo, suonano insieme
  // leggermente sfasati: un vero e proprio eco raddoppiato, non un artefatto
  // del decoder. Qui il legacy si ferma da solo appena SyncLivePlayer parte.
  useEffect(() => {
    const onSyncPlay = (ev) => {
      if (ev?.detail?.playing && isPlaying) {
        stopFlag.current = true;
        try { radioEngine.stopAll(); } catch (e) {}
        setIsPlaying(false);
        setIsPreparing(false);
      }
    };
    window.addEventListener("rai:sync:play", onSyncPlay);
    return () => window.removeEventListener("rai:sync:play", onSyncPlay);
  }, [isPlaying]);

  useEffect(() => {
    const applyCommand = (cmd) => {
      if (!cmd) return;
      switch (cmd.type) {
        case "skip":
          try { radioEngine.stopAll(); } catch (e) {}
          try { window.dispatchEvent(new CustomEvent("rai:sync:skip")); } catch (e) {}
          break;
        case "pause":
          stopFlag.current = true;
          try { radioEngine.stopAll(); } catch (e) {}
          try { window.dispatchEvent(new CustomEvent("rai:sync:pause")); } catch (e) {}
          setIsPlaying(false);
          break;
        case "resume":
          toast.info("L'admin ha inviato PLAY — clicca Ascolta ora per riprendere.");
          break;
        case "jingle_now":
          // Il backend inserisce il jingle con lo stesso meccanismo di force-advance
          // dello Skip: serve lo stesso resync forzato per chi e' gia' in Sync Live.
          try { window.dispatchEvent(new CustomEvent("rai:sync:skip")); } catch (e) {}
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
    // Ticket #247410: avvisa SyncLivePlayer (se gia' attivo) di fermarsi -
    // stesso coordinamento visto sopra, nell'altra direzione.
    try { window.dispatchEvent(new CustomEvent("rai:legacy:play")); } catch (e) {}
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

  const onAir = isPlaying || syncPlaying || broadcastMode === "live_external";

  // Fix: quando un evento Timeline (time_signal, jingle, ora_esatta, ecc.) è
  // in onda su station_clock, mostra quello come "current" invece del
  // segmento del loop legacy — così titolo e LedWall riflettono l'evento
  // realmente trasmesso. Il loop segments/generate resta invariato per il
  // resto (musica/talk generati on-demand) quando nessun evento è attivo.
  const effectiveCurrent = (timelineNow && timelineNow.is_timeline) ? timelineNow : current;
  const displayCurrent = effectiveCurrent || timelineNow;  // v13.45 · in standby mostra comunque il brano in onda sul clock
  const _djScript = effectiveCurrent?.spoken_text || effectiveCurrent?.script || "";
  useEffect(() => { if (_djScript && _djScript.trim()) setLastDjLine(_djScript.trim()); }, [_djScript]);

  // v13.64 · HOME REDESIGN — rotazione automatica degli effetti LedWall nel hero
  const [ledRotIdx, setLedRotIdx] = useState(0);
  useEffect(() => {
    if (ledEffect !== "rotate") return;
    const iv = setInterval(() => setLedRotIdx((i) => i + 1), LED_ROTATION_MS);
    return () => clearInterval(iv);
  }, [ledEffect]);

  // v13.64 · LedWall a schermo intero: Fullscreen API dove disponibile (desktop/Android) +
  // fallback CSS fixed inset-0 (iOS Safari non supporta il fullscreen dei <div>). Wake Lock
  // best-effort per non spegnere lo schermo del telefono appoggiato in auto.
  const [ledFs, setLedFs] = useState(false);
  const ledFsRef = useRef(null);
  const wakeLockRef = useRef(null);
  const nativeFsRef = useRef(false);   // true solo se il fullscreen nativo è davvero attivo
  const enterLedFs = async () => {
    try { flushSync(() => setLedFs(true)); } catch (e) { setLedFs(true); }  // monta il layer FS subito, dentro il gesto utente
    const el = ledFsRef.current;
    try {
      if (el?.requestFullscreen) { await el.requestFullscreen({ navigationUI: "hide" }); nativeFsRef.current = true; }
      else if (el?.webkitRequestFullscreen) { el.webkitRequestFullscreen(); nativeFsRef.current = true; }
    } catch (e) { nativeFsRef.current = false; /* fallback CSS (iOS Safari e simili) */ }
  };
  const exitLedFs = async () => {
    setLedFs(false);
    nativeFsRef.current = false;
    try {
      if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitFullscreenElement && document.webkitExitFullscreen) document.webkitExitFullscreen();
    } catch (e) { /* noop */ }
  };
  useEffect(() => {
    const onChange = () => {
      // uscita dal fullscreen nativo (Esc / gesto di sistema) → chiudi anche il layer CSS
      if (nativeFsRef.current && !document.fullscreenElement && !document.webkitFullscreenElement) {
        nativeFsRef.current = false;
        setLedFs(false);
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);
  useEffect(() => {
    document.body.style.overflow = ledFs ? "hidden" : "";
    if (ledFs) {
      (async () => { try { if (navigator.wakeLock) wakeLockRef.current = await navigator.wakeLock.request("screen"); } catch (e) { /* noop */ } })();
      const onKey = (e) => { if (e.key === "Escape") exitLedFs(); };
      window.addEventListener("keydown", onKey);
      return () => { window.removeEventListener("keydown", onKey); try { wakeLockRef.current?.release(); } catch (e) {} wakeLockRef.current = null; document.body.style.overflow = ""; };
    }
    return () => { document.body.style.overflow = ""; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledFs]);

  // v13.68 · DUE STATI: VETRINA (prima del play) e DIRETTA (consolle precedente ripristinata, commit 4de1250).
  // Il SyncLivePlayer è montato UNA sola volta in un host stabile e il suo nodo DOM viene spostato
  // nello slot del layout attivo (vetrina/consolle): l'audio non si interrompe mai al cambio di stato.
  const [volume, setVolume] = useState(() => { try { const v = localStorage.getItem("rai:volume"); return v === null ? 1 : Math.min(1, Math.max(0, Number(v))); } catch { return 1; } });
  const [muted, setMuted] = useState(false);
  const liveBarToggle = () => {
    if (syncPlaying) { try { window.dispatchEvent(new CustomEvent("rai:sync:pause")); } catch (e) {} return; }
    if (isPlaying) { handlePlay(); return; }
    try { window.dispatchEvent(new CustomEvent("rai:sync:skip")); } catch (e) {}  // riaggancio al clock live
  };
  const isMobileLandscape = () => {
    try { return window.matchMedia("(orientation: landscape)").matches && (window.matchMedia("(pointer: coarse)").matches || window.innerHeight < 500); }
    catch (e) { return false; }
  };
  // click su "Entra in diretta" (catturato nel gesto utente → fullscreen nativo consentito su mobile orizzontale)
  const onPlayerClickCapture = (e) => {
    try {
      if (e.target?.closest?.('[data-testid="sync-live-toggle"]') && !syncPlaying && isMobileLandscape()) enterLedFs();
    } catch (err) { /* noop */ }
  };
  useEffect(() => {
    const onSync = (ev) => setSyncPlaying(!!ev?.detail?.playing);
    window.addEventListener("rai:sync:play", onSync);
    return () => window.removeEventListener("rai:sync:play", onSync);
  }, []);
  const audioOn = syncPlaying || isPlaying;
  const audioOnRef = useRef(false);
  audioOnRef.current = audioOn;
  useEffect(() => {
    const onOrient = () => { setTimeout(() => { if (audioOnRef.current && !ledFsRef.current && isMobileLandscape()) enterLedFs(); }, 150); };
    window.addEventListener("orientationchange", onOrient);
    return () => window.removeEventListener("orientationchange", onOrient);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const apply = () => {
      const a = document.querySelector('[data-testid="sync-live-audio"]');
      if (a) { try { a.volume = muted ? 0 : volume; } catch (e) {} }
    };
    apply();
    const t = setTimeout(apply, 800);  // dopo il fade-in iniziale del player
    try { localStorage.setItem("rai:volume", String(volume)); } catch (e) {}
    return () => clearTimeout(t);
  }, [volume, muted, syncPlaying]);
  const barPlaying = audioOn;

  // host stabile del player + slot per stato
  const playerHostRef = useRef(null);
  const vetrinaSlotRef = useRef(null);
  const consoleSlotRef = useRef(null);
  useLayoutEffect(() => {
    const host = playerHostRef.current;
    const slot = audioOn ? consoleSlotRef.current : vetrinaSlotRef.current;
    if (host && slot && host.parentNode !== slot) slot.appendChild(host);
  });

  // 2 · ogni ingresso in diretta → LedWall parte con il logo rotante
  useEffect(() => { if (audioOn) setLedEffect("logo"); }, [audioOn]);

  // 1 · fullscreen: controlli solo al tocco/click (spariscono dopo 3s), info brano al centro ad ogni cambio
  const [fsCtrlVisible, setFsCtrlVisible] = useState(true);
  const fsCtrlTimerRef = useRef(null);
  const pokeFsCtrl = () => {
    setFsCtrlVisible(true);
    if (fsCtrlTimerRef.current) clearTimeout(fsCtrlTimerRef.current);
    fsCtrlTimerRef.current = setTimeout(() => setFsCtrlVisible(false), 3000);
  };
  useEffect(() => {
    if (!ledFs) return;
    pokeFsCtrl();
    return () => { if (fsCtrlTimerRef.current) clearTimeout(fsCtrlTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledFs]);
  // v13.84 · doppio clic / doppio tocco sul LedWall a schermo intero → esci (oltre a "Esci" ed Esc)
  const fsLastTapRef = useRef({ t: 0, x: 0, y: 0 });
  const onFsPointerUp = (e) => {
    if (e.target?.closest?.("button, a, input, select, [role='slider']")) return;
    const now = Date.now();
    const last = fsLastTapRef.current;
    const close = now - last.t < 350 && Math.abs(e.clientX - last.x) < 40 && Math.abs(e.clientY - last.y) < 40;
    fsLastTapRef.current = close ? { t: 0, x: 0, y: 0 } : { t: now, x: e.clientX, y: e.clientY };
    if (close) { e.preventDefault(); exitLedFs(); }
  };
  const [fsTrackInfo, setFsTrackInfo] = useState(null);
  const fsTrackTimerRef = useRef(null);
  const fsTrackKey = `${displayCurrent?.id || ""}|${displayCurrent?.title || ""}|${displayCurrent?.artist || ""}`;
  useEffect(() => {
    if (!ledFs || !displayCurrent?.title) { setFsTrackInfo(null); return; }
    setFsTrackInfo({ title: displayCurrent.title, artist: displayCurrent.artist || displayCurrent.dj_name || "", kind: displayCurrent.kind });
    if (fsTrackTimerRef.current) clearTimeout(fsTrackTimerRef.current);
    fsTrackTimerRef.current = setTimeout(() => setFsTrackInfo(null), 4500);
    return () => { if (fsTrackTimerRef.current) clearTimeout(fsTrackTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledFs, fsTrackKey]);
  const ctrlTop = "top-[4.25rem]";
  // v13.64 · HOME REDESIGN — LedWall in rotazione automatica + fullscreen (desktop/mobile)
  const activeLedEffect = ledEffect === "rotate" ? LED_ROTATION[ledRotIdx % LED_ROTATION.length] : ledEffect;

  const navItems = [
    { key: "home", label: "Home", to: "/", icon: Home, active: true },
    { key: "partner", label: "Partner", to: "/partner", icon: Sparkles, accent: "orange" },
    { key: "replay", label: "Re-Play", to: "/replay", icon: AudioWaveform },
  ];
  const navBtnClass = (extra = "") => `rai-nav-btn focusable ${extra}`.trim();

  return (
    <div className="relative min-h-screen text-white rai-home" data-audio-on={audioOn ? "true" : "false"} data-home-state={audioOn ? "diretta" : "vetrina"}>
      {/* v13.68 · host stabile del SyncLivePlayer: montato una volta sola, il nodo viene spostato nello slot attivo */}
      <div style={{ display: "contents" }} onClickCapture={onPlayerClickCapture}>
        <div ref={playerHostRef} data-testid="sync-player-host"><SyncLivePlayer /></div>
      </div>
      {/* v13.68 · LEDWALL A SCHERMO INTERO (layer unico a livello root: sopravvive al cambio vetrina↔consolle).
          Nessun overlay permanente: controlli solo al tocco (3s), info brano al centro ad ogni cambio (4.5s). */}
      {ledFs && (
        <div ref={ledFsRef} className="fixed inset-0 z-[100] bg-black rai-fs-wrap rai-fs-active select-none" data-testid="home-ledwall-fs"
          data-fullscreen="true" data-controls-visible={fsCtrlVisible ? "true" : "false"}
          onPointerDown={pokeFsCtrl} onPointerMove={pokeFsCtrl} onPointerUp={onFsPointerUp} style={{ touchAction: "manipulation" }}>
          <LedWall
            isPlaying={audioOn || broadcastMode === "live_external"}
            current={effectiveCurrent}
            trackOverlay={trackOverlay}
            nowInfo={timelineNow}
            djs={djs}
            fillHeight
            effect={ledEffect}
          />
          <div className={`absolute inset-x-0 top-0 z-[110] flex items-start justify-between p-3 transition-opacity duration-500 ${fsCtrlVisible ? "opacity-100" : "opacity-0 pointer-events-none"}`} data-testid="fs-controls">
            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              <label className="sr-only" htmlFor="ledwall-fs-effect-select">Effetto visivo</label>
              <select
                id="ledwall-fs-effect-select"
                value={ledEffect}
                onChange={(e) => { setLedEffect(e.target.value); try { localStorage.setItem("rai:ledwall:effect", e.target.value); } catch {} }}
                data-testid="ledwall-fs-effect-select"
                className="bg-black/70 border border-cyan-400/30 rounded px-1.5 py-1 text-[11px] font-mono text-cyan-100"
              >
                <option value="logo">Logo rotante a ritmo</option>
                <option value="rotate">Rotazione automatica</option>
                <option value="auto">Onde sinusoidali</option>
                <option value="gradient">Gradiente animato</option>
                <option value="rings">Anelli/particelle a ritmo</option>
                <option value="eq">Barre EQ/waveform</option>
                <option value="starfield">Starfield/warp</option>
                <option value="holo">Sfera olografica</option>
              </select>
            </div>
            <button type="button" onClick={(e) => { e.stopPropagation(); exitLedFs(); }} data-testid="ledwall-fullscreen-exit" aria-label="Esci dallo schermo intero"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[11px] font-mono uppercase tracking-widest focusable"
              style={{ background: "rgba(0,0,0,0.6)", border: "1px solid rgba(0,229,255,0.4)", color: "#CFF8FF", backdropFilter: "blur(8px)" }}>
              <Minimize2 className="w-4 h-4" /> Esci
            </button>
          </div>
          {fsTrackInfo && (
            <div className="absolute inset-0 z-[105] flex items-center justify-center pointer-events-none px-6" data-testid="fs-track-info">
              <div className="rai-fs-track text-center">
                <div className="text-[10px] font-mono uppercase tracking-[0.35em] text-cyan-300/90 mb-2">In onda</div>
                <div className="font-display font-black text-2xl sm:text-4xl lg:text-5xl text-white leading-tight line-clamp-2 break-words">{fsTrackInfo.title}</div>
                {fsTrackInfo.artist && <div className="mt-2 text-sm sm:text-lg text-zinc-200 font-mono tracking-wide line-clamp-1">{fsTrackInfo.artist}</div>}
              </div>
            </div>
          )}
          {!audioOn && (
            <LiveBar
              inFullscreen playing={barPlaying} onToggle={liveBarToggle} current={displayCurrent} kindCurrent={effectiveCurrent}
              muted={muted} setMuted={setMuted} volume={volume} setVolume={setVolume}
              onExitFullscreen={exitLedFs}
            />
          )}
        </div>
      )}
      {audioOn ? (
        <>
      {/* ================ STATO DIRETTA · consolle precedente (ripristinata dal commit 4de1250) ================ */}
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
                <div className="flex items-center gap-2">
                  <div className="text-[9px] font-mono uppercase tracking-[0.3em] text-cyan-400/80">In onda</div>
                  {activeContainer && <ContainerBadge c={activeContainer} />}
                </div>
                <div className="font-display text-base sm:text-lg font-black text-white leading-tight line-clamp-3 break-words" data-testid="current-title">
                  {displayCurrent?.title || "R-A.I. Radio"}
                </div>
                <div className="text-sm text-zinc-300 line-clamp-2 mt-0.5" data-testid="current-artist">
                  {displayCurrent?.artist || displayCurrent?.dj_name || "La radio che pensa da sola"}
                </div>
              </div>
            </div>

            <div className="mt-3"><Waveform active={isPlaying} /></div>

            <div className="mt-4" ref={consoleSlotRef} data-testid="console-player-slot" />

            {/* elementi tecnici nascosti dalla home (restano nel codice) */}
            {/* Ticket #247410: rimosso su decisione del cliente — era solo decorativo
                (frasi tecniche casuali). Resta solo il Live Brain reale, piu' in basso,
                ora con lo stesso verde "vecchio monitor". Il componente resta nel codice. */}
            {false && <LiveBrainTicker current={effectiveCurrent} />}
            {false && <CueThinking current={effectiveCurrent} />}
          </div>

          {/* ── CENTRO (6/12): LEDWALL dominante · su mobile per primo, piena larghezza ── */}
          <div className="order-1 lg:order-2 lg:col-span-6 relative flex flex-col min-w-0 -mx-3 sm:mx-0 cursor-pointer" data-testid="home-ledwall-col"
            style={{ minHeight: "min(62vw, 560px)" }}
            data-clickable="true" role="button" aria-label="Apri il LedWall a schermo intero" title="Tocca per lo schermo intero"
            onClick={enterLedFs}>
            <div className="absolute -top-2 right-3 z-20 hidden sm:block"><VuMeter /></div>
            <div className="absolute top-2 left-3 z-20 flex items-center gap-1.5" data-testid="ledwall-effect-control" onClick={(e) => e.stopPropagation()}>
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
            {!ledFs && <LedWall
              isPlaying={isPlaying || syncPlaying || broadcastMode === "live_external"}
              current={effectiveCurrent}
              trackOverlay={trackOverlay}
              nowInfo={timelineNow}
              djs={djs}
              fillHeight
              effect={ledEffect}
            />}
          </div>

          {/* ── DX (3/12): INFO ESSENZIALI + chat ── */}
          <div className="order-3 lg:order-3 lg:col-span-3 flex flex-col gap-3 min-w-0" data-testid="home-info-col">
            {discoDelGiorno && <DiscoDelGiornoBadge track={discoDelGiorno} />}
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
        ref={donateBtnRef}
        onClick={() => setShowDonate(true)}
        data-testid="donate-open-button"
        className="fixed z-50 group flex items-center gap-2 px-3.5 py-2.5 sm:px-5 sm:py-3 rounded-full font-mono font-bold text-xs uppercase tracking-widest text-white shadow-2xl transition-transform hover:scale-105 active:scale-95 focusable right-3 bottom-3 sm:right-1/2 sm:bottom-6 sm:translate-x-1/2"
        style={{
          background: "linear-gradient(135deg, #FF6B1A 0%, #FF8A3D 100%)",
          boxShadow: "0 8px 30px rgba(255,107,26,0.45), 0 0 0 1px rgba(255,255,255,0.1) inset",
          marginBottom: "env(safe-area-inset-bottom, 0px)",
          translate: donateLift ? `0 -${donateLift}px` : undefined,   // v13.81 · sopra la banda news del LedWall
          transition: "translate 0.35s ease, transform 0.15s",
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
        </>
      ) : (
        <>
      {/* ================ STATO VETRINA ================ */}
      {/* ServicesDock: i suoi pulsanti sono stati spostati nella barra in alto (resta nel codice) */}
      {false && <ServicesDock />}

      {/* Console background */}
      <div aria-hidden className="fixed inset-0 pointer-events-none overflow-hidden rai-bg" style={{ zIndex: 0 }} data-testid="animated-bg">
        <div className="rai-bg-grid" />
        <div className="rai-bg-orb rai-bg-orb-1" />
        <div className="rai-bg-orb rai-bg-orb-2" />
        <div className="rai-bg-orb rai-bg-orb-3" />
        <div className="rai-bg-scan" />
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(2,4,10,0.55) 0%, rgba(2,4,10,0.75) 55%, rgba(2,4,10,0.94) 100%)" }} />
      </div>

      {/* ================ 2 · NAVIGAZIONE — barra orizzontale fissa in alto ================ */}
      <header className="rai-topnav fixed top-0 inset-x-0 z-40" data-testid="home-topnav">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 h-14 flex items-center gap-2 sm:gap-4">
          <Link to="/" className="flex items-center gap-2 shrink-0 focusable" data-testid="rai-logo" aria-label="R-A.I. Radio · Home">
            <span style={{ filter: "drop-shadow(0 0 8px rgba(0,229,255,0.55))" }}><RaiOrbLogo size={34} /></span>
            <BrandName className="font-display font-black text-base sm:text-lg text-glow-blue hidden sm:block" />
          </Link>
          <nav className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto no-scrollbar justify-start sm:justify-end py-2" aria-label="Navigazione principale" data-testid="home-nav">
            {navItems.map((it) => (
              <Link key={it.key} to={it.to} data-testid={`nav-${it.key}`}
                className={navBtnClass(`${it.active ? "is-active" : ""} ${it.accent === "orange" ? "is-orange" : ""}`)}>
                <it.icon className="w-3.5 h-3.5" /> <span className="rai-nav-label">{it.label}</span>
              </Link>
            ))}
            <StudiosDialog trigger={<button type="button" className={navBtnClass()} data-testid="nav-studios"><Building2 className="w-3.5 h-3.5" /> <span className="rai-nav-label">Studios</span></button>} />
            <ContattiDialog trigger={<button type="button" className={navBtnClass()} data-testid="nav-contatti"><Mail className="w-3.5 h-3.5" /> <span className="rai-nav-label">Contatti</span></button>} />
            <button type="button" onClick={() => setShowDonate(true)} className={navBtnClass("is-orange")} data-testid="nav-sostieni">
              <Heart className="w-3.5 h-3.5" fill="currentColor" /> <span className="rai-nav-label">Sostieni</span>
            </button>
            <a href="/dashboard" target="_blank" rel="noopener noreferrer" data-testid="admin-link" className={navBtnClass("is-ghost")}>
              <Cpu className="w-3.5 h-3.5" /> <span className="rai-nav-label">Regia</span>
            </a>
          </nav>
          <div className="shrink-0">
            {onAir ? (
              <div className="on-air-badge !py-1 !px-2.5 !text-[10px]" data-testid="live-indicator"><span className="dot" /><span>ON AIR</span></div>
            ) : (
              <div className="standby-badge !py-1 !px-2.5 !text-[10px]" data-testid="standby-indicator"><span className="dot" /><span>STANDBY</span></div>
            )}
          </div>
        </div>
      </header>

      {/* ================ 1 · HERO a tutto schermo — LedWall come sfondo ================ */}
      <section className="relative z-10 rai-hero" data-testid="home-hero" style={{ minHeight: "100svh" }}>
        {/* Livello LedWall: in pagina è lo sfondo del hero; in fullscreen copre tutto lo schermo (desktop + mobile) */}
        <div
          className="absolute inset-0 z-0 rai-fs-wrap rai-ledlayer"
          data-testid="home-ledwall-col"
          data-fullscreen="false"
        >
          {!ledFs && <LedWall
            isPlaying={isPlaying || broadcastMode === "live_external"}
            current={effectiveCurrent}
            trackOverlay={trackOverlay}
            nowInfo={timelineNow}
            djs={djs}
            fillHeight
            effect={activeLedEffect}
          />}
          {/* controlli discreti: effetto + fullscreen */}
          <div className={`absolute ${ctrlTop} left-3 z-[110] flex items-center gap-1.5 rai-hero-ctrl`} data-testid="ledwall-effect-control" onClick={(e) => e.stopPropagation()}>
            <label className="sr-only" htmlFor="ledwall-effect-select">Effetto visivo</label>
            <select
              id="ledwall-effect-select"
              value={ledEffect}
              onChange={(e) => { setLedEffect(e.target.value); try { localStorage.setItem("rai:ledwall:effect", e.target.value); } catch {} }}
              data-testid="ledwall-effect-select"
              className="bg-black/70 border border-cyan-400/30 rounded px-1.5 py-0.5 text-[10px] font-mono text-cyan-100"
            >
              <option value="rotate">Rotazione automatica</option>
              <option value="logo">Logo rotante a ritmo</option>
              <option value="auto">Onde sinusoidali</option>
              <option value="gradient">Gradiente animato</option>
              <option value="rings">Anelli/particelle a ritmo</option>
              <option value="eq">Barre EQ/waveform</option>
              <option value="starfield">Starfield/warp</option>
              <option value="holo">Sfera olografica</option>
            </select>
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); enterLedFs(); }}
            data-testid="ledwall-fullscreen-open"
            aria-label="LedWall a schermo intero"
            title="LedWall a schermo intero"
            className={`absolute ${ctrlTop} right-3 px-2.5 py-1.5 z-[110] inline-flex items-center gap-1.5 rounded-full text-[11px] font-mono uppercase tracking-widest rai-hero-ctrl focusable`}
            style={{ background: "rgba(0,0,0,0.6)", border: "1px solid rgba(0,229,255,0.4)", color: "#CFF8FF", backdropFilter: "blur(8px)" }}
          >
            <Maximize2 className="w-3.5 h-3.5" /><span className="hidden sm:inline">Schermo intero</span>
          </button>
          <div className="absolute -top-2 right-3 z-20 hidden sm:block"><VuMeter /></div>
        </div>

        {/* Veli per leggibilità (il LedWall resta dominante) */}
        <div aria-hidden className="absolute inset-0 z-[1] pointer-events-none rai-hero-veil" />

        {/* Contenuto hero */}
        <div className="relative z-[2] min-h-[100svh] flex flex-col items-center justify-center text-center px-4 pt-24 pb-14 pointer-events-none rai-hero-content">
          <div className="rai-rise relative pointer-events-auto" style={{ animationDelay: "0ms", filter: "drop-shadow(0 0 28px rgba(0,229,255,0.55))" }}>
            <RaiOrbLogo size={132} />
            <a href="https://www.facebook.com/profile.php?id=61592908061493" target="_blank" rel="noopener noreferrer"
              className="powered-by-signature focusable" data-testid="powered-by" title="L&C Project · Facebook">
              Powered by <span className="lc-brand">L&amp;C Project</span>
            </a>
          </div>
          <BrandName className="font-display font-black text-2xl sm:text-3xl text-glow-blue mt-5 rai-rise" style={{ animationDelay: "80ms" }} />
          <h1 className="rai-hero-title font-display font-black tracking-tighter text-3xl sm:text-5xl lg:text-6xl leading-[1.02] mt-4 max-w-4xl rai-rise" style={{ animationDelay: "160ms" }} data-testid="hero-tagline">
            La prima radio italiana diretta da un'intelligenza artificiale.
          </h1>
          <p className="rai-hero-sub mt-3 text-base md:text-lg font-mono tracking-[0.12em] uppercase rai-rise" style={{ animationDelay: "240ms" }} data-testid="hero-subtagline">
            Vera musica, vera direzione artistica.
          </p>

          {/* Player */}
          <div className="w-full max-w-md mt-8 rai-rise rai-hero-player pointer-events-auto" style={{ animationDelay: "320ms" }} data-testid="home-player-col">
            <div ref={vetrinaSlotRef} data-testid="vetrina-player-slot" />
            <div className="mt-3 rai-hero-now flex items-center gap-3 text-left rounded-xl px-3 py-2.5" data-testid="now-playing-title">
              {displayCurrent?.image_url ? (
                <img src={displayCurrent.image_url} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" style={{ boxShadow: "0 0 18px rgba(0,229,255,0.35)" }} data-testid="now-playing-cover" />
              ) : (
                <BigCue
                  size={48}
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
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-mono uppercase tracking-[0.3em] text-cyan-400/80">In onda</span>
                  {displayCurrent?.kind && <KindBadge kind={displayCurrent.kind} />}
                  {activeContainer && <ContainerBadge c={activeContainer} />}
                </div>
                <div className="font-display text-sm sm:text-base font-black text-white leading-tight line-clamp-2 break-words" data-testid="current-title">
                  {displayCurrent?.title || "R-A.I. Radio"}
                </div>
                <div className="text-xs text-zinc-300 line-clamp-1" data-testid="current-artist">
                  {displayCurrent?.artist || displayCurrent?.dj_name || "La radio che pensa da sola"}
                </div>
              </div>
              <div className="hidden sm:block w-16 shrink-0"><Waveform active={isPlaying} /></div>
            </div>
          </div>

          {discoDelGiorno && (
            <div className="mt-4 rai-rise pointer-events-auto" style={{ animationDelay: "360ms" }}>
              <DiscoDelGiornoBadge track={discoDelGiorno} />
            </div>
          )}
          <div className="mt-6 rai-rise pointer-events-auto" style={{ animationDelay: "400ms" }}><MainPartnerSlot /></div>

          {/* elementi tecnici nascosti dalla home (restano nel codice) */}
          {false && <LiveBrainTicker current={effectiveCurrent} />}
          {false && <CueThinking current={effectiveCurrent} />}
        </div>

        <a href="#home-live" className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[2] text-cyan-300/70 hover:text-cyan-200 rai-bounce focusable" aria-label="Scorri" data-testid="hero-scroll-hint">
          <ChevronDown className="w-6 h-6" />
        </a>
      </section>

      {/* LIVE MANUAL banner (arancione = alert) */}
      {broadcastMode === "live_external" && (
        <section className="max-w-7xl mx-auto px-3 sm:px-4 pt-4 relative z-10">
          <div data-testid="live-external-banner" className="rounded-xl p-4 flex flex-col md:flex-row items-center gap-4 glow-orange"
            style={{ background: "linear-gradient(180deg, rgba(255,107,26,0.10) 0%, rgba(255,107,26,0.04) 100%)", border: "1px solid rgba(255,107,26,0.5)" }}>
            <div className="flex items-center gap-3">
              <div className="on-air-badge"><span className="dot" /><span>LIVE MANUAL</span></div>
              <div className="text-white font-bold font-mono uppercase tracking-widest text-sm">Voce umana in diretta</div>
            </div>
            {manualStreamUrl ? (
              <audio ref={externalAudioRef} data-testid="external-audio" src={manualStreamUrl} controls autoPlay crossOrigin="anonymous" className="flex-1 min-w-[220px] w-full" style={{ maxWidth: 640 }} />
            ) : (
              <div className="text-amber-300 text-sm">URL stream non ancora impostato — l'admin lo configura dalla Control Room.</div>
            )}
          </div>
        </section>
      )}

      {/* ================ IN DIRETTA ORA — info essenziali · chat · Live Brain ================ */}
      <section id="home-live" className="max-w-7xl mx-auto px-3 sm:px-4 pt-10 pb-2 relative z-10 scroll-mt-16" data-testid="home-live-section">
        <div className="label-mono mb-2">◂ IN DIRETTA ORA ▸</div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
          <div className="lg:col-span-4 console-panel p-4 flex flex-col gap-4" data-testid="home-info-col">
            <CornerAccents />
            <div data-testid="home-next-track">
              <div className="text-[9px] font-mono uppercase tracking-[0.3em] text-zinc-500">A seguire</div>
              <div className="font-display font-bold text-white text-base leading-tight mt-1 line-clamp-2">{streamNext?.title || "In preparazione…"}</div>
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
          <div className="lg:col-span-4 flex flex-col min-h-[280px]" style={{ maxHeight: 420 }} data-testid="home-chat-col">
            <ChatMini heightClass="h-full" />
          </div>
          <div className="lg:col-span-4 min-h-[280px]" data-testid="home-live-brain">
            <LiveBrain current={effectiveCurrent} segments={segments} />
          </div>
        </div>
      </section>

      {/* ================ LE STELLE DI NEURONI ================ */}
      <div data-testid="radioscope-section" className="relative z-10 mt-4">
        <RadioscopoWidget />
      </div>

      {/* ================ TEAM STRIP ================ */}
      <section className="max-w-7xl mx-auto px-4 pt-1 pb-2 relative z-10" data-testid="rai-team-strip">
        <div className="flex items-center gap-3 rounded-xl px-4 py-3 overflow-x-auto"
          style={{ background: "linear-gradient(180deg, rgba(4,10,22,0.35) 0%, rgba(2,6,15,0.55) 100%)", backdropFilter: "blur(14px) saturate(1.2)", WebkitBackdropFilter: "blur(14px) saturate(1.2)", border: "1px solid rgba(0,229,255,0.20)", boxShadow: "0 0 18px rgba(0,191,255,0.12), inset 0 0 10px rgba(0,229,255,0.08)" }}>
          <div className="shrink-0 flex flex-col leading-none pr-2 border-r border-cyan-500/15">
            <span className="text-[9px] font-mono uppercase tracking-widest text-cyan-500">STAFF</span>
            <span className="text-[11px] font-bold text-glow-blue" data-testid="rai-team-heading" style={{ fontFamily: '"Orbitron","Share Tech Mono",ui-monospace,monospace', letterSpacing: "0.08em" }}>R-A.I. TEAM</span>
          </div>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {djs.slice().sort((a, b) => (a.night_slot ? 1 : 0) - (b.night_slot ? 1 : 0) || (a.night_slot || 0) - (b.night_slot || 0)).map(dj => (
              <Dialog key={dj.id}>
                <DialogTrigger asChild>
                  <button type="button" data-testid={`team-chip-${dj.name}`} className="flex flex-col items-center gap-0.5 shrink-0 hover:-translate-y-0.5 transition-transform focusable" title={dj.name}>
                    <div className="w-11 h-11 rounded-full overflow-hidden bg-black" style={{ border: `1px solid ${dj.accent_color || "#00BFFF"}99`, boxShadow: `0 0 10px ${dj.accent_color || "#00BFFF"}88` }}>
                      {dj.avatar_url && <img src={dj.avatar_url} alt={dj.name} className="w-full h-full object-cover" loading="lazy" />}
                    </div>
                    <span className="text-[10px] font-black leading-none dj-name-force" style={{ fontFamily: '"Orbitron","Share Tech Mono",ui-monospace,monospace', letterSpacing: "0.05em", color: dj.accent_color || "#00BFFF", textShadow: `0 0 6px ${dj.accent_color || "#00BFFF"}` }}>{dj.name}</span>
                  </button>
                </DialogTrigger>
                <DialogContent className="max-w-lg bg-[#02040A] text-white" data-testid={`team-dialog-${dj.name}`} style={{ border: `1px solid ${dj.accent_color || "#00BFFF"}66`, boxShadow: `0 0 40px ${dj.accent_color || "#00BFFF"}44` }}>
                  <DialogHeader>
                    <div className="flex items-center gap-4">
                      {dj.avatar_url && <img src={dj.avatar_url} alt={dj.name} className="w-20 h-20 rounded-lg object-cover" style={{ border: `1px solid ${dj.accent_color || "#00BFFF"}77`, boxShadow: `0 0 24px ${dj.accent_color || "#00BFFF"}66` }} />}
                      <div>
                        <DialogTitle className="text-2xl font-display font-black" style={{ color: dj.accent_color || "#00BFFF", textShadow: `0 0 12px ${dj.accent_color || "#00BFFF"}` }}>{dj.name}</DialogTitle>
                        <DialogDescription className="text-xs font-mono uppercase tracking-widest text-cyan-500 mt-1">
                          {dj.llm_provider} · {dj.llm_model}
                          {dj.night_slot ? ` · ${dj.night_slot === 1 ? "22:00-00:00" : dj.night_slot === 2 ? "00:00-02:00" : "02:00-04:00"}` : " · SPEAKER"}
                        </DialogDescription>
                      </div>
                    </div>
                  </DialogHeader>
                  <p className="text-sm font-mono text-zinc-300 leading-relaxed mt-2">{dj.personality || "Nessuna bio disponibile."}</p>
                </DialogContent>
              </Dialog>
            ))}
          </div>
          <div className="shrink-0 pl-2 border-l border-cyan-500/15"><NextEventChip /></div>
        </div>
      </section>

      {/* ================ SPONSOR CTA — DIVENTA PARTNER ================ */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-3 relative z-10" data-testid="sponsor-cta-section">
        <Link to="/partner" data-testid="card-diventa-partner" className="relative flex items-center gap-4 rounded-2xl px-5 py-4 group focusable overflow-hidden"
          style={{ border: "1px solid rgba(255,184,77,0.45)", background: "linear-gradient(120deg, rgba(255,107,26,0.10) 0%, rgba(0,0,0,0.55) 55%, rgba(255,184,77,0.10) 100%)", backdropFilter: "blur(16px) saturate(1.25)", WebkitBackdropFilter: "blur(16px) saturate(1.25)", boxShadow: "0 0 0 1px rgba(255,184,77,0.28) inset, 0 18px 44px rgba(0,0,0,0.6), 0 0 44px rgba(255,184,77,0.20)" }}>
          <CornerAccents />
          <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(255,184,77,0.12)", border: "1px solid rgba(255,184,77,0.6)", boxShadow: "0 0 18px rgba(255,184,77,0.55), inset 0 0 12px rgba(255,184,77,0.18)" }}>
            <Building2 className="w-6 h-6" style={{ color: "#FFD79A", filter: "drop-shadow(0 0 6px rgba(255,184,77,0.9))" }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="label-mono" style={{ color: "#FFB84D" }}>◂ SPONSOR PARTNER ▸</div>
            <h3 className="font-display font-black text-lg sm:text-xl leading-tight" data-testid="diventa-partner-title" style={{ fontFamily: '"Orbitron","Share Tech Mono",ui-monospace,monospace', letterSpacing: "0.05em", color: "#FFD79A", textShadow: "0 0 10px rgba(255,184,77,0.75), 0 0 22px rgba(255,107,26,0.35)" }}>
              DIVENTA PARTNER · SPONSORIZZA R-A.I.
            </h3>
            <p className="text-[11px] font-mono text-zinc-200 mt-0.5"><span style={{ color: "#FFB84D" }}>▸</span> Spot MP3 o generato dall'AI · scheduling per data + frequenza · approvazione admin.</p>
          </div>
          <div className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-md text-[11px] font-mono uppercase tracking-widest shrink-0" style={{ border: "1px solid rgba(255,184,77,0.55)", color: "#FFD79A", background: "rgba(0,0,0,0.35)", textShadow: "0 0 6px rgba(255,184,77,0.7)" }}>
            <Send className="w-3.5 h-3.5" /> Invia richiesta →
          </div>
        </Link>
      </section>

      {/* ================ 3 · RUBRICHE ================ */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-10 relative z-10" data-testid="home-rubriche">
        <div className="label-mono">◂ RUBRICHE ▸</div>
        <h2 className="font-display font-black text-2xl sm:text-3xl lg:text-4xl tracking-tight text-white mt-1">I programmi di R-A.I.</h2>
        <p className="text-sm text-zinc-400 mt-1 max-w-2xl">Appuntamenti fissi pensati, scritti e condotti dall'intelligenza artificiale. Tocca una card per aprirla.</p>
        <HomeCards djs={djs} questionName={questionName} setQuestionName={setQuestionName} questionText={questionText} setQuestionText={setQuestionText} submitQuestion={submitQuestion} busy={busy} />
      </section>

      {/* ================ WALL COMMUNITY ================ */}
      <CommunityWallPublic />

      {/* ================ 4 · CALL TO ACTION — PDF del progetto (placeholder) ================ */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-12 pb-6 relative z-10" data-testid="home-cta-pdf">
        <div className="rai-cta-pdf relative overflow-hidden rounded-3xl px-6 py-10 sm:px-12 sm:py-14 grid gap-6 md:grid-cols-[1fr_auto] items-center">
          <CornerAccents />
          <div className="min-w-0">
            <div className="label-mono" style={{ color: "#FF9ACD" }}>◂ IL PROGETTO ▸</div>
            <h2 className="font-display font-black text-2xl sm:text-3xl lg:text-4xl tracking-tight text-white mt-2 leading-[1.05]">
              Vuoi sapere come funziona davvero una radio diretta da un'AI?
            </h2>
            <p className="text-base text-zinc-300 mt-3 max-w-2xl leading-relaxed">
              Architettura, direzione artistica algoritmica, voci sintetiche, palinsesto automatico: tutto il progetto R-A.I. Radio in un documento.
            </p>
          </div>
          <div className="flex flex-col items-start md:items-end gap-2">
            <button
              type="button"
              onClick={() => toast.info("Il PDF del progetto sarà disponibile a breve.")}
              data-testid="cta-download-pdf"
              className="rai-cta-btn inline-flex items-center gap-3 focusable"
              aria-describedby="cta-pdf-note"
            >
              <FileDown className="w-5 h-5" /> Scarica il PDF del progetto
            </button>
            <span id="cta-pdf-note" className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">PDF in arrivo · placeholder</span>
          </div>
        </div>
      </section>

      <footer className="max-w-7xl mx-auto px-6 py-4 text-[10px] font-mono uppercase tracking-widest text-zinc-600 border-t mt-6 relative z-10" style={{ borderColor: "var(--console-line)" }}>
        <div className="flex items-center gap-2 flex-wrap">
          <Antenna className="w-3 h-3" />
          R-A.I. · Prototipo Beta · Orchestrato da GPT-5.2 · Claude Sonnet 4.5 · Gemini 3 Flash · Nessun umano in cabina.
        </div>
      </footer>

      {/* Donate button (nascosto durante il LedWall a schermo intero) */}
      {(
        <button
          ref={donateBtnRef}
          onClick={() => setShowDonate(true)}
          data-testid="donate-open-button"
          className="fixed z-50 group flex items-center gap-2 px-3.5 py-2.5 sm:px-5 sm:py-3 rounded-full font-mono font-bold text-xs uppercase tracking-widest text-white shadow-2xl transition-transform hover:scale-105 active:scale-95 focusable right-3 bottom-3 sm:right-6 sm:bottom-6"
          style={{ background: "linear-gradient(135deg, #FF6B1A 0%, #FF8A3D 100%)", boxShadow: "0 8px 30px rgba(255,107,26,0.45), 0 0 0 1px rgba(255,255,255,0.1) inset", marginBottom: "env(safe-area-inset-bottom, 0px)",
                   translate: donateLift ? `0 -${donateLift}px` : undefined, transition: "translate 0.35s ease, transform 0.15s" }}
        >
          <Heart className="w-4 h-4 shrink-0" fill="currentColor" />
          <span className="hidden sm:inline">Sostieni il progetto</span>
        </button>
      )}

      {showDonate && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setShowDonate(false)} data-testid="donate-modal-backdrop">
          <div className="console-panel max-w-md w-full p-6 relative" onClick={(e) => e.stopPropagation()} data-testid="donate-modal">
            <CornerAccents />
            <span className="module-tag" style={{ color: "var(--alert-orange)", borderColor: "rgba(255,107,26,0.5)" }}>
              <Heart className="w-2.5 h-2.5 inline mr-1" fill="currentColor" /> SUPPORT · MOD
            </span>
            <button onClick={() => setShowDonate(false)} className="absolute top-3 right-3 text-zinc-400 hover:text-white transition-colors z-10" data-testid="donate-modal-close" aria-label="Chiudi">
              <X className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-3 mb-3 mt-4">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center glow-orange" style={{ background: "linear-gradient(135deg, #FF6B1A, #FF8A3D)" }}>
                <Heart className="w-5 h-5 text-white" fill="currentColor" />
              </div>
              <div className="font-display font-bold text-lg text-glow-orange">Grazie di cuore</div>
            </div>
            <p className="text-sm font-mono text-zinc-300 leading-relaxed mb-6" data-testid="donate-message">
              Ogni donazione tiene accesa l'intelligenza artificiale di R-A.I. — modelli, TTS, generazione musicale. Grazie di far parte del segnale.
            </p>
            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <button onClick={() => setShowDonate(false)} className="btn-outline text-sm focusable" data-testid="donate-cancel">Non ora</button>
              <a href={DONATE_URL} target="_blank" rel="noopener noreferrer" onClick={() => setShowDonate(false)} className="btn-alert inline-flex items-center justify-center gap-2 focusable" data-testid="donate-confirm-paypal">
                <span>Vai a PayPal</span><ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>
      )}
        </>
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
// v13.69 · Disco del Giorno — badge pubblico (vetrina + diretta). Non renderizzato se oggi non c'è.
function DiscoDelGiornoBadge({ track }) {
  if (!track?.title) return null;
  return (
    <div className="rai-ddg flex items-center gap-3 rounded-xl px-3 py-2.5 text-left" data-testid="disco-del-giorno-badge">
      <div className="rai-ddg-icon shrink-0 w-10 h-10 rounded-lg flex items-center justify-center">
        {track.image_url ? <img src={track.image_url} alt="" className="w-10 h-10 rounded-lg object-cover" /> : <Disc3 className="w-5 h-5 animate-spin" style={{ animationDuration: "6s", color: "#00E5FF" }} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[9px] font-mono uppercase tracking-[0.3em]" style={{ color: "#00E5FF" }}>
          ◂ Disco del Giorno ▸
          {track.status === "aired" && <span className="ml-2 text-zinc-400" data-testid="disco-del-giorno-status">trasmesso oggi</span>}
          {track.status === "scheduled" && track.scheduled_at && <span className="ml-2 text-zinc-400" data-testid="disco-del-giorno-status">alle {new Date(track.scheduled_at).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</span>}
        </div>
        <div className="font-display font-black text-sm sm:text-base text-white leading-tight line-clamp-2 break-words" data-testid="disco-del-giorno-title">{track.title}</div>
        {track.artist && <div className="text-xs text-zinc-300 line-clamp-1" data-testid="disco-del-giorno-artist">{track.artist}</div>}
      </div>
    </div>
  );
}

// v13.66 · Barra player compatta — overlay fisso al bordo inferiore, sempre visibile senza scroll.
// In fullscreen viene montata DENTRO il layer LedWall (il fullscreen nativo mostra solo quel sottoalbero).
function LiveBar({ inFullscreen = false, playing, onToggle, current, kindCurrent, muted, setMuted, volume, setVolume, onExitFullscreen }) {
  return (
    <div className={`rai-livebar fixed bottom-0 inset-x-0 ${inFullscreen ? "z-[120] is-fs" : "z-[55]"}`} data-testid="live-bar" data-fullscreen={inFullscreen ? "true" : "false"}
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      <div className="max-w-7xl mx-auto px-3 sm:px-4 h-16 sm:h-[72px] flex items-center gap-3">
        <button type="button" onClick={onToggle} data-testid="live-bar-toggle" aria-label={playing ? "Stop" : "Play"}
          className={`rai-livebar-play shrink-0 w-11 h-11 sm:w-12 sm:h-12 rounded-full inline-flex items-center justify-center focusable ${playing ? "is-on" : ""}`}>
          {playing ? <Pause className="w-5 h-5" fill="currentColor" /> : <Play className="w-5 h-5 ml-0.5" fill="currentColor" />}
        </button>
        <div className="shrink-0 hidden sm:block">
          {current?.image_url ? (
            <img src={current.image_url} alt="" className="w-10 h-10 rounded-md object-cover" />
          ) : (
            <BigCue size={40} mode={playing ? ((kindCurrent?.kind || "") === "music" ? "happy" : "speaking") : "idle"} />
          )}
        </div>
        <div className="min-w-0 flex-1" data-testid="live-bar-now">
          <div className="flex items-center gap-2">
            <span className={`rai-livebar-dot ${playing ? "" : "is-off"}`} aria-hidden />
            <span className="text-[9px] font-mono uppercase tracking-[0.3em] text-cyan-300/90">{playing ? "In onda ora" : "In pausa · clock live"}</span>
            {current?.kind && <span className="hidden sm:inline-flex"><KindBadge kind={current.kind} /></span>}
          </div>
          <div className="font-display font-black text-sm sm:text-base text-white leading-tight truncate" data-testid="live-bar-title">
            {current?.title || "R-A.I. Radio"}
          </div>
          <div className="text-[11px] text-zinc-400 truncate" data-testid="live-bar-artist">
            {current?.artist || current?.dj_name || "La radio che pensa da sola"}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0" data-testid="live-bar-volume">
          <button type="button" onClick={() => setMuted((m) => !m)} data-testid="live-bar-mute" aria-label={muted ? "Riattiva audio" : "Muto"}
            className="w-9 h-9 rounded-full inline-flex items-center justify-center text-cyan-200 hover:text-white rai-livebar-icon focusable">
            {muted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <input type="range" min={0} max={1} step={0.02} value={muted ? 0 : volume}
            onChange={(e) => { setMuted(false); setVolume(Number(e.target.value)); }}
            data-testid="live-bar-volume-slider" aria-label="Volume"
            className="rai-livebar-range w-16 sm:w-28" />
        </div>
        <button type="button" onClick={onExitFullscreen} data-testid="live-bar-exit-fullscreen" aria-label="Esci dallo schermo intero" title="Esci dallo schermo intero"
          className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-[11px] font-mono uppercase tracking-widest text-cyan-100 hover:text-white rai-livebar-icon focusable">
          <Minimize2 className="w-4 h-4" /><span className="hidden sm:inline">Esci</span>
        </button>
      </div>
    </div>
  );
}

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
    <div className="mt-6 grid gap-5 md:grid-cols-2" data-testid="home-cards">
      {/* ====== MOD · B — L'ESPERIMENTO ====== */}
      <CoverCard
        id="esperimento"
        open={openId === "esperimento"}
        onToggle={() => toggle("esperimento")}
        image="/cards/esperimento.png"
        moduleTag="MOD · B · MANIFESTO"
        badgeColor="#00BFFF"
        icon={CircuitBoard}
        eyebrow="MANIFESTO"
        title="L'Esperimento"
        subtitle="La radio che non dovrebbe esistere · zero conduttori umani"
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
        eyebrow="DAILY TRACK"
        title="Il Disco del Giorno"
        subtitle="Un brano esclusivo generato dall'AI, in onda ogni 2 ore"
        testId="card-disco-del-giorno"
      >
        <p className="text-xs font-mono text-zinc-300 leading-relaxed">
          Un brano generato dall'AI, in onda ogni 2 ore.
        </p>
        {daily ? (
          <div className="mt-3 rounded-lg p-3"
               style={{ background: "linear-gradient(180deg, rgba(0,20,30,0.85), rgba(0,10,20,0.9))", border: "1px solid rgba(0,229,255,0.4)", boxShadow: "inset 0 0 20px rgba(0,229,255,0.18)" }}
               data-testid="daily-track">
            <div className="flex items-center gap-2 mb-1.5">
              <AudioWaveform className="w-4 h-4" style={{ color: "var(--console-cyan)" }} />
              <div className="text-base font-bold text-glow-cyan" style={{ color: "var(--console-cyan)" }}>{daily.title}</div>
            </div>
            {daily.artist && <div className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest">▸ {daily.artist}</div>}
            {daily.style_tags && <div className="text-[10px] font-mono text-zinc-500 mt-1 italic">{daily.style_tags}</div>}
            {daily.audio_url && (
              <audio controls preload="auto" src={endpoints.audioUrl(daily.audio_url)} className="mt-2 w-full" style={{ height: 32 }} data-testid="daily-track-audio" />
            )}
          </div>
        ) : (
          <div className="mt-3 rounded-lg p-3 text-center" style={{ background: "rgba(0,0,0,0.5)", border: "1px dashed rgba(0,191,255,0.3)" }}>
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
        eyebrow="CHALLENGE"
        title="Umani vs Algoritmo"
        subtitle="Manda il tuo brano: va in onda in rotazione con l'AI. Il pubblico decide."
        titleGlow="orange"
        testId="card-human-vs-ai"
      >
        <p className="text-sm font-mono text-zinc-200 leading-relaxed">
          <span style={{ color: "var(--alert-orange-glow)" }}>▸</span> Manda un tuo brano.<br />
          <span style={{ color: "var(--alert-orange-glow)" }}>▸</span> Va in onda in rotazione con l'AI.<br />
          <span style={{ color: "var(--alert-orange-glow)" }}>▸</span> Il pubblico decide chi vince.
        </p>
        <Link to="/submit" data-testid="submit-track-link" className="btn-alert inline-flex items-center gap-2 mt-4" onClick={(e) => e.stopPropagation()}>
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
        eyebrow="22:00 – 04:00"
        title="Club Night"
        subtitle={`Techno & House · 6 ore di mixaggio AI${djs.filter(d => d.night_slot).length ? " · " + djs.filter(d => d.night_slot).sort((a, b) => a.night_slot - b.night_slot).map(d => d.name).join(" · ") : ""}`}
        testId="card-club-night"
      >
        <div className="text-sm font-mono text-zinc-200 leading-relaxed">
          <div className="mb-3">Tre DJ AI si passano il microfono ogni 2 ore:</div>
          <div className="space-y-2">
            {djs.filter(d => d.night_slot).sort((a,b) => a.night_slot - b.night_slot).map(dj => (
              <div key={dj.id} className="flex items-center gap-3 rounded-md p-2" style={{ background: "rgba(0,191,255,0.06)", border: `1px solid ${dj.accent_color || "#00E5FF"}44` }} data-testid={`club-dj-${dj.name}`}>
                {dj.avatar_url && <img src={dj.avatar_url} alt={dj.name} className="w-11 h-11 rounded object-cover" style={{ boxShadow: `0 0 10px ${dj.accent_color}88` }} />}
                <div className="flex-1 min-w-0">
                  <h3 className="font-display font-black text-sm dj-name-force" data-testid={`club-dj-name-${dj.name}`}>
                    {dj.name} <span className="text-[10px] font-mono text-zinc-400">· {dj.night_slot === 1 ? "22:00-00:00" : dj.night_slot === 2 ? "00:00-02:00" : "02:00-04:00"}</span>
                  </h3>
                  <div className="text-[10px] font-mono text-zinc-400 leading-tight truncate">{dj.personality}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <Link to="/submit" data-testid="submit-night-track-link" className="btn-primary inline-flex items-center gap-2 mt-4 !text-[11px]" onClick={(e) => e.stopPropagation()}>
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

        {/* Titolo in overlay in basso — gerarchia: TITOLO grande, sottotitolo piccolo */}
        <div className="cover-card-title-wrap">
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
          {eyebrow && (
            <div className="cover-card-eyebrow mb-2" style={{ color: badgeColor, textShadow: `0 0 8px ${badgeColor}` }}>
              ◂ {eyebrow} ▸
            </div>
          )}
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
