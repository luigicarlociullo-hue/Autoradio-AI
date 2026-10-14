import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, endpoints } from "../lib/api";
import { toast } from "sonner";
import { Music2, Upload, Pencil, Trash2, Download, Replace, PlayCircle, PauseCircle, X } from "lucide-react";
import { MagazzinoUniversale } from "./CommandCenter2Panels";

/* ══════════════════════════════════════════════════════════════════════════
   ARCHIVIO BRANI · CONTROLLO TOTALE — v13.49
   Fusione di "Tutte le risorse della radio" (MagazzinoUniversale) e
   "Archivio Brani · Gestione unificata" (TrackManagerPanel).
   Ordine controlli per riga: TOGGLE ON/OFF → FASCIA (6) → MATITA → CESTINO →
   tutti i pulsanti preesistenti (ZIP, Preview/PLAY LIVE, MP3, Sostituisci,
   Genere, BPM, Giorno/Notte · Night-jingle).
   ══════════════════════════════════════════════════════════════════════════ */

export const BROADCAST_SLOTS = [
  { k: "morning",   label: "MATTINA",    hours: "06-11", col: "#FFD36B" },
  { k: "afternoon", label: "POMERIGGIO", hours: "11-19", col: "#FFB84D" },
  { k: "day",       label: "GIORNO",     hours: "06-19", col: "#FF8A3D" },
  { k: "evening",   label: "SERA",       hours: "19-22", col: "#FF6BAA" },
  { k: "night",     label: "NOTTE",      hours: "22-04", col: "#C89AFF" },
  { k: "always",    label: "SEMPRE",     hours: "24h",   col: "#80FFB4" },
];
const slotLabel = (k) => { const s = BROADCAST_SLOTS.find((x) => x.k === k); return s ? `${s.label} ${s.hours}` : k; };
const trackSlots = (t) => (Array.isArray(t.broadcast_slots) && t.broadcast_slots.length ? t.broadcast_slots : [t.broadcast_slot || "always"]);
const sameList = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const customLabel = (c) => (c && c.from && c.to ? `⏱ ${c.from}–${c.to}` : "");

const KINDS = [
  { k: "song",   label: "Canzone", cls: "bg-pink-500/15 text-pink-300" },
  { k: "jingle", label: "Jingle",  cls: "bg-cyan-500/15 text-cyan-300" },
  { k: "anthem", label: "Inno",    cls: "bg-yellow-500/15 text-yellow-300" },
  { k: "loop",   label: "🌀 Loop", cls: "bg-indigo-500/15 text-indigo-300" },
  { k: "spot",   label: "💰 Spot", cls: "bg-amber-500/15 text-amber-300" },
  { k: "fx",     label: "⚡ FX",   cls: "bg-fuchsia-500/15 text-fuchsia-300" },
  { k: "appointment_jingle", label: "✨ Sigla Appuntamenti", cls: "bg-pink-500/15 text-pink-300" },
];
const CATEGORY_FILTERS = [
  { k: "all", label: "TUTTI" }, { k: "song", label: "MUSICA" }, { k: "jingle", label: "JINGLE" },
  { k: "spot", label: "SPOT" }, { k: "loop", label: "BASI (LOOP)" }, { k: "fx", label: "FX" },
  { k: "anthem", label: "INNO" }, { k: "appointment_jingle", label: "SIGLE APPUNTAMENTI" }, { k: "pending", label: "⏳ APPROVAZIONE" },
];
const GENRES = [
  { k: "all", label: "Tutti" }, { k: "pop", label: "Pop" }, { k: "rock", label: "Rock" }, { k: "hiphop", label: "Hip Hop" },
  { k: "dance", label: "Dance/Club" }, { k: "relax", label: "Relax" }, { k: "ambient", label: "Ambient" },
  { k: "varie", label: "Varie" }, { k: "night-mix", label: "🌙 Night Mix (AI)" },
];
const backend = process.env.REACT_APP_BACKEND_URL;
const downloadUrl = (id) => `${backend}/api/suno_audio/track_${id}.mp3`;
const short = (id) => (id || "").slice(0, 8);

const setOnAir = (id, on) => { const fd = new FormData(); fd.append("on_air", on ? "true" : "false"); return api.post(`/admin/tracks/${id}/on-air`, fd); };
const setSlots = (id, slots) => api.patch(`/admin/tracks/${id}/broadcast-slot`, { slots });
const setCustom = (id, custom) => api.patch(`/admin/tracks/${id}/broadcast-slot`, { custom });
const setMeta = (id, body) => api.patch(`/admin/tracks/${id}/meta`, body);

