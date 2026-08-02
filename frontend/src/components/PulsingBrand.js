import React, { useEffect, useRef } from "react";
import radioEngine from "@/lib/radioEngine";

/**
 * PulsingBrand — displays the user's own reference PNG as the visualizer.
 * Only a very subtle scale + brightness pulse is applied on top so the
 * still image feels alive with the music. No decomposition of the PNG.
 */
export default function PulsingBrand({
  isPlaying = false,
  trackOverlay = null,
}) {
  const imgRef = useRef(null);
  const rafRef = useRef(null);
  const beatState = useRef({ prevBass: 0 });

  useEffect(() => {
    const tick = () => {
      const analyser = radioEngine.getAnalyser();
      const binCount = analyser ? analyser.frequencyBinCount : 128;
      const freq = new Uint8Array(binCount);
      if (analyser) analyser.getByteFrequencyData(freq);

      const now = performance.now() * 0.001;
      const idleAmp = isPlaying ? 0.22 : 0.08;

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
      const breath = 0.5 + 0.5 * Math.sin(now * 1.6);
      const energy = analyser ? Math.max(midAvg, idleAmp * 0.5) : idleAmp * breath;

      const img = imgRef.current;
      if (img) {
        const scale = 1 + smoothedBass * 0.035 + energy * 0.010;
        const brightness = 0.90 + energy * 0.35;
        img.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;
        img.style.filter = `brightness(${brightness.toFixed(2)})`;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying]);

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
      <img
        ref={imgRef}
        src="/rai-visual-bg.png"
        alt="R-A.I."
        data-testid="pulsing-brand-image"
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: "translate(-50%, -50%)",
          transformOrigin: "center",
          transition: "filter 80ms linear",
          willChange: "transform, filter",
        }}
      />

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

      {trackOverlay && (
        <div
          className="track-overlay-strip"
          data-testid="track-overlay"
          style={{
            position: "absolute",
            top: "60%",           /* centro esatto della banda scura tra immagine e riflesso */
            left: 0,
            right: 0,
            transform: "translateY(-50%)",
            pointerEvents: "none",
            opacity: trackOverlay.visible ? 1 : 0,
            transition: "opacity 0.8s ease",
            zIndex: 20,
            overflow: "hidden",
            whiteSpace: "nowrap",
            maskImage: "linear-gradient(to right, transparent 0%, #000 8%, #000 92%, transparent 100%)",
            WebkitMaskImage: "linear-gradient(to right, transparent 0%, #000 8%, #000 92%, transparent 100%)",
          }}
        >
          <div
            className="track-marquee"
            data-testid="track-overlay-title"
          >
            {/* Contenuto duplicato per marquee seamless */}
            <span className="track-marquee-text">
              {trackOverlay.title}
              {trackOverlay.artist ? ` · ${trackOverlay.artist}` : ""}
              &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp;
            </span>
            <span className="track-marquee-text" aria-hidden="true">
              {trackOverlay.title}
              {trackOverlay.artist ? ` · ${trackOverlay.artist}` : ""}
              &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp;
            </span>
          </div>
        </div>
      )}

      <style>{`
        /* Marquee scorrevole: il testo trascorre da destra a sinistra in
           loop continuo, così anche titoli lunghi restano su un unico rigo. */
        @keyframes raiTrackMarquee {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        /* Pulsazione del glow neon fucsia (palette --neon-pink #FF1493) */
        @keyframes raiNeonPulse {
          0%, 100% {
            text-shadow:
              0 0 6px rgba(255,20,147,0.95),
              0 0 18px rgba(255,20,147,0.80),
              0 0 42px rgba(255,20,147,0.55),
              0 0 80px rgba(255,20,147,0.30);
          }
          50% {
            text-shadow:
              0 0 12px rgba(255,105,180,1),
              0 0 30px rgba(255,20,147,1),
              0 0 70px rgba(255,20,147,0.75),
              0 0 120px rgba(255,20,147,0.45);
          }
        }
        .track-marquee {
          display: inline-flex;
          white-space: nowrap;
          animation: raiTrackMarquee 22s linear infinite;
          will-change: transform;
        }
        .track-marquee-text {
          font-family: 'Orbitron', 'Chakra Petch', sans-serif;
          font-weight: 700;
          letter-spacing: 4px;
          text-transform: uppercase;
          font-size: clamp(0.95em, 1.4vw, 1.25em);
          color: #ff1493;
          padding-right: 2rem;
          animation: raiNeonPulse 2.4s ease-in-out infinite;
          filter: drop-shadow(0 0 4px rgba(255,20,147,0.85));
        }
      `}</style>
    </div>
  );
}
