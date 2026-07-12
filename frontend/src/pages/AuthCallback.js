import React, { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { endpoints } from "@/lib/api";
import { toast } from "sonner";

// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
export default function AuthCallback() {
  const navigate = useNavigate();
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;
    (async () => {
      try {
        const hash = window.location.hash || "";
        const params = new URLSearchParams(hash.replace(/^#/, ""));
        const sessionId = params.get("session_id");
        if (!sessionId) {
          navigate("/");
          return;
        }
        const { user } = await endpoints.session(sessionId);
        toast.success(`Benvenuto ${user?.name || ""}`);
        // Clean hash and redirect to dashboard
        window.history.replaceState({}, document.title, "/dashboard");
        navigate("/dashboard", { state: { user } });
      } catch (e) {
        toast.error("Autenticazione fallita");
        navigate("/");
      }
    })();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#05050A]">
      <div className="text-center">
        <div className="label-mono mb-3">Autenticazione in corso</div>
        <div className="font-display text-2xl">Sto connettendo il tuo profilo…</div>
      </div>
    </div>
  );
}
