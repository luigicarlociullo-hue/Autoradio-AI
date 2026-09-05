import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";
import { Sparkles, RefreshCw } from "lucide-react";

const ZODIAC_ICONS = {
  aries: "♈︎", taurus: "♉︎", gemini: "♊︎", cancer: "♋︎",
  leo: "♌︎", virgo: "♍︎", libra: "♎︎", scorpio: "♏︎",
  sagittarius: "♐︎", capricorn: "♑︎", aquarius: "♒︎", pisces: "♓︎",
};

/**
 * StellePanel — v13.4
 * Regia per visionare e rigenerare i 12 testi giornalieri di "LE STELLE DI NEURONI".
 */
export default function StellePanel() {
  const [signs, setSigns] = useState([]);
  const [date, setDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [busySign, setBusySign] = useState(null);
  const [busyAll, setBusyAll] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/radioscope");
      setSigns(r.data.signs || []);
      setDate(r.data.date || "");
    } catch (e) {
      toast.error("Errore caricamento oroscopo");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const regenAll = async () => {
    if (!window.confirm("Rigenerare TUTTI i 12 segni? Costo: ~12 chiamate Gemini Flash (< 0.02 ECU).")) return;
    setBusyAll(true);
    try {
      await api.post("/admin/radioscope/regenerate", {});
      toast.success("Tutti i 12 segni rigenerati");
      await load();
    } catch (e) {
      toast.error("Errore rigenerazione");
    } finally { setBusyAll(false); }
  };

  const regenSign = async (key) => {
    setBusySign(key);
    try {
      await api.post("/admin/radioscope/regenerate", { sign: key });
      toast.success(`${key} rigenerato`);
      await load();
    } catch (e) {
      toast.error("Errore rigenerazione");
    } finally { setBusySign(null); }
  };

  return (
    <section
      className="lg:col-span-4 rounded-xl p-5"
      data-testid="stelle-admin-panel"
      style={{
        background: "linear-gradient(180deg, rgba(160,60,220,0.08), rgba(10,0,25,0.85))",
        border: "1px solid rgba(200,80,255,0.28)",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="label-mono flex items-center gap-2" style={{ color: "#E5B8FF" }}>
            <Sparkles className="w-3.5 h-3.5" /> LE STELLE DI NEURONI · REGIA
          </div>
          <div className="font-display font-black text-xl text-white mt-1">
            L'oroscopo tech di R-A.I.
          </div>
          <div className="text-[11px] font-mono text-purple-200/60 mt-0.5">
            {date && <>Data: <span className="text-purple-200">{date}</span> · </>}
            Cache Mongo giornaliera · rigenera se le previsioni non ti piacciono.
          </div>
        </div>
        <button
          onClick={regenAll}
          disabled={busyAll}
          data-testid="stelle-regen-all"
          className="px-3 py-1.5 rounded text-xs font-mono font-bold flex items-center gap-1.5 shrink-0"
          style={{
            background: "linear-gradient(90deg, #B34DFF, #FF3EA5)",
            color: "#fff",
            opacity: busyAll ? 0.6 : 1,
          }}
        >
          <RefreshCw className={`w-3 h-3 ${busyAll ? "animate-spin" : ""}`} /> Rigenera tutto
        </button>
      </div>

      {loading ? (
        <div className="text-purple-200/60 text-sm font-mono py-6 text-center">
          Sincronizzazione vibrazioni neurali...
        </div>
      ) : (
        <div className="space-y-1.5">
          {signs.map((s) => (
            <div
              key={s.key}
              className="flex items-start gap-2 p-2 rounded"
              data-testid={`stelle-sign-row-${s.key}`}
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(200,80,255,0.15)",
              }}
            >
              <div
                className="w-9 h-9 rounded flex items-center justify-center shrink-0 text-lg"
                style={{
                  background: "linear-gradient(135deg, rgba(255,20,220,0.2), rgba(0,229,255,0.15))",
                  color: "#D8B4FF",
                  textShadow: "0 0 6px rgba(200,80,255,0.6)",
                }}
              >
                {ZODIAC_ICONS[s.key]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-mono uppercase font-bold text-purple-200">
                  {s.name}
                </div>
                <div className="text-[12px] text-zinc-300 leading-snug">
                  {s.text}
                </div>
              </div>
              <button
                onClick={() => regenSign(s.key)}
                disabled={busySign === s.key}
                data-testid={`stelle-regen-${s.key}`}
                className="px-2 py-1 rounded text-[10px] font-mono shrink-0"
                style={{
                  background: "rgba(200,80,255,0.15)",
                  border: "1px solid rgba(200,80,255,0.35)",
                  color: "#E5B8FF",
                  opacity: busySign === s.key ? 0.5 : 1,
                }}
                title={`Rigenera ${s.name}`}
              >
                {busySign === s.key ? "…" : "↻"}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
