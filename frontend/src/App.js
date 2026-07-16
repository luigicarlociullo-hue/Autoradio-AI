import React from "react";
import { BrowserRouter, Routes, Route, Link, useLocation, useNavigate } from "react-router-dom";
import { Toaster } from "sonner";
import PublicRadio from "@/pages/PublicRadio";
import Dashboard from "@/pages/Dashboard";
import AuthCallback from "@/pages/AuthCallback";
import Advertise from "@/pages/Advertise";
import AdReturn from "@/pages/AdReturn";
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
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/pubblicita" element={<Advertise />} />
      <Route path="/ads/return" element={<AdReturn />} />
      <Route path="*" element={<PublicRadio />} />
    </Routes>
  );
}

export default function App() {
  return (
    <div className="App">
      <BrowserRouter>
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
      </BrowserRouter>
    </div>
  );
}
