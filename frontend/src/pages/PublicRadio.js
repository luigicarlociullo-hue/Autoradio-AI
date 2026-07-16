import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Play, Pause, SkipForward, Radio, Send, Volume2, Sparkles, Users, Music2, Newspaper, MessageCircle, Loader2 } from "lucide-react";
import { endpoints } from "@/lib/api";
import radioEngine from "@/lib/radioEngine";
import { toast } from "sonner";
import AudioVisualizer from "@/components/AudioVisualizer";
import RadioErrorBoundary from "@/components/RadioErrorBoundary";

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
  const [hdMode, setHdMode] = useState(false);
  const [renderingHd, setRenderingHd] = useState(false);
  const [djs, setDjs] = useState([]);
  const [questionName, setQuestionName] = useState("");
  const [questionText, setQuestionText] = useState("");
  const [tick, setTick] = useState(0);
  const [trackOverlay, setTrackOverlay] = useState({ visible: false, title: "", artist: "" });

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

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [tick]);

  const loop = async () => {
    if (playingRef.current) return;
    playingRef.current = true;
    stopFlag.current = false;
    setIsPlaying(true);
    setIsPreparing(true);

    const fetchSegment = async () => {
      let seg = await endpoints.generateSegment(hdMode ? { hd: true } : {});
      // Always resolve backend-relative URLs to absolute (they come as /api/...)
      if (seg.speech_audio_url && seg.speech_audio_url.startsWith("/api/")) {
        seg.speech_audio_url = endpoints.audioUrl(seg.speech_audio_url);
      }
      if (seg.outro_speech_url && seg.outro_speech_url.startsWith("/api/")) {
        seg.outro_speech_url = endpoints.audioUrl(seg.outro_speech_url);
      }
      if (seg.music_audio_url && seg.music_audio_url.startsWith("/api/")) {
        seg.music_audio_url = endpoints.audioUrl(seg.music_audio_url);
      }
      if (seg.background_loop && seg.background_loop.startsWith("/api/")) {
        seg.background_loop = endpoints.audioUrl(seg.background_loop);
      }
      return seg;
    };

    try {
      // Prefetch pipeline: keep one segment ready ahead
      let nextPromise = fetchSegment();
      if (hdMode) setRenderingHd(true);
      let seg = await nextPromise;
      if (hdMode) setRenderingHd(false);
      // Kick off next fetch in background
      nextPromise = fetchSegment();

      while (!stopFlag.current) {
        setCurrent(seg);
        setSegments(prev => mergeSegments(prev, seg));
        // First segment is about to play → dismiss the loading spinner in EVERY branch.
        setIsPreparing(false);

        // Neon track overlay: fade IN when a music segment starts, fade OUT
        // ~8s before the end (approximating the outro transition).
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

        await radioEngine.playSegment(seg);
        if (stopFlag.current) break;
        // Ensure overlay is hidden between segments regardless of the timer.
        setTrackOverlay(o => (o.visible ? { ...o, visible: false } : o));
        // Await the already-in-flight next segment
        try {
          seg = await nextPromise;
        } catch (e) {
          toast.error("HD non disponibile, torno alla modalità veloce");
          seg = await endpoints.generateSegment({});
        }
        // Prefetch the one after
        nextPromise = fetchSegment();
      }
    } catch (e) {
      toast.error("Errore nel flusso radiofonico");
      console.error(e);
    } finally {
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
      {/* Hero background */}
      <div
        className="absolute inset-0 -z-10"
        style={{
          backgroundImage: `linear-gradient(180deg, rgba(5,5,10,0.75) 0%, rgba(5,5,10,0.95) 60%, #05050A 100%), url(${HERO_BG})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundAttachment: "fixed",
        }}
      />

      {/* Header */}
      <header className="glass sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Radio className="w-6 h-6 text-pink-500" />
            <div>
              <div className="font-display font-black text-lg tracking-tight">R-A.I.</div>
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
      <section className="max-w-7xl mx-auto px-6 pt-16 pb-10">
        <div className="label-mono mb-4">La prima radio governata solo da AI</div>
        <h1 className="font-display font-black text-4xl sm:text-5xl lg:text-6xl leading-[0.95] max-w-4xl">
          Voci sintetiche.<br />
          Musica inventata.<br />
          <span className="text-pink-500">Zero umani in cabina.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-zinc-400 leading-relaxed">
          Dieci DJ AI si passano il microfono: satira, dialoghi in diretta, oroscopo, storia, meteo poetico, dialoghi tra due modelli e brani mai esistiti. GPT · Claude · Gemini scrivono i copioni; <span className="text-cyan-400">Bark</span> presta la voce e <span className="text-cyan-400">Stable Audio Open</span> compone la musica — tutto rigorosamente open source.
        </p>

        {/* Live visualizer — clicks open the YouTube channel */}
        <div className="mt-10">
          <AudioVisualizer
            isPlaying={isPlaying}
            currentKind={current?.kind || ""}
            currentTitle={current ? current.title : (isPlaying ? "In diretta…" : "R-A.I. · in stand-by")}
            trackOverlay={trackOverlay}
          />
        </div>

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
                data-testid="hd-mode-toggle"
                onClick={() => { if (!isPlaying) setHdMode(v => !v); }}
                disabled={isPlaying}
                className="btn-outline text-xs focusable flex items-center gap-2"
                style={hdMode ? { borderColor: "#22d3ee", color: "#22d3ee", boxShadow: "inset 0 0 12px rgba(34,211,238,0.25)" } : {}}
                title="Attiva/disattiva modalità HD con voci Bark e musica Stable Audio (open source)"
              >
                <Sparkles className="w-4 h-4" /> HD · {hdMode ? "ON" : "OFF"}
              </button>
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

          {(hdMode || renderingHd) && (
            <div className="mt-4 flex items-center gap-2 text-xs font-mono text-cyan-400" data-testid="hd-status">
              {renderingHd ? (
                <>
                  <span className="live-dot" style={{ background: "#22d3ee", boxShadow: "0 0 12px #22d3ee" }} />
                  Rendering HD in corso · Bark + Stable Audio Open (open source, ~20–35s per segmento)…
                </>
              ) : (
                <>
                  <Sparkles className="w-3 h-3" /> HD attiva · voci Bark (Suno OSS) · musica Stable Audio Open
                </>
              )}
            </div>
          )}

          <div className="mt-6 grid grid-cols-3 gap-4">
            <Stat label="Ascoltatori" value={station.listeners || 0} />
            <Stat label="Segmenti" value={station.total_segments || 0} />
            <Stat label="DJ attivi" value={djs.length} />
          </div>
        </div>
      </section>

      {/* DJ roster */}
      <section className="max-w-7xl mx-auto px-6 py-10">
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
      <section className="max-w-7xl mx-auto px-6 py-10">
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
      <section className="max-w-7xl mx-auto px-6 py-10">
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

      <footer className="max-w-7xl mx-auto px-6 py-10 text-xs font-mono text-zinc-600 border-t border-white/5 mt-8">
        R-A.I. · prototipo beta · orchestrato da GPT-5.2 · Claude Sonnet 4.5 · Gemini 3 Flash · nessun umano è stato usato per registrare quest'audio.
      </footer>
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
