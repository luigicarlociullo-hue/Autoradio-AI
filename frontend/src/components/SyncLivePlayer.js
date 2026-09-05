import React, { useEffect, useRef, useState } from "react";
import { Radio, Loader2, Zap, ZapOff } from "lucide-react";
import Hls from "hls.js";
import { toast } from "sonner";

/**
 * SyncLivePlayer — v13.6 TRUE BROADCASTER
 * Player universale che aggancia /api/stream/live.m3u8. Tutti i client
 * caricano lo stesso .m3u8, il server ha già impresso
 * `#EXT-X-START:TIME-OFFSET=<offset>` con l'istante corrente del clock →
 * qualsiasi client, in qualsiasi momento, si posiziona allo stesso frame.
 *
 * Se il browser supporta HLS nativamente (Safari, iOS), usa direttamente
 * l'element <audio>. Altrimenti (Chrome, Firefox, Android) usa hls.js.
 */
export default function SyncLivePlayer() {
  const [status, setStatus] = useState("idle"); // idle | loading | playing | error
  const [nowInfo, setNowInfo] = useState(null);
  const audioRef = useRef(null);
  const hlsRef = useRef(null);
  const nowPollRef = useRef(null);

  // Poll /api/stream/now ogni 5s per il display "cosa sta suonando"
  useEffect(() => {
    const fetchNow = async () => {
      try {
        const r = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/stream/now`);
        const d = await r.json();
        setNowInfo(d.current || null);
      } catch {}
    };
    fetchNow();
    nowPollRef.current = setInterval(fetchNow, 5000);
    return () => clearInterval(nowPollRef.current);
  }, []);

  const startSync = async () => {
    if (status === "playing") return;
    setStatus("loading");
    const hlsUrl = `${process.env.REACT_APP_BACKEND_URL}/api/stream/live.m3u8`;
    const audio = audioRef.current;
    try {
      // Cleanup precedente
      if (hlsRef.current) { try { hlsRef.current.destroy(); } catch {} hlsRef.current = null; }
      // Native HLS (Safari, iOS)
      if (audio.canPlayType("application/vnd.apple.mpegurl")) {
        audio.src = hlsUrl;
        audio.load();
        await audio.play();
        setStatus("playing");
        toast.success("Sync Live ON — Safari native");
        return;
      }
      // hls.js
      if (Hls.isSupported()) {
        const hls = new Hls({
          liveSyncDurationCount: 3,
          maxLiveSyncPlaybackRate: 1.1,
          enableWorker: true,
        });
        hlsRef.current = hls;
        hls.loadSource(hlsUrl);
        hls.attachMedia(audio);
        await new Promise((resolve, reject) => {
          hls.on(Hls.Events.MANIFEST_PARSED, resolve);
          hls.on(Hls.Events.ERROR, (_e, data) => {
            if (data.fatal) reject(new Error(data.details || "HLS fatal"));
          });
        });
        await audio.play();
        setStatus("playing");
        toast.success("Sync Live ON — hls.js");
        return;
      }
      throw new Error("HLS non supportato da questo browser");
    } catch (e) {
      setStatus("error");
      toast.error("Errore avvio Sync: " + (e?.message || e));
    }
  };

  const stopSync = () => {
    try { audioRef.current?.pause(); } catch {}
    if (hlsRef.current) { try { hlsRef.current.destroy(); } catch {} hlsRef.current = null; }
    setStatus("idle");
    toast.info("Sync Live OFF");
  };

  const active = status === "playing" || status === "loading";

  return (
    <div
      className="rounded-lg p-2.5 border flex items-center gap-3"
      data-testid="sync-live-player"
      style={{
        background: active
          ? "linear-gradient(90deg, rgba(255,20,147,0.15), rgba(0,229,255,0.1))"
          : "rgba(0,10,25,0.6)",
        borderColor: active ? "rgba(255,20,147,0.5)" : "rgba(0,229,255,0.3)",
        boxShadow: active ? "0 0 14px rgba(255,20,147,0.35)" : "none",
      }}
    >
      <audio ref={audioRef} preload="none" className="hidden" data-testid="sync-live-audio" />
      <button
        onClick={active ? stopSync : startSync}
        disabled={status === "loading"}
        data-testid="sync-live-toggle"
        className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
        style={{
          background: active
            ? "linear-gradient(135deg, #FF1493, #00E5FF)"
            : "linear-gradient(135deg, #00E5FF, #0080FF)",
          boxShadow: active ? "0 0 14px rgba(255,20,147,0.6)" : "0 0 10px rgba(0,229,255,0.4)",
          color: "#000",
        }}
      >
        {status === "loading" ? <Loader2 className="w-4 h-4 animate-spin" /> :
         active ? <ZapOff className="w-4 h-4" /> : <Zap className="w-4 h-4" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-mono uppercase tracking-widest text-cyan-300/70 flex items-center gap-1">
          <Radio className="w-3 h-3" />
          {active ? "SYNC LIVE · IN DIRETTA" : "SYNC LIVE · HLS UNIVERSALE"}
        </div>
        <div className="text-[13px] text-white font-bold truncate leading-tight">
          {nowInfo?.title ? `${nowInfo.artist || ""} — ${nowInfo.title}` : "In attesa del clock…"}
        </div>
        {nowInfo?.duration_sec ? (
          <div className="text-[10px] font-mono text-zinc-400 leading-none mt-0.5">
            {Math.floor((nowInfo.offset_sec || 0))}s / {Math.floor(nowInfo.duration_sec)}s ·
            <span className="text-cyan-300"> tutti sincronizzati sullo stesso frame</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
