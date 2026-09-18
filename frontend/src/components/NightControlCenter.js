import React, { useEffect, useState, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import {
  Moon, Volume2, VolumeX, Zap, Sparkles, Upload, Trash2,
  Film, Image as ImageIcon, RefreshCw, Music, Wand2,
} from "lucide-react";

/**
 * NightControlCenter — pannello unificato v13.31
 *
 * Sezioni:
 *  A) AI SPEAKER (toggle globale voce DJ, zero costo quando OFF)
 *  B) BEATMATCH NOTTE (pre-render acrossfade ffmpeg, 22-06)
 *  C) JINGLE LIBRARY (voice_over + station_break upload/delete)
 *  D) NIGHT ASSETS (mp4/photo/fx per LedWall Virtual Club)
 *
 * Ogni azione fa refresh SELETTIVO della sua slice — zero polling globale.
 */
const FX_PRESETS = [
  { key: "effects", label: "Effetti audio-reattivi (default)" },
  { key: "starfield", label: "Starfield" },
  { key: "plasma", label: "Plasma Nebula" },
  { key: "matrix", label: "Matrix Rain" },
  { key: "kaleido", label: "Kaleidoscope" },
  { key: "neon_pulse", label: "Neon Pulse" },
];

export default function NightControlCenter() {
  return (
    <section
      data-testid="night-control-center"
      className="lg:col-span-4 card-surface p-6 flex flex-col gap-5"
      style={{ borderColor: "rgba(140, 100, 255, 0.28)" }}
    >
      <header className="flex items-center gap-3 border-b border-white/5 pb-3">
        <Moon className="w-6 h-6" style={{ color: "#C89AFF" }} />
        <div>
          <div className="label-mono" style={{ color: "#C89AFF" }}>NIGHT CONTROL CENTER</div>
          <div className="text-xs text-zinc-500">
            AI Speaker · Beatmatch · Jingle Library · Virtual Club (22:00 → 06:00)
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <AISpeakerBlock />
        <BeatmatchBlock />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <JingleLibraryBlock />
        <NightAssetsBlock />
      </div>

      <MaintenanceBlock />
    </section>
  );
}

/* ═════════════════════════════════════════════════════════════════════════ */
/* A · AI SPEAKER                                                            */
/* ═════════════════════════════════════════════════════════════════════════ */
function AISpeakerBlock() {
  const [enabled, setEnabled] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/ai-speaker");
      setEnabled(!!data.enabled);
    } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await api.patch("/admin/ai-speaker", { enabled: !enabled });
      setEnabled(!!data.enabled);
      toast.success(`AI Speaker ${data.enabled ? "ATTIVATO" : "SILENZIATO"}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Errore toggle");
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-lg p-4 flex items-center justify-between gap-4"
         style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,138,61,0.15)" }}>
      <div className="flex items-center gap-3">
        {enabled ? <Volume2 className="w-8 h-8 text-orange-400" /> : <VolumeX className="w-8 h-8 text-zinc-500" />}
        <div>
          <div className="font-semibold text-zinc-100">AI Speaker</div>
          <div className="text-xs text-zinc-500 max-w-xs">
            Quando OFF, la radio suona SOLO musica + jingle instrumentali.
            Zero costo LLM/TTS.
          </div>
        </div>
      </div>
      <button
        data-testid="ai-speaker-toggle"
        onClick={toggle}
        disabled={busy || enabled === null}
        className={enabled ? "btn-primary text-xs" : "btn-outline text-xs"}
      >
        {enabled === null ? "…" : enabled ? "SILENZIA" : "ATTIVA"}
      </button>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════ */
/* B · BEATMATCH                                                             */
/* ═════════════════════════════════════════════════════════════════════════ */
function BeatmatchBlock() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/beatmatch/status");
      setStatus(data);
    } catch {}
  }, []);
  useEffect(() => { load(); const iv = setInterval(load, 20000); return () => clearInterval(iv); }, [load]);

  const toggle = async () => {
    if (busy || !status) return;
    setBusy(true);
    try {
      const { data } = await api.patch("/admin/beatmatch", { enabled: !status.enabled });
      toast.success(`Beatmatch notte ${data.enabled ? "ON" : "OFF"}`);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Errore");
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-lg p-4 flex items-center justify-between gap-4"
         style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(140,100,255,0.15)" }}>
      <div className="flex items-center gap-3 min-w-0">
        <Zap className={`w-8 h-8 ${status?.enabled ? "text-purple-400" : "text-zinc-500"}`} />
        <div className="min-w-0">
          <div className="font-semibold text-zinc-100">Beatmatch Notte</div>
          <div className="text-[11px] text-zinc-500 max-w-xs">
            Pre-render acrossfade ffmpeg tra brani adiacenti in {status?.night_window || "22-06"}.
            Cache: <b className="text-zinc-300">{status?.cache_count ?? 0}</b> transizioni
            ({status?.cache_size_mb ?? 0} MB).
          </div>
          {status?.is_night_now && status?.enabled && (
            <div className="text-[10px] mt-1 uppercase tracking-widest text-purple-300 font-bold">
              ● NIGHT MODE ATTIVA
            </div>
          )}
        </div>
      </div>
      <button
        data-testid="beatmatch-toggle"
        onClick={toggle}
        disabled={busy || !status}
        className={status?.enabled ? "btn-primary text-xs" : "btn-outline text-xs"}
      >
        {status?.enabled ? "STOP" : "ATTIVA"}
      </button>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════ */
/* C · JINGLE LIBRARY                                                        */
/* ═════════════════════════════════════════════════════════════════════════ */
function JingleLibraryBlock() {
  const [jingles, setJingles] = useState([]);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef(null);
  const [uploadKind, setUploadKind] = useState("voice_over");
  const [uploadName, setUploadName] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/jingles");
      setJingles(data.jingles || []);
    } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  const doUpload = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("kind", uploadKind);
      if (uploadName.trim()) fd.append("name", uploadName.trim());
      await api.post("/admin/jingles/upload", fd);
      toast.success("Jingle caricato");
      setUploadName("");
      if (fileInput.current) fileInput.current.value = "";
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Upload fallito");
    } finally { setBusy(false); }
  };

  const doDelete = async (jid) => {
    if (!window.confirm("Eliminare questo jingle?")) return;
    try {
      await api.delete(`/admin/jingles/${jid}`);
      toast.success("Jingle eliminato");
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Errore"); }
  };

  return (
    <div className="rounded-lg p-4 flex flex-col gap-3"
         style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(0,229,255,0.15)" }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Music className="w-4 h-4 text-cyan-300" />
          <span className="label-mono text-cyan-300">JINGLE LIBRARY</span>
        </div>
        <span className="text-[10px] text-zinc-500">{jingles.length} totali</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          data-testid="jingle-kind-select"
          value={uploadKind}
          onChange={(e) => setUploadKind(e.target.value)}
          className="input text-xs py-1 px-2"
        >
          <option value="voice_over">Voice-Over (bianca)</option>
          <option value="station_break">Station Break (con base)</option>
        </select>
        <input
          data-testid="jingle-name-input"
          type="text"
          placeholder="Nome jingle (opz)"
          value={uploadName}
          onChange={(e) => setUploadName(e.target.value)}
          className="input text-xs py-1 px-2 flex-1 min-w-[140px]"
        />
        <input
          ref={fileInput}
          data-testid="jingle-file-input"
          type="file"
          accept="audio/*"
          onChange={doUpload}
          disabled={busy}
          className="text-xs"
        />
      </div>

      <div className="flex flex-col gap-1 max-h-40 overflow-y-auto pr-1">
        {jingles.length === 0 && <div className="text-xs text-zinc-500 italic">Nessun jingle caricato.</div>}
        {jingles.map((j) => (
          <div key={j.id} data-testid={`jingle-row-${j.id}`}
               className="flex items-center gap-2 text-xs py-1 border-b border-white/5 last:border-0">
            <span
              className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded font-bold flex-shrink-0"
              style={{
                background: j.kind === "voice_over" ? "rgba(0,229,255,0.15)" : "rgba(255,138,61,0.15)",
                color: j.kind === "voice_over" ? "#00E5FF" : "#FF8A3D",
                border: `1px solid ${j.kind === "voice_over" ? "rgba(0,229,255,0.3)" : "rgba(255,138,61,0.3)"}`,
              }}
            >
              {j.kind === "voice_over" ? "VOICE" : "BREAK"}
            </span>
            <span className="flex-1 truncate text-zinc-200">{j.name}</span>
            <span className="text-zinc-500 flex-shrink-0">{Math.round(j.duration_sec || 0)}s</span>
            <audio src={j.audio_url} controls className="h-6" style={{ width: 120 }} />
            <button
              data-testid={`jingle-delete-${j.id}`}
              onClick={() => doDelete(j.id)}
              className="text-red-400 hover:text-red-300"
              title="Elimina"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════ */
/* D · NIGHT ASSETS                                                          */
/* ═════════════════════════════════════════════════════════════════════════ */
function NightAssetsBlock() {
  const [assets, setAssets] = useState([]);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef(null);
  const [kind, setKind] = useState("photo");
  const [fxName, setFxName] = useState("effects");
  const [weight, setWeight] = useState(30);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/night-assets");
      setAssets(data.assets || []);
    } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  const uploadFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("kind", kind);
      fd.append("weight", String(weight));
      await api.post("/admin/night-assets/upload", fd);
      toast.success("Asset caricato");
      if (fileInput.current) fileInput.current.value = "";
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Upload fallito");
    } finally { setBusy(false); }
  };

  const addFx = async () => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("kind", "fx");
      fd.append("fx_name", fxName);
      fd.append("name", `FX ${fxName}`);
      fd.append("weight", String(weight));
      await api.post("/admin/night-assets/upload", fd);
      toast.success(`FX ${fxName} aggiunto`);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Errore");
    } finally { setBusy(false); }
  };

  const doDelete = async (aid) => {
    if (!window.confirm("Eliminare questo asset notturno?")) return;
    try {
      await api.delete(`/admin/night-assets/${aid}`);
      toast.success("Asset eliminato");
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Errore"); }
  };

  const kindIcon = { mp4: Film, photo: ImageIcon, fx: Wand2 };

  return (
    <div className="rounded-lg p-4 flex flex-col gap-3"
         style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(200,154,255,0.18)" }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Moon className="w-4 h-4 text-purple-300" />
          <span className="label-mono text-purple-300">VIRTUAL CLUB — NIGHT ASSETS</span>
        </div>
        <span className="text-[10px] text-zinc-500">{assets.length} totali</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          data-testid="night-kind-select"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="input text-xs py-1 px-2"
        >
          <option value="photo">Foto (Ken Burns)</option>
          <option value="mp4">MP4</option>
          <option value="fx">FX Procedurali</option>
        </select>
        <input
          data-testid="night-weight-input"
          type="number" min={1} max={100}
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          className="input text-xs py-1 px-2 w-16"
          title="Peso weighted-random (default 30)"
        />
        {kind === "fx" ? (
          <>
            <select
              data-testid="night-fx-select"
              value={fxName}
              onChange={(e) => setFxName(e.target.value)}
              className="input text-xs py-1 px-2 flex-1 min-w-[140px]"
            >
              {FX_PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
            <button
              data-testid="night-fx-add"
              onClick={addFx}
              disabled={busy}
              className="btn-outline text-xs flex items-center gap-1"
            >
              <Sparkles className="w-3 h-3" /> Aggiungi
            </button>
          </>
        ) : (
          <input
            ref={fileInput}
            data-testid="night-file-input"
            type="file"
            accept={kind === "mp4" ? "video/*" : "image/*"}
            onChange={uploadFile}
            disabled={busy}
            className="text-xs flex-1 min-w-[140px]"
          />
        )}
      </div>

      <div className="flex flex-col gap-1 max-h-40 overflow-y-auto pr-1">
        {assets.length === 0 && <div className="text-xs text-zinc-500 italic">Nessun asset. La radio userà gli effetti audio-reattivi.</div>}
        {assets.map((a) => {
          const Icon = kindIcon[a.kind] || Sparkles;
          return (
            <div key={a.id} data-testid={`night-row-${a.id}`}
                 className="flex items-center gap-2 text-xs py-1 border-b border-white/5 last:border-0">
              <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#C89AFF" }} />
              <span
                className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded font-bold flex-shrink-0"
                style={{ background: "rgba(200,154,255,0.12)", color: "#C89AFF", border: "1px solid rgba(200,154,255,0.28)" }}
              >
                {a.kind}
              </span>
              <span className="flex-1 truncate text-zinc-200">{a.name}</span>
              <span className="text-zinc-500 flex-shrink-0">w:{a.weight}</span>
              <span className="text-zinc-500 flex-shrink-0">{Math.round(a.duration_sec || 0)}s</span>
              <button
                data-testid={`night-delete-${a.id}`}
                onClick={() => doDelete(a.id)}
                className="text-red-400 hover:text-red-300"
                title="Elimina"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════ */
/* MAINTENANCE                                                               */
/* ═════════════════════════════════════════════════════════════════════════ */
function MaintenanceBlock() {
  const [busyBpm, setBusyBpm] = useState(false);
  const [busyIntro, setBusyIntro] = useState(false);

  const scanBpm = async () => {
    if (busyBpm) return;
    if (!window.confirm("Scan BPM offline su tutti i brani senza BPM? (zero costo API, girerà in background)")) return;
    setBusyBpm(true);
    try {
      await api.post("/admin/audio/reprobe-bpm-all", { force: false });
      toast.success("Scan BPM avviato in background");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Errore");
    } finally { setBusyBpm(false); }
  };

  const detectIntros = async () => {
    if (busyIntro) return;
    if (!window.confirm("Rileva intro strumentali su tutti i brani? (zero costo API, girerà in background)")) return;
    setBusyIntro(true);
    try {
      await api.post("/admin/audio/detect-intros", {});
      toast.success("Detect intro avviato in background");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Errore");
    } finally { setBusyIntro(false); }
  };

  const testVoiceOver = () => {
    window.dispatchEvent(new CustomEvent("rai:voice-over:play", { detail: {} }));
    toast.info("Voice-over triggerato · ducking -12dB sul main");
  };

  return (
    <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-white/5">
      <span className="label-mono text-[10px] text-zinc-500">MANUTENZIONE:</span>
      <button
        data-testid="scan-bpm-btn"
        onClick={scanBpm}
        disabled={busyBpm}
        className="btn-outline text-xs flex items-center gap-1.5"
      >
        <RefreshCw className={`w-3 h-3 ${busyBpm ? "animate-spin" : ""}`} /> Scan BPM offline
      </button>
      <button
        data-testid="detect-intros-btn"
        onClick={detectIntros}
        disabled={busyIntro}
        className="btn-outline text-xs flex items-center gap-1.5"
      >
        <Wand2 className="w-3 h-3" /> Rileva Intro strumentali
      </button>
      <button
        data-testid="test-voice-over-btn"
        onClick={testVoiceOver}
        className="btn-outline text-xs flex items-center gap-1.5"
      >
        <Volume2 className="w-3 h-3" /> Test Voice-Over
      </button>
    </div>
  );
}