/* ─── Toggle grande ON/OFF ─── */
function OnAirToggle({ on, busy, onChange, id }) {
  return (
    <button type="button" onClick={onChange} disabled={busy} data-testid={`act-onair-${short(id)}`}
      className="flex items-center gap-2 shrink-0 select-none" title={on ? "ON · in diretta. Clicca per sospendere" : "OFF · sospeso, il motore lo ignora. Clicca per rimettere in onda"}>
      <span className="relative inline-block w-14 h-7 rounded-full transition-colors duration-200"
        style={{ background: on ? "#10b981" : "#3f3f46", boxShadow: on ? "0 0 12px rgba(16,185,129,0.55)" : "none", opacity: busy ? 0.6 : 1 }}>
        <span className="absolute top-0.5 w-6 h-6 rounded-full bg-white transition-all duration-200" style={{ left: on ? 30 : 2 }} />
      </span>
      <span className="font-mono text-xs font-black w-8" style={{ color: on ? "#34d399" : "#f87171" }}>{on ? "ON" : "OFF"}</span>
    </button>
  );
}

/* ─── 6 fasce orarie, una sola attiva ─── */
function SlotPicker({ value, busy, onPick, id, size = "sm" }) {
  const list = Array.isArray(value) && value.length ? value : ["always"];
  const toggle = (k) => { const next = list.includes(k) ? list.filter((x) => x !== k) : [...list, k]; onPick(next.length ? next : ["always"]); };
  return (
    <div className="flex gap-1 flex-wrap shrink-0" data-testid={`act-slot-group-${short(id)}`} title="Fasce orarie (selezione multipla): il brano va in onda in tutte le fasce accese">
      {BROADCAST_SLOTS.map((s) => {
        const on = list.includes(s.k);
        return (
          <button key={s.k} type="button" onClick={() => toggle(s.k)} disabled={busy} data-testid={`act-slot-${s.k}-${short(id)}`}
            className={`rounded font-mono font-bold leading-tight ${size === "lg" ? "px-3 py-2 text-xs" : "px-1.5 py-1 text-[9px]"}`}
            style={on ? { background: s.col, color: "#000", boxShadow: `0 0 8px ${s.col}88` } : { border: `1px solid ${s.col}55`, color: s.col, opacity: 0.8 }}
            title={`${s.label} (${s.hours})`}>
            {s.label}<span className="opacity-70 ml-1">{s.hours}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ─── Orario personalizzato (si aggiunge alle fasce) ─── */
function CustomRange({ value, busy, onSave, id }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(value?.from || "");
  const [to, setTo] = useState(value?.to || "");
  useEffect(() => { setFrom(value?.from || ""); setTo(value?.to || ""); }, [value]);
  const sid = short(id);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} disabled={busy} data-testid={`act-custom-${sid}`} title="Orario personalizzato (dalle–alle), si aggiunge alle fasce"
        className="px-1.5 py-1 rounded font-mono text-[9px] font-bold shrink-0"
        style={value ? { background: "#7DD3FC", color: "#000" } : { border: "1px solid rgba(125,211,252,0.45)", color: "#7DD3FC", opacity: 0.85 }}>
        {value ? customLabel(value) : "⏱ ORARIO"}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1 shrink-0" data-testid={`act-custom-editor-${sid}`}>
      <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-black/60 border border-white/10 rounded px-1 py-0.5 text-[11px] text-white" data-testid={`act-custom-from-${sid}`} />
      <span className="text-[10px] text-zinc-500">–</span>
      <input type="time" value={to} onChange={(e) => setTo(e.target.value)} className="bg-black/60 border border-white/10 rounded px-1 py-0.5 text-[11px] text-white" data-testid={`act-custom-to-${sid}`} />
      <button type="button" disabled={busy || !from || !to} onClick={() => { onSave({ from, to }); setOpen(false); }} data-testid={`act-custom-save-${sid}`} className="px-1.5 py-0.5 rounded text-[10px] font-bold text-black" style={{ background: "#7DD3FC" }}>OK</button>
      {value && <button type="button" disabled={busy} onClick={() => { onSave(null); setOpen(false); }} data-testid={`act-custom-clear-${sid}`} className="px-1.5 py-0.5 rounded text-[10px] border border-red-400/50 text-red-300">rimuovi</button>}
      <button type="button" onClick={() => setOpen(false)} data-testid={`act-custom-cancel-${sid}`} className="px-1 py-0.5 rounded text-[10px] text-zinc-400">✕</button>
    </div>
  );
}

/* ─── Popup conferma eliminazione ─── */
function DeleteConfirm({ track, onCancel, onConfirm, busy }) {
  // #247410 · portal su document.body: un antenato con backdrop-filter faceva da riferimento al position:fixed e la finestra restava semi-coperta
  return createPortal((
    <div className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" data-testid="act-delete-modal">
      <div className="w-full max-w-md rounded-xl p-6 bg-[#0F0F14] border border-red-500/50" style={{ boxShadow: "0 0 30px rgba(239,68,68,0.3)" }}>
        <div className="label-mono text-red-400 mb-2 flex items-center gap-2"><Trash2 className="w-4 h-4" /> ELIMINAZIONE</div>
        <p className="text-white text-base leading-relaxed" data-testid="act-delete-text">
          Stai per eliminare: <strong className="text-red-300">{track.title || track.id}</strong>.<br />Questa azione è irreversibile.
        </p>
        <div className="flex gap-3 mt-6">
          <button type="button" onClick={onConfirm} disabled={busy} data-testid="act-delete-confirm"
            className="flex-1 px-4 py-3 rounded-lg font-black text-sm text-white" style={{ background: "#dc2626" }}>
            {busy ? "…" : "CONFERMA ELIMINAZIONE"}
          </button>
          <button type="button" onClick={onCancel} disabled={busy} data-testid="act-delete-cancel" className="flex-1 btn-outline font-bold text-sm">ANNULLA</button>
        </div>
      </div>
    </div>
  ), document.body);
}

/* ─── Pannello MATITA · tutti i campi, applicati solo su APPROVA E SALVA ─── */
function EditPanel({ track, onCancel, onSaved }) {
  const [f, setF] = useState({
    title: track.title || "", artist: track.artist || "", kind: track.kind || "song",
    genre_category: track.genre_category || "", bpm: track.bpm || "", broadcast_slots: trackSlots(track),
    custom_from: track.broadcast_custom?.from || "", custom_to: track.broadcast_custom?.to || "",
    on_air: track.on_air !== false, daypart_day: track.daypart_day !== false, daypart_night: track.daypart_night !== false,
    is_night_jingle: !!track.is_night_jingle,
  });
  const [busy, setBusy] = useState(false);
  const up = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const save = async () => {
    if (!f.title.trim()) return toast.error("Il nome è obbligatorio");
    setBusy(true);
    const ops = [];
    if (f.title.trim() !== (track.title || "") || f.artist.trim() !== (track.artist || "") || f.kind !== track.kind)
      ops.push(setMeta(track.id, { title: f.title.trim(), artist: f.artist.trim(), kind: f.kind }));
    if ((f.genre_category || null) !== (track.genre_category || null)) ops.push(endpoints.trackSetGenre(track.id, f.genre_category || null));
    const bpmV = f.bpm === "" ? null : parseInt(f.bpm, 10);
    if (bpmV !== (track.bpm || null)) ops.push(endpoints.trackSetBpm(track.id, bpmV, "manual"));
    const curCustom = track.broadcast_custom || null;
    const newCustom = f.custom_from && f.custom_to ? { from: f.custom_from, to: f.custom_to } : null;
    const customChanged = (curCustom?.from || "") !== (newCustom?.from || "") || (curCustom?.to || "") !== (newCustom?.to || "");
    if (!sameList(f.broadcast_slots, trackSlots(track)) || customChanged)
      ops.push(setMeta(track.id, { broadcast_slots: f.broadcast_slots, broadcast_custom: newCustom }));
    if (f.on_air !== (track.on_air !== false)) ops.push(setOnAir(track.id, f.on_air));
    if (f.daypart_day !== (track.daypart_day !== false) || f.daypart_night !== (track.daypart_night !== false))
      ops.push(endpoints.trackDaypart(track.id, f.daypart_day, f.daypart_night));
    if (f.is_night_jingle !== !!track.is_night_jingle) ops.push(endpoints.trackNightJingle(track.id, f.is_night_jingle));
    try {
      if (!ops.length) { toast("Nessuna modifica"); onCancel(); return; }
      await Promise.all(ops);
      toast.success(`Approvato e salvato: ${f.title.trim()}`);
      onSaved();
    } catch (e) { toast.error(e?.response?.data?.detail || "Errore salvataggio"); }
    finally { setBusy(false); }
  };

  const inp = "w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-white";
  // #247410 · portal su document.body: un antenato con backdrop-filter faceva da riferimento al position:fixed e la finestra restava semi-coperta
  return createPortal((
    <div className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" data-testid="act-edit-modal">
      <div className="w-full max-w-2xl rounded-xl p-6 bg-[#0F0F14] border border-cyan-500/40 max-h-[92vh] overflow-y-auto" style={{ boxShadow: "0 0 30px rgba(0,229,255,0.2)" }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="label-mono text-cyan-300 flex items-center gap-2"><Pencil className="w-4 h-4" /> MODIFICA BRANO</div>
            <div className="text-[10px] font-mono text-zinc-500 mt-1">id {track.id}</div>
          </div>
          <button type="button" onClick={onCancel} className="p-1 rounded hover:bg-white/10" data-testid="act-edit-close"><X className="w-4 h-4 text-zinc-400" /></button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-xs text-zinc-400 sm:col-span-2">Nome
            <input value={f.title} onChange={(e) => up("title", e.target.value)} className={inp} data-testid="act-edit-title" /></label>
          <label className="text-xs text-zinc-400">Artista
            <input value={f.artist} onChange={(e) => up("artist", e.target.value)} className={inp} data-testid="act-edit-artist" /></label>
          <label className="text-xs text-zinc-400">Categoria
            <select value={f.kind} onChange={(e) => up("kind", e.target.value)} className={inp} data-testid="act-edit-kind">
              {KINDS.map((k) => <option key={k.k} value={k.k}>{k.label}</option>)}
            </select></label>
          <label className="text-xs text-zinc-400">Genere (Archivio Pro)
            <select value={f.genre_category} onChange={(e) => up("genre_category", e.target.value)} className={inp} data-testid="act-edit-genre">
              <option value="">—</option>
              {GENRES.filter((g) => g.k !== "all" && g.k !== "night-mix").map((g) => <option key={g.k} value={g.k}>{g.label}</option>)}
            </select></label>
          <label className="text-xs text-zinc-400">BPM
            <input type="number" min={40} max={220} value={f.bpm} onChange={(e) => up("bpm", e.target.value)} placeholder="—" className={inp} data-testid="act-edit-bpm" /></label>
        </div>
        <div className="mt-4">
          <div className="text-xs text-zinc-400 mb-1.5">Fasce orarie (puoi accenderne più di una)</div>
          <SlotPicker value={f.broadcast_slots} onPick={(v) => up("broadcast_slots", v)} id={track.id + "-edit"} size="lg" />
          <div className="flex items-center gap-2 mt-3 text-xs text-zinc-400 flex-wrap">
            <span>Orario personalizzato (facoltativo, si aggiunge alle fasce):</span>
            <input type="time" value={f.custom_from} onChange={(e) => up("custom_from", e.target.value)} className="w-28 bg-black/60 border border-white/10 rounded px-2 py-1.5 text-sm text-white" data-testid="act-edit-custom-from" />
            <span>–</span>
            <input type="time" value={f.custom_to} onChange={(e) => up("custom_to", e.target.value)} className="w-28 bg-black/60 border border-white/10 rounded px-2 py-1.5 text-sm text-white" data-testid="act-edit-custom-to" />
            {(f.custom_from || f.custom_to) && <button type="button" onClick={() => { up("custom_from", ""); up("custom_to", ""); }} className="text-[10px] text-red-300 border border-red-400/40 rounded px-1.5 py-0.5" data-testid="act-edit-custom-clear">rimuovi</button>}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-5">
          <OnAirToggle on={f.on_air} onChange={() => up("on_air", !f.on_air)} id={track.id + "-edit"} />
          {f.kind === "jingle" ? (
            <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
              <input type="checkbox" checked={f.is_night_jingle} onChange={(e) => up("is_night_jingle", e.target.checked)} data-testid="act-edit-nightjingle" /> 🌙 Jingle notturno (22-04)
            </label>
          ) : (
            <>
              <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                <input type="checkbox" checked={f.daypart_day} onChange={(e) => up("daypart_day", e.target.checked)} data-testid="act-edit-daypart-day" /> ☀ Rotazione giorno (04-22)
              </label>
              <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                <input type="checkbox" checked={f.daypart_night} onChange={(e) => up("daypart_night", e.target.checked)} data-testid="act-edit-daypart-night" /> 🌙 Rotazione notte (22-04)
              </label>
            </>
          )}
        </div>
        <div className="text-[10px] font-mono text-zinc-500 mt-3">Nessuna modifica viene applicata finché il Direttore non approva.</div>
        <div className="flex gap-3 mt-5">
          <button type="button" onClick={save} disabled={busy} data-testid="act-edit-approve"
            className="flex-1 px-4 py-3 rounded-lg font-black text-sm text-black" style={{ background: "linear-gradient(135deg,#00E5FF,#3AE0FF)", boxShadow: "0 0 14px rgba(0,229,255,0.45)" }}>
            {busy ? "Salvo…" : "✔ APPROVA E SALVA"}
          </button>
          <button type="button" onClick={onCancel} disabled={busy} data-testid="act-edit-cancel" className="flex-1 btn-outline font-bold text-sm">ANNULLA</button>
        </div>
      </div>
    </div>
  ), document.body);
}

/* ─── Riga brano ─── */
function TrackRow({ t, selected, onSelect, previewing, onPreview, onEdit, onDelete, onReplace, onChanged, busyKey, setBusyKey }) {
  const sid = short(t.id);
  const isOn = t.on_air !== false;
  const kind = KINDS.find((k) => k.k === t.kind) || { label: t.kind, cls: "bg-white/10 text-white" };
  const run = async (key, fn, okMsg) => {
    setBusyKey(key);
    try { await fn(); if (okMsg) toast.success(okMsg); onChanged(); }
    catch (e) { toast.error(e?.response?.data?.detail || e?.message || "Errore"); }
    finally { setBusyKey(null); }
  };
  return (
    <div data-testid={`act-row-${sid}`} className={`rounded-lg border p-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 ${!isOn ? "opacity-60" : ""}`}
      style={{ background: selected ? "rgba(128,255,180,0.06)" : "rgba(255,255,255,0.03)", borderColor: selected ? "rgba(128,255,180,0.6)" : "rgba(255,255,255,0.08)" }}>
      <input type="checkbox" className="accent-emerald-400 shrink-0" checked={selected} disabled={!t.audio_url} onChange={onSelect} data-testid={`act-check-${sid}`} title="Seleziona per ZIP" />
      <div className="min-w-[220px] flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-white font-medium truncate" title={t.title}>{t.title}</span>
          <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase shrink-0 ${kind.cls}`}>{kind.label}</span>
          {t.is_pending_approval && <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/15 text-amber-300 shrink-0">⏳ approvazione</span>}
        </div>
        <div className="text-[10px] text-zinc-500 font-mono truncate">
          {t.artist} · {sid} · {t.duration_sec ? Math.floor(t.duration_sec) + "s" : "?"}{t.bpm ? ` · ${t.bpm} BPM` : ""} · <span className="text-cyan-300/80">{trackSlots(t).map(slotLabel).join(" + ")}{t.broadcast_custom ? ` + ${customLabel(t.broadcast_custom)}` : ""}</span>
        </div>
      </div>

      {/* 1 · TOGGLE */}
      <OnAirToggle on={isOn} id={t.id} busy={busyKey === `on-${t.id}`}
        onChange={() => run(`on-${t.id}`, () => setOnAir(t.id, !isOn), !isOn ? "Brano ON · in diretta" : "Brano OFF · sospeso, il motore lo ignora")} />
      {/* 2 · FASCIA */}
      <SlotPicker value={trackSlots(t)} id={t.id} busy={busyKey?.startsWith(`slot-${t.id}`)}
        onPick={(v) => !sameList(v, trackSlots(t)) && run(`slot-${t.id}`, () => setSlots(t.id, v), `${t.title}: ${v.map(slotLabel).join(" + ")}`)} />
      <CustomRange value={t.broadcast_custom || null} id={t.id} busy={busyKey === `custom-${t.id}`}
        onSave={(c) => run(`custom-${t.id}`, () => setCustom(t.id, c), c ? `${t.title}: orario ${c.from}–${c.to} aggiunto` : `${t.title}: orario personalizzato rimosso`)} />
      {/* 3 · MATITA */}
      <button type="button" onClick={onEdit} data-testid={`act-edit-${sid}`} title="Modifica (richiede approvazione)"
        className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-cyan-500/15 border border-cyan-400/50 text-cyan-200 hover:bg-cyan-500/30 transition">
        <Pencil className="w-4 h-4" />
      </button>
      {/* 4 · CESTINO */}
      <button type="button" onClick={onDelete} data-testid={`act-delete-${sid}`} title="Elimina (con conferma)"
        className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-red-500/15 border border-red-400/50 text-red-300 hover:bg-red-500/30 transition">
        <Trash2 className="w-4 h-4" />
      </button>

      {/* ── Pulsanti preesistenti, invariati ── */}
      <div className="flex items-center gap-2 flex-wrap">
        {t.kind === "fx" ? (
          <button data-testid={`play-live-${sid}`} onClick={() => run(`fx-${t.id}`, () => api.post(`/admin/fx/${t.id}/play-live`), `⚡ FX in onda: ${t.title}`)}
            className="inline-flex items-center gap-1 px-3 py-1 rounded bg-fuchsia-500/15 border border-fuchsia-400/60 text-fuchsia-200 text-xs font-mono uppercase hover:bg-fuchsia-500/30 transition"
            title="Spara subito questo FX su tutti i player pubblici">⚡ PLAY LIVE</button>
        ) : (
          <button data-testid={`preview-${sid}`} onClick={onPreview} title={previewing ? "Stop preview" : "Ascolta"}
            className={`inline-flex items-center justify-center w-8 h-8 rounded-full border transition ${previewing ? "bg-emerald-500/25 border-emerald-400 text-emerald-300" : "bg-white/5 border-white/15 text-white hover:bg-white/10"}`}>
            {previewing ? <PauseCircle className="w-4 h-4" /> : <PlayCircle className="w-4 h-4" />}
          </button>
        )}
        <a data-testid={`dl-${sid}`} href={downloadUrl(t.id)} download={`${(t.title || "track").replace(/[^a-z0-9\-_ ]/gi, "_").slice(0, 40)}.mp3`}
          className="inline-flex items-center gap-1 px-3 py-1 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs hover:bg-cyan-500/20 transition">
          <Download className="w-3 h-3" /> MP3</a>
        <button data-testid={`replace-${sid}`} onClick={onReplace}
          className="inline-flex items-center gap-1 px-3 py-1 rounded bg-pink-500/10 border border-pink-500/30 text-pink-300 text-xs hover:bg-pink-500/20 transition">
          <Replace className="w-3 h-3" /> Sostituisci</button>
        <select value={t.genre_category || ""} data-testid={`genre-${sid}`} title="Genere (Archivio Pro)"
          onChange={(e) => run(`genre-${t.id}`, () => endpoints.trackSetGenre(t.id, e.target.value || null))}
          className="bg-black/60 border border-white/10 rounded px-1 py-1 text-[10px] font-mono">
          <option value="">— genere</option>
          {GENRES.filter((g) => g.k !== "all" && g.k !== "night-mix").map((g) => <option key={g.k} value={g.k}>{g.label}</option>)}
        </select>
        <input type="number" min={40} max={220} defaultValue={t.bpm || ""} key={`bpm-${t.id}-${t.bpm}`} placeholder="BPM" data-testid={`bpm-${sid}`}
          title={t.bpm_source ? `Sorgente: ${t.bpm_source}` : "BPM non ancora rilevato"}
          onBlur={(e) => { const v = e.target.value ? parseInt(e.target.value, 10) : null; if (v !== (t.bpm || null)) run(`bpm-${t.id}`, () => endpoints.trackSetBpm(t.id, v, "manual")); }}
          className="bg-black/60 border border-white/10 rounded px-1 py-1 text-[10px] font-mono w-14 text-center" />
        {t.kind === "jingle" ? (
          <button data-testid={`night-jingle-${sid}`} onClick={() => run(`nj-${t.id}`, () => endpoints.trackNightJingle(t.id, !t.is_night_jingle), !t.is_night_jingle ? "Marcato jingle NOTTE" : "Rimosso dal set notte")}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono uppercase border transition"
            style={t.is_night_jingle ? { background: "rgba(0,229,255,0.15)", borderColor: "rgba(0,229,255,0.5)", color: "#00E5FF" } : { background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.1)", color: "#a1a1aa" }}
            title={t.is_night_jingle ? "Jingle notturno (22-04)" : "Marca come jingle notturno"}>{t.is_night_jingle ? "🌙 NOTTE" : "☀ Giorno"}</button>
        ) : (
          <div className="inline-flex gap-1">
            <button data-testid={`daypart-day-${sid}`} title="In rotazione 04-22 (giorno)"
              onClick={() => { const nd = !(t.daypart_day !== false); run(`dp-${t.id}`, () => endpoints.trackDaypart(t.id, nd, t.daypart_night !== false), `Giorno: ${nd ? "ON" : "OFF"}`); }}
              className="px-1.5 py-1 rounded text-[10px] font-mono border transition"
              style={(t.daypart_day !== false) ? { background: "rgba(255,184,77,0.18)", borderColor: "rgba(255,184,77,0.55)", color: "#FFB84D" } : { background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.1)", color: "#71717a" }}>☀</button>
            <button data-testid={`daypart-night-${sid}`} title="In rotazione 22-04 (notte)"
              onClick={() => { const nn = !(t.daypart_night !== false); run(`dp-${t.id}`, () => endpoints.trackDaypart(t.id, t.daypart_day !== false, nn), `Notte: ${nn ? "ON" : "OFF"}`); }}
              className="px-1.5 py-1 rounded text-[10px] font-mono border transition"
              style={(t.daypart_night !== false) ? { background: "rgba(80,80,255,0.18)", borderColor: "rgba(120,120,255,0.55)", color: "#B8B8FF" } : { background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.1)", color: "#71717a" }}>🌙</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Sezione principale ─── */
export default function ArchivioControlloTotale({ TrackModal }) {
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("all");
  const [genre, setGenre] = useState("all");
  const [modal, setModal] = useState(null);        // { kind: 'new'|'replace', target? }
  const [editing, setEditing] = useState(null);    // track
  const [deleting, setDeleting] = useState(null);  // track
  const [delBusy, setDelBusy] = useState(false);
  const [busyKey, setBusyKey] = useState(null);
  const [previewId, setPreviewId] = useState(null);
  const previewRef = useRef(null);
  const [selected, setSelected] = useState({});
  const [zipBusy, setZipBusy] = useState(false);
  const [zipLink, setZipLink] = useState(null);
  const [showResources, setShowResources] = useState(false);

  const load = useCallback(() => {
    api.get("/admin/tracks/searchable")
      .then((r) => setTracks(r.data?.tracks || []))
      .catch(() => setTracks([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); const iv = setInterval(load, 20000); return () => clearInterval(iv); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tracks
      .filter((t) => {
        if (cat === "pending") { if (!t.is_pending_approval) return false; }
        else if (cat !== "all" && t.kind !== cat) return false;
        if (genre === "night-mix") { if (!t.is_night_jingle) return false; }
        else if (genre !== "all" && (t.genre_category || "").toLowerCase() !== genre) return false;
        return !q || (t.title || "").toLowerCase().includes(q) || (t.artist || "").toLowerCase().includes(q);
      })
      .sort((a, b) => (a.title || "").localeCompare(b.title || "", "it", { sensitivity: "base" }) || (a.artist || "").localeCompare(b.artist || "", "it"));
  }, [tracks, search, cat, genre]);

  const togglePreview = (id) => {
    if (previewRef.current) { previewRef.current.pause(); previewRef.current = null; }
    if (previewId === id) { setPreviewId(null); return; }
    const a = new Audio(`${downloadUrl(id)}?t=${Date.now()}`);
    a.volume = 0.9;
    a.play().catch(() => toast.error("Preview: impossibile riprodurre"));
    a.addEventListener("ended", () => setPreviewId(null));
    previewRef.current = a; setPreviewId(id);
  };
  useEffect(() => () => { try { previewRef.current?.pause(); } catch {} }, []);

  const confirmDelete = async () => {
    setDelBusy(true);
    try { await endpoints.trackDelete(deleting.id); toast.success(`Eliminato: ${deleting.title}`); setDeleting(null); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Errore eliminazione"); }
    finally { setDelBusy(false); }
  };

  const selCount = Object.keys(selected).length;
  const toggleSel = (t) => setSelected((m) => { const n = { ...m }; if (n[t.id]) delete n[t.id]; else n[t.id] = { url: t.audio_url, title: `${t.artist || ""} - ${t.title || t.id}` }; return n; });
  const selectAllVisible = () => setSelected((m) => {
    const list = filtered.filter((t) => t.audio_url); const n = { ...m };
    const allOn = list.length > 0 && list.every((t) => n[t.id]);
    list.forEach((t) => { if (allOn) delete n[t.id]; else n[t.id] = { url: t.audio_url, title: `${t.artist || ""} - ${t.title || t.id}` }; });
    return n;
  });
  const downloadSelected = async () => {
    const items = Object.values(selected);
    if (!items.length) return toast.error("Seleziona almeno un file");
    setZipBusy(true); setZipLink(null);
    try {
      const d = (await api.post("/admin/assets/zip", { items })).data || {};
      setZipLink({ href: `${backend}${d.download_url}`, count: d.count, mb: (d.bytes / 1024 / 1024).toFixed(1), skipped: (d.skipped || []).length });
      toast.success(`ZIP pronto · ${d.count} file`);
    } catch (e) { toast.error(e?.response?.data?.detail || "Errore creazione ZIP"); }
    finally { setZipBusy(false); }
  };

  return (
    <section data-testid="archivio-controllo-totale" className="lg:col-span-4 rounded-xl p-5"
      style={{ background: "linear-gradient(180deg, rgba(0,229,255,0.04), rgba(10,0,25,0.9))", border: "1px solid rgba(0,229,255,0.28)", backdropFilter: "blur(10px)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <div className="label-mono flex items-center gap-2" style={{ color: "#00E5FF" }}><Music2 className="w-4 h-4 text-pink-400" /> ARCHIVIO BRANI · CONTROLLO TOTALE</div>
          <h2 className="font-display font-black text-2xl mt-1" data-testid="act-count">{loading ? "Carico…" : `${tracks.length} brani in libreria`}</h2>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button type="button" onClick={() => setShowResources((v) => !v)} data-testid="act-toggle-resources" className="btn-outline text-xs font-mono">
            {showResources ? "▴ Nascondi" : "▾ Upload MP3/MP4 · Cestino · Vocali"}
          </button>
          <button data-testid="add-new-track-btn" onClick={() => setModal({ kind: "new" })} className="btn-primary flex items-center gap-2"><Upload className="w-4 h-4" /> AGGIUNGI NUOVO</button>
        </div>
      </div>

      {/* Ricerca + filtro categoria in cima */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <input data-testid="act-search" type="text" placeholder="🔍 Cerca per nome o artista…" value={search} onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[240px] bg-zinc-900 border border-white/10 rounded px-3 py-2 text-sm text-white" />
        <div className="flex gap-1 flex-wrap" data-testid="act-category-filters">
          {CATEGORY_FILTERS.map((c) => {
            const n = c.k === "all" ? tracks.length : c.k === "pending" ? tracks.filter((t) => t.is_pending_approval).length : tracks.filter((t) => t.kind === c.k).length;
            return (
              <button key={c.k} type="button" onClick={() => setCat(c.k)} data-testid={`act-cat-${c.k}`}
                className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold tracking-wider"
                style={cat === c.k ? { background: "rgba(0,229,255,0.18)", border: "1px solid #00E5FF", color: "#BFF7FF" } : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)", color: "#9aa" }}>
                {c.label} <span className="opacity-60">({n})</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mb-2" data-testid="act-genre-filters">
        <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mr-1">Archivio:</span>
        {GENRES.map((g) => (
          <button key={g.k} type="button" onClick={() => setGenre(g.k)} data-testid={`act-genre-${g.k}`}
            className={`px-2.5 py-1 rounded text-[10px] font-mono uppercase border transition ${genre === g.k ? "border-cyan-400 text-cyan-300 bg-cyan-500/10" : "border-white/10 text-zinc-400 hover:border-white/20 hover:text-white"}`}>{g.label}</button>
        ))}
      </div>

      {/* Toolbar ZIP (preesistente) */}
      <div className="flex items-center gap-2 flex-wrap mb-2 p-2 rounded" data-testid="act-bulk-toolbar" style={{ background: "rgba(128,255,180,0.05)", border: "1px dashed rgba(128,255,180,0.35)" }}>
        <span className="text-xs text-zinc-500 font-mono">Mostrati: {filtered.length} / {tracks.length}</span>
        <button type="button" onClick={selectAllVisible} data-testid="act-select-all" className="px-2 py-1 rounded text-[11px] font-mono font-bold" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", color: "#ddd" }}>☑ Seleziona visibili</button>
        <button type="button" onClick={downloadSelected} disabled={zipBusy || selCount === 0} data-testid="act-download-zip" className="px-3 py-1 rounded text-[11px] font-mono font-bold text-black" style={{ background: selCount ? "#80FFB4" : "rgba(128,255,180,0.25)", opacity: zipBusy ? 0.6 : 1 }}>
          {zipBusy ? "⏳ Impacchetto…" : `⬇ SCARICA SELEZIONATI (${selCount})`}</button>
        {selCount > 0 && <button type="button" onClick={() => { setSelected({}); setZipLink(null); }} data-testid="act-clear-sel" className="px-2 py-1 rounded text-[11px] font-mono" style={{ color: "#FF6BAA", border: "1px solid rgba(255,45,149,0.4)" }}>✕ svuota</button>}
        {zipLink && <a href={zipLink.href} data-testid="act-zip-link" onClick={() => setTimeout(() => setZipLink(null), 4000)} className="text-[11px] font-mono font-bold underline" style={{ color: "#00E5FF" }}>📦 Scarica ZIP · {zipLink.count} file · {zipLink.mb} MB{zipLink.skipped ? ` · ${zipLink.skipped} saltati` : ""} (one-shot)</a>}
      </div>

      <div className="max-h-[640px] overflow-y-auto space-y-1.5 pr-1" data-testid="act-list">
        {filtered.length === 0 && <div className="text-zinc-500 text-sm py-8 text-center" data-testid="act-empty">{loading ? "Carico…" : "Nessun brano corrisponde ai filtri."}</div>}
        {filtered.map((t) => (
          <TrackRow key={t.id} t={t} selected={!!selected[t.id]} onSelect={() => toggleSel(t)}
            previewing={previewId === t.id} onPreview={() => togglePreview(t.id)}
            onEdit={() => setEditing(t)} onDelete={() => setDeleting(t)} onReplace={() => setModal({ kind: "replace", target: t })}
            onChanged={load} busyKey={busyKey} setBusyKey={setBusyKey} />
        ))}
      </div>

      {showResources && (
        <div className="mt-4 pt-4 border-t border-white/10" data-testid="act-resources">
          <MagazzinoUniversale embedded />
        </div>
      )}

      {modal && TrackModal && <TrackModal mode={modal.kind} target={modal.target} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
      {editing && <EditPanel track={editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {deleting && <DeleteConfirm track={deleting} busy={delBusy} onCancel={() => setDeleting(null)} onConfirm={confirmDelete} />}
    </section>
  );
}
