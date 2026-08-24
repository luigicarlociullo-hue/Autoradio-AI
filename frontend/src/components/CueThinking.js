import React, { useEffect, useState } from "react";

/**
 * CueThinking — mini terminal accanto a CUE. Messaggi casuali stile
 * "AI live thinking". Font mono, glow ciano, cursore lampeggiante.
 * Cambia messaggio ogni 3-6 secondi. Il DJ corrente viene iniettato dinamicamente.
 */
const BASE = [
  "Scanning frequencies…",
  "Syncing neural link…",
  "BPM match locked",
  "Analyzing waveform peaks",
  "Buffering Suno stream…",
  "Tuning ElevenLabs voice…",
  "Cross-fading segments",
  "Loading community track",
  "Injecting reverb tail",
  "Handshake with LLM API",
  "Warming up sequencer",
  "Ducking music channel",
  "Palinsesto locked & loaded",
  "Reading playlist rotation",
  "Whisper transcript ready",
  "Frequency modulation OK",
];

function pickBpm() { return 90 + Math.floor(Math.random() * 60); }

export default function CueThinking({ current }) {
  const [msg, setMsg] = useState("Booting neural core…");

  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const pool = [...BASE];
      pool.push(`BPM match: ${pickBpm()}`);
      const dj = current?.dj_name;
      if (dj) {
        pool.push(`${dj} is thinking…`, `${dj} · script draft`, `${dj} · TTS render`);
      }
      const k = (current?.kind || "").toLowerCase();
      if (k === "music") pool.push("Music slot active", "Analyzing BPM…");
      else if (k === "news") pool.push("Fetching news feed…", "Rewriting headlines");
      else if (k === "ad_spot") pool.push("Sponsor slot ON AIR");
      else if (k === "community") pool.push("Human vs AI · rotation");
      else if (k === "time_signal") pool.push("Atomic clock sync");
      setMsg(pool[Math.floor(Math.random() * pool.length)]);
    };
    tick();
    const iv = setInterval(tick, 3200 + Math.random() * 2500);
    return () => { alive = false; clearInterval(iv); };
  }, [current?.id, current?.kind, current?.dj_name]);

  return (
    <div
      data-testid="cue-thinking"
      className="text-[10px] font-mono uppercase truncate mt-1"
      style={{
        color: "#7FD8FF",
        letterSpacing: "0.12em",
        textShadow: "0 0 4px rgba(0,229,255,0.55)",
        fontFamily: '"Share Tech Mono","VT323",ui-monospace,monospace',
      }}
      aria-live="polite"
    >
      <span style={{ color: "#00E5FF" }}>▸</span> {msg}
      <span
        className="inline-block ml-1 align-middle"
        style={{
          width: 6, height: 10, background: "#00E5FF",
          animation: "cueThinkBlink 1s steps(2) infinite",
        }}
      />
      <style>{`@keyframes cueThinkBlink { 0%,100% { opacity: 1 } 50% { opacity: 0.15 } }`}</style>
    </div>
  );
}
