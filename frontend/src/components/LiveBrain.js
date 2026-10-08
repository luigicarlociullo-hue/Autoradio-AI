import React, { useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { endpoints } from "@/lib/api";

/**
 * LiveBrain — terminale verde: mostra SOLO dati reali (elemento in onda + stato dei servizi
 * verificato dal backend, /api/live-brain/services). Massimo 8 righe, refresh servizi ogni 15s.
 */
export default function LiveBrain({ current }) {
  const [lines, setLines] = useState(["▸ live brain: verifica servizi…"]);

  const pushLine = (m) => {
    const t = new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLines(prev => [...prev, `[${t}] ${m}`].slice(-8));
  };

  // Solo fatti reali: cosa e' davvero in onda (dal clock del server)...
  useEffect(() => {
    if (!current?.id) return;
    const kind = (current.kind || "track").toUpperCase();
    const who = current.dj_name ? ` · ${current.dj_name}` : "";
    pushLine(`ON AIR [${kind}] ${(current.title || "").slice(0, 40)}${who}`);
  }, [current?.id]);

  // ...e lo stato dei servizi veri, verificato dal backend a ogni giro (nessun testo decorativo).
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const { services = [] } = await endpoints.liveBrainServices();
        if (!alive) return;
        services.forEach(sv => pushLine(`${sv.ok ? "OK  " : "FAIL"} ${sv.name} · ${sv.detail}${sv.ms ? ` (${sv.ms}ms)` : ""}`));
      } catch {
        if (alive) pushLine("FAIL backend non raggiungibile");
      }
    };
    check();
    const iv = setInterval(check, 15000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  return (
    <div
      data-testid="live-brain"
      className="rounded-lg p-3"
      style={{
        background: "#000",
        border: "1px solid rgba(0,229,255,0.3)",
        boxShadow: "0 0 0 1px rgba(0,229,255,0.1) inset, 0 0 18px rgba(0,229,255,0.15)",
        fontFamily: '"Share Tech Mono","VT323",ui-monospace,monospace',
      }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[10px] uppercase tracking-widest text-cyan-500 flex items-center gap-1.5">
          <Cpu className="w-3 h-3" /> LIVE BRAIN · terminal
        </div>
        <span className="text-[9px] text-cyan-700">v1.0</span>
      </div>
      <div
        className="text-[11px] leading-relaxed"
        style={{
          // Ticket #247410: verde "vecchio monitor" (stesso del vecchio ticker decorativo), su richiesta del cliente
          color: "#39FF14",
          textShadow: "0 0 4px rgba(57,255,20,0.6)",
          minHeight: 128,
        }}
      >
        {lines.map((ln, i) => {
          const isLatest = i === lines.length - 1;
          return (
            <div key={i} className="truncate" style={{ opacity: isLatest ? 1 : 0.55 + (i / lines.length) * 0.35 }}>
              {ln}
              {isLatest && <span className="inline-block w-1.5 h-3 align-middle ml-1 bg-[#39FF14] animate-pulse" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
