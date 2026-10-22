import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useGenres, createGenreInteractive, loadGenres } from "./ArchivioControlloTotale";

/* v13.81 · CONTENITORI NOTTURNI (LUMA / HEX / NYX) — blocchi a orario fisso con nome, fascia,
   generi ammessi, intervallo BPM, jingle propri e DJ propri. In contenitore il clock pesca solo
   brani di quei generi/BPM in progressione BPM crescente e usa solo i suoi jingle e DJ. */
const EMPTY = { name: "", start: "22:00", end: "00:00", genre_slugs: [], bpm_min: "", bpm_max: "", jingle_ids: [], dj_ids: [], color: "#7DF9FF", description: "" };
const toggleIn = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

function ContainerEditor({ initial, genres, jingles, djs, onClose, onSaved }) {
  const [f, setF] = useState({ ...EMPTY, ...initial, bpm_min: initial?.bpm_min ?? "", bpm_max: initial?.bpm_max ?? "" });
  const [busy, setBusy] = useState(false);
  const [jq, setJq] = useState("");
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const save = async () => {
    if (!f.name.trim()) return toast.error("Nome richiesto");
    if (!f.genre_slugs.length) return toast.error("Seleziona almeno un genere");
    setBusy(true);
    const body = { ...f, bpm_min: f.bpm_min === "" ? null : Number(f.bpm_min), bpm_max: f.bpm_max === "" ? null : Number(f.bpm_max) };
    try {
      if (initial?.id) await api.patch(`/admin/containers/${initial.id}`, body);
      else await api.post("/admin/containers", body);
      toast.success(initial?.id ? "Contenitore aggiornato" : "Contenitore creato");
      onSaved();
    } catch (e) { toast.error(e?.response?.data?.detail || "Errore"); }
    finally { setBusy(false); }
  };
  const jList = jingles.filter((j) => !jq || `${j.title} ${j.artist || ""}`.toLowerCase().includes(jq.toLowerCase()));
  const inp = "bg-black/60 border border-white/10 rounded px-2 py-1 text-sm text-white";
  return (
    <div className="mt-3 rounded-lg p-3 border bg-black/50" style={{ borderColor: `${f.color}66` }} data-testid="container-editor">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-zinc-400">Nome<br /><input value={f.name} onChange={(e) => set("name", e.target.value.toUpperCase())} placeholder="LUMA" className={`${inp} w-28 font-display font-black`} data-testid="container-name" /></label>
        <label className="text-xs text-zinc-400">Dalle<br /><input type="time" value={f.start} onChange={(e) => set("start", e.target.value)} className={inp} data-testid="container-start" /></label>
        <label className="text-xs text-zinc-400">Alle<br /><input type="time" value={f.end} onChange={(e) => set("end", e.target.value)} className={inp} data-testid="container-end" /></label>
        <label className="text-xs text-zinc-400">BPM min<br /><input type="number" min={40} max={220} value={f.bpm_min} onChange={(e) => set("bpm_min", e.target.value)} className={`${inp} w-20`} data-testid="container-bpm-min" /></label>
        <label className="text-xs text-zinc-400">BPM max<br /><input type="number" min={40} max={220} value={f.bpm_max} onChange={(e) => set("bpm_max", e.target.value)} className={`${inp} w-20`} data-testid="container-bpm-max" /></label>
        <label className="text-xs text-zinc-400">Colore<br /><input type="color" value={f.color} onChange={(e) => set("color", e.target.value)} className="h-8 w-10 bg-transparent border border-white/10 rounded" data-testid="container-color" /></label>
        <label className="text-xs text-zinc-400 flex-1 min-w-[160px]">Descrizione (opz.)<br /><input value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="es. Deep house e brani più leggeri" className={`${inp} w-full`} data-testid="container-description" /></label>
      </div>

      <div className="mt-3 text-[10px] font-mono uppercase tracking-widest text-zinc-500">Generi ammessi</div>
      <div className="mt-1 flex flex-wrap gap-1.5" data-testid="container-genres">
        {genres.map((g) => (
          <button key={g.k} type="button" onClick={() => set("genre_slugs", toggleIn(f.genre_slugs, g.k))} data-testid={`container-genre-${g.k}`}
            className={`px-2.5 py-1 rounded text-[10px] font-mono uppercase border ${f.genre_slugs.includes(g.k) ? "border-cyan-400 text-cyan-300 bg-cyan-500/10" : "border-white/10 text-zinc-400"}`}>{g.label} <span className="opacity-50">{g.tracks}</span></button>
        ))}
        <button type="button" onClick={async () => { const s = await createGenreInteractive(); if (s) set("genre_slugs", [...f.genre_slugs, s]); }} className="px-2.5 py-1 rounded text-[10px] font-mono uppercase border border-dashed border-cyan-400/40 text-cyan-300" data-testid="container-genre-new">＋ Nuovo genere</button>
      </div>

      <div className="mt-3 text-[10px] font-mono uppercase tracking-widest text-zinc-500">DJ / vocali propri <span className="normal-case text-zinc-600">(vuoto = DJ di oggi)</span></div>
      <div className="mt-1 flex flex-wrap gap-1.5" data-testid="container-djs">
        {djs.map((d) => (
          <button key={d.id} type="button" onClick={() => set("dj_ids", toggleIn(f.dj_ids, d.id))} data-testid={`container-dj-${d.id}`}
            className={`px-2.5 py-1 rounded text-[10px] font-mono border ${f.dj_ids.includes(d.id) ? "border-fuchsia-400 text-fuchsia-200 bg-fuchsia-500/10" : "border-white/10 text-zinc-400"}`}>🎙 {d.name}{d.night_slot ? ` · notte ${d.night_slot}` : ""}</button>
        ))}
        {!djs.length && <span className="text-xs text-zinc-500">Nessun DJ configurato</span>}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">Jingle propri <span className="normal-case text-zinc-600">(vuoto = nessun jingle in contenitore)</span></span>
        <input value={jq} onChange={(e) => setJq(e.target.value)} placeholder="cerca jingle…" className={`${inp} ml-auto w-40 !text-xs`} data-testid="container-jingle-search" />
      </div>
      <div className="mt-1 max-h-40 overflow-y-auto rounded border border-white/10 divide-y divide-white/5" data-testid="container-jingles">
        {jList.slice(0, 80).map((j) => (
          <label key={j.id} className="flex items-center gap-2 px-2 py-1 text-xs text-zinc-200 cursor-pointer hover:bg-white/5">
            <input type="checkbox" checked={f.jingle_ids.includes(j.id)} onChange={() => set("jingle_ids", toggleIn(f.jingle_ids, j.id))} data-testid={`container-jingle-${j.id}`} />
            <span className="truncate">{j.title}</span>
            {j.is_night_jingle && <span className="text-[9px] text-indigo-300">🌙</span>}
            <span className="ml-auto text-[10px] font-mono text-zinc-500">{j.duration_sec ? `${Math.round(j.duration_sec)}s` : ""}</span>
          </label>
        ))}
        {!jList.length && <div className="px-2 py-2 text-xs text-zinc-500">Nessun jingle nel Magazzino</div>}
      </div>
      <div className="mt-1 text-[10px] font-mono text-zinc-500">{f.jingle_ids.length} jingle selezionati</div>

      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={save} disabled={busy} className="btn-primary text-xs" data-testid="container-save">{busy ? "Salvo…" : initial?.id ? "Salva modifiche" : "＋ Crea contenitore"}</button>
        <button type="button" onClick={onClose} className="text-xs text-zinc-400 hover:text-white" data-testid="container-cancel">Annulla</button>
      </div>
    </div>
  );
}

