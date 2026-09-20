import React, { useEffect, useState, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import {
  Megaphone, Upload, Trash2, Zap, Film, Image as ImageIcon,
  Volume2, Radio, Play,
} from "lucide-react";

/**
 * AdManagerPanel — v13.32
 *
 * Gestione unificata delle inserzioni pubblicitarie:
 *  • Ogni AD ha una coppia audio + visual (video/immagine opzionale)
 *  • Ruoli: `intro`, `spot`, `outro`
 *  • FLASH AD: inserisce IMMEDIATAMENTE un cluster [intro]+[N spot]+[outro]
 *    in coda al brano corrente (soft-sync, no hard-cut)
 *  • L'evento "Break Pubblicitario" del Master Calendar genera lo stesso
 *    cluster in modo programmato (recurrence supportata via rrule)
 *
 * Il LedWall segue automaticamente il `video_url` dell'AD in onda tramite
 * il campo `current.video_url` esposto dal clock.
 */
const KIND_META = {
  intro:  { label: "Jingle Intro",  color: "#00E5FF", icon: Zap },
  spot:   { label: "Spot",          color: "#FF8A3D", icon: Megaphone },
  outro:  { label: "Jingle Outro",  color: "#D080FF", icon: Radio },
};

export default function AdManagerPanel() {
  const [spots, setSpots] = useState([]);
  const [busy, setBusy] = useState(false);
  const [filterKind, setFilterKind] = useState("all");
  const [flashCount, setFlashCount] = useState(2);
  const audioRef = useRef(null);
  const visualRef = useRef(null);
  const [form, setForm] = useState({
    kind: "spot", name: "", weight: 20,
    sponsor_note: "", start_date: "", end_date: "",
  });

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/ad-manager");
      setSpots(data.spots || []);
    } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  const uploadPair = async () => {
    const audio = audioRef.current?.files?.[0];
    if (!audio) {
      toast.error("Seleziona almeno il file AUDIO");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("audio_file", audio);
      fd.append("kind", form.kind);
      if (form.name.trim()) fd.append("name", form.name.trim());
      fd.append("weight", String(form.weight));
      if (form.sponsor_note.trim()) fd.append("sponsor_note", form.sponsor_note.trim());
      if (form.start_date) fd.append("start_date", form.start_date);
      if (form.end_date) fd.append("end_date", form.end_date);
      const visual = visualRef.current?.files?.[0];
      if (visual) fd.append("visual_file", visual);
      await api.post("/admin/ad-manager/upload", fd);
      toast.success(`AD ${form.kind} caricata`);
      setForm({ kind: form.kind, name: "", weight: 20, sponsor_note: "", start_date: "", end_date: "" });
      if (audioRef.current) audioRef.current.value = "";
      if (visualRef.current) visualRef.current.value = "";
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Upload fallito");
    } finally { setBusy(false); }
  };

  const doDelete = async (sid) => {
    if (!window.confirm("Eliminare questa inserzione?")) return;
    try {
      await api.delete(`/admin/ad-manager/${sid}`);
      toast.success("AD eliminata");
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Errore"); }
  };

  const flashAd = async () => {
    if (!window.confirm(`Inserire IMMEDIATAMENTE un cluster [intro]+${flashCount} spot+[outro] in coda?`)) return;
    try {
      const { data } = await api.post("/admin/ad-manager/flash", { count: flashCount });
      toast.success(`FLASH AD: ${data.cluster_len} segmenti in coda`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Flash AD fallito");
    }
  };

  const shown = filterKind === "all" ? spots : spots.filter(s => s.kind === filterKind);
  const backend = process.env.REACT_APP_BACKEND_URL || "";
  const abs = (u) => (u && u.startsWith("http")) ? u : `${backend}${u || ""}`;

  const stats = {
    intro: spots.filter(s => s.kind === "intro").length,
    spot: spots.filter(s => s.kind === "spot").length,
    outro: spots.filter(s => s.kind === "outro").length,
  };

  return (
    <section
      data-testid="ad-manager-panel"
      className="lg:col-span-4 card-surface p-6 flex flex-col gap-5"
      style={{ borderColor: "rgba(255, 138, 61, 0.28)" }}
    >
      <header className="flex items-center justify-between gap-3 border-b border-white/5 pb-3">
        <div className="flex items-center gap-3">
          <Megaphone className="w-6 h-6" style={{ color: "#FF8A3D" }} />
          <div>
            <div className="label-mono" style={{ color: "#FF8A3D" }}>AD MANAGER</div>
            <div className="text-xs text-zinc-500">
              Cluster [Intro] → [N Spot Random] → [Outro] · LedWall sync automatico
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-400">
          <span>Intro: <b className="text-cyan-300">{stats.intro}</b></span>
          <span>Spot: <b className="text-orange-300">{stats.spot}</b></span>
          <span>Outro: <b className="text-purple-300">{stats.outro}</b></span>
        </div>
      </header>

      {/* FLASH AD control bar */}
      <div className="rounded-lg p-4 flex flex-wrap items-center gap-4"
           style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,138,61,0.18)" }}>
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-orange-400" />
          <div>
            <div className="font-semibold text-zinc-100">FLASH AD</div>
            <div className="text-[11px] text-zinc-500">Inserisce IMMEDIATAMENTE il cluster in coda</div>
          </div>
        </div>
        <label className="text-xs text-zinc-400 flex items-center gap-2">
          Spot random:
          <input
            data-testid="flash-ad-count"
            type="number" min={1} max={6} value={flashCount}
            onChange={(e) => setFlashCount(Math.max(1, Math.min(6, parseInt(e.target.value) || 2)))}
            className="input text-xs py-1 px-2 w-14"
          />
        </label>
        <button
          data-testid="flash-ad-btn"
          onClick={flashAd}
          disabled={!spots.some(s => s.kind === "spot")}
          className="btn-primary text-xs flex items-center gap-1.5"
          title={spots.some(s => s.kind === "spot") ? "Lancia cluster" : "Servono almeno 1 spot"}
        >
          <Zap className="w-3.5 h-3.5" /> FLASH ADESSO
        </button>
      </div>

      {/* Upload creativa */}
      <div className="rounded-lg p-4 flex flex-col gap-3"
           style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,138,61,0.12)" }}>
        <div className="flex items-center gap-2">
          <Upload className="w-4 h-4 text-orange-300" />
          <span className="label-mono text-orange-300">NUOVA INSERZIONE</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="label-mono block mb-1">Ruolo</label>
            <select
              data-testid="ad-manager-kind"
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}
              className="input text-sm w-full"
            >
              <option value="intro">Jingle Intro</option>
              <option value="spot">Spot</option>
              <option value="outro">Jingle Outro</option>
            </select>
          </div>
          <div>
            <label className="label-mono block mb-1">Nome (opzionale)</label>
            <input
              data-testid="ad-manager-name"
              type="text" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input text-sm w-full"
              placeholder="Es. Spot Estate 2026"
            />
          </div>
          <div>
            <label className="label-mono block mb-1">Peso weighted-random</label>
            <input
              type="number" min={1} max={100} value={form.weight}
              onChange={(e) => setForm({ ...form, weight: parseInt(e.target.value) || 20 })}
              className="input text-sm w-full"
              data-testid="ad-manager-weight"
            />
          </div>
          <div>
            <label className="label-mono block mb-1 flex items-center gap-1"><Volume2 className="w-3 h-3" /> File audio (obbligatorio)</label>
            <input ref={audioRef} type="file" accept="audio/*" data-testid="ad-manager-audio-input" className="text-xs w-full" />
          </div>
          <div>
            <label className="label-mono block mb-1 flex items-center gap-1"><Film className="w-3 h-3" /> Video/Foto (opzionale)</label>
            <input ref={visualRef} type="file" accept="video/*,image/*" data-testid="ad-manager-visual-input" className="text-xs w-full" />
          </div>
          <div>
            <label className="label-mono block mb-1">Note sponsor (opz)</label>
            <input
              type="text" value={form.sponsor_note}
              onChange={(e) => setForm({ ...form, sponsor_note: e.target.value })}
              className="input text-sm w-full"
              placeholder="Cliente / campagna"
              data-testid="ad-manager-sponsor-note"
            />
          </div>
          <div>
            <label className="label-mono block mb-1">Valida da (opz)</label>
            <input
              type="datetime-local" value={form.start_date}
              onChange={(e) => setForm({ ...form, start_date: e.target.value })}
              className="input text-sm w-full"
            />
          </div>
          <div>
            <label className="label-mono block mb-1">Valida fino (opz)</label>
            <input
              type="datetime-local" value={form.end_date}
              onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              className="input text-sm w-full"
            />
          </div>
          <div className="flex items-end">
            <button
              data-testid="ad-manager-upload-btn"
              onClick={uploadPair}
              disabled={busy}
              className="btn-primary text-sm w-full flex items-center justify-center gap-1.5"
            >
              <Upload className="w-3.5 h-3.5" /> {busy ? "Carico…" : "CARICA INSERZIONE"}
            </button>
          </div>
        </div>
      </div>

      {/* Lista + filtro */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="label-mono text-[10px] text-zinc-500">FILTRO:</span>
        {["all", ...Object.keys(KIND_META)].map(k => (
          <button
            key={k}
            data-testid={`ad-filter-${k}`}
            onClick={() => setFilterKind(k)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              filterKind === k
                ? "border-orange-400/60 text-orange-300 bg-orange-400/10"
                : "border-white/10 text-zinc-400 hover:border-white/25"
            }`}
          >
            {k === "all" ? "Tutte" : KIND_META[k].label}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-zinc-500">{shown.length} visualizzate</span>
      </div>

      <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto pr-1">
        {shown.length === 0 && (
          <div className="text-sm text-zinc-500 italic py-4 text-center">
            Nessuna inserzione. Carica almeno 1 Intro, 1 Spot e 1 Outro per costruire un cluster completo.
          </div>
        )}
        {shown.map(s => {
          const meta = KIND_META[s.kind] || KIND_META.spot;
          const Icon = meta.icon;
          const isVideo = s.visual_ext && ["mp4", "webm", "mov"].includes(s.visual_ext);
          return (
            <div key={s.id} data-testid={`ad-row-${s.id}`}
                 className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0">
              <Icon className="w-4 h-4 flex-shrink-0" style={{ color: meta.color }} />
              <span
                className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded font-bold flex-shrink-0"
                style={{ background: `${meta.color}18`, color: meta.color, border: `1px solid ${meta.color}35` }}
              >
                {meta.label}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate text-zinc-200">{s.name}</div>
                {s.sponsor_note && <div className="text-[10px] text-zinc-500 truncate">{s.sponsor_note}</div>}
              </div>
              <span className="text-[11px] text-zinc-500 flex-shrink-0">w:{s.weight}</span>
              <span className="text-[11px] text-zinc-500 flex-shrink-0">{Math.round(s.duration_sec || 0)}s</span>
              <audio src={abs(s.audio_url)} controls className="h-6" style={{ width: 120 }} />
              {s.video_url && (
                <span
                  className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded"
                  style={{ background: "rgba(0,229,255,0.12)", color: "#00E5FF" }}
                  title="Con visual sincronizzato al LedWall"
                >
                  {isVideo ? <Film className="w-3 h-3" /> : <ImageIcon className="w-3 h-3" />}
                  VISUAL
                </span>
              )}
              <button
                data-testid={`ad-delete-${s.id}`}
                onClick={() => doDelete(s.id)}
                className="text-red-400 hover:text-red-300 flex-shrink-0"
                title="Elimina"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
