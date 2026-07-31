import React, { useEffect, useRef, useState } from "react";
import radioEngine from "@/lib/radioEngine";

/**
 * PulsingBrand v7 — visual reconstructed from scratch, no static PNG.
 * Pieces (from back to front):
 *   1. Pure black background.
 *   2. Symmetric vertical spectrum bars driven by the live analyser.
 *      They form a wave peak at the center, taller and denser than the
 *      wordmark — this IS the "moving signal".
 *   3. "R-A.I." wordmark superimposed at the center, laser-drawn on
 *      mount, thin and tech.
 *   4. Floor reflection (mirrored bars + mirrored wordmark, faded).
 *
 * The whole scene slowly cycles hue over ~40 s, so it visibly transitions
 * from blue → violet → magenta → red-orange → back to blue. Bars, glow
 * and wordmark shift together to stay coherent.
 * Music reactivity: bar height, wordmark scale/glow, and character spread
 * on bass kicks.
 */
const CHARS = ["R", "-", "A", ".", "I", "."];

export default function PulsingBrand({
  isPlaying = false,
  trackOverlay = null,
}) {
  const canvasRef = useRef(null);
  const reflCanvasRef = useRef(null);
  const charRefs = useRef([]);
  const reflCharRefs = useRef([]);
  const rafRef = useRef(null);
  const beatState = useRef({ prevBass: 0 });
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDrawn(true), 60);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const cvs = canvasRef.current;
    const refl = reflCanvasRef.current;
    if (!cvs || !refl) return;
    const ctxs = [cvs.getContext("2d"), refl.getContext("2d")];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      [cvs, refl].forEach((c) => {
        const r = c.getBoundingClientRect();
        c.width = Math.floor(r.width * dpr);
        c.height = Math.floor(r.height * dpr);
      });
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cvs);

    const draw = () => {
      const analyser = radioEngine.getAnalyser();
      const binCount = analyser ? analyser.frequencyBinCount : 128;
      const freq = new Uint8Array(binCount);
      if (analyser) analyser.getByteFrequencyData(freq);

      const now = performance.now() * 0.001;
      const idleAmp = isPlaying ? 0.28 : 0.10;

      // Beat + energy
      let bassSum = 0;
      const bEnd = analyser ? Math.min(14, binCount) : 0;
      for (let i = 2; i < bEnd; i++) bassSum += freq[i];
      const bass = analyser ? bassSum / (bEnd - 2) / 255 : 0;
      const smoothedBass = beatState.current.prevBass * 0.85 + bass * 0.15;
      beatState.current.prevBass = smoothedBass;

      let midSum = 0;
      const mEnd = analyser ? Math.min(80, binCount) : 0;
      for (let i = 4; i < mEnd; i++) midSum += freq[i];
      const midAvg = analyser ? midSum / (mEnd - 4) / 255 : 0;
      const breath = 0.5 + 0.5 * Math.sin(now * 1.5);
      const energy = analyser ? Math.max(midAvg, idleAmp * 0.5) : idleAmp * breath;

      // Slow hue cycle — full loop every ~40 seconds. Starts near blue (210).
      const HUE = ((now * 9) + 210) % 360;

      // --- Vertical spectrum bars (main + reflection) ---
      ctxs.forEach((ctx, ci) => {
        const canv = ci === 0 ? cvs : refl;
        const w = canv.width;
        const h = canv.height;
        if (!w || !h) return;
        ctx.clearRect(0, 0, w, h);

        const bandCount = 150;
        const gap = 2 * dpr;
        const barW = Math.max(1.2 * dpr, (w / bandCount) - gap);
        const centerY = h * 0.5;
        for (let i = 0; i < bandCount; i++) {
          const half = bandCount / 2;
          const distFromCenter = Math.abs(i - half + 0.5) / half; // 0..1
          const binIdx = Math.floor(4 + distFromCenter * Math.min(180, binCount - 4));
          const live = analyser ? freq[binIdx] / 255 : 0;
          const idle = idleAmp * (0.45 + 0.55 * Math.sin(now * 2.2 + i * 0.34));
          const v = analyser ? Math.min(1, live * 1.2 + idle * 0.22) : idle;

          const shape = Math.pow(1 - distFromCenter, 0.7);
          const barH = Math.max(3 * dpr, v * h * 1.6 * (0.30 + 0.70 * shape));
          const x = i * (barW + gap);
          const y = centerY - barH / 2;

          const grad = ctx.createLinearGradient(x, y, x, y + barH);
          grad.addColorStop(0, `hsla(${HUE}, 100%, 78%, ${0.20 + v * 0.30})`);
          grad.addColorStop(0.5, `hsla(${HUE}, 100%, 62%, 0.95)`);
          grad.addColorStop(1, `hsla(${HUE}, 100%, 78%, ${0.20 + v * 0.30})`);
          ctx.fillStyle = grad;
          ctx.fillRect(x, y, barW, barH);
        }
      });

      // --- Wordmark reactivity ---
      const restCenter = (CHARS.length - 1) / 2;
      const spreadBoost = Math.min(1, smoothedBass * 1.6 + energy * 0.35);
      const glowMain = 4 + energy * 22;
      const glowFar = 12 + energy * 44;
      const scale = 1 + energy * 0.05;

      for (let i = 0; i < CHARS.length; i++) {
        const el = charRefs.current[i];
        if (!el) continue;
        const rel = i - restCenter;
        const push = rel * spreadBoost * 8;
        const dip = -energy * 3;
        el.style.transform =
          `translate(${push.toFixed(2)}px, ${dip.toFixed(2)}px) scale(${scale.toFixed(3)})`;
        el.style.color = `hsl(${HUE}, 100%, 88%)`;
        el.style.textShadow =
          `0 0 ${glowMain}px hsla(${HUE}, 100%, 75%, ${(0.75 + energy * 0.25).toFixed(2)}),` +
          `0 0 ${glowFar}px hsla(${HUE}, 100%, 60%, ${(0.55 + energy * 0.35).toFixed(2)}),` +
          `0 0 ${(glowFar * 2).toFixed(0)}px hsla(${HUE}, 100%, 50%, ${(0.30 + energy * 0.30).toFixed(2)})`;

        const rEl = reflCharRefs.current[i];
        if (rEl) {
          rEl.style.transform = el.style.transform;
          rEl.style.color = el.style.color;
          rEl.style.textShadow = el.style.textShadow;
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [isPlaying]);

  const wordmarkStyle = {
    fontFamily: '"Orbitron", "Chakra Petch", ui-monospace, monospace',
    fontWeight: 500,
    fontSize: "clamp(1.6rem, 4.6vw, 3.6rem)",
    letterSpacing: "0.05em",
    lineHeight: 1,
    color: "#eaf6ff",
    fontVariantLigatures: "none",
  };

  const renderWordmark = (isReflection = false) => (
    <div
      className="notranslate flex items-center justify-center"
      style={{ gap: "0.24em", ...wordmarkStyle }}
      aria-label="R-A.I."
      translate="no"
    >
      {CHARS.map((c, i) => (
        <span
          key={i}
          ref={(el) => {
            if (isReflection) reflCharRefs.current[i] = el;
            else charRefs.current[i] = el;
          }}
          className={`rai-glyph ${drawn ? "rai-glyph-drawn" : ""}`}
          style={{
            display: "inline-block",
            transitionProperty: "transform, filter, color, text-shadow",
            transitionDuration: "0.18s",
            transitionTimingFunction: "cubic-bezier(0.2, 0.9, 0.25, 1)",
            willChange: "transform, filter, color, text-shadow",
            animationDelay: `${i * 90}ms`,
          }}
        >
          {c}
        </span>
      ))}
    </div>
  );

  return (
    <div
      data-testid="pulsing-brand"
      className="relative w-full rounded-2xl overflow-hidden focusable"
      style={{
        aspectRatio: "16 / 9",
        background: "#000",
        border: "1px solid rgba(80,160,255,0.15)",
      }}
    >
      {/* LIVE indicator */}
      <div className="absolute top-3 left-4 flex items-center gap-2 pointer-events-none z-30">
        <span className="font-mono text-[10px] tracking-widest text-cyan-300 uppercase">
          Live Signal
        </span>
        {isPlaying && (
          <span
            className="live-dot"
            style={{ background: "#61c9ff", boxShadow: "0 0 8px #61c9ff" }}
          />
        )}
      </div>

      {/* Upper stage — bars + wordmark */}
      <div
        className="absolute left-0 right-0 top-0 pointer-events-none"
        style={{ height: "62%", zIndex: 5 }}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          data-testid="pulsing-brand-canvas"
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <div data-testid="pulsing-brand-text">
            {renderWordmark(false)}
          </div>
        </div>
        {/* Laser sweep entrance */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="rai-laser-sweep" aria-hidden />
        </div>
      </div>

      {/* Reflection */}
      <div
        className="absolute left-0 right-0 bottom-0 pointer-events-none overflow-hidden"
        style={{
          height: "38%",
          transform: "scaleY(-1)",
          opacity: 0.45,
          maskImage:
            "linear-gradient(to bottom, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0) 90%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0) 90%)",
          filter: "blur(1px)",
        }}
      >
        <canvas
          ref={reflCanvasRef}
          className="absolute inset-0 w-full"
          style={{ height: "160%" }}
        />
        <div className="absolute inset-0 flex items-start justify-center pt-[4%]">
          {renderWordmark(true)}
        </div>
      </div>

      {/* Horizon line */}
      <div
        aria-hidden
        className="absolute left-0 right-0 pointer-events-none"
        style={{
          bottom: "38%",
          height: 1,
          background:
            "linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(180,220,255,0.55) 50%, rgba(0,0,0,0) 100%)",
          boxShadow: "0 0 12px rgba(180,220,255,0.35)",
        }}
      />

      {/* Vignette */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.55) 100%)",
        }}
      />

      {/* Track overlay */}
      {trackOverlay && (
        <div
          className="track-overlay"
          data-testid="track-overlay"
          style={{
            position: "absolute",
            bottom: 20,
            left: 0,
            right: 0,
            textAlign: "center",
            pointerEvents: "none",
            opacity: trackOverlay.visible ? 1 : 0,
            transition: "opacity 0.8s ease",
            zIndex: 20,
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
        .rai-glyph { opacity: 0; transform: translateY(6px) scale(0.85); }
        .rai-glyph-drawn { animation: raiGlyphIn 900ms cubic-bezier(0.2,0.9,0.25,1) forwards; }
        @keyframes raiGlyphIn {
          0%   { opacity: 0;   transform: translateY(6px) scale(0.85); }
          45%  { opacity: 1;   transform: translateY(-2px) scale(1.03); }
          100% { opacity: 1;   transform: translateY(0) scale(1); }
        }
        .rai-laser-sweep {
          position: absolute; top: 0; bottom: 0; width: 3px; left: -5%;
          background: linear-gradient(180deg,
                       rgba(180,230,255,0) 0%,
                       rgba(180,230,255,0.95) 45%,
                       rgba(255,255,255,1) 50%,
                       rgba(180,230,255,0.95) 55%,
                       rgba(180,230,255,0) 100%);
          filter: blur(1.5px);
          box-shadow: 0 0 20px #7cd6ff, 0 0 40px #7cd6ff;
          animation: raiLaserSweep 1400ms cubic-bezier(0.22,1,0.36,1) 1 both;
        }
        @keyframes raiLaserSweep {
          0%   { left: -5%;  opacity: 0; }
          10%  { opacity: 0.9; }
          80%  { opacity: 0.9; }
          100% { left: 105%; opacity: 0; }
        }
        .track-title {
          font-family: 'Orbitron', 'Chakra Petch', sans-serif;
          font-size: clamp(0.85em, 1.4vw, 1.1em);
          font-weight: 600;
          color: #eaf6ff;
          text-shadow: 0 0 8px currentColor;
          letter-spacing: 3px;
          text-transform: uppercase;
        }
        .track-artist {
          font-family: 'Chakra Petch', sans-serif;
          font-size: clamp(0.6em, 0.9vw, 0.8em);
          color: #a8dcff;
          text-shadow: 0 0 6px #4bb4ff;
          margin-top: 4px;
          letter-spacing: 2px;
          font-weight: 500;
        }
      `}</style>
    </div>
  );
}
