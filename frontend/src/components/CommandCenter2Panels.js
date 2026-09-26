import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";
import { Radio, Upload, Trash2, RotateCcw, Music, Film, Video } from "lucide-react";

/* ══════════════════════════════════════════════════════════════════════════
   GO LIVE PANEL — pulsante rosso pulsante per override LedWall immediato
   ══════════════════════════════════════════════════════════════════════════ */
export function GoLivePanel() {
  const [state, setState] = useState({ video_source: "effects", video_url: null, from_override: false });
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [videos, setVideos] = useState([]);

  const load = async () => {
    try {
      const r = await api.get("/ledwall/state");
      setState(r.data);
    } catch {}
    try {
      const v = await api.get("/admin/ledwall/videos");
      setVideos(v.data.videos || []);
    } catch {}
  };
  useEffect(() => { load(); const iv = setInterval(load, 5000); return () => clearInterval(iv); }, []);

  const goLive = async (source, videoUrl) => {
    setBusy(true);
    try {
      await api.patch("/admin/ledwall/override", { video_source: source, video_url: videoUrl });
      toast.success(`LedWall ${source === "effects" ? "torna agli Effetti" : "in DIRETTA " + source.toUpperCase()}`);
      load();
    } catch (e) { toast.error("Errore override"); }
    finally { setBusy(false); }
  };

  const clearOverride = () => goLive(null, null);
  const isLive = state.from_override && state.video_source !== "effects";

  return (
    <section
      className="lg:col-span-4 rounded-xl p-5"
      data-testid="go-live-panel"
      style={{
        background: isLive
          ? "linear-gradient(180deg, rgba(255,20,60,0.14), rgba(20,0,10,0.9))"
          : "linear-gradient(180deg, rgba(0,229,255,0.05), rgba(0,10,20,0.85))",
        border: `1px solid ${isLive ? "rgba(255,20,60,0.6)" : "rgba(0,229,255,0.28)"}`,
        boxShadow: isLive
          ? "0 0 22px rgba(255,20,60,0.4), inset 0 0 18px rgba(255,20,60,0.15)"
          : "0 0 14px rgba(0,229,255,0.15)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
      }}
    >
      <style>{`@keyframes livePulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.75;transform:scale(1.03)}}`}</style>
      <div className="flex items-center gap-2 mb-3">
        <Radio className="w-4 h-4" style={{ color: isLive ? "#FF3060" : "#00E5FF" }} />
        <span className="label-mono" style={{ color: isLive ? "#FF6B8C" : "#00E5FF" }}>
          GO LIVE · Override LedWall
        </span>
        {isLive && (
          <span
            className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold text-white"
            style={{ background: "#FF1F44", animation: "livePulse 1.2s infinite" }}
            data-testid="go-live-badge"
          >● ON AIR</span>
        )}
      </div>

      <div className="text-[11px] font-mono text-zinc-400 mb-3">
        Sorgente attuale: <span className="text-white">{state.video_source}</span>
        {state.video_url && <> · <span className="text-cyan-300 truncate">{state.video_url}</span></>}
        {!state.from_override && <span className="text-zinc-500"> (dal palinsesto)</span>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
        {/* Video file da libreria */}
        <div className="rounded p-2 border border-white/8 bg-black/40">
          <div className="text-[10px] font-mono uppercase text-cyan-300 mb-1">🎬 VIDEO DA LIBRERIA</div>
          <select
            className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-xs text-white mb-2"
            value=""
            onChange={(e) => e.target.value && goLive("video", e.target.value)}
            data-testid="go-live-video-select"
            title="Scegli un mp4 caricato per andare in onda subito"
          >
            <option value="">-- Scegli un video --</option>
            {videos.map((v) => (
              <option key={v.id} value={v.url}>{v.display_name || v.filename}</option>
            ))}
          </select>
        </div>
        {/* URL manuale */}
        <div className="rounded p-2 border border-white/8 bg-black/40">
          <div className="text-[10px] font-mono uppercase text-cyan-300 mb-1">📹 URL CAM/STREAM</div>
          <div className="flex gap-1">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://.../live.m3u8"
              className="flex-1 bg-black border border-white/10 rounded px-2 py-1.5 text-xs text-white font-mono"
              data-testid="go-live-url"
            />
            <button
              onClick={() => url && goLive("cam", url)}
              disabled={busy || !url}
              data-testid="go-live-cam-btn"
              className="px-2 py-1.5 rounded text-[10px] font-bold text-black"
              style={{ background: "#FF3060", opacity: (busy || !url) ? 0.5 : 1 }}
              title="Passa in diretta con questo stream"
            >GO</button>
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={clearOverride}
          disabled={busy || !state.from_override}
          data-testid="go-live-clear"
          className="flex-1 px-3 py-2 rounded text-xs font-mono font-bold"
          style={{
            background: state.from_override ? "linear-gradient(90deg, #00E5FF, #0080FF)" : "rgba(255,255,255,0.06)",
            color: state.from_override ? "#000" : "#666",
            border: "1px solid rgba(0,229,255,0.3)",
          }}
          title="Torna agli effetti audio-reattivi del palinsesto"
        >⏹ FINE DIRETTA · TORNA AGLI EFFETTI</button>
      </div>
    </section>
  );
}


/* ══════════════════════════════════════════════════════════════════════════
   LEDWALL MINI PREVIEW — mostra il LedWall live in Dashboard
   ══════════════════════════════════════════════════════════════════════════ */
export function LedWallMiniPreview() {
  const [state, setState] = useState({ video_source: "effects", video_url: null });
  useEffect(() => {
    let alive = true;
    const fetchIt = async () => {
      try {
        const r = await api.get("/ledwall/state");
        if (alive) setState(r.data);
      } catch {}
    };
    fetchIt();
    const iv = setInterval(fetchIt, 6000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  const isVideo = (state.video_source === "video" || state.video_source === "cam") && state.video_url;

  return (
    <section
      className="lg:col-span-2 rounded-xl p-3"
      data-testid="ledwall-mini-preview"
      style={{
        background: "linear-gradient(180deg, rgba(0,229,255,0.05), rgba(0,10,20,0.85))",
        border: "1px solid rgba(0,229,255,0.28)",
        backdropFilter: "blur(10px)",
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="label-mono" style={{ color: "#00E5FF" }}>
          <Video className="w-3.5 h-3.5 inline mr-1" /> LEDWALL · LIVE PREVIEW
        </div>
        <div className="text-[10px] font-mono text-zinc-400">
          {state.video_source} {state.from_override && "· OVERRIDE"}
        </div>
      </div>
      <div
        className="relative w-full rounded overflow-hidden bg-black"
        style={{ aspectRatio: "16 / 6.75", border: "1px solid rgba(0,229,255,0.2)" }}
      >
        {isVideo ? (
          <video
            key={state.video_url}
            src={state.video_url}
            autoPlay muted loop playsInline
            className="absolute inset-0 w-full h-full object-cover"
            data-testid="ledwall-mini-video"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-cyan-300/60 font-mono text-xs">
            🌀 EFFETTI AUDIO-REATTIVI
          </div>
        )}
      </div>
    </section>
  );
}


/* ══════════════════════════════════════════════════════════════════════════
   MAGAZZINO UNIVERSALE — filtri MP3/MP4 + Cestino + Coda Vocali
   ══════════════════════════════════════════════════════════════════════════ */
export function MagazzinoUniversale() {
  const [tab, setTab] = useState("audio"); // audio | video | trash | voice
  const [tracks, setTracks] = useState([]);
  const [videos, setVideos] = useState([]);
  const [trash, setTrash] = useState([]);
  const [voice, setVoice] = useState([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  // v13.39 · BULK ASSET MANAGER · selezione multipla + ZIP one-shot
  const [selected, setSelected] = useState({}); // key "audio:<id>" | "video:<id>" → {url,title}
  const [zipBusy, setZipBusy] = useState(false);
  const [zipLink, setZipLink] = useState(null);
  const selCount = Object.keys(selected).length;
  const toggleSel = (key, url, title) => setSelected((m) => {
    const n = { ...m };
    if (n[key]) delete n[key]; else n[key] = { url, title };
    return n;
  });
  const selectAllVisible = () => {
    const list = tab === "audio"
      ? tracks.slice(0, 60).filter((t) => t.audio_url).map((t) => [`audio:${t.id}`, t.audio_url, `${t.artist || ""} - ${t.title || t.id}`])
      : videos.filter((v) => v.url).map((v) => [`video:${v.id}`, v.url, v.display_name || v.filename || v.id]);
    setSelected((m) => {
      const n = { ...m };
      const allOn = list.length > 0 && list.every(([k]) => n[k]);
      list.forEach(([k, url, title]) => { if (allOn) delete n[k]; else n[k] = { url, title }; });
      return n;
    });
  };
  const downloadSelected = async () => {
    const items = Object.values(selected);
    if (!items.length) return toast.error("Seleziona almeno un file");
    setZipBusy(true); setZipLink(null);
    try {
      const r = await api.post("/admin/assets/zip", { items });
      const d = r.data || {};
      const href = `${process.env.REACT_APP_BACKEND_URL}${d.download_url}`;
      setZipLink({ href, count: d.count, mb: (d.bytes / 1024 / 1024).toFixed(1), skipped: (d.skipped || []).length });
      toast.success(`ZIP pronto · ${d.count} file · ${(d.bytes / 1024 / 1024).toFixed(1)} MB`);
    } catch (e) { toast.error(e?.response?.data?.detail || "Errore creazione ZIP"); }
    finally { setZipBusy(false); }
  };
  const [uploadForm, setUploadForm] = useState({
    name: "", sponsor_note: "", start_date: "", end_date: "", is_stinger: false,
  });

  const load = async () => {
    try {
      const t = await api.get("/tracks?limit=200");
      setTracks((Array.isArray(t.data) ? t.data : (t.data?.tracks || [])).filter((x) => !x.deleted_at));
    } catch {}
    try {
      const v = await api.get("/admin/ledwall/videos");
      setVideos(v.data.videos || []);
    } catch {}
    try {
      const tr = await api.get("/admin/tracks/trash");
      setTrash(tr.data.trash || []);
    } catch {}
    try {
      const vq = await api.get("/admin/voice-queue");
      setVoice(vq.data.queue || vq.data.voices || []);
    } catch {}
  };
  useEffect(() => { load(); const iv = setInterval(load, 15000); return () => clearInterval(iv); }, []);

  const uploadVideo = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("name", uploadForm.name || file.name);
      if (uploadForm.sponsor_note) fd.append("sponsor_note", uploadForm.sponsor_note);
      if (uploadForm.start_date)   fd.append("start_date",   uploadForm.start_date);
      if (uploadForm.end_date)     fd.append("end_date",     uploadForm.end_date);
      if (uploadForm.is_stinger)   fd.append("is_stinger",   "true");
      // v13.9 · endpoint UNIFICATO che accetta sia mp3 che mp4
      const r = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/admin/media/upload`, {
        method: "POST", body: fd, credentials: "include",
      });
      if (!r.ok) throw new Error(await r.text());
      const d = await r.json();
      toast.success(`${d.type === "audio" ? "Audio" : "Video"} caricato su Object Storage${d.type === "video" && d.video?.duration_sec ? ` (${Math.round(d.video.duration_sec)}s)` : ""}`);
      setUploadForm({ name: "", sponsor_note: "", start_date: "", end_date: "", is_stinger: false });
      load();
    } catch (e) { toast.error("Upload fallito: " + String(e.message || e).slice(0,120)); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const restoreTrack = async (id) => {
    try { await api.post(`/admin/tracks/${id}/restore`); toast.success("Ripristinato"); load(); }
    catch { toast.error("Errore"); }
  };
  const purgeTrack = async (id) => {
    if (!window.confirm("Eliminare DEFINITIVAMENTE questa traccia?")) return;
    try { await api.delete(`/admin/tracks/${id}/purge-trash`); toast.success("Eliminato definitivamente"); load(); }
    catch { toast.error("Errore"); }
  };
  const deleteVideo = async (id) => {
    if (!window.confirm("Eliminare fisicamente il video dallo storage? Questa azione libera spazio e non è reversibile.")) return;
    try { await api.delete(`/admin/ledwall/videos/${id}`); toast.success("Video eliminato dallo storage"); load(); }
    catch { toast.error("Errore eliminazione video"); }
  };

  const tabs = [
    { k: "audio", label: `🎵 MP3 (${tracks.length})`, color: "#00E5FF" },
    { k: "video", label: `📤 Upload MP3/MP4 (${videos.length})`, color: "#FFB84D" },
    { k: "trash", label: `🗑️ Cestino (${trash.length})`, color: "#FF6BAA" },
    { k: "voice", label: `🎙️ Vocali (${voice.length})`, color: "#D080FF" },
  ];

  return (
    <section
      className="lg:col-span-4 rounded-xl p-5"
      data-testid="magazzino-universale"
      style={{
        background: "linear-gradient(180deg, rgba(0,229,255,0.04), rgba(10,0,25,0.9))",
        border: "1px solid rgba(0,229,255,0.28)",
        backdropFilter: "blur(10px)",
      }}
    >
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <div className="label-mono" style={{ color: "#00E5FF" }}>📚 MAGAZZINO UNIVERSALE</div>
          <div className="font-display font-black text-xl text-white mt-0.5">Tutte le risorse della radio</div>
        </div>
        <div className="flex gap-1 flex-wrap">
          {tabs.map((t) => (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              data-testid={`magazzino-tab-${t.k}`}
              className="px-3 py-1.5 rounded text-xs font-mono font-bold transition-all"
              style={{
                background: tab === t.k ? `${t.color}22` : "rgba(255,255,255,0.03)",
                border: `1px solid ${tab === t.k ? t.color : "rgba(255,255,255,0.1)"}`,
                color: tab === t.k ? t.color : "#a1a1aa",
                boxShadow: tab === t.k ? `0 0 8px ${t.color}55` : "none",
              }}
            >{t.label}</button>
          ))}
        </div>
      </div>

      {(tab === "audio" || tab === "video") && (
        <div className="flex items-center gap-2 flex-wrap mb-2 p-2 rounded" data-testid="bulk-asset-toolbar"
          style={{ background: "rgba(128,255,180,0.05)", border: "1px dashed rgba(128,255,180,0.35)" }}>
          <button type="button" onClick={selectAllVisible} data-testid="bulk-select-all"
            className="px-2 py-1 rounded text-[11px] font-mono font-bold"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", color: "#ddd" }}>
            ☑ Seleziona tutti ({tab === "audio" ? "MP3" : "Video"})
          </button>
          <button type="button" onClick={downloadSelected} disabled={zipBusy || selCount === 0} data-testid="bulk-download-btn"
            className="px-3 py-1 rounded text-[11px] font-mono font-bold text-black"
            style={{ background: selCount ? "#80FFB4" : "rgba(128,255,180,0.25)", opacity: zipBusy ? 0.6 : 1 }}>
            {zipBusy ? "⏳ Impacchetto…" : `⬇ SCARICA SELEZIONATI (${selCount})`}
          </button>
          {selCount > 0 && (
            <button type="button" onClick={() => { setSelected({}); setZipLink(null); }} data-testid="bulk-clear"
              className="px-2 py-1 rounded text-[11px] font-mono" style={{ color: "#FF6BAA", border: "1px solid rgba(255,45,149,0.4)" }}>✕ svuota</button>
          )}
          {zipLink && (
            <a href={zipLink.href} data-testid="bulk-zip-link" onClick={() => setTimeout(() => setZipLink(null), 4000)}
              className="text-[11px] font-mono font-bold underline" style={{ color: "#00E5FF" }}>
              📦 Scarica ZIP · {zipLink.count} file · {zipLink.mb} MB{zipLink.skipped ? ` · ${zipLink.skipped} saltati` : ""} (link one-shot: il file viene cancellato dal server dopo il download)
            </a>
          )}
        </div>
      )}

      {tab === "audio" && (
        <div className="max-h-[420px] overflow-y-auto space-y-1" data-testid="magazzino-list-audio">
          {tracks.slice(0, 60).map((t) => (
            <div key={t.id} className="flex items-center gap-2 p-2 rounded bg-white/5 border border-white/8 text-sm"
              style={selected[`audio:${t.id}`] ? { borderColor: "rgba(128,255,180,0.6)", background: "rgba(128,255,180,0.06)" } : undefined}>
              <input type="checkbox" className="accent-emerald-400 shrink-0" data-testid={`bulk-check-audio-${t.id}`}
                checked={!!selected[`audio:${t.id}`]} disabled={!t.audio_url}
                onChange={() => toggleSel(`audio:${t.id}`, t.audio_url, `${t.artist || ""} - ${t.title || t.id}`)} />
              <Music className="w-3 h-3 text-cyan-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-white truncate">{t.artist || "?"} — {t.title || "Senza titolo"}</div>
                <div className="text-[10px] text-zinc-500 font-mono">
                  {t.source} · {t.duration_sec ? Math.floor(t.duration_sec) + "s" : "?"}
                  {t.bpm && <> · {t.bpm} BPM</>}
                </div>
              </div>
            </div>
          ))}
          {tracks.length === 0 && <div className="text-zinc-500 text-sm py-8 text-center">Nessuna traccia</div>}
        </div>
      )}

      {tab === "video" && (
        <div>
          <div className="mb-3 p-2 rounded bg-orange-500/10 border border-orange-500/30 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text" value={uploadForm.name}
                onChange={(e) => setUploadForm({...uploadForm, name: e.target.value})}
                placeholder="Nome display (opzionale)"
                className="bg-black border border-white/10 rounded px-2 py-1 text-xs text-white"
                data-testid="upload-name"
                title="Nome mostrato in libreria"
              />
              <input
                type="text" value={uploadForm.sponsor_note}
                onChange={(e) => setUploadForm({...uploadForm, sponsor_note: e.target.value})}
                placeholder="📝 Note sponsor (es. Cliente X, campagna estiva)"
                className="bg-black border border-white/10 rounded px-2 py-1 text-xs text-white"
                data-testid="upload-sponsor-note"
                title="Metadata libera per sponsor/campagna"
              />
              <input
                type="datetime-local" value={uploadForm.start_date}
                onChange={(e) => setUploadForm({...uploadForm, start_date: e.target.value})}
                className="bg-black border border-white/10 rounded px-2 py-1 text-xs text-white"
                data-testid="upload-start-date"
                title="Data/ora di inizio validità (opz.)"
              />
              <input
                type="datetime-local" value={uploadForm.end_date}
                onChange={(e) => setUploadForm({...uploadForm, end_date: e.target.value})}
                className="bg-black border border-white/10 rounded px-2 py-1 text-xs text-white"
                data-testid="upload-end-date"
                title="Data/ora di fine validità (opz.)"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-orange-300 font-mono cursor-pointer" title="Se ON, il video entra nella rotazione HLS sincrona (stinger)">
              <input type="checkbox" checked={uploadForm.is_stinger}
                     onChange={(e) => setUploadForm({...uploadForm, is_stinger: e.target.checked})}
                     data-testid="upload-is-stinger" />
              🎬 Aggiungi alla rotazione video sincrona (stinger clip)
            </label>
            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="audio/*,video/*"
                onChange={(e) => uploadVideo(e.target.files?.[0])}
                className="flex-1 text-xs text-white file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-orange-500 file:text-black file:font-bold"
                data-testid="magazzino-video-upload"
                title="Upload UNIFICATO: MP3, WAV, M4A, OGG, FLAC · MP4, WEBM, MOV, M4V"
                disabled={busy}
              />
              <Upload className="w-4 h-4 text-orange-400 shrink-0" />
            </div>
            <div className="text-[9px] font-mono text-orange-300/60">
              Endpoint unificato /api/admin/media/upload · sniffa mime, route su Track (audio) o ledwall_videos (video)
            </div>
          </div>
          <div className="max-h-[320px] overflow-y-auto space-y-1" data-testid="magazzino-list-video">
            {videos.map((v) => (
              <div key={v.id} className="flex items-center gap-2 p-2 rounded bg-white/5 border border-white/8 text-sm"
                style={selected[`video:${v.id}`] ? { borderColor: "rgba(128,255,180,0.6)", background: "rgba(128,255,180,0.06)" } : undefined}>
                <input type="checkbox" className="accent-emerald-400 shrink-0" data-testid={`bulk-check-video-${v.id}`}
                  checked={!!selected[`video:${v.id}`]} disabled={!v.url}
                  onChange={() => toggleSel(`video:${v.id}`, v.url, v.display_name || v.filename || v.id)} />
                <Film className="w-3 h-3 text-orange-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-white truncate">{v.display_name || v.filename}</div>
                  <div className="text-[10px] text-zinc-500 font-mono">
                    {v.duration_sec ? Math.round(v.duration_sec) + "s · " : ""}
                    {v.width && v.height ? `${v.width}×${v.height} · ` : ""}
                    {Math.round((v.size || 0) / 1024)}KB
                    {v.is_stinger && <span className="text-orange-400"> · stinger</span>}
                    {v.sponsor_note && <span className="text-cyan-300"> · 📝 {v.sponsor_note}</span>}
                  </div>
                </div>
                <a href={v.url} target="_blank" rel="noreferrer"
                   className="text-cyan-300 text-[10px] font-mono hover:underline">apri ↗</a>
                <button
                  onClick={() => deleteVideo(v.id)}
                  data-testid={`magazzino-video-del-${v.id}`}
                  className="p-1 rounded hover:bg-red-500/20"
                  title="Elimina video"
                ><Trash2 className="w-3.5 h-3.5 text-red-400" /></button>
              </div>
            ))}
            {videos.length === 0 && <div className="text-zinc-500 text-sm py-8 text-center">Nessun video · usa il form sopra</div>}
          </div>
        </div>
      )}

      {tab === "trash" && (
        <div className="max-h-[420px] overflow-y-auto space-y-1" data-testid="magazzino-list-trash">
          {trash.map((t) => (
            <div key={t.id} className="flex items-center gap-2 p-2 rounded bg-pink-500/5 border border-pink-500/20 text-sm">
              <Trash2 className="w-3 h-3 text-pink-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-white truncate">{t.artist || "?"} — {t.title || "?"}</div>
                <div className="text-[10px] text-zinc-500 font-mono">Nel cestino dal {(t.deleted_at || "").slice(0, 16)}</div>
              </div>
              <button
                onClick={() => restoreTrack(t.id)}
                data-testid={`magazzino-restore-${t.id}`}
                className="p-1.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40"
                title="Ripristina traccia"
              ><RotateCcw className="w-3.5 h-3.5 text-cyan-300" /></button>
              <button
                onClick={() => purgeTrack(t.id)}
                data-testid={`magazzino-purge-${t.id}`}
                className="p-1.5 rounded bg-red-500/20 hover:bg-red-500/40 border border-red-500/40"
                title="Elimina DEFINITIVAMENTE"
              ><Trash2 className="w-3.5 h-3.5 text-red-400" /></button>
            </div>
          ))}
          {trash.length === 0 && <div className="text-zinc-500 text-sm py-8 text-center">Cestino vuoto</div>}
        </div>
      )}

      {tab === "voice" && (
        <div className="max-h-[420px] overflow-y-auto space-y-1" data-testid="magazzino-list-voice">
          {voice.map((v) => (
            <div key={v.id} className="flex items-center gap-2 p-2 rounded bg-purple-500/5 border border-purple-500/20 text-sm">
              <div className="flex-1 min-w-0">
                <div className="text-white truncate">{v.author || "Ascoltatore"}</div>
                <div className="text-[10px] text-zinc-400 truncate">{v.text || "(vocale)"}</div>
              </div>
              {v.audio_url && <audio controls src={v.audio_url} className="h-6" style={{maxWidth: 200}} />}
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded"
                    style={{
                      background: v.status === "approved" ? "rgba(0,229,255,0.2)" : "rgba(255,184,77,0.2)",
                      color: v.status === "approved" ? "#00E5FF" : "#FFB84D",
                    }}>
                {v.status || "pending"}
              </span>
            </div>
          ))}
          {voice.length === 0 && <div className="text-zinc-500 text-sm py-8 text-center">Nessun vocale in coda</div>}
        </div>
      )}
    </section>
  );
}
