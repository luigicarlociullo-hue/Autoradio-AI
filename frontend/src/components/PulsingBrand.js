import React, { useEffect, useRef } from "react";
import radioEngine from "@/lib/radioEngine";

/**
 * PulsingBrand v6 — uses the user's own reference PNG as the actual visual.
 * The image is placed as the visualizer background, and a music-reactive
 * filter (brightness / saturation / scale / blur) is applied on top so the
 * static picture appears alive with the audio.  Nothing else is drawn.
 */
export default function PulsingBrand({
  isPlaying = false,
  trackOverlay = null,
}) {
  const imgRef = useRef(null);
  const glowRef = useRef(null);
  const rafRef = useRef(null);
  const beatState = useRef({ prevBass: 0 });

  useEffect(() => {
    const tick = () => {
      const analyser = radioEngine.getAnalyser();
      const binCount = analyser ? analyser.frequencyBinCount : 128;
      const freq = new Uint8Array(binCount);
      if (analyser) analyser.getByteFrequencyData(freq);

      const now = performance.now() * 0.001;
      const idleAmp = isPlaying ? 0.28 : 0.10;

      // Bass energy (drives the "beat pulse")
      let bassSum = 0;
      const bEnd = analyser ? Math.min(14, binCount) : 0;
      for (let i = 2; i < bEnd; i++) bassSum += freq[i];
      const bass = analyser ? bassSum / (bEnd - 2) / 255 : 0;
      const smoothedBass = beatState.current.prevBass * 0.82 + bass * 0.18;
      beatState.current.prevBass = smoothedBass;

      // Master energy (mids) drives brightness / saturation
      let midSum = 0;
      const mEnd = analyser ? Math.min(80, binCount) : 0;
      for (let i = 4; i < mEnd; i++) midSum += freq[i];
      const midAvg = analyser ? midSum / (mEnd - 4) / 255 : 0;
      const breath = 0.5 + 0.5 * Math.sin(now * 1.6);
      const energy = analyser ? Math.max(midAvg, idleAmp * 0.5) : idleAmp * breath;

      const img = imgRef.current;
      if (img) {
        const scale = 1 + smoothedBass * 0.045 + energy * 0.015;
        const brightness = 0.85 + energy * 0.55;
        const saturate = 1 + energy * 0.7;
        const contrast = 1 + energy * 0.15;
        img.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;
        img.style.filter = `brightness(${brightness.toFixed(2)}) saturate(${saturate.toFixed(2)}) contrast(${contrast.toFixed(2)})`;
      }
      const glow = glowRef.current;
      if (glow) {
        glow.style.opacity = (0.15 + energy * 0.55).toFixed(2);
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
      {/* The user's reference image, centered and gently scaling with the beat */}
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
          transition: "filter 90ms linear",
          willChange: "transform, filter",
        }}
      />

      {/* Blue glow overlay that pulses with music energy */}
      <div
        ref={glowRef}
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(ellipse at center, rgba(80,180,255,0.55) 0%, rgba(80,180,255,0.15) 40%, rgba(0,0,0,0) 70%)",
          mixBlendMode: "screen",
          opacity: 0.15,
          transition: "opacity 80ms linear",
        }}
      />

      {/* Corner LIVE indicator only */}
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

      {/* Track overlay (unchanged from previous versions) */}
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
