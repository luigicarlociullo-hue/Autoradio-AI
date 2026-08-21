import React from "react";

/**
 * Cue — mascotte pixel-art LED del regista robotico.
 * Espressioni (mode): idle | thinking | happy | listen | speaking | alert
 * Renderizza una faccia 8×8 in pixel via CSS-grid, con scanlines e piedistallo.
 */
const FACES = {
  idle:     [[3,2],[4,2],[3,5],[4,5]],
  happy:    [[3,2],[4,2],[2,5],[3,6],[4,6],[5,5]],
  thinking: [[3,2],[4,2],[2,5],[3,5],[4,5]],   // bocca corta a sinistra
  listen:   [[3,1],[4,1],[3,2],[4,2],[3,5],[4,5]],
  speaking: [[3,2],[4,2],[2,5],[3,5],[4,5],[5,5]],
  alert:    [[3,1],[4,1],[3,2],[4,2],[2,5],[3,5],[4,5],[5,5]],
};

const LABELS = {
  idle: "IDLE", happy: "HAPPY", thinking: "THINKING",
  listen: "LISTEN", speaking: "ON AIR", alert: "ALERT",
};

export default function Cue({ mode = "idle", label, compact = false }) {
  const pixels = FACES[mode] || FACES.idle;
  const pxSet = new Set(pixels.map(([x, y]) => `${x},${y}`));
  const size = compact ? 4 : 6; // px per cell
  const grid = 8;

  return (
    <div
      data-testid="cue-robot"
      data-mode={mode}
      className="inline-flex items-center gap-2 select-none"
      style={{
        padding: compact ? "6px 8px" : "8px 12px",
        borderRadius: 10,
        background: "linear-gradient(180deg, rgba(0,20,30,0.75) 0%, rgba(0,10,20,0.85) 100%)",
        border: "1px solid rgba(0,229,255,0.35)",
        boxShadow: "inset 0 0 12px rgba(0,229,255,0.15), 0 0 14px rgba(0,229,255,0.2)",
      }}
    >
      <div
        aria-hidden
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${grid}, ${size}px)`,
          gridTemplateRows: `repeat(${grid}, ${size}px)`,
          gap: 1,
        }}
      >
        {Array.from({ length: grid * grid }).map((_, i) => {
          const x = i % grid, y = Math.floor(i / grid);
          const on = pxSet.has(`${x},${y}`);
          return (
            <div
              key={i}
              style={{
                width: size,
                height: size,
                background: on ? "#00E5FF" : "rgba(0,229,255,0.05)",
                boxShadow: on ? "0 0 4px #00E5FF, 0 0 8px rgba(0,229,255,0.5)" : "none",
                borderRadius: 1,
              }}
            />
          );
        })}
      </div>
      <div className="flex flex-col leading-tight">
        <span
          className="text-[9px] font-mono uppercase tracking-widest text-cyan-500"
          style={{ letterSpacing: "0.18em" }}
        >
          CUE · Regista
        </span>
        <span
          className="text-[10px] font-mono uppercase text-glow-cyan"
          style={{
            color: "#B8ECFF",
            textShadow: "0 0 4px rgba(0,229,255,0.85), 0 0 10px rgba(0,180,255,0.55)",
          }}
        >
          {label || LABELS[mode] || "IDLE"}
        </span>
      </div>
    </div>
  );
}
