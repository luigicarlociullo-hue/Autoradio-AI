import React, { useEffect, useRef } from "react";
import radioEngine from "@/lib/radioEngine";

/**
 * BottomWaveform — small, discreet audio signal fixed at the very bottom of
 * the home page. Replaces the big central visualizer as the "moving audio
 * indicator", per the master plan directive.
 *
 * Design goals:
 *   - Never dominates the layout: 32px tall, subtle, low opacity
 *   - Cyan/magenta gradient bars, aligned with the R-A.I. palette
 *   - Falls back to a slow idle wave when there is no live audio
 */
export default function BottomWaveform({ isPlaying = false }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const rect = cvs.getBoundingClientRect();
      cvs.width = Math.floor(rect.width * dpr);
      cvs.height = Math.floor(rect.height * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cvs);

    const draw = () => {
      const w = cvs.width;
      const h = cvs.height;
      if (!w || !h) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }
      ctx.clearRect(0, 0, w, h);

      const analyser = radioEngine.getAnalyser();
      const binCount = analyser ? analyser.frequencyBinCount : 128;
      const freq = new Uint8Array(binCount);
      if (analyser) analyser.getByteFrequencyData(freq);

      const bars = 96;
      const gap = 2 * dpr;
      const barW = Math.max(1 * dpr, w / bars - gap);
      const now = performance.now() * 0.001;
      const idleAmp = isPlaying ? 0.28 : 0.10;

      for (let i = 0; i < bars; i++) {
        const idx = Math.floor((i / bars) * (binCount * 0.55));
        const live = analyser ? freq[idx] / 255 : 0;
        const idle = idleAmp * (0.5 + 0.5 * Math.sin(now * 1.8 + i * 0.25));
        const v = analyser ? Math.min(1, live * 1.05 + idle * 0.35) : idle;
        const barH = Math.max(2 * dpr, v * h * 0.9);
        const x = i * (barW + gap);
        const y = (h - barH) / 2;

        const grad = ctx.createLinearGradient(x, y, x, y + barH);
        // Cyan bottom → magenta top gradient, low alpha for discretion.
        grad.addColorStop(0, `rgba(34, 211, 238, ${0.35 + v * 0.35})`);
        grad.addColorStop(1, `rgba(255, 20, 147, ${0.35 + v * 0.35})`);
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, barW, barH);
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [isPlaying]);

  return (
    <div
      data-testid="bottom-waveform"
      className="fixed bottom-0 left-0 right-0 pointer-events-none z-20"
      style={{
        height: 34,
        background:
          "linear-gradient(to top, rgba(5,5,10,0.85) 0%, rgba(5,5,10,0.4) 60%, transparent 100%)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ opacity: 0.85 }}
      />
    </div>
  );
}
