import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import { toast } from "sonner";
import { Mic2, PlayCircle, PauseCircle, Pencil, Trash2, Upload, Copy, Search, X, Download } from "lucide-react";

/* v13.55 · SEGMENTI VOCALI DJ — Magazzino. Nessuna generazione audio.
   Ogni eliminazione passa da un popup di conferma. */
const VIOLET = "#D080FF";
const backend = process.env.REACT_APP_BACKEND_URL;
const short = (id) => (id || "").slice(0, 8);
const fmtDate = (iso) => (iso || "").slice(0, 16).replace("T", " ");
const inp = "bg-black/60 border border-white/10 rounded px-2 py-1.5 text-sm text-white";

function Confirm({ title, lines, confirmLabel, onConfirm, onCancel, busy, testid }) {
  // #247410 · portal su document.body: un antenato con backdrop-filter faceva da riferimento al position:fixed e la finestra restava semi-coperta
  return createPortal((
    <div className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" data-testid={testid}>
      <div className="w-full max-w-lg rounded-xl p-6 bg-[#0F0F14] border border-red-500/50">
        <div className="label-mono text-red-400 mb-2 flex items-center gap-2"><Trash2 className="w-4 h-4" /> {title}</div>
        <div className="text-white text-sm leading-relaxed max-h-[40vh] overflow-y-auto font-mono space-y-1">{lines.map((l, i) => <div key={i}>{l}</div>)}</div>
        <div className="text-xs text-red-300 mt-3">Questa azione è irreversibile.</div>
        <div className="flex gap-3 mt-5">
          <button type="button" onClick={onConfirm} disabled={busy} data-testid={`${testid}-confirm`} className="flex-1 px-4 py-3 rounded-lg font-black text-sm text-white" style={{ background: "#dc2626" }}>{busy ? "…" : confirmLabel}</button>
          <button type="button" onClick={onCancel} disabled={busy} data-testid={`${testid}-cancel`} className="flex-1 btn-outline font-bold text-sm">ANNULLA</button>
        </div>
      </div>
    </div>
  ), document.body);
}

function EditModal({ seg, onClose, onSaved }) {
  const [title, setTitle] = useState(seg.title || "");
  const [text, setText] = useState(seg.spoken_text || seg.script || "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await api.patch(`/admin/segments/voice/${seg.id}`, { title, text }); toast.success("Segmento aggiornato"); onSaved(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Errore"); } finally { setBusy(false); }
  };
  // #247410 · portal su document.body: un antenato con backdrop-filter faceva da riferimento al position:fixed e la finestra restava semi-coperta
  return createPortal((
    <div className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" data-testid="vseg-edit-modal">
      <div className="w-full max-w-2xl rounded-xl p-6 bg-[#0F0F14]" style={{ border: `1px solid ${VIOLET}66` }}>
        <div className="flex items-center justify-between mb-3"><div className="label-mono flex items-center gap-2" style={{ color: VIOLET }}><Pencil className="w-4 h-4" /> MODIFICA SEGMENTO</div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-white/10" data-testid="vseg-edit-close"><X className="w-4 h-4 text-zinc-400" /></button></div>
        <label className="text-xs text-zinc-400 block">Titolo<input value={title} onChange={(e) => setTitle(e.target.value)} className={`${inp} w-full mt-1`} data-testid="vseg-edit-title" /></label>
        <label className="text-xs text-zinc-400 block mt-3">Testo (script / spoken_text)<textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} className={`${inp} w-full mt-1 font-mono`} data-testid="vseg-edit-text" /></label>
        <div className="text-[10px] font-mono text-zinc-500 mt-2">Modifica solo i metadati: l'audio resta quello attuale (nessuna nuova sintesi).</div>
        <div className="flex gap-3 mt-4">
          <button type="button" onClick={save} disabled={busy} data-testid="vseg-edit-save" className="flex-1 px-4 py-2.5 rounded-lg font-black text-sm text-black" style={{ background: VIOLET }}>{busy ? "…" : "SALVA"}</button>
          <button type="button" onClick={onClose} disabled={busy} data-testid="vseg-edit-cancel" className="flex-1 btn-outline font-bold text-sm">ANNULLA</button>
        </div>
      </div>
    </div>
  ), document.body);
}

