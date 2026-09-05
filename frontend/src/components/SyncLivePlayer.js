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
      className="rounded-xl p-4 border relative overflow-hidden"
      data-testid="sync-live-player"
      style={{
        background: active
          ? "linear-gradient(135deg, rgba(255,20,147,0.18), rgba(0,229,255,0.12))"
          : "linear-gradient(135deg, rgba(0,229,255,0.10), rgba(0,10,25,0.7))",
        borderColor: active ? "rgba(255,20,147,0.6)" : "rgba(0,229,255,0.45)",
        boxShadow: active
          ? "0 0 26px rgba(255,20,147,0.45), inset 0 0 24px rgba(0,229,255,0.15)"
          : "0 0 18px rgba(0,229,255,0.25), inset 0 0 18px rgba(0,229,255,0.08)",
      }}
    >
      <audio ref={audioRef} preload="none" className="hidden" data-testid="sync-live-audio" />
      <div className="flex items-center gap-2 mb-2">
        <Radio className="w-3.5 h-3.5" style={{ color: "#00E5FF" }} />
        <span className="text-[10px] font-mono uppercase tracking-widest text-cyan-300">
          {active ? "IN DIRETTA · SINCRONIZZATO" : "BROADCASTER · HLS UNIVERSALE"}
        </span>
      </div>

      <button
        onClick={active ? stopSync : startSync}
        disabled={status === "loading"}
        data-testid="sync-live-toggle"
        className="w-full rounded-lg py-3 px-4 flex items-center justify-center gap-3 transition-all hover:scale-[1.02] active:scale-[0.98]"
        style={{
          background: active
            ? "linear-gradient(90deg, #FF1493 0%, #FF3EA5 50%, #00E5FF 100%)"
            : "linear-gradient(90deg, #00E5FF 0%, #00A9FF 50%, #FF1493 100%)",
          color: "#000",
          fontWeight: 900,
          letterSpacing: "0.08em",
          boxShadow: active
            ? "0 0 22px rgba(255,20,147,0.7), inset 0 -2px 0 rgba(0,0,0,0.15)"
            : "0 0 18px rgba(0,229,255,0.55), inset 0 -2px 0 rgba(0,0,0,0.15)",
          opacity: status === "loading" ? 0.7 : 1,
        }}
      >
        {status === "loading" ? (
          <>
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="text-lg">SINCRONIZZO...</span>
          </>
        ) : active ? (
          <>
            <ZapOff className="w-6 h-6" />
            <span className="text-lg sm:text-xl">⏹ ESCI DALLA DIRETTA</span>
          </>
        ) : (
          <>
            <Zap className="w-6 h-6" />
            <span className="text-lg sm:text-xl">⚡ ENTRA IN DIRETTA</span>
          </>
        )}
      </button>

      <div className="mt-3 min-h-[36px]">
        <div className="text-[13px] text-white font-bold truncate leading-tight" data-testid="sync-live-title">
          {nowInfo?.title ? `${nowInfo.artist || "R-A.I."} — ${nowInfo.title}` : "Aggancio al clock del server…"}
        </div>
        {nowInfo?.duration_sec ? (
          <div className="text-[10px] font-mono text-cyan-300/80 leading-none mt-1">
            {Math.floor((nowInfo.offset_sec || 0))}s / {Math.floor(nowInfo.duration_sec)}s ·
            <span className="text-zinc-400"> tutti gli ascoltatori sullo stesso frame</span>
          </div>
        ) : (
          <div className="text-[10px] font-mono text-zinc-500 leading-none mt-1">
            HLS pronto — premi il tasto per agganciarti
          </div>
        )}
      </div>
    </div>
  );
}
