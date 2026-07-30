import React, { useEffect, useRef } from "react";
import radioEngine from "@/lib/radioEngine";

/**
 * PulsingBrand — the beating heart of R-A.I.
 *
 * Replaces the old rotating spectrum + orb visualizer. Instead, the six
 * characters of "R-A.I." are rendered center-stage and each one reacts
 * to a different band of the live audio spectrum in real time.
 *
 * Design language inherited from the previous visualizer:
 *   - Neon palette: hot magenta (#ff1493), cyan (#22d3ee), violet (#8a2be2)
 *   - Grain overlay + subtle radial vignette
 *   - Track title/artist overlay at the bottom fades in/out on music segments
 *
 * Each character is mapped to a band:
 *   R  → sub-bass
 *   -  → bass
 *   A  → low-mid
 *   .  → mid
 *   I  → high-mid
 *   .  → treble
 * The character's scale, brightness, and glow color intensity follow the
 * band amplitude. When audio is idle, a slow "breathing" pulse keeps the
 * logo alive so the page never feels dead.
 */
const CHARS = ["R", "-", "A", ".", "I", "."];
// Six evenly spaced frequency-bin indexes across the useful spectrum (0..255).
// Skip the very bottom bins (DC / rumble) and cap around index 180 (~8kHz)
// so treble does not vanish when music is quiet.
const BAND_INDEXES = [6, 18, 34, 60, 96, 150];

export default function PulsingBrand({
  isPlaying = false,
  currentKind = "",
  trackOverlay = null,
}) {
  const containerRef = useRef(null);
  const rafRef = useRef(null);
  const charRefs = useRef([]);

  useEffect(() => {
    const tick = () => {
      const analyser = radioEngine.getAnalyser();
      const binCount = analyser ? analyser.frequencyBinCount : 128;
      const freq = new Uint8Array(binCount);
      if (analyser) analyser.getByteFrequencyData(freq);

      // Fallback breathing amplitude when there is no live audio.
      const now = performance.now() * 0.001;
      const idleAmp = isPlaying ? 0.22 : 0.10;
      const breath = 0.5 + 0.5 * Math.sin(now * 1.4);

      for (let i = 0; i < CHARS.length; i++) {
        const el = charRefs.current[i];
        if (!el) continue;
        const idx = Math.min(binCount - 1, BAND_INDEXES[i]);
        const live = analyser ? freq[idx] / 255 : 0;
        // Weighted blend of live band amplitude and idle breathing.
        const v = analyser
          ? Math.min(1, live * 1.15 + 0.05 + idleAmp * (1 - live) * 0.4)
          : idleAmp * (0.6 + 0.7 * breath);

        // Character transforms — punctuation stays slightly smaller.
        const isPunct = CHARS[i] === "-" || CHARS[i] === ".";
        const baseScale = isPunct ? 0.72 : 1.0;
        const scale = baseScale * (1 + v * 0.28);
        const brightness = 0.55 + v * 0.75;
        const glow1 = 8 + v * 34;
        const glow2 = 20 + v * 60;
        // Hue shift keeps the brand identity but reacts to segment kind.
        const kindHueMap = {
          music: 320, talk: 190, news: 275, answer: 210, weather: 200,
          horoscope: 285, history: 40, interview: 330, motivation: 100, joke: 0,
        };
        const baseHue = kindHueMap[currentKind] ?? 320;
        // Odd chars get the accent (cyan-ish), even chars stay on the base hue.
        const hue = i % 2 === 0 ? baseHue : (baseHue + 190) % 360;

        el.style.transform = `translateY(${-v * 4}px) scale(${scale.toFixed(3)})`;
        el.style.filter = `brightness(${brightness.toFixed(2)})`;
        el.style.textShadow = `0 0 ${glow1}px hsla(${hue},100%,65%,${(0.55 + v * 0.35).toFixed(2)}), 0 0 ${glow2}px hsla(${hue},100%,55%,${(0.30 + v * 0.35).toFixed(2)})`;
        el.style.color = `hsl(${hue}, 100%, ${(70 + v * 20).toFixed(0)}%)`;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, currentKind]);

  return (
    <div
      ref={containerRef}
      data-testid="pulsing-brand"
      className="relative w-full rounded-2xl overflow-hidden focusable"
      style={{
        aspectRatio: "16 / 9",
        background:
          "radial-gradient(ellipse at center, #0a0a1a 0%, #05050A 65%, #000 100%)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      {/* Grain overlay (kept from previous visualizer for continuity) */}
      <div
        className="absolute inset-0 pointer-events-none opacity-25 mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence baseFrequency='0.85' numOctaves='2'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.1 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
        }}
      />

      {/* Corner labels */}
      <div className="absolute top-3 left-4 flex items-center gap-2 pointer-events-none z-10">
        <span className="font-mono text-[10px] tracking-widest text-cyan-400 uppercase">
          Live Visual
        </span>
        {isPlaying && (
          <span
            className="live-dot"
            style={{ background: "#22d3ee", boxShadow: "0 0 8px #22d3ee" }}
          />
        )}
      </div>

      {/* Pulsating brand — center stage */}
      <div
        className="absolute inset-0 flex items-center justify-center pointer-events-none select-none"
        aria-label="R-A.I."
        translate="no"
      >
        <div
          className="notranslate flex items-center"
          data-testid="pulsing-brand-text"
          style={{
            fontFamily:
              'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
            fontWeight: 700,
            fontSize: "clamp(3rem, 12vw, 9rem)",
            letterSpacing: "0.06em",
            lineHeight: 1,
            fontVariantLigatures: "none",
          }}
        >
          {CHARS.map((c, i) => (
            <span
              key={i}
              ref={(el) => (charRefs.current[i] = el)}
              style={{
                display: "inline-block",
                transition: "color 0.2s linear",
                willChange: "transform, text-shadow, color",
              }}
            >
              {c}
            </span>
          ))}
        </div>
      </div>

      {/* Neon track overlay — music-segment sovrimpressione with fade in/out */}
      {trackOverlay && (
        <div
          className="track-overlay"
          data-testid="track-overlay"
          style={{
            position: "absolute",
            bottom: 32,
            left: 0,
            right: 0,
            textAlign: "center",
            pointerEvents: "none",
            opacity: trackOverlay.visible ? 1 : 0,
            transition: "opacity 0.8s ease",
            zIndex: 5,
          }}
        >
          <div className="track-title" data-testid="track-overlay-title">
            {trackOverlay.title}
          </div>
          {trackOverlay.artist && (
            <div className="track-artist" data-testid="track-overlay-artist">
              {trackOverlay.artist}
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes neonPulse {
          0%, 100% { text-shadow: 0 0 8px #ff00ff, 0 0 20px #ff00ff, 0 0 40px #ff00ff; }
          50%      { text-shadow: 0 0 4px #00eaff, 0 0 12px #00eaff, 0 0 24px #00eaff; }
        }
        .track-title {
          font-family: 'Unbounded', sans-serif;
          font-size: clamp(0.9em, 1.6vw, 1.3em);
          font-weight: 900;
          color: #fff;
          animation: neonPulse 2s ease-in-out infinite;
          letter-spacing: 3px;
          text-transform: uppercase;
        }
        .track-artist {
          font-family: 'Unbounded', sans-serif;
          font-size: clamp(0.65em, 0.9vw, 0.85em);
          color: #00eaff;
          text-shadow: 0 0 8px #00eaff, 0 0 18px rgba(0,234,255,0.5);
          margin-top: 6px;
          letter-spacing: 2px;
          font-weight: 700;
        }
      `}</style>
    </div>
  );
}
