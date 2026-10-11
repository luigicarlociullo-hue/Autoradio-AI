import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";
import { Sparkles, Save, FolderOpen, Trash2 } from "lucide-react";

/* v13.54 · APPUNTAMENTO LIBERO — ogni campo è facoltativo; ciò che non imposti
   viene ignorato. Nessuna generazione alla creazione: Suno / voce DJ solo quando
   l'appuntamento va in onda e solo se i relativi interruttori sono accesi. */

const PINK = "#FF6BAA";
const DAYS = [["Lun", 0], ["Mar", 1], ["Mer", 2], ["Gio", 3], ["Ven", 4], ["Sab", 5], ["Dom", 6]];
const SOURCES = [
  { k: "disco_del_giorno", label: "💿 Disco del Giorno", hint: "Suno ON → nuova canzone con genere/mood/lingua, generata in anticipo. Suno OFF → uno degli ultimi brani pronti del Magazzino." },
  { k: "umani_vs_algoritmo", label: "🧑‍🎤 Umani vs Algoritmo", hint: "Un brano a caso tra quelli inviati dagli ascoltatori e approvati (ON)." },
  { k: "fixed", label: "🎵 Brano fisso", hint: "Un brano preciso scelto dal Magazzino." },
];
const toLocalInput = (d) => { const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const emptyForm = () => {
  const t = new Date(); t.setMinutes(t.getMinutes() + 10, 0, 0);
  return {
    name: "", description: "", when: toLocalInput(t), recurring: false,
    rr_days: [0, 1, 2, 3, 4, 5, 6], rr_start_hour: 6, rr_end_hour: 22, rr_anchor_minute: 0, rr_freq_value: 1, rr_freq_unit: "hours",
    rr_start_date: "", rr_end_date: "",
    max_duration_sec: "", jingle_before_id: "", jingle_after_id: "",
    source: "disco_del_giorno", fixed_track_id: "", suno_genre: "", suno_mood: "", suno_lang: "it", suno_lead_minutes: 20,
    dj_id: "", dj_comment: "",
    video_url: "",   // LedWall durante l'appuntamento: "" | "fx:effects" | url video
  };
};
const inp = "w-full bg-black/60 border border-white/10 rounded px-2 py-1.5 text-sm text-white";
const lbl = "label-mono block mb-1 text-zinc-400";

function PickTrack({ list, value, onChange, placeholder, testid, onRefresh }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return list.filter((t) => !s || (t.title || "").toLowerCase().includes(s) || (t.artist || "").toLowerCase().includes(s)).slice(0, 1000);
  }, [list, q]);
  return (
    <div className="flex gap-1 min-w-0">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="cerca…" className="w-24 shrink-0 bg-black/60 border border-white/10 rounded px-2 py-1.5 text-sm text-white" data-testid={`${testid}-search`} />
      <select value={value} onChange={(e) => onChange(e.target.value)} onFocus={() => onRefresh && onRefresh()} className={`${inp} flex-1 min-w-0`} data-testid={testid}>
        <option value="">{placeholder}</option>
        {shown.map((t) => <option key={t.id} value={t.id}>{t.kind === "appointment_jingle" || t.is_appointment_jingle ? "✨ " : (t.kind && t.kind !== "jingle" ? `[${t.kind}] ` : "")}{t.title}{t.artist ? ` · ${t.artist}` : ""}{t.duration_sec ? ` (${Math.round(t.duration_sec)}s)` : ""}</option>)}
      </select>
    </div>
  );
}

