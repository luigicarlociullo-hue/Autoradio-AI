import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";

const KIND_LABEL = {
  music: "Musica",
  radioscope: "Radioscopo",
  past_pill: "Pillola Passato",
  future_pill: "Pillola Futuro",
  rubric: "Rubrica",
};
const KIND_COLOR = {
  music: "#00E5FF",
  radioscope: "#D080FF",
  past_pill: "#FFB84D",
  future_pill: "#80FFB4",
  rubric: "#FF6BAA",
};
const VIDEO_SOURCE_LABEL = {
  effects: "🌀 Effetti",
  video: "🎬 Video file",
  cam: "📹 Cam Live",
};

/**
 * MasterClockPanel — v13.2
 * Griglia 24h per assegnare titolo/soggetto/kind a ciascuna ora del giorno.
 * L'ora corrente è evidenziata con anello neon pulsante.
 */
export default function MasterClockPanel() {
  const [slots, setSlots] = useState([]);
  const [editing, setEditing] = useState(null); // slot in edit
  const [saving, setSaving] = useState(false);
  const [nowHour, setNowHour] = useState(new Date().getHours());
  const [videoLib, setVideoLib] = useState([]);
  const [containers, setContainers] = useState([]);   // v13.81 · contenitori notturni (fascia colorata sulle ore coperte)

  const containerAt = (hour) => containers.find((c) => {
    if (c.active === false) return false;
    const a = parseInt((c.start || "0").split(":")[0], 10), b = parseInt((c.end || "0").split(":")[0], 10);
    if (Number.isNaN(a) || Number.isNaN(b) || a === b) return false;
    return a < b ? (hour >= a && hour < b) : (hour >= a || hour < b);
  });

  const load = async () => {
    try {
      const r = await api.get("/admin/schedule");
      setSlots(r.data.schedule || []);
    } catch (e) {
      toast.error("Errore caricamento palinsesto");
    }
    try {
      const c = await api.get("/admin/containers");
      setContainers(c.data.containers || []);
    } catch (e) {}
    // v13.9 · carica libreria video per "Link Partner dinamico" (dropdown)
    try {
      const v = await api.get("/admin/ledwall/videos");
      setVideoLib(v.data.videos || []);
    } catch (e) {}
  };

  useEffect(() => {
    load();
    const iv = setInterval(() => setNowHour(new Date().getHours()), 30000);
    return () => clearInterval(iv);
  }, []);

  const saveSlot = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await api.patch(`/admin/schedule/${editing.hour}`, {
        title: editing.title || "",
        subject: editing.subject || "",
        kind: editing.kind || "music",
        video_source: editing.video_source || "effects",
        video_url: editing.video_url || "",
        partner_link: editing.partner_link || "",
      });
      toast.success(`${String(editing.hour).padStart(2, "0")}:00 salvato`);
      setEditing(null);
      load();
    } catch (e) {
      toast.error("Errore salvataggio");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className="lg:col-span-4 rounded-xl p-5"
      data-testid="master-clock-panel"
      style={{
        background: "linear-gradient(180deg, rgba(0,229,255,0.05), rgba(0,10,20,0.85))",
        border: "1px solid rgba(0,229,255,0.28)",
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="label-mono" style={{ color: "#00E5FF" }}>
            MASTER CLOCK · Palinsesto 24H
          </div>
          <div className="font-display font-black text-xl text-white mt-1">
            Il tuo orologio editoriale
          </div>
          <div className="text-[11px] font-mono text-zinc-400 mt-0.5">
            Assegna titolo, soggetto e tipo di rubrica a ciascuna delle 24 ore. L'ora corrente è evidenziata.
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-mono uppercase text-zinc-500">Ora locale</div>
          <div
            className="font-display font-black text-2xl"
            style={{ color: "#00E5FF", textShadow: "0 0 8px rgba(0,229,255,0.6)" }}
          >
            {String(nowHour).padStart(2, "0")}:00
          </div>
        </div>
      </div>

      {containers.filter((c) => c.active !== false).length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5" data-testid="clock-containers-legend">
          <span className="text-[9px] font-mono uppercase tracking-widest text-zinc-500">Contenitori notturni:</span>
          {containers.filter((c) => c.active !== false).map((c) => (
            <span key={c.id} className="text-[9px] font-mono px-1.5 py-0.5 rounded border" style={{ borderColor: `${c.color}66`, color: c.color, background: `${c.color}12` }}>
              <b className="font-display tracking-widest">{c.name}</b> {c.start}–{c.end}{c.is_active_now ? " · IN ONDA" : ""}
            </span>
          ))}
        </div>
      )}
      <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-1.5">
        {slots.map((s) => {
          const isNow = s.hour === nowHour;
          const color = KIND_COLOR[s.kind] || "#666";
          const filled = !!(s.title || s.subject) || s.kind !== "music";
          const cont = containerAt(s.hour);
          return (
            <button
              key={s.hour}
              onClick={() => setEditing({ ...s })}
              data-testid={`clock-slot-${s.hour}`}
              className="relative rounded p-1.5 text-left transition-all hover:scale-[1.03]"
              style={{
                background: filled ? `${color}18` : "rgba(255,255,255,0.02)",
                border: `1px solid ${isNow ? color : filled ? `${color}66` : "rgba(255,255,255,0.08)"}`,
                boxShadow: isNow ? `0 0 12px ${color}88` : "none",
                minHeight: 54,
                ...(cont ? { boxShadow: `inset 0 3px 0 ${cont.color}${isNow ? `, 0 0 12px ${color}88` : ""}` } : {}),
              }}
            >
              {cont && (
                <div className="absolute top-1 right-1 text-[7.5px] font-display font-black tracking-widest px-1 rounded"
                     style={{ background: `${cont.color}22`, color: cont.color }} title={`Contenitore ${cont.name} · ${cont.start}–${cont.end}`}
                     data-testid={`clock-slot-container-${s.hour}`}>
                  {cont.name}
                </div>
              )}
              <div
                className="text-[11px] font-mono font-bold leading-none"
                style={{ color: isNow ? "#fff" : "#eee" }}
              >
                {String(s.hour).padStart(2, "0")}:00
              </div>
              <div
                className="text-[8.5px] font-mono uppercase mt-0.5 truncate"
                style={{ color }}
              >
                {KIND_LABEL[s.kind] || s.kind}
              </div>
              {s.video_source && s.video_source !== "effects" && (
                <div className="text-[8px] mt-0.5 truncate text-cyan-300"
                     title={`Video: ${VIDEO_SOURCE_LABEL[s.video_source]}`}>
                  {s.video_source === "cam" ? "📹" : "🎬"}
                </div>
              )}
              {s.title && (
                <div className="text-[9px] mt-0.5 truncate text-zinc-300">
                  {s.title}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {editing && (
        <div
          className="mt-4 rounded-lg p-4"
          style={{
            background: "rgba(0,0,0,0.7)",
            border: `1px solid ${KIND_COLOR[editing.kind] || "#00E5FF"}66`,
          }}
          data-testid="clock-edit-panel"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="font-mono text-sm text-white">
              Slot ore <b>{String(editing.hour).padStart(2, "0")}:00</b>
            </div>
            <button
              onClick={() => setEditing(null)}
              className="text-zinc-400 hover:text-white text-xs"
              data-testid="clock-edit-close"
            >
              ✕ chiudi
            </button>
          </div>

          <label className="label-mono block mb-1" title="Tipo di contenuto che verrà generato o mostrato durante questa fascia oraria">Tipo rubrica</label>
          <select
            value={editing.kind}
            onChange={(e) => setEditing({ ...editing, kind: e.target.value })}
            className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white mb-3"
            data-testid="clock-edit-kind"
            title="Scegli cosa suonare/dire in quest'ora"
          >
            {Object.entries(KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>

          <label className="label-mono block mb-1" title="Cosa mostra il LedWall in quest'ora">Sorgente Video LedWall</label>
          <select
            value={editing.video_source || "effects"}
            onChange={(e) => setEditing({ ...editing, video_source: e.target.value })}
            className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white mb-3"
            data-testid="clock-edit-video-source"
            title="Effetti audio-reattivi (default) · File video statico · Cam/stream live"
          >
            {Object.entries(VIDEO_SOURCE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>

          {(editing.video_source === "video" || editing.video_source === "cam") && (
            <>
              {/* v13.9 · Link Partner dinamico — scegli dalla libreria mp4 caricati */}
              {editing.video_source === "video" && videoLib.length > 0 && (
                <>
                  <label className="label-mono block mb-1" title="Scegli un video dalla libreria (Magazzino Universale) oppure incolla un URL sotto">
                    🔗 Link Partner (video da libreria)
                  </label>
                  <select
                    value={editing.video_url || ""}
                    onChange={(e) => setEditing({ ...editing, video_url: e.target.value })}
                    className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white mb-2"
                    data-testid="clock-edit-video-lib"
                    title="Dropdown collegato ai file MP4 caricati nel Magazzino Universale"
                  >
                    <option value="">— URL manuale sotto —</option>
                    {videoLib.map((v) => (
                      <option key={v.id} value={v.url}>
                        {v.display_name || v.filename}
                        {v.duration_sec ? ` (${Math.round(v.duration_sec)}s)` : ""}
                        {v.is_stinger ? " · stinger" : ""}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <label className="label-mono block mb-1" title="URL del video mp4/webm o stream HLS/mp4">
                URL video/stream (manuale)
              </label>
              <input
                type="url"
                value={editing.video_url || ""}
                onChange={(e) => setEditing({ ...editing, video_url: e.target.value })}
                placeholder={editing.video_source === "cam" ? "https://.../live.m3u8" : "https://.../clip.mp4 oppure /api/ledwall_video/..."}
                className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white mb-2 font-mono"
                data-testid="clock-edit-video-url"
              />
              {/* v13.9 · Mini preview del video scelto */}
              {editing.video_url && (
                <div className="mb-3 rounded overflow-hidden bg-black border border-cyan-500/30" style={{ maxHeight: 120 }}>
                  <video
                    key={editing.video_url}
                    src={editing.video_url}
                    autoPlay muted loop playsInline
                    className="w-full max-h-[120px] object-cover"
                    data-testid="clock-edit-video-preview"
                    onError={() => toast.error("Preview: URL non riproducibile")}
                  />
                </div>
              )}
            </>
          )}

          <label className="label-mono block mb-1" title="URL sponsor/CTA cliccabile (opzionale)">
            🎯 Link Partner sponsor (opzionale)
          </label>
          <input
            type="url"
            value={editing.partner_link || ""}
            onChange={(e) => setEditing({ ...editing, partner_link: e.target.value })}
            placeholder="https://sponsor-partner.example"
            className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white mb-3 font-mono"
            data-testid="clock-edit-partner-link"
          />

          <label className="label-mono block mb-1" title="Titolo mostrato nel palinsesto della Home">Titolo</label>
          <input
            type="text"
            value={editing.title || ""}
            onChange={(e) => setEditing({ ...editing, title: e.target.value })}
            placeholder="Es. Buongiorno con Aria"
            className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white mb-3"
            data-testid="clock-edit-title"
          />

          <label className="label-mono block mb-1">Soggetto / brief</label>
          <textarea
            value={editing.subject || ""}
            onChange={(e) => setEditing({ ...editing, subject: e.target.value })}
            rows={3}
            placeholder="Descrivi tono, argomenti, brani preferiti per questa fascia oraria."
            className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white mb-3"
            data-testid="clock-edit-subject"
          />

          <button
            onClick={saveSlot}
            disabled={saving}
            data-testid="clock-edit-save"
            className="px-4 py-2 rounded text-sm font-bold text-black"
            style={{
              background: KIND_COLOR[editing.kind] || "#00E5FF",
              boxShadow: `0 0 12px ${KIND_COLOR[editing.kind] || "#00E5FF"}66`,
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "Salvo..." : "Salva slot"}
          </button>
        </div>
      )}
    </section>
  );
}
