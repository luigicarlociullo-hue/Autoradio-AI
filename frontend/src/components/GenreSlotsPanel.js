import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useGenres, createGenreInteractive, loadGenres } from "./ArchivioControlloTotale";

/* v13.80 · GENERI E FASCE ORARIE — regole "HH:MM–HH:MM → uno o più generi".
   In fascia attiva il clock sceglie solo brani di quei generi (fallback alla rotazione normale se vuoto)
   e le generazioni Suno automatiche usano il nome del genere. Player e segnale orario non toccati. */
const DAYS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

export default function GenreSlotsPanel() {
  const genres = useGenres();
  const [slots, setSlots] = useState([]);
  const [activeSlugs, setActiveSlugs] = useState([]);
  const [form, setForm] = useState({ start: "14:00", end: "18:00", genre_slugs: [], days: [], label: "" });
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);

  const load = async () => {
    try { const r = await api.get("/admin/genre-slots"); setSlots(r.data.slots || []); setActiveSlugs(r.data.active_genre_slugs || []); } catch {}
  };
  useEffect(() => { load(); loadGenres(); const iv = setInterval(load, 60000); return () => clearInterval(iv); }, []);

  const toggleIn = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const create = async () => {
    if (!form.genre_slugs.length) return toast.error("Seleziona almeno un genere");
    setBusy(true);
    try { await api.post("/admin/genre-slots", form); toast.success("Fascia creata"); setForm((f) => ({ ...f, genre_slugs: [], label: "" })); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Errore"); }
    finally { setBusy(false); }
  };
  const toggleActive = async (sl) => { try { await api.patch(`/admin/genre-slots/${sl.id}`, { active: !(sl.active !== false) }); load(); } catch { toast.error("Errore"); } };
  const remove = async (id) => { try { await api.delete(`/admin/genre-slots/${id}`); setConfirmDel(null); toast.success("Fascia eliminata"); load(); } catch { toast.error("Errore"); } };
  const deleteGenre = async (g) => {
    if (!window.confirm(`Eliminare il genere "${g.label}"? Possibile solo se nessun brano lo usa.`)) return;
    try { await api.delete(`/admin/genres/${g.id}`); toast.success("Genere eliminato"); loadGenres(); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Errore"); }
  };
  const nameOf = (slug) => genres.find((g) => g.k === slug)?.label || slug;

  return (
    <section className="lg:col-span-4 card-surface p-5" data-testid="genre-slots-panel">
      <div className="label-mono" style={{ color: "#00E5FF" }}>◂ GENERI E FASCE ORARIE ▸</div>
      <h2 className="font-display font-black text-xl mt-1 text-white">Generi e fasce orarie</h2>
      <p className="text-xs text-zinc-400 mt-1">In fascia il clock sceglie solo brani di questi generi (se non ce ne sono, rotazione normale) e le generazioni Suno usano il genere. Fuori fascia tutto come oggi.</p>

      {/* Elenco generi */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5" data-testid="genre-list">
        <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mr-1">Generi:</span>
        {genres.map((g) => (
          <span key={g.k} className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono border border-white/10 text-zinc-200" data-testid={`genre-chip-${g.k}`}
            style={activeSlugs.includes(g.k) ? { borderColor: "#00E5FF", color: "#7DF9FF", background: "rgba(0,229,255,0.08)" } : {}}>
            {g.label} <span className="text-zinc-500">{g.tracks}</span>
            {!g.tracks && <button type="button" onClick={() => deleteGenre(g)} className="text-red-300 ml-1" title="Elimina genere" data-testid={`genre-delete-${g.k}`}>✕</button>}
          </span>
        ))}
        <button type="button" onClick={createGenreInteractive} data-testid="genre-new"
          className="px-2.5 py-1 rounded text-[10px] font-mono uppercase border border-dashed border-cyan-400/40 text-cyan-300 hover:bg-cyan-500/10">＋ Nuovo genere</button>
      </div>

      {/* Nuova fascia */}
      <div className="mt-4 rounded-lg p-3 border border-white/10 bg-black/40" data-testid="genre-slot-form">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-zinc-400">Dalle<br /><input type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} className="bg-black/60 border border-white/10 rounded px-2 py-1 text-sm text-white" data-testid="genre-slot-start" /></label>
          <label className="text-xs text-zinc-400">Alle<br /><input type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} className="bg-black/60 border border-white/10 rounded px-2 py-1 text-sm text-white" data-testid="genre-slot-end" /></label>
          <label className="text-xs text-zinc-400 flex-1 min-w-[140px]">Etichetta (opz.)<br /><input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="es. Pomeriggio Pop" className="w-full bg-black/60 border border-white/10 rounded px-2 py-1 text-sm text-white" data-testid="genre-slot-label" /></label>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5" data-testid="genre-slot-genres">
          {genres.map((g) => (
            <button key={g.k} type="button" onClick={() => setForm({ ...form, genre_slugs: toggleIn(form.genre_slugs, g.k) })} data-testid={`genre-slot-pick-${g.k}`}
              className={`px-2.5 py-1 rounded text-[10px] font-mono uppercase border ${form.genre_slugs.includes(g.k) ? "border-cyan-400 text-cyan-300 bg-cyan-500/10" : "border-white/10 text-zinc-400"}`}>{g.label}</button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-mono text-zinc-500 mr-1">Giorni (vuoto = tutti):</span>
          {DAYS.map((d, i) => (
            <button key={d} type="button" onClick={() => setForm({ ...form, days: toggleIn(form.days, i) })} data-testid={`genre-slot-day-${i}`}
              className={`px-2 py-0.5 rounded text-[10px] font-mono border ${form.days.includes(i) ? "border-amber-400 text-amber-300" : "border-white/10 text-zinc-500"}`}>{d}</button>
          ))}
          <button type="button" onClick={create} disabled={busy} data-testid="genre-slot-create" className="ml-auto btn-primary text-xs">＋ Aggiungi fascia</button>
        </div>
      </div>

      {/* Fasce esistenti */}
      <div className="mt-3 space-y-1.5" data-testid="genre-slot-list">
        {slots.length === 0 && <div className="text-xs text-zinc-500 py-2">Nessuna fascia: la rotazione non è filtrata per genere.</div>}
        {slots.map((sl) => (
          <div key={sl.id} className="flex flex-wrap items-center gap-2 rounded px-3 py-2 border" data-testid={`genre-slot-${sl.id}`}
            style={{ borderColor: sl.is_active_now ? "#00E5FF" : "rgba(255,255,255,0.1)", background: sl.active === false ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.35)", opacity: sl.active === false ? 0.6 : 1 }}>
            <span className="font-mono text-sm text-white">{sl.start}–{sl.end}</span>
            <span className="text-xs text-cyan-200">{(sl.genre_slugs || []).map(nameOf).join(" · ")}</span>
            {sl.label && <span className="text-[10px] font-mono text-zinc-500">{sl.label}</span>}
            {!!(sl.days || []).length && <span className="text-[10px] font-mono text-amber-300">{sl.days.map((d) => DAYS[d]).join(" ")}</span>}
            {sl.is_active_now && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "#00E5FF", color: "#000" }}>ATTIVA ORA</span>}
            <div className="ml-auto flex items-center gap-1.5">
              <button type="button" onClick={() => toggleActive(sl)} className="text-[10px] font-mono px-2 py-1 rounded border border-white/15 text-zinc-200" data-testid={`genre-slot-toggle-${sl.id}`}>{sl.active === false ? "Attiva" : "Sospendi"}</button>
              {confirmDel === sl.id ? (
                <>
                  <button type="button" onClick={() => remove(sl.id)} className="text-[10px] font-mono px-2 py-1 rounded bg-red-600 text-white" data-testid={`genre-slot-delete-yes-${sl.id}`}>Sì, elimina</button>
                  <button type="button" onClick={() => setConfirmDel(null)} className="text-[10px] font-mono px-2 py-1 rounded border border-white/15 text-zinc-300">Annulla</button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmDel(sl.id)} className="text-[10px] font-mono px-2 py-1 rounded border border-red-400/40 text-red-300" data-testid={`genre-slot-delete-${sl.id}`}>✕</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
