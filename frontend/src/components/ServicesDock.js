import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Building2, AudioWaveform, Mail, Sparkles, Home } from "lucide-react";
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from "@/components/ui/dialog";

/**
 * ServicesDock — Sidebar verticale a icone (fixed a destra) per accedere ai
 * servizi secondari senza occupare il corpo centrale del cruscotto.
 * Glassmorphism ciano.
 */
export default function ServicesDock() {
  return (
    <aside
      data-testid="services-dock"
      aria-label="Servizi"
      className="fixed z-30 hidden md:flex flex-col items-center gap-2 p-2 rounded-2xl right-3 top-1/2 -translate-y-1/2"
      style={{
        background: "linear-gradient(180deg, rgba(4,10,22,0.55) 0%, rgba(2,6,15,0.75) 100%)",
        border: "1px solid rgba(0,229,255,0.35)",
        boxShadow: "0 12px 40px rgba(0,0,0,0.55), 0 0 26px rgba(0,191,255,0.20), inset 0 0 12px rgba(0,229,255,0.12)",
        backdropFilter: "blur(14px) saturate(1.2)",
        WebkitBackdropFilter: "blur(14px) saturate(1.2)",
      }}
    >
      <Link
        to="/"
        data-testid="dock-home"
        title="Home"
        className="dock-btn"
        style={dockBtnStyle("#00E5FF")}
      >
        <Home className="w-4 h-4 text-cyan-300" />
      </Link>

      <StudiosDialog />

      <Link
        to="/partner"
        data-testid="dock-partner"
        title="Diventa Partner"
        className="dock-btn"
        style={dockBtnStyle("#FFB84D")}
      >
        <Sparkles className="w-4 h-4" style={{ color: "#FFB84D" }} />
      </Link>

      <Link
        to="/replay"
        data-testid="dock-replay"
        title="Re-Play (Archivio Storico)"
        className="dock-btn"
        style={dockBtnStyle("#7FD8FF")}
      >
        <AudioWaveform className="w-4 h-4" style={{ color: "#7FD8FF" }} />
      </Link>

      <ContattiDialog />

      <style>{`
        .dock-btn {
          width: 44px; height: 44px; border-radius: 10px;
          display: flex; align-items: center; justify-content: center;
          transition: transform .2s ease;
        }
        .dock-btn:hover { transform: translateY(-2px); }
      `}</style>
    </aside>
  );
}

function dockBtnStyle(accent) {
  return {
    border: `1px solid ${accent}55`,
    background: "rgba(0,0,0,0.4)",
    boxShadow: `0 0 12px ${accent}33`,
  };
}

function StudiosDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          data-testid="dock-studios"
          title="R-A.I. Virtual Studios"
          className="dock-btn"
          style={dockBtnStyle("#00E5FF")}
        >
          <Building2 className="w-4 h-4 text-cyan-300" />
        </button>
      </DialogTrigger>
      <DialogContent
        className="bg-black text-white p-0 border-0 max-w-[96vw] w-[96vw] sm:max-w-[92vw] md:max-w-[88vw]"
        data-testid="virtual-studios-dialog"
        style={{ boxShadow: "0 0 0 1px rgba(0,229,255,0.5) inset, 0 30px 120px rgba(0,0,0,0.9), 0 0 80px rgba(0,191,255,0.35)" }}
      >
        <DialogHeader className="px-6 pt-5 pb-2">
          <DialogTitle
            className="text-2xl sm:text-3xl font-display font-black text-glow-blue"
            style={{ fontFamily: '"Orbitron","Share Tech Mono",ui-monospace,monospace', letterSpacing: "0.08em" }}
          >
            R-A.I. VIRTUAL STUDIOS
          </DialogTitle>
          <DialogDescription className="text-xs font-mono uppercase tracking-widest text-cyan-500 mt-1">
            HQ · CONSOLE DI TRASMISSIONE
          </DialogDescription>
        </DialogHeader>
        <div className="px-4 sm:px-6 pb-4 sm:pb-6">
          <div className="relative w-full overflow-hidden rounded-xl"
            style={{ border: "1px solid rgba(0,229,255,0.45)", boxShadow: "0 0 40px rgba(0,191,255,0.28)" }}>
            <img src="/rai-studios.png" alt="R-A.I. Virtual Studios" className="w-full h-auto max-h-[75vh] object-contain bg-black" />
          </div>
          <p
            className="mt-4 text-center text-sm sm:text-base font-mono text-cyan-200"
            style={{
              fontFamily: '"Share Tech Mono","Orbitron",ui-monospace,monospace',
              letterSpacing: "0.1em",
              textShadow: "0 0 6px rgba(0,229,255,0.7), 0 0 20px rgba(0,180,255,0.4)",
            }}
          >
            Il cuore pulsante di R-A.I. — Prossimamente visitabile in 3D.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ContattiDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          data-testid="dock-contatti"
          title="Comunicazione Ufficiale"
          className="dock-btn"
          style={dockBtnStyle("#B8ECFF")}
        >
          <Mail className="w-4 h-4" style={{ color: "#B8ECFF" }} />
        </button>
      </DialogTrigger>
      <DialogContent
        data-testid="contatti-dialog"
        className="max-w-lg bg-[#02040A] text-white"
        style={{ border: "1px solid rgba(0,229,255,0.4)", boxShadow: "0 0 40px rgba(0,191,255,0.25)" }}
      >
        <DialogHeader>
          <DialogTitle
            className="text-xl font-display font-black text-glow-blue"
            style={{ fontFamily: '"Orbitron","Share Tech Mono",ui-monospace,monospace' }}
          >
            COMUNICAZIONE UFFICIALE
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2 mt-2 text-sm font-mono">
          {[
            { label: "Relazioni Pubbliche",   email: "info@r-ai.it" },
            { label: "Ufficio di Presidenza", email: "direzione@r-ai.it" },
            { label: "Diretta Live",          email: "diretta@r-ai.it" },
          ].map(x => (
            <a key={x.email} href={`mailto:${x.email}`}
              className="flex items-center justify-between console-panel p-3 hover:border-cyan-400"
              data-testid={`dock-mailto-${x.email.split("@")[0]}`}
            >
              <span className="text-cyan-500 text-[11px] uppercase tracking-widest">{x.label}</span>
              <span className="text-cyan-200" style={{ textShadow: "0 0 4px rgba(0,229,255,0.7)" }}>{x.email}</span>
            </a>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
