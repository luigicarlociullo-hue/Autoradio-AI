import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";

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

export default function SmartFlowTimelinePanel() {
  const [now, setNow] = useState(null); // /api/stream/now
  const [pending, setPending] = useState([]);
  const [consumed, setConsumed] = useState([]);
  const [sources, setSources] = useState([]); // /admin/tracks/searchable
  const [djs, setDjs] = useState([]);        // /djs
  const [videos, setVideos] = useState([]);  // /admin/ledwall/videos
  const [tab, setTab] = useState("pending"); // pending | consumed
  const [busy, setBusy] = useState(false);
  // v13.22 · Config globale di Regia (soggetto default + video default)
  const [regiaCfg, setRegiaCfg] = useState({ default_subject: "", ledwall_default_video_url: "" });
  const [regiaBusy, setRegiaBusy] = useState(false);
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
    loadNow(); loadEvents("pending"); loadEvents("consumed"); loadSources(); loadDjs(); loadVideos(); loadRegiaCfg();
    pollRef.current = setInterval(() => {
      loadNow();
      loadEvents("pending");
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

      {/* v13.22 · REGIA CONFIG UNIVERSALE — barra in cima */}
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
                      {v.display_name} ({Math.round((v.size || 0) / 1024 / 1024)}MB)
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
            <select
              value={form.source_id}
              onChange={(e) => onPickSource(e.target.value)}
              className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white"
              data-testid="timeline-input-source"
            >
              <option value="">— seleziona traccia/jingle —</option>
              {sources.slice(0, 400).map((s) => (
                <option key={s.id} value={s.id}>
                  [{s.kind}] {s.title} — {s.artist}
                  {s.duration_sec ? ` (${Math.round(s.duration_sec)}s)` : ""}
                </option>
              ))}
            </select>
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
              {/* v13.33 · Sequenza concatenata multipla (qualsiasi kind, con o senza DJ) */}
              <div className="md:col-span-4 rounded p-2" style={{ background: "rgba(128,255,180,0.04)", border: "1px dashed rgba(128,255,180,0.3)" }} data-testid="rr-followups-panel">
                <div className="flex items-center justify-between mb-1">
                  <span className="label-mono" style={{ color: "#80FFB4" }}>🔗 MP3 concatenati a seguire (zero-gap, in ordine)</span>
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
                <select
                  value=""
                  onChange={(e) => { if (e.target.value) setFollowUpIds((l) => [...l, e.target.value]); }}
                  data-testid="rr-followup-add"
                  className="w-full mt-1 bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white"
                >
                  <option value="">＋ aggiungi MP3 concatenato…</option>
                  {sources.slice(0, 300).map((s) => (
                    <option key={s.id} value={s.id}>[{s.kind}] {s.title} — {s.artist} ({Math.round(s.duration_sec || 0)}s)</option>
                  ))}
                </select>
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
      </div>
    </section>
  );
}
