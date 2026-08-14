import React, { useEffect, useRef } from "react";
import radioEngine from "@/lib/radioEngine";

/**
 * HoloBrand — Visual centrale.
 *
 * Il volto robot R-A.I. è al centro (identico al logo header) e si accende
 * a ritmo di musica come un logo olografico da canale YouTube:
 *   • BASSI  → glow ARANCIONE che pulsa sul cerchio (aura esterna) e sulla
 *              bocca-waveform (radial gradient bottom-center).
 *   • MEDI/ALTI → glow BLU NEON sull'intero volto (drop-shadow ciano) +
 *              scintilla sulle lettere-occhi e antenna.
 *
 * Sotto il logo, integrato allo stesso stile, un piccolo pannello
 * "Now Playing" con kind · DJ · titolo · artista.
 */
export default function HoloBrand({ isPlaying = false, current = null, trackOverlay = null }) {
  const faceRef = useRef(null);
  const warmMouthRef = useRef(null);
  const warmRingRef = useRef(null);
  const infoRef = useRef(null);
  const rafRef = useRef(null);
  const state = useRef({ bass: 0, midHigh: 0, phase: 0 });

  useEffect(() => {
    const tick = () => {
      const analyser = radioEngine.getAnalyser();
      const binCount = analyser ? analyser.frequencyBinCount : 128;
      const freq = new Uint8Array(binCount);
      if (analyser) analyser.getByteFrequencyData(freq);

      state.current.phase += 0.02;
      const t = state.current.phase;
      const idle = 0.5 + 0.5 * Math.sin(t * 1.3);

      // Estrazione bassi / medi-alti
      let bassSum = 0, bassN = 0;
      let mhSum = 0, mhN = 0;
      if (analyser) {
        const bEnd = Math.min(14, binCount);
        for (let i = 2; i < bEnd; i++) { bassSum += freq[i]; bassN++; }
        const mEnd = Math.min(110, binCount);
        for (let i = 18; i < mEnd; i++) { mhSum += freq[i]; mhN++; }
      }
      const bassRaw = analyser && bassN > 0 ? Math.min(1, (bassSum / bassN / 255) * 1.8) : 0;
      const mhRaw   = analyser && mhN   > 0 ? Math.min(1, (mhSum   / mhN   / 255) * 1.6) : 0;
      // Smoothing (attack fast, decay meno aggressivo così i picchi restano visibili)
      state.current.bass    = Math.max(state.current.bass    * 0.90, bassRaw);
      state.current.midHigh = Math.max(state.current.midHigh * 0.92, mhRaw);
      // Decay più lento per un pulse più leggibile
      state.current.bass    *= 0.995;
      state.current.midHigh *= 0.995;

      const bass = state.current.bass;
      const midHigh = state.current.midHigh;

      // Idle breath quando analyser è assente (radio ferma)
      const idleBass = analyser ? 0 : (isPlaying ? idle * 0.35 : idle * 0.12);
      const idleMh   = analyser ? 0 : (isPlaying ? idle * 0.30 : idle * 0.10);
      const B = Math.min(1, bass + idleBass);
      const M = Math.min(1, midHigh + idleMh);

      // === Warm mouth glow (bassi) === (max opa alzata da 0.95 a 1.15 forte)
      if (warmMouthRef.current) {
        const op = 0.12 + B * 1.05;
        const scale = 1 + B * 0.35;
        warmMouthRef.current.style.opacity = Math.min(1.15, op).toFixed(3);
        warmMouthRef.current.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;
      }
      // === Warm ring glow (bassi) ===
      if (warmRingRef.current) {
        const op = 0.10 + B * 0.90;
        const scale = 1 + B * 0.14;
        warmRingRef.current.style.opacity = Math.min(1, op).toFixed(3);
        warmRingRef.current.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;
      }
      // === Face principale (medi/alti = blu pulse marcato; bassi = scale) ===
      if (faceRef.current) {
        const scale = 1 + B * 0.06 + M * 0.05;
        const blueGlow = 10 + M * 60;
        const blueAlpha = 0.4 + M * 0.9;
        const bright = 0.95 + M * 0.55 + B * 0.10;
        faceRef.current.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;
        faceRef.current.style.filter =
          `drop-shadow(0 0 ${blueGlow.toFixed(1)}px rgba(0,229,255,${Math.min(1, blueAlpha).toFixed(2)})) ` +
          `drop-shadow(0 0 ${(blueGlow*2.5).toFixed(1)}px rgba(0,191,255,${Math.min(1, blueAlpha*0.5).toFixed(2)})) ` +
          `brightness(${bright.toFixed(2)})`;
      }
      // === Info panel float ===
      if (infoRef.current) {
        const y = Math.sin(t * 0.8) * 1.5 + B * 3;
        infoRef.current.style.transform = `translateY(${y.toFixed(1)}px)`;
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying]);

  // Estrai metadati brano corrente
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
      {/* Griglia radiale + scanline di fondo (rimane come "sfera luminosa") */}
      <div className="holo-scan" aria-hidden />

      {/* Warm ring — glow arancione ESTERNO al cerchio del volto (bassi) */}
      <div ref={warmRingRef} className="holo-warm-ring" aria-hidden />
      {/* Warm mouth — glow arancione sulla BOCCA-waveform (bassi) */}
      <div ref={warmMouthRef} className="holo-warm-mouth" aria-hidden />

      {/* IL LOGO ROBOT — identico all'header */}
      <img
        ref={faceRef}
        src="/rai-face.png"
        alt="R-A.I."
        className="holo-face"
        data-testid="holo-face"
      />

      {/* Badge ON AIR / STAND-BY in alto a sinistra */}
      <div className="holo-onair" aria-hidden>
        <span className="live-dot" style={{ background: isPlaying ? "#FF6B1A" : "#00BFFF", boxShadow: `0 0 12px ${isPlaying ? "#FF6B1A" : "#00BFFF"}` }} />
        <span className="holo-onair-label" style={{ color: isPlaying ? "#FF8A3D" : "#00E5FF" }}>
          {isPlaying ? "ON AIR" : "STAND-BY"}
        </span>
      </div>

      {/* Now Playing — integrato sotto il logo, minimalista */}
      <div ref={infoRef} className="holo-info-compact" data-testid="holo-info">
        <div className="holo-info-kind">
          <span>◂</span>
          <span>{kindLabel}</span>
          {djName && <><span className="opacity-50">·</span><span>{djName}</span></>}
          <span>▸</span>
        </div>
        <div className="holo-info-title" data-testid="holo-title">
          {trackTitle || (isPlaying ? "…" : "R-A.I. WEB RADIO")}
        </div>
        {trackArtist && (
          <div className="holo-info-artist">{trackArtist}</div>
        )}
      </div>
    </div>
  );
}
