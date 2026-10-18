import React, { useEffect, useState } from "react";
import { endpoints } from "@/lib/api";
import { toast } from "sonner";
import { Radio } from "lucide-react";

/**
 * BroadcasterPanel — v13.3
 * Contiene:
 *  • HLS Stream URL (link universale in-pod)
 *  • External Streaming Server (Icecast) — opzionale
 *  • (Dual-Brain spostato in AIMasterControlPanel · v13.70)
 */
export default function BroadcasterPanel() {
  const [hlsUrl, setHlsUrl] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [savingExt, setSavingExt] = useState(false);

  useEffect(() => {
    setHlsUrl(`${window.location.origin}/api/stream/live.m3u8`);
    (async () => {
      try {
        const r = await endpoints.externalStreamGet();
        setExternalUrl(r.external_stream_url || "");
      } catch {}
    })();
  }, []);

  const saveExternal = async () => {
    setSavingExt(true);
    try {
      await endpoints.externalStreamSet(externalUrl.trim());
      toast.success(externalUrl.trim() ? "Streaming esterno attivato" : "Streaming esterno rimosso (default HLS interno)");
    } catch (e) {
      const msg = e?.response?.data?.detail || "Errore salvataggio";
      toast.error(msg);
    } finally { setSavingExt(false); }
  };

  return (
    <section
      className="lg:col-span-4 rounded-xl p-5"
      data-testid="broadcaster-panel"
      style={{
        background: "linear-gradient(180deg, rgba(0,229,255,0.05), rgba(0,10,20,0.85))",
        border: "1px solid rgba(0,229,255,0.28)",
      }}
    >
      <div className="flex items-center gap-2 mb-4">
        <Radio className="w-4 h-4" style={{ color: "#00E5FF" }} />
        <div className="label-mono" style={{ color: "#00E5FF" }}>BROADCASTER · STREAMING</div>
      </div>

      {/* HLS interno */}
      <div className="mb-4">
        <div className="label-mono mb-1">🎧 HLS Stream (in-pod, default)</div>
        <div className="flex gap-2 items-center">
          <input
            readOnly value={hlsUrl}
            className="flex-1 bg-black border border-white/10 rounded px-2 py-1.5 text-xs text-cyan-300 font-mono"
            data-testid="hls-stream-url"
            onClick={(e) => e.target.select()}
          />
          <button
            className="px-3 py-1.5 rounded text-xs font-mono bg-cyan-500/20 border border-cyan-500/50 text-cyan-300 hover:bg-cyan-500/30"
            onClick={() => { navigator.clipboard.writeText(hlsUrl); toast.success("URL copiato"); }}
            data-testid="hls-copy"
          >Copia</button>
        </div>
        <div className="text-[10px] text-zinc-500 font-mono mt-1">
          Universale · VLC, Safari, hls.js. Latenza ≈ durata di un brano.
        </div>
      </div>

      {/* External Icecast */}
      <div className="mb-4 pt-3 border-t border-white/8">
        <div className="label-mono mb-1">🌐 External Streaming Server (Icecast)</div>
        <div className="flex gap-2 items-center">
          <input
            value={externalUrl}
            onChange={(e) => setExternalUrl(e.target.value)}
            placeholder="https://icecast.miodominio.com:8000/rai.mp3"
            className="flex-1 bg-black border border-white/10 rounded px-2 py-1.5 text-xs text-white font-mono"
            data-testid="external-stream-url"
          />
          <button
            disabled={savingExt}
            onClick={saveExternal}
            className="px-3 py-1.5 rounded text-xs font-bold bg-cyan-400 text-black hover:bg-cyan-300"
            data-testid="external-stream-save"
          >{savingExt ? "…" : "Salva"}</button>
        </div>
        <div className="text-[10px] text-zinc-500 font-mono mt-1">
          Vuoto = usa HLS interno. Con URL → gli ascoltatori sono redirezionati automaticamente.
        </div>
      </div>

      {/* Dual-Brain (Leo vs Max) spostato in AIMasterControlPanel · v13.70 */}
    </section>
  );
}
