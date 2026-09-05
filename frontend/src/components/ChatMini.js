import React, { useEffect, useRef, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import { endpoints } from "@/lib/api";
import MicButton from "@/components/MicButton";
import { toast } from "sonner";

/**
 * ChatMini — CHAT NEURALE compatta per la colonna destra del cruscotto.
 * Feed sessione-only (tabula rasa al mount), input testo + microfono Whisper.
 */
export default function ChatMini({ heightClass = "h-56" }) {
  const [messages, setMessages] = useState([]);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [avatar, setAvatar] = useState(null);   // Identità digitale (v13.3)
  const scrollRef = useRef(null);
  const sessionStartRef = useRef(new Date().toISOString());

  // v13.3 · Browser fingerprint stabile per Identità Digitale
  const browserIdRef = useRef((() => {
    try {
      let id = localStorage.getItem("rai_browser_id");
      if (!id) {
        id = "b_" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
        localStorage.setItem("rai_browser_id", id);
      }
      return id;
    } catch { return "b_" + Math.random().toString(36).slice(2, 12); }
  })());

  // Al mount: se abbiamo già un avatar salvato, mostralo subito
  useEffect(() => {
    try {
      const cached = localStorage.getItem("rai_avatar");
      if (cached) setAvatar(JSON.parse(cached));
    } catch {}
  }, []);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const q = await endpoints.questionsRecent(30);
        if (!live) return;
        const startedAt = sessionStartRef.current;
        setMessages((q?.messages || []).filter(m => (m.created_at || "") >= startedAt));
      } catch (e) {}
    };
    load();
    const iv = setInterval(load, 6000);
    return () => { live = false; clearInterval(iv); };
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const send = async (e) => {
    if (e) e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await endpoints.submitQuestion({ name: name || "Ascoltatore", question: t, source: "web" });
      setText("");
      toast.success("Domanda inviata");
      // v13.3 · IDENTITÀ DIGITALE — al primo messaggio genera archetipo+avatar
      if (!avatar) {
        try {
          const r = await endpoints.chatAvatar({
            browser_id: browserIdRef.current,
            first_message: t,
            name: name || "Ascoltatore",
          });
          setAvatar(r);
          try { localStorage.setItem("rai_avatar", JSON.stringify(r)); } catch {}
          if (r?.archetype?.name) {
            toast.success(`CUE: Benvenuto umano, per me sei un ${r.archetype.name}. Ecco il tuo volto nel mio sistema.`, { duration: 8000 });
          }
        } catch (avErr) { /* silent */ }
      }
    } catch (err) { toast.error("Invio fallito"); }
    finally { setBusy(false); }
  };

  const onVoice = async (transcript) => {
    const clean = (transcript || "").trim();
    if (!clean) return;
    setBusy(true);
    try {
      await endpoints.submitQuestion({
        name: (name || "Ascoltatore") + " 🎙️",
        question: clean,
        source: "voice",
      });
      toast.success("Vocale trascritto e inviato");
    } catch (e) { toast.error("Invio vocale fallito"); }
    finally { setBusy(false); }
  };

  return (
    <div
      data-testid="chat-mini"
      className="console-panel p-4 flex flex-col h-full"
    >
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <MessageCircle className="w-4 h-4 text-cyan-300" />
        <div className="label-mono">◂ CHAT NEURALE ▸</div>
        <span
          data-testid="voice-live-badge"
          className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded"
          style={{
            color: "#FF3D8A",
            border: "1px solid rgba(255,61,138,0.55)",
            background: "rgba(255,61,138,0.10)",
            textShadow: "0 0 6px rgba(255,61,138,0.85)",
            animation: "voiceLivePulse 1.4s ease-in-out infinite",
          }}
        >
          🎙️ VOICE LIVE
        </span>
        <style>{`@keyframes voiceLivePulse{0%,100%{opacity:1;box-shadow:0 0 6px rgba(255,61,138,0.55)}50%{opacity:.55;box-shadow:0 0 14px rgba(255,61,138,0.85)}}`}</style>
      </div>
      {avatar?.archetype && (
        <div
          className="mb-2 flex items-center gap-2 rounded-md p-1.5 border"
          data-testid="chat-avatar-badge"
          style={{
            background: `linear-gradient(90deg, ${avatar.archetype.color_a}22, ${avatar.archetype.color_b}22)`,
            borderColor: `${avatar.archetype.color_a}66`,
          }}
        >
          <img
            src={avatar.avatar_url}
            alt={avatar.archetype.name}
            className="w-8 h-8 rounded-full shrink-0"
            data-testid="chat-avatar-img"
          />
          <div className="min-w-0 flex-1">
            <div
              className="text-[10px] font-mono font-bold uppercase tracking-wide truncate"
              style={{ color: avatar.archetype.color_a, textShadow: `0 0 6px ${avatar.archetype.color_a}66` }}
            >
              {avatar.archetype.name}
            </div>
            <div className="text-[9px] text-zinc-400 truncate">{avatar.archetype.tagline}</div>
          </div>
        </div>
      )}
      <div
        ref={scrollRef}
        data-testid="chat-mini-feed"
        className={`flex-1 min-h-0 overflow-y-auto rounded-md bg-black/50 border border-cyan-500/15 p-2 text-[11px] font-mono leading-relaxed ${heightClass}`}
      >
        {messages.length === 0 && (
          <div className="text-cyan-800">▸ Nessun messaggio ancora. Scrivi o registra un vocale…</div>
        )}
        {messages.map((m, i) => (
          <div key={m.id || i} className="mb-1.5">
            <span className="text-cyan-400">[{m.name || "Ascoltatore"}]</span>
            <span className="text-zinc-200"> {m.question}</span>
            {m.answer && (
              <div className="mt-0.5 text-cyan-200 pl-3 border-l border-cyan-500/40">
                → <span className="text-cyan-300 font-bold">{m.answering_dj || "R-A.I."}</span>: {m.answer}
              </div>
            )}
          </div>
        ))}
      </div>

      <form onSubmit={send} className="mt-2 flex flex-col gap-2" data-testid="chat-mini-form">
        <input
          value={name} onChange={(e) => setName(e.target.value)}
          placeholder="NOME"
          data-testid="chat-mini-name"
          className="w-full rounded-md bg-black border outline-none px-3 py-1.5 text-[11px] font-mono text-cyan-300 placeholder:text-cyan-800 uppercase tracking-widest"
          style={{ borderColor: "var(--console-line-strong)" }}
        />
        <div className="flex gap-2">
          <input
            value={text} onChange={(e) => setText(e.target.value)}
            placeholder="Cosa vuoi dire a R-A.I.?"
            data-testid="chat-mini-input"
            className="flex-1 rounded-md bg-black border outline-none px-3 py-2 text-xs font-mono text-white placeholder:text-cyan-800 uppercase tracking-widest"
            style={{ borderColor: "var(--console-line-strong)" }}
          />
          <div className="flex flex-col items-center gap-0.5">
            <span
              className="text-[8px] font-mono uppercase tracking-widest"
              style={{ color: "#FF7FB0", textShadow: "0 0 4px rgba(255,61,138,0.7)" }}
            >
              La tua voce in onda: registra ora!
            </span>
            <MicButton disabled={busy} authorName={name} onTranscribed={onVoice} />
          </div>
          <button
            type="submit"
            disabled={busy || !text.trim()}
            data-testid="chat-mini-send"
            className="btn-primary inline-flex items-center gap-1.5 !text-[10px] disabled:opacity-40 whitespace-nowrap !px-3 !py-2"
          >
            <Send className="w-3 h-3" /> INVIA
          </button>
        </div>
      </form>
    </div>
  );
}
