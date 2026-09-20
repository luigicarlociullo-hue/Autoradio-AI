import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { toast, Toaster } from "sonner";

/**
 * v13.28 · MASTER CALENDAR · Full-Screen Palinsesto (dual-screen mode)
 * ---------------------------------------------------------------------------
 * Rotta dedicata `/admin/calendar` che l'utente apre in una scheda separata.
 * Vista giornaliera stile Google Calendar mobile:
 *   ▸ asse temporale verticale 00:00 → 23:59 (righelli ogni ora)
 *   ▸ blocchi colorati per tipo evento posizionati sull'orario esatto
 *   ▸ altezza block ∝ durata reale (min 24px)
 *   ▸ tap sul blocco → azioni (delete)
 *   ▸ filtro tipo + ricerca full-text (title/dj)
 *   ▸ auto-refresh polling ogni 12s (real-time senza WebSocket, resistente)
 *   ▸ zero ResizeObserver: layout Flexbox/Grid puro, no third-party charts
 *   ▸ pagina isolata: chiuderla non tocca nulla dello stream o della regia
 */

const KIND_META = {
  jingle:       { icon: "🔔", label: "Jingle",         color: "#00E5FF" },
  time_signal:  { icon: "🕐", label: "Segnale Orario", color: "#00E5FF" },
  ora_esatta:   { icon: "🕐", label: "Ora Esatta",     color: "#00E5FF" },
  past_pill:    { icon: "🌌", label: "Pill. Passato",  color: "#FFB84D" },
  future_pill:  { icon: "🚀", label: "Pill. Futuro",   color: "#80FFB4" },
  rubric:       { icon: "🎙", label: "Rubrica",        color: "#FF6BAA" },
  insert:       { icon: "▸",  label: "Inserto",        color: "#D080FF" },
  ad:           { icon: "📢", label: "Spot",           color: "#FF5577" },
  ad_break:     { icon: "📢", label: "Break Pubblicitario", color: "#FF8A3D" },
  music:        { icon: "🎵", label: "Disco del Giorno", color: "#3AE0FF" },
};

const kindMeta = (k) => KIND_META[k] || { icon: "•", label: k || "evento", color: "#888" };

// Layout constants (px)
const HOUR_HEIGHT = 60;          // ogni ora = 60px
const TOTAL_HEIGHT = HOUR_HEIGHT * 24;

const pad2 = (n) => String(n).padStart(2, "0");
const fmtHM = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const isSameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

// v13.29 · Calcola il range temporale [from, to] della vista corrente.
// week: lun→dom della settimana di `date`. month: intero mese.
const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const endOfDay   = (d) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };
const startOfWeek = (d) => {
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7; // Mon=0
  x.setDate(x.getDate() - dow);
  return x;
};
const endOfWeek = (d) => {
  const s = startOfWeek(d); const e = new Date(s); e.setDate(e.getDate()+6);
  return endOfDay(e);
};
const startOfMonth = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), 1); return x; };
const endOfMonth = (d) => { const x = new Date(d.getFullYear(), d.getMonth()+1, 0); return endOfDay(x); };
function getViewRange(date, view) {
  if (view === "week")  return { from: startOfWeek(date),  to: endOfWeek(date)  };
  if (view === "month") return { from: startOfMonth(date), to: endOfMonth(date) };
  return { from: startOfDay(date), to: endOfDay(date) };
}

