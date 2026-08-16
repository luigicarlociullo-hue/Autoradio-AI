import React, { useEffect, useRef } from "react";
import radioEngine from "@/lib/radioEngine";

/**
 * PulsingBrand — displays the user's own reference PNG as the visualizer.
 * Only a very subtle scale + brightness pulse is applied on top so the
 * still image feels alive with the music. No decomposition of the PNG.
 */
export default function PulsingBrand({
  isPlaying = false,
  current = null,
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
        aspectRatio: "16 / 6.75",
        background: "#000",
        border: "1px solid rgba(0,191,255,0.35)",
        boxShadow: "0 0 24px rgba(0,191,255,0.25), 0 0 60px rgba(0,191,255,0.10), inset 0 0 20px rgba(0,191,255,0.08)",
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

      {/* Overlay HORIZON: titolo + DJ centrati nel corridoio tra immagine e riflesso.
          Font digitale blu neon (Orbitron/Share Tech Mono), aspetto "proiettato". */}
      {(() => {
        const musicTitle = trackOverlay?.visible ? trackOverlay.title : null;
        const musicArtist = trackOverlay?.visible ? (trackOverlay.artist || "") : "";
        const segTitle = current?.title || "";
        const djName = current?.dj_name || "";
        const hasAny = musicTitle || segTitle || djName;
        if (!hasAny) return null;
        const primary = musicTitle
          ? (musicArtist ? `${musicTitle} · ${musicArtist}` : musicTitle)
          : segTitle;
        return (
          <div
            className="horizon-projection"
            data-testid="horizon-projection"
            style={{
              position: "absolute",
              top: "60%",
              left: 0,
              right: 0,
              transform: "translateY(-50%)",
              pointerEvents: "none",
              zIndex: 20,
              textAlign: "center",
              padding: "0 6%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "0.35em",
            }}
          >
            {primary && (
              <div
                className="horizon-title"
                data-testid="horizon-title"
                style={{
                  fontFamily: '"Orbitron", "Share Tech Mono", ui-monospace, monospace',
                  fontWeight: 700,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  fontSize: "clamp(0.85rem, 1.6vw, 1.35rem)",
                  color: "#B8ECFF",
                  textShadow:
                    "0 0 4px rgba(0,229,255,0.95), 0 0 14px rgba(0,191,255,0.75), 0 0 32px rgba(0,120,255,0.55)",
                  filter: "drop-shadow(0 0 6px rgba(0,191,255,0.55))",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: "100%",
                  lineHeight: 1.05,
                }}
              >
                {primary}
              </div>
            )}
            {djName && (
              <div
                className="horizon-dj"
                data-testid="horizon-dj"
                style={{
                  fontFamily: '"Share Tech Mono", "VT323", ui-monospace, monospace',
                  fontWeight: 400,
                  letterSpacing: "0.32em",
                  textTransform: "uppercase",
                  fontSize: "clamp(0.6rem, 0.9vw, 0.78rem)",
                  color: "#7FD8FF",
                  textShadow:
                    "0 0 3px rgba(0,229,255,0.9), 0 0 10px rgba(0,180,255,0.6)",
                  opacity: 0.95,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: "100%",
                }}
              >
                ▸ {djName}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
