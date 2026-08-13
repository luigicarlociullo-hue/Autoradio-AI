import React, { useEffect, useRef } from "react";
import radioEngine from "@/lib/radioEngine";

/**
 * HoloBrand — Ologramma 3D reattivo del marchio R-A.I.
 *
 * Il marchio è scomposto in 6 glyph indipendenti: R  -  A  .  I  .
 * Ogni glyph è un layer con:
 *   • scale reattivo al bin di frequenza dell'audio analyser
 *   • profondità 3D (translateZ + rotateY) su un container con perspective
 *   • glow neon indipendente
 *
 * Il container mostra anche, in overlay integrato nello stesso hologramma:
 *   • Anelli concentrici neon (aura)
 *   • Now Playing (kind + dj + title) come ring/orbit sotto il logo
 *   • Marquee del titolo brano al centro-basso quando è musica
 *
 * Reattività: usa `radioEngine.getAnalyser()`. Se assente (radio ferma),
 * respiro idle sinusoidale così il logo sembra vivo comunque.
 */
export default function HoloBrand({ isPlaying = false, current = null, trackOverlay = null }) {
  const wrapRef = useRef(null);
  const rafRef = useRef(null);
  const glyphRefs = useRef([]);
  const ringRef = useRef(null);
  const logoBgRef = useRef(null);
  const infoRef = useRef(null);
  const state = useRef({ bass: 0, mid: 0, high: 0, phase: 0 });

  // 6 glyph indipendenti: R  -  A  .  I  .
  // STILE: outline laser filiforme (weight leggero + text-stroke). I punti
  // e il trattino sono più corposi per rimanere leggibili come simboli.
  const GLYPHS = [
    { ch: "R",  band: [4, 12],   depthZ: 20,  color: "#00E5FF", weight: 300, size: 1.00, outline: true },
    { ch: "-",  band: [8, 16],   depthZ: 10,  color: "#00E5FF", weight: 400, size: 0.60, outline: false, mono: true },
    { ch: "A",  band: [12, 22],  depthZ: 30,  color: "#E6F1FF", weight: 300, size: 1.00, outline: true },
    { ch: ".",  band: [22, 40],  depthZ: 12,  color: "#00E5FF", weight: 700, size: 0.55, outline: false, dot: true },
    { ch: "I",  band: [40, 70],  depthZ: 25,  color: "#00E5FF", weight: 300, size: 1.00, outline: true },
    { ch: ".",  band: [60, 100], depthZ: 12,  color: "#00E5FF", weight: 700, size: 0.55, outline: false, dot: true },
  ];

  useEffect(() => {
    const tick = () => {
      const analyser = radioEngine.getAnalyser();
      const binCount = analyser ? analyser.frequencyBinCount : 128;
      const freq = new Uint8Array(binCount);
      if (analyser) analyser.getByteFrequencyData(freq);

      state.current.phase += 0.02;
      const t = state.current.phase;
      const breath = 0.5 + 0.5 * Math.sin(t * 1.4);

      // Global bass smoothing per l'anello / rotazione container
      let bassSum = 0;
      const bEnd = analyser ? Math.min(14, binCount) : 0;
      for (let i = 2; i < bEnd; i++) bassSum += freq[i];
      const bass = analyser ? bassSum / (bEnd - 2) / 255 : 0;
      state.current.bass = state.current.bass * 0.85 + bass * 0.15;

      // Perspective wobble del container: sottile rotazione Y basata sui bassi
      if (wrapRef.current) {
        const rot = (state.current.bass * 8 - 4) + Math.sin(t * 0.9) * 2;
        wrapRef.current.style.transform = `perspective(900px) rotateX(4deg) rotateY(${rot.toFixed(2)}deg)`;
      }

      // Anello / aura: pulsa con i bassi
      if (ringRef.current) {
        const scale = 1 + state.current.bass * 0.10 + breath * 0.02;
        const opa = 0.55 + state.current.bass * 0.45;
        ringRef.current.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;
        ringRef.current.style.opacity = opa.toFixed(2);
      }

      // Logo simbolo di sfondo: respira con i bassi
      if (logoBgRef.current) {
        const scale = 1 + state.current.bass * 0.08 + breath * 0.015;
        const opa = 0.55 + state.current.bass * 0.30 + breath * 0.05;
        logoBgRef.current.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;
        logoBgRef.current.style.opacity = Math.min(1, opa).toFixed(2);
      }

      // Glyph reattivi: scale + glow indipendenti per bin
      GLYPHS.forEach((g, i) => {
        const el = glyphRefs.current[i];
        if (!el) return;
        // Media energia del bin range assegnato
        let sum = 0, count = 0;
        for (let b = g.band[0]; b < Math.min(g.band[1], binCount); b++) {
          sum += freq[b]; count++;
        }
        const energy = analyser && count > 0 ? sum / count / 255 : (isPlaying ? 0.20 : 0.08);
        const idle = 0.5 + 0.5 * Math.sin(t * (1.2 + i * 0.13));
        const amp = analyser ? energy : idle * (isPlaying ? 0.25 : 0.10);

        const scale = 1 + amp * 0.14;
        const brightness = 0.85 + amp * 0.55;
        const zPush = g.depthZ + amp * 20;
        const glowSize = 6 + amp * 24;
        const glowOpacity = 0.4 + amp * 0.55;

        el.style.transform = `translateZ(${zPush.toFixed(1)}px) scale(${scale.toFixed(3)})`;
        el.style.filter = `brightness(${brightness.toFixed(2)})`;
        el.style.textShadow =
          `0 0 ${glowSize.toFixed(1)}px ${g.color}${_hexAlpha(glowOpacity)}, ` +
          `0 0 ${(glowSize * 2.2).toFixed(1)}px ${g.color}${_hexAlpha(glowOpacity * 0.55)}`;
      });

      // Info panel float parallax
      if (infoRef.current) {
        const yFloat = Math.sin(t * 0.8) * 2 + state.current.bass * 4;
        infoRef.current.style.transform = `translateY(${yFloat.toFixed(1)}px)`;
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying]);

  const isMusic = current?.kind === "music";
  const meta = current?.track_meta || {};
  const trackTitle = isMusic
    ? (meta.title || (current?.title || "").replace(/^♪\s*/, "").split(" — ")[0] || "")
    : (current?.title || "");
  const trackArtist = isMusic
    ? (meta.artist || (current?.title || "").split(" — ")[1] || "")
    : "";
  const djName = current?.dj_name || "";
  const kindLabel = current?.kind ? current.kind.toUpperCase() : (isPlaying ? "LIVE" : "STAND-BY");

  return (
    <div
      className="holo-brand-frame"
      data-testid="holo-brand"
      data-playing={isPlaying}
    >
      {/* Simbolo grafico R-A.I. come layer di sfondo, dietro le lettere */}
      <img
        ref={logoBgRef}
        src="/rai-logo.png"
        alt=""
        aria-hidden
        className="holo-logo-bg"
        data-testid="holo-logo-bg"
      />
      {/* Aura ring esterno (pulsa con i bassi) */}
      <div ref={ringRef} className="holo-ring" aria-hidden />
      {/* Griglia radiale di scanline */}
      <div className="holo-scan" aria-hidden />
      {/* Punto rosso ON AIR nell'angolo */}
      <div className="holo-onair" aria-hidden>
        <span className="live-dot" style={{ background: isPlaying ? "#FF6B1A" : "#00BFFF", boxShadow: `0 0 12px ${isPlaying ? "#FF6B1A" : "#00BFFF"}` }} />
        <span className="holo-onair-label" style={{ color: isPlaying ? "#FF8A3D" : "#00E5FF" }}>
          {isPlaying ? "ON AIR" : "STAND-BY"}
        </span>
      </div>

      {/* Antenna simbolica sopra il logo */}
      <div className="holo-antenna" aria-hidden>
        <span className="holo-antenna-line" />
        <span className="holo-antenna-dot" />
      </div>

      {/* Container 3D del marchio */}
      <div ref={wrapRef} className="holo-3d">
        <div className="holo-glyphs">
          {GLYPHS.map((g, i) => (
            <span
              key={i}
              ref={(el) => (glyphRefs.current[i] = el)}
              className={`holo-glyph ${g.dot ? "is-dot" : ""} ${g.mono ? "is-mono" : ""} ${g.outline ? "is-outline" : "is-solid"}`}
              style={{
                color: g.color,
                fontWeight: g.weight,
                fontSize: `${g.size * 100}%`,
                verticalAlign: g.dot ? "0.02em" : (g.mono ? "0.10em" : "baseline"),
              }}
            >
              {g.ch}
            </span>
          ))}
        </div>

        {/* Info brani integrate come parte dell'hologramma */}
        <div ref={infoRef} className="holo-info">
          <div className="holo-info-kind">
            <span className="holo-info-tick">◂</span>
            <span>{kindLabel}</span>
            {djName && <><span className="holo-info-dot">·</span><span>{djName}</span></>}
            <span className="holo-info-tick">▸</span>
          </div>
          <div className="holo-info-title" data-testid="holo-title">
            {trackTitle || (isPlaying ? "…" : "R-A.I. WEB RADIO")}
          </div>
          {trackArtist && (
            <div className="holo-info-artist">{trackArtist}</div>
          )}
        </div>
      </div>

      {/* Marquee opzionale in basso quando trackOverlay è visibile e c'è musica */}
      {trackOverlay?.visible && trackOverlay?.title && (
        <div className="holo-marquee" aria-hidden>
          <div className="holo-marquee-inner">
            <span>{trackOverlay.title}{trackOverlay.artist ? ` · ${trackOverlay.artist}` : ""}  •  {trackOverlay.title}{trackOverlay.artist ? ` · ${trackOverlay.artist}` : ""}  •  </span>
          </div>
        </div>
      )}
    </div>
  );
}

function _hexAlpha(a) {
  const v = Math.max(0, Math.min(1, a));
  const n = Math.round(v * 255);
  const s = n.toString(16).padStart(2, "0");
  return s;
}
