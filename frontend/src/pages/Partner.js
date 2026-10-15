import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Building2, Send, Upload, ArrowLeft, Sparkles, Mail } from "lucide-react";
import { toast } from "sonner";
import { UserContentDisclaimer, useUgcAccepted } from "@/components/UserContentDisclaimer";

export default function Partner() {
  const backend = process.env.REACT_APP_BACKEND_URL;
  const [mode, setMode] = useState("upload"); // "upload" | "ai"

  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [brand, setBrand] = useState("");
  const [email, setEmail] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [freq, setFreq] = useState(2);
  const [busy, setBusy] = useState(false);
  const [ugcOk, setUgcOk] = useUgcAccepted();  // disclaimer contenuti (obbligatorio)

  const submitUpload = async () => {
    if (!file) return toast.error("Seleziona un file MP3");
    if (!title.trim()) return toast.error("Titolo obbligatorio");
    if (!brand.trim()) return toast.error("Nome brand obbligatorio");
    if (!ugcOk) return toast.error("Prima accetta le condizioni sui contenuti");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("mode", "new");
      fd.append("kind", "spot");
      fd.append("title", title.trim());
      fd.append("artist", brand.trim());
      fd.append("submitted_by", `${brand.trim()}${email ? " · " + email : ""}`);
      fd.append("pending_approval", "1");
      if (start) fd.append("spot_start_date", start);
      if (end) fd.append("spot_end_date", end);
      if (freq) fd.append("spot_frequency_per_hour", String(freq));
      const r = await fetch(`${backend}/api/admin/tracks/upload`, { method: "POST", body: fd });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
      toast.success("Richiesta inviata! Verrà approvata dal team R-A.I.");
      setFile(null); setTitle(""); setBrand(""); setEmail(""); setStart(""); setEnd(""); setFreq(2);
    } catch (e) {
      toast.error(`Errore: ${e.message}`);
    } finally { setBusy(false); }
  };

  return (
    <div className="relative min-h-screen text-white bg-black" data-testid="partner-page">
      <div aria-hidden className="fixed inset-0 pointer-events-none rai-bg" style={{ zIndex: 0 }}>
        <div className="rai-bg-grid" />
        <div className="rai-bg-orb rai-bg-orb-1" />
        <div className="rai-bg-orb rai-bg-orb-2" />
      </div>

      <header className="glass sticky top-0 z-40 relative">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" data-testid="partner-back" className="btn-outline focusable !py-1.5 !px-3 !text-[11px] inline-flex items-center gap-2">
            <ArrowLeft className="w-3.5 h-3.5" /> Home
          </Link>
          <div className="label-mono flex items-center gap-2" style={{ color: "#FFB84D" }}>
            <Building2 className="w-3 h-3" /> DIVENTA PARTNER
          </div>
        </div>
      </header>

      <section className="max-w-3xl mx-auto px-6 py-8 relative z-10">
        <h1
          className="font-display font-black text-3xl sm:text-4xl mb-2"
          data-testid="partner-heading"
          style={{ color: "#FFD79A", textShadow: "0 0 12px rgba(255,184,77,0.7)" }}
        >
          DIVENTA PARTNER
        </h1>
        <p className="text-sm font-mono text-zinc-300 leading-relaxed mb-6 max-w-2xl">
          Manda il tuo spot pubblicitario a R-A.I. Carica un MP3 già pronto oppure lasciacelo generare dall'AI.
          <br />La richiesta finisce nella <span className="text-amber-300">Coda di Approvazione</span> e va in onda solo dopo il nostro OK.
        </p>

        <div className="flex gap-2 mb-5">
          <button
            data-testid="mode-upload"
            onClick={() => setMode("upload")}
            className={`px-4 py-2 rounded-md text-xs font-mono uppercase border transition ${
              mode === "upload"
                ? "border-amber-400 text-amber-200 bg-amber-500/10"
                : "border-white/10 text-zinc-400"
            }`}
          >
            <Upload className="w-3.5 h-3.5 inline mr-1.5" /> Carica MP3
          </button>
          <button
            data-testid="mode-ai"
            onClick={() => setMode("ai")}
            className={`px-4 py-2 rounded-md text-xs font-mono uppercase border transition ${
              mode === "ai"
                ? "border-amber-400 text-amber-200 bg-amber-500/10"
                : "border-white/10 text-zinc-400"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 inline mr-1.5" /> Genera con AI
          </button>
        </div>

        {mode === "upload" && (
          <div className="console-panel p-5 space-y-4"
               style={{ boxShadow: "0 0 0 1px rgba(255,184,77,0.3) inset, 0 0 24px rgba(255,184,77,0.12)" }}>
            <div>
              <label className="label-mono mb-1 block">File MP3 spot (max 30 MB)</label>
              <input
                type="file"
                accept="audio/mpeg,.mp3"
                data-testid="partner-file"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="w-full bg-black border border-white/10 rounded px-3 py-2 text-white text-sm"
              />
              {file && (
                <span className="text-xs text-emerald-400 font-mono mt-1 block">
                  {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
                </span>
              )}
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="label-mono mb-1 block">Titolo spot</label>
                <input
                  type="text" data-testid="partner-title"
                  value={title} onChange={(e) => setTitle(e.target.value)}
                  placeholder="es. Promo Estate 2026"
                  className="w-full bg-black border border-white/10 rounded px-3 py-2 text-white text-sm"
                />
              </div>
              <div>
                <label className="label-mono mb-1 block">Nome brand *</label>
                <input
                  type="text" data-testid="partner-brand"
                  value={brand} onChange={(e) => setBrand(e.target.value)}
                  placeholder="es. Nome Azienda Srl"
                  className="w-full bg-black border border-white/10 rounded px-3 py-2 text-white text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="label-mono mb-1 block">Email di contatto (opzionale)</label>
                <input
                  type="email" data-testid="partner-email"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="contatto@brand.it"
                  className="w-full bg-black border border-white/10 rounded px-3 py-2 text-white text-sm"
                />
              </div>
              <div>
                <label className="label-mono mb-1 block">Data inizio</label>
                <input type="date" data-testid="partner-start"
                  value={start} onChange={(e) => setStart(e.target.value)}
                  className="w-full bg-black border border-white/10 rounded px-3 py-2 text-white text-sm" />
              </div>
              <div>
                <label className="label-mono mb-1 block">Data fine</label>
                <input type="date" data-testid="partner-end"
                  value={end} onChange={(e) => setEnd(e.target.value)}
                  className="w-full bg-black border border-white/10 rounded px-3 py-2 text-white text-sm" />
              </div>
              <div>
                <label className="label-mono mb-1 block">Passaggi/ora (1-12)</label>
                <input type="number" min="1" max="12" data-testid="partner-freq"
                  value={freq} onChange={(e) => setFreq(parseInt(e.target.value) || 1)}
                  className="w-full bg-black border border-white/10 rounded px-3 py-2 text-white text-sm" />
              </div>
            </div>

            <div className="mb-4"><UserContentDisclaimer accepted={ugcOk} onChange={setUgcOk} testid="partner-disclaimer" /></div>
            <button
              onClick={submitUpload}
              disabled={busy || !ugcOk}
              data-testid="partner-submit"
              className="btn-primary inline-flex items-center gap-2"
              style={{ background: "linear-gradient(135deg, #FF6B1A 0%, #FFB84D 100%)" }}
            >
              <Send className="w-4 h-4" />
              {busy ? "Invio…" : "Invia richiesta"}
            </button>
          </div>
        )}

        {mode === "ai" && (
          <div className="console-panel p-5"
               style={{ boxShadow: "0 0 0 1px rgba(255,184,77,0.3) inset, 0 0 24px rgba(255,184,77,0.12)" }}>
            <p className="text-sm font-mono text-zinc-300 leading-relaxed">
              La generazione automatica del jingle pubblicitario tramite AI (Suno + copywriting) è in preparazione.
              Nel frattempo <span className="text-amber-300">scrivici a</span>:
            </p>
            <a
              href="mailto:info@r-ai.it?subject=Richiesta%20Spot%20AI"
              data-testid="partner-email-ai"
              className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-mono border"
              style={{
                borderColor: "rgba(255,184,77,0.55)",
                color: "#FFD79A",
                textShadow: "0 0 6px rgba(255,184,77,0.6)",
              }}
            >
              <Mail className="w-4 h-4" /> info@r-ai.it
            </a>
            <p className="text-[11px] font-mono text-zinc-500 mt-4">
              Indicaci brand, target, tono di voce, durata (15/30/60s) e periodo di messa in onda.
              Ti risponderemo con un provino generato dalla nostra AI e ti chiederemo l'OK finale.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
