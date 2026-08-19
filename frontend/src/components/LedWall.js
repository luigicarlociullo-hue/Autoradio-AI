// ============================================================================
// LEDWALL — Resolume-style canvas visualizer at 60fps
// ----------------------------------------------------------------------------
// Modi di rendering (auto):
//   • music         → multiple sine waves + particle explosions su bass
//   • talk / answer → avatar olografico dello speaker + insegna "ON AIR"
//   • time_signal   → laser scan + tic-tac digitale (Atomic Clock)
//   • default       → sine waves calme
// Night mode (22:00 – 04:00) → palette rosso/viola neon, effetti strobo.
// Reattivo all'AnalyserNode di radioEngine (bass/mid/high).
// ============================================================================
import React, { useEffect, useRef } from "react";
import radioEngine from "@/lib/radioEngine";

export default function LedWall({
  isPlaying = false,
  current = null,       // segmento corrente (dj_name, kind, title)
  trackOverlay = null,  // { visible, title, artist } quando kind=music
  djs = [],
}) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const particlesRef = useRef([]);
  const strobeRef = useRef(0);

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0;
    const resize = () => {
      const r = cvs.getBoundingClientRect();
      W = Math.floor(r.width * dpr);
      H = Math.floor(r.height * dpr);
      cvs.width = W;
      cvs.height = H;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cvs);

    let prevBass = 0;

    const draw = () => {
      const analyser = radioEngine.getAnalyser?.();
      const bins = analyser ? analyser.frequencyBinCount : 128;
      const freq = new Uint8Array(bins);
      if (analyser) analyser.getByteFrequencyData(freq);

      let bass = 0, mid = 0, high = 0;
      if (analyser) {
        for (let i = 2; i < 14; i++) bass += freq[i];
        for (let i = 14; i < 60; i++) mid += freq[i];
        for (let i = 60; i < Math.min(120, bins); i++) high += freq[i];
        bass /= (12 * 255);
        mid /= (46 * 255);
        high /= (60 * 255);
      }

      // Ora locale (per Night mode)
      const now = new Date();
      const hour = now.getHours();
      const nightMode = (hour >= 22 || hour < 4);

      // Palette
      const palette = nightMode
        ? {
            base: "#0A0410",
            grid: "rgba(200,60,255,0.10)",
            wave: ["rgba(255,60,140,0.95)", "rgba(200,50,255,0.85)", "rgba(120,40,255,0.75)"],
            particle: "rgba(255,80,180,",
            accent: "#FF3D8A",
            scan: "rgba(255,60,180,0.85)",
          }
        : {
            base: "#02040A",
            grid: "rgba(0,180,255,0.10)",
            wave: ["rgba(0,229,255,0.95)", "rgba(0,150,255,0.85)", "rgba(180,236,255,0.75)"],
            particle: "rgba(120,220,255,",
            accent: "#00E5FF",
            scan: "rgba(0,229,255,0.85)",
          };

      // Background base
      ctx.fillStyle = palette.base;
      ctx.fillRect(0, 0, W, H);

      // Grid pattern
      ctx.strokeStyle = palette.grid;
      ctx.lineWidth = 1;
      const step = 32 * dpr;
      for (let x = 0; x < W; x += step) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let y = 0; y < H; y += step) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }

      // Night strobo: flash bianco/viola sui picchi bassi
      if (nightMode && bass > 0.55) {
        strobeRef.current = 1.0;
      } else {
        strobeRef.current *= 0.85;
      }
      if (strobeRef.current > 0.05) {
        ctx.fillStyle = `rgba(255,255,255,${0.10 * strobeRef.current})`;
        ctx.fillRect(0, 0, W, H);
      }

      const kind = (current?.kind || (isPlaying ? "music" : "idle")).toLowerCase();
      const t = performance.now() * 0.001;

      // ============ MODE: MUSIC (sine waves + particle bass) ============
      if (kind === "music" || (isPlaying && !current?.kind)) {
        // 3 sine waves
        const waves = [
          { amp: 0.30 + bass * 0.55, freq: 1.4, speed: 1.3, color: palette.wave[0], glow: 18 * dpr },
          { amp: 0.20 + mid  * 0.50, freq: 2.6, speed: 1.9, color: palette.wave[1], glow: 12 * dpr },
          { amp: 0.12 + high * 0.60, freq: 4.2, speed: 2.7, color: palette.wave[2], glow: 8  * dpr },
        ];
        waves.forEach(({ amp, freq: f, speed, color, glow }) => {
          ctx.beginPath();
          ctx.lineWidth = 2 * dpr;
          ctx.strokeStyle = color;
          ctx.shadowColor = color;
          ctx.shadowBlur = glow;
          for (let x = 0; x <= W; x += 2 * dpr) {
            const phase = (x / W) * Math.PI * 2 * f + t * speed;
            const y = H / 2 + Math.sin(phase) * (H * 0.32 * amp);
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        });
        ctx.shadowBlur = 0;

        // Particle explosion on bass peaks
        const kick = bass - prevBass;
        if (kick > 0.14 && bass > 0.35) {
          const cx = W * (0.3 + Math.random() * 0.4);
          const cy = H * (0.35 + Math.random() * 0.3);
          const count = nightMode ? 22 : 14;
          for (let i = 0; i < count; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = (2 + Math.random() * 5) * dpr;
            particlesRef.current.push({
              x: cx, y: cy,
              vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
              life: 1.0, size: (2 + Math.random() * 3) * dpr,
            });
          }
        }
        prevBass = bass;

        // Draw & update particles
        const pList = particlesRef.current;
        for (let i = pList.length - 1; i >= 0; i--) {
          const p = pList[i];
          p.x += p.vx; p.y += p.vy;
          p.vx *= 0.96; p.vy *= 0.96;
          p.life -= 0.025;
          if (p.life <= 0) { pList.splice(i, 1); continue; }
          ctx.beginPath();
          ctx.fillStyle = `${palette.particle}${p.life})`;
          ctx.shadowColor = palette.accent;
          ctx.shadowBlur = 10 * dpr;
          ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
      }

      // ============ MODE: TALK / ANSWER (holographic avatar + ON AIR) ============
      else if (["talk","answer","news","joke","weather","horoscope","interview","motivation","community","history"].includes(kind)) {
        const djName = current?.dj_name || "";
        const dj = djs.find(d => d.name === djName);
        const accent = dj?.accent_color || palette.accent;

        // Scanline holographic panel
        const panelH = H * 0.6;
        const panelY = (H - panelH) / 2;
        const panelX = W * 0.25;
        const panelW = W * 0.5;

        // Halo behind avatar
        const g = ctx.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, W * 0.35);
        g.addColorStop(0, `${accent}44`);
        g.addColorStop(1, "transparent");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);

        // Vertical scanlines for hologram
        ctx.strokeStyle = `${accent}33`;
        ctx.lineWidth = 1;
        for (let y = panelY; y < panelY + panelH; y += 3 * dpr) {
          ctx.beginPath(); ctx.moveTo(panelX, y); ctx.lineTo(panelX + panelW, y); ctx.stroke();
        }

        // Draw avatar via HTML Image (cached)
        if (dj?.avatar_url) {
          const img = getCachedImage(dj.avatar_url);
          if (img.complete && img.naturalWidth) {
            const aspect = img.naturalWidth / img.naturalHeight;
            const drawH = panelH * 0.9;
            const drawW = drawH * aspect;
            const dx = (W - drawW) / 2;
            const dy = panelY + (panelH - drawH) / 2 + Math.sin(t * 2) * 3 * dpr;
            ctx.save();
            ctx.globalAlpha = 0.85 + Math.sin(t * 5) * 0.08;
            ctx.shadowColor = accent;
            ctx.shadowBlur = 30 * dpr;
            ctx.drawImage(img, dx, dy, drawW, drawH);
            ctx.restore();
          }
        }

        // "ON AIR" pulsating orange sign
        const pulse = 0.6 + 0.4 * Math.sin(t * 4);
        const signW = 220 * dpr;
        const signH = 42 * dpr;
        const sx = (W - signW) / 2;
        const sy = H * 0.14;
        ctx.fillStyle = `rgba(255,120,0,${0.85 * pulse})`;
        ctx.shadowColor = "#FF6B00";
        ctx.shadowBlur = 22 * dpr * pulse;
        roundRect(ctx, sx, sy, signW, signH, 10 * dpr);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.font = `bold ${22 * dpr}px "Orbitron","Share Tech Mono",monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#0A0400";
        ctx.fillText("● ON AIR", sx + signW / 2, sy + signH / 2 + 1 * dpr);
      }

      // ============ MODE: TIME SIGNAL (Atomic Clock + laser scan) ============
      else if (kind === "time_signal" || kind === "time" || kind === "jingle") {
        // Laser scan verticale
        const scanX = (Math.sin(t * 1.2) * 0.5 + 0.5) * W;
        const grad = ctx.createLinearGradient(scanX - 60 * dpr, 0, scanX + 60 * dpr, 0);
        grad.addColorStop(0, "transparent");
        grad.addColorStop(0.5, palette.scan);
        grad.addColorStop(1, "transparent");
        ctx.fillStyle = grad;
        ctx.fillRect(scanX - 60 * dpr, 0, 120 * dpr, H);

        // Digital clock centrale con "tic tac"
        const timeStr = now.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        ctx.font = `bold ${64 * dpr}px "Share Tech Mono","Orbitron",monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = palette.accent;
        ctx.shadowColor = palette.accent;
        ctx.shadowBlur = 30 * dpr;
        // Colon lampeggia ogni secondo
        const showColon = (now.getMilliseconds() < 500);
        const display = showColon ? timeStr : timeStr.replace(/:/g, " ");
        ctx.fillText(display, W / 2, H / 2);
        ctx.shadowBlur = 0;

        // Piccolo "TIC-TAC" sotto
        ctx.font = `${14 * dpr}px "Share Tech Mono",monospace`;
        ctx.fillStyle = `${palette.accent}bb`;
        ctx.fillText(showColon ? "▸ TIC" : "▸ TAC", W / 2, H / 2 + 46 * dpr);
      }

      // ============ MODE: IDLE (calm sine) ============
      else {
        ctx.beginPath();
        ctx.lineWidth = 1.5 * dpr;
        ctx.strokeStyle = `${palette.accent}66`;
        ctx.shadowColor = palette.accent;
        ctx.shadowBlur = 10 * dpr;
        for (let x = 0; x <= W; x += 2 * dpr) {
          const phase = (x / W) * Math.PI * 4 + t * 0.7;
          const y = H / 2 + Math.sin(phase) * H * 0.08;
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // ---- Overlay Titolo + DJ nel corridoio (blu/rosa neon) ----
      const musicTitle = trackOverlay?.visible ? trackOverlay.title : null;
      const musicArtist = trackOverlay?.visible ? (trackOverlay.artist || "") : "";
      const segTitle = current?.title || "";
      const djLabel = current?.dj_name || "";
      const primary = musicTitle
        ? (musicArtist ? `${musicTitle} · ${musicArtist}` : musicTitle)
        : segTitle;
      if (primary) {
        ctx.font = `bold ${18 * dpr}px "Orbitron","Share Tech Mono",monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#B8ECFF";
        ctx.shadowColor = palette.accent;
        ctx.shadowBlur = 12 * dpr;
        ctx.fillText(primary.toUpperCase().slice(0, 60), W / 2, H * 0.86);
        ctx.shadowBlur = 0;
      }
      if (djLabel) {
        ctx.font = `${11 * dpr}px "Share Tech Mono","VT323",monospace`;
        ctx.fillStyle = "#7FD8FF";
        ctx.shadowColor = palette.accent;
        ctx.shadowBlur = 8 * dpr;
        ctx.fillText(`▸ ${djLabel.toUpperCase()}`, W / 2, H * 0.92);
        ctx.shadowBlur = 0;
      }

      // Vignetting scuro angoli
      const vg = ctx.createRadialGradient(W / 2, H / 2, W * 0.3, W / 2, H / 2, W * 0.65);
      vg.addColorStop(0, "transparent");
      vg.addColorStop(1, "rgba(0,0,0,0.55)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [isPlaying, current, trackOverlay, djs]);

  return (
    <div
      data-testid="ledwall"
      className="relative w-full rounded-2xl overflow-hidden focusable"
      style={{
        aspectRatio: "16 / 6.75",
        background: "#000",
        border: "1px solid rgba(0,229,255,0.35)",
        boxShadow: "0 0 0 1px rgba(0,229,255,0.25) inset, 0 0 40px rgba(0,191,255,0.25)",
      }}
    >
      <canvas ref={canvasRef} className="block w-full h-full" />
      {/* Scanlines overlay */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "repeating-linear-gradient(0deg, rgba(0,229,255,0.06) 0px, rgba(0,229,255,0.06) 1px, transparent 1px, transparent 3px)",
          mixBlendMode: "screen",
        }}
      />
    </div>
  );
}

// -------- helpers --------
const _imgCache = new Map();
function getCachedImage(url) {
  if (_imgCache.has(url)) return _imgCache.get(url);
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  _imgCache.set(url, img);
  return img;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
