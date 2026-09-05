import React, { useEffect, useRef, useState } from "react";
import { endpoints } from "@/lib/api";

/**
 * LiveBrainTicker — Monitor LCD verticale stile terminale.
 * Testo verde Matrix / ciano neon che scorre verso l'alto con fade
 * ai bordi. Aggiornamento denso di stringhe tecniche.
 */
const TECH = [
  "CUE: Analisi battiti minuto",
  "Neural Core: elaborazione script",
  "Sincronizzazione database segments",
  "Whisper STT: buffer 16kHz",
  "AudioContext: 48000Hz OK",
  "Crossfade slot A/B aligned",
  "ElevenLabs voice: sample 16bit",
  "GPT-5.2 stream: token OK",
  "Claude context: warm cache",
  "Gemini vision idle",
  "Suno API: quota nominal",
  "Object Storage: bucket healthy",
  "Palinsesto lock · rotation",
  "Ducking curve: -35dB steady",
  "Priority queue: consumed",
  "AnalyserNode: 1024 bins",
  "MongoDB heartbeat OK",
  "Session cookies signed",
  "JWT auth · TTL 8h",
  "Community LRP: ordering",
  "Voice queue: idle",
  "Reverb tail: 220ms",
  "EQ notch: 60Hz",
  "Compressor: -12dB threshold",
  "Bass detect: > 0.35 kick",
  "Sponsor scheduler: awake",
];

function rndBpm() { return 88 + Math.floor(Math.random() * 60); }
function rndDb() { return -(10 + Math.floor(Math.random() * 40)); }
function nowStamp() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}.${String(d.getMilliseconds()).padStart(3,"0").slice(0,2)}`;
}

export default function LiveBrainTicker({ current }) {
  const [lines, setLines] = useState([]);
  const scrollRef = useRef(null);

  const push = (msg, kind = "info") => {
    const stamp = nowStamp();
    setLines(prev => {
      const next = [...prev, { t: stamp, msg, kind }];
      return next.slice(-40);
    });
  };

  // Tech stream 700-1100ms
  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const pool = [...TECH];
      pool.push(`BPM lock: ${rndBpm()}`);
      pool.push(`Gain bus: ${rndDb()}dB`);
      pool.push(`Latency RTT: ${Math.floor(20 + Math.random()*90)}ms`);
      pool.push(`Buffer fill: ${Math.floor(60 + Math.random()*39)}%`);
      const dj = current?.dj_name;
      if (dj) {
        pool.push(`${dj}: rendering TTS`);
        pool.push(`${dj}: intent classify`);
      }
      const k = (current?.kind || "").toLowerCase();
      if (k === "music") pool.push("Music slot active · pool 320kbps");
      else if (k === "news") pool.push("News scraper: 5 fonti", "AI rewrite passthrough");
      else if (k === "ad_spot") pool.push("SPONSOR SLOT · billed impression");
      else if (k === "community") pool.push("Umani Vs AI · rotation next");
      else if (k === "time_signal") pool.push("Atomic clock · NTP drift 3ms");
      push(pool[Math.floor(Math.random() * pool.length)]);
      setTimeout(tick, 700 + Math.random() * 500);
    };
    tick();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, current?.kind, current?.dj_name]);

  // Heartbeat station
  useEffect(() => {
    const iv = setInterval(async () => {
      try {
        const s = await endpoints.station();
        push(`heartbeat · listeners=${s?.listeners||0} · segs=${s?.total_segments||0}`, "hb");
      } catch {}
    }, 10000);
    return () => clearInterval(iv);
  }, []);

  // Auto-scroll bottom
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines]);

  return (
    <div
      data-testid="live-brain-ticker"
      className="flex-1 min-w-0 relative overflow-hidden"
      style={{
        height: 96,
        borderRadius: 8,
        background: "linear-gradient(180deg, rgba(0,10,4,0.85) 0%, rgba(0,4,2,0.92) 100%)",
        border: "1px solid rgba(57,255,20,0.35)",
        boxShadow: "inset 0 0 18px rgba(57,255,20,0.10), 0 0 12px rgba(57,255,20,0.22)",
      }}
    >
      {/* Etichetta angolo */}
      <div
        aria-hidden
        className="absolute left-2 top-1 text-[8px] font-mono uppercase tracking-widest z-10"
        style={{ color: "rgba(57,255,20,0.7)", letterSpacing: "0.24em", textShadow: "0 0 4px rgba(57,255,20,0.7)" }}
      >
        LIVE BRAIN · MONITOR
      </div>
      <div
        aria-hidden
        className="absolute right-2 top-1 text-[8px] font-mono uppercase z-10"
        style={{ color: "rgba(57,255,20,0.5)", letterSpacing: "0.14em" }}
      >
        [ ● REC ]
      </div>

      {/* Feed */}
      <div
        ref={scrollRef}
        className="absolute inset-0 px-2.5 pt-4 pb-1 overflow-y-auto"
        style={{
          fontFamily: '"Share Tech Mono","VT323",ui-monospace,monospace',
          fontSize: 10,
          lineHeight: 1.35,
          maskImage: "linear-gradient(180deg, transparent 0%, #000 22%, #000 82%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(180deg, transparent 0%, #000 22%, #000 82%, transparent 100%)",
          scrollbarWidth: "none",
        }}
      >
        {lines.map((ln, i) => (
          <div key={i} className="break-words" style={{
            color: ln.kind === "hb" ? "#7FD8FF" : "#39FF14",
            textShadow: ln.kind === "hb"
              ? "0 0 4px rgba(0,229,255,0.7)"
              : "0 0 4px rgba(57,255,20,0.75), 0 0 10px rgba(57,255,20,0.25)",
            opacity: 0.5 + (i / lines.length) * 0.5,
          }}>
            <span style={{ color: "rgba(57,255,20,0.55)" }}>[{ln.t}]</span> {ln.msg}
          </div>
        ))}
        <div style={{
          color: "#39FF14",
          textShadow: "0 0 4px rgba(57,255,20,0.85)",
        }}>
          ▸ <span style={{
            display: "inline-block", width: 6, height: 10, verticalAlign: "middle",
            background: "#39FF14",
            animation: "lbmCursor 1s steps(2) infinite",
          }} />
        </div>
      </div>

      {/* Scanlines overlay */}
      <div aria-hidden className="absolute inset-0 pointer-events-none" style={{
        background: "repeating-linear-gradient(0deg, rgba(57,255,20,0.05) 0px, rgba(57,255,20,0.05) 1px, transparent 1px, transparent 3px)",
        mixBlendMode: "screen",
      }} />

      <style>{`
        @keyframes lbmCursor { 0%,100% { opacity: 1 } 50% { opacity: 0.1 } }
        [data-testid="live-brain-ticker"] div::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}