function ContainerRow({ c, onEdit, onToggle, onDelete }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="rounded-lg px-3 py-2.5 border" data-testid={`container-${c.id}`}
      style={{ borderColor: c.is_active_now ? c.color : `${c.color}44`, background: c.active === false ? "rgba(255,255,255,0.02)" : `${c.color}0d`, opacity: c.active === false ? 0.55 : 1, boxShadow: c.is_active_now ? `0 0 14px ${c.color}66` : "none" }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display font-black text-lg tracking-widest" style={{ color: c.color }} data-testid={`container-name-${c.id}`}>{c.name}</span>
        <span className="font-mono text-sm text-white">{c.start}–{c.end}</span>
        {c.is_active_now && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded font-bold" style={{ background: c.color, color: "#000" }} data-testid={`container-active-now-${c.id}`}>IN ONDA ORA</span>}
        {c.active === false && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-white/15 text-zinc-400">SOSPESO</span>}
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={onEdit} className="text-[10px] font-mono px-2 py-1 rounded border border-white/15 text-zinc-200" data-testid={`container-edit-${c.id}`}>Modifica</button>
          <button type="button" onClick={onToggle} className="text-[10px] font-mono px-2 py-1 rounded border border-white/15 text-zinc-200" data-testid={`container-toggle-${c.id}`}>{c.active === false ? "Attiva" : "Sospendi"}</button>
          {confirm ? (
            <>
              <button type="button" onClick={onDelete} className="text-[10px] font-mono px-2 py-1 rounded bg-red-600 text-white" data-testid={`container-delete-yes-${c.id}`}>Sì, elimina</button>
              <button type="button" onClick={() => setConfirm(false)} className="text-[10px] font-mono px-2 py-1 rounded border border-white/15 text-zinc-300">Annulla</button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirm(true)} className="text-[10px] font-mono px-2 py-1 rounded border border-red-400/40 text-red-300" data-testid={`container-delete-${c.id}`}>✕</button>
          )}
        </div>
      </div>
      {c.description && <div className="text-[11px] text-zinc-400 mt-0.5">{c.description}</div>}
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-mono text-zinc-300">
        <span>🎵 {(c.genre_names || []).join(" · ") || "—"}</span>
        <span>⏱ {c.bpm_min ?? "…"}–{c.bpm_max ?? "…"} BPM</span>
        <span title="brani del genere / di cui nel range BPM">📀 {c.tracks_eligible}/{c.tracks_genre} brani eleggibili</span>
        <span>🔔 {c.jingles?.length || 0} jingle{!c.jingles?.length && <span className="text-amber-300"> (nessun jingle in contenitore)</span>}</span>
        <span>🎙 {(c.djs || []).map((d) => d.name).join(", ") || <span className="text-zinc-500">DJ di oggi</span>}</span>
      </div>
    </div>
  );
}

export default function ContainersPanel() {
  const genres = useGenres();
  const [items, setItems] = useState([]);
  const [jingles, setJingles] = useState([]);
  const [djs, setDjs] = useState([]);
  const [editing, setEditing] = useState(null); // null | {} (nuovo) | container

  const load = async () => {
    try { const r = await api.get("/admin/containers"); setItems(r.data.containers || []); } catch {}
  };
  useEffect(() => {
    load(); loadGenres();
    api.get("/admin/tracks/searchable").then((r) => setJingles((r.data.tracks || []).filter((t) => t.kind === "jingle" || t.is_jingle))).catch(() => {});
    api.get("/djs").then((r) => setDjs(Array.isArray(r.data) ? r.data : (r.data?.djs || []))).catch(() => {});
    const iv = setInterval(load, 60000);
    return () => clearInterval(iv);
  }, []);

  const toggle = async (c) => { try { await api.patch(`/admin/containers/${c.id}`, { active: c.active === false }); load(); } catch { toast.error("Errore"); } };
  const remove = async (c) => { try { await api.delete(`/admin/containers/${c.id}`); toast.success("Contenitore eliminato"); load(); } catch { toast.error("Errore"); } };

  return (
    <section className="lg:col-span-4 card-surface p-5" data-testid="containers-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="label-mono" style={{ color: "#C89AFF" }}>◂ CONTENITORI NOTTURNI ▸</div>
          <h2 className="font-display font-black text-xl mt-1 text-white">Contenitori · LUMA / HEX / NYX</h2>
          <p className="text-xs text-zinc-400 mt-1">Blocchi a orario fisso: in contenitore il clock pesca solo brani dei generi ammessi nel range BPM, in progressione BPM crescente, e usa solo i jingle e i DJ del contenitore. Senza brani nel range → solo generi → rotazione normale (mai silenzio). Fuori dai contenitori tutto come oggi.</p>
        </div>
        <button type="button" onClick={() => setEditing({})} className="btn-primary text-xs whitespace-nowrap" data-testid="container-new">＋ Nuovo contenitore</button>
      </div>

      {editing && (
        <ContainerEditor key={editing.id || "new"} initial={editing.id ? editing : null} genres={genres} jingles={jingles} djs={djs}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}

      <div className="mt-3 space-y-2" data-testid="container-list">
        {items.length === 0 && <div className="text-xs text-zinc-500 py-2">Nessun contenitore: la notte segue la rotazione normale.</div>}
        {items.map((c) => (
          <ContainerRow key={c.id} c={c} onEdit={() => setEditing(c)} onToggle={() => toggle(c)} onDelete={() => remove(c)} />
        ))}
      </div>
    </section>
  );
}
