import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import App from "@/App";

// v13.30 · STABILIZZAZIONE UI — Sopprimi il warning benign
// "ResizeObserver loop completed with undelivered notifications" che
// alcuni browser sputano quando un ResizeObserver interno di React o di
// una libreria terza (Radix/Recharts) causa un piccolo re-layout in
// cascata. Non è un errore reale: rompe solo l'overlay di errore in dev.
if (typeof window !== "undefined") {
  const ignore = (msg) =>
    typeof msg === "string" &&
    (msg.includes("ResizeObserver loop") ||
      msg.includes("ResizeObserver loop completed with undelivered notifications"));

  window.addEventListener("error", (e) => {
    if (ignore(e?.message)) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  });
  window.addEventListener("unhandledrejection", (e) => {
    if (ignore(e?.reason?.message)) {
      e.preventDefault();
    }
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
