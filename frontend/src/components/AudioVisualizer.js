import React, { useEffect, useRef } from "react";
import { Youtube, Play } from "lucide-react";
import { toast } from "sonner";
import radioEngine from "@/lib/radioEngine";
import LogoWatermark from "@/components/LogoWatermark";

const YOUTUBE_URL = process.env.REACT_APP_YOUTUBE_URL || "";

export default function AudioVisualizer({ isPlaying, currentKind = "", currentTitle = "", trackOverlay = null }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const rotationRef = useRef(0);

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx2d = cvs.getContext("2d");
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

      const analyser = radioEngine.getAnalyser();
      const binCount = analyser ? analyser.frequencyBinCount : 128;
      const freq = new Uint8Array(binCount);
      const time = new Uint8Array(binCount);
      if (analyser) {
        analyser.getByteFrequencyData(freq);
        analyser.getByteTimeDomainData(time);
      } else {
        // Fallback: simulated pattern when Web Speech is talking or idle
        const amp = radioEngine.getFakeAmplitude ? radioEngine.getFakeAmplitude() : (isPlaying ? 0.35 : 0.08);
        const now = performance.now() * 0.001;
        for (let i = 0; i < binCount; i++) {
          const v = amp * (0.5 + 0.5 * Math.sin(now * 2 + i * 0.2)) * 220;
          freq[i] = Math.max(0, Math.min(255, v + Math.random() * 20));
          time[i] = 128 + Math.sin(now * 3 + i * 0.4) * 50 * amp;
        }
      }

      // Fade previous frame for motion trails
      ctx2d.globalCompositeOperation = "source-over";
      ctx2d.fillStyle = "rgba(5, 5, 10, 0.18)";
      ctx2d.fillRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const baseRadius = Math.min(w, h) * 0.20;

      // Compute overall amplitude (avg of low mids)
      let amp = 0;
      for (let i = 4; i < 32; i++) amp += freq[i];
      amp = amp / (28 * 255); // 0..1

      // ---- Rotating radial spectrum bars ----
      rotationRef.current += 0.003 + amp * 0.02;
      const rot = rotationRef.current;
      const bars = 96;
      ctx2d.globalCompositeOperation = "screen";
      for (let i = 0; i < bars; i++) {
        const freqIdx = Math.floor((i / bars) * (binCount * 0.55));
        const v = freq[freqIdx] / 255;
        const angle = rot + (i / bars) * Math.PI * 2;
        const barLen = 20 * dpr + v * baseRadius * 1.8;
        const x1 = cx + Math.cos(angle) * baseRadius;
        const y1 = cy + Math.sin(angle) * baseRadius;
        const x2 = cx + Math.cos(angle) * (baseRadius + barLen);
        const y2 = cy + Math.sin(angle) * (baseRadius + barLen);
        // Hue drifts based on kind
        const kindHueMap = {
          music: 320, talk: 190, news: 275, answer: 210, weather: 200,
          horoscope: 285, history: 40, interview: 330, motivation: 100, joke: 0,
        };
        const baseHue = kindHueMap[currentKind] ?? 300;
        const hue = (baseHue + v * 80 + i * 1.2) % 360;
        const grad = ctx2d.createLinearGradient(x1, y1, x2, y2);
        grad.addColorStop(0, `hsla(${hue}, 100%, 60%, ${0.15 + v * 0.5})`);
        grad.addColorStop(1, `hsla(${hue}, 100%, 70%, ${0.8 + v * 0.2})`);
        ctx2d.strokeStyle = grad;
        ctx2d.lineWidth = (1.5 + v * 3) * dpr;
        ctx2d.lineCap = "round";
        ctx2d.beginPath();
        ctx2d.moveTo(x1, y1);
        ctx2d.lineTo(x2, y2);
        ctx2d.stroke();
      }

      // ---- Central pulse orb ----
      const orbR = baseRadius * (0.9 + amp * 0.45);
      const orbGrad = ctx2d.createRadialGradient(cx, cy, orbR * 0.1, cx, cy, orbR);
      orbGrad.addColorStop(0, `rgba(255, 20, 147, ${0.35 + amp * 0.35})`);
      orbGrad.addColorStop(0.5, `rgba(138, 43, 226, ${0.18 + amp * 0.2})`);
      orbGrad.addColorStop(1, "rgba(5, 5, 10, 0)");
      ctx2d.fillStyle = orbGrad;
      ctx2d.beginPath();
      ctx2d.arc(cx, cy, orbR, 0, Math.PI * 2);
      ctx2d.fill();

      // ---- Waveform ring (time-domain) ----
      ctx2d.globalCompositeOperation = "lighter";
      ctx2d.strokeStyle = `rgba(34, 211, 238, ${0.35 + amp * 0.55})`;
      ctx2d.lineWidth = 1.5 * dpr;
      ctx2d.beginPath();
      const wavePoints = Math.min(binCount, 180);
      for (let i = 0; i < wavePoints; i++) {
        const v = (time[i] - 128) / 128; // -1..1
        const angle = (i / wavePoints) * Math.PI * 2 - rot * 0.5;
        const r = baseRadius * 0.72 + v * baseRadius * 0.35;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (i === 0) ctx2d.moveTo(x, y);
        else ctx2d.lineTo(x, y);
      }
      ctx2d.closePath();
      ctx2d.stroke();

      // Reset composite
      ctx2d.globalCompositeOperation = "source-over";

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [isPlaying, currentKind]);

  const openYoutube = () => {
    if (YOUTUBE_URL) {
      window.open(YOUTUBE_URL, "_blank", "noopener,noreferrer");
    } else {
      toast.info("Il canale YouTube di NEURA·FM verrà collegato prossimamente", {
        description: "Torna qui: la stessa visual sarà anche in streaming sul canale.",
      });
    }
  };

  return (
    <button
      type="button"
      onClick={openYoutube}
      data-testid="audio-visualizer"
      className="relative w-full block rounded-2xl overflow-hidden group focusable"
      style={{
        aspectRatio: "16 / 9",
        background: "radial-gradient(ellipse at center, #0a0a1a 0%, #05050A 65%, #000 100%)",
        border: "1px solid rgba(255,255,255,0.08)",
        cursor: "pointer",
      }}
      aria-label="Guarda anche su YouTube"
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />
      {/* Persistent channel bug logo — always visible on the visual "video" area */}
      <LogoWatermark position="top-right" size={1.15} opacity={0.92} />
      {/* Grain overlay */}
      <div
        className="absolute inset-0 pointer-events-none opacity-30 mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence baseFrequency='0.85' numOctaves='2'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.1 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
        }}
      />
      {/* Corner labels */}
      <div className="absolute top-3 left-4 flex items-center gap-2 pointer-events-none">
        <span className="font-mono text-[10px] tracking-widest text-cyan-400 uppercase">LIVE VISUAL</span>
        {isPlaying && (
          <span className="live-dot" style={{ background: "#22d3ee", boxShadow: "0 0 8px #22d3ee" }} />
        )}
      </div>
      {/* Neon track overlay — music-segment sovrimpressione with fade in/out */}
      {trackOverlay && (
        <div
          className="track-overlay"
          data-testid="track-overlay"
          style={{
            position: "absolute",
            bottom: 80,
            left: 0,
            right: 0,
            textAlign: "center",
            pointerEvents: "none",
            opacity: trackOverlay.visible ? 1 : 0,
            transition: "opacity 0.8s ease",
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
          font-size: clamp(1.1em, 2.2vw, 1.8em);
          font-weight: 900;
          color: #fff;
          animation: neonPulse 2s ease-in-out infinite;
          letter-spacing: 3px;
          text-transform: uppercase;
        }
        .track-artist {
          font-family: 'Unbounded', sans-serif;
          font-size: clamp(0.75em, 1vw, 0.95em);
          color: #00eaff;
          text-shadow: 0 0 8px #00eaff, 0 0 18px rgba(0,234,255,0.5);
          margin-top: 6px;
          letter-spacing: 2px;
          font-weight: 700;
        }
      `}</style>
      {/* YouTube CTA hover overlay */}
      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
        <div className="flex items-center gap-3 px-5 py-3 rounded-full bg-black/70 backdrop-blur-md border border-white/15">
          <Youtube className="w-5 h-5 text-red-500" />
          <span className="font-display font-semibold text-white text-sm">Guarda anche su YouTube</span>
        </div>
      </div>
    </button>
  );
}
