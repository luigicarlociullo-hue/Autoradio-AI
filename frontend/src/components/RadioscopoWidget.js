import React, { useEffect, useState } from "react";
import { api } from "../lib/api";

const ZODIAC_ICONS = {
  aries: "♈︎", taurus: "♉︎", gemini: "♊︎", cancer: "♋︎",
  leo: "♌︎", virgo: "♍︎", libra: "♎︎", scorpio: "♏︎",
  sagittarius: "♐︎", capricorn: "♑︎", aquarius: "♒︎", pisces: "♓︎",
};

/**
 * RadioscopoWidget — v13.2
 * Griglia 12 segni con hover neon; click apre la previsione del giorno.
 * Cache backend giornaliera → costo ~0 dopo la prima apertura.
 */
export default function RadioscopoWidget() {
  const [signs, setSigns] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.get("/radioscope");
        if (!alive) return;
        setSigns(r.data.signs || []);
      } catch (e) {
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (loading || signs.length === 0) {
    return (
      <div
        className="rounded-xl p-4 border font-mono text-[11px]"
        style={{
          background: "linear-gradient(180deg, rgba(20,0,40,0.7), rgba(0,10,25,0.85))",
          borderColor: "rgba(200,80,255,0.28)",
          color: "#B8A6FF",
        }}
        data-testid="radioscope-loading"
      >
        Sincronizzazione vibrazioni neurali...
      </div>
    );
  }

  return (
    <section
      className="rounded-xl p-4 border relative overflow-hidden"
      data-testid="radioscope-widget"
      style={{
        background: "linear-gradient(160deg, rgba(30,0,60,0.85), rgba(0,10,30,0.9))",
        borderColor: "rgba(200,80,255,0.35)",
        boxShadow: "0 0 24px rgba(160,0,220,0.25), inset 0 0 30px rgba(80,0,120,0.35)",
      }}
    >
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-30"
        style={{
          background: "radial-gradient(circle at 20% 10%, rgba(255,0,180,0.15), transparent 40%), radial-gradient(circle at 80% 90%, rgba(0,229,255,0.12), transparent 45%)",
        }}
      />
      <div className="relative flex items-center justify-between mb-3">
        <div
          className="font-display font-black text-xl tracking-wider"
          style={{
            color: "#E5B8FF",
            textShadow: "0 0 10px rgba(200,80,255,0.7)",
          }}
        >
          IL RADIOSCOPO
        </div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-purple-300/60">
          Frequenze cosmiche · {new Date().toLocaleDateString("it-IT")}
        </div>
      </div>

      <div className="relative grid grid-cols-6 md:grid-cols-12 gap-1.5 mb-3">
        {signs.map((s) => {
          const active = selected?.key === s.key;
          return (
            <button
              key={s.key}
              onClick={() => { setSelected(s); setExpanded(true); }}
              data-testid={`radioscope-sign-${s.key}`}
              title={s.name}
              className="aspect-square rounded-lg flex flex-col items-center justify-center transition-all hover:scale-110"
              style={{
                background: active
                  ? "linear-gradient(135deg, rgba(255,20,220,0.35), rgba(0,229,255,0.25))"
                  : "rgba(255,255,255,0.03)",
                border: `1px solid ${active ? "rgba(255,20,220,0.8)" : "rgba(200,80,255,0.2)"}`,
                boxShadow: active ? "0 0 14px rgba(255,20,220,0.5)" : "none",
              }}
            >
              <span
                className="text-lg"
                style={{
                  color: active ? "#fff" : "#D8B4FF",
                  textShadow: active ? "0 0 8px rgba(255,255,255,0.9)" : "0 0 4px rgba(200,80,255,0.5)",
                }}
              >
                {ZODIAC_ICONS[s.key] || "★"}
              </span>
              <span className="text-[8px] font-mono uppercase mt-0.5 text-purple-200/60">
                {s.name.slice(0, 4)}
              </span>
            </button>
          );
        })}
      </div>

      {selected && expanded && (
        <div
          className="relative rounded-lg p-3 text-sm leading-relaxed"
          data-testid="radioscope-prediction"
          style={{
            background: "rgba(10,0,20,0.85)",
            border: "1px solid rgba(255,20,220,0.4)",
            color: "#F0E8FF",
            boxShadow: "inset 0 0 12px rgba(200,80,255,0.15)",
          }}
        >
          <div
            className="text-xs font-mono uppercase tracking-widest mb-1"
            style={{ color: "#FF7ACC" }}
          >
            {ZODIAC_ICONS[selected.key]} {selected.name}
          </div>
          <p>{selected.text}</p>
          <button
            onClick={() => setExpanded(false)}
            className="absolute top-2 right-2 text-purple-300/60 hover:text-white text-xs"
            data-testid="radioscope-close"
          >
            ✕
          </button>
        </div>
      )}
    </section>
  );
}
