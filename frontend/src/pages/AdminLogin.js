import React, { useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Lock, LogIn, Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

export default function AdminLogin() {
  const auth = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const from = loc.state?.from || "/dashboard";

  const [email, setEmail] = useState("admin@r-ai.it");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await auth.login(email.trim(), password);
      toast.success("Accesso Regia autorizzato");
      nav(from, { replace: true });
    } catch (err) {
      const detail = err?.response?.data?.detail;
      const msg = typeof detail === "string"
        ? detail
        : (err?.message || "Accesso negato");
      setError(msg);
    } finally { setBusy(false); }
  };

  // Se già loggato, redirect
  React.useEffect(() => {
    if (auth?.state && auth.state !== false) nav(from, { replace: true });
  }, [auth, from, nav]);

  return (
    <div className="relative min-h-screen bg-black text-white flex items-center justify-center px-4"
      data-testid="admin-login-page">
      <div aria-hidden className="fixed inset-0 pointer-events-none rai-bg" style={{ zIndex: 0 }}>
        <div className="rai-bg-grid" />
        <div className="rai-bg-orb rai-bg-orb-1" />
        <div className="rai-bg-orb rai-bg-orb-2" />
      </div>

      <div className="absolute top-4 left-4 z-10">
        <Link to="/" className="btn-outline focusable !py-1.5 !px-3 !text-[11px] inline-flex items-center gap-2">
          <ArrowLeft className="w-3.5 h-3.5" /> Home
        </Link>
      </div>

      <form
        onSubmit={onSubmit}
        className="console-panel w-full max-w-md p-6 relative z-10"
        data-testid="admin-login-form"
        style={{
          boxShadow: "0 0 0 1px rgba(0,229,255,0.35) inset, 0 24px 80px rgba(0,0,0,0.8), 0 0 40px rgba(0,191,255,0.25)",
        }}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-11 h-11 rounded-lg flex items-center justify-center"
               style={{
                 background: "rgba(0,191,255,0.10)",
                 border: "1px solid rgba(0,229,255,0.55)",
                 boxShadow: "0 0 14px rgba(0,229,255,0.5)",
               }}>
            <Lock className="w-5 h-5" style={{ color: "var(--console-cyan)" }} />
          </div>
          <div>
            <div className="label-mono">◂ ACCESSO REGIA ▸</div>
            <h1
              className="font-display font-black text-2xl text-glow-blue"
              style={{ fontFamily: '"Orbitron","Share Tech Mono",ui-monospace,monospace', letterSpacing: "0.06em" }}
            >
              R-A.I. · CONTROL ROOM
            </h1>
          </div>
        </div>

        <p className="text-[11px] font-mono text-zinc-400 mb-5">
          Solo il personale autorizzato può accedere. Password admin protetta da variabile d'ambiente e JWT firmato.
        </p>

        <label className="label-mono block mb-1">Email admin</label>
        <input
          type="email" required autoFocus
          data-testid="admin-login-email"
          value={email} onChange={(e) => setEmail(e.target.value)}
          className="w-full bg-black border border-white/10 rounded px-3 py-2 text-white text-sm mb-3"
        />

        <label className="label-mono block mb-1">Password</label>
        <input
          type="password" required
          data-testid="admin-login-password"
          value={password} onChange={(e) => setPassword(e.target.value)}
          className="w-full bg-black border border-white/10 rounded px-3 py-2 text-white text-sm"
          autoComplete="current-password"
        />

        {error && (
          <div className="mt-3 text-xs font-mono text-rose-300 bg-rose-500/10 border border-rose-400/40 rounded px-3 py-2" data-testid="admin-login-error">
            ⚠ {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !password}
          data-testid="admin-login-submit"
          className="btn-primary w-full mt-5 inline-flex items-center justify-center gap-2 disabled:opacity-40"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
          {busy ? "Verifica…" : "Entra in Regia"}
        </button>
      </form>
    </div>
  );
}
