import React from "react";
import { BrowserRouter, Routes, Route, Link, useLocation, useNavigate } from "react-router-dom";
import { Toaster } from "sonner";
import PublicRadio from "@/pages/PublicRadio";
import Dashboard from "@/pages/Dashboard";
import AuthCallback from "@/pages/AuthCallback";
import Advertise from "@/pages/Advertise";
import AdReturn from "@/pages/AdReturn";
import Submit from "@/pages/Submit";
import ReplayArchive from "@/pages/ReplayArchive";
import Partner from "@/pages/Partner";
import AdminLogin from "@/pages/AdminLogin";
import AdminCalendar from "@/pages/AdminCalendar";
import AuthGuard from "@/components/AuthGuard";
import { AuthProvider } from "@/lib/auth";
import LogoWatermark from "@/components/LogoWatermark";
import "@/App.css";

function AppRouter() {
  const location = useLocation();
  // Handle Emergent Auth callback synchronously (fragment contains session_id)
  if (typeof window !== "undefined" && window.location.hash?.includes("session_id=")) {
    return <AuthCallback />;
  }
  return (
    <Routes>
      <Route path="/" element={<PublicRadio />} />
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/admin/calendar" element={<AdminCalendar />} />
      <Route path="/dashboard" element={<AuthGuard><Dashboard /></AuthGuard>} />
      <Route path="/pubblicita" element={<Advertise />} />
      <Route path="/advertise" element={<Advertise />} />
      <Route path="/ads/return" element={<AdReturn />} />
      <Route path="/submit" element={<Submit />} />
      <Route path="/replay" element={<ReplayArchive />} />
      <Route path="/partner" element={<Partner />} />
      <Route path="*" element={<PublicRadio />} />
    </Routes>
  );
}

export default function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <AppRouter />
          <Toaster
            theme="dark"
            position="top-right"
            toastOptions={{
              style: {
                background: "#0F0F14",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "#fff",
              },
            }}
          />
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}
