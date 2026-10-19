import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";

/* v13.75 · Copertina / Video del brano per il LedWall.
   Due campi (cover_url immagine · video_url MP4), ciascuno con: anteprima attuale + Rimuovi,
   "Carica nuovo" (riusa /admin/ledwall/upload-video: H.264 + Object Storage) oppure
   "Scegli tra i caricati" (vetrina a scorrimento orizzontale dalla libreria LedWall). */

const isImageUrl = (u) => /\.(jpe?g|png|gif|webp)(\?|$)/i.test(String(u || ""));
const isImageItem = (v) => (v?.mime || "").startsWith("image/") || isImageUrl(v?.url);
const MAX_IMG = 10 * 1024 * 1024;
const MAX_VID = 200 * 1024 * 1024;

export async function uploadLedwallMedia(file) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("name", file.name);
  const r = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/admin/ledwall/upload-video`, { method: "POST", body: fd, credentials: "include" });
  if (!r.ok) throw new Error((await r.text()).slice(0, 160));
  return (await r.json()).video;
}

function Thumb({ url, image, className = "" }) {
  if (!url) return null;
  return image
    ? <img src={url} alt="" className={`object-cover bg-black ${className}`} loading="lazy" />
    : <video src={url} muted playsInline preload="metadata" className={`object-cover bg-black ${className}`} />;
}

function MediaField({ label, hint, value, onChange, image, library, testid }) {
  const [uploading, setUploading] = useState(false);
  const [showLib, setShowLib] = useState(false);
  const fileRef = useRef(null);
  const items = library.filter((v) => isImageItem(v) === image);

  const upload = async (file) => {
    if (!file) return;
    const okExt = image ? /\.(jpe?g|png|webp)$/i.test(file.name) : /\.mp4$/i.test(file.name);
    if (!okExt) return toast.error(image ? "Immagine: solo JPG, PNG o WebP" : "Video: solo MP4");
    if (file.size > (image ? MAX_IMG : MAX_VID)) return toast.error(image ? "Immagine troppo grande (max 10 MB)" : "Video troppo grande (max 200 MB)");
    setUploading(true);
    try {
      const v = await uploadLedwallMedia(file);
      onChange(v.url, v);
      toast.success(`${image ? "Copertina" : "Video"} caricato`);
    } catch (e) { toast.error("Upload fallito: " + String(e.message || e)); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  return (
    <div className="rounded-lg p-3 border border-white/10 bg-black/40" data-testid={`${testid}-field`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div>
          <div className="text-xs text-zinc-300 font-bold">{label}</div>
          <div className="text-[10px] font-mono text-zinc-500">{hint}</div>
        </div>
        {value && (
          <button type="button" onClick={() => onChange(null)} data-testid={`${testid}-remove`}
            className="text-[10px] text-red-300 border border-red-400/40 rounded px-2 py-1 hover:bg-red-500/10">✕ Rimuovi</button>
        )}
      </div>
      <div className="flex gap-3 items-start">
        <div className="w-28 h-16 rounded overflow-hidden border border-white/10 bg-black shrink-0 flex items-center justify-center" data-testid={`${testid}-preview`}>
          {value ? <Thumb url={value} image={image} className="w-full h-full" /> : <span className="text-[10px] font-mono text-zinc-600">nessuno</span>}
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-1.5">
            <label className="text-[11px] font-mono px-2 py-1 rounded cursor-pointer" data-testid={`${testid}-upload-label`}
              style={{ background: "rgba(0,229,255,0.15)", border: "1px solid rgba(0,229,255,0.4)", color: "#CFF8FF", opacity: uploading ? 0.5 : 1 }}>
              {uploading ? "Carico…" : "⬆ Carica nuovo"}
              <input ref={fileRef} type="file" className="hidden" disabled={uploading} data-testid={`${testid}-upload-input`}
                accept={image ? ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" : ".mp4,video/mp4"}
                onChange={(e) => upload(e.target.files?.[0])} />
            </label>
            <button type="button" onClick={() => setShowLib((s) => !s)} data-testid={`${testid}-library-toggle`}
              className="text-[11px] font-mono px-2 py-1 rounded" style={{ border: "1px solid rgba(255,255,255,0.2)", color: "#ddd" }}>
              {showLib ? "▴ Chiudi" : `▾ Scegli tra i caricati (${items.length})`}
            </button>
          </div>
          {value && <div className="text-[10px] font-mono text-zinc-500 truncate" title={value}>{String(value).split("/").pop()}</div>}
        </div>
      </div>
      {showLib && (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1" data-testid={`${testid}-library`} style={{ scrollbarWidth: "thin" }}>
          {items.length === 0 && <div className="text-[11px] text-zinc-500 py-2">Nessun {image ? "immagine" : "video"} nella libreria LedWall</div>}
          {items.map((v) => {
            const sel = v.url === value;
            return (
              <button key={v.id} type="button" onClick={() => onChange(v.url, v)} data-testid={`${testid}-lib-${v.id}`} title={v.display_name || v.filename}
                className="shrink-0 w-28 rounded overflow-hidden text-left"
                style={{ border: `2px solid ${sel ? "#00E5FF" : "rgba(255,255,255,0.1)"}`, boxShadow: sel ? "0 0 10px rgba(0,229,255,0.5)" : "none" }}>
                <Thumb url={v.url} image={image} className="w-28 h-16" />
                <div className="text-[9px] font-mono text-zinc-300 truncate px-1 py-0.5 bg-black/70">{v.display_name || v.filename}</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function CoverVideoPicker({ coverUrl, videoUrl, onCoverChange, onVideoChange, testid = "cv" }) {
  const [library, setLibrary] = useState([]);
  const load = async () => {
    try {
      const r = await api.get("/admin/ledwall/videos");
      setLibrary((r.data.videos || []).slice().sort((a, b) => String(b.uploaded_at || "").localeCompare(String(a.uploaded_at || ""))));
    } catch {}
  };
  useEffect(() => { load(); }, []);
  const wrap = (fn) => (url, item) => { fn(url); if (item) load(); };
  return (
    <div className="space-y-2" data-testid={`${testid}-section`}>
      <div className="text-xs text-zinc-400">Copertina e video <span className="text-zinc-600">· mostrati sul LedWall mentre il brano è in onda (video in loop muto; se c'è solo la copertina, la copertina)</span></div>
      <MediaField label="🖼 Copertina" hint="JPG · PNG · WebP · max 10 MB" image value={coverUrl} onChange={wrap(onCoverChange)} library={library} testid={`${testid}-cover`} />
      <MediaField label="🎬 Video" hint="MP4 · max 200 MB · convertito in H.264" image={false} value={videoUrl} onChange={wrap(onVideoChange)} library={library} testid={`${testid}-video`} />
    </div>
  );
}
