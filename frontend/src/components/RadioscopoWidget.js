import React, { useEffect, useState } from "react";
import { api } from "../lib/api";

const ZODIAC_ICONS = {
  aries: "♈︎", taurus: "♉︎", gemini: "♊︎", cancer: "♋︎",
  leo: "♌︎", virgo: "♍︎", libra: "♎︎", scorpio: "♏︎",
  sagittarius: "♐︎", capricorn: "♑︎", aquarius: "♒︎", pisces: "♓︎",
};

/**
 * StelleStripBar — v13.5
 * "Barretta di spie luminose" incastrata tra Visualizzatore e Team strip.
 * Layout: label sinistra · 12 icone in un'unica riga stretta · data destra.
 * Click su un segno → apre una riga sottile sotto con la previsione del giorno.
 */
export default function RadioscopoWidget() {
  const [signs, setSigns] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.get("/radioscope");
        if (!alive) return;
        setSigns(r.data.signs || []);
      } catch (e) {}
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div
      className="w-full"
      data-testid="stelle-strip-bar"
      style={{
        // Nessun margine nero: si "incastra" alle sezioni sopra/sotto.
        background: "linear-gradient(90deg, rgba(30,0,60,0.55), rgba(0,10,25,0.7) 40%, rgba(0,10,25,0.7) 60%, rgba(30,0,60,0.55))",
        borderTop: "1px solid rgba(200,80,255,0.28)",
        borderBottom: "1px solid rgba(200,80,255,0.28)",
        boxShadow: "inset 0 0 10px rgba(160,0,220,0.15)",
      }}
    >
      <div className="max-w-7xl mx-auto px-3 py-1.5 flex items-center gap-3">
        {/* Label sinistra */}
        <div className="shrink-0 min-w-[112px]">
          <div
            className="font-display font-black text-[11px] tracking-wider leading-none"
            style={{ color: "#E5B8FF", textShadow: "0 0 6px rgba(200,80,255,0.6)" }}
          >
            LE STELLE DI NEURONI
          </div>
          <div className="text-[8px] font-mono uppercase tracking-widest text-purple-300/60 leading-none mt-0.5">
            Oroscopo tech · R-A.I.
          </div>
        </div>

        {/* Barra 12 spie */}
        <div className="flex-1 grid grid-cols-12 gap-0.5">
          {(loading ? new Array(12).fill(null) : signs).map((s, i) => {
            const active = s && selected?.key === s.key;
            const disabled = !s;
            return (
              <button
                key={s?.key || i}
                onClick={() => s && setSelected(selected?.key === s.key ? null : s)}
                disabled={disabled}
                data-testid={s ? `radioscope-sign-${s.key}` : `radioscope-slot-${i}`}
                title={s?.name || ""}
                className="h-7 rounded flex flex-col items-center justify-center transition-all hover:scale-110"
                style={{
                  background: active
                    ? "linear-gradient(180deg, rgba(255,20,220,0.5), rgba(0,229,255,0.35))"
                    : disabled ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${active ? "rgba(255,20,220,0.9)" : "rgba(200,80,255,0.22)"}`,
                  boxShadow: active ? "0 0 8px rgba(255,20,220,0.7)" : "inset 0 0 4px rgba(160,0,220,0.15)",
                }}
              >
                <span
                  className="text-[12px] leading-none"
                  style={{
                    color: active ? "#fff" : "#D8B4FF",
                    textShadow: active ? "0 0 5px rgba(255,255,255,0.9)" : "0 0 2px rgba(200,80,255,0.5)",
                  }}
                >
                  {s ? ZODIAC_ICONS[s.key] || "★" : "·"}
                </span>
              </button>
            );
          })}
        </div>

        {/* Data destra */}
        <div className="shrink-0 text-right text-[9px] font-mono uppercase tracking-widest text-purple-300/60 leading-tight">
          {new Date().toLocaleDateString("it-IT")}
          <div className="text-[8px] text-purple-300/40">Frequenze cosmiche</div>
        </div>
      </div>

      {/* Riga sottile previsione: appare solo su click, dentro la stessa barra */}
      {selected && (
        <div
          className="max-w-7xl mx-auto px-3 pb-2 pt-1 flex items-center gap-2"
          data-testid="radioscope-prediction"
          style={{
            borderTop: "1px dashed rgba(200,80,255,0.2)",
            background: "rgba(10,0,25,0.7)",
          }}
        >
          <span
            className="text-[13px] leading-none"
            style={{ color: "#FF7ACC", textShadow: "0 0 5px rgba(255,20,220,0.6)" }}
          >
            {ZODIAC_ICONS[selected.key]}
          </span>
          <span
            className="text-[9px] font-mono uppercase font-bold shrink-0"
            style={{ color: "#FF7ACC" }}
          >
            {selected.name}
          </span>
          <span className="text-[11px] text-zinc-200 leading-tight flex-1 truncate md:whitespace-normal md:truncate-none">
            {selected.text}
          </span>
          <button
            onClick={() => setSelected(null)}
            className="text-purple-300/60 hover:text-white text-[11px] shrink-0"
            data-testid="radioscope-close"
            aria-label="Chiudi"
          >✕</button>
        </div>
      )}
    </div>
  );
}
