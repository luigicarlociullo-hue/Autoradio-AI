import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { assetCategory, ASSET_CATEGORIES, assetLabel, sortAssets } from "./CommandCenter2Panels";
import { toast } from "sonner";
import AppuntamentoLiberoForm from "./AppuntamentoLiberoForm";

/**
 * SmartFlowTimelinePanel — v13.17
 * ---------------------------------------------------------------------------
 * Sostituisce il vecchio Master Clock 24H con una timeline elastica:
 *   ▸ inserimento libero minuto-per-minuto (datetime-local)
 *   ▸ selezione sorgente dal Magazzino Universale (tracks searchable)
 *   ▸ soft-sync lato server: l'evento entra in onda SOLO quando il brano
 *     corrente termina naturalmente (duration_sec elapsed). Zero troncamenti.
 *   ▸ auto-refresh coda pending ogni 8s
 *   ▸ elimina evento pending prima che diventi maturo
 */
const KIND_COLOR = {
  jingle: "#00E5FF",
  time_signal: "#00E5FF",
  past_pill: "#FFB84D",
  future_pill: "#80FFB4",
  rubric: "#FF6BAA",
  insert: "#D080FF",
  ad: "#FF5577",
  ad_break: "#FF8A3D",
  appointment: "#FF6BAA",
};
const KIND_LABEL = {
  jingle: "Jingle",
  time_signal: "Segnale orario",
  past_pill: "Pillola Passato",
  future_pill: "Pillola Futuro",
  rubric: "Rubrica",
  insert: "Inserto libero",
  ad: "Spot",
  ad_break: "📢 Break Pubblicitario",
  appointment: "✨ Appuntamento",
};

// datetime-local wants "YYYY-MM-DDTHH:mm" in *local* tz
const toLocalInput = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocalInput = (s) => new Date(s); // interpreta come local, il .toISOString ⇒ UTC

