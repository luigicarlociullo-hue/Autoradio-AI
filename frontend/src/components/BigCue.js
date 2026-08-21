import React from "react";

/**
 * BigCue — mascotte "capo" della plancia R-A.I.: robottino simpatico
 * (Emergent-style) con testa arrotondata, occhi LED espressivi e antenna.
 * Anima tech via SVG. Mode: idle | happy | thinking | listen | speaking | alert.
 */
const EYES = {
  idle:     { l: "circle", r: "circle" },
  happy:    { l: "arc-up", r: "arc-up" },     // occhi a "^"
  thinking: { l: "circle", r: "arc-side" },   // pensieroso
  listen:   { l: "circle", r: "circle" },
  speaking: { l: "circle", r: "circle" },
  alert:    { l: "cross", r: "cross" },
};

const MOUTH = {
  idle:     { d: "M 62 78 Q 76 84 90 78", label: "IDLE" },
  happy:    { d: "M 60 78 Q 76 92 92 78", label: "HAPPY" },
  thinking: { d: "M 62 82 L 90 82",       label: "THINKING" },
  listen:   { d: "M 62 82 L 90 82",       label: "LISTEN" },
  speaking: { d: "M 60 78 Q 76 88 92 78", label: "ON AIR", animated: true },
  alert:    { d: "M 62 82 Q 76 74 90 82", label: "ALERT" },
};

function Eye({ shape, cx, cy, color = "#00E5FF" }) {
  if (shape === "arc-up") {
    return <path d={`M ${cx - 6} ${cy + 2} Q ${cx} ${cy - 6} ${cx + 6} ${cy + 2}`} stroke={color} strokeWidth="2.6" fill="none" strokeLinecap="round" />;
  }
  if (shape === "arc-side") {
    return <path d={`M ${cx - 6} ${cy} Q ${cx} ${cy + 5} ${cx + 6} ${cy}`} stroke={color} strokeWidth="2.6" fill="none" strokeLinecap="round" />;
  }
  if (shape === "cross") {
    return (
      <g stroke={color} strokeWidth="2.6" strokeLinecap="round">
        <line x1={cx - 5} y1={cy - 5} x2={cx + 5} y2={cy + 5} />
        <line x1={cx + 5} y1={cy - 5} x2={cx - 5} y2={cy + 5} />
      </g>
    );
  }
  return <circle cx={cx} cy={cy} r="4.5" fill={color} />;
}

export default function BigCue({ mode = "idle", size = 96 }) {
  const eyes = EYES[mode] || EYES.idle;
  const mouth = MOUTH[mode] || MOUTH.idle;
  const accent = mode === "alert" ? "#FF6B00" : mode === "speaking" ? "#FF8A00" : "#00E5FF";

  return (
    <div
      data-testid="big-cue"
      data-mode={mode}
      className="relative shrink-0"
      style={{ width: size, height: size, filter: `drop-shadow(0 0 12px ${accent}66)` }}
      aria-label={`CUE ${mouth.label}`}
      title={`CUE · ${mouth.label}`}
    >
      <svg viewBox="0 0 160 160" width={size} height={size}>
        <defs>
          <linearGradient id="cueBodyGrad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#1B2740" />
            <stop offset="1" stopColor="#08111F" />
          </linearGradient>
          <linearGradient id="cueVisorGrad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#050B18" />
            <stop offset="1" stopColor="#0E1830" />
          </linearGradient>
          <radialGradient id="cueEyeGlow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor={accent} stopOpacity="0.85" />
            <stop offset="1" stopColor={accent} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Antenna */}
        <line x1="80" y1="6" x2="80" y2="24" stroke="#3B5075" strokeWidth="2" />
        <circle cx="80" cy="6" r="3.5" fill={accent}>
          <animate attributeName="opacity" values="1;0.35;1" dur="1.6s" repeatCount="indefinite" />
        </circle>

        {/* Head shell */}
        <rect x="26" y="22" width="108" height="82" rx="26" ry="26" fill="url(#cueBodyGrad)" stroke="#2C4267" strokeWidth="1.5" />
        {/* Shine highlight */}
        <rect x="34" y="30" width="80" height="10" rx="6" fill="#FFFFFF" opacity="0.06" />
        {/* Visor (dark screen) */}
        <rect x="40" y="42" width="80" height="34" rx="12" fill="url(#cueVisorGrad)" stroke="#1B2A46" strokeWidth="1" />
        {/* Glow behind eyes */}
        <ellipse cx="60" cy="59" rx="14" ry="10" fill="url(#cueEyeGlow)" />
        <ellipse cx="100" cy="59" rx="14" ry="10" fill="url(#cueEyeGlow)" />
        {/* Eyes */}
        <Eye shape={eyes.l} cx={60} cy={59} color={accent} />
        <Eye shape={eyes.r} cx={100} cy={59} color={accent} />
        {/* Blush cheeks */}
        <circle cx={42} cy={72} r="3" fill="#FF6BA6" opacity="0.55" />
        <circle cx={118} cy={72} r="3" fill="#FF6BA6" opacity="0.55" />
        {/* Mouth */}
        <path
          d={mouth.d}
          stroke={accent}
          strokeWidth="2.6"
          fill="none"
          strokeLinecap="round"
        >
          {mouth.animated && (
            <animate attributeName="d"
              values={`${mouth.d};M 60 80 Q 76 74 92 80;${mouth.d}`}
              dur="0.55s" repeatCount="indefinite" />
          )}
        </path>

        {/* Ear headphones */}
        <rect x="16" y="46" width="14" height="24" rx="6" fill="#111B31" stroke="#2C4267" strokeWidth="1" />
        <rect x="130" y="46" width="14" height="24" rx="6" fill="#111B31" stroke="#2C4267" strokeWidth="1" />

        {/* Chest / neck strip */}
        <rect x="60" y="104" width="40" height="10" rx="4" fill="#0C1424" stroke="#2C4267" strokeWidth="1" />
        {/* R-A.I. badge */}
        <text x="80" y="112" textAnchor="middle" fontSize="7" fontFamily="Share Tech Mono, monospace" fill={accent} letterSpacing="1.2">
          R-A.I.
        </text>

        {/* Body base */}
        <rect x="34" y="116" width="92" height="30" rx="14" fill="url(#cueBodyGrad)" stroke="#2C4267" strokeWidth="1.5" />
        {/* Status dots on chest */}
        <circle cx="60" cy="131" r="2.8" fill={accent}>
          <animate attributeName="opacity" values="1;0.3;1" dur="1.1s" repeatCount="indefinite" />
        </circle>
        <circle cx="80" cy="131" r="2.8" fill="#FFB84D" opacity="0.9" />
        <circle cx="100" cy="131" r="2.8" fill="#FF6B00">
          <animate attributeName="opacity" values="0.35;1;0.35" dur="1.4s" repeatCount="indefinite" />
        </circle>
      </svg>
    </div>
  );
}
