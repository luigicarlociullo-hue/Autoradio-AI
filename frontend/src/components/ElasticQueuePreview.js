import React, { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { ListMusic, Timer, Radio, Sparkles } from "lucide-react";

/**
 * ElasticQueuePreview — Coda Elastica (Regia Morbida).
 *
 * Espone al Direttore i prossimi 3-5 elementi che entreranno in onda dopo
 * la fine naturale del brano corrente. Include anche gli eventi Timeline
 * imminenti (che soft-sync farà entrare al primo confine di segmento).
 * Zero polling aggressivo: refresh ogni 15s.
 */
function fmtTimeIt(iso) {
  try {
    return new Date(iso).toLocaleTimeString("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Rome",
    });
  } catch {
    return "—";
  }
}

const KIND_LABELS = {
  ora_esatta: { label: "Ora Esatta", color: "#00E5FF" },
  spot: { label: "Spot", color: "#FFDE59" },
  dj_talk: { label: "DJ Talk", color: "#FF8A3D" },
  rubrica: { label: "Rubrica", color: "#D080FF" },
  jingle: { label: "Jingle", color: "#A0F078" },
  music: { label: "Music", color: "#8AA0FF" },
};

export default function ElasticQueuePreview() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/stream/queue");
      setData(data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, [load]);

  const queue = data?.queue || [];
  const upcoming = data?.timeline_upcoming || [];

  return (
    <section
      data-testid="elastic-queue-preview"
      className="lg:col-span-2 card-surface p-6 flex flex-col gap-3"
      style={{ borderColor: "rgba(0, 229, 255, 0.22)" }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <ListMusic className="w-5 h-5" style={{ color: "#00E5FF" }} />
          <div>
            <div className="label-mono" style={{ color: "#00E5FF" }}>CODA ELASTICA</div>
            <div className="text-xs text-zinc-500">Prossimi elementi in attesa — soft-sync attivo</div>
          </div>
        </div>
        {loading && <span className="text-[10px] text-zinc-600 italic">…</span>}
      </div>

      <div className="flex flex-col gap-1.5">
        {queue.length === 0 && !loading && (
          <div className="text-sm text-zinc-500 italic">Coda vuota.</div>
        )}
        {queue.map((q, idx) => {
          const meta = KIND_LABELS[q.kind] || KIND_LABELS.music;
          return (
            <div
              key={q.id || idx}
              data-testid={`queue-item-${idx}`}
              className="flex items-center gap-3 py-1.5 border-b border-white/5 last:border-0"
            >
              <span className="text-xs font-mono text-zinc-600 w-4">{idx + 1}</span>
              <span
                className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded font-bold flex-shrink-0"
                style={{
                  background: `${meta.color}15`,
                  color: meta.color,
                  border: `1px solid ${meta.color}30`,
                  minWidth: 66,
                  textAlign: "center",
                }}
              >
                {meta.label}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate text-zinc-200">
                  {q.is_power_play && <Sparkles className="w-3 h-3 inline mr-1" style={{ color: "#FF8A3D" }} />}
                  {q.title || "—"}
                </div>
                {q.artist && <div className="text-[11px] text-zinc-500 truncate">{q.artist}</div>}
              </div>
              <span className="text-[11px] text-zinc-500 font-mono flex-shrink-0">
                {q.duration_sec ? `${Math.round(q.duration_sec)}s` : ""}
              </span>
            </div>
          );
        })}
      </div>

      {upcoming.length > 0 && (
        <div className="mt-1 pt-3 border-t border-white/5">
          <div className="label-mono text-[9px] mb-1.5 flex items-center gap-1" style={{ color: "#D080FF" }}>
            <Timer className="w-3 h-3" /> TIMELINE PROGRAMMATA (soft-sync)
          </div>
          {upcoming.map((tl, idx) => {
            const meta = KIND_LABELS[tl.kind] || { label: tl.kind || "Event", color: "#D080FF" };
            return (
              <div key={tl.id || idx} className="flex items-center gap-2 text-xs py-0.5" data-testid={`timeline-upcoming-${idx}`}>
                <span className="font-mono text-zinc-500 w-12">{fmtTimeIt(tl.scheduled_at)}</span>
                <span
                  className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded font-bold"
                  style={{ background: `${meta.color}15`, color: meta.color, border: `1px solid ${meta.color}30` }}
                >
                  {meta.label}
                </span>
                <span className="text-zinc-300 truncate flex-1">{tl.title || tl.dj_name || "Timeline event"}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-1 pt-3 border-t border-white/5 flex items-center gap-2 text-[10px] text-zinc-600">
        <Radio className="w-3 h-3" />
        <span>Nessun brano viene interrotto: la coda scorre al termine naturale di ogni segmento.</span>
      </div>
    </section>
  );
}
