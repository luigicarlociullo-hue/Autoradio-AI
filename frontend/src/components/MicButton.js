import React, { useRef, useState } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
import { toast } from "sonner";
import radioEngine from "@/lib/radioEngine";

/**
 * MicButton — registra vocale via MediaRecorder, ducking automatico del
 * player radio al 5% durante la registrazione, upload a /api/voice/transcribe
 * (che salva file + DB) e poi onTranscribed(text, extra).
 */
export default function MicButton({ onTranscribed, disabled, authorName }) {
  const [state, setState] = useState("idle"); // idle | rec | uploading
  const mrRef = useRef(null);
  const chunksRef = useRef([]);
  const stopTimerRef = useRef(null);
  const prevMusicVolRef = useRef(null);

  const duckStart = () => {
    try {
      const gain = radioEngine?.musicGain?.gain;
      if (gain) {
        prevMusicVolRef.current = gain.value;
        gain.value = Math.max(0.03, gain.value * 0.05); // 5%
      }
      window.dispatchEvent(new CustomEvent("rai:voice-rec-start"));
    } catch (e) {}
  };
  const duckEnd = () => {
    try {
      const gain = radioEngine?.musicGain?.gain;
      if (gain && prevMusicVolRef.current != null) gain.value = prevMusicVolRef.current;
      prevMusicVolRef.current = null;
      window.dispatchEvent(new CustomEvent("rai:voice-rec-end"));
    } catch (e) {}
  };

  const start = async () => {
    if (disabled || state !== "idle") return;
    // FIX (voce in chat manda in "caos" l'audio BT mentre si guida): abbassa
    // subito la radio prima di richiedere il microfono, cosi' la transizione
    // e' pulita invece di due audio (radio + attesa mic) che si accavallano
    // mentre il sistema rinegozia il routing Bluetooth/altoparlante.
    try { radioEngine.duckForVoiceChat(); } catch (e) {}
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime =
        MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" :
        MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" :
        MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        try { radioEngine.unduckAfterVoiceChat(); } catch (e) {}
        const blob = new Blob(chunksRef.current, { type: mime || "audio/webm" });
        chunksRef.current = [];
        duckEnd();
        if (blob.size < 800) { setState("idle"); toast.error("Registrazione troppo breve"); return; }
        setState("uploading");
        try {
          const fd = new FormData();
          const ext = (mime || "audio/webm").includes("mp4") ? "m4a" : "webm";
          fd.append("file", blob, `voice.${ext}`);
          fd.append("lang", "it");
          const backend = process.env.REACT_APP_BACKEND_URL;
          const r = await fetch(`${backend}/api/voice/transcribe`, { method: "POST", body: fd });
          if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
          const data = await r.json();
          const text = (data?.text || "").trim();
          if (!text && !data?.id) throw new Error("Trascrizione vuota");
          if (typeof onTranscribed === "function") await onTranscribed(text, data);
          toast.success("Vocale inviato · in coda regia");
        } catch (e) {
          toast.error(`Trascrizione fallita: ${e.message}`);
        } finally { setState("idle"); }
      };
      mr.start();
      mrRef.current = mr;
      setState("rec");
      duckStart();
      // safety: stop dopo 30s
      stopTimerRef.current = setTimeout(() => { try { mr.stop(); } catch {} }, 30_000);
    } catch (e) {
      try { radioEngine.unduckAfterVoiceChat(); } catch (e2) {}
      toast.error("Microfono non disponibile");
      setState("idle");
    }
  };

  const stop = () => {
    if (state !== "rec") return;
    try { mrRef.current?.stop(); } catch {}
    if (stopTimerRef.current) { clearTimeout(stopTimerRef.current); stopTimerRef.current = null; }
  };

  const onClick = state === "rec" ? stop : start;
  const cls = state === "rec"
    ? "bg-rose-500/25 border-rose-400 text-rose-100 animate-pulse"
    : state === "uploading"
    ? "bg-cyan-500/20 border-cyan-400 text-cyan-100"
    : "bg-black border-white/15 text-cyan-300 hover:border-cyan-400";
  const title = state === "rec" ? "Stop" : state === "uploading" ? "Trascrizione…" : "Registra vocale";

  return (
    <button
      type="button"
      data-testid="chat-mic-button"
      disabled={disabled || state === "uploading"}
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`inline-flex items-center justify-center w-10 h-10 rounded-md border transition ${cls}`}
    >
      {state === "uploading"
        ? <Loader2 className="w-4 h-4 animate-spin" />
        : state === "rec"
        ? <Square className="w-4 h-4" />
        : <Mic className="w-4 h-4" />}
    </button>
  );
}
