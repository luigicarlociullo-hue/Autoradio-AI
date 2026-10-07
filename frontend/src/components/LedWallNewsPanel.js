import React, { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";
import { Radio, Plus, Trash2, ChevronUp, ChevronDown, Copy, RefreshCw, KeyRound } from "lucide-react";

/* v13.50 · LED WALL NEWS — coda testi del ticker in basso nel LedWall.
   Aggiungi (con conferma) · riordina ▲▼ · attiva/disattiva · elimina (con conferma)
   · endpoint esterno protetto (token) per futuri messaggi IA. */

const GREEN = "#39FF14";

function ConfirmBox({ title, text, confirmLabel, danger, busy, onConfirm, onCancel, testid }) {
  return (
    <div className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" data-testid={testid}>
      <div className="w-full max-w-md rounded-xl p-6 bg-[#0F0F14]" style={{ border: `1px solid ${danger ? "rgba(239,68,68,0.5)" : "rgba(57,255,20,0.45)"}` }}>
        <div className="label-mono mb-2" style={{ color: danger ? "#f87171" : GREEN }}>{title}</div>
        <p className="text-white text-sm leading-relaxed font-mono whitespace-pre-wrap break-words">{text}</p>
        <div className="flex gap-3 mt-5">
          <button type="button" onClick={onConfirm} disabled={busy} data-testid={`${testid}-confirm`}
            className="flex-1 px-4 py-2.5 rounded-lg font-black text-sm" style={danger ? { background: "#dc2626", color: "#fff" } : { background: GREEN, color: "#000" }}>
            {busy ? "…" : confirmLabel}</button>
          <button type="button" onClick={onCancel} disabled={busy} data-testid={`${testid}-cancel`} className="flex-1 btn-outline font-bold text-sm">ANNULLA</button>
        </div>
      </div>
    </div>
  );
}

function EndpointBox() {
  const [info, setInfo] = useState(null);
  const [show, setShow] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const load = useCallback((regen = false) => api.get(`/admin/ledwall/news/token${regen ? "?regenerate=true" : ""}`).then((r) => setInfo(r.data)).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  const url = `${process.env.REACT_APP_BACKEND_URL}${info?.endpoint || "/api/ledwall/news/ingest"}`;
  const copy = (v, label) => navigator.clipboard?.writeText(v).then(() => toast.success(`${label} copiato`)).catch(() => toast.error("Copia non riuscita"));
  const masked = info?.token ? info.token.slice(0, 4) + "••••••••••••" + info.token.slice(-4) : "—";
  return (
    <div className="rounded-lg p-3 mt-4" data-testid="lwn-endpoint-box" style={{ background: "rgba(255,255,255,0.03)", border: "1px dashed rgba(57,255,20,0.3)" }}>
      <div className="label-mono flex items-center gap-2 text-zinc-400"><KeyRound className="w-3.5 h-3.5" /> ENDPOINT ESTERNO (futura IA) · protetto da token</div>
      <div className="mt-2 grid gap-1.5 text-[11px] font-mono">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-zinc-500 w-16 shrink-0">POST</span>
          <span className="text-cyan-300 truncate" data-testid="lwn-endpoint-url">{url}</span>
          <button type="button" onClick={() => copy(url, "URL")} className="p-1 rounded hover:bg-white/10" data-testid="lwn-copy-url"><Copy className="w-3 h-3 text-zinc-300" /></button>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-zinc-500 w-16 shrink-0">Header</span>
          <span className="text-zinc-300">{info?.header || "X-LedWall-Token"}:</span>
          <span className="truncate" style={{ color: GREEN }} data-testid="lwn-token">{show ? info?.token : masked}</span>
          <button type="button" onClick={() => setShow((v) => !v)} className="px-1.5 py-0.5 rounded text-[10px] border border-white/15 text-zinc-300 hover:bg-white/10" data-testid="lwn-token-toggle">{show ? "nascondi" : "mostra"}</button>
          <button type="button" onClick={() => info?.token && copy(info.token, "Token")} className="p-1 rounded hover:bg-white/10" data-testid="lwn-copy-token"><Copy className="w-3 h-3 text-zinc-300" /></button>
          <button type="button" onClick={() => setConfirmRegen(true)} className="px-1.5 py-0.5 rounded text-[10px] border border-amber-400/40 text-amber-300 hover:bg-amber-500/10 inline-flex items-center gap-1" data-testid="lwn-token-regen"><RefreshCw className="w-3 h-3" /> rigenera</button>
        </div>
        <div className="text-zinc-500">Body JSON: {"{ \"text\": \"…\", \"source\": \"ai\" }"} · nessuna IA collegata per ora.</div>
      </div>
      {confirmRegen && (
        <ConfirmBox testid="lwn-regen-modal" title="RIGENERA TOKEN" danger confirmLabel="RIGENERA"
          text="Il token attuale smetterà di funzionare. Qualsiasi servizio esterno già collegato dovrà usare il nuovo token."
          onCancel={() => setConfirmRegen(false)} onConfirm={async () => { await load(true); setConfirmRegen(false); toast.success("Token rigenerato"); }} />
      )}
    </div>
  );
}

const DEFAULT_SETTINGS = { speed: 70, color: "#39FF14" };
const SPEEDS_FALLBACK = [40, 55, 70, 100, 140];

function TickerSettings({ settings, speeds, onSave, busy }) {
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  const list = speeds?.length ? speeds : SPEEDS_FALLBACK;
  const idx = Math.max(0, list.indexOf(Number(s.speed)));
  const step = (d) => { const j = Math.min(list.length - 1, Math.max(0, idx + d)); if (j !== idx) onSave({ speed: list[j] }); };
  return (
    <div className="rounded-lg p-3 mt-3 flex flex-wrap items-center gap-x-6 gap-y-2" data-testid="lwn-settings" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(57,255,20,0.2)" }}>
      <div className="flex items-center gap-2" data-testid="lwn-speed">
        <span className="label-mono text-zinc-400">VELOCITÀ</span>
        <button type="button" onClick={() => step(-1)} disabled={busy || idx === 0} data-testid="lwn-speed-minus"
          className="w-7 h-7 rounded border border-white/15 text-white font-black hover:bg-white/10 disabled:opacity-25">−</button>
        <span className="font-mono text-sm w-16 text-center" style={{ color: GREEN }} data-testid="lwn-speed-value">×{(Number(s.speed) / DEFAULT_SETTINGS.speed).toFixed(1)}</span>
        <button type="button" onClick={() => step(1)} disabled={busy || idx === list.length - 1} data-testid="lwn-speed-plus"
          className="w-7 h-7 rounded border border-white/15 text-white font-black hover:bg-white/10 disabled:opacity-25">+</button>
        <span className="text-[10px] font-mono text-zinc-500">{s.speed} px/s</span>
      </div>
      <div className="flex items-center gap-2" data-testid="lwn-color">
        <span className="label-mono text-zinc-400">COLORE TESTO</span>
        <input type="color" value={s.color} disabled={busy} data-testid="lwn-color-picker"
          onChange={(e) => onSave({ color: e.target.value.toUpperCase() })}
          className="w-8 h-7 rounded border border-white/15 bg-transparent cursor-pointer p-0" title="Colore delle lettere della banda" />
        <span className="font-mono text-xs" style={{ color: s.color, textShadow: `0 0 6px ${s.color}` }} data-testid="lwn-color-value">{s.color}</span>
        {s.color !== DEFAULT_SETTINGS.color && (
          <button type="button" onClick={() => onSave({ color: DEFAULT_SETTINGS.color })} disabled={busy} data-testid="lwn-color-reset"
            className="px-1.5 py-0.5 rounded text-[10px] border border-white/15 text-zinc-300 hover:bg-white/10">↺ verde neon</button>
        )}
      </div>
      <span className="text-[10px] font-mono text-zinc-500">Si applica al LED Wall pubblico entro ~15s · salvato nel database.</span>
    </div>
  );
}

export default function LedWallNewsPanel() {
  const [items, setItems] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [speeds, setSpeeds] = useState(SPEEDS_FALLBACK);
  const [text, setText] = useState("");
  const [confirmAdd, setConfirmAdd] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.get("/admin/ledwall/news").then((r) => {
    setItems(r.data?.items || []);
    if (r.data?.settings) setSettings(r.data.settings);
    if (r.data?.speeds?.length) setSpeeds(r.data.speeds);
  }).catch(() => {}), []);
  useEffect(() => { load(); const iv = setInterval(load, 20000); return () => clearInterval(iv); }, [load]);

  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); await load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Errore"); }
    finally { setBusy(false); }
  };
  const saveSettings = (patch) => run(async () => { const r = await api.put("/admin/ledwall/news/settings", patch); setSettings(r.data.settings); });
  const add = () => run(async () => { await api.post("/admin/ledwall/news", { text: text.trim() }); setText(""); setConfirmAdd(false); }, "Aggiunto alla coda LED Wall");
  const move = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    const ids = items.map((i) => i.id);
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    run(() => api.put("/admin/ledwall/news/reorder", { ids }));
  };
  const active = items.filter((i) => i.active).length;

  return (
    <section data-testid="ledwall-news-panel" className="lg:col-span-4 rounded-xl p-5"
      style={{ background: "linear-gradient(180deg, rgba(57,255,20,0.04), rgba(5,12,5,0.9))", border: "1px solid rgba(57,255,20,0.3)", backdropFilter: "blur(10px)" }}>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div>
          <div className="label-mono flex items-center gap-2" style={{ color: GREEN }}><Radio className="w-4 h-4" /> LED WALL NEWS</div>
          <div className="text-xs text-zinc-400 font-mono mt-0.5" data-testid="lwn-status">
            {items.length} elementi · {active} in onda · {active === 0 ? "banda nascosta" : "banda visibile sul LED Wall"}
          </div>
        </div>
      </div>

      <div className="flex gap-2 items-start">
        <textarea data-testid="lwn-input" value={text} onChange={(e) => setText(e.target.value.slice(0, 400))} rows={2}
          placeholder="Testo da far scorrere sul LED Wall… (max 400 caratteri)"
          className="flex-1 bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-white font-mono resize-none" />
        <button type="button" data-testid="lwn-add" disabled={!text.trim() || busy} onClick={() => setConfirmAdd(true)}
          className="px-4 py-2 rounded-lg font-black text-sm inline-flex items-center gap-1 self-stretch"
          style={{ background: text.trim() ? GREEN : "rgba(57,255,20,0.2)", color: "#000" }}>
          <Plus className="w-4 h-4" /> Aggiungi</button>
      </div>
      <div className="text-[10px] font-mono text-zinc-500 mt-1 text-right">{text.length}/400</div>

      <TickerSettings settings={settings} speeds={speeds} onSave={saveSettings} busy={busy} />

      <div className="mt-3 space-y-1.5 max-h-[320px] overflow-y-auto pr-1" data-testid="lwn-list">
        {items.length === 0 && <div className="text-zinc-500 text-sm py-6 text-center" data-testid="lwn-empty">Coda vuota · la banda non viene mostrata.</div>}
        {items.map((it, idx) => (
          <div key={it.id} data-testid={`lwn-item-${it.id.slice(0, 8)}`} className={`rounded-lg border p-2 flex items-center gap-2 ${it.active ? "" : "opacity-55"}`}
            style={{ background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.08)" }}>
            <div className="flex flex-col shrink-0">
              <button type="button" onClick={() => move(idx, -1)} disabled={busy || idx === 0} className="p-0.5 rounded hover:bg-white/10 disabled:opacity-25" data-testid={`lwn-up-${it.id.slice(0, 8)}`}><ChevronUp className="w-4 h-4 text-zinc-300" /></button>
              <button type="button" onClick={() => move(idx, 1)} disabled={busy || idx === items.length - 1} className="p-0.5 rounded hover:bg-white/10 disabled:opacity-25" data-testid={`lwn-down-${it.id.slice(0, 8)}`}><ChevronDown className="w-4 h-4 text-zinc-300" /></button>
            </div>
            <span className="font-mono text-[10px] text-zinc-500 w-5 shrink-0">{idx + 1}.</span>
            <div className="flex-1 min-w-0">
              <div className="font-mono text-sm break-words" style={{ color: it.active ? GREEN : "#a1a1aa" }}>{it.text}</div>
              <div className="text-[10px] font-mono text-zinc-500 flex gap-2 mt-0.5">
                <span className={`px-1.5 rounded ${it.source === "ai" ? "bg-fuchsia-500/15 text-fuchsia-300" : "bg-cyan-500/15 text-cyan-300"}`}>{it.source === "ai" ? "AI" : "manuale"}</span>
                <span>{(it.created_at || "").slice(0, 16).replace("T", " ")}</span>
              </div>
            </div>
            <button type="button" onClick={() => run(() => api.patch(`/admin/ledwall/news/${it.id}`, { active: !it.active }), it.active ? "Elemento sospeso" : "Elemento in onda")} disabled={busy}
              data-testid={`lwn-toggle-${it.id.slice(0, 8)}`} className="px-2 py-1 rounded text-[10px] font-mono font-bold border shrink-0"
              style={it.active ? { borderColor: "rgba(57,255,20,0.5)", color: GREEN, background: "rgba(57,255,20,0.1)" } : { borderColor: "rgba(255,255,255,0.15)", color: "#a1a1aa" }}>
              {it.active ? "ON" : "OFF"}</button>
            <button type="button" onClick={() => setDeleting(it)} disabled={busy} data-testid={`lwn-delete-${it.id.slice(0, 8)}`}
              className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-red-500/15 border border-red-400/50 text-red-300 hover:bg-red-500/30 shrink-0"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
      </div>

      <EndpointBox />

      {confirmAdd && (
        <ConfirmBox testid="lwn-add-modal" title="AGGIUNGI ALLA CODA LED WALL" confirmLabel="CONFERMA E AGGIUNGI" busy={busy}
          text={`Stai per aggiungere al ticker:\n\n"${text.trim()}"\n\nAndrà in onda subito sul LED Wall pubblico.`}
          onCancel={() => setConfirmAdd(false)} onConfirm={add} />
      )}
      {deleting && (
        <ConfirmBox testid="lwn-delete-modal" title="ELIMINA ELEMENTO" danger confirmLabel="CONFERMA ELIMINAZIONE" busy={busy}
          text={`Stai per eliminare: "${deleting.text}"\n\nQuesta azione è irreversibile.`}
          onCancel={() => setDeleting(null)} onConfirm={() => run(async () => { await api.delete(`/admin/ledwall/news/${deleting.id}`); setDeleting(null); }, "Eliminato")} />
      )}
    </section>
  );
}
