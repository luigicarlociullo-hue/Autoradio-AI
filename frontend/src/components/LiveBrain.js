import React, { useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { endpoints } from "@/lib/api";

/**
 * LiveBrain — pannello LCD stile terminale che mostra le operazioni in corso
 * dedotte dallo state della station + ultimi segmenti generati.
 * Refresh ogni 3s. Massimo 6 righe visibili con auto-scroll.
 */
export default function LiveBrain({ current, segments = [] }) {
  const [lines, setLines] = useState([
    "▸ CUE: boot completato. Sistema in ascolto…",
  ]);

  useEffect(() => {
    if (!current) return;
    const kind = (current.kind || "").toLowerCase();
    const dj = current.dj_name || "DJ";
    const title = current.title || "";
    let msg = null;
    if (kind === "music") {
      msg = `CUE: analisi BPM · '${title.slice(0, 32)}'…`;
    } else if (["talk","joke","weather","horoscope","interview","motivation","history"].includes(kind)) {
      msg = `${dj}: generazione ${kind.toUpperCase()} in corso…`;
    } else if (kind === "news") {
      msg = `${dj}: fetch news + rewrite AI…`;
    } else if (kind === "answer") {
      msg = `${dj}: risposta LLM → TTS ElevenLabs…`;
    } else if (kind === "community") {
      msg = `CUE: rotazione UMANO · '${title.slice(0, 32)}'…`;
    } else if (kind === "ad_spot") {
      msg = `CUE: sponsor slot ON AIR…`;
    } else if (kind === "jingle") {
      msg = `CUE: jingle intercalato · ducking musica…`;
    } else if (kind === "time_signal") {
      const h = new Date().getHours();
      msg = `CUE: segnale orario delle ${String(h).padStart(2,"0")}:00 · atomic clock`;
    }
    if (msg) pushLine(msg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, current?.kind]);

  useEffect(() => {
    // ping "vitale" ogni 8s per non lasciare mai il brain in silenzio
    const iv = setInterval(async () => {
      try {
        const s = await endpoints.station();
        const listeners = s?.listeners || 0;
        const total = s?.total_segments || 0;
        pushLine(`▸ station heartbeat · listeners=${listeners} · segments=${total}`);
      } catch (e) {}
    }, 8000);
    return () => clearInterval(iv);
  }, []);

  const pushLine = (m) => {
    const t = new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLines(prev => {
      const next = [...prev, `[${t}] ${m}`];
      return next.slice(-6);
    });
  };

  return (
    <div
      data-testid="live-brain"
      className="rounded-lg p-3"
      style={{
        background: "#000",
        border: "1px solid rgba(0,229,255,0.3)",
        boxShadow: "0 0 0 1px rgba(0,229,255,0.1) inset, 0 0 18px rgba(0,229,255,0.15)",
        fontFamily: '"Share Tech Mono","VT323",ui-monospace,monospace',
      }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[10px] uppercase tracking-widest text-cyan-500 flex items-center gap-1.5">
          <Cpu className="w-3 h-3" /> LIVE BRAIN · terminal
        </div>
        <span className="text-[9px] text-cyan-700">v1.0</span>
      </div>
      <div
        className="text-[11px] leading-relaxed"
        style={{
          // Ticket #247410: verde "vecchio monitor" (stesso del vecchio ticker decorativo), su richiesta del cliente
          color: "#39FF14",
          textShadow: "0 0 4px rgba(57,255,20,0.6)",
          minHeight: 96,
        }}
      >
        {lines.map((ln, i) => {
          const isLatest = i === lines.length - 1;
          return (
            <div key={i} className="truncate" style={{ opacity: isLatest ? 1 : 0.55 + (i / lines.length) * 0.35 }}>
              {ln}
              {isLatest && <span className="inline-block w-1.5 h-3 align-middle ml-1 bg-[#39FF14] animate-pulse" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
