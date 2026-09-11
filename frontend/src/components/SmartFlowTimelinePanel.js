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
  past_pill: "#FFB84D",
  future_pill: "#80FFB4",
  rubric: "#FF6BAA",
  insert: "#D080FF",
  ad: "#FF5577",
};
const KIND_LABEL = {
  jingle: "Jingle",
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
  const [tab, setTab] = useState("pending"); // pending | consumed
  const [busy, setBusy] = useState(false);
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
      // Solo DJ diurni (Leo, Aria, Max, L&C) — night_slot null/absent
      const daytime = (r.data || []).filter((d) => !d.night_slot);
      setDjs(daytime);
    } catch {}
  };

  useEffect(() => {
    loadNow(); loadEvents("pending"); loadEvents("consumed"); loadSources(); loadDjs();
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
    if (!form.audio_url) return toast.error("Scegli una sorgente dal Magazzino");
    setBusy(true);
    try {
      const localDate = fromLocalInput(form.scheduled_at);
      const iso = localDate.toISOString(); // UTC ISO
      const body = {
        scheduled_at: iso,
        kind: form.kind,
        title: form.title || undefined,
        audio_url: form.audio_url,
        duration_sec: Number(form.duration_sec) || 30,
        dj_id: form.dj_id || undefined,
      };
      await api.post("/admin/timeline", body);
      toast.success(`Evento inserito · ${fmtWhen(iso)}`);
      const t = new Date(); t.setMinutes(t.getMinutes() + 5, 0, 0);
      setForm({
        scheduled_at: toLocalInput(t),
        kind: form.kind, source_id: "", audio_url: "", title: "", duration_sec: 30,
        dj_id: form.dj_id,
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
              disabled={busy || !form.audio_url}
              data-testid="timeline-submit"
              className="w-full px-3 py-2 rounded text-sm font-bold text-black"
              style={{
                background: KIND_COLOR[form.kind] || "#00E5FF",
                boxShadow: `0 0 12px ${KIND_COLOR[form.kind] || "#00E5FF"}66`,
                opacity: busy || !form.audio_url ? 0.55 : 1,
              }}
            >
              {busy ? "Inserisco…" : "▸ Inserisci evento"}
            </button>
          </div>
        </div>

        {form.audio_url && (
          <div className="text-[10px] font-mono text-zinc-500 mt-2 truncate" title={form.audio_url}>
            audio_url: {form.audio_url}
          </div>
        )}
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
                <div className="truncate text-sm text-white">{ev.title || "—"}</div>
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