export default function AppuntamentoLiberoForm({ sources = [], djs = [], onCreated, onRefreshSources }) {
  const [f, setF] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const [presets, setPresets] = useState([]);
  const [presetName, setPresetName] = useState("");
  const [status, setStatus] = useState({ suno: null, talk: null, community: null });
  const [videos, setVideos] = useState([]);
  const up = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const loadPresets = useCallback(() => api.get("/admin/timeline/presets").then((r) => setPresets(r.data?.items || [])).catch(() => {}), []);
  useEffect(() => {
    loadPresets();
    api.get("/admin/ai-controls").then((r) => setStatus((s) => ({ ...s, suno: !!r.data?.controls?.ai_suno_engine, talk: !!r.data?.controls?.ai_openai_talk }))).catch(() => {});
    api.get("/community/wall").then((r) => setStatus((s) => ({ ...s, community: (r.data?.tracks || []).length }))).catch(() => {});
    api.get("/admin/ledwall/videos").then((r) => setVideos(r.data?.videos || [])).catch(() => {});
  }, [loadPresets]);

  // #247410 · pre/post: TUTTI i file audio del Magazzino — prima le Sigle Appuntamenti, poi i jingle, poi il resto
  const _rank = (t) => (t.kind === "appointment_jingle" || t.is_appointment_jingle ? 0 : t.kind === "jingle" ? 1 : 2);
  const jingles = useMemo(() => sources.filter((t) => t.audio_url).sort((a, b) => _rank(a) - _rank(b)), [sources]);
  const songs = useMemo(() => sources.filter((t) => (t.kind === "song" || !t.kind) && t.audio_url), [sources]);
  const byId = (id) => sources.find((t) => t.id === id);
  const jingleSpec = (id) => { const t = byId(id); return t ? { audio_url: t.audio_url, title: t.title, artist: t.artist, duration_sec: Math.max(1, Math.round(t.duration_sec || 10)) } : null; };

  const appointmentPayload = () => ({
    description: f.description || undefined,
    source: f.source,
    fixed_track_id: f.source === "fixed" ? (f.fixed_track_id || undefined) : undefined,
    suno_genre: f.suno_genre || undefined, suno_mood: f.suno_mood || undefined, suno_lang: f.suno_lang || "it",
    suno_lead_minutes: Number(f.suno_lead_minutes) || 20,
    jingle_before: jingleSpec(f.jingle_before_id), jingle_after: jingleSpec(f.jingle_after_id),
    dj_present: !!f.dj_id, dj_comment: f.dj_comment || undefined,
    max_duration_sec: f.max_duration_sec ? Number(f.max_duration_sec) : undefined,
  });

  const submit = async () => {
    if (f.source === "fixed" && !f.fixed_track_id) return toast.error("Scegli il brano fisso dal Magazzino");
    if (!f.recurring && !f.when) return toast.error("Imposta data e ora");
    setBusy(true);
    try {
      const base = { kind: "appointment", title: f.name || undefined, dj_id: f.dj_id || undefined, appointment: appointmentPayload(), duration_sec: f.max_duration_sec ? Number(f.max_duration_sec) : undefined, video_url: f.video_url || undefined };
      if (f.recurring) {
        const freq = Math.max(1, Number(f.rr_freq_value) || 1) * (f.rr_freq_unit === "hours" ? 60 : 1);
        const r = await api.post("/admin/timeline/rrule", { ...base, rrule: {
          days_of_week: f.rr_days, start_hour: Number(f.rr_start_hour), end_hour: Number(f.rr_end_hour), anchor_minute: Number(f.rr_anchor_minute),
          frequency_minutes: freq, start_date: f.rr_start_date || undefined, end_date: f.rr_end_date || undefined } });
        toast.success(`✨ Appuntamento ricorrente creato · ogni ${freq} min · ${f.rr_start_hour}:00→${f.rr_end_hour}:00`);
        void r;
      } else {
        await api.post("/admin/timeline", { ...base, scheduled_at: new Date(f.when).toISOString() });
        toast.success(`✨ Appuntamento "${f.name || "Appuntamento"}" inserito`);
      }
      onCreated?.();
    } catch (e) { toast.error(e?.response?.data?.detail || "Errore creazione appuntamento"); }
    finally { setBusy(false); }
  };

  const savePreset = async () => {
    const name = presetName.trim() || f.name.trim();
    if (!name) return toast.error("Dai un nome al modello");
    try { await api.post("/admin/timeline/presets", { name, payload: { ...f, when: undefined } }); toast.success(`Modello "${name}" salvato`); setPresetName(""); loadPresets(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Errore salvataggio modello"); }
  };
  const loadPreset = (id) => { const p = presets.find((x) => x.id === id); if (!p) return; setF({ ...emptyForm(), ...p.payload, when: emptyForm().when }); toast(`Modello "${p.name}" caricato`); };
  const deletePreset = async (id) => { try { await api.delete(`/admin/timeline/presets/${id}`); loadPresets(); } catch { toast.error("Errore eliminazione modello"); } };

  const srcInfo = SOURCES.find((s) => s.k === f.source);
  return (
    <div className="rounded-lg p-3 mb-4" style={{ background: "rgba(255,107,170,0.05)", border: "1px solid rgba(255,107,170,0.35)" }} data-testid="appuntamento-libero">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <button type="button" onClick={() => setOpen((v) => !v)} className="label-mono flex items-center gap-2" style={{ color: PINK }} data-testid="appt-toggle">
          <Sparkles className="w-4 h-4" /> ✨ APPUNTAMENTO LIBERO {open ? "▴" : "▾"}
        </button>
        <div className="flex items-center gap-2 text-[10px] font-mono">
          <span className="px-2 py-0.5 rounded" style={{ background: status.suno ? "rgba(128,255,180,0.15)" : "rgba(255,255,255,0.05)", color: status.suno ? "#80FFB4" : "#888" }} data-testid="appt-status-suno">Suno {status.suno == null ? "…" : status.suno ? "ON" : "OFF"}</span>
          <span className="px-2 py-0.5 rounded" style={{ background: status.talk ? "rgba(128,255,180,0.15)" : "rgba(255,255,255,0.05)", color: status.talk ? "#80FFB4" : "#888" }} data-testid="appt-status-talk">Voci DJ {status.talk == null ? "…" : status.talk ? "ON" : "OFF"}</span>
          <span className="px-2 py-0.5 rounded bg-white/5 text-zinc-400" data-testid="appt-status-community">Community ON: {status.community ?? "…"}</span>
        </div>
      </div>
      {!open ? null : (
        <div className="mt-3 space-y-3">
          {/* Modelli */}
          <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="appt-presets">
            <FolderOpen className="w-4 h-4 text-zinc-400" />
            <select onChange={(e) => { loadPreset(e.target.value); e.target.value = ""; }} defaultValue="" className={`${inp} w-auto`} data-testid="appt-preset-load">
              <option value="">Carica modello…</option>
              {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {presets.length > 0 && (
              <select onChange={(e) => { if (e.target.value) deletePreset(e.target.value); e.target.value = ""; }} defaultValue="" className={`${inp} w-auto`} data-testid="appt-preset-delete" title="Elimina modello">
                <option value="">🗑 Elimina modello…</option>
                {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="nome modello (default: nome appuntamento)" className={`${inp} w-64`} data-testid="appt-preset-name" />
            <button type="button" onClick={savePreset} className="btn-outline text-xs inline-flex items-center gap-1" data-testid="appt-preset-save"><Save className="w-3 h-3" /> Salva come modello</button>
          </div>

          {/* 1 · Nome + descrizione */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <label className="text-xs"><span className={lbl}>Nome appuntamento</span><input value={f.name} onChange={(e) => up("name", e.target.value)} placeholder="es. Disco delle 18" className={inp} data-testid="appt-name" /></label>
            <label className="text-xs md:col-span-2"><span className={lbl}>Descrizione (facoltativa)</span><input value={f.description} onChange={(e) => up("description", e.target.value)} className={inp} data-testid="appt-description" /></label>
          </div>

          {/* 2 · Orario + ripetizione */}
          <div className="rounded p-2 space-y-2" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="flex flex-wrap items-end gap-3">
              {!f.recurring && <label className="text-xs"><span className={lbl}>Data e ora</span><input type="datetime-local" value={f.when} onChange={(e) => up("when", e.target.value)} className={inp} data-testid="appt-when" /></label>}
              <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer pb-1.5"><input type="checkbox" checked={f.recurring} onChange={(e) => up("recurring", e.target.checked)} data-testid="appt-recurring" /> 🔁 Ripetizione (Smart Recurrence)</label>
            </div>
            {f.recurring && (
              <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs" data-testid="appt-rrule">
                <div className="col-span-2 md:col-span-6 flex flex-wrap gap-1 items-center"><span className={`${lbl} mb-0 mr-1`}>Giorni</span>
                  {DAYS.map(([l, d]) => (
                    <button key={d} type="button" onClick={() => up("rr_days", f.rr_days.includes(d) ? f.rr_days.filter((x) => x !== d) : [...f.rr_days, d].sort())} data-testid={`appt-day-${d}`}
                      className="px-2 py-0.5 rounded font-mono text-[10px]" style={f.rr_days.includes(d) ? { background: PINK, color: "#000" } : { border: "1px solid rgba(255,255,255,0.15)", color: "#aaa" }}>{l}</button>
                  ))}
                </div>
                <label><span className={lbl}>Fascia dalle (h)</span><input type="number" min={0} max={23} value={f.rr_start_hour} onChange={(e) => up("rr_start_hour", e.target.value)} className={inp} data-testid="appt-rr-start" /></label>
                <label><span className={lbl}>alle (h)</span><input type="number" min={0} max={24} value={f.rr_end_hour} onChange={(e) => up("rr_end_hour", e.target.value)} className={inp} data-testid="appt-rr-end" /></label>
                <label><span className={lbl}>Minuto di partenza</span><input type="number" min={0} max={59} value={f.rr_anchor_minute} onChange={(e) => up("rr_anchor_minute", e.target.value)} className={inp} data-testid="appt-rr-anchor" /></label>
                <label><span className={lbl}>Ogni</span>
                  <div className="flex gap-1"><input type="number" min={1} value={f.rr_freq_value} onChange={(e) => up("rr_freq_value", e.target.value)} className={inp} data-testid="appt-rr-freq" />
                    <select value={f.rr_freq_unit} onChange={(e) => up("rr_freq_unit", e.target.value)} className={inp} data-testid="appt-rr-unit"><option value="minutes">min</option><option value="hours">ore</option></select></div></label>
                <label><span className={lbl}>Data inizio</span><input type="date" value={f.rr_start_date} onChange={(e) => up("rr_start_date", e.target.value)} className={inp} data-testid="appt-rr-start-date" /></label>
                <label><span className={lbl}>Data fine</span><input type="date" value={f.rr_end_date} onChange={(e) => up("rr_end_date", e.target.value)} className={inp} data-testid="appt-rr-end-date" /></label>
              </div>
            )}
          </div>

          {/* 3-4 · Durata + jingle */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
            <label><span className={lbl}>Durata max brano (sec, facoltativa)</span><input type="number" min={5} value={f.max_duration_sec} onChange={(e) => up("max_duration_sec", e.target.value)} placeholder="intero" className={inp} data-testid="appt-duration" /></label>
            <label><span className={lbl}>Sigla / jingle PRIMA (facoltativo)</span><PickTrack list={jingles} value={f.jingle_before_id} onChange={(v) => up("jingle_before_id", v)} placeholder="— nessuno —" testid="appt-jingle-before" onRefresh={onRefreshSources} /></label>
            <label><span className={lbl}>Sigla / jingle DOPO (facoltativo, accodato)</span><PickTrack list={jingles} value={f.jingle_after_id} onChange={(v) => up("jingle_after_id", v)} placeholder="— nessuno —" testid="appt-jingle-after" onRefresh={onRefreshSources} /></label>
          </div>

          {/* 5 · Sorgente */}
          <div className="rounded p-2 space-y-2" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }} data-testid="appt-source">
            <div className="flex flex-wrap gap-1">
              {SOURCES.map((s) => (
                <button key={s.k} type="button" onClick={() => up("source", s.k)} data-testid={`appt-source-${s.k}`} className="px-3 py-1 rounded text-xs font-mono font-bold"
                  style={f.source === s.k ? { background: PINK, color: "#000" } : { border: "1px solid rgba(255,255,255,0.15)", color: "#bbb" }}>{s.label}</button>
              ))}
            </div>
            <div className="text-[10px] font-mono text-zinc-500">{srcInfo?.hint}</div>
            {f.source === "fixed" && <PickTrack list={songs} value={f.fixed_track_id} onChange={(v) => up("fixed_track_id", v)} placeholder="— scegli il brano —" testid="appt-fixed-track" />}
            {f.source === "disco_del_giorno" && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <label><span className={lbl}>Genere</span><input value={f.suno_genre} onChange={(e) => up("suno_genre", e.target.value)} placeholder="es. italo disco 122 bpm" className={inp} data-testid="appt-suno-genre" /></label>
                <label><span className={lbl}>Mood</span><input value={f.suno_mood} onChange={(e) => up("suno_mood", e.target.value)} placeholder="es. solare, estivo" className={inp} data-testid="appt-suno-mood" /></label>
                <label><span className={lbl}>Lingua</span><select value={f.suno_lang} onChange={(e) => up("suno_lang", e.target.value)} className={inp} data-testid="appt-suno-lang"><option value="it">Italiano</option><option value="en">Inglese</option></select></label>
                <label><span className={lbl}>Anticipo generazione (min)</span><input type="number" min={5} max={240} value={f.suno_lead_minutes} onChange={(e) => up("suno_lead_minutes", e.target.value)} className={inp} data-testid="appt-suno-lead" /></label>
              </div>
            )}
          </div>

          {/* LedWall durante l'appuntamento (stesse opzioni dell'override eventi) */}
          <label className="text-xs block"><span className={lbl}>🖥️ LedWall durante l'appuntamento (facoltativo)</span>
            <select value={f.video_url} onChange={(e) => up("video_url", e.target.value)} onFocus={() => api.get("/admin/ledwall/videos").then((r) => setVideos(r.data?.videos || [])).catch(() => {})} className={inp} data-testid="appt-video">
              <option value="">— nessuno (mantieni default LedWall) —</option>
              <optgroup label="🎆 Effetti Visuali (FX)"><option value="fx:effects">Effetti audio-reattivi</option></optgroup>
              <optgroup label="🎬 Video caricati">
                {videos.map((v) => <option key={v.id} value={v.url}>{v.display_name} ({Math.round((v.size || 0) / 1024 / 1024)}MB)</option>)}
              </optgroup>
            </select></label>

          {/* 6 · DJ */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
            <label><span className={lbl}>Presentazione DJ (facoltativa)</span>
              <select value={f.dj_id} onChange={(e) => up("dj_id", e.target.value)} className={inp} data-testid="appt-dj">
                <option value="">— nessun DJ —</option>
                {djs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select></label>
            <label className="md:col-span-2"><span className={lbl}>Commento libero del DJ (facoltativo)</span><input value={f.dj_comment} onChange={(e) => up("dj_comment", e.target.value)} disabled={!f.dj_id} placeholder="es. ricorda il concerto di sabato" className={inp} data-testid="appt-dj-comment" /></label>
          </div>
          <div className="text-[10px] font-mono text-zinc-500">
            In onda: {f.jingle_before_id ? "jingle → " : ""}{f.dj_id ? "presentazione DJ (solo se Voci DJ ON) → " : ""}brano{f.jingle_after_id ? " → jingle" : ""}. Nulla viene generato adesso.
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button type="button" onClick={submit} disabled={busy} data-testid="appt-submit" className="px-5 py-2 rounded-lg font-black text-sm text-black" style={{ background: PINK, boxShadow: `0 0 14px ${PINK}66`, opacity: busy ? 0.6 : 1 }}>
              {busy ? "…" : f.recurring ? "✨ CREA APPUNTAMENTO RICORRENTE" : "✨ CREA APPUNTAMENTO"}
            </button>
            <button type="button" onClick={() => setF(emptyForm())} className="btn-outline text-xs inline-flex items-center gap-1" data-testid="appt-reset"><Trash2 className="w-3 h-3" /> Svuota</button>
          </div>
        </div>
      )}
    </div>
  );
}
