import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  // null = checking, false = not-auth, {user} = auth
  const [state, setState] = useState(null);

  const check = useCallback(async () => {
    try {
      const r = await api.get("/regia/me");
      setState({ user: r.data?.user });
    } catch (e) {
      setState(false);
    }
  }, []);

  useEffect(() => { check(); }, [check]);

  const login = async (email, password) => {
    const r = await api.post("/regia/login", { email, password });
    // Cookie httpOnly settato dal server; se il browser blocca cross-site cookies,
    // salvo il JWT anche in localStorage come fallback (Authorization Bearer).
    if (r.data?.token) {
      try { localStorage.setItem("rai_admin_token", r.data.token); } catch {}
    }
    setState({ user: r.data?.user });
    return r.data;
  };

  const logout = async () => {
    try { await api.post("/regia/logout"); } catch {}
    try { localStorage.removeItem("rai_admin_token"); } catch {}
    setState(false);
  };

  return (
    <AuthCtx.Provider value={{ state, login, logout, check }}>
      {children}
    </AuthCtx.Provider>
  );
}

// Enhance axios: attach Bearer from localStorage if presente (fallback cross-site).
try {
  api.interceptors.request.use((config) => {
    const t = localStorage.getItem("rai_admin_token");
    if (t) config.headers.Authorization = `Bearer ${t}`;
    return config;
  });
} catch {}
