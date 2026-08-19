// ============================================================================
// LEDWALL — Resolume-style 60fps visualizer (multi-layer)
// ----------------------------------------------------------------------------
// LAYERS
//  L0  BG immagine console originale nitida (opacità dinamica per modo)
//  L1  Canvas grafica generata (trail alpha per particelle "stelle cadenti")
//  L2  Scanlines overlay CSS
//
// MODI (auto-detect da current.kind + isPlaying):
//  • STANDBY (idle)     → immagine console 1.0, canvas dormiente
//  • MUSIC              → console 0.30, sinusoidi (mid/high), stelle cadenti
//                         full-screen a scia sui bass
//  • TALK / ANSWER etc. → console 0.35, sinusoidi al 55%, SFERA OLOGRAFICA
//                         reattiva alla voce (colore per speaker)
//  • TIME_SIGNAL/JINGLE → console 0.20, Atomic Clock + laser scan
//
// Night mode 22:00–04:00 → palette rosso/viola neon + strobo su bass alto.
// Cross-fade fluido tra modi (α interpolata).
// ============================================================================
import React, { useEffect, useRef } from "react";
import radioEngine from "@/lib/radioEngine";

// Palette per DJ (override rispetto a accent_color dal DB)
const DJ_COLOR = {
  Leo: "#00BFFF",     // Blu
  Aria: "#C39BFF",    // Viola
  Max: "#FF9A3D",     // Arancio
  Nyx: "#FF3D8A",     // Rosa neon
  Hex: "#8A2BE2",     // Viola scuro
  Luma: "#00E5FF",    // Ciano brillante
};

function detectMode(current, isPlaying) {
  const kind = (current?.kind || "").toLowerCase();
  if (kind === "music") return "music";
  if (["talk","answer","news","joke","weather","horoscope","interview","motivation","community","history"].includes(kind)) return "talk";
  if (kind === "time_signal" || kind === "time" || kind === "jingle") return "clock";
  return isPlaying ? "music" : "standby";
}

