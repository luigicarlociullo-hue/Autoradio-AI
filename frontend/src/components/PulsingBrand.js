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
          className="track-overlay"
          data-testid="track-overlay"
          style={{
            position: "absolute",
            top: "56%",           /* centered in the dark horizon band, above the reflection */
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
        /* Shimmer: glow color and radius cycle noticeably so the effect is
           clearly visible even at a glance. */
        @keyframes raiTrackShimmer {
          0%, 100% {
            text-shadow:
              0 0 10px rgba(140,220,255,1),
              0 0 26px rgba(90,180,255,0.85),
              0 0 55px rgba(80,170,255,0.60),
              0 0 90px rgba(80,170,255,0.35);
          }
          50% {
            text-shadow:
              0 0 18px rgba(220,240,255,1),
              0 0 40px rgba(170,230,255,1),
              0 0 80px rgba(140,220,255,0.85),
              0 0 130px rgba(120,200,255,0.55);
          }
        }
        /* Bright sweep: a wide highlight moves across the letters so the
           "shine" is unmistakable. */
        @keyframes raiShimmerSweep {
          0%   { background-position: -180% 0; }
          100% { background-position: 280% 0; }
        }
        .track-title {
          font-family: 'Orbitron', 'Chakra Petch', sans-serif;
          font-weight: 700;
          letter-spacing: 3px;
          text-transform: uppercase;
          font-size: clamp(1.05em, 1.7vw, 1.4em);
          color: #eaf6ff;
          background: linear-gradient(90deg,
                       #b8dcff 0%,
                       #ffffff 40%,
                       #d0f0ff 50%,
                       #ffffff 60%,
                       #b8dcff 100%);
          background-size: 220% 100%;
          -webkit-background-clip: text;
                  background-clip: text;
          -webkit-text-fill-color: transparent;
          animation:
            raiTrackShimmer 2.4s ease-in-out infinite,
            raiShimmerSweep 3.6s linear infinite;
          filter: drop-shadow(0 0 6px rgba(120,200,255,0.7));
        }
        .track-artist {
          font-family: 'Chakra Petch', sans-serif;
          font-size: clamp(0.72em, 1vw, 0.9em);
          color: #cfe8ff;
          text-shadow:
            0 0 8px rgba(140,220,255,1),
            0 0 22px rgba(90,180,255,0.75),
            0 0 44px rgba(80,170,255,0.45);
          margin-top: 4px;
          letter-spacing: 2px;
          font-weight: 600;
          animation: raiTrackShimmer 2.8s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
