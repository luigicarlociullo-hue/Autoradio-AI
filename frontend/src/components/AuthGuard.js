import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Loader2 } from "lucide-react";

export default function AuthGuard({ children }) {
  const auth = useAuth();
  const loc = useLocation();

  if (auth?.state === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-cyan-300">
        <div className="flex items-center gap-3 font-mono text-sm">
          <Loader2 className="w-5 h-5 animate-spin" /> Verifica sessione regia…
        </div>
      </div>
    );
  }
  if (!auth?.state) {
    return <Navigate to="/admin/login" replace state={{ from: loc.pathname }} />;
  }
  return children;
}