function SegRow({ s, selected, onSelect, playing, onPlay, onEdit, onDelete, onReplace, onCopyJingle }) {
  const sid = short(s.id);
  const text = s.spoken_text || s.script || "";
  return (
    <div data-testid={`vseg-row-${sid}`} className="rounded-lg border p-2.5 flex flex-wrap items-start gap-x-3 gap-y-2" style={{ background: selected ? "rgba(208,128,255,0.08)" : "rgba(255,255,255,0.03)", borderColor: selected ? `${VIOLET}99` : "rgba(255,255,255,0.08)" }}>
      <input type="checkbox" className="mt-1 accent-fuchsia-400" checked={selected} onChange={onSelect} data-testid={`vseg-check-${sid}`} />
      <button type="button" onClick={onPlay} data-testid={`vseg-play-${sid}`} className={`inline-flex items-center justify-center w-8 h-8 rounded-full border shrink-0 ${playing ? "bg-emerald-500/25 border-emerald-400 text-emerald-300" : "bg-white/5 border-white/15 text-white hover:bg-white/10"}`}>
        {playing ? <PauseCircle className="w-4 h-4" /> : <PlayCircle className="w-4 h-4" />}
      </button>
      <div className="flex-1 min-w-[240px]">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-white font-medium">{s.title || "(senza titolo)"}</span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase bg-fuchsia-500/15 text-fuchsia-300">{s.kind}</span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-500/15 text-cyan-300">🎙 {s.dj_name || "?"} · {s.voice_key || "—"}</span>
          {s.audio_replaced_at && <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-500/15 text-amber-300">audio sostituito</span>}
        </div>
        <div className="text-xs text-zinc-300 mt-1 line-clamp-2 font-mono" title={text}>{text}</div>
        <div className="text-[10px] text-zinc-500 font-mono mt-0.5">{fmtDate(s.created_at)} · {s.duration_sec ? `${Math.round(s.duration_sec)}s` : "?"} · {sid}</div>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <button type="button" onClick={onEdit} data-testid={`vseg-edit-${sid}`} title="Modifica titolo e testo" className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-cyan-500/15 border border-cyan-400/50 text-cyan-200 hover:bg-cyan-500/30"><Pencil className="w-4 h-4" /></button>
        <button type="button" onClick={onReplace} data-testid={`vseg-replace-${sid}`} title="Sostituisci audio con un tuo file" className="inline-flex items-center gap-1 px-2 py-1 rounded bg-pink-500/10 border border-pink-500/30 text-pink-300 text-[11px] hover:bg-pink-500/20"><Upload className="w-3 h-3" /> Sostituisci</button>
        <button type="button" onClick={onCopyJingle} data-testid={`vseg-jingle-${sid}`} title="Riusa come jingle nel Magazzino" className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] hover:bg-amber-500/20"><Copy className="w-3 h-3" /> Copia nei Jingle</button>
        <a href={`${backend}${s.speech_audio_url}`} download data-testid={`vseg-dl-${sid}`} className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-white/5 border border-white/15 text-zinc-300 hover:bg-white/10" title="Scarica"><Download className="w-4 h-4" /></a>
        <button type="button" onClick={onDelete} data-testid={`vseg-delete-${sid}`} title="Elimina (con conferma)" className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-red-500/15 border border-red-400/50 text-red-300 hover:bg-red-500/30"><Trash2 className="w-4 h-4" /></button>
      </div>
    </div>
  );
}

