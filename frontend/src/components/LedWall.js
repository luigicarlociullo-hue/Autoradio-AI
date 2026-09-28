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
import React, { useEffect, useRef, useState } from "react";
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

// v13.41 · Fix ticket #247410: logo rotante a ritmo per la scena di default
// del LedWall (richiesta cliente: sostituire le onde sinusoidali in home).
// Immagine caricata una sola volta a livello di modulo e riusata su ogni frame.
let _logoImg = null;
function _getLogoImg() {
  if (!_logoImg) { _logoImg = new Image(); _logoImg.src = "/rai-logo.png"; }
  return _logoImg;
}

// v13.40 · Effetti visivi selezionabili. Ogni modalità disegna il frame
// completo (sfondo incluso) usando `beat` (0..1, da BPM server o ampiezza).
function drawEffect(ctx, W, H, dpr, mode, p) {
  const { t, amp, beat, newBeat, bass, mid, high, freq, bins, nightMode, st } = p;
  const cx = W / 2, cy = H / 2;
  const hueBase = nightMode ? 300 : 190;
  const accent = nightMode ? "255,61,138" : "0,229,255";

  if (mode === "gradient") {
    const a = t * 0.25;
    const g = ctx.createLinearGradient(
      cx + Math.cos(a) * W * 0.6, cy + Math.sin(a) * H * 0.6,
      cx - Math.cos(a) * W * 0.6, cy - Math.sin(a) * H * 0.6);
    const h1 = (hueBase + t * 12) % 360, h2 = (h1 + 70 + beat * 40) % 360, h3 = (h1 + 180) % 360;
    g.addColorStop(0, `hsl(${h1},90%,${28 + beat * 22}%)`);
    g.addColorStop(0.5, `hsl(${h2},85%,${22 + beat * 18}%)`);
    g.addColorStop(1, `hsl(${h3},90%,${18 + beat * 14}%)`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // blob luminoso che pulsa sul beat
    const r = Math.min(W, H) * (0.18 + beat * 0.22);
    const rg = ctx.createRadialGradient(cx + Math.sin(t * 0.7) * W * 0.2, cy + Math.cos(t * 0.5) * H * 0.2, 0,
                                        cx + Math.sin(t * 0.7) * W * 0.2, cy + Math.cos(t * 0.5) * H * 0.2, r);
    rg.addColorStop(0, `rgba(255,255,255,${0.35 + beat * 0.35})`); rg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    return;
  }

  if (mode === "rings") {
    ctx.fillStyle = "rgba(2,4,10,0.22)"; ctx.fillRect(0, 0, W, H);
    if (newBeat || st.rings.length === 0) st.rings.push({ r: 4 * dpr, a: 1, w: (3 + amp * 6) * dpr, hue: (hueBase + Math.random() * 60) % 360 });
    if (Math.random() < 0.15 + amp * 0.5) {
      const ang = Math.random() * Math.PI * 2, sp = (0.8 + amp * 3) * dpr;
      st.rings.push({ p: true, x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, a: 1, hue: (hueBase + Math.random() * 80) % 360 });
    }
    const maxR = Math.hypot(W, H) / 2;
    st.rings = st.rings.filter((o) => o.a > 0.02);
    for (const o of st.rings) {
      if (o.p) {
        o.x += o.vx; o.y += o.vy; o.a -= 0.012;
        ctx.fillStyle = `hsla(${o.hue},95%,70%,${o.a})`;
        ctx.beginPath(); ctx.arc(o.x, o.y, (1.5 + amp * 2) * dpr, 0, Math.PI * 2); ctx.fill();
      } else {
        o.r += (2.5 + beat * 6) * dpr; o.a = Math.max(0, 1 - o.r / maxR);
        ctx.strokeStyle = `hsla(${o.hue},95%,65%,${o.a})`; ctx.lineWidth = o.w;
        ctx.shadowColor = `hsla(${o.hue},95%,65%,${o.a})`; ctx.shadowBlur = 14 * dpr;
        ctx.beginPath(); ctx.arc(cx, cy, o.r, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.shadowBlur = 0;
    if (st.rings.length > 140) st.rings.splice(0, st.rings.length - 140);
    // nucleo
    ctx.fillStyle = `rgba(${accent},${0.5 + beat * 0.5})`;
    ctx.beginPath(); ctx.arc(cx, cy, (6 + beat * 18) * dpr, 0, Math.PI * 2); ctx.fill();
    return;
  }

  if (mode === "eq") {
    ctx.fillStyle = "rgba(2,4,10,0.35)"; ctx.fillRect(0, 0, W, H);
    const N = 48, gap = 3 * dpr, bw = (W - gap * (N + 1)) / N;
    if (st.eq.length !== N) st.eq = new Array(N).fill(0);
    for (let i = 0; i < N; i++) {
      const bi = Math.floor(Math.pow(i / N, 1.6) * Math.min(bins, 128));
      let v = freq && freq.length ? freq[bi] / 255 : 0;
      if (v < 0.02) v = amp * (0.5 + 0.5 * Math.sin(t * 3 + i * 0.4)) * (0.6 + 0.4 * beat); // fallback fake
      st.eq[i] = Math.max(v, st.eq[i] * 0.86);
      const h = st.eq[i] * H * 0.75 * (0.85 + beat * 0.25);
      const x = gap + i * (bw + gap);
      const g = ctx.createLinearGradient(0, H, 0, H - h);
      g.addColorStop(0, `hsla(${hueBase},95%,55%,0.95)`); g.addColorStop(1, `hsla(${(hueBase + 90) % 360},95%,65%,0.95)`);
      ctx.fillStyle = g; ctx.fillRect(x, H - h, bw, h);
      ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.fillRect(x, H - h - 3 * dpr, bw, 2 * dpr);
    }
    // waveform sopra
    ctx.strokeStyle = `rgba(${accent},0.9)`; ctx.lineWidth = 2 * dpr; ctx.shadowColor = `rgb(${accent})`; ctx.shadowBlur = 10 * dpr;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 4 * dpr) {
      const k = x / W;
      const y = cy * 0.55 + Math.sin(k * Math.PI * 6 + t * 5) * H * (0.04 + bass * 0.12 + beat * 0.05)
                        + Math.sin(k * Math.PI * 14 - t * 7) * H * (0.02 + high * 0.08);
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.shadowBlur = 0;
    return;
  }

  if (mode === "starfield") {
    ctx.fillStyle = `rgba(2,4,10,${0.35 - beat * 0.15})`; ctx.fillRect(0, 0, W, H);
    if (st.stars.length < 260) for (let i = st.stars.length; i < 260; i++) st.stars.push({ x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2, z: Math.random() });
    const speed = 0.004 + beat * 0.03 + amp * 0.01;
    const f = Math.min(W, H) * 0.9;
    for (const s of st.stars) {
      const pz = s.z; s.z -= speed;
      if (s.z <= 0.02) { s.x = (Math.random() - 0.5) * 2; s.y = (Math.random() - 0.5) * 2; s.z = 1; continue; }
      const sx = cx + (s.x / s.z) * f, sy = cy + (s.y / s.z) * f;
      const px = cx + (s.x / pz) * f, py = cy + (s.y / pz) * f;
      const b = 1 - s.z;
      ctx.strokeStyle = `hsla(${(hueBase + b * 60) % 360},90%,${60 + b * 35}%,${0.35 + b * 0.65})`;
      ctx.lineWidth = (0.6 + b * 2.4) * dpr;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(sx, sy); ctx.stroke();
    }
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(W, H) * 0.25);
    rg.addColorStop(0, `rgba(${accent},${0.10 + beat * 0.25})`); rg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    return;
  }

  if (mode === "holo") {
    ctx.fillStyle = "rgba(2,4,10,0.30)"; ctx.fillRect(0, 0, W, H);
    const R = Math.min(W, H) * (0.26 + beat * 0.06 + bass * 0.04);
    const rot = t * 0.6, tilt = 0.45 + Math.sin(t * 0.3) * 0.2;
    ctx.lineWidth = 1.2 * dpr; ctx.shadowColor = `rgb(${accent})`; ctx.shadowBlur = 8 * dpr;
    for (let i = 0; i < 12; i++) {           // meridiani
      const a = rot + (i / 12) * Math.PI;
      ctx.strokeStyle = `rgba(${accent},${0.25 + 0.5 * Math.abs(Math.cos(a)) * (0.6 + beat * 0.4)})`;
      ctx.beginPath(); ctx.ellipse(cx, cy, Math.abs(Math.cos(a)) * R + 0.01, R, tilt, 0, Math.PI * 2); ctx.stroke();
    }
    for (let j = 1; j < 7; j++) {            // paralleli
      const y = -R + (2 * R * j) / 7, rr = Math.sqrt(Math.max(0, R * R - y * y));
      ctx.strokeStyle = `rgba(${accent},${0.35 + mid * 0.5})`;
      ctx.beginPath(); ctx.ellipse(cx + Math.sin(tilt) * y * 0.3, cy + Math.cos(tilt) * y, rr, rr * 0.28, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.shadowBlur = 0;
    const g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R * 1.15);
    g.addColorStop(0, `rgba(255,255,255,${0.12 + beat * 0.2})`); g.addColorStop(0.7, `rgba(${accent},0.08)`); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.15, 0, Math.PI * 2); ctx.fill();
    // scanline olografica + anello orbitale a tempo
    const sy = cy - R + ((t * 60) % (2 * R));
    ctx.fillStyle = `rgba(${accent},0.35)`; ctx.fillRect(cx - R, sy, 2 * R, 2 * dpr);
    ctx.strokeStyle = `rgba(255,255,255,${0.3 + beat * 0.6})`; ctx.lineWidth = 2 * dpr;
    ctx.beginPath(); ctx.ellipse(cx, cy, R * 1.35, R * 0.35, -0.5 + Math.sin(t * 0.4) * 0.2, 0, Math.PI * 2); ctx.stroke();
    return;
  }

  if (mode === "logo") {
    // v13.41 · Fix ticket #247410: logo rotante al centro, fade colore
    // continuo, anelli/particelle/note a ritmo. Scena di default in home
    // al posto delle vecchie onde sinusoidali.
    ctx.fillStyle = "rgba(2,4,10,0.20)"; ctx.fillRect(0, 0, W, H);
    const hue = (hueBase + t * 22) % 360;
    const bgGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.7);
    bgGlow.addColorStop(0, `hsla(${hue},80%,${14 + beat * 10}%,0.55)`);
    bgGlow.addColorStop(1, "rgba(2,4,10,0)");
    ctx.fillStyle = bgGlow; ctx.fillRect(0, 0, W, H);

    if (!st.notes) st.notes = [];
    if (!st.logoRot) st.logoRot = 0;
    st.logoRot += 0.006 + beat * 0.012;

    // Anelli pulsanti a ritmo (stesso pattern del mode "rings")
    if (newBeat || st.rings.length === 0) st.rings.push({ r: 4 * dpr, a: 1, w: (3 + amp * 5) * dpr, hue: (hue + 40) % 360 });
    const maxR = Math.hypot(W, H) / 2;
    st.rings = st.rings.filter((o) => o.a > 0.02);
    for (const o of st.rings) {
      o.r += (2.2 + beat * 5) * dpr; o.a = Math.max(0, 1 - o.r / (maxR * 0.85));
      ctx.strokeStyle = `hsla(${o.hue},95%,65%,${o.a * 0.8})`; ctx.lineWidth = o.w;
      ctx.shadowColor = `hsla(${o.hue},95%,65%,${o.a})`; ctx.shadowBlur = 12 * dpr;
      ctx.beginPath(); ctx.arc(cx, cy, o.r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.shadowBlur = 0;
    if (st.rings.length > 60) st.rings.splice(0, st.rings.length - 60);

    // Particelle che schizzano dal centro sul beat
    if (newBeat) {
      for (let i = 0; i < 6; i++) {
        const ang = Math.random() * Math.PI * 2, sp = (1.2 + amp * 4) * dpr;
        st.rings.push({ p: true, x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, a: 1, hue: (hue + Math.random() * 90) % 360 });
      }
      // Nota musicale occasionale a ritmo
      if (Math.random() < 0.7) {
        const ang = Math.random() * Math.PI * 2;
        st.notes.push({
          x: cx + Math.cos(ang) * (Math.min(W, H) * 0.16), y: cy + Math.sin(ang) * (Math.min(W, H) * 0.16),
          vx: Math.cos(ang) * 0.6 * dpr, vy: (Math.sin(ang) * 0.6 - 0.9) * dpr,
          a: 1, hue: (hue + 150) % 360, glyph: Math.random() < 0.5 ? "\u266A" : "\u266B",
          size: (14 + Math.random() * 10) * dpr,
        });
      }
    }
    for (const o of st.rings) {
      if (!o.p) continue;
      o.x += o.vx; o.y += o.vy; o.a -= 0.015;
      ctx.fillStyle = `hsla(${o.hue},95%,70%,${Math.max(0, o.a)})`;
      ctx.beginPath(); ctx.arc(o.x, o.y, (1.5 + amp * 2) * dpr, 0, Math.PI * 2); ctx.fill();
    }

    // Note musicali: fluttuano verso l'alto e svaniscono
    st.notes = st.notes.filter((n) => n.a > 0.02);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const n of st.notes) {
      n.x += n.vx; n.y += n.vy; n.a -= 0.008;
      ctx.font = `${n.size}px sans-serif`;
      ctx.fillStyle = `hsla(${n.hue},90%,75%,${Math.max(0, n.a)})`;
      ctx.shadowColor = `hsla(${n.hue},90%,65%,${Math.max(0, n.a)})`; ctx.shadowBlur = 8 * dpr;
      ctx.fillText(n.glyph, n.x, n.y);
    }
    ctx.shadowBlur = 0;
    if (st.notes.length > 40) st.notes.splice(0, st.notes.length - 40);

    // Logo rotante al centro, colore in fade continuo
    const logoImg = _getLogoImg();
    const logoR = Math.min(W, H) * (0.20 + beat * 0.03);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(st.logoRot);
    if (logoImg.complete && logoImg.naturalWidth > 0) {
      try { ctx.filter = `hue-rotate(${hue}deg) saturate(1.5) brightness(${1 + beat * 0.3})`; } catch {}
      ctx.globalAlpha = 0.92;
      ctx.drawImage(logoImg, -logoR, -logoR, logoR * 2, logoR * 2);
      ctx.filter = "none"; ctx.globalAlpha = 1;
    } else {
      // Fallback procedurale finché l'immagine non è pronta: emblema circolare
      ctx.strokeStyle = `hsla(${hue},95%,65%,0.9)`; ctx.lineWidth = 3 * dpr;
      ctx.shadowColor = `hsla(${hue},95%,65%,0.8)`; ctx.shadowBlur = 14 * dpr;
      ctx.beginPath(); ctx.arc(0, 0, logoR, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
    return;
  }
}


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
  fillHeight = false,   // v13.6 · quando true, occupa altezza 100% del parent (no aspect-ratio)
  effect = "auto",      // v13.41 · auto | gradient | rings | eq | starfield | holo | logo
}) {
  const canvasRef = useRef(null);
  const bgRef = useRef(null);
  const rafRef = useRef(null);
  const particlesRef = useRef([]);
  const strobeRef = useRef(0);
  const modeAlphaRef = useRef({ music: 0, talk: 0, clock: 0, standby: 1 });
  // v13.40 · effetto scelto + BPM live (letti dal loop rAF senza riavviarlo)
  const effectRef = useRef(effect);
  useEffect(() => { effectRef.current = effect; }, [effect]);
  const bpmRef = useRef(null);
  const fxStateRef = useRef({ stars: [], rings: [], lastBeat: -1, eq: [] });
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/stream/now`);
        const d = await r.json();
        if (alive) bpmRef.current = Number(d?.current?.bpm) > 0 ? Number(d.current.bpm) : null;
      } catch {}
    };
    poll();
    const iv = setInterval(poll, 10000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  // v13.8 · LedWall Video Overlay — legge /api/ledwall/state e mostra un
  // <video> reale sopra al canvas quando video_source ≠ 'effects'.
  const [ledState, setLedState] = useState({ video_source: "effects", video_url: null });
  // v13.10 · Playing runtime — quando il Sync Live parte il canvas passa da
  // standby (immagine fissa) a modalità musica (onde+stelle) anche se il
  // vecchio radioEngine non lo sa.
  const [syncPlaying, setSyncPlaying] = useState(false);
  useEffect(() => {
    const onSync = (e) => setSyncPlaying(!!e?.detail?.playing);
    window.addEventListener("rai:sync:play", onSync);
    return () => window.removeEventListener("rai:sync:play", onSync);
  }, []);
  // Override della prop `isPlaying` col segnale del Sync Live
  const effectivePlaying = isPlaying || syncPlaying;

  useEffect(() => {
    let alive = true;
    const fetchState = async () => {
      try {
        // v13.31 · Fetch parallela night-state per Virtual Club override
        const [r, rn] = await Promise.all([
          fetch(`${process.env.REACT_APP_BACKEND_URL}/api/ledwall/state`),
          fetch(`${process.env.REACT_APP_BACKEND_URL}/api/ledwall/night-state`).catch(() => null),
        ]);
        const d = await r.json();
        let night = null;
        if (rn && rn.ok) {
          try {
            const nd = await rn.json();
            if (nd && nd.active) night = nd;
          } catch {}
        }
        if (!alive) return;
        if (night && night.asset) {
          // Virtual Club override — mp4/photo/fx
          const a = night.asset;
          if (a.kind === "fx") {
            setLedState({ video_source: "effects", video_url: null, night_asset: a });
          } else if (a.kind === "mp4") {
            setLedState({ video_source: "video", video_url: a.url, night_asset: a });
          } else if (a.kind === "photo") {
            setLedState({ video_source: "photo", video_url: a.url, night_asset: a });
          }
        } else {
          setLedState({ video_source: d.video_source || "effects", video_url: d.video_url || null, night_asset: null });
        }
      } catch {}
    };
    fetchState();
    const iv = setInterval(fetchState, 8000);   // poll ogni 8s (piu' reattivo per night rotation)
    return () => { alive = false; clearInterval(iv); };
  }, []);

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

      // v13.18 · FALLBACK ampiezza: se l'analyser è piatto (MSE su Chrome
      // senza cablaggio Web Audio, Safari nativo che non espone dati, oppure
      // il player HLS non è ancora agganciato) ma il segnale
      // `rai:sync:play` è ON, usa getFakeAmplitude() per animare comunque
      // stelle cadenti, ologrammi e onde sinusoidali. Zero visual muti.
      const analyserFlat = (bass + mid + high) < 0.02;
      if (analyserFlat && (isPlaying || syncPlaying)) {
        const fake = radioEngine.getFakeAmplitude?.() || 0;
        if (fake > 0.05) {
          bass = fake * 0.9;
          mid = fake * 0.7;
          high = fake * 0.5;
        }
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
      const target = detectMode(current, effectivePlaying);
      const alphas = modeAlphaRef.current;
      const FADE = 0.045;
      ["music","talk","clock","standby"].forEach(m => {
        const goal = (m === target) ? 1 : 0;
        alphas[m] += (goal - alphas[m]) * FADE;
      });

      // Standby assoluto = prima del PLAY: nessuna transizione in corso verso
      // un altro modo. Usata sia per l'immagine statica sotto, sia per il
      // canvas vuoto/immobile qui sotto.
      const isAbsoluteStandby = target === "standby" && alphas.standby > 0.98;

      // --- Opacità immagine console ---
      //  Prima del PLAY (standby assoluto): immagine statica, nitida al 100%.
      //  Durante la riproduzione: RESPIRO ATMOSFERICO, ciclo 40s.
      //    0-20s   → 10%  (quasi invisibile, riposo)
      //    20-30s  → 10% → 30% (ease-in-out, "inspiro")
      //    30-40s  → 30% → 10% (ease-in-out, "espiro")
      if (bgRef.current) {
        if (isAbsoluteStandby) {
          bgRef.current.style.opacity = "1";
        } else {
          const CYCLE = 40;
          const phase = (performance.now() / 1000) % CYCLE;
          let bgOpacity;
          if (phase < 20) {
            bgOpacity = 0.10;                                    // riposo
          } else if (phase < 30) {
            const k = (phase - 20) / 10;                         // 0..1
            const eased = 0.5 - 0.5 * Math.cos(k * Math.PI);     // ease-in-out sin
            bgOpacity = 0.10 + eased * 0.20;                     // 0.10 → 0.30
          } else {
            const k = (phase - 30) / 10;                         // 0..1
            const eased = 0.5 - 0.5 * Math.cos(k * Math.PI);
            bgOpacity = 0.30 - eased * 0.20;                     // 0.30 → 0.10
          }
          bgRef.current.style.opacity = String(bgOpacity);
        }
      }

      // === v13.40 · EFFETTI VISIVI SELEZIONABILI (sostituiscono il canvas Auto) ===
      const fxMode = effectRef.current;
      if (fxMode && fxMode !== "auto") {
        if (bgRef.current) bgRef.current.style.opacity = "0.10";
        const t = performance.now() / 1000;
        const amp = Math.min(1, bass * 0.6 + mid * 0.3 + high * 0.1);
        // Beat: da BPM server se disponibile, altrimenti dall'ampiezza audio
        const bpm = bpmRef.current;
        let beat, beatIdx = -1;
        if (bpm) {
          const beatsF = t * bpm / 60;
          beatIdx = Math.floor(beatsF);
          const ph = beatsF - beatIdx;
          beat = Math.pow(1 - ph, 2.2) * (0.55 + 0.45 * Math.min(1, amp * 1.6 + 0.2));
        } else {
          beat = amp;
          const kick = bass - prevBass;
          if (kick > 0.18 && bass > 0.45) beatIdx = Math.floor(t * 10);
        }
        const st = fxStateRef.current;
        const newBeat = beatIdx !== -1 && beatIdx !== st.lastBeat;
        if (newBeat) st.lastBeat = beatIdx;
        drawEffect(ctx, W, H, dpr, fxMode, { t, amp, beat, newBeat, bass, mid, high, freq, bins, palette, nightMode, st });
        prevBass = bass;
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      // === STANDBY assoluto: canvas VUOTO e IMMOBILE ===
      // Evita qualsiasi lampeggio quando la radio è ferma: nessun trail, nessuna
      // grid, nessuna onda residua.
      if (isAbsoluteStandby) {
        ctx.clearRect(0, 0, W, H);
        rafRef.current = requestAnimationFrame(draw);
        return;
      }



      // --- Trail overlay sul canvas (per stelle cadenti a scia) ---
      // Alpha basso su music/talk = coda; su clock/standby copre più forte
      const trailA =
        0.12 * alphas.music +   // stelle cadenti a scia
        0.20 * alphas.talk +    // sfera con leggero motion blur
        0.55 * alphas.clock;    // pulizia più forte per orologio
      // Standby: NON dipingere overlay opaco → altrimenti l'immagine PNG
      // sotto sembrerebbe "lampeggiare" quando le α di transizione si assestano.
      if (trailA > 0.01) {
        ctx.fillStyle = `rgba(2,4,10,${trailA})`;
        ctx.fillRect(0, 0, W, H);
      } else {
        ctx.clearRect(0, 0, W, H);
      }

      // Grid (leggero, solo quando siamo in modi attivi)
      const gridA = (alphas.music + alphas.talk + alphas.clock);
      if (gridA > 0.10) {
        ctx.globalAlpha = Math.min(1, gridA);
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

      // ============ STELLE CADENTI (evento raro, magico) ============
      if (alphas.music > 0.15) {
        const kick = bass - prevBass;
        // Solo su kick MOLTO forti: evento magico, dimezzato ulteriormente
        if (kick > 0.30 && bass > 0.55) {
          const count = nightMode ? 2 : 1;
          for (let i = 0; i < count; i++) {
            spawnShootingStar(particlesRef.current, W, H, dpr);
          }
        }
        // Ambient rarissimo (~1 stella ogni 15-20s a volume medio)
        if (Math.random() < 0.008 * bass) {
          spawnShootingStar(particlesRef.current, W, H, dpr);
        }
        // Draw + update — scia sottile bianco → blu
        const pList = particlesRef.current;
        for (let i = pList.length - 1; i >= 0; i--) {
          const p = pList[i];
          p.prevX = p.x; p.prevY = p.y;
          p.x += p.vx; p.y += p.vy;
          p.vx *= 0.995; p.vy *= 0.995;
          p.life -= p.decay;
          if (
            p.life <= 0 ||
            p.x < -80 || p.x > W + 80 ||
            p.y < -80 || p.y > H + 80
          ) { pList.splice(i, 1); continue; }
          const grad = ctx.createLinearGradient(p.prevX, p.prevY, p.x, p.y);
          grad.addColorStop(0, "rgba(30,144,255,0)");
          grad.addColorStop(0.55, `rgba(30,144,255,${0.40 * p.life * alphas.music})`);
          grad.addColorStop(1, `rgba(255,255,255,${0.85 * p.life * alphas.music})`);
          ctx.strokeStyle = grad;
          ctx.lineWidth = p.size;
          ctx.shadowColor = "rgba(120,200,255,0.9)";
          ctx.shadowBlur = 6 * dpr;
          ctx.beginPath();
          ctx.moveTo(p.prevX, p.prevY);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          // Testa piccola, discreta
          ctx.beginPath();
          ctx.fillStyle = `rgba(255,255,255,${p.life * alphas.music})`;
          ctx.arc(p.x, p.y, p.size * 0.7, 0, Math.PI * 2);
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
  }, [isPlaying, syncPlaying, current, trackOverlay, djs]);

  return (
    <div
      data-testid="ledwall"
      className={`relative w-full rounded-2xl overflow-hidden focusable${fillHeight ? " h-full" : ""}`}
      style={{
        ...(fillHeight ? {} : { aspectRatio: "16 / 6.75" }),
        background: "#000",
        border: "1px solid rgba(0,229,255,0.35)",
        boxShadow: "0 0 0 1px rgba(0,229,255,0.25) inset, 0 0 40px rgba(0,191,255,0.25)",
      }}
    >
      {/* v13.8 · VIDEO OVERLAY REALE — quando Master Clock imposta video/cam
          v13.10 · Fade automatico: 600ms transition-opacity in entrata/uscita,
          onEnded triggera un poll immediato dello state per fallback effetti */}
      {(ledState.video_source === "video" || ledState.video_source === "cam") && ledState.video_url && (
        <video
          key={ledState.video_url}
          src={ledState.video_url}
          autoPlay muted loop playsInline
          onEnded={() => {
            // Fallback: se non è in loop (o loop rimosso in futuro), forza refetch
            setLedState((s) => ({ ...s, video_source: "effects", video_url: null }));
          }}
          data-testid="ledwall-video"
          className="absolute inset-0 w-full h-full object-cover z-30 transition-opacity duration-500"
          style={{ backgroundColor: "#000", opacity: 1 }}
        />
      )}
      {/* v13.31 · KEN BURNS PHOTO — Virtual Club notturno, foto con pan+zoom */}
      {ledState.video_source === "photo" && ledState.video_url && (
        <div
          key={ledState.video_url}
          data-testid="ledwall-photo-kenburns"
          className="absolute inset-0 z-30 overflow-hidden"
          style={{ backgroundColor: "#000" }}
        >
          <img
            src={ledState.video_url}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            style={{
              animation: "kenburns 22s ease-in-out infinite alternate",
              transformOrigin: "center center",
            }}
          />
          <style>{`
            @keyframes kenburns {
              0%   { transform: scale(1.05) translate(-2%, -1%); filter: brightness(0.92); }
              50%  { transform: scale(1.15) translate(2%, 1%);   filter: brightness(1.05); }
              100% { transform: scale(1.08) translate(-1%, 2%);  filter: brightness(0.98); }
            }
          `}</style>
        </div>
      )}
      {/* L-1 · NEBULOSA profondità (CSS gradient, opacità 0.12) — dietro tutto */}
      <div
        aria-hidden
        data-testid="ledwall-nebula"
        className="absolute inset-0 pointer-events-none"
        style={{
          opacity: 0.12,
          background: [
            "radial-gradient(ellipse 60% 55% at 22% 32%, rgba(90,50,200,0.55) 0%, transparent 60%)",
            "radial-gradient(ellipse 55% 45% at 78% 68%, rgba(30,100,200,0.55) 0%, transparent 60%)",
            "radial-gradient(ellipse 40% 50% at 55% 20%, rgba(160,60,220,0.35) 0%, transparent 55%)",
            "radial-gradient(circle at 12% 78%, rgba(255,255,255,0.9) 0px, transparent 1.2px)",
            "radial-gradient(circle at 88% 22%, rgba(255,255,255,0.9) 0px, transparent 1.2px)",
            "radial-gradient(circle at 45% 88%, rgba(200,220,255,0.8) 0px, transparent 1.4px)",
            "radial-gradient(circle at 68% 44%, rgba(255,255,255,0.7) 0px, transparent 1.0px)",
            "radial-gradient(circle at 30% 15%, rgba(220,230,255,0.7) 0px, transparent 1.1px)",
            "linear-gradient(180deg, #030418 0%, #01020C 100%)",
          ].join(", "),
          filter: "blur(0.4px)",
        }}
      />
      {/* L0 · console PNG nitida in background (opacità animata dal canvas) */}
      <img
        ref={bgRef}
        src="/rai-visual-bg.png"
        alt=""
        aria-hidden
        data-testid="ledwall-bg"
        className="absolute inset-0 w-full h-full object-cover pointer-events-none"
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
function spawnShootingStar(list, W, H, dpr) {
  // Nasce da un punto random di UNO dei 4 bordi e attraversa lo schermo
  // in direzione del lato opposto (con jitter angolare). Scia sottile.
  const edge = Math.floor(Math.random() * 4); // 0=top 1=right 2=bottom 3=left
  const sp = (3.5 + Math.random() * 5) * dpr;   // velocità moderata
  let x, y, angle;
  const jitter = (Math.random() - 0.5) * 0.55; // ~±16°
  if (edge === 0) {
    x = Math.random() * W;
    y = -25;
    angle = Math.PI * 0.5 + jitter;  // verso il basso
  } else if (edge === 1) {
    x = W + 25;
    y = Math.random() * H;
    angle = Math.PI + jitter;        // verso sinistra
  } else if (edge === 2) {
    x = Math.random() * W;
    y = H + 25;
    angle = -Math.PI * 0.5 + jitter; // verso l'alto
  } else {
    x = -25;
    y = Math.random() * H;
    angle = 0 + jitter;              // verso destra
  }
  list.push({
    x, y, prevX: x, prevY: y,
    vx: Math.cos(angle) * sp,
    vy: Math.sin(angle) * sp,
    life: 1.0,
    decay: 0.006 + Math.random() * 0.006, // vita lunga → scia lunga e delicata
    size: (0.7 + Math.random() * 0.6) * dpr, // sottile: 0.7-1.3 dpr (era 1-3)
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