export default function AdminCalendar() {
  const [events, setEvents] = useState([]);
  const [now, setNow] = useState(new Date());
  const [filterKind, setFilterKind] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [view, setView] = useState("day"); // day | week | month
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const pollRef = useRef(null);
  const scrollerRef = useRef(null);
  const initialScrollRef = useRef(false);

  // Auth check via `/regia/me` (JWT admin). Il localStorage token è già
  // agganciato automaticamente da lib/auth.js interceptor.
  const [authed, setAuthed] = useState(null);
  useEffect(() => {
    api.get("/regia/me")
      .then(() => setAuthed(true))
      .catch(() => { setAuthed(false); window.location.replace("/admin/login"); });
  }, []);

  const load = async () => {
    try {
      // v13.29 · Usa il nuovo endpoint /calendar che unisce eventi concreti
      // (pending+consumed) + occorrenze virtuali dei template rrule, e
      // calcola i conflitti. Range dipende dalla vista corrente per non
      // sprecare payload sui mesi.
      const range = getViewRange(selectedDate, view);
      const params = { from_ts: range.from.toISOString(), to_ts: range.to.toISOString(), limit_virtual: 500 };
      const r = await api.get("/admin/timeline/calendar", { params });
      setEvents(r.data.events || []);
    } catch (e) {
      if (e?.response?.status === 401) toast.error("Sessione admin scaduta");
    }
  };

  useEffect(() => {
    if (!authed) return;
    load();
    pollRef.current = setInterval(() => { load(); setNow(new Date()); }, 12000);
    return () => clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, selectedDate, view]);

  // Al primo render → scroll all'ora corrente (offset -1h di contesto)
  useEffect(() => {
    if (!scrollerRef.current || initialScrollRef.current) return;
    const target = Math.max(0, (now.getHours() - 1) * HOUR_HEIGHT);
    scrollerRef.current.scrollTop = target;
    initialScrollRef.current = true;
  }, [now]);

  const eventsToday = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter((e) => {
      let d;
      try { d = new Date(e.scheduled_at); } catch { return false; }
      if (!isSameDay(d, selectedDate)) return false;
      if (filterKind !== "all" && e.kind !== filterKind) return false;
      if (q) {
        const hay = `${e.title || ""} ${e.dj_name || ""} ${e.artist || ""} ${e.kind || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [events, filterKind, search, selectedDate]);

  const kindCount = useMemo(() => {
    const c = {};
    events.forEach((e) => {
      try {
        if (isSameDay(new Date(e.scheduled_at), selectedDate)) {
          c[e.kind] = (c[e.kind] || 0) + 1;
        }
      } catch {}
    });
    return c;
  }, [events, selectedDate]);

  const deleteEvent = async (id) => {
    if (!window.confirm("Eliminare questo evento dal palinsesto?")) return;
    setBusy(true);
    try {
      await api.delete(`/admin/timeline/${id}`);
      toast.success("Evento eliminato");
      setEvents((prev) => prev.filter((e) => e.id !== id));
      setExpandedId(null);
    } catch { toast.error("Errore eliminazione"); }
    finally { setBusy(false); }
  };

  // Position/height calc
  const eventBlock = (ev) => {
    let d;
    try { d = new Date(ev.scheduled_at); } catch { return null; }
    const startMin = d.getHours() * 60 + d.getMinutes();
    const dur = Math.max(6, Math.min(3600, ev.duration_sec || 30));
    const durMin = dur / 60;
    const top = (startMin / 60) * HOUR_HEIGHT;
    const height = Math.max(24, (durMin / 60) * HOUR_HEIGHT);
    return { top, height, start: d };
  };

  const isFuture = (ev) => {
    try { return new Date(ev.scheduled_at).getTime() > now.getTime(); }
    catch { return false; }
  };

  if (authed === null) {
    return (
      <div className="min-h-screen flex items-center justify-center text-white bg-black">
        <div className="font-mono text-sm opacity-70">Autenticazione…</div>
      </div>
    );
  }

  const dayLabel = selectedDate.toLocaleDateString("it-IT", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  const nowTop = (now.getHours() * 60 + now.getMinutes()) / 60 * HOUR_HEIGHT;
  const showNowLine = isSameDay(now, selectedDate);

  return (
    <div
      className="min-h-screen w-full flex flex-col text-white"
      style={{
        background: "radial-gradient(ellipse at top, #0f1e2e 0%, #030812 55%, #000 100%)",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
      data-testid="admin-calendar-page"
    >
      <Toaster theme="dark" position="top-right" />

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header
        className="flex-none px-6 py-4 flex items-center justify-between gap-4"
        style={{
          background: "rgba(4,12,22,0.75)",
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          borderBottom: "1px solid rgba(0,229,255,0.15)",
        }}
      >
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "#00E5FF" }}>
            R-A.I. · MASTER CALENDAR
          </div>
          <div className="text-2xl font-black capitalize" style={{ letterSpacing: "-0.02em" }}>
            {dayLabel}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSelectedDate((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - (view==="month"?30:view==="week"?7:1)))}
            className="px-3 py-1.5 rounded text-sm font-mono"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
            data-testid="calendar-prev-day"
          >←</button>
          <button
            onClick={() => setSelectedDate(new Date())}
            className="px-3 py-1.5 rounded text-sm font-bold text-black"
            style={{ background: "#00E5FF", boxShadow: "0 0 12px rgba(0,229,255,0.5)" }}
            data-testid="calendar-today"
          >Oggi</button>
          <button
            onClick={() => setSelectedDate((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + (view==="month"?30:view==="week"?7:1)))}
            className="px-3 py-1.5 rounded text-sm font-mono"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
            data-testid="calendar-next-day"
          >→</button>
          <input
            type="date"
            value={`${selectedDate.getFullYear()}-${pad2(selectedDate.getMonth()+1)}-${pad2(selectedDate.getDate())}`}
            onChange={(e) => { if (e.target.value) setSelectedDate(new Date(e.target.value + "T00:00:00")); }}
            className="bg-black/60 border border-white/10 rounded px-2 py-1 text-sm text-white font-mono"
            data-testid="calendar-date-picker"
          />
          <div className="flex rounded border border-white/10 overflow-hidden">
            {["day","week","month"].map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                data-testid={`calendar-view-${v}`}
                className="px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider"
                style={{
                  background: view===v ? "rgba(0,229,255,0.22)" : "rgba(255,255,255,0.03)",
                  color: view===v ? "#00E5FF" : "#aaa",
                  borderRight: v==="month" ? "none" : "1px solid rgba(255,255,255,0.06)",
                }}
              >
                {v==="day"?"Giorno":v==="week"?"Settimana":"Mese"}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ── Filtri ──────────────────────────────────────────────────────── */}
      <div
        className="flex-none px-6 py-3 flex flex-wrap items-center gap-3"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(4,12,22,0.4)" }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">Cerca</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="titolo, DJ, tipo…"
            className="w-56 bg-black/60 border border-white/10 rounded px-2 py-1 text-sm text-white"
            data-testid="calendar-search"
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {[["all", "Tutti"], ...Object.entries(KIND_META).map(([k, m]) => [k, m.label])].map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilterKind(k)}
              data-testid={`calendar-filter-${k}`}
              className="px-2.5 py-1 rounded text-[11px] font-mono uppercase tracking-wider"
              style={{
                background: filterKind === k ? "rgba(0,229,255,0.18)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${filterKind === k ? "rgba(0,229,255,0.6)" : "rgba(255,255,255,0.08)"}`,
                color: filterKind === k ? "#00E5FF" : "#bbb",
              }}
            >
              {k !== "all" && (
                <span style={{ marginRight: 6 }}>{kindMeta(k).icon}</span>
              )}
              {label}
              {kindCount[k] ? <span className="ml-1 opacity-70">·{kindCount[k]}</span> : null}
            </button>
          ))}
        </div>
        <div className="ml-auto text-[11px] font-mono text-zinc-500">
          {eventsToday.length} evento/i · auto-refresh 12s
        </div>
      </div>

      {/* ── Corpo Calendario · switch vista Day/Week/Month ─────────── */}
      {view === "day" && (
      <div
        ref={scrollerRef}
        className="flex-1 overflow-auto"
        style={{ scrollbarGutter: "stable" }}
        data-testid="calendar-scroller"
      >
        <div className="grid" style={{ gridTemplateColumns: "72px 1fr", minHeight: TOTAL_HEIGHT }}>
          {/* Righello ore */}
          <div className="relative border-r border-white/5" style={{ height: TOTAL_HEIGHT }}>
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                className="absolute left-0 right-0 flex items-start justify-end pr-2 text-[10px] font-mono text-zinc-500"
                style={{ top: h * HOUR_HEIGHT, height: HOUR_HEIGHT }}
              >
                {pad2(h)}:00
              </div>
            ))}
          </div>

          {/* Timeline blocchi */}
          <div className="relative" style={{ height: TOTAL_HEIGHT }}>
            {/* Righe orarie di sfondo */}
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                className="absolute left-0 right-0 border-t border-white/5"
                style={{ top: h * HOUR_HEIGHT }}
              />
            ))}
            {/* Now line */}
            {showNowLine && (
              <div
                className="absolute left-0 right-0 z-30 pointer-events-none"
                style={{ top: nowTop }}
                data-testid="calendar-now-line"
              >
                <div className="flex items-center">
                  <div
                    className="w-3 h-3 rounded-full -ml-1"
                    style={{ background: "#FF3355", boxShadow: "0 0 10px #FF3355" }}
                  />
                  <div className="flex-1 h-[2px]" style={{ background: "#FF3355", boxShadow: "0 0 6px #FF3355" }} />
                  <div
                    className="px-1.5 py-0.5 rounded-l text-[9px] font-mono font-bold"
                    style={{ background: "#FF3355", color: "#fff" }}
                  >
                    {fmtHM(now)}
                  </div>
                </div>
              </div>
            )}

            {/* Blocchi evento */}
            {eventsToday.map((ev) => {
              const pos = eventBlock(ev);
              if (!pos) return null;
              const meta = kindMeta(ev.kind);
              const past = !isFuture(ev);
              const consumed = ev.status === "consumed";
              const isVirtual = ev.is_virtual || ev.status === "virtual";
              const hasConflict = (ev.conflicts || []).length > 0;
              const expanded = expandedId === ev.id;
              return (
                <div
                  key={ev.id}
                  data-testid={`calendar-event-${ev.id}`}
                  onClick={() => setExpandedId(expanded ? null : ev.id)}
                  className="absolute left-2 right-2 rounded-lg overflow-hidden cursor-pointer transition-all"
                  style={{
                    top: pos.top,
                    height: expanded ? Math.max(pos.height, 96) : pos.height,
                    background: `linear-gradient(135deg, ${meta.color}${past ? "22" : "44"}, ${meta.color}0a)`,
                    border: `1px ${isVirtual ? "dashed" : "solid"} ${meta.color}${past ? "44" : "aa"}`,
                    boxShadow: expanded
                      ? `0 0 24px ${meta.color}88, inset 0 0 0 1px ${meta.color}55`
                      : hasConflict ? `0 0 12px #FF335588` : `0 2px 8px rgba(0,0,0,0.4)`,
                    zIndex: expanded ? 20 : 10,
                    opacity: consumed ? 0.55 : (isVirtual ? 0.85 : 1),
                    backdropFilter: "blur(10px)",
                    WebkitBackdropFilter: "blur(10px)",
                  }}
                >
                  <div className="p-2 h-full flex flex-col overflow-hidden">
                    <div className="flex items-center gap-2">
                      <div
                        className="text-lg leading-none"
                        style={{ filter: `drop-shadow(0 0 4px ${meta.color})` }}
                      >{meta.icon}</div>
                      <div
                        className="text-[10px] font-mono font-bold"
                        style={{ color: meta.color }}
                      >{fmtHM(pos.start)}</div>
                      <div className="text-[9px] font-mono uppercase tracking-wider opacity-60 truncate">
                        {meta.label}
                      </div>
                      {(ev.recurrence && ev.recurrence !== "none") && (
                        <span
                          className="text-[8px] font-mono px-1 rounded"
                          style={{ background: `${meta.color}22`, border: `1px solid ${meta.color}66` }}
                          title="Ricorrente"
                        >🔁 {ev.recurrence === "hourly" ? "H" : ev.recurrence === "weekly" ? "W" : "D"}</span>
                      )}
                      {ev.video_url && (
                        <span
                          className="text-[8px] font-mono px-1 rounded"
                          style={{ background: "rgba(128,255,180,0.14)", border: "1px solid rgba(128,255,180,0.4)", color: "#80FFB4" }}
                          title="LedWall override"
                        >🖥</span>
                      )}
                      {consumed && (
                        <span className="text-[8px] font-mono px-1 rounded opacity-70" style={{ background: "rgba(255,255,255,0.08)" }}>
                          ✓ andato
                        </span>
                      )}
                      {isVirtual && (
                        <span className="text-[8px] font-mono px-1 rounded"
                          style={{ background: `${meta.color}22`, border: `1px dashed ${meta.color}77`, color: meta.color }}
                          title="Occorrenza virtuale · verrà materializzata quando l'ora si avvicina">
                          👁 virtual
                        </span>
                      )}
                      {hasConflict && (
                        <span className="text-[8px] font-mono px-1 rounded"
                          style={{ background: "rgba(255,51,85,0.18)", border: "1px solid #FF335599", color: "#FF3355" }}
                          title={`Sovrapposizione con ${ev.conflicts.length} evento/i · vince il più recente`}>
                          ⚠ conflitto ×{ev.conflicts.length}
                        </span>
                      )}
                    </div>
                    <div className="text-sm font-bold truncate mt-1" style={{ color: past ? "#ccc" : "#fff" }}>
                      {ev.title || "—"}
                    </div>
                    {ev.dj_name && (
                      <div className="text-[10px] font-mono truncate" style={{ color: meta.color, opacity: 0.9 }}>
                        🎙 {ev.dj_name}
                      </div>
                    )}
                    {expanded && (
                      <div className="mt-auto pt-2 flex items-center gap-2">
                        <div className="text-[10px] font-mono text-zinc-400 truncate flex-1">
                          {ev.duration_sec}s · {ev.audio_url ? ev.audio_url.split("/").slice(-1)[0] : "no audio"}
                        </div>
                        {!consumed && (
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteEvent(ev.id); }}
                            disabled={busy}
                            data-testid={`calendar-delete-${ev.id}`}
                            className="px-2 py-1 rounded text-[10px] font-bold"
                            style={{ background: "rgba(255,45,149,0.25)", border: "1px solid rgba(255,45,149,0.6)", color: "#fff" }}
                            title="Elimina evento"
                          >
                            🗑 Elimina
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {eventsToday.length === 0 && (
              <div
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
                style={{ top: 200 }}
              >
                <div className="text-center opacity-60">
                  <div className="text-4xl mb-2">📅</div>
                  <div className="font-mono text-sm text-zinc-400">
                    Nessun evento {filterKind !== "all" ? `di tipo "${kindMeta(filterKind).label}"` : ""} in questa giornata
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      {/* v13.29 · WEEK VIEW · 7 colonne × 24h con blocchi compatti */}
      {view === "week" && (
        <div className="flex-1 overflow-auto" data-testid="calendar-week-view">
          <div className="grid" style={{ gridTemplateColumns: "60px repeat(7, 1fr)", minHeight: TOTAL_HEIGHT + 32 }}>
            <div className="sticky top-0 z-20 bg-black/50 backdrop-blur border-b border-white/10 h-8" />
            {(() => {
              const s = startOfWeek(selectedDate);
              return Array.from({ length: 7 }, (_, i) => {
                const d = new Date(s); d.setDate(s.getDate()+i);
                const isToday = isSameDay(d, now);
                return (
                  <div key={i} className="sticky top-0 z-20 bg-black/50 backdrop-blur border-b border-l border-white/10 px-2 py-1 text-center">
                    <div className="text-[9px] font-mono uppercase text-zinc-500">{d.toLocaleDateString("it-IT",{weekday:"short"})}</div>
                    <div className="text-sm font-bold" style={{ color: isToday ? "#00E5FF" : "#fff" }}>{d.getDate()}/{pad2(d.getMonth()+1)}</div>
                  </div>
                );
              });
            })()}
            {/* Righello ore */}
            <div className="relative border-r border-white/5" style={{ height: TOTAL_HEIGHT }}>
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="absolute left-0 right-0 flex items-start justify-end pr-2 text-[9px] font-mono text-zinc-500"
                  style={{ top: h * HOUR_HEIGHT, height: HOUR_HEIGHT }}>{pad2(h)}</div>
              ))}
            </div>
            {/* 7 colonne giorni */}
            {(() => {
              const s = startOfWeek(selectedDate);
              return Array.from({ length: 7 }, (_, i) => {
                const day = new Date(s); day.setDate(s.getDate()+i);
                const dayEvents = events.filter((e) => {
                  try { return isSameDay(new Date(e.scheduled_at), day); } catch { return false; }
                });
                return (
                  <div key={i} className="relative border-l border-white/5" style={{ height: TOTAL_HEIGHT }}>
                    {Array.from({ length: 24 }, (_, h) => (
                      <div key={h} className="absolute left-0 right-0 border-t border-white/5" style={{ top: h * HOUR_HEIGHT }} />
                    ))}
                    {isSameDay(day, now) && (
                      <div className="absolute left-0 right-0 z-30" style={{ top: (now.getHours()*60+now.getMinutes())/60*HOUR_HEIGHT }}>
                        <div className="h-[2px]" style={{ background: "#FF3355", boxShadow: "0 0 6px #FF3355" }} />
                      </div>
                    )}
                    {dayEvents.map((ev) => {
                      const meta = kindMeta(ev.kind);
                      let d0; try { d0 = new Date(ev.scheduled_at); } catch { return null; }
                      const top = ((d0.getHours()*60 + d0.getMinutes())/60) * HOUR_HEIGHT;
                      const height = Math.max(18, ((ev.duration_sec||30)/3600) * HOUR_HEIGHT);
                      const isVirtual = ev.is_virtual || ev.status === "virtual";
                      const hasConflict = (ev.conflicts || []).length > 0;
                      return (
                        <div key={ev.id} data-testid={`calendar-event-${ev.id}`}
                          onClick={() => { setSelectedDate(day); setView("day"); }}
                          className="absolute left-0.5 right-0.5 rounded overflow-hidden cursor-pointer"
                          style={{
                            top, height, zIndex: 10,
                            background: `${meta.color}${isVirtual ? "22" : "55"}`,
                            border: `1px ${isVirtual ? "dashed" : "solid"} ${meta.color}${isVirtual ? "77" : "cc"}`,
                          }}
                          title={`${fmtHM(d0)} · ${ev.title || meta.label}${isVirtual?" · virtual":""}${hasConflict?" · CONFLITTO":""}`}
                        >
                          <div className="p-1 flex items-center gap-1 text-[9px] font-mono truncate">
                            <span>{meta.icon}</span>
                            <span className="truncate" style={{ color: meta.color }}>{fmtHM(d0)}</span>
                            {hasConflict && <span title="Conflitto sovrapposizione" style={{ color: "#FF3355" }}>⚠</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}

      {/* v13.29 · MONTH VIEW · grid 7×N con lista compatta eventi per giorno */}
      {view === "month" && (
        <div className="flex-1 overflow-auto p-4" data-testid="calendar-month-view">
          <div className="grid grid-cols-7 gap-1 text-[10px] font-mono uppercase text-zinc-500 mb-1">
            {["Lun","Mar","Mer","Gio","Ven","Sab","Dom"].map((d) => (<div key={d} className="text-center">{d}</div>))}
          </div>
          {(() => {
            const first = startOfMonth(selectedDate);
            const startCell = startOfWeek(first);
            const cells = [];
            for (let i = 0; i < 42; i++) {
              const d = new Date(startCell); d.setDate(startCell.getDate()+i);
              cells.push(d);
              if (i >= 34 && d.getMonth() !== selectedDate.getMonth()) break;
            }
            const eventsByDay = new Map();
            events.forEach((e) => {
              try { const d = new Date(e.scheduled_at); const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
                if (!eventsByDay.has(k)) eventsByDay.set(k, []);
                eventsByDay.get(k).push(e);
              } catch {}
            });
            return (
              <div className="grid grid-cols-7 gap-1">
                {cells.map((d, idx) => {
                  const inMonth = d.getMonth() === selectedDate.getMonth();
                  const isToday = isSameDay(d, now);
                  const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
                  const dayEvents = eventsByDay.get(k) || [];
                  const anyConflict = dayEvents.some((e) => (e.conflicts || []).length > 0);
                  return (
                    <div key={idx}
                      onClick={() => { setSelectedDate(d); setView("day"); }}
                      className="rounded p-1.5 min-h-[80px] cursor-pointer transition-all"
                      style={{
                        background: isToday ? "rgba(0,229,255,0.10)" : "rgba(255,255,255,0.02)",
                        border: `1px solid ${isToday ? "rgba(0,229,255,0.5)" : "rgba(255,255,255,0.06)"}`,
                        opacity: inMonth ? 1 : 0.35,
                      }}
                      data-testid={`calendar-month-cell-${k}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold" style={{ color: isToday ? "#00E5FF" : "#ccc" }}>{d.getDate()}</span>
                        <div className="flex items-center gap-1">
                          {anyConflict && <span title="Conflitti" style={{ color: "#FF3355" }} className="text-xs">⚠</span>}
                          {dayEvents.length > 0 && <span className="text-[9px] font-mono text-zinc-400">·{dayEvents.length}</span>}
                        </div>
                      </div>
                      <div className="space-y-0.5 max-h-[80px] overflow-hidden">
                        {dayEvents.slice(0, 4).map((e) => {
                          const meta = kindMeta(e.kind);
                          let d0; try { d0 = new Date(e.scheduled_at); } catch { return null; }
                          return (
                            <div key={e.id} className="flex items-center gap-1 text-[9px] font-mono truncate"
                              style={{ color: meta.color, opacity: e.is_virtual ? 0.75 : 1 }}>
                              <span>{meta.icon}</span>
                              <span>{fmtHM(d0)}</span>
                              <span className="truncate opacity-75">{e.title || meta.label}</span>
                            </div>
                          );
                        })}
                        {dayEvents.length > 4 && (<div className="text-[8px] font-mono text-zinc-500">+{dayEvents.length-4} altri</div>)}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Footer sync info ───────────────────────────────────────────── */}
      <footer
        className="flex-none px-6 py-2 text-[10px] font-mono text-zinc-500 flex items-center justify-between"
        style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(4,12,22,0.6)" }}
      >
        <span>Master Calendar · finestra indipendente · chiusura non impatta stream/regia</span>
        <span>↻ ultimo refresh {fmtHM(now)}</span>
      </footer>
    </div>
  );
}