function DuplicatesView({ data, playing, onPlay, onDeleteMany, onClose }) {
  const [keep, setKeep] = useState({});
  useEffect(() => { const k = {}; (data.groups || []).forEach((g) => { k[g.key] = g.items[g.items.length - 1].id; }); setKeep(k); }, [data]);
  const toDelete = (g) => g.items.filter((i) => i.id !== keep[g.key]);
  const all = (data.groups || []).flatMap(toDelete);
  return (
    <div className="rounded-lg p-3 space-y-3" style={{ background: "rgba(255,184,77,0.05)", border: "1px solid rgba(255,184,77,0.35)" }} data-testid="vseg-duplicates">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="label-mono text-amber-300">DOPPIONI · {data.groups?.length || 0} gruppi · {data.duplicate_segments || 0} segmenti in eccesso</div>
        <div className="flex gap-2">
          <button type="button" disabled={!all.length} onClick={() => onDeleteMany(all)} data-testid="vseg-dup-delete-all" className="px-3 py-1 rounded text-xs font-bold text-white disabled:opacity-40" style={{ background: "#dc2626" }}>Elimina tutti i non scelti ({all.length})</button>
          <button type="button" onClick={onClose} className="btn-outline text-xs" data-testid="vseg-dup-close">Chiudi</button>
        </div>
      </div>
      <div className="text-[10px] font-mono text-zinc-500">Per ogni gruppo scegli quale tenere (●). Gli altri vengono eliminati solo dopo la tua conferma.</div>
      {(data.groups || []).length === 0 && <div className="text-zinc-400 text-sm py-4 text-center" data-testid="vseg-dup-empty">Nessun doppione trovato.</div>}
      <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
        {(data.groups || []).map((g) => (
          <div key={g.key} className="rounded border border-white/10 p-2" data-testid={`vseg-dup-group-${g.key.slice(0, 12)}`}>
            <div className="text-xs text-zinc-200 font-mono mb-1.5 line-clamp-2" title={g.text}>“{g.text}”</div>
            <div className="space-y-1">
              {g.items.map((i) => (
                <div key={i.id} className="flex items-center gap-2 text-[11px] font-mono">
                  <input type="radio" name={`keep-${g.key}`} checked={keep[g.key] === i.id} onChange={() => setKeep((k) => ({ ...k, [g.key]: i.id }))} data-testid={`vseg-dup-keep-${short(i.id)}`} className="accent-emerald-400" />
                  <button type="button" onClick={() => onPlay(i)} className={`w-6 h-6 rounded-full border inline-flex items-center justify-center ${playing === i.id ? "border-emerald-400 text-emerald-300" : "border-white/15 text-zinc-300"}`} data-testid={`vseg-dup-play-${short(i.id)}`}>{playing === i.id ? <PauseCircle className="w-3 h-3" /> : <PlayCircle className="w-3 h-3" />}</button>
                  <span className="text-cyan-300">🎙 {i.dj_name} · {i.voice_key}</span>
                  <span className="text-zinc-400">{i.kind}</span>
                  <span className="text-zinc-500">{fmtDate(i.created_at)}</span>
                  <span className="text-zinc-500">{i.duration_sec ? `${Math.round(i.duration_sec)}s` : ""}</span>
                  <span className={`ml-auto ${keep[g.key] === i.id ? "text-emerald-300" : "text-red-300"}`}>{keep[g.key] === i.id ? "● tieni" : "✕ elimina"}</span>
                </div>
              ))}
            </div>
            <div className="mt-1.5 text-right">
              <button type="button" onClick={() => onDeleteMany(toDelete(g))} disabled={!toDelete(g).length} data-testid={`vseg-dup-delete-${g.key.slice(0, 12)}`} className="px-2 py-0.5 rounded text-[10px] font-bold border border-red-400/50 text-red-300 hover:bg-red-500/20 disabled:opacity-40">Elimina i non scelti di questo gruppo ({toDelete(g).length})</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function VoiceSegmentsPanel() {
  const [data, setData] = useState({ items: [], total: 0, djs: [], kinds: [] });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ dj: "", kind: "", q: "", date_from: "", date_to: "" });
  const [offset, setOffset] = useState(0);
  const LIMIT = 100;
  const [selected, setSelected] = useState({});
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null); // array of segs
  const [busy, setBusy] = useState(false);
  const [dups, setDups] = useState(null);
  const [playing, setPlaying] = useState(null);
  const audioRef = useRef(null);
  const fileRef = useRef(null);
  const replaceTarget = useRef(null);

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
    Object.entries(filters).forEach(([k, v]) => { if (v) p.set(k, v); });
    api.get(`/admin/segments/voice?${p.toString()}`).then((r) => setData(r.data)).catch(() => toast.error("Errore caricamento segmenti")).finally(() => setLoading(false));
  }, [filters, offset]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => () => { try { audioRef.current?.pause(); } catch {} }, []);

  const play = (s) => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (playing === s.id) { setPlaying(null); return; }
    const a = new Audio(`${backend}${s.speech_audio_url}`); a.volume = 0.9;
    a.play().catch(() => toast.error("Impossibile riprodurre"));
    a.addEventListener("ended", () => setPlaying(null));
    audioRef.current = a; setPlaying(s.id);
  };
  const confirmDelete = async () => {
    setBusy(true);
    try {
      const r = await api.post("/admin/segments/voice/delete", { ids: deleting.map((s) => s.id) });
      toast.success(`Eliminati ${r.data.deleted} segmenti`);
      setDeleting(null); setSelected({}); load();
      if (dups) api.get("/admin/segments/voice/duplicates").then((x) => setDups(x.data)).catch(() => {});
    } catch (e) { toast.error(e?.response?.data?.detail || "Errore eliminazione"); } finally { setBusy(false); }
  };
  const onFile = async (e) => {
    const f = e.target.files?.[0]; e.target.value = "";
    const s = replaceTarget.current; if (!f || !s) return;
    const fd = new FormData(); fd.append("file", f);
    setBusy(true);
    try { await api.post(`/admin/segments/voice/${s.id}/audio`, fd); toast.success(`Audio sostituito: ${s.title || s.id}`); load(); }
    catch (err) { toast.error(err?.response?.data?.detail || "Errore upload"); } finally { setBusy(false); }
  };
  const copyJingle = async (s) => {
    try { const r = await api.post(`/admin/segments/voice/${s.id}/copy-to-jingle`, {}); toast.success(`Jingle creato: ${r.data.track.title}`); }
    catch (e) { toast.error(e?.response?.data?.detail || "Errore copia"); }
  };
  const findDups = async () => {
    setBusy(true);
    try { const r = await api.get("/admin/segments/voice/duplicates"); setDups(r.data); if (!r.data.groups?.length) toast("Nessun doppione"); }
    catch { toast.error("Errore ricerca doppioni"); } finally { setBusy(false); }
  };

  const selCount = Object.keys(selected).length;
  const selItems = useMemo(() => data.items.filter((s) => selected[s.id]), [data.items, selected]);
  const setF = (k, v) => { setOffset(0); setFilters((f) => ({ ...f, [k]: v })); };

  return (
    <div data-testid="voice-segments-panel" className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="label-mono flex items-center gap-2" style={{ color: VIOLET }}><Mic2 className="w-4 h-4" /> SEGMENTI VOCALI DJ · {loading ? "…" : `${data.total} totali`}</div>
        <div className="flex gap-2 flex-wrap">
          <button type="button" onClick={findDups} disabled={busy} data-testid="vseg-find-dups" className="px-3 py-1.5 rounded text-xs font-bold text-black" style={{ background: "#FFB84D" }}>🔍 Trova doppioni</button>
          <button type="button" disabled={!selCount} onClick={() => setDeleting(selItems)} data-testid="vseg-delete-selected" className="px-3 py-1.5 rounded text-xs font-bold text-white disabled:opacity-40" style={{ background: "#dc2626" }}>Elimina selezionati ({selCount})</button>
          {selCount > 0 && <button type="button" onClick={() => setSelected({})} className="btn-outline text-xs" data-testid="vseg-clear-sel">✕ deseleziona</button>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center" data-testid="vseg-filters">
        <div className="relative flex-1 min-w-[220px]"><Search className="w-4 h-4 absolute left-2 top-2 text-zinc-500" />
          <input value={filters.q} onChange={(e) => setF("q", e.target.value)} placeholder="Cerca nel testo o nel titolo…" className={`${inp} w-full pl-8`} data-testid="vseg-search" /></div>
        <select value={filters.dj} onChange={(e) => setF("dj", e.target.value)} className={inp} data-testid="vseg-filter-dj"><option value="">Tutti i DJ / voci</option>{data.djs.map((d) => <option key={d} value={d}>{d}</option>)}</select>
        <select value={filters.kind} onChange={(e) => setF("kind", e.target.value)} className={inp} data-testid="vseg-filter-kind"><option value="">Tutti i tipi</option>{data.kinds.map((k) => <option key={k} value={k}>{k}</option>)}</select>
        <input type="date" value={filters.date_from} onChange={(e) => setF("date_from", e.target.value)} className={inp} data-testid="vseg-filter-from" title="Dal" />
        <input type="date" value={filters.date_to} onChange={(e) => setF("date_to", e.target.value)} className={inp} data-testid="vseg-filter-to" title="Al" />
        <button type="button" onClick={() => { setOffset(0); setFilters({ dj: "", kind: "", q: "", date_from: "", date_to: "" }); }} className="btn-outline text-xs" data-testid="vseg-filter-reset">Reset</button>
      </div>

      {dups && <DuplicatesView data={dups} playing={playing} onPlay={play} onDeleteMany={(items) => items.length && setDeleting(items)} onClose={() => setDups(null)} />}

      <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-500">
        <label className="flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={data.items.length > 0 && data.items.every((s) => selected[s.id])} onChange={(e) => { const n = { ...selected }; data.items.forEach((s) => { if (e.target.checked) n[s.id] = true; else delete n[s.id]; }); setSelected(n); }} data-testid="vseg-select-page" /> seleziona pagina</label>
        <span>· {offset + 1}–{Math.min(offset + LIMIT, data.total)} di {data.total}</span>
        <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))} className="px-2 py-0.5 rounded border border-white/15 disabled:opacity-30" data-testid="vseg-prev">◀</button>
        <button type="button" disabled={offset + LIMIT >= data.total} onClick={() => setOffset(offset + LIMIT)} className="px-2 py-0.5 rounded border border-white/15 disabled:opacity-30" data-testid="vseg-next">▶</button>
      </div>

      <div className="space-y-1.5 max-h-[560px] overflow-y-auto pr-1" data-testid="vseg-list">
        {!loading && data.items.length === 0 && <div className="text-zinc-500 text-sm py-6 text-center" data-testid="vseg-empty">Nessun segmento vocale con questi filtri.</div>}
        {data.items.map((s) => (
          <SegRow key={s.id} s={s} selected={!!selected[s.id]} onSelect={() => setSelected((m) => { const n = { ...m }; if (n[s.id]) delete n[s.id]; else n[s.id] = true; return n; })}
            playing={playing === s.id} onPlay={() => play(s)} onEdit={() => setEditing(s)} onDelete={() => setDeleting([s])}
            onReplace={() => { replaceTarget.current = s; fileRef.current?.click(); }} onCopyJingle={() => copyJingle(s)} />
        ))}
      </div>
      <input ref={fileRef} type="file" accept=".mp3,.wav,.m4a,.ogg,audio/*" className="hidden" onChange={onFile} data-testid="vseg-file-input" />

      {editing && <EditModal seg={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {deleting && (
        <Confirm testid="vseg-delete-modal" title={deleting.length === 1 ? "ELIMINA SEGMENTO" : `ELIMINA ${deleting.length} SEGMENTI`} confirmLabel="CONFERMA ELIMINAZIONE" busy={busy}
          lines={[`Stai per eliminare ${deleting.length === 1 ? "il segmento" : `${deleting.length} segmenti`}:`, ...deleting.slice(0, 12).map((s) => `• ${s.title || s.id} (${s.dj_name || "?"})`), ...(deleting.length > 12 ? [`… e altri ${deleting.length - 12}`] : [])]}
          onConfirm={confirmDelete} onCancel={() => setDeleting(null)} />
      )}
    </div>
  );
}
