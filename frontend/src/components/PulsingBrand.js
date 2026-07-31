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
        .track-title {
          font-family: 'Orbitron', 'Chakra Petch', sans-serif;
          font-size: clamp(0.85em, 1.4vw, 1.1em);
          font-weight: 600;
          color: #eaf6ff;
          text-shadow: 0 0 8px #4bb4ff, 0 0 20px #4bb4ff;
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
