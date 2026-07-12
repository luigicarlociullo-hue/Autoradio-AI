import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Megaphone, Sparkles, Check, ArrowLeft, ShieldCheck, Zap } from "lucide-react";
import { endpoints, api } from "@/lib/api";
import { toast } from "sonner";

export default function Advertise() {
  const [tiers, setTiers] = useState({});
  const [isDemo, setIsDemo] = useState(false);
  const [tier, setTier] = useState("standard");
  const [brand, setBrand] = useState("");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/ads/tiers").then(r => {
      setTiers(r.data.tiers || {});
      setIsDemo(!!r.data.is_demo);
    });
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!brand.trim() || !message.trim()) {
      toast.error("Compila brand e messaggio");
      return;
    }
    setBusy(true);
    try {
      const r = await api.post("/ads/create", {
        brand,
        message,
        tier,
        contact_email: email || null,
        return_origin: window.location.origin,
      });
      const url = r.data.approval_url;
      if (url) {
        toast.success("Reindirizzamento a PayPal…");
        window.location.href = url;
      } else {
        toast.error("Nessun link PayPal ricevuto");
      }
    } catch (err) {
      toast.error("Errore nella creazione della campagna");
      console.error(err);
    } finally {
      setBusy(false);
    }
  };

  const tierList = Object.entries(tiers);

  return (
    <div className="min-h-screen text-white" style={{ background: "linear-gradient(180deg, #05050A, #0a0a14 60%, #05050A)" }}>
      <header className="glass sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors duration-200" data-testid="back-to-radio">
            <ArrowLeft className="w-4 h-4" /> Torna in radio
          </Link>
          <div className="flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-pink-500" />
            <span className="font-display font-black">NEURA·FM · Adv</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12">
        <div className="label-mono mb-3">Sponsorizza la prima radio AI</div>
        <h1 className="font-display font-black text-4xl sm:text-5xl lg:text-6xl leading-[0.95] max-w-3xl">
          Il tuo brand<br />in mezzo a un DJ AI e<br />
          <span className="text-pink-500">una canzone mai esistita.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-zinc-400 leading-relaxed">
          Scegli un pacchetto, scrivi il messaggio chiave del tuo brand. Il resto lo fanno le AI: scriviamo lo spot con GPT/Claude/Gemini, lo doppiamo con voce Bark open source e lo mandiamo in onda nella rotazione della radio.
        </p>

        {isDemo && (
          <div
            data-testid="demo-mode-banner"
            className="mt-6 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-3 text-sm font-mono text-cyan-300"
          >
            ⚡ MODALITÀ DEMO · nessun addebito reale. Sostituendo `PAYPAL_CLIENT_ID` e `PAYPAL_CLIENT_SECRET` nel file .env con le tue chiavi Sandbox o Live, i pagamenti verranno addebitati per davvero.
          </div>
        )}

        {/* Pricing tiers */}
        <div className="mt-10 grid md:grid-cols-3 gap-4">
          {tierList.map(([k, v]) => {
            const active = tier === k;
            return (
              <button
                key={k}
                type="button"
                data-testid={`tier-${k}`}
                onClick={() => setTier(k)}
                className="card-surface p-6 text-left transition-transform duration-300 hover:-translate-y-1"
                style={active ? {
                  borderColor: "#FF1493",
                  boxShadow: "inset 0 0 24px rgba(255,20,147,0.18), 0 0 0 1px rgba(255,20,147,0.4)",
                } : {}}
              >
                <div className="flex items-center justify-between">
                  <div className="label-mono">{v.label}</div>
                  {k === "premium" && <span className="chip">Best value</span>}
                </div>
                <div className="font-display font-black text-4xl mt-3">
                  €{v.price_eur.toFixed(2).replace(".", ",")}
                </div>
                <div className="mt-1 text-sm font-mono text-zinc-500">{v.plays} passagg{v.plays === 1 ? "io" : "i"}</div>
                <div className="mt-4 space-y-2 text-sm text-zinc-400">
                  <div className="flex items-start gap-2"><Check className="w-4 h-4 text-emerald-400 mt-0.5" /> Copy generato da AI in italiano</div>
                  <div className="flex items-start gap-2"><Check className="w-4 h-4 text-emerald-400 mt-0.5" /> Voce open source (Bark)</div>
                  <div className="flex items-start gap-2"><Check className="w-4 h-4 text-emerald-400 mt-0.5" /> {v.desc}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Form */}
        <form onSubmit={submit} className="mt-10 grid md:grid-cols-2 gap-8 items-start" data-testid="ad-form">
          <div>
            <label className="label-mono block mb-2">Nome del brand</label>
            <input
              data-testid="ad-brand-input"
              value={brand}
              onChange={e => setBrand(e.target.value)}
              placeholder="Es. Gelato Cosmos"
              maxLength={60}
              className="w-full bg-[#0F0F14] border border-white/10 rounded-lg px-4 py-3 focusable font-mono text-sm"
            />
            <label className="label-mono block mt-5 mb-2">Messaggio chiave (max 400 caratteri)</label>
            <textarea
              data-testid="ad-message-input"
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Il gelato artigianale migliore di Milano, aperto fino alle 2 di notte…"
              rows={5}
              maxLength={400}
              className="w-full bg-[#0F0F14] border border-white/10 rounded-lg px-4 py-3 focusable text-sm resize-none"
            />
            <label className="label-mono block mt-5 mb-2">Email di contatto (opzionale)</label>
            <input
              data-testid="ad-email-input"
              value={email}
              type="email"
              onChange={e => setEmail(e.target.value)}
              placeholder="tu@brand.it"
              className="w-full bg-[#0F0F14] border border-white/10 rounded-lg px-4 py-3 focusable font-mono text-sm"
            />
          </div>

          <div className="card-surface p-6">
            <div className="label-mono">Riepilogo</div>
            <div className="mt-3 font-display font-bold text-2xl">{(tiers[tier] || {}).label || tier}</div>
            <div className="mt-1 text-sm text-zinc-500">{(tiers[tier] || {}).desc}</div>
            <div className="mt-6 flex items-end gap-2">
              <div className="font-display font-black text-5xl">€{((tiers[tier] || {}).price_eur || 0).toFixed(2).replace(".", ",")}</div>
              <div className="pb-2 text-xs font-mono text-zinc-500">IVA inclusa</div>
            </div>

            <button
              type="submit"
              disabled={busy}
              data-testid="ad-checkout-button"
              className="btn-primary mt-6 w-full flex items-center justify-center gap-2 text-base py-4"
            >
              {busy ? "Elaborazione…" : (isDemo ? "Simula pagamento (Demo)" : "Paga con PayPal")}
              <Sparkles className="w-4 h-4" />
            </button>

            <div className="mt-4 flex items-center gap-2 text-xs font-mono text-zinc-500">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              Pagamento sicuro tramite PayPal · nessun dato carta salvato dal nostro server
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs font-mono text-zinc-500">
              <Zap className="w-4 h-4 text-cyan-400" />
              Lo spot va in onda entro pochi secondi dalla conferma
            </div>
          </div>
        </form>
      </main>
    </div>
  );
}
