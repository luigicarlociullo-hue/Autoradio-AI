import React, { useEffect, useRef } from "react";
import radioEngine from "@/lib/radioEngine";

/**
 * PulsingBrand — v2, holographic tech look.
 *
 * Inspired by user's reference image:
 *   • Pure black background
 *   • Vertical electric-blue spectrum bars behind the wordmark, symmetric
 *     around the center like a proper audio visualizer
 *   • Slim "R-A.I." wordmark in Orbitron, small (~3-6% of viewport), with
 *     a crisp cyan/white core and a soft outer glow that breathes with the
 *     master audio energy
 *   • Mirror reflection on the floor — bars + text — faded via mask
 *   • Fine grid / scan-line overlay for the extra tech vibe
 */
export default function PulsingBrand({
  isPlaying = false,
  currentKind = "",
  trackOverlay = null,
}) {
  const barsRef = useRef(null);
  const reflBarsRef = useRef(null);
  const brandRef = useRef(null);
  const reflBrandRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    const bars = barsRef.current;
    const refl = reflBarsRef.current;
    if (!bars || !refl) return;
    const ctxs = [bars.getContext("2d"), refl.getContext("2d")];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      [bars, refl].forEach((c) => {
        const r = c.getBoundingClientRect();
        c.width = Math.floor(r.width * dpr);
        c.height = Math.floor(r.height * dpr);
      });
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(bars);

    const draw = () => {
      const analyser = radioEngine.getAnalyser();
      const binCount = analyser ? analyser.frequencyBinCount : 128;
      const freq = new Uint8Array(binCount);
      if (analyser) analyser.getByteFrequencyData(freq);

      const now = performance.now() * 0.001;
      const idleAmp = isPlaying ? 0.28 : 0.10;

      // Master energy (average of first 60 bins) drives the wordmark glow.
      let sum = 0;
      const takeBins = analyser ? Math.min(80, binCount) : 40;
      for (let i = 4; i < takeBins; i++) sum += analyser ? freq[i] : 0;
      const avg = analyser ? sum / (takeBins - 4) / 255 : 0;
      const breath = 0.5 + 0.5 * Math.sin(now * 1.8);
      const energy = analyser ? Math.max(avg, idleAmp * 0.4) : idleAmp * breath;

      // --- Bars ---
      ctxs.forEach((ctx, ci) => {
        const cvs = ci === 0 ? bars : refl;
        const w = cvs.width;
        const h = cvs.height;
        if (!w || !h) return;
        ctx.clearRect(0, 0, w, h);

        const bandCount = 96;
        const gap = 2 * dpr;
        const barW = Math.max(1 * dpr, (w / bandCount) - gap);
        const centerY = h * 0.5;
        // We render bars mirrored around the horizontal center-line so it
        // looks like a "signal" running through the wordmark's baseline.
        // Left half uses low freq, right half uses high freq, symmetric.
        for (let i = 0; i < bandCount; i++) {
          const half = bandCount / 2;
          // Distance from center → maps to a specific frequency bin.
          const distFromCenter = Math.abs(i - half + 0.5) / half; // 0..1
          const binIdx = Math.floor(6 + distFromCenter * Math.min(180, binCount - 6));
          const live = analyser ? freq[binIdx] / 255 : 0;
          const idle = idleAmp * (0.45 + 0.55 * Math.sin(now * 2.2 + i * 0.34));
          const v = analyser ? Math.min(1, live * 1.15 + idle * 0.25) : idle;

          // Bars near the center are taller; taper towards the edges to
          // make the "peak" behind the wordmark, as in the reference image.
          const shape = Math.pow(1 - distFromCenter, 1.25);
          const barH = Math.max(2 * dpr, v * h * 0.85 * (0.35 + 0.65 * shape));

          const x = i * (barW + gap);
          const y = centerY - barH / 2;

          const grad = ctx.createLinearGradient(x, y, x, y + barH);
          grad.addColorStop(0, `rgba(120, 200, 255, ${0.15 + v * 0.25})`);
          grad.addColorStop(0.5, `rgba(60, 150, 255, ${0.75 + v * 0.25})`);
          grad.addColorStop(1, `rgba(120, 200, 255, ${0.15 + v * 0.25})`);
          ctx.fillStyle = grad;
          ctx.fillRect(x, y, barW, barH);
        }
      });

      // --- Wordmark glow modulation ---
      const glowMain = 6 + energy * 30;
      const glowFar = 18 + energy * 55;
      const y = -energy * 3;
      const scale = 1 + energy * 0.06;
      // Hue: keep it electric-blue by default. Slight shift for talk/news kinds.
      const kindHueMap = { talk: 190, news: 220, answer: 200, weather: 205,
        horoscope: 260, history: 30, interview: 210, motivation: 150, joke: 40 };
      const hue = kindHueMap[currentKind] ?? 210;
      if (brandRef.current) {
        brandRef.current.style.transform = `translateY(${y.toFixed(2)}px) scale(${scale.toFixed(3)})`;
        brandRef.current.style.textShadow =
          `0 0 ${glowMain}px hsla(${hue},100%,70%,${(0.7 + energy * 0.3).toFixed(2)}),
           0 0 ${glowFar}px hsla(${hue},100%,55%,${(0.5 + energy * 0.35).toFixed(2)}),
           0 0 ${(glowFar * 2).toFixed(0)}px hsla(${hue},100%,50%,${(0.25 + energy * 0.3).toFixed(2)})`;
      }
      if (reflBrandRef.current) {
        reflBrandRef.current.style.textShadow = brandRef.current?.style.textShadow || "";
      }

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [isPlaying, currentKind]);

  const wordmarkStyle = {
    fontFamily: '"Orbitron", "Chakra Petch", ui-monospace, monospace',
    fontWeight: 500,
    fontSize: "clamp(1.4rem, 4.2vw, 3.4rem)",
    letterSpacing: "0.28em",
    color: "#eaf6ff",
    lineHeight: 1,
    fontVariantLigatures: "none",
    willChange: "transform, text-shadow",
    transition: "color 0.4s linear",
  };

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

      {/* Upper half — bars + wordmark */}
      <div
        className="absolute left-0 right-0 top-0 pointer-events-none"
        style={{ height: "60%" }}
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
              "radial-gradient(ellipse at center, rgba(80,180,255,0.35) 0%, rgba(80,180,255,0.10) 40%, rgba(0,0,0,0) 70%)",
            filter: "blur(20px)",
          }}
        />
        <div
          className="absolute inset-0 flex items-center justify-center notranslate select-none"
          aria-label="R-A.I."
          translate="no"
        >
          <span
            ref={brandRef}
            data-testid="pulsing-brand-text"
            style={wordmarkStyle}
            className="notranslate"
          >
            R-A.I.
          </span>
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
          ref={reflBarsRef}
          className="absolute inset-0 w-full h-full"
          style={{ height: "150%" }}
        />
        <div className="absolute inset-0 flex items-start justify-center pt-[6%]">
          <span
            ref={reflBrandRef}
            style={{ ...wordmarkStyle, color: "#a8dcff" }}
            className="notranslate"
            aria-hidden
          >
            R-A.I.
          </span>
        </div>
      </div>

      {/* Bottom "floor" line — subtle horizon */}
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

      {/* Neon track overlay */}
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
