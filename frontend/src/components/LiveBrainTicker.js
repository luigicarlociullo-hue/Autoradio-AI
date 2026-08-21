import React, { useEffect, useState } from "react";
import { endpoints } from "@/lib/api";

/**
 * LiveBrainTicker — display LCD orizzontale integrato nella testata console.
 * Fa scorrere in loop i "pensieri" dell'AI: kind del segmento corrente,
 * heartbeat station, ora, ecc. Marquee CSS pure (nessun JS costoso).
 */
export default function LiveBrainTicker({ current, height = 42 }) {
  const [thoughts, setThoughts] = useState([
    "▸ CUE ONLINE · sistema in ascolto",
    "▸ Palinsesto AI attivo",
    "▸ R-A.I. · The Broadcaster",
  ]);

  // aggiorna pensiero quando cambia il segmento corrente
  useEffect(() => {
    if (!current) return;
    const kind = (current.kind || "").toLowerCase();
    const dj = current.dj_name || "DJ";
    const title = (current.title || "").slice(0, 60);
    let msg = null;
    if (kind === "music") msg = `CUE · analisi BPM · ${title}`;
    else if (kind === "talk") msg = `${dj} · rubrica talk in onda`;
    else if (kind === "news") msg = `${dj} · notizie in tempo reale · rewrite AI`;
    else if (kind === "joke") msg = `${dj} · pausa comica`;
    else if (kind === "weather") msg = `${dj} · meteo live`;
    else if (kind === "horoscope") msg = `${dj} · oroscopo cosmico`;
    else if (kind === "interview") msg = `${dj} · intervista simulata`;
    else if (kind === "motivation") msg = `${dj} · booster motivazionale`;
    else if (kind === "history") msg = `${dj} · rubrica storia`;
    else if (kind === "answer") msg = `${dj} · risposta LLM → TTS ElevenLabs`;
    else if (kind === "community") msg = `Umani Vs Algoritmo · ${title}`;
    else if (kind === "ad_spot") msg = `SPONSOR SLOT · ON AIR`;
    else if (kind === "jingle") msg = `Jingle intercalato · ducking musica`;
    else if (kind === "time_signal") {
      const h = new Date().getHours();
      msg = `Segnale orario delle ${String(h).padStart(2,"0")}:00 · atomic clock`;
    }
    if (msg) {
      setThoughts(prev => {
        const next = [...prev, msg];
        return next.slice(-8);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, current?.kind]);

  // heartbeat station ogni 10s
  useEffect(() => {
    const iv = setInterval(async () => {
      try {
        const s = await endpoints.station();
        const listeners = s?.listeners || 0;
        const total = s?.total_segments || 0;
        setThoughts(prev => {
          const next = [...prev, `heartbeat · listeners=${listeners} · segments=${total}`];
          return next.slice(-8);
        });
      } catch {}
    }, 10000);
    return () => clearInterval(iv);
  }, []);

  // Concatena i pensieri con separatore neon per marquee seamless
  const streamText = thoughts.join("     ◆     ") + "     ◆     ";
  return (
    <div
      data-testid="live-brain-ticker"
      className="flex-1 overflow-hidden relative"
      style={{
        height,
        borderRadius: 10,
        background: "linear-gradient(180deg, #030616 0%, #01030C 100%)",
        border: "1px solid rgba(0,229,255,0.35)",
        boxShadow: "inset 0 0 12px rgba(0,229,255,0.15), 0 0 14px rgba(0,229,255,0.2)",
      }}
    >
      {/* Etichetta LCD */}
      <div
        aria-hidden
        className="absolute left-2 top-1 text-[9px] font-mono uppercase tracking-widest"
        style={{ color: "rgba(0,229,255,0.55)", letterSpacing: "0.22em" }}
      >
        LIVE BRAIN
      </div>
      {/* Track scrolling */}
      <div
        className="absolute inset-0 flex items-center"
        style={{ paddingLeft: 76 }}
      >
        <div
          className="lb-ticker-track"
          aria-live="polite"
          style={{
            whiteSpace: "nowrap",
            willChange: "transform",
            fontFamily: '"Share Tech Mono","VT323",ui-monospace,monospace',
            fontSize: 13,
            color: "#B8ECFF",
            textShadow: "0 0 4px rgba(0,229,255,0.85), 0 0 12px rgba(0,180,255,0.4)",
          }}
        >
          <span>{streamText}</span>
          <span aria-hidden>{streamText}</span>
        </div>
      </div>
      {/* Bordi laterali con fade */}
      <div aria-hidden className="absolute inset-y-0 left-0 w-14 pointer-events-none"
           style={{ background: "linear-gradient(90deg, #010207 0%, transparent 100%)" }} />
      <div aria-hidden className="absolute inset-y-0 right-0 w-10 pointer-events-none"
           style={{ background: "linear-gradient(-90deg, #010207 0%, transparent 100%)" }} />
      <style>{`
        @keyframes lbTickerScroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .lb-ticker-track {
          display: inline-flex;
          animation: lbTickerScroll 45s linear infinite;
        }
      `}</style>
    </div>
  );
}
