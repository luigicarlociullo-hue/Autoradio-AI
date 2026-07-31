import React, { useEffect, useRef, useState } from "react";
import radioEngine from "@/lib/radioEngine";

/**
 * PulsingBrand v3 — laser-drawn wordmark over equalizer bars.
 *
 * • Background: pure black + faint tech grid + vertical spectrum bars
 *   driven by the live audio analyser (symmetric, blue palette).
 * • Wordmark "R-A.I." rendered as SVG stroked text so we can draw it
 *   with a "laser" effect on mount (stroke-dashoffset animation from full
 *   length to zero), then fade in the fill.
 * • Once drawn, the six glyphs (R, -, A, ., I, .) push outwards from the
 *   center on every bass beat, then return to rest → the letters "breathe"
 *   with the music, and spread apart on kicks.
 * • The waveform equalizer is drawn on a canvas behind the SVG, so the
 *   wordmark stays crisp while the equalizer lives underneath it.
 * • Floor reflection uses the same canvas mirrored + a mirrored SVG.
 */
const CHARS = ["R", "-", "A", ".", "I", "."];

export default function PulsingBrand({
  isPlaying = false,
  currentKind = "",
  trackOverlay = null,
}) {
  const radialRef = useRef(null);
  const radialReflRef = useRef(null);
  const barsRef = useRef(null);
  const reflBarsRef = useRef(null);
  const rafRef = useRef(null);
  const charRefs = useRef([]);
  const reflCharRefs = useRef([]);
  const beatState = useRef({ prevBass: 0, restPos: [], lastBeatAt: 0 });
  const rotationRef = useRef(0);
  const [drawn, setDrawn] = useState(false);

  // Trigger laser-draw animation on mount / when it becomes visible.
  useEffect(() => {
    const t = setTimeout(() => setDrawn(true), 60);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const bars = barsRef.current;
    const refl = reflBarsRef.current;
    const radial = radialRef.current;
    const radialRefl = radialReflRef.current;
    if (!bars || !refl || !radial) return;
    const ctxs = [bars.getContext("2d"), refl.getContext("2d")];
    const radialCtxs = [radial.getContext("2d"), radialRefl ? radialRefl.getContext("2d") : null];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      [bars, refl, radial, radialRefl].filter(Boolean).forEach((c) => {
        const r = c.getBoundingClientRect();
        c.width = Math.floor(r.width * dpr);
        c.height = Math.floor(r.height * dpr);
      });
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(bars);
    ro.observe(radial);

    const draw = () => {
      const analyser = radioEngine.getAnalyser();
      const binCount = analyser ? analyser.frequencyBinCount : 128;
      const freq = new Uint8Array(binCount);
      if (analyser) analyser.getByteFrequencyData(freq);

      const now = performance.now() * 0.001;
      const idleAmp = isPlaying ? 0.24 : 0.08;

      // Beat detection: bass energy vs slow-moving envelope.
      let bassSum = 0;
      const bassEnd = analyser ? Math.min(14, binCount) : 0;
      for (let i = 2; i < bassEnd; i++) bassSum += freq[i];
      const bass = analyser ? bassSum / (bassEnd - 2) / 255 : 0;
      const prevBass = beatState.current.prevBass;
      const smoothedBass = prevBass * 0.85 + bass * 0.15;
      beatState.current.prevBass = smoothedBass;

      // Master energy (mids average) drives glow intensity.
      let midSum = 0;
      const midTo = analyser ? Math.min(80, binCount) : 0;
      for (let i = 4; i < midTo; i++) midSum += freq[i];
      const midAvg = analyser ? midSum / (midTo - 4) / 255 : 0;
      const breath = 0.5 + 0.5 * Math.sin(now * 1.8);
      const energy = analyser ? Math.max(midAvg, idleAmp * 0.5) : idleAmp * breath;

      // Hue lookup — pre-computed so both radial (deep background) and
      // wordmark glow (top layer) share the same accent color.
      const kindHueMap = { talk: 195, news: 220, answer: 205, weather: 205,
        horoscope: 250, history: 30, interview: 210, motivation: 150, joke: 40 };
      const hue = kindHueMap[currentKind] ?? 205;

      // --- Radial spectrum "laser rays" (deepest background layer) ---
      // A ring shoots colored neon rays outwards in every direction, filling
      // the container behind the horizontal wave and the wordmark.
      rotationRef.current += 0.003 + energy * 0.02;
      const rot = rotationRef.current;
      radialCtxs.forEach((rctx, ri) => {
        if (!rctx) return;
        const cvs = ri === 0 ? radial : radialRefl;
        const w = cvs.width;
        const h = cvs.height;
        if (!w || !h) return;
        // Motion-trail fade instead of clear → creates saturated ghost trails.
        rctx.globalCompositeOperation = "source-over";
        rctx.fillStyle = "rgba(0, 0, 0, 0.20)";
        rctx.fillRect(0, 0, w, h);

        const cx = w / 2;
        const cy = h / 2;
        const baseRadius = Math.min(w, h) * 0.18;
        const raysBase = 128;
        rctx.globalCompositeOperation = "screen";
        for (let i = 0; i < raysBase; i++) {
          const freqIdx = Math.floor((i / raysBase) * Math.min(180, binCount));
          const v = analyser ? freq[freqIdx] / 255 : (0.12 + 0.4 * Math.sin(now * 2 + i * 0.15) * idleAmp);
          const angle = rot + (i / raysBase) * Math.PI * 2;
          const rayLen = 30 * dpr + v * baseRadius * 3.6;
          const x1 = cx + Math.cos(angle) * baseRadius;
          const y1 = cy + Math.sin(angle) * baseRadius;
          const x2 = cx + Math.cos(angle) * (baseRadius + rayLen);
          const y2 = cy + Math.sin(angle) * (baseRadius + rayLen);
          // Multi-color neon: hue cycles across the ring for the "colored
          // laser bolts" look, biased towards the electric-blue base hue.
          const baseHue = hue - 30;
          const rayHue = (baseHue + v * 90 + i * 2.6) % 360;
          const grad = rctx.createLinearGradient(x1, y1, x2, y2);
          grad.addColorStop(0, `hsla(${rayHue}, 100%, 60%, ${0.10 + v * 0.55})`);
          grad.addColorStop(1, `hsla(${rayHue}, 100%, 72%, ${0.85 + v * 0.15})`);
          rctx.strokeStyle = grad;
          rctx.lineWidth = (1.6 + v * 3.5) * dpr;
          rctx.lineCap = "round";
          rctx.beginPath();
          rctx.moveTo(x1, y1);
          rctx.lineTo(x2, y2);
          rctx.stroke();
        }

        // Central pulsing core — the "circle" from which the rays shoot.
        const coreR = baseRadius * (0.55 + energy * 0.45);
        const coreGrad = rctx.createRadialGradient(cx, cy, 2, cx, cy, coreR);
        coreGrad.addColorStop(0, `hsla(${hue}, 100%, 78%, ${0.75 + energy * 0.25})`);
        coreGrad.addColorStop(0.55, `hsla(${(hue + 40) % 360}, 100%, 55%, ${0.35 + energy * 0.35})`);
        coreGrad.addColorStop(1, "rgba(0,0,0,0)");
        rctx.fillStyle = coreGrad;
        rctx.beginPath();
        rctx.arc(cx, cy, coreR, 0, Math.PI * 2);
        rctx.fill();
      });

      // --- Equalizer bars (thick horizontal wave, on top of radial) ---
      ctxs.forEach((ctx, ci) => {
        const cvs = ci === 0 ? bars : refl;
        const w = cvs.width;
        const h = cvs.height;
        if (!w || !h) return;
        ctx.clearRect(0, 0, w, h);

        const bandCount = 108;
        const gap = 2 * dpr;
        const barW = Math.max(1 * dpr, (w / bandCount) - gap);
        const centerY = h * 0.5;
        for (let i = 0; i < bandCount; i++) {
          const half = bandCount / 2;
          const distFromCenter = Math.abs(i - half + 0.5) / half;
          const binIdx = Math.floor(6 + distFromCenter * Math.min(180, binCount - 6));
          const live = analyser ? freq[binIdx] / 255 : 0;
          const idle = idleAmp * (0.45 + 0.55 * Math.sin(now * 2.2 + i * 0.34));
          const v = analyser ? Math.min(1, live * 1.15 + idle * 0.22) : idle;

          // Bar shape: dominant peak behind the wordmark, still substantial
          // at the edges. Bars occupy up to ~140% of the available height so
          // the wave visually overpowers the small wordmark on kicks.
          const shape = Math.pow(1 - distFromCenter, 0.9);
          const barH = Math.max(3 * dpr, v * h * 1.35 * (0.55 + 0.45 * shape));
          const x = i * (barW + gap);
          const y = centerY - barH / 2;

          const grad = ctx.createLinearGradient(x, y, x, y + barH);
          grad.addColorStop(0, `rgba(140, 210, 255, ${0.15 + v * 0.25})`);
          grad.addColorStop(0.5, `rgba(70, 155, 255, ${0.75 + v * 0.25})`);
          grad.addColorStop(1, `rgba(140, 210, 255, ${0.15 + v * 0.25})`);
          ctx.fillStyle = grad;
          ctx.fillRect(x, y, barW, barH);
        }
      });

      // --- Wordmark reactivity ---
      // Each char pushes outward from the center on bass energy.
      // Rest positions are equally-spaced integers 0..5 → offset from center 2.5.
      const restCenter = (CHARS.length - 1) / 2; // 2.5
      const spreadBoost = Math.min(1, smoothedBass * 1.6 + energy * 0.35);
      const glowMain = 4 + energy * 22;
      const glowFar = 12 + energy * 40;
      const scale = 1 + energy * 0.05;

      for (let i = 0; i < CHARS.length; i++) {
        const el = charRefs.current[i];
        if (!el) continue;
        const rel = i - restCenter;               // -2.5 .. +2.5
        const push = rel * spreadBoost * 8;       // horizontal spread in px
        const dip = -energy * 3;                  // slight vertical rise on kicks
        el.style.transform = `translate(${push.toFixed(2)}px, ${dip.toFixed(2)}px) scale(${scale.toFixed(3)})`;
        el.style.filter =
          `drop-shadow(0 0 ${glowMain}px hsla(${hue},100%,72%,${(0.65 + energy*0.35).toFixed(2)}))` +
          ` drop-shadow(0 0 ${glowFar}px hsla(${hue},100%,55%,${(0.5 + energy*0.35).toFixed(2)}))`;

        const rel2 = reflCharRefs.current[i];
        if (rel2) {
          rel2.style.transform = `translate(${push.toFixed(2)}px, ${dip.toFixed(2)}px) scale(${scale.toFixed(3)})`;
          rel2.style.filter = el.style.filter;
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [isPlaying, currentKind]);

  // Layout of characters as flex row of individual span elements. We keep them
  // as normal HTML text (not SVG paths) so translations, filters and Unicode
  // are trivial to handle, and so browser text hinting stays sharp.
  const renderWordmark = (isReflection = false) => (
    <div
      className="notranslate flex items-center justify-center"
      style={{
        gap: "0.24em",
        fontFamily: '"Orbitron", "Chakra Petch", ui-monospace, monospace',
        fontWeight: 500,
        letterSpacing: "0.05em",
        fontSize: "clamp(1.6rem, 4.6vw, 3.6rem)",
        color: "#eaf6ff",
        lineHeight: 1,
      }}
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
            transitionProperty: "transform, filter, opacity",
            transitionDuration: "0.18s",
            transitionTimingFunction: "cubic-bezier(0.2, 0.9, 0.25, 1)",
            willChange: "transform, filter",
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
      {/* Faint tech grid overlay */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          opacity: 0.22,
          backgroundImage:
            "linear-gradient(rgba(90,180,255,0.10) 1px, transparent 1px), linear-gradient(90deg, rgba(90,180,255,0.10) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage:
            "radial-gradient(ellipse at center, rgba(0,0,0,0.9) 30%, rgba(0,0,0,0) 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at center, rgba(0,0,0,0.9) 30%, rgba(0,0,0,0) 75%)",
        }}
      />

      {/* Corner labels */}
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

      {/* Deepest layer — full-container radial "circle with laser rays" */}
      <canvas
        ref={radialRef}
        data-testid="pulsing-radial-canvas"
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ zIndex: 1, filter: "blur(0.3px)", opacity: 0.85 }}
      />

      {/* Upper stage — bars + wordmark */}
      <div
        className="absolute left-0 right-0 top-0 pointer-events-none"
        style={{ height: "60%", zIndex: 5 }}
      >
        <canvas
          ref={barsRef}
          className="absolute inset-0 w-full h-full"
          style={{ filter: "blur(0.4px)" }}
        />
        {/* Center highlight halo behind wordmark */}
        <div
          className="absolute left-1/2 top-1/2 pointer-events-none"
          style={{
            width: "60%",
            height: "60%",
            transform: "translate(-50%,-50%)",
            background:
              "radial-gradient(ellipse at center, rgba(80,180,255,0.30) 0%, rgba(80,180,255,0.10) 40%, rgba(0,0,0,0) 70%)",
            filter: "blur(20px)",
          }}
        />

        {/* Laser scan sweep — a thin bright line that runs through the
            wordmark once on mount, giving the illusion the letters were
            drawn by a beam. */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="rai-laser-sweep" aria-hidden />
        </div>

        <div className="absolute inset-0 flex items-center justify-center" data-testid="pulsing-brand-text-wrap">
          <div data-testid="pulsing-brand-text">
            {renderWordmark(false)}
          </div>
        </div>
      </div>

      {/* Reflection */}
      <div
        className="absolute left-0 right-0 bottom-0 pointer-events-none overflow-hidden"
        style={{
          height: "40%",
          transform: "scaleY(-1)",
          opacity: 0.42,
          maskImage:
            "linear-gradient(to bottom, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0) 90%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0) 90%)",
          filter: "blur(1px)",
        }}
      >
        <canvas
          ref={radialReflRef}
          className="absolute inset-0 w-full pointer-events-none"
          style={{ height: "150%", opacity: 0.7 }}
        />
        <canvas
          ref={reflBarsRef}
          className="absolute inset-0 w-full"
          style={{ height: "150%" }}
        />
        <div className="absolute inset-0 flex items-start justify-center pt-[6%]">
          {renderWordmark(true)}
        </div>
      </div>

      {/* Horizon line */}
      <div
        aria-hidden
        className="absolute left-0 right-0 pointer-events-none"
        style={{
          bottom: "40%",
          height: 1,
          background:
            "linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(120,200,255,0.55) 50%, rgba(0,0,0,0) 100%)",
          boxShadow: "0 0 12px rgba(120,200,255,0.35)",
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
        /* Laser-draw entrance: each glyph starts invisible and slightly
           offset, then materialises with a bright flash as if traced by a
           laser beam. Stagger via inline animationDelay. */
        .rai-glyph {
          opacity: 0;
          transform: translateY(6px) scale(0.85);
          filter: drop-shadow(0 0 4px #4bb4ff);
          animation: none;
        }
        .rai-glyph-drawn {
          animation: raiGlyphDraw 900ms cubic-bezier(0.2,0.9,0.25,1) forwards;
        }
        @keyframes raiGlyphDraw {
          0%   { opacity: 0;   transform: translateY(6px) scale(0.85);
                 text-shadow: 0 0 24px #a8dcff, 0 0 42px #4bb4ff; }
          40%  { opacity: 1;   transform: translateY(-2px) scale(1.02);
                 text-shadow: 0 0 32px #a8dcff, 0 0 56px #4bb4ff; }
          100% { opacity: 1;   transform: translateY(0) scale(1);
                 text-shadow: 0 0 8px #4bb4ff, 0 0 22px #4bb4ff; }
        }
        /* Laser sweep — thin bright vertical line running through the wordmark. */
        .rai-laser-sweep {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 3px;
          left: -5%;
          background: linear-gradient(180deg,
                       rgba(140,220,255,0) 0%,
                       rgba(140,220,255,0.95) 45%,
                       rgba(255,255,255,1) 50%,
                       rgba(140,220,255,0.95) 55%,
                       rgba(140,220,255,0) 100%);
          filter: blur(1.5px);
          box-shadow: 0 0 20px #4bb4ff, 0 0 40px #4bb4ff;
          animation: raiLaserSweep 1200ms cubic-bezier(0.22,1,0.36,1) 1 both;
        }
        @keyframes raiLaserSweep {
          0%   { left: -5%;  opacity: 0.0; }
          10%  { opacity: 0.9; }
          80%  { opacity: 0.9; }
          100% { left: 105%; opacity: 0.0; }
        }

        @keyframes neonPulseBlue {
          0%, 100% { text-shadow: 0 0 8px #4bb4ff, 0 0 20px #4bb4ff, 0 0 40px #4bb4ff; }
          50%      { text-shadow: 0 0 4px #a8dcff, 0 0 14px #a8dcff, 0 0 28px #a8dcff; }
        }
        .track-title {
          font-family: 'Orbitron', 'Chakra Petch', sans-serif;
          font-size: clamp(0.85em, 1.4vw, 1.1em);
          font-weight: 600;
          color: #eaf6ff;
          animation: neonPulseBlue 2s ease-in-out infinite;
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
