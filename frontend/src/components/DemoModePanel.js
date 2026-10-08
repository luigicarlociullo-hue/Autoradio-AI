import React, { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";
import { FlaskConical, Mic2 } from "lucide-react";

/* v13.53 · MODALITÀ DEMO — riusa vocali DJ già esistenti tra i brani.
   Zero LLM / TTS / API esterne. Separato dall'AI Master Control. */
const AMBER = "#FFB84D";

export default function DemoModePanel() {
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [minV, setMinV] = useState(2);
  const [maxV, setMaxV] = useState(3);

  const load = useCallback(() => api.get("/admin/demo-mode").then((r) => {
    setCfg(r.data); setMinV(r.data.demo_every_min); setMaxV(r.data.demo_every_max);
  }).catch(() => {}), []);
  useEffect(() => { load(); const iv = setInterval(load, 20000); return () => clearInterval(iv); }, [load]);

  const save = async (patch, ok) => {
    setBusy(true);
    try { const r = await api.put("/admin/demo-mode", patch); setCfg(r.data); setMinV(r.data.demo_every_min); setMaxV(r.data.demo_every_max); if (ok) toast.success(ok); }
    catch (e) { toast.error(e?.response?.data?.detail || "Errore"); }
    finally { setBusy(false); }
  };
  const on = !!cfg?.demo_mode;
  const dirty = cfg && (Number(minV) !== cfg.demo_every_min || Number(maxV) !== cfg.demo_every_max);

  return (
    <section data-testid="demo-mode-panel" className="lg:col-span-4 rounded-xl p-4 flex flex-wrap items-center gap-x-6 gap-y-3"
      style={{ background: on ? "rgba(255,184,77,0.08)" : "rgba(255,255,255,0.03)", border: `1px solid ${on ? "rgba(255,184,77,0.6)" : "rgba(255,255,255,0.12)"}`, boxShadow: on ? "0 0 18px rgba(255,184,77,0.18)" : "none" }}>
      <button type="button" onClick={() => save({ demo_mode: !on }, !on ? "MODALITÀ DEMO attiva · vocali esistenti in rotazione" : "MODALITÀ DEMO spenta · tutto come impostato dal Direttore")}
        disabled={busy || !cfg} data-testid="demo-mode-toggle" className="flex items-center gap-3 select-none" title={on ? "Spegni la modalità demo" : "Accendi la modalità demo"}>
        <span className="relative inline-block w-16 h-8 rounded-full transition-colors duration-200"
          style={{ background: on ? AMBER : "#3f3f46", boxShadow: on ? `0 0 14px ${AMBER}99` : "none", opacity: busy ? 0.6 : 1 }}>
          <span className="absolute top-1 w-6 h-6 rounded-full bg-white transition-all duration-200" style={{ left: on ? 36 : 4 }} />
        </span>
        <span className="font-mono text-sm font-black w-9" style={{ color: on ? AMBER : "#a1a1aa" }} data-testid="demo-mode-state">{on ? "ON" : "OFF"}</span>
      </button>

      <div className="min-w-[220px]">
        <div className="label-mono flex items-center gap-2" style={{ color: on ? AMBER : "#d4d4d8" }}><FlaskConical className="w-4 h-4" /> MODALITÀ DEMO — Usa vocali esistenti</div>
        <div className="text-[11px] font-mono text-zinc-400 mt-0.5 flex items-center gap-1" data-testid="demo-mode-info">
          <Mic2 className="w-3 h-3" /> {cfg ? `${cfg.voices_available} vocali DJ già pronti` : "…"} · zero AI · zero ECU
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs font-mono text-zinc-300" data-testid="demo-mode-frequency">
        <span>un vocale ogni</span>
        <input type="number" min={1} max={20} value={minV} onChange={(e) => setMinV(e.target.value)} disabled={busy} data-testid="demo-mode-min"
          className="w-12 bg-black/60 border border-white/10 rounded px-1 py-1 text-center text-white" />
        <span>–</span>
        <input type="number" min={1} max={20} value={maxV} onChange={(e) => setMaxV(e.target.value)} disabled={busy} data-testid="demo-mode-max"
          className="w-12 bg-black/60 border border-white/10 rounded px-1 py-1 text-center text-white" />
        <span>brani</span>
        {dirty && (
          <button type="button" onClick={() => save({ demo_every_min: Number(minV), demo_every_max: Number(maxV) }, "Frequenza demo salvata")} disabled={busy} data-testid="demo-mode-save-freq"
            className="px-2 py-1 rounded text-[10px] font-bold text-black" style={{ background: AMBER }}>SALVA</button>
        )}
      </div>

      <div className="text-[10px] font-mono text-zinc-500 basis-full">
        ON: tra i brani entra un intervento DJ pescato a caso dai vocali già sintetizzati. OFF: nessun effetto — interruttori AI, jingle, segnali orari e player restano come impostati.
      </div>
    </section>
  );
}