export default function LedWall({
  isPlaying = false,
  current = null,
  trackOverlay = null,
  djs = [],
}) {
  const canvasRef = useRef(null);
  const bgRef = useRef(null);
  const rafRef = useRef(null);
  const particlesRef = useRef([]);
  const strobeRef = useRef(0);
  const modeAlphaRef = useRef({ music: 0, talk: 0, clock: 0, standby: 1 });

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

      const now = new Date();
      const hour = now.getHours();
      const nightMode = (hour >= 22 || hour < 4);

      const palette = nightMode
        ? { grid: "rgba(200,60,255,0.08)", wave: ["rgba(255,60,140,0.95)", "rgba(200,50,255,0.85)", "rgba(120,40,255,0.75)"],
            particle: "255,80,180", accent: "#FF3D8A", scan: "rgba(255,60,180,0.85)" }
        : { grid: "rgba(0,180,255,0.08)",  wave: ["rgba(0,229,255,0.95)", "rgba(0,150,255,0.85)", "rgba(180,236,255,0.75)"],
            particle: "120,220,255", accent: "#00E5FF", scan: "rgba(0,229,255,0.85)" };

      // --- Fade fluido tra modi ---
      const target = detectMode(current, isPlaying);
      const alphas = modeAlphaRef.current;
      const FADE = 0.045;
      ["music","talk","clock","standby"].forEach(m => {
        const goal = (m === target) ? 1 : 0;
        alphas[m] += (goal - alphas[m]) * FADE;
      });

      // --- Opacità immagine console in background (HTML img) ---
      if (bgRef.current) {
        const desired =
          1.0 * alphas.standby +
          0.30 * alphas.music +
          0.35 * alphas.talk +
          0.20 * alphas.clock;
        bgRef.current.style.opacity = String(Math.max(0, Math.min(1, desired)));
      }

      // --- Trail overlay sul canvas (per stelle cadenti a scia) ---
      // Alpha basso su music/talk = coda; su clock/standby copre più forte
      const trailA =
        0.12 * alphas.music +   // stelle cadenti a scia
        0.20 * alphas.talk +    // sfera con leggero motion blur
        0.55 * alphas.clock +   // pulizia più forte per orologio
        0.75 * alphas.standby;  // standby: canvas quasi vuoto
      ctx.fillStyle = `rgba(2,4,10,${trailA})`;
      ctx.fillRect(0, 0, W, H);

      // Grid (leggero, always on tranne standby)
      const gridA = 1 - alphas.standby * 0.9;
      if (gridA > 0.05) {
        ctx.globalAlpha = gridA;
        ctx.strokeStyle = palette.grid;
        ctx.lineWidth = 1;
        const step = 32 * dpr;
        for (let x = 0; x < W; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
        for (let y = 0; y < H; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
        ctx.globalAlpha = 1;
      }

      // Night strobo
      if (nightMode && bass > 0.55) strobeRef.current = 1.0;
      else strobeRef.current *= 0.85;
      if (strobeRef.current > 0.05) {
        ctx.fillStyle = `rgba(255,255,255,${0.10 * strobeRef.current})`;
        ctx.fillRect(0, 0, W, H);
      }

      const t = performance.now() * 0.001;

      // ============ SINE WAVES (base per music, dimmed per talk) ============
      if (alphas.music > 0.02 || alphas.talk > 0.02) {
        const musicAmp = alphas.music + alphas.talk * 0.55;  // Talk: onde ridotte
        const waves = [
          { amp: (0.28 + bass * 0.55) * musicAmp, freq: 1.4, speed: 1.3, color: palette.wave[0], glow: 18 * dpr },
          { amp: (0.18 + mid  * 0.50) * musicAmp, freq: 2.6, speed: 1.9, color: palette.wave[1], glow: 12 * dpr },
          { amp: (0.10 + high * 0.60) * musicAmp, freq: 4.2, speed: 2.7, color: palette.wave[2], glow: 8  * dpr },
        ];
        ctx.globalAlpha = Math.min(1, musicAmp);
        waves.forEach(({ amp, freq: f, speed, color, glow }) => {
          if (amp < 0.02) return;
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
        ctx.globalAlpha = 1;
      }

      // ============ STELLE CADENTI (full-screen, trail, solo music) ============
      if (alphas.music > 0.15) {
        const kick = bass - prevBass;
        // Spawn intenso su ogni kick + spawn continuo di background stars
        if (kick > 0.10 && bass > 0.30) {
          const count = nightMode ? 12 : 8;
          for (let i = 0; i < count; i++) {
            spawnShootingStar(particlesRef.current, W, H, dpr, palette.particle);
          }
        }
        // Base spawn continuo (ambient)
        if (Math.random() < 0.35 * bass) {
          spawnShootingStar(particlesRef.current, W, H, dpr, palette.particle);
        }
        // Draw + update
        const pList = particlesRef.current;
        for (let i = pList.length - 1; i >= 0; i--) {
          const p = pList[i];
          p.prevX = p.x; p.prevY = p.y;
          p.x += p.vx; p.y += p.vy;
          p.vx *= 0.995; p.vy *= 0.995;
          p.life -= p.decay;
          if (p.life <= 0 || p.x < -50 || p.x > W + 50 || p.y > H + 50) { pList.splice(i, 1); continue; }
          // Line trail dalla posizione precedente
          const grad = ctx.createLinearGradient(p.prevX, p.prevY, p.x, p.y);
          grad.addColorStop(0, `rgba(${p.color},0)`);
          grad.addColorStop(1, `rgba(${p.color},${p.life * alphas.music})`);
          ctx.strokeStyle = grad;
          ctx.lineWidth = p.size;
          ctx.shadowColor = `rgba(${p.color},1)`;
          ctx.shadowBlur = 8 * dpr;
          ctx.beginPath();
          ctx.moveTo(p.prevX, p.prevY);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          // Testa lucente
          ctx.beginPath();
          ctx.fillStyle = `rgba(255,255,255,${p.life * alphas.music})`;
          ctx.arc(p.x, p.y, p.size * 0.9, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
        prevBass = bass;
      } else {
        // Dissolvi eventuali particelle residue in cross-fade
        const pList = particlesRef.current;
        for (let i = pList.length - 1; i >= 0; i--) {
          pList[i].life -= 0.03;
          if (pList[i].life <= 0) pList.splice(i, 1);
        }
      }

      // ============ SFERA OLOGRAFICA (talk mode) ============
      if (alphas.talk > 0.05) {
        const djName = current?.dj_name || "";
        const dj = djs.find(d => d.name === djName);
        // Colore priorità: DJ_COLOR map → accent_color DB → palette accent
        const color = DJ_COLOR[djName] || dj?.accent_color || palette.accent;
        const rgb = hexToRgb(color) || { r: 0, g: 229, b: 255 };

        // Reattività: media di mid+bass (voce)
        const vol = Math.min(1, (mid * 0.65 + bass * 0.35) * 1.4);
        const baseR = Math.min(W, H) * 0.28;
        const R = baseR * (0.85 + vol * 0.35);
        const cx = W / 2;
        const cy = H / 2;
        ctx.globalAlpha = Math.min(1, alphas.talk);

        // Halo esterno (glow)
        const halo = ctx.createRadialGradient(cx, cy, R * 0.4, cx, cy, R * 2.2);
        halo.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},${0.35 + vol * 0.35})`);
        halo.addColorStop(1, "transparent");
        ctx.fillStyle = halo;
        ctx.fillRect(0, 0, W, H);

        // Sfera core
        const core = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.25, R * 0.15, cx, cy, R);
        core.addColorStop(0, `rgba(255,255,255,${0.85 + vol * 0.15})`);
        core.addColorStop(0.35, `rgba(${rgb.r},${rgb.g},${rgb.b},0.85)`);
        core.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0.15)`);
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.fill();

        // Anelli oscillanti
        for (let i = 0; i < 3; i++) {
          const ringR = R + (10 + i * 12) * dpr + Math.sin(t * (2 + i) + i) * 4 * dpr * (1 + vol);
          ctx.beginPath();
          ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${0.35 * (1 - i * 0.2)})`;
          ctx.lineWidth = 1.5 * dpr;
          ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Scanline hologram sulla sfera
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.clip();
        ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.35)`;
        ctx.lineWidth = 1;
        for (let y = cy - R; y < cy + R; y += 3 * dpr) {
          ctx.beginPath(); ctx.moveTo(cx - R, y); ctx.lineTo(cx + R, y); ctx.stroke();
        }
        ctx.restore();

        // Insegna ON AIR pulsante (arancione)
        const pulse = 0.6 + 0.4 * Math.sin(t * 4);
        const signW = 200 * dpr;
        const signH = 38 * dpr;
        const sx = (W - signW) / 2;
        const sy = H * 0.10;
        ctx.fillStyle = `rgba(255,120,0,${0.85 * pulse * alphas.talk})`;
        ctx.shadowColor = "#FF6B00";
        ctx.shadowBlur = 22 * dpr * pulse;
        roundRect(ctx, sx, sy, signW, signH, 9 * dpr);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.font = `bold ${20 * dpr}px "Orbitron","Share Tech Mono",monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#0A0400";
        ctx.fillText("● ON AIR", sx + signW / 2, sy + signH / 2 + 1 * dpr);

        ctx.globalAlpha = 1;
      }

      // ============ ATOMIC CLOCK (clock mode) ============
      if (alphas.clock > 0.05) {
        ctx.globalAlpha = Math.min(1, alphas.clock);
        const scanX = (Math.sin(t * 1.2) * 0.5 + 0.5) * W;
        const grad = ctx.createLinearGradient(scanX - 60 * dpr, 0, scanX + 60 * dpr, 0);
        grad.addColorStop(0, "transparent");
        grad.addColorStop(0.5, palette.scan);
        grad.addColorStop(1, "transparent");
        ctx.fillStyle = grad;
        ctx.fillRect(scanX - 60 * dpr, 0, 120 * dpr, H);

        const timeStr = now.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        ctx.font = `bold ${60 * dpr}px "Share Tech Mono","Orbitron",monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = palette.accent;
        ctx.shadowColor = palette.accent;
        ctx.shadowBlur = 30 * dpr;
        const showColon = (now.getMilliseconds() < 500);
        const display = showColon ? timeStr : timeStr.replace(/:/g, " ");
        ctx.fillText(display, W / 2, H / 2);
        ctx.shadowBlur = 0;

        ctx.font = `${13 * dpr}px "Share Tech Mono",monospace`;
        ctx.fillStyle = `${palette.accent}bb`;
        ctx.fillText(showColon ? "▸ TIC" : "▸ TAC", W / 2, H / 2 + 44 * dpr);
        ctx.globalAlpha = 1;
      }

      // ---- Overlay Titolo + DJ nel corridoio ----
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

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(rafRef.current); ro.disconnect(); };
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
      {/* L0 · console PNG nitida in background (opacità animata dal canvas) */}
      <img
        ref={bgRef}
        src="/rai-visual-bg.png"
        alt=""
        aria-hidden
        data-testid="ledwall-bg"
        className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        style={{ opacity: 1, transition: "opacity 120ms linear" }}
      />
      {/* L1 · canvas grafica generata */}
      <canvas ref={canvasRef} className="relative block w-full h-full" />
      {/* L2 · scanlines CSS overlay */}
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

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function spawnShootingStar(list, W, H, dpr, colorRGB) {
  // Angolo diagonale (top-left → bottom-right), con jitter
  const angle = Math.PI * 0.20 + Math.random() * 0.35;   // ~11-31°
  const sp = (4 + Math.random() * 8) * dpr;
  const startFromTop = Math.random() < 0.7;
  const x = startFromTop ? Math.random() * W : -20;
  const y = startFromTop ? -20 : Math.random() * H * 0.5;
  list.push({
    x, y, prevX: x, prevY: y,
    vx: Math.cos(angle) * sp,
    vy: Math.sin(angle) * sp,
    life: 1.0,
    decay: 0.008 + Math.random() * 0.010,
    size: (1 + Math.random() * 2) * dpr,
    color: colorRGB,
  });
}

function hexToRgb(hex) {
  const m = /^#?([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})$/i.exec(hex || "");
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
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
