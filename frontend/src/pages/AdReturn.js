import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Radio, PlayCircle, Loader2 } from "lucide-react";
import { api, endpoints } from "@/lib/api";

export default function AdReturn() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("confirming");
  const [campaign, setCampaign] = useState(null);
  const [err, setErr] = useState("");
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;
    const params = new URLSearchParams(window.location.search);
    const campaignId = params.get("campaign_id");
    if (!campaignId) {
      setStatus("error");
      setErr("Manca campaign_id");
      return;
    }
    (async () => {
      try {
        const r = await api.post(`/ads/${campaignId}/confirm`, null, { timeout: 120000 });
        setCampaign(r.data);
        setStatus("ready");
      } catch (e) {
        setErr(e?.response?.data?.detail || "Errore nella conferma");
        setStatus("error");
      }
    })();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "linear-gradient(180deg, #05050A, #0a0a14 60%, #05050A)" }}>
      <div className="max-w-lg w-full card-surface p-8 text-center" data-testid="ad-return-panel">
        {status === "confirming" && (
          <>
            <Loader2 className="w-10 h-10 text-cyan-400 mx-auto animate-spin" />
            <div className="label-mono mt-4">Conferma pagamento</div>
            <div className="font-display font-bold text-2xl mt-2">Stiamo generando il tuo spot…</div>
            <p className="mt-3 text-sm text-zinc-500">GPT / Claude / Gemini stanno scrivendo il copy, Bark presta la voce. Ci vogliono 15–25 secondi.</p>
          </>
        )}
        {status === "ready" && campaign && (
          <>
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
            <div className="label-mono mt-4">Spot attivo</div>
            <div className="font-display font-bold text-2xl mt-2">Il tuo brand è in rotazione</div>
            <div className="mt-6 rounded-lg border border-white/10 bg-[#0F0F14] p-4 text-left">
              <div className="font-mono text-xs text-cyan-400 uppercase tracking-widest">{campaign.brand} · {campaign.tier}</div>
              <div className="mt-2 text-sm text-zinc-300 whitespace-pre-wrap">{campaign.script}</div>
              {campaign.audio_url && (
                <audio controls src={endpoints.audioUrl(campaign.audio_url)} className="mt-3 w-full" data-testid="ad-audio-preview" />
              )}
            </div>
            <div className="mt-6 flex gap-3 justify-center">
              <button onClick={() => navigate("/")} className="btn-primary flex items-center gap-2" data-testid="listen-now-btn">
                <PlayCircle className="w-4 h-4" /> Ascolta la radio
              </button>
              <button onClick={() => navigate("/pubblicita")} className="btn-outline flex items-center gap-2">
                Nuovo spot
              </button>
            </div>
            <div className="mt-4 text-xs font-mono text-zinc-500">
              Passaggi rimanenti: {campaign.plays_remaining} / {campaign.plays_total}
            </div>
          </>
        )}
        {status === "error" && (
          <>
            <div className="text-red-400 font-display font-bold text-xl">Errore</div>
            <p className="mt-3 text-sm text-zinc-500">{err}</p>
            <button onClick={() => navigate("/pubblicita")} className="btn-outline mt-6" data-testid="retry-btn">Riprova</button>
          </>
        )}
      </div>
    </div>
  );
}
