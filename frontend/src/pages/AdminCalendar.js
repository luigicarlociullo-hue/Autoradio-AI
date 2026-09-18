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

export default function AdminCalendar() {
  const [events, setEvents] = useState([]);
  const [now, setNow] = useState(new Date());
  const [filterKind, setFilterKind] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
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
      // Pending + consumed del giorno selezionato
      const [pRes, cRes] = await Promise.all([
        api.get("/admin/timeline", { params: { status: "pending", limit: 500 } }),
        api.get("/admin/timeline", { params: { status: "consumed", limit: 500 } }),
      ]);
      const all = [
        ...(pRes.data.events || []),
        ...(cRes.data.events || []),
      ];
      setEvents(all);
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
  }, [authed]);

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
            onClick={() => setSelectedDate((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1))}
            className="px-3 py-1.5 rounded text-sm font-mono"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
            data-testid="calendar-prev-day"
          >← Ieri</button>
          <button
            onClick={() => setSelectedDate(new Date())}
            className="px-3 py-1.5 rounded text-sm font-bold text-black"
            style={{ background: "#00E5FF", boxShadow: "0 0 12px rgba(0,229,255,0.5)" }}
            data-testid="calendar-today"
          >Oggi</button>
          <button
            onClick={() => setSelectedDate((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1))}
            className="px-3 py-1.5 rounded text-sm font-mono"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
            data-testid="calendar-next-day"
          >Domani →</button>
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

      {/* ── Corpo Calendario · Grid HH + Timeline ──────────────────────── */}
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
                    border: `1px solid ${meta.color}${past ? "44" : "aa"}`,
                    boxShadow: expanded
                      ? `0 0 24px ${meta.color}88, inset 0 0 0 1px ${meta.color}55`
                      : `0 2px 8px rgba(0,0,0,0.4)`,
                    zIndex: expanded ? 20 : 10,
                    opacity: consumed ? 0.55 : 1,
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
