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
};
const KIND_LABEL = {
  jingle: "Jingle",
  time_signal: "Segnale orario",
  past_pill: "Pillola Passato",
  future_pill: "Pillola Futuro",
  rubric: "Rubrica",
  insert: "Inserto libero",
  ad: "Spot",
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
  // v13.24 · Sequenza Ora Esatta + Spot
  const [hourly, setHourly] = useState({ config: { enabled: false }, next_event: null });
  const [hourlyForm, setHourlyForm] = useState({ ora_esatta_source_id: "", spot_source_id: "" });
  const [hourlyBusy, setHourlyBusy] = useState(false);
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
    };
  });
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
  // v13.24 · Sequenza Ora Esatta + Spot
  const loadHourly = async () => {
    try {
      const r = await api.get(`/admin/timeline/ora-esatta`);
      setHourly(r.data || { config: { enabled: false }, next_event: null });
    } catch {}
  };
  const armHourly = async () => {
    setHourlyBusy(true);
    try {
      const oraSrc = sources.find((s) => s.id === hourlyForm.ora_esatta_source_id);
      const spotSrc = sources.find((s) => s.id === hourlyForm.spot_source_id);
      const body = {};
      if (oraSrc) { body.audio_url = oraSrc.audio_url; body.duration_sec = Math.max(6, Math.round(oraSrc.duration_sec || 12)); }
      if (spotSrc) {
        body.spot_audio_url = spotSrc.audio_url;
        body.spot_title = spotSrc.title;
        body.spot_artist = spotSrc.artist;
        body.spot_duration_sec = Math.max(5, Math.round(spotSrc.duration_sec || 20));
      }
      const r = await api.post(`/admin/timeline/ora-esatta`, body);
      toast.success(`🕐 Sequenza armata @ ${new Date(r.data.event.scheduled_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`);
      await loadHourly();
      loadEvents("pending");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Errore Sequenza");
    } finally { setHourlyBusy(false); }
  };
  const disarmHourly = async () => {
    if (!window.confirm("Disarmare la Sequenza Ora Esatta+Spot? Verrà rimossa da tutte le occorrenze future.")) return;
    setHourlyBusy(true);
    try {
      await api.delete(`/admin/timeline/ora-esatta`);
      toast.success("Sequenza disarmata");
      await loadHourly();
      loadEvents("pending");
    } catch { toast.error("Errore disarmo"); }
    finally { setHourlyBusy(false); }
  };

  useEffect(() => {
    loadNow(); loadEvents("pending"); loadEvents("consumed"); loadSources(); loadDjs(); loadVideos(); loadRegiaCfg(); loadHourly();
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
    // v13.28 · Segnale Orario non richiede né sorgente né DJ: il backend
    // riusa il segnale orario reale già pre-generato.
    if (form.kind !== "time_signal" && !form.audio_url && !form.dj_id) {
      return toast.error("Scegli una sorgente dal Magazzino OPPURE seleziona un DJ");
    }
    setBusy(true);
    try {
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

      {/* v13.24 · SEQUENZA ORA ESATTA + SPOT — trigger ricorrente orario */}
      <div
        className="rounded-lg p-3 mb-4"
        style={{
          background: hourly.config?.enabled ? "rgba(0,229,255,0.06)" : "rgba(255,45,149,0.04)",
          border: `1px solid ${hourly.config?.enabled ? "rgba(0,229,255,0.32)" : "rgba(255,255,255,0.10)"}`,
        }}
        data-testid="hourly-sequence-panel"
      >
        <div className="flex items-center justify-between mb-2">
          <div className="label-mono" style={{ color: hourly.config?.enabled ? "#00E5FF" : "#FF6BAA" }}>
            🕐 SEQUENZA ORA ESATTA + SPOT · ricorrenza oraria automatica
          </div>
          <div className="text-[10px] font-mono" style={{ color: hourly.config?.enabled ? "#80FFB4" : "#888" }}>
            {hourly.config?.enabled
              ? `ARMATA · prossima :00 → ${hourly.next_event ? new Date(hourly.next_event.scheduled_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : "—"}`
              : "DISARMATA · scegli sorgenti e attiva"}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <div>
            <label className="label-mono block mb-1" title="Audio dell'annuncio orario. Se vuoto, usa l'ultimo time-signal pre-generato.">
              🎙 Audio Ora Esatta (opz.)
            </label>
            <select
              value={hourlyForm.ora_esatta_source_id}
              onChange={(e) => setHourlyForm({ ...hourlyForm, ora_esatta_source_id: e.target.value })}
              className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white"
              data-testid="hourly-ora-esatta-source"
            >
              <option value="">— usa time-signal pre-generato —</option>
              {sources.slice(0, 300).map((s) => (
                <option key={s.id} value={s.id}>[{s.kind}] {s.title} ({Math.round(s.duration_sec || 0)}s)</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-mono block mb-1" title="Spot pubblicitario o jingle che parte SUBITO dopo l'Ora Esatta (zero-gap, pre-buffered).">
              📢 Spot a seguire (concatenato)
            </label>
            <select
              value={hourlyForm.spot_source_id}
              onChange={(e) => setHourlyForm({ ...hourlyForm, spot_source_id: e.target.value })}
              className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white"
              data-testid="hourly-spot-source"
            >
              <option value="">— nessuno spot associato —</option>
              {sources.slice(0, 300).map((s) => (
                <option key={s.id} value={s.id}>[{s.kind}] {s.title} — {s.artist} ({Math.round(s.duration_sec || 0)}s)</option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <button
              onClick={armHourly}
              disabled={hourlyBusy}
              data-testid="hourly-arm-btn"
              className="flex-1 px-3 py-2 rounded text-sm font-bold text-black"
              style={{
                background: hourly.config?.enabled ? "#80FFB4" : "#00E5FF",
                opacity: hourlyBusy ? 0.55 : 1,
                boxShadow: `0 0 12px ${hourly.config?.enabled ? "#80FFB4" : "#00E5FF"}66`,
              }}
            >
              {hourlyBusy ? "…" : (hourly.config?.enabled ? "🔄 Aggiorna" : "▸ ARMA sequenza")}
            </button>
            {hourly.config?.enabled && (
              <button
                onClick={disarmHourly}
                disabled={hourlyBusy}
                data-testid="hourly-disarm-btn"
                className="px-3 py-2 rounded text-sm font-bold text-white"
                style={{ background: "rgba(255,45,149,0.25)", border: "1px solid rgba(255,45,149,0.6)" }}
                title="Disarma la sequenza"
              >
                ✕
              </button>
            )}
          </div>
        </div>
        {hourly.config?.enabled && (
          <div className="text-[10px] font-mono text-zinc-400 mt-2 flex flex-wrap gap-3">
            <span>⏱ Ora Esatta: {hourly.config.ora_esatta_audio_url ? hourly.config.ora_esatta_audio_url.split("/").slice(-1)[0] : "—"}</span>
            {hourly.config.spot_audio_url && (
              <span>📢 Spot: <b style={{ color: "#80FFB4" }}>{hourly.config.spot_title || hourly.config.spot_audio_url.split("/").slice(-1)[0]}</b> ({hourly.config.spot_duration_sec}s) · <b style={{color:"#00E5FF"}}>zero-gap</b> via follow-up</span>
            )}
          </div>
        )}
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

          <div className="md:col-span-1 flex items-end">
            <button
              onClick={submit}
              disabled={busy || (form.kind !== "time_signal" && !form.audio_url && !form.dj_id)}
              data-testid="timeline-submit"
              className="w-full px-3 py-2 rounded text-sm font-bold text-black"
              style={{
                background: KIND_COLOR[form.kind] || "#00E5FF",
                boxShadow: `0 0 12px ${KIND_COLOR[form.kind] || "#00E5FF"}66`,
                opacity: busy || (form.kind !== "time_signal" && !form.audio_url && !form.dj_id) ? 0.55 : 1,
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
              <option value="hourly">Ogni ora</option>
              <option value="daily">Ogni giorno</option>
              <option value="weekly">Ogni settimana</option>
            </select>
          </div>
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
