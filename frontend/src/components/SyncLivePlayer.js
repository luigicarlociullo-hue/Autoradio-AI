import React, { useEffect, useRef, useState } from "react";
import { Radio, Loader2, Zap, ZapOff } from "lucide-react";
import Hls from "hls.js";
import { toast } from "sonner";
import radioEngine from "../lib/radioEngine";

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
  const [nextQueue, setNextQueue] = useState([]);
  const [ducking, setDucking] = useState(false);
  const audioRef = useRef(null);
  const hlsRef = useRef(null);
  const nowPollRef = useRef(null);
  const prevVolRef = useRef(null);
  // v13.18 · MediaElementSource creato UNA SOLA VOLTA per l'element audio:
  // il browser lancia InvalidStateError se lo si crea due volte.
  const wiredRef = useRef(false);

  /**
   * v13.18 · Silence Padding & Audio Wiring
   *
   * (1) Aggancia il tag <audio> al grafo Web Audio del radioEngine (musicBus)
   *     così l'analyser vede l'ampiezza reale dello stream HLS e i visual
   *     effects (stelle cadenti, ologrammi, onde) si accendono senza fake.
   * (2) All'inizio del play alza il volume da 0 a 1 in ~500ms invece che
   *     "d'un colpo": evita di tagliare la prima sillaba di un talk DJ
   *     quando il buffer HLS non è ancora pieno.
   */
  const wireToRadioEngine = () => {
    const audio = audioRef.current;
    if (!audio || wiredRef.current) return;
    try {
      const ctx = radioEngine.ensureAudioCtx?.();
      if (!ctx) return;
      // createMediaElementSource è one-shot per elemento: guardia contro doppie chiamate
      const src = ctx.createMediaElementSource(audio);
      if (radioEngine.musicBus) {
        src.connect(radioEngine.musicBus);
      } else {
        src.connect(ctx.destination);
      }
      wiredRef.current = true;
      console.log("[SyncLive] audio wired to radioEngine.musicBus — analyser live");
    } catch (e) {
      // Alcuni browser lanciano se già collegato: OK, ignora.
      console.warn("[SyncLive] wireToRadioEngine skipped:", e?.message || e);
      wiredRef.current = true;
    }
  };

  // Fade-in dolce ma rapido (150ms): elimina il click di partenza SENZA
  // introdurre gap percepibile tra evento e brano successivo. v13.23 ·
  // riduzione da 500ms a 150ms per il target "zero silenzio".
  const fadeInPlayback = (targetVol = 1.0, ms = 150) => {
    const a = audioRef.current;
    if (!a) return;
    try {
      const steps = 20;
      const stepMs = Math.max(10, Math.floor(ms / steps));
      const start = 0.0;
      a.volume = start;
      let i = 0;
      const iv = setInterval(() => {
        i += 1;
        const t = i / steps;
        a.volume = Math.min(targetVol, start + (targetVol - start) * t);
        if (i >= steps) clearInterval(iv);
      }, stepMs);
    } catch {}
  };

  // v13.11 · Ducking automatico per voce-in-chat.
  // MicButton dispatcha `rai:voice-rec-start` / `rai:voice-rec-end`.
  // Portiamo l'audio del Sync Live al 5% durante la registrazione, poi
  // ripristiniamo il volume originale.
  useEffect(() => {
    const onStart = () => {
      const a = audioRef.current;
      if (!a) return;
      prevVolRef.current = a.volume;
      a.volume = Math.max(0.03, a.volume * 0.05);
      setDucking(true);
    };
    const onEnd = () => {
      const a = audioRef.current;
      if (a && prevVolRef.current != null) {
        a.volume = prevVolRef.current;
        prevVolRef.current = null;
      }
      setDucking(false);
    };
    window.addEventListener("rai:voice-rec-start", onStart);
    window.addEventListener("rai:voice-rec-end", onEnd);
    return () => {
      window.removeEventListener("rai:voice-rec-start", onStart);
      window.removeEventListener("rai:voice-rec-end", onEnd);
    };
  }, []);

  // v13.31 · Voice-Over ducking (Jingle intro voice-over)
  // Ascolta l'evento `rai:voice-over:play` (dispatch da Regia o auto-scheduler)
  // Crea un <audio> parallelo per il jingle voice-over, applica ducking -12dB
  // sul main stream, ripristina volume alla fine. Zero re-encoding server-side.
  const voRef = useRef(null);
  useEffect(() => {
    const trigger = async (ev) => {
      const explicitUrl = ev?.detail?.audio_url;
      let vo = null;
      try {
        if (explicitUrl) {
          vo = { audio_url: explicitUrl, duration_sec: ev?.detail?.duration_sec };
        } else {
          const r = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/jingles/voice-over/random`);
          const d = await r.json();
          vo = d.jingle;
        }
        if (!vo || !vo.audio_url) {
          toast.error("Nessun voice-over jingle disponibile");
          return;
        }
        const main = audioRef.current;
        if (!main) return;
        // Ducking main a 25%
        const savedVol = main.volume;
        const targetDucked = Math.max(0.15, savedVol * 0.28);
        // Ramp down
        const rampSteps = 12;
        for (let i = 0; i < rampSteps; i++) {
          main.volume = savedVol + (targetDucked - savedVol) * (i / rampSteps);
          await new Promise(r => setTimeout(r, 25));
        }
        main.volume = targetDucked;
        // Play voice-over
        if (voRef.current) { try { voRef.current.pause(); voRef.current.src = ""; } catch {} }
        const voAudio = new Audio(vo.audio_url.startsWith("http") ? vo.audio_url : `${process.env.REACT_APP_BACKEND_URL}${vo.audio_url}`);
        voAudio.volume = 1.0;
        voRef.current = voAudio;
        window.dispatchEvent(new CustomEvent("rai:voice-over:start", { detail: { jingle: vo } }));
        try { await voAudio.play(); } catch (e) {
          // fallback: se autoplay bloccato, ripristina volume
          main.volume = savedVol;
          toast.error("Autoplay bloccato dal browser");
          return;
        }
        const restore = async () => {
          for (let i = 0; i < rampSteps; i++) {
            main.volume = targetDucked + (savedVol - targetDucked) * (i / rampSteps);
            await new Promise(r => setTimeout(r, 25));
          }
          main.volume = savedVol;
          voRef.current = null;
          window.dispatchEvent(new CustomEvent("rai:voice-over:end", { detail: {} }));
        };
        voAudio.addEventListener("ended", restore, { once: true });
        voAudio.addEventListener("error", restore, { once: true });
      } catch (e) {
        console.warn("[voice-over] trigger error", e);
      }
    };
    window.addEventListener("rai:voice-over:play", trigger);
    return () => window.removeEventListener("rai:voice-over:play", trigger);
  }, []);

  // Poll /api/stream/now ogni 5s per il display "cosa sta suonando" + coda
  useEffect(() => {
    const fetchNow = async () => {
      try {
        const r = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/stream/now`);
        const d = await r.json();
        setNowInfo(d.current || null);
        setNextQueue(d.next || []);
      } catch {}
    };
    fetchNow();
    nowPollRef.current = setInterval(fetchNow, 5000);
    return () => clearInterval(nowPollRef.current);
  }, []);

  // Ticket #247410: lo Skip admin avanza il clock lato server (station_clock)
  // ma, se gia' in ascolto, hls.js continua a suonare dal buffer gia'
  // scaricato del brano VECCHIO fino a esaurirlo — lo Skip non si sentiva
  // mai finche' quel buffer non finiva da solo. Un resync forzato (nuova
  // manifest fetch, EXT-X-START = posizione live AGGIORNATA) rende lo Skip
  // immediato per chi e' gia' connesso in Sync Live.
  useEffect(() => {
    const onSkip = () => { startSync(true).catch(() => {}); };
    window.addEventListener("rai:sync:skip", onSkip);
    return () => window.removeEventListener("rai:sync:skip", onSkip);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Ticket #247410: il Pause admin, come lo Skip, agiva solo sul vecchio
  // radioEngine — chi ascoltava in Sync Live non si fermava mai davvero.
  useEffect(() => {
    const onPause = () => { stopSync(); };
    window.addEventListener("rai:sync:pause", onPause);
    return () => window.removeEventListener("rai:sync:pause", onPause);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startSync = async (force = false) => {
    if (status === "playing" && !force) return;
    setStatus("loading");
    const hlsUrl = `${process.env.REACT_APP_BACKEND_URL}/api/stream/live.m3u8`;
    const audio = audioRef.current;
    // Fallback MP3 diretto (ticket 239289): se HLS non parte (browser senza
    // MSE per MP3 o HLS "nativo" che non decodifica davvero), aggancio la
    // traccia corrente via /api/stream/now con l'offset del clock del server:
    // stesso frame per tutti gli ascoltatori, formato che ogni browser sa leggere.
    const attachDirect = async () => {
      const r = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/stream/now`);
      const d = await r.json();
      const cur = d?.current;
      if (!cur?.audio_url) throw new Error("Nessuna traccia in onda");
      if (hlsRef.current) { try { hlsRef.current.destroy(); } catch {} hlsRef.current = null; }
      audio.src = `${process.env.REACT_APP_BACKEND_URL}${cur.audio_url}`;
      audio.load();
      // v13.18 · Attende buffer completo (canplaythrough) invece del solo
      // loadedmetadata: elimina il "taglio a metà frase" sui talk DJ corti.
      await new Promise((resolve, reject) => {
        audio.addEventListener("canplaythrough", resolve, { once: true });
        audio.addEventListener("loadedmetadata", () => setTimeout(resolve, 300), { once: true });
        audio.addEventListener("error", () => reject(new Error("Errore caricamento audio")), { once: true });
      });
      try { audio.currentTime = cur.offset_sec || 0; } catch {}
      audio.addEventListener("ended", () => { attachDirect().catch(() => {}); }, { once: true });
      wireToRadioEngine();
      fadeInPlayback(1.0, 150);
      await audio.play();
    };
    try {
      // Cleanup precedente
      if (hlsRef.current) { try { hlsRef.current.destroy(); } catch {} hlsRef.current = null; }
      // Native HLS (Safari, iOS)
      if (audio.canPlayType("application/vnd.apple.mpegurl")) {
        audio.src = hlsUrl;
        audio.load();
        wireToRadioEngine();
        fadeInPlayback(1.0, 150);
        await audio.play();
        setStatus("playing");
        window.dispatchEvent(new CustomEvent("rai:sync:play", { detail: { playing: true } }));
        toast.success("Sync Live ON — Safari native");
        return;
      }
      // hls.js
      if (Hls.isSupported()) {
        const hls = new Hls({
          // v13.11 · Transizioni senza troncamenti — larghi buffer per coprire
          // pipeline lenta e cambi segmento gapless. hls.js gestisce già le
          // transizioni EXT-X-DISCONTINUITY / EXTINF senza cutoff, ma
          // abbassiamo la aggressività del live-sync per evitare micro-salti.
          liveSyncDurationCount: 3,
          liveMaxLatencyDurationCount: 10,
          maxLiveSyncPlaybackRate: 1.05,     // era 1.1 — meno pitch drift
          enableWorker: true,
          backBufferLength: 30,               // permette lo scrub indietro
          maxBufferLength: 90,                // ~1.5 minuti di lookahead
          startPosition: -1,                  // parte da EXT-X-START (sincrono)
        });
        hlsRef.current = hls;
        hls.loadSource(hlsUrl);
        hls.attachMedia(audio);
        await new Promise((resolve, reject) => {
          hls.once(Hls.Events.MANIFEST_PARSED, resolve);
          hls.once(Hls.Events.ERROR, (_e, data) => {
            if (data.fatal) reject(new Error(data.details || "HLS fatal"));
          });
        });
        wireToRadioEngine();
        fadeInPlayback(1.0, 150);
        await audio.play();
        setStatus("playing");
        window.dispatchEvent(new CustomEvent("rai:sync:play", { detail: { playing: true } }));
        toast.success("Sync Live ON — hls.js");

        // v13.18 · Recupero persistente post-avvio. Prima di questa fix
        // l'unico listener ERROR era quello sopra, usato solo per rigettare
        // la promise di avvio: dopo l'avvio nessuno ascoltava più gli errori,
        // quindi un errore fatale hls.js (segmento 404, stallo di rete dopo
        // un jingle) fermava lo stream per sempre senza alcun recupero.
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal) return;
          console.warn("[SyncLive] hls.js fatal error", data.type, data.details);
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              // Non recuperabile sul posto: distruggi e riparti da capo.
              try { hls.destroy(); } catch {}
              hlsRef.current = null;
              setStatus("error");
              toast.error("Interruzione stream — riconnessione in corso…");
              setTimeout(() => { startSync().catch(() => {}); }, 3000);
              break;
          }
        });
        return;
      }
      throw new Error("HLS non supportato da questo browser");
    } catch (e) {
      // Primo tentativo fallito (es. "no supported source"): aggancio diretto
      try {
        await attachDirect();
        setStatus("playing");
        window.dispatchEvent(new CustomEvent("rai:sync:play", { detail: { playing: true } }));
        toast.success("Sync Live ON — aggancio diretto");
        return;
      } catch (_e2) {
        setStatus("error");
        toast.error("Errore avvio Sync: " + (e?.message || e));
      }
    }
  };

  const stopSync = () => {
    try { audioRef.current?.pause(); } catch {}
    if (hlsRef.current) { try { hlsRef.current.destroy(); } catch {} hlsRef.current = null; }
    setStatus("idle");
    window.dispatchEvent(new CustomEvent("rai:sync:play", { detail: { playing: false } }));
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
      <audio ref={audioRef} preload="auto" className="hidden" data-testid="sync-live-audio" />
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
            {ducking && <span className="ml-2 text-pink-400 font-bold" data-testid="sync-live-ducking">· 🎙️ MIC ATTIVO -95%</span>}
          </div>
        ) : (
          <div className="text-[10px] font-mono text-zinc-500 leading-none mt-1">
            HLS pronto — premi il tasto per agganciarti
          </div>
        )}
      </div>

      {/* v13.11 · Coda di riproduzione (letta dal server clock, sincrona) */}
      {nextQueue && nextQueue.length > 0 && (
        <div className="mt-3 pt-2 border-t border-white/10" data-testid="sync-live-queue">
          <div className="text-[9px] font-mono uppercase tracking-widest text-cyan-300/60 mb-1">
            📻 In coda · sincrona per tutti
          </div>
          <ol className="space-y-0.5">
            {nextQueue.slice(0, 3).map((t, i) => (
              <li key={t.id || i} className="text-[11px] text-zinc-300 truncate flex items-center gap-2" data-testid={`sync-live-queue-${i}`}>
                <span className="text-cyan-500/60 font-mono w-4 shrink-0">{i + 1}.</span>
                <span className="truncate">{t.artist || "R-A.I."} — {t.title || t.audio_url}</span>
                {t.duration_sec && <span className="text-zinc-500 font-mono text-[9px] shrink-0">{Math.floor(t.duration_sec)}s</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
