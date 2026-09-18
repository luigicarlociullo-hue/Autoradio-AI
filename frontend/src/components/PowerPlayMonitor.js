import React, { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Disc3, RefreshCw, Sparkles, Users, Clock3 } from "lucide-react";

/**
 * PowerPlayMonitor — Monitor "Disco del Giorno".
 *
 * Mostra il brano scelto/generato per la giornata corrente + pulsante Veto
 * ("RIGENERA DISCO") che sostituisce istantaneamente la scelta AI se non è
 * gradita al Direttore. L'alternanza 1:1 (Human vs Algoritmo) è gestita
 * server-side (`pp_counter` in station.state) → il player NON deve fare
 * nulla, riceve la lista dal clock già intercalata.
 */
export default function PowerPlayMonitor() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [regenBusy, setRegenBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/power-play/today");
      setData(data);
    } catch (e) {
      // Silenzioso: potrebbe essere pre-05:00 o libreria vuota
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 60000);
    return () => clearInterval(iv);
  }, [load]);

  const regenerate = async () => {
    if (regenBusy) return;
    if (!window.confirm("Rigenerare il Disco del Giorno? Il brano attuale verrà sostituito.")) return;
    setRegenBusy(true);
    try {
      const { data: res } = await api.post("/admin/power-play/regenerate");
      toast.success(`Disco rigenerato · veti totali: ${res.vetoed_count}`);
      await load();
    } catch (e) {
      const msg = e?.response?.data?.detail || e?.message || "Errore rigenerazione";
      toast.error(msg);
    } finally {
      setRegenBusy(false);
    }
  };

  const pp = data?.power_play;
  const tr = data?.track;
  const isAi = pp?.source === "ai_suno";
  const pending = tr && tr.status !== "ready";
  const rotationLabel = data?.rotation_every ? `1 ogni ${data.rotation_every}` : "1:1";

  return (
    <section
      data-testid="power-play-monitor"
      className="lg:col-span-2 card-surface p-6 flex flex-col gap-4"
      style={{ borderColor: "rgba(255, 138, 61, 0.25)" }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Disc3 className="w-5 h-5" style={{ color: "#FF8A3D" }} />
          <div>
            <div className="label-mono" style={{ color: "#FF8A3D" }}>DISCO DEL GIORNO</div>
            <div className="text-xs text-zinc-500">Alternanza {rotationLabel} · human ↔ algoritmo</div>
          </div>
        </div>
        <button
          data-testid="power-play-regenerate"
          onClick={regenerate}
          disabled={regenBusy || loading}
          className="btn-outline text-xs flex items-center gap-1.5"
          title="Sostituisce il brano AI di oggi con uno nuovo (Suno o library)"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${regenBusy ? "animate-spin" : ""}`} />
          {regenBusy ? "Rigenero…" : "RIGENERA"}
        </button>
      </div>

      {loading && (
        <div className="text-sm text-zinc-500 italic">Carico Power Play…</div>
      )}

      {!loading && !pp && (
        <div className="text-sm text-zinc-500 italic">
          Nessun Disco del Giorno attivo. Verrà creato automaticamente dopo le 05:00 (Europe/Rome).
        </div>
      )}

      {!loading && pp && tr && (
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span
              data-testid="power-play-source-badge"
              className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full font-bold"
              style={{
                background: isAi ? "rgba(255,138,61,0.15)" : "rgba(160,240,120,0.15)",
                color: isAi ? "#FF8A3D" : "#A0F078",
                border: `1px solid ${isAi ? "rgba(255,138,61,0.35)" : "rgba(160,240,120,0.35)"}`,
              }}
            >
              {isAi ? (
                <span className="inline-flex items-center gap-1"><Sparkles className="w-2.5 h-2.5" /> AI · SUNO</span>
              ) : (
                <span className="inline-flex items-center gap-1"><Users className="w-2.5 h-2.5" /> LIBRARY</span>
              )}
            </span>
            {pending && (
              <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full font-bold"
                    style={{ background: "rgba(200,200,80,0.12)", color: "#FFDE59", border: "1px solid rgba(255,222,89,0.3)" }}>
                <span className="inline-flex items-center gap-1"><Clock3 className="w-2.5 h-2.5" /> IN GENERAZIONE</span>
              </span>
            )}
            {pp.vetoed_count > 0 && (
              <span className="text-[10px] text-zinc-500">Veti oggi: <b className="text-zinc-300">{pp.vetoed_count}</b></span>
            )}
          </div>

          <div>
            <div data-testid="power-play-title" className="font-display font-black text-2xl leading-tight">
              {tr.title || "—"}
            </div>
            <div data-testid="power-play-artist" className="text-zinc-400 text-sm mt-0.5">
              {tr.artist || "—"}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 text-xs">
            <div>
              <div className="label-mono text-[10px] mb-0.5">Durata</div>
              <div className="text-zinc-200">{tr.duration_sec ? `${Math.round(tr.duration_sec)}s` : "—"}</div>
            </div>
            <div>
              <div className="label-mono text-[10px] mb-0.5">BPM</div>
              <div className="text-zinc-200">{tr.bpm || "—"}</div>
            </div>
            <div>
              <div className="label-mono text-[10px] mb-0.5">Data</div>
              <div className="text-zinc-200">{data.date}</div>
            </div>
          </div>

          {pp.prompt && (
            <div className="text-[11px] text-zinc-500 italic border-t border-white/5 pt-2">
              <span className="label-mono text-[9px] mr-1">MOOD:</span>{pp.prompt}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