const fmtWhen = (iso) => {
  try {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch { return "—"; }
};
const fmtDate = (iso) => {
  try {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}`;
  } catch { return ""; }
};

// v13.44 · Search & Filter per ogni tendina del Magazzino: ricerca per nome,
// filtro per categoria (cassetti), lista SEMPRE in ordine alfabetico.
function AssetPicker({ sources, value, onChange, placeholder = "- seleziona dal Magazzino -", testid, multiple = false, className = "" }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const list = useMemo(
    () => sortAssets(sources.filter((s) => (cat === "all" || assetCategory(s) === cat) && (!q.trim() || assetLabel(s).toLowerCase().includes(q.trim().toLowerCase())))),
    [sources, q, cat]
  );
  const optLabel = (s) => `[${(ASSET_CATEGORIES.find((c) => c.k === assetCategory(s)) || {}).label || s.kind}] ${assetLabel(s)}${s.duration_sec ? ` (${Math.round(s.duration_sec)}s)` : ""}`;
  return (
    <div className={className} data-testid={testid ? `${testid}-picker` : undefined}>
      <div className="flex gap-1 mb-1">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="cerca per nome / artista..." data-testid={testid ? `${testid}-search` : undefined}
          className="flex-1 min-w-0 bg-black border border-white/10 rounded px-2 py-1 text-xs text-white" />
        <select value={cat} onChange={(e) => setCat(e.target.value)} data-testid={testid ? `${testid}-cat` : undefined}
          className="bg-black border border-white/10 rounded px-1 py-1 text-[10px] font-mono text-cyan-200">
          {ASSET_CATEGORIES.map((c) => <option key={c.k} value={c.k}>{c.label}</option>)}
        </select>
      </div>
      <select
        value={value}
        multiple={multiple}
        onChange={(e) => onChange(multiple ? Array.from(e.target.selectedOptions).map((o) => o.value) : e.target.value)}
        className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white"
        style={multiple ? { minHeight: "64px" } : undefined}
        data-testid={testid}
      >
        {!multiple && <option value="">{placeholder}</option>}
        {list.slice(0, 600).map((s) => <option key={s.id} value={s.id}>{optLabel(s)}</option>)}
      </select>
      <div className="text-[9px] font-mono text-zinc-500 mt-0.5">{`${list.length} file - ordine alfabetico`}</div>
    </div>
  );
}

// v13.63 · PRE-SEGNALE ORARIO — file del Magazzino (qualsiasi categoria) in onda subito
// prima del segnale orario automatico, senza pause. Senza file → segnale orario come oggi.
function PreTimeSignalBox({ sources }) {
  const [cfg, setCfg] = useState(null);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => { try { const r = await api.get("/admin/time-signal/pre-audio"); setCfg(r.data.pre_audio || null); } catch {} };
  useEffect(() => { load(); }, []);
  const save = async () => {
    if (!pick) return;
    setBusy(true);
    try {
      const r = await api.put("/admin/time-signal/pre-audio", { track_id: pick });
      setCfg(r.data.pre_audio); setPick("");
      toast.success("Pre-segnale orario impostato");
    } catch (e) { toast.error(e?.response?.data?.detail || "Errore salvataggio"); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm("Rimuovere il pre-segnale orario? Il segnale orario partirà direttamente.")) return;
    setBusy(true);
    try { await api.delete("/admin/time-signal/pre-audio"); setCfg(null); toast.success("Pre-segnale rimosso"); }
    catch { toast.error("Errore rimozione"); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-2 rounded p-2" style={{ background: "rgba(255,184,77,0.05)", border: "1px dashed rgba(255,184,77,0.4)" }} data-testid="ts-pre-audio-box">
      <div className="text-[10px] font-mono mb-1" style={{ color: "#FFB84D" }}>
        ⏮️ Pre-segnale orario · file in onda SUBITO PRIMA del segnale orario, senza pause (es. stacco, sigla, FX).
      </div>
      {cfg ? (
        <div className="flex items-center gap-2 flex-wrap" data-testid="ts-pre-audio-current">
          <span className="text-xs text-white font-mono truncate">
            ● {cfg.artist ? `${cfg.artist} — ` : ""}{cfg.title || cfg.track_id}{cfg.duration_sec ? ` (${Math.round(cfg.duration_sec)}s)` : ""}
          </span>
          <button type="button" onClick={remove} disabled={busy} data-testid="ts-pre-audio-remove"
            className="px-3 py-1 rounded text-xs font-bold" style={{ background: "rgba(255,45,149,0.2)", border: "1px solid rgba(255,45,149,0.5)", color: "#fff" }}>
            ✕ Rimuovi
          </button>
        </div>
      ) : (
        <div className="text-[10px] font-mono text-zinc-500 mb-1" data-testid="ts-pre-audio-empty">○ Nessun file: il segnale orario parte direttamente.</div>
      )}
      <div className="flex gap-2 items-end mt-1">
        <AssetPicker sources={sources} value={pick} onChange={setPick} testid="ts-pre-audio" className="flex-1 min-w-0" placeholder="- scegli il pre-segnale dal Magazzino -" />
        <button type="button" onClick={save} disabled={busy || !pick} data-testid="ts-pre-audio-save"
          className="px-3 py-1.5 rounded text-xs font-bold mb-4 disabled:opacity-40" style={{ background: "rgba(255,184,77,0.2)", border: "1px solid rgba(255,184,77,0.5)", color: "#fff" }}>
          {busy ? "…" : cfg ? "Sostituisci" : "Imposta"}
        </button>
      </div>
    </div>
  );
}

// #247410 · Le serie ricorrenti sono salvate come "template" e non comparivano mai nella
// lista "In attesa" (solo eventi pending, creati ~90s prima della messa in onda): il cliente
// pensava che creando una nuova serie la precedente venisse cancellata. Qui le mostriamo tutte.
const _DAYS_IT = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
function RecurringSeriesList({ refreshKey }) {
  const [rows, setRows] = useState([]);
  const load = async () => {
    try {
      const [t, pd] = await Promise.all([
        api.get(`/admin/timeline`, { params: { status: "template", limit: 200 } }),
        api.get(`/admin/timeline`, { params: { status: "pending", limit: 200 } }),
      ]);
      // #247410 · anche gli eventi con "Ricorrenza: ogni ora/giorno/settimana" (si ripetono clonandosi,
      // non sono template): prima la lista diceva "0 serie" anche con eventi ricorrenti attivi.
      const simple = (pd.data.events || []).filter((e) => (e.recurrence && e.recurrence !== "none") || e.repeat_daily);
      setRows([...(t.data.events || []), ...simple]);
    } catch {}
  };
  useEffect(() => { load(); const iv = setInterval(load, 30000); return () => clearInterval(iv); }, [refreshKey]);
  const remove = async (t) => {
    if (!window.confirm(`Eliminare la serie "${t.title || t.kind}" e tutte le sue prossime occorrenze?`)) return;
    try { await api.delete(`/admin/timeline/${t.id}`); toast.success("Serie eliminata"); load(); } catch { toast.error("Errore eliminazione serie"); }
  };
  const descSimple = (e) => {
    const rec = e.recurrence || (e.repeat_daily ? "daily" : "none");
    const d = new Date(e.scheduled_at);
    const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return rec === "hourly" ? `ogni ora · prossima ${hm}` : rec === "weekly" ? `ogni settimana · prossima ${hm}` : `ogni giorno alle ${hm}`;
  };
  const desc = (r = {}) => {
    const pad = (n) => String(n).padStart(2, "0");
    const fm = Number(r.frequency_minutes || 60);
    const every = fm % 60 === 0 ? `ogni ${fm / 60} h` : `ogni ${fm} min`;
    const days = Array.isArray(r.days_of_week) && r.days_of_week.length && r.days_of_week.length < 7 ? ` · ${r.days_of_week.map((d) => _DAYS_IT[d]).join(" ")}` : "";
    return `${every} · dalle ${pad(r.start_hour ?? 0)}:${pad(r.anchor_minute ?? 0)} alle ${pad(r.end_hour ?? 24)}:00${days}`;
  };
  return (
    <div className="rounded-lg p-3 mb-4" style={{ background: "rgba(0,229,255,0.04)", border: "1px solid rgba(0,229,255,0.25)" }} data-testid="recurring-series-list">
      <div className="label-mono mb-2" style={{ color: "#00E5FF" }}>🔁 Serie ricorrenti attive ({rows.length}) · restano tutte attive anche se hanno lo stesso orario: vanno in onda una dopo l'altra</div>
      {rows.length === 0 && <div className="text-xs font-mono text-zinc-500">Nessuna serie ricorrente.</div>}
      {rows.map((t) => (
        <div key={t.id} className="flex items-center gap-2 text-xs font-mono py-1 border-b border-white/5" data-testid={`series-row-${t.id}`}>
          <span className="px-1.5 py-0.5 rounded uppercase text-[9px]" style={{ color: "#00E5FF", border: "1px solid rgba(0,229,255,0.4)" }}>{t.kind}</span>
          <span className="flex-1 min-w-0 truncate text-white">{t.title || "—"}</span>
          {t.appointment?.chain_after && t.appointment.chain_after !== "none" && (
            <span className="px-1.5 py-0.5 rounded text-[9px]" style={{ color: "#FF6BAA", border: "1px solid rgba(255,107,170,0.45)" }} data-testid={`series-chain-${t.id}`} title="Concatena dopo: parte appena finisce l'evento compatibile (max 15 min di attesa)">
              ⛓ dopo {t.appointment.chain_after === "time_signal" ? "segnale orario" : "qualsiasi evento"}
            </span>
          )}
          {t.kind === "appointment" && (
            <span className="px-1.5 py-0.5 rounded text-[9px] text-zinc-300 border border-white/15" data-testid={`series-priority-${t.id}`} title="Priorità 1-9 (ordina gli eventi dovuti nello stesso minuto)">P{t.appointment?.priority ?? 5}</span>
          )}
          <span className="text-zinc-400 hidden md:inline">{t.rrule ? desc(t.rrule) : descSimple(t)}</span>
          <button type="button" onClick={() => remove(t)} className="px-2 rounded text-[10px]" style={{ color: "#FF6BAA", border: "1px solid rgba(255,45,149,0.4)" }} data-testid={`series-delete-${t.id}`}>Elimina</button>
        </div>
      ))}
    </div>
  );
}

export default function SmartFlowTimelinePanel() {
  const [now, setNow] = useState(null); // /api/stream/now
  const [pending, setPending] = useState([]);
  const [consumed, setConsumed] = useState([]);
  const [sources, setSources] = useState([]); // /admin/tracks/searchable
  const [djs, setDjs] = useState([]);        // /djs
  const [videos, setVideos] = useState([]);  // /admin/ledwall/videos
  const [tab, setTab] = useState("pending"); // pending | consumed
  const [busy, setBusy] = useState(false);
  const [permTsBusy, setPermTsBusy] = useState(false);
  // v13.42 · Fix ticket #247410: genera/rigenera i 24 segnali orari permanenti
  // (una tantum, testo fisso) così l'ora esatta non consuma più Universal Key
  // ogni giorno.
  const generatePermanentTimeSignals = async (force) => {
    if (!window.confirm(force
      ? "Rigenerare TUTTI e 24 i segnali orari? (consuma Universal Key una tantum)"
      : "Generare i segnali orari mancanti (una tantum)? Le ore già generate non verranno toccate.")) return;
    setPermTsBusy(true);
    try {
      const params = { force: !!force };
      if (form.dj_id) params.dj_id = form.dj_id;
      const r = await api.post("/admin/time-signal/generate-permanent", null, { params });
      const { generated = [], skipped_existing = [], failed = [] } = r.data || {};
      toast.success(`Segnali orari: ${generated.length} generati, ${skipped_existing.length} già pronti${failed.length ? `, ${failed.length} falliti` : ""}`);
    } catch { toast.error("Errore generazione segnali orari"); }
    finally { setPermTsBusy(false); }
  };
  // v13.48 · Clip-parte ORA (24) + MINUTO (60) per il segnale orario con minuti (solo eventi Timeline/rrule)
  const [partsBusy, setPartsBusy] = useState(false);
  const [partsStatus, setPartsStatus] = useState(null);
  const loadPartsStatus = async () => { try { const r = await api.get("/admin/time-signal/parts-status"); setPartsStatus(r.data); } catch {} };
  const generateTimeSignalParts = async (force) => {
    if (!window.confirm(force
      ? "Rigenerare TUTTE le 84 clip ora+minuti (24 ORA + 60 MINUTO)? Costo: 84 sintesi brevi."
      : "Generare le clip ora+minuti mancanti (una tantum, max 84 sintesi brevi)? Le clip già valide non verranno toccate.")) return;
    setPartsBusy(true);
    try {
      const params = { force: !!force };
      if (form.dj_id) params.dj_id = form.dj_id;
      const r = await api.post("/admin/time-signal/generate-parts", null, { params });
      const { generated = [], skipped_existing = [], failed = [] } = r.data || {};
      toast.success(`Clip ora+minuti: ${generated.length} generate, ${skipped_existing.length} già pronte${failed.length ? `, ${failed.length} fallite` : ""}`);
      loadPartsStatus();
    } catch { toast.error("Errore generazione clip ora+minuti"); }
    finally { setPartsBusy(false); }
  };
  // Ticket #247410: carica la cartella "Time" registrata dal cliente (HRSxx / HRSxx_O / MINxx).
  // Dopo il caricamento il segnale orario usa SOLO questi file: generazione vocale disattivata.
  const uploadTimeFolder = async (fileList) => {
    const files = Array.from(fileList || []).filter((f) => /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f.name));
    if (!files.length) { toast.error("Nessun file audio trovato nella selezione"); return; }
    setPartsBusy(true);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f, f.name));
      const r = await api.post("/admin/time-signal/upload-parts", fd, { headers: { "Content-Type": "multipart/form-data" } });
      const { mapped = [], ignored = [], failed = [] } = r.data || {};
      toast.success(`Cartella Time: ${mapped.length} file caricati${ignored.length ? `, ${ignored.length} ignorati` : ""}${failed.length ? `, ${failed.length} non validi` : ""}`);
      if (failed.length) toast.error(`Non validi: ${failed.map((f) => f.file).join(", ")}`);
      loadPartsStatus();
    } catch { toast.error("Errore caricamento cartella Time"); }
    finally { setPartsBusy(false); }
  };
  useEffect(() => { loadPartsStatus(); }, []);
  // v13.22 · Config globale di Regia (soggetto default + video default)
  const [regiaCfg, setRegiaCfg] = useState({ default_subject: "", ledwall_default_video_url: "" });
  const [regiaBusy, setRegiaBusy] = useState(false);
  // v13.35 · Stato reale kill-switch generazione IA (ai_openai_talk)
  const [aiTalk, setAiTalk] = useState(null); // null = sconosciuto, true/false
  const [form, setForm] = useState(() => {
    const t = new Date();
    t.setMinutes(t.getMinutes() + 5, 0, 0);
    return {
      scheduled_at: toLocalInput(t),
      kind: "jingle",
      source_id: "",
      audio_url: "",
      title: "",
      duration_sec: 30,
      dj_id: "",
      brief: "",
      video_url: "",      // v13.22 · override LedWall per l'evento
      repeat_daily: false, // v13.22 · ricorrenza giornaliera (legacy)
      recurrence: "none",  // v13.23 · none / hourly / daily / weekly
      // v13.29 · Smart Recurrence (rrule) — se attivo, il POST va a /admin/timeline/rrule
      smart_recurrence: false,
      rr_start_hour: 6,
      rr_end_hour: 22,
      rr_frequency_minutes: 60,
      rr_days: [0,1,2,3,4,5,6], // Mon..Sun default
    };
  });
  // v13.33 · Sequenza concatenata multipla (lista ordinata di source_id dal Magazzino)
  const [followUpIds, setFollowUpIds] = useState([]);
  const [seriesKey, setSeriesKey] = useState(0);  // #247410 · refresh lista serie ricorrenti
  // v13.36 · FIX (ticket #247410, come modifico un evento gia' creato):
  // stato per la modifica inline di un evento pending gia' esistente —
  // prima d'ora l'unica azione disponibile era la cancellazione (✕).
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(null); // { scheduled_at, title, duration_sec, followUpIds: [] }
  const [editBusy, setEditBusy] = useState(false);
  const followUps = useMemo(
    () => followUpIds.map((id) => sources.find((s) => s.id === id)).filter(Boolean),
    [followUpIds, sources]
  );
  const pollRef = useRef(null);

  const loadNow = async () => {
    try { const r = await api.get("/stream/now"); setNow(r.data); } catch {}
  };
  const loadEvents = async (status) => {
    try {
      const r = await api.get(`/admin/timeline`, { params: { status, limit: 50 } });
      if (status === "pending") setPending(r.data.events || []);
      else setConsumed(r.data.events || []);
    } catch (e) {
      if (e?.response?.status === 401) toast.error("Sessione admin scaduta");
    }
  };
  const loadSources = async () => {
    try {
      const r = await api.get(`/admin/tracks/searchable`);
      setSources(r.data.tracks || []);
    } catch {}
  };
  const loadDjs = async () => {
    try {
      const r = await api.get(`/djs`);
      // v13.26 · TUTTI i DJ selezionabili (diurni + notturni). Prima c'era
      // un filtro `night_slot` che escludeva i DJ notturni dal dropdown,
      // ma il backend supporta il campo Soggetto/Brief per QUALSIASI DJ:
      // l'esclusione era solo cosmetica e privava la regia di 3 speaker.
      setDjs(r.data || []);
    } catch {}
  };
  const loadVideos = async () => {
    try {
      const r = await api.get(`/admin/ledwall/videos`);
      setVideos(r.data.videos || []);
    } catch {}
  };
  const loadRegiaCfg = async () => {
    try {
      const r = await api.get(`/admin/regia/config`);
      setRegiaCfg({
        default_subject: r.data.default_subject || "",
        ledwall_default_video_url: r.data.ledwall_default_video_url || "",
      });
    } catch {}
  };
  const loadAiTalk = async () => {
    try {
      const r = await api.get(`/admin/ai-controls`);
      setAiTalk(!!r.data?.controls?.ai_openai_talk);
    } catch {}
  };
  const saveRegiaCfg = async (patch) => {
    setRegiaBusy(true);
    try {
      const r = await api.patch(`/admin/regia/config`, patch);
      setRegiaCfg({
        default_subject: r.data.default_subject || "",
        ledwall_default_video_url: r.data.ledwall_default_video_url || "",
      });
      toast.success("Regia config salvata");
    } catch { toast.error("Errore salvataggio config"); }
    finally { setRegiaBusy(false); }
  };
  const deleteVideo = async (id) => {
    if (!window.confirm("Eliminare fisicamente il video dallo storage?")) return;
    try {
      await api.delete(`/admin/ledwall/videos/${id}`);
      toast.success("Video eliminato dallo storage");
      loadVideos();
    } catch { toast.error("Errore eliminazione video"); }
  };
  useEffect(() => {
    loadNow(); loadEvents("pending"); loadEvents("consumed"); loadSources(); loadDjs(); loadVideos(); loadRegiaCfg(); loadAiTalk();
    pollRef.current = setInterval(() => {
      loadNow();
      loadEvents("pending");
      loadAiTalk();
    }, 8000);
    return () => clearInterval(pollRef.current);
  }, []);

  const chosenSource = useMemo(
    () => sources.find((s) => s.id === form.source_id) || null,
    [sources, form.source_id]
  );

  const onPickSource = (id) => {
    const s = sources.find((x) => x.id === id);
    if (!s) { setForm((f) => ({ ...f, source_id: "", audio_url: "" })); return; }
    setForm((f) => ({
      ...f,
      source_id: s.id,
      audio_url: s.audio_url || "",
      title: f.title || s.title || "",
      duration_sec: Math.max(3, Math.round(s.duration_sec || f.duration_sec || 30)),
    }));
  };

  const submit = async () => {
    if (!form.scheduled_at) return toast.error("Orario richiesto");
    // audio_url richiesta SOLO se non è stato scelto un DJ (percorso autonomo).
    // Con DJ selezionato, il backend genera talk (LLM + TTS ElevenLabs) usando
    // il brief se presente, oppure inventando un argomento intelligente.
    // v13.28 · Segnale Orario non richiede né sorgente né DJ.
    // v13.32 · Break Pubblicitario (ad_break) non richiede audio: il server
    // costruisce al volo il cluster Intro→Spot→Outro dal Ad Manager.
    if (form.kind !== "time_signal" && form.kind !== "ad_break" && !form.audio_url && !form.dj_id) {
      return toast.error("Scegli una sorgente dal Magazzino OPPURE seleziona un DJ");
    }
    setBusy(true);
    try {
      // v13.29 · Smart Recurrence path: crea un template rrule invece di
      // un evento singolo. Il backend genererà le occorrenze concrete man
      // mano che si avvicinano e le espande virtualmente per il calendar.
      if (form.smart_recurrence) {
        if (!form.audio_url && form.kind !== "time_signal") { setBusy(false); return toast.error("Smart Recurrence richiede un audio dal Magazzino"); }
        const rBody = {
          kind: form.kind,
          title: form.title || undefined,
          audio_url: form.audio_url || undefined,
          duration_sec: Number(form.duration_sec) || 30,
          dj_id: form.dj_id || undefined,
          video_url: form.video_url || undefined,
          brief: form.brief || undefined,
          follow_ups: followUps.map((s) => ({
            audio_url: s.audio_url,
            title: s.title,
            artist: s.artist,
            duration_sec: Math.max(1, Math.round(s.duration_sec || 20)),
          })),
          rrule: {
            start_hour: Number(form.rr_start_hour),
            end_hour: Number(form.rr_end_hour),
            frequency_minutes: Number(form.rr_frequency_minutes),
            days_of_week: form.rr_days,
          },
        };
        const rr = await api.post("/admin/timeline/rrule", rBody);
        const tpl = rr.data?.template;
        toast.success(`🔁 Template creato · ogni ${tpl.rrule.frequency_minutes}min · ${tpl.rrule.start_hour}:00→${tpl.rrule.end_hour}:00${followUps.length ? ` · +${followUps.length} MP3 concatenati` : ""}`);
        setSeriesKey((k) => k + 1);
        setFollowUpIds([]);
        loadEvents("pending");
        setBusy(false);
        return;
      }
      const localDate = fromLocalInput(form.scheduled_at);
      const iso = localDate.toISOString(); // UTC ISO
      const body = {
        scheduled_at: iso,
        kind: form.kind,
        title: form.title || undefined,
        audio_url: form.audio_url || undefined,
        duration_sec: Number(form.duration_sec) || 30,
        dj_id: form.dj_id || undefined,
        brief: form.brief || undefined,
        video_url: form.video_url || undefined,
        recurrence: form.recurrence || "none",
        // v13.44 · Coda di Successione: catena di file senza gap anche per eventi singoli
        follow_ups: followUps.map((s) => ({
          audio_url: s.audio_url, title: s.title, artist: s.artist,
          duration_sec: Math.max(1, Math.round(s.duration_sec || 20)),
        })),
        // v13.32 · Numero di spot random per Break Pubblicitario
        ad_break_count: form.kind === "ad_break" ? Number(form.ad_break_count || 2) : undefined,
      };
      const r = await api.post("/admin/timeline", body);
      const ev = r.data?.event || {};
      const _rec = ev.recurrence || (ev.repeat_daily ? "daily" : "none");
      const _recBadge = _rec === "hourly" ? " · 🔁 ogni ora" : _rec === "daily" ? " · 🔁 ogni giorno" : _rec === "weekly" ? " · 🔁 settimanale" : "";
      if (ev.generated_script) {
        toast.success(`🎙 Talk generato per ${ev.dj_name} · ${ev.duration_sec}s${_recBadge}`);
      } else {
        toast.success(`Evento inserito · ${fmtWhen(iso)}${_recBadge}`);
      }
      const t = new Date(); t.setMinutes(t.getMinutes() + 5, 0, 0);
      setForm({
        scheduled_at: toLocalInput(t),
        kind: form.kind, source_id: "", audio_url: "", title: "", duration_sec: 30,
        dj_id: form.dj_id, brief: "",
        video_url: form.video_url, repeat_daily: false, recurrence: form.recurrence,
      });
      loadEvents("pending");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Errore inserimento");
    } finally { setBusy(false); }
  };

  const remove = async (id) => {
    try {
      await api.delete(`/admin/timeline/${id}`);
      toast.success("Evento rimosso");
      setPending((p) => p.filter((e) => e.id !== id));
    } catch { toast.error("Errore rimozione"); }
  };

  // v13.36 · FIX (ticket #247410): modifica inline di un evento pending gia'
  // creato — orario, titolo, durata, e aggiunta/rimozione di spot concatenati
  // (follow_ups) dopo la creazione, il caso d'uso esplicitamente richiesto dal
  // cliente ("se voglio aggiungerli in un secondo momento?").
  const startEdit = (ev) => {
    setEditingId(ev.id);
    setEditDraft({
      scheduled_at: toLocalInput(new Date(ev.scheduled_at)),
      title: ev.title || "",
      duration_sec: ev.duration_sec || 30,
      followUpIds: [],
    });
  };

  const cancelEdit = () => { setEditingId(null); setEditDraft(null); };

  const saveEdit = async (ev) => {
    if (!editDraft) return;
    setEditBusy(true);
    try {
      const patch = {};
      const iso = fromLocalInput(editDraft.scheduled_at).toISOString();
      if (iso !== ev.scheduled_at) patch.scheduled_at = iso;
      if (editDraft.title !== (ev.title || "")) patch.title = editDraft.title;
      if (Number(editDraft.duration_sec) !== ev.duration_sec) patch.duration_sec = Number(editDraft.duration_sec);
      if (editDraft.followUpIds && editDraft.followUpIds.length) {
        const existingFu = ev.follow_ups || [];
        const newFu = editDraft.followUpIds
          .map((id) => sources.find((s) => s.id === id))
          .filter(Boolean)
          .map((s) => ({
            audio_url: s.audio_url,
            title: s.title,
            artist: s.artist,
            duration_sec: Math.max(1, Math.round(s.duration_sec || 20)),
          }));
        patch.follow_ups = [...existingFu, ...newFu];
      }
      if (Object.keys(patch).length === 0) {
        toast("Nessuna modifica da salvare");
        cancelEdit();
        return;
      }
      const r = await api.patch(`/admin/timeline/${ev.id}`, patch);
      const updated = r.data?.event;
      if (updated) {
        setPending((p) => p.map((e) => (e.id === ev.id ? updated : e)));
      }
      toast.success("Evento aggiornato");
      cancelEdit();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Errore aggiornamento");
    } finally { setEditBusy(false); }
  };

  // ── minutes-until helper ───────────────────────────────────────────────
  const minutesUntil = (iso) => {
    try {
      const diff = (new Date(iso).getTime() - Date.now()) / 60000;
      if (diff < -0.5) return { label: "atteso · soft-sync", overdue: true };
      if (diff < 1) return { label: "< 1m", overdue: false };
      if (diff < 60) return { label: `tra ${Math.round(diff)}m`, overdue: false };
      const h = Math.floor(diff / 60), m = Math.round(diff % 60);
      return { label: `tra ${h}h${m}m`, overdue: false };
    } catch { return { label: "—", overdue: false }; }
  };

  const cur = now?.current;
  const remaining = cur?.remaining_sec != null ? Math.max(0, Math.round(cur.remaining_sec)) : null;

  return (
    <section
      className="lg:col-span-4 rounded-xl p-5"
      data-testid="smart-flow-timeline-panel"
      style={{
        background: "linear-gradient(180deg, rgba(0,229,255,0.05), rgba(0,10,20,0.85))",
        border: "1px solid rgba(0,229,255,0.28)",
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="label-mono" style={{ color: "#00E5FF" }}>
            SMART FLOW TIMELINE · Coda elastica minuto-per-minuto
          </div>
          <div className="font-display font-black text-xl text-white mt-1">
            Programmazione fluida come un fiume
          </div>
          <div className="text-[11px] font-mono text-zinc-400 mt-0.5">
            Inserisci eventi a orario esatto. Il server attende la fine naturale del brano
            in onda prima di lanciarli: <b>zero troncamenti</b>.
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-mono uppercase text-zinc-500">In onda</div>
          <div
            className="font-display font-black text-lg truncate max-w-[220px]"
            style={{ color: "#00E5FF", textShadow: "0 0 8px rgba(0,229,255,0.6)" }}
            title={cur?.title || "—"}
            data-testid="timeline-current-title"
          >
            {cur?.title || "—"}
          </div>
          <div className="text-[10px] font-mono text-zinc-400 mt-0.5">
            {cur?.artist || ""} {remaining !== null ? `· ${remaining}s alla fine` : ""}
            {cur?.is_timeline ? " · timeline" : ""}
          </div>
        </div>
      </div>

      {/* v13.35 · Banner stato generazione IA (kill-switch ai_openai_talk) */}
      {aiTalk === false && (
        <div
          className="rounded-lg p-3 mb-4 flex items-center justify-between gap-3"
          style={{ background: "rgba(255,45,149,0.10)", border: "1px solid rgba(255,45,149,0.55)" }}
          data-testid="ai-talk-disabled-banner"
        >
          <div>
            <div className="text-sm font-bold" style={{ color: "#FF6BAA" }}>⛔ Generazione IA disattivata · OPENAI TALK = OFF</div>
            <div className="text-[11px] font-mono text-zinc-300 mt-0.5">
              Gli interventi a tema con DJ e la pre-generazione voce sono bloccati (kill-switch <code>ai_openai_talk</code>).
              Nessun fallback su voci pre-registrate di altri speaker: la richiesta verrà rifiutata con errore.
              Attivalo da <b>AI Master Control → 🎙️ OPENAI TALK</b>.
            </div>
          </div>
          <button
            type="button"
            onClick={async () => { try { await api.patch(`/admin/ai-controls`, { ai_openai_talk: true }); toast.success("OPENAI TALK attivato"); loadAiTalk(); } catch { toast.error("Errore attivazione"); } }}
            data-testid="ai-talk-enable-btn"
            className="px-3 py-2 rounded text-xs font-bold text-black whitespace-nowrap"
            style={{ background: "#80FFB4" }}
          >▸ Attiva ora</button>
        </div>
      )}
      {aiTalk === true && (
        <div className="text-[10px] font-mono mb-3" style={{ color: "#80FFB4" }} data-testid="ai-talk-enabled-badge">
          ● Generazione IA attiva (OPENAI TALK = ON)
        </div>
      )}

      {/* v13.22 · REGIA CONFIG UNIVERSALE — barra in cima */}
      {/* v13.54 · APPUNTAMENTO LIBERO — form separato, ogni parametro facoltativo */}
      <AppuntamentoLiberoForm sources={sources} djs={djs} onCreated={() => { loadEvents("pending"); setSeriesKey((k) => k + 1); }} onRefreshSources={loadSources} />
      <RecurringSeriesList refreshKey={seriesKey} />
      <div
        className="rounded-lg p-3 mb-4 space-y-2"
        style={{ background: "rgba(255,184,77,0.06)", border: "1px solid rgba(255,184,77,0.30)" }}
        data-testid="regia-config-bar"
      >
        <div className="flex items-center justify-between">
          <div className="label-mono" style={{ color: "#FFB84D" }}>
            🌐 REGIA · CONFIG UNIVERSALE
          </div>
          <div className="text-[10px] font-mono text-zinc-500">
            si applica a QUALSIASI generazione AI + LedWall
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div>
            <label className="label-mono block mb-1" title="Soggetto usato come contesto base per tutti i DJ e le automazioni AI quando l'evento specifico non porta un brief proprio.">
              Soggetto di default (contesto AI globale)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={regiaCfg.default_subject}
                onChange={(e) => setRegiaCfg({ ...regiaCfg, default_subject: e.target.value })}
                placeholder="Es. 'Tecnologia 2030 e futuro della radio' · vuoto = AI totalmente libera"
                maxLength={400}
                className="flex-1 bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white font-mono"
                data-testid="regia-default-subject"
              />
              <button
                onClick={() => saveRegiaCfg({ default_subject: regiaCfg.default_subject })}
                disabled={regiaBusy}
                data-testid="regia-default-subject-save"
                className="px-3 py-1.5 rounded text-xs font-bold text-black"
                style={{ background: "#FFB84D", opacity: regiaBusy ? 0.55 : 1 }}
              >
                Salva
              </button>
            </div>
          </div>
          <div>
            <label className="label-mono block mb-1" title="Contenuto mostrato dal LedWall quando non ci sono eventi con video override attivi. Puoi scegliere un video caricato oppure gli effetti audio-reattivi.">
              🖥️ LedWall di default (loop continuo)
            </label>
            <div className="flex gap-2">
              <select
                value={regiaCfg.ledwall_default_video_url}
                onChange={(e) => saveRegiaCfg({ ledwall_default_video_url: e.target.value })}
                className="flex-1 bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white"
                data-testid="regia-default-video"
              >
                <option value="">— non impostato (fallback effetti) —</option>
                <optgroup label="🎆 Effetti Visuali (FX)">
                  <option value="fx:effects">Effetti audio-reattivi (stelle + ologrammi + onde)</option>
                </optgroup>
                <optgroup label="🎬 Video caricati">
                  {videos.map((v) => (
                    <option key={v.id} value={v.url}>
                      {`${v.display_name} (${Math.round((v.size || 0) / 1024 / 1024)}MB)`}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* ── Form inserimento ───────────────────────────────────────────── */}
      <div
        className="rounded-lg p-4 mb-4"
        style={{ background: "rgba(0,0,0,0.55)", border: "1px solid rgba(0,229,255,0.25)" }}
      >
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-1">
            <label className="label-mono block mb-1" title="Ora precisa (HH:MM). L'evento verrà lanciato quando il brano attuale terminerà.">
              Quando (locale)
            </label>
            <input
              type="datetime-local"
              value={form.scheduled_at}
              onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })}
              className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white font-mono"
              data-testid="timeline-input-when"
            />
          </div>

          <div className="md:col-span-1">
            <label className="label-mono block mb-1">Tipo</label>
            <select
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}
              className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white"
              data-testid="timeline-input-kind"
            >
              {Object.entries(KIND_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="label-mono block mb-1" title="Scegli file dal Magazzino Universale">
              Sorgente audio (Magazzino)
            </label>
            <AssetPicker sources={sources} value={form.source_id} onChange={onPickSource} placeholder="— seleziona traccia/jingle —" testid="timeline-input-source" />
          </div>

          <div className="md:col-span-1">
            <label className="label-mono block mb-1" title="Speaker che intervierrà su questo evento. Determina voce ElevenLabs + avatar mostrato nel player.">
              DJ speaker
            </label>
            <select
              value={form.dj_id}
              onChange={(e) => setForm({ ...form, dj_id: e.target.value })}
              className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white"
              data-testid="timeline-input-dj"
            >
              <option value="">— nessuno (traccia pura) —</option>
              {djs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="label-mono block mb-1">Titolo mostrato (opzionale)</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={chosenSource?.title || "Es. Anteprima serata"}
              className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white"
              data-testid="timeline-input-title"
            />
          </div>

          <div className="md:col-span-1">
            <label className="label-mono block mb-1">Durata (sec)</label>
            <input
              type="number" min={3} max={900}
              value={form.duration_sec}
              onChange={(e) => setForm({ ...form, duration_sec: e.target.value })}
              className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white font-mono"
              data-testid="timeline-input-duration"
            />
          </div>

          {form.kind === "time_signal" && (
            <div className="md:col-span-2">
              <label className="label-mono block mb-1" title="Genera una volta i 24 annunci orari (testo fisso) e riusali ogni giorno: zero consumi ricorrenti">
                🕐 Segnali orari permanenti
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => generatePermanentTimeSignals(false)}
                  disabled={permTsBusy}
                  data-testid="timeline-generate-permanent-ts"
                  className="px-3 py-1.5 rounded text-xs font-bold"
                  style={{ background: "rgba(0,229,255,0.2)", border: "1px solid rgba(0,229,255,0.5)", color: "#fff" }}
                  title="Genera i 24 segnali orari mancanti, una tantum"
                >
                  {permTsBusy ? "Genero…" : "🕐 Genera 24 Segnali Orari"}
                </button>
                <button
                  type="button"
                  onClick={() => generatePermanentTimeSignals(true)}
                  disabled={permTsBusy}
                  data-testid="timeline-regenerate-permanent-ts"
                  className="px-3 py-1.5 rounded text-xs font-bold"
                  style={{ background: "rgba(255,45,149,0.2)", border: "1px solid rgba(255,45,149,0.5)", color: "#fff" }}
                  title="Rigenera tutte e 24 le ore (es. dopo un cambio voce)"
                >
                  🔁 Rigenera (cambio voce/testo)
                </button>
              </div>
              {/* v13.48 · Segnale orario CON MINUTI (clip-parte) — solo per gli eventi programmati */}
              <div className="mt-2 rounded p-2" style={{ background: "rgba(0,229,255,0.04)", border: "1px dashed rgba(0,229,255,0.3)" }} data-testid="ts-parts-box">
                <div className="text-[10px] font-mono text-cyan-200 mb-1">
                  🕰️ Ora esatta CON MINUTI (es. “Sono le nove” + “e tre minuti, su R-A.I. Radio…”) · 24 clip ORA + 60 clip MINUTO, concatenate all'onda.
                  {partsStatus && (
                    <span data-testid="ts-parts-status" className="ml-2" style={{ color: partsStatus.complete ? "#80FFB4" : "#FFB84D" }}>
                      {partsStatus.complete ? "● 84/84 pronte" : `○ ${partsStatus.total_ready}/84 pronte → fallback all'ora piena finché incomplete`}
                    </span>
                  )}
                </div>
                {/* Ticket #247410: file registrati dal cliente al posto della voce sintetica */}
                <div className="mb-2 rounded p-2" style={{ background: "rgba(57,255,20,0.05)", border: "1px solid rgba(57,255,20,0.35)" }} data-testid="ts-upload-box">
                  <div className="text-[10px] font-mono mb-1" style={{ color: "#39FF14" }}>
                    📁 Usa i TUOI file: carica la cartella Time (HRS00…HRS23 = ora, HRS00_O…HRS23_O = ora in punto, MIN01…MIN59 = minuti).
                    {partsStatus && (
                      <span className="ml-2" data-testid="ts-upload-status">
                        {partsStatus.source === "upload"
                          ? `● Attivo: ${partsStatus.hours_ready}/24 ore · ${partsStatus.on_the_hour_ready || 0}/24 in punto · ${partsStatus.minutes_ready} minuti — voce sintetica disattivata, zero crediti`
                          : "○ Non attivo (in uso la voce sintetica)"}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <label className="px-3 py-1.5 rounded text-xs font-bold cursor-pointer" style={{ background: "rgba(57,255,20,0.2)", border: "1px solid rgba(57,255,20,0.5)", color: "#fff" }} data-testid="ts-upload-folder">
                      {partsBusy ? "Carico…" : "📁 Carica cartella Time"}
                      <input type="file" webkitdirectory="" directory="" multiple hidden disabled={partsBusy}
                        onChange={(e) => { uploadTimeFolder(e.target.files); e.target.value = ""; }} />
                    </label>
                    <label className="px-3 py-1.5 rounded text-xs font-bold cursor-pointer" style={{ background: "rgba(57,255,20,0.1)", border: "1px solid rgba(57,255,20,0.35)", color: "#fff" }} data-testid="ts-upload-files">
                      🎵 Carica singoli file
                      <input type="file" accept="audio/*" multiple hidden disabled={partsBusy}
                        onChange={(e) => { uploadTimeFolder(e.target.files); e.target.value = ""; }} />
                    </label>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => generateTimeSignalParts(false)} disabled={partsBusy} data-testid="timeline-generate-ts-parts"
                    className="px-3 py-1.5 rounded text-xs font-bold" style={{ background: "rgba(0,229,255,0.2)", border: "1px solid rgba(0,229,255,0.5)", color: "#fff" }}>
                    {partsBusy ? "Genero…" : "🕰️ Genera clip ORA+MINUTI (84)"}
                  </button>
                  <button type="button" onClick={() => generateTimeSignalParts(true)} disabled={partsBusy} data-testid="timeline-regenerate-ts-parts"
                    className="px-3 py-1.5 rounded text-xs font-bold" style={{ background: "rgba(255,45,149,0.2)", border: "1px solid rgba(255,45,149,0.5)", color: "#fff" }}>
                    🔁 Rigenera tutte
                  </button>
                </div>
              </div>
              <PreTimeSignalBox sources={sources} />
            </div>
          )}

          {form.kind === "ad_break" && (
            <div className="md:col-span-1">
              <label className="label-mono block mb-1" title="Numero di spot random tra Intro e Outro">
                📢 N. Spot Random
              </label>
              <input
                type="number" min={1} max={6}
                value={form.ad_break_count || 2}
                onChange={(e) => setForm({ ...form, ad_break_count: parseInt(e.target.value) || 2 })}
                className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white font-mono"
                data-testid="timeline-input-ad-break-count"
              />
            </div>
          )}

          <div className="md:col-span-1 flex items-end">
            <button
              onClick={submit}
              disabled={busy || (form.kind !== "time_signal" && form.kind !== "ad_break" && !form.audio_url && !form.dj_id)}
              data-testid="timeline-submit"
              className="w-full px-3 py-2 rounded text-sm font-bold text-black"
              style={{
                background: KIND_COLOR[form.kind] || "#00E5FF",
                boxShadow: `0 0 12px ${KIND_COLOR[form.kind] || "#00E5FF"}66`,
                opacity: busy || (form.kind !== "time_signal" && form.kind !== "ad_break" && !form.audio_url && !form.dj_id) ? 0.55 : 1,
              }}
            >
              {busy ? (form.dj_id && !form.audio_url ? "Genero talk…" : "Inserisco…") : "▸ Inserisci evento"}
            </button>
          </div>
        </div>

        {/* Soggetto / Brief · attivo solo con DJ selezionato */}
        {form.dj_id && (
          <div className="mt-3">
            <label
              className="label-mono block mb-1"
              title="Se scrivi qualcosa, il DJ parla di quello. Se lasci VUOTO, il DJ usa il Soggetto di default globale (o inventa se anche quello è vuoto)."
            >
              🧠 Soggetto / Brief — vuoto = usa Soggetto di default globale
            </label>
            <textarea
              value={form.brief}
              onChange={(e) => setForm({ ...form, brief: e.target.value })}
              placeholder={
                regiaCfg.default_subject
                  ? `Vuoto → usa: "${regiaCfg.default_subject}"`
                  : `Es. "Tesla 2026" · vuoto → ${djs.find(d => d.id === form.dj_id)?.name || "il DJ"} inventa da sé.`
              }
              rows={2}
              maxLength={400}
              className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white font-mono resize-none"
              data-testid="timeline-input-brief"
            />
            <div className="text-[10px] font-mono text-zinc-500 mt-1 flex justify-between">
              <span>
                Modalità: <b style={{ color: form.brief ? "#00E5FF" : (regiaCfg.default_subject ? "#FFB84D" : "#80FFB4") }}>
                  {form.brief ? "🎯 GUIDATO (soggetto specifico)" : (regiaCfg.default_subject ? "🌐 GLOBALE (usa default Regia)" : "🎲 AUTONOMO (l'AI sceglie)")}
                </b>
              </span>
              <span>{form.brief.length}/400</span>
            </div>
          </div>
        )}

        {/* v13.23 · Video override + Ricorrenza · sempre visibili */}
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2">
            <label className="label-mono block mb-1" title="Se scegli un video o un effetto, il LedWall lo mostra per tutta la durata dell'evento e torna automaticamente al default alla fine.">
              🖥️ LedWall override per l'evento (opzionale)
            </label>
            <select
              value={form.video_url}
              onChange={(e) => setForm({ ...form, video_url: e.target.value })}
              className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white"
              data-testid="timeline-input-video"
            >
              <option value="">— nessuno (mantieni default LedWall) —</option>
              <optgroup label="🎆 Effetti Visuali (FX)">
                <option value="fx:effects">Effetti audio-reattivi</option>
              </optgroup>
              <optgroup label="🎬 Video caricati">
                {videos.map((v) => (
                  <option key={v.id} value={v.url}>
                    {v.display_name} ({Math.round((v.size || 0) / 1024 / 1024)}MB)
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
          <div>
            <label className="label-mono block mb-1" title="Frequenza di ripetizione dell'evento. Ogni ora / ogni giorno / ogni settimana. Elimina l'evento per interrompere la catena.">
              🔁 Ricorrenza
            </label>
            <select
              value={form.recurrence}
              onChange={(e) => setForm({ ...form, recurrence: e.target.value })}
              className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white"
              data-testid="timeline-input-recurrence"
            >
              <option value="none">Nessuna (una volta sola)</option>
              <option value="daily">Ogni giorno</option>
              <option value="weekly">Ogni settimana</option>
            </select>
          </div>
        </div>

        {/* v13.44 · CODA DI SUCCESSIONE — per OGNI evento (rubrica, ora esatta, Smart Recurrence) */}
        {/* v13.33 · Sequenza concatenata multipla (qualsiasi kind, con o senza DJ) */}
        <div className="mt-3 rounded p-2" style={{ background: "rgba(128,255,180,0.04)", border: "1px dashed rgba(128,255,180,0.3)" }} data-testid="rr-followups-panel">
        <div className="flex items-center justify-between mb-1">
        <span className="label-mono" style={{ color: "#80FFB4" }}>🔗 Coda di Successione: MP3 concatenati dopo l'evento (zero-gap, in ordine). Vale per ogni rubrica, ora esatta e Smart Recurrence</span>
        <span className="text-[10px] font-mono text-zinc-500">{followUps.length} elementi · {followUps.reduce((a, s) => a + Math.round(s.duration_sec || 0), 0)}s</span>
        </div>
        {followUps.map((s, i) => (
        <div key={`${s.id}-${i}`} className="flex items-center gap-2 text-xs font-mono py-0.5" data-testid={`rr-followup-row-${i}`}>
        <span className="text-zinc-500 w-5">{i + 1}.</span>
        <span className="flex-1 truncate text-zinc-200">[{s.kind}] {s.title} — {s.artist} ({Math.round(s.duration_sec || 0)}s)</span>
        <button type="button" onClick={() => setFollowUpIds((l) => l.filter((_, j) => j !== i))}
        data-testid={`rr-followup-remove-${i}`}
        className="px-1.5 rounded text-[10px]" style={{ color: "#FF6BAA", border: "1px solid rgba(255,45,149,0.4)" }}>✕</button>
        </div>
        ))}
        <AssetPicker sources={sources} value="" onChange={(v) => { if (v) setFollowUpIds((l) => [...l, v]); }} placeholder="+ aggiungi MP3 concatenato..." testid="rr-followup-add" className="mt-1" />
        </div>

        {/* v13.29 · SMART RECURRENCE · toggle avanzato con fascia + freq + giorni */}
        <div className="mt-3 rounded p-3" style={{ background: "rgba(0,229,255,0.05)", border: "1px solid rgba(0,229,255,0.25)" }}>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.smart_recurrence}
              onChange={(e) => setForm({ ...form, smart_recurrence: e.target.checked })}
              className="accent-cyan-400"
              data-testid="timeline-smart-toggle"
            />
            <span className="text-sm font-bold" style={{ color: "#00E5FF" }}>⚙️ Smart Recurrence · fascia oraria + frequenza + giorni specifici</span>
          </label>
          {form.smart_recurrence && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2">
              <div>
                <label className="label-mono block mb-1">Fascia dalle</label>
                <input type="number" min={0} max={23} value={form.rr_start_hour}
                  onChange={(e) => setForm({ ...form, rr_start_hour: Number(e.target.value) })}
                  data-testid="rr-start-hour"
                  className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white font-mono" />
              </div>
              <div>
                <label className="label-mono block mb-1">alle</label>
                <input type="number" min={0} max={24} value={form.rr_end_hour}
                  onChange={(e) => setForm({ ...form, rr_end_hour: Number(e.target.value) })}
                  data-testid="rr-end-hour"
                  className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white font-mono" />
                <div className="text-[9px] font-mono text-zinc-500 mt-0.5">
                  {form.rr_end_hour <= form.rr_start_hour ? "🌙 wraparound overnight" : ""}
                </div>
              </div>
              <div>
                <label className="label-mono block mb-1">Ogni (min)</label>
                <select value={form.rr_frequency_minutes}
                  onChange={(e) => setForm({ ...form, rr_frequency_minutes: Number(e.target.value) })}
                  data-testid="rr-frequency"
                  className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white">
                  <option value={5}>5 minuti</option>
                  <option value={10}>10 minuti</option>
                  <option value={15}>15 minuti</option>
                  <option value={20}>20 minuti</option>
                  <option value={30}>30 minuti</option>
                  <option value={60}>60 minuti (ora esatta)</option>
                  <option value={120}>2 ore</option>
                </select>
              </div>
              <div>
                <label className="label-mono block mb-1">Giorni</label>
                <div className="flex gap-0.5 flex-wrap">
                  {["L","M","M","G","V","S","D"].map((lbl, idx) => {
                    const active = form.rr_days.includes(idx);
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setForm({
                          ...form,
                          rr_days: active ? form.rr_days.filter(d => d !== idx) : [...form.rr_days, idx].sort(),
                        })}
                        data-testid={`rr-day-${idx}`}
                        className="w-7 h-7 rounded text-[10px] font-bold"
                        style={{
                          background: active ? "#00E5FF" : "rgba(255,255,255,0.05)",
                          color: active ? "#000" : "#888",
                          border: `1px solid ${active ? "#00E5FF" : "rgba(255,255,255,0.1)"}`,
                        }}
                        title={["Lunedì","Martedì","Mercoledì","Giovedì","Venerdì","Sabato","Domenica"][idx]}
                      >{lbl}</button>
                    );
                  })}
                </div>
              </div>
              <div className="md:col-span-4 text-[10px] font-mono text-zinc-400">
                💡 Anteprima:  {form.rr_days.length}/7 giorni · dalle {String(form.rr_start_hour).padStart(2,"0")}:00 alle {String(form.rr_end_hour).padStart(2,"0")}:00 · ogni {form.rr_frequency_minutes}min
                {form.rr_days.length && form.rr_end_hour > form.rr_start_hour
                  ? ` ≈ ${Math.floor(((form.rr_end_hour-form.rr_start_hour)*60)/form.rr_frequency_minutes)+1} occorrenze/giorno`
                  : ""}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Tabs pending / consumed ───────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-2">
        {[
          { k: "pending", label: `In coda · ${pending.length}` },
          { k: "consumed", label: `Storico · ${consumed.length}` },
        ].map((t) => (
          <button
            key={t.k}
            onClick={() => { setTab(t.k); if (t.k === "consumed") loadEvents("consumed"); }}
            data-testid={`timeline-tab-${t.k}`}
            className="px-3 py-1 rounded text-xs font-mono uppercase"
            style={{
              background: tab === t.k ? "rgba(0,229,255,0.18)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${tab === t.k ? "rgba(0,229,255,0.6)" : "rgba(255,255,255,0.08)"}`,
              color: tab === t.k ? "#00E5FF" : "#aaa",
            }}
          >
            {t.label}
          </button>
        ))}
        <div className="ml-auto text-[10px] font-mono text-zinc-500">
          auto-refresh ogni 8s
        </div>
      </div>

      <div
        className="rounded-lg overflow-hidden"
        style={{ border: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.4)" }}
        data-testid="timeline-list"
      >
        {(tab === "pending" ? pending : consumed).length === 0 && (
          <div className="p-4 text-center text-xs font-mono text-zinc-500">
            {tab === "pending" ? "Nessun evento in coda. Inserisci il primo qui sopra." : "Nessun evento consumato."}
          </div>
        )}
        {(tab === "pending" ? pending : consumed).map((ev) => {
          const color = KIND_COLOR[ev.kind] || "#00E5FF";
          const until = tab === "pending" ? minutesUntil(ev.scheduled_at) : null;
          return (
            <div
              key={ev.id}
              className="flex items-center gap-3 px-3 py-2 border-b border-white/5"
              data-testid={`timeline-row-${ev.id}`}
            >
              <div
                className="px-2 py-0.5 rounded text-[10px] font-mono uppercase"
                style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}
              >
                {KIND_LABEL[ev.kind] || ev.kind}
              </div>
              <div className="font-mono text-[12px] text-white min-w-[92px]">
                {fmtDate(ev.scheduled_at)} · <b>{fmtWhen(ev.scheduled_at)}</b>
              </div>
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm text-white flex items-center gap-1.5">
                  {(ev.recurrence && ev.recurrence !== "none") || ev.repeat_daily ? (
                    <span
                      className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider"
                      style={{ background: "rgba(0,229,255,0.14)", color: "#00E5FF", border: "1px solid rgba(0,229,255,0.4)" }}
                      title="Ricorrente"
                    >🔁 {ev.recurrence === "hourly" ? "hourly" : ev.recurrence === "weekly" ? "weekly" : "daily"}</span>
                  ) : null}
                  {ev.video_url && (
                    <span
                      className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider"
                      style={{ background: "rgba(128,255,180,0.14)", color: "#80FFB4", border: "1px solid rgba(128,255,180,0.4)" }}
                      title="LedWall override durante l'evento"
                    >🖥️ {ev.video_url.startsWith("fx:") ? "fx" : "video"}</span>
                  )}
                  <span className="truncate">{ev.title || "—"}</span>
                </div>
                <div className="truncate text-[10px] font-mono text-zinc-500 flex items-center gap-2">
                  {ev.dj_name && (
                    <span
                      className="px-1.5 py-0.5 rounded uppercase tracking-wider"
                      style={{ background: "rgba(0,229,255,0.14)", color: "#00E5FF", border: "1px solid rgba(0,229,255,0.4)" }}
                      data-testid={`timeline-row-dj-${ev.id}`}
                      title="Speaker assegnato all'evento"
                    >
                      🎙 {ev.dj_name}
                    </span>
                  )}
                  <span className="truncate">{ev.audio_url}</span>
                </div>
              </div>
              <div className="text-[10px] font-mono text-zinc-400 min-w-[80px] text-right">
                {ev.duration_sec}s
              </div>
              {tab === "pending" && (
                <>
                  <div
                    className="text-[10px] font-mono min-w-[110px] text-right"
                    style={{ color: until?.overdue ? "#FFB84D" : "#80FFB4" }}
                    title={until?.overdue ? "Il server sta rispettando il brano corrente (soft-sync)" : ""}
                  >
                    {until?.label}
                  </div>
                  <button
                    onClick={() => (editingId === ev.id ? cancelEdit() : startEdit(ev))}
                    data-testid={`timeline-edit-${ev.id}`}
                    className="text-zinc-400 hover:text-cyan-300 text-sm px-1"
                    title="Modifica evento"
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => remove(ev.id)}
                    data-testid={`timeline-remove-${ev.id}`}
                    className="text-zinc-400 hover:text-red-400 text-sm px-1"
                    title="Rimuovi evento"
                  >
                    ✕
                  </button>
                </>
              )}
              {tab === "consumed" && (
                <div className="text-[10px] font-mono text-zinc-500 min-w-[110px] text-right">
                  {ev.consumed_at ? `andato in onda ${fmtWhen(ev.consumed_at)}` : ev.status}
                </div>
              )}
            </div>
          );
        })}
        {/* v13.36 · FIX (ticket #247410): pannello di modifica inline per l'evento
            pending attualmente in editing. Renderizzato fuori dal .map sopra per
            semplicità (una sola card di edit visibile alla volta). */}
        {editingId && editDraft && (() => {
          const ev = pending.find((e) => e.id === editingId);
          if (!ev) return null;
          return (
            <div
              className="px-3 py-3 border-b border-white/10"
              style={{ background: "rgba(0,229,255,0.06)" }}
              data-testid={`timeline-edit-panel-${ev.id}`}
            >
              <div className="text-[10px] font-mono uppercase tracking-wider text-cyan-300 mb-2">
                Modifica evento · {KIND_LABEL[ev.kind] || ev.kind}
              </div>
              <div className="grid sm:grid-cols-3 gap-2 mb-2">
                <div>
                  <label className="label-mono block mb-1 text-[10px]">Orario</label>
                  <input
                    type="datetime-local"
                    value={editDraft.scheduled_at}
                    onChange={(e) => setEditDraft((d) => ({ ...d, scheduled_at: e.target.value }))}
                    className="w-full bg-zinc-900 border border-white/10 rounded px-2 py-1 text-white text-xs"
                  />
                </div>
                <div>
                  <label className="label-mono block mb-1 text-[10px]">Titolo</label>
                  <input
                    type="text"
                    value={editDraft.title}
                    onChange={(e) => setEditDraft((d) => ({ ...d, title: e.target.value }))}
                    className="w-full bg-zinc-900 border border-white/10 rounded px-2 py-1 text-white text-xs"
                  />
                </div>
                <div>
                  <label className="label-mono block mb-1 text-[10px]">Durata (s)</label>
                  <input
                    type="number"
                    min="1"
                    value={editDraft.duration_sec}
                    onChange={(e) => setEditDraft((d) => ({ ...d, duration_sec: e.target.value }))}
                    className="w-full bg-zinc-900 border border-white/10 rounded px-2 py-1 text-white text-xs"
                  />
                </div>
              </div>
              <div className="mb-2">
                <label className="label-mono block mb-1 text-[10px]">
                  Aggiungi spot concatenati dopo l'evento (opzionale)
                  {ev.follow_ups?.length ? ` · già presenti: ${ev.follow_ups.length}` : ""}
                </label>
                <AssetPicker sources={sources} multiple value={editDraft.followUpIds} onChange={(ids) => setEditDraft((d) => ({ ...d, followUpIds: ids }))} testid={`timeline-edit-followups-${ev.id}`} />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => saveEdit(ev)}
                  disabled={editBusy}
                  data-testid={`timeline-edit-save-${ev.id}`}
                  className="px-3 py-1 rounded text-xs font-mono bg-cyan-500/20 border border-cyan-400/40 text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50"
                >
                  {editBusy ? "Salvataggio…" : "Salva"}
                </button>
                <button
                  onClick={cancelEdit}
                  disabled={editBusy}
                  className="px-3 py-1 rounded text-xs font-mono bg-white/5 border border-white/10 text-zinc-300 hover:bg-white/10"
                >
                  Annulla
                </button>
              </div>
            </div>
          );
        })()}
      </div>
    </section>
  );
}
