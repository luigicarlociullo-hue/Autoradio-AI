import React, { useEffect, useState } from "react";
import { api, endpoints } from "../lib/api";
import { toast } from "sonner";
import { Shield, Zap } from "lucide-react";

/**
 * AIMasterControlPanel — v13.7
 * 7 interruttori indipendenti per il controllo totale di costi e contenuti.
 * Tutti default OFF ad ogni startup del backend (safety-first).
 */
export default function AIMasterControlPanel() {
  const [controls, setControls] = useState({});
  // v13.70 · Dual-Brain (Leo vs Max) — spostato qui da BroadcasterPanel, stessi endpoint/testid
  const [dualBusy, setDualBusy] = useState(false);
  const [dualSubject, setDualSubject] = useState("");
  const [dualResult, setDualResult] = useState(null);
  const [labels, setLabels] = useState({});
  const [descs, setDescs] = useState({});
  const [busyKey, setBusyKey] = useState(null);
  const [meta, setMeta] = useState({ updated_at: null, tts_voice_error: null });

  const load = async () => {
    try {
      const r = await api.get("/admin/ai-controls");
      setControls(r.data.controls || {});
      setLabels(r.data.labels || {});
      setDescs(r.data.descriptions || {});
      setMeta({ updated_at: r.data.updated_at || null, tts_voice_error: r.data.tts_voice_error || null, tts_route: r.data.tts_route || null, fm_mode: !!r.data.fm_mode });
    } catch (e) { toast.error("Errore caricamento AI controls"); }
  };
  useEffect(() => { load(); const iv = setInterval(load, 6000); return () => clearInterval(iv); }, []);

  const toggle = async (key) => {
    const next = !controls[key];
    setBusyKey(key);
    try {
      // v13.38 · read-back: lo stato mostrato è quello RILETTO da Mongo, non quello ottimistico
      const r = await api.patch("/admin/ai-controls", { [key]: next });
      const persisted = r.data?.controls || {};
      setControls(persisted);
      if (!!persisted[key] !== next) toast.error(`${labels[key] || key}: NON persistito (DB dice ${persisted[key] ? "ON" : "OFF"})`);
      else toast.success(`${labels[key] || key}: ${next ? "ON" : "OFF"} · salvato`);
    } catch (e) { toast.error("Errore"); }
    finally { setBusyKey(null); }
  };

  const order = [
    "ai_suno_engine", "ai_openai_talk", "ai_claude_brain",
    "ai_voice_to_air", "ai_atmospheric_fx", "ai_advertising", "ai_human_priority",
  ];
  const activeCount = order.filter((k) => controls[k]).length;

  const genDualBrain = async () => {
    if (!dualSubject.trim()) { toast.error("Inserisci un soggetto"); return; }
    setDualBusy(true); setDualResult(null);
    try {
      const r = await endpoints.dualBrainGenerate(dualSubject.trim());
      setDualResult(r);
      toast.success("Dual-Brain generato");
    } catch (e) {
      const msg = e?.response?.data?.detail || "Errore generazione";
      toast.error(msg);
    } finally { setDualBusy(false); }
  };

  const injectDual = async () => {
    if (!dualResult) return;
    try {
      await endpoints.dualBrainInject(dualResult);
      toast.success("Dual-Brain iniettato nella priority queue");
      setDualResult(null); setDualSubject("");
    } catch { toast.error("Errore injection"); }
  };

  return (
    <section
      className="lg:col-span-4 rounded-xl p-5 relative"
      data-testid="ai-master-control-panel"
      style={{
        background: activeCount > 0
          ? "linear-gradient(180deg, rgba(255,107,26,0.10), rgba(10,0,20,0.9))"
          : "linear-gradient(180deg, rgba(0,229,255,0.05), rgba(0,10,20,0.85))",
        border: `1px solid ${activeCount > 0 ? "rgba(255,107,26,0.45)" : "rgba(0,229,255,0.28)"}`,
        boxShadow: activeCount > 0 ? "0 0 24px rgba(255,107,26,0.28)" : "0 0 16px rgba(0,229,255,0.1)",
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="min-w-0">
          <div className="label-mono flex items-center gap-2" style={{ color: activeCount > 0 ? "#FF8A3D" : "#00E5FF" }}>
            <Shield className="w-3.5 h-3.5" /> AI MASTER CONTROL
          </div>
          <div
            className="font-display font-black text-xl sm:text-2xl mt-1"
            style={{
              color: activeCount > 0 ? "#FFB27A" : "#B8F1FF",
              textShadow: activeCount > 0 ? "0 0 10px rgba(255,107,26,0.6)" : "0 0 8px rgba(0,229,255,0.35)",
            }}
          >
            {activeCount === 0 ? "TUTTI OFF · Costi Zero" : `${activeCount}/7 ATTIVI`}
          </div>
          <div className="text-[11px] font-mono text-zinc-400 mt-0.5 max-w-2xl">
            Interruttori indipendenti, <b>persistiti su Mongo</b> (sopravvivono a restart/deploy). Ogni chiamata LLM/TTS/upload consulta questi stati.
            {meta.updated_at && <span data-testid="ai-controls-updated-at"> · ultimo salvataggio {new Date(meta.updated_at).toLocaleString()}</span>}
            {meta.tts_route && (
              <span data-testid="ai-controls-tts-route"> · voce DJ via <b style={{ color: meta.fm_mode ? "#80FFB4" : "#FFB84D" }}>{meta.fm_mode ? "ElevenLabs (FM MODE ON)" : "OpenAI TTS (FM MODE OFF · i Voice ID ElevenLabs NON sono usati)"}</b></span>
            )}
          </div>
          {meta.tts_voice_error && (
            <div className="mt-2 rounded p-2 text-[11px] font-mono" data-testid="tts-voice-error-banner"
              style={{ background: "rgba(255,45,149,0.10)", border: "1px solid rgba(255,45,149,0.55)", color: "#FF6BAA" }}>
              ❌ ElevenLabs ha RIFIUTATO la voce <b>{meta.tts_voice_error.voice_id}</b> ({meta.tts_voice_error.voice_key}) · {meta.tts_voice_error.code} · {new Date(meta.tts_voice_error.at).toLocaleString()}. Nessun audio generato con voce sostitutiva: correggi il Voice ID del DJ.
            </div>
          )}
        </div>
        <Zap className="w-6 h-6 shrink-0" style={{ color: activeCount > 0 ? "#FF8A3D" : "#00E5FF88" }} />
      </div>

      <div className="space-y-1.5">
        {order.map((k) => {
          const on = !!controls[k];
          const busy = busyKey === k;
          return (
            <div
              key={k}
              className="flex items-center gap-3 p-2 rounded"
              data-testid={`ai-control-row-${k}`}
              style={{
                background: on ? "rgba(255,107,26,0.10)" : "rgba(255,255,255,0.02)",
                border: `1px solid ${on ? "rgba(255,107,26,0.45)" : "rgba(255,255,255,0.06)"}`,
              }}
            >
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-mono font-bold" style={{ color: on ? "#FFB27A" : "#e4e4e7" }}>
                  {labels[k] || k}
                </div>
                <div className="text-[10px] text-zinc-400 leading-tight">
                  {descs[k] || ""}
                </div>
              </div>
              <button
                onClick={() => toggle(k)}
                disabled={busy}
                data-testid={`ai-control-toggle-${k}`}
                aria-pressed={on}
                className="relative w-12 h-6 rounded-full shrink-0 transition-all"
                style={{
                  background: on
                    ? "linear-gradient(90deg, #FF6B1A, #FFB27A)"
                    : "linear-gradient(90deg, #1a2030, #0f1420)",
                  border: `1px solid ${on ? "rgba(255,107,26,0.8)" : "rgba(0,229,255,0.3)"}`,
                  opacity: busy ? 0.6 : 1,
                  boxShadow: on ? "0 0 8px rgba(255,107,26,0.55)" : "inset 0 0 4px rgba(0,0,0,0.4)",
                }}
                title={on ? "Disattiva" : "Attiva"}
              >
                <span
                  className="absolute top-0.5 w-5 h-5 rounded-full transition-all"
                  style={{
                    left: on ? "calc(100% - 1.375rem)" : "0.125rem",
                    background: on ? "#fff" : "#00E5FF",
                    boxShadow: on ? "0 0 6px rgba(255,255,255,0.9)" : "0 0 5px rgba(0,229,255,0.6)",
                  }}
                />
              </button>
            </div>
          );
        })}
      </div>
      {/* Dual-Brain */}
      <div className="pt-3 border-t border-white/8">
        <div className="label-mono mb-1 flex items-center gap-1">
          <Zap className="w-3 h-3" style={{ color: "#FF6BAA" }} /> DUAL-BRAIN · Scontro Leo vs Max
        </div>
        <div className="text-[10px] text-zinc-500 font-mono mb-2">
          Genera un dialogo 30s Leo (difesa) vs Max (accusa). Solo FM MODE ON.
        </div>
        <div className="flex gap-2 items-center">
          <input
            value={dualSubject}
            onChange={(e) => setDualSubject(e.target.value)}
            placeholder="Es. Il nuovo brano 'Neon Genesis' del listener Marco"
            className="flex-1 bg-black border border-white/10 rounded px-2 py-1.5 text-xs text-white"
            data-testid="dual-brain-subject"
          />
          <button
            onClick={genDualBrain}
            disabled={dualBusy || !dualSubject.trim()}
            className="px-3 py-1.5 rounded text-xs font-bold text-black"
            style={{ background: "#FF6BAA" }}
            data-testid="dual-brain-generate"
          >{dualBusy ? "Genero…" : "Genera"}</button>
        </div>

        {dualResult && (
          <div className="mt-3 rounded p-2 bg-black/60 border border-pink-500/30 space-y-2" data-testid="dual-brain-result">
            <div>
              <div className="text-[10px] font-mono uppercase text-cyan-300 mb-0.5">LEO (difende)</div>
              <div className="text-[11px] text-zinc-200 leading-relaxed">{dualResult.leo?.script}</div>
              {dualResult.leo?.tts_url && <audio controls src={dualResult.leo.tts_url} className="w-full mt-1" data-testid="dual-brain-leo-audio" />}
            </div>
            <div>
              <div className="text-[10px] font-mono uppercase text-pink-300 mb-0.5">MAX (attacca)</div>
              <div className="text-[11px] text-zinc-200 leading-relaxed">{dualResult.max?.script}</div>
              {dualResult.max?.tts_url && <audio controls src={dualResult.max.tts_url} className="w-full mt-1" data-testid="dual-brain-max-audio" />}
            </div>
            <button
              onClick={injectDual}
              className="w-full px-3 py-1.5 rounded text-xs font-bold bg-pink-500 text-white"
              data-testid="dual-brain-inject"
            >Inietta in Priority Queue</button>
          </div>
        )}
      </div>
    </section>
  );
}
