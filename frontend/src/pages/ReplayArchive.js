import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AudioWaveform, Mic, Cpu, ArrowLeft } from "lucide-react";
import { endpoints } from "@/lib/api";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger
} from "@/components/ui/dialog";

function KindBadge({ kind }) {
  const map = {
    music:      { label: "MUSIC",      color: "#00E5FF" },
    talk:       { label: "TALK",       color: "#00BFFF" },
    news:       { label: "NEWS",       color: "#7FD8FF" },
    joke:       { label: "JOKE",       color: "#FFB84D" },
    weather:    { label: "WEATHER",    color: "#B8ECFF" },
    horoscope:  { label: "STARS",      color: "#C39BFF" },
    history:    { label: "STORIA",     color: "#FFB84D" },
    interview:  { label: "INTERVIEW",  color: "#00BFFF" },
    motivation: { label: "MOTIVATION", color: "#7FD8FF" },
    answer:     { label: "ANSWER",     color: "#00E5FF" },
    community:  { label: "COMMUNITY",  color: "#FF6B1A" },
    jingle:     { label: "JINGLE",     color: "#00E5FF" },
  };
  const m = map[kind] || { label: (kind || "SEG").toUpperCase(), color: "#00BFFF" };
  return (
    <span className="text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded shrink-0"
      style={{ background: `${m.color}18`, color: m.color, border: `1px solid ${m.color}55` }}>
      {m.label}
    </span>
  );
}

export default function ReplayArchive() {
  const [segments, setSegments] = useState([]);
  const [djs, setDjs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [segs, djList] = await Promise.all([endpoints.segments(), endpoints.djs()]);
        if (!live) return;
        setSegments(segs || []);
        setDjs(djList || []);
      } catch (e) {}
      finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, []);

  const audioFor = (s) => {
    let u = s.speech_audio_url || s.music_audio_url || null;
    if (u && u.startsWith("/api/")) u = endpoints.audioUrl(u);
    return u;
  };

  return (
    <div className="relative min-h-screen text-white bg-black" data-testid="replay-page">
      <div aria-hidden className="fixed inset-0 pointer-events-none rai-bg" style={{ zIndex: 0 }}>
        <div className="rai-bg-grid" />
        <div className="rai-bg-orb rai-bg-orb-1" />
        <div className="rai-bg-orb rai-bg-orb-2" />
      </div>

      <header className="glass sticky top-0 z-40 relative">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" data-testid="replay-back" className="btn-outline focusable !py-1.5 !px-3 !text-[11px] inline-flex items-center gap-2">
            <ArrowLeft className="w-3.5 h-3.5" /> Home
          </Link>
          <div className="label-mono flex items-center gap-2">
            <AudioWaveform className="w-3 h-3" /> RE-PLAY · ARCHIVIO STORICO
          </div>
        </div>
      </header>

      <section className="max-w-7xl mx-auto px-6 py-8 relative z-10">
        <h1 className="font-display font-black text-3xl sm:text-4xl mb-2 text-glow-blue" data-testid="replay-page-heading">
          RE-PLAY (Archivio Storico)
        </h1>
        <p className="text-xs font-mono text-zinc-400 mb-6 max-w-2xl">
          Riascolta i set dei DJ, i dischi del giorno e i momenti talk andati in onda.
        </p>

        {loading && (
          <div className="console-panel p-6 text-zinc-500 text-sm font-mono">Caricamento archivio…</div>
        )}
        {!loading && segments.length === 0 && (
          <div className="console-panel p-6 text-zinc-500 text-sm font-mono">
            <span className="text-cyan-400">▸</span> Archivio vuoto.
          </div>
        )}

        <div className="space-y-2">
          {segments.slice().reverse().map((s, idx) => {
            const dj = djs.find(d => d.name === s.dj_name);
            const url = audioFor(s);
            return (
              <Dialog key={s.id || `seg-${idx}`}>
                <DialogTrigger asChild>
                  <button
                    className="console-panel p-4 flex items-start gap-4 w-full text-left hover:border-cyan-400/60 transition"
                    data-testid={`replay-page-item-${s.id || idx}`}
                  >
                    <KindBadge kind={s.kind} />
                    <div className="min-w-0 flex-1">
                      <div className="font-display font-semibold truncate">{s.title}</div>
                      <div className="text-xs font-mono text-zinc-500 mt-1 uppercase tracking-widest">
                        <Mic className="w-2.5 h-2.5 inline mr-1" /> {s.dj_name} · <Cpu className="w-2.5 h-2.5 inline mx-1" /> {s.llm_provider}
                        {url && <span className="ml-2 text-cyan-400">· ▶ RE-PLAY</span>}
                      </div>
                      {s.script && <p className="text-sm font-mono text-zinc-400 mt-2 line-clamp-2">{s.script}</p>}
                    </div>
                  </button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl bg-[#02040A] text-white"
                  data-testid={`replay-page-dialog-${s.id || idx}`}
                  style={{ border: "1px solid rgba(0,191,255,0.4)", boxShadow: "0 0 40px rgba(0,191,255,0.25)" }}>
                  <DialogHeader>
                    <div className="flex items-center gap-4">
                      {dj?.avatar_url && (
                        <img src={dj.avatar_url} alt={dj.name} className="w-16 h-16 rounded-lg object-cover"
                          style={{ border: `1px solid ${dj.accent_color || "#00BFFF"}55`, boxShadow: `0 0 24px ${dj.accent_color || "#00BFFF"}66` }} />
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
                    {url && (
                      <audio controls preload="none" src={url} className="w-full mb-3"
                        style={{ height: 34 }} data-testid={`replay-page-audio-${s.id || idx}`} />
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
      </section>
    </div>
  );
}
