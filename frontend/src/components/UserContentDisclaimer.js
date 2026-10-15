import React, { useEffect, useState } from "react";

/* Disclaimer contenuti utente — accettazione obbligatoria prima di inviare.
   L'accettazione resta valida per la sessione del browser (sessionStorage). */
export const UGC_DISCLAIMER_KEY = "rai:ugc:accepted";
export const UGC_DISCLAIMER_TEXT =
  "Sei responsabile di ciò che scrivi e carichi. Sono vietati contenuti offensivi, illegali, diffamatori o che violano diritti di terzi (copyright, privacy, marchi). R-A.I. Radio non è responsabile per i contenuti inviati dagli utenti e può rimuoverli o non trasmetterli.";

export function useUgcAccepted() {
  const [accepted, setAccepted] = useState(() => {
    try { return sessionStorage.getItem(UGC_DISCLAIMER_KEY) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { if (accepted) sessionStorage.setItem(UGC_DISCLAIMER_KEY, "1"); else sessionStorage.removeItem(UGC_DISCLAIMER_KEY); } catch {}
  }, [accepted]);
  return [accepted, setAccepted];
}

export function UserContentDisclaimer({ accepted, onChange, testid = "ugc-disclaimer", compact = false }) {
  return (
    <label
      data-testid={testid}
      className={`flex items-start gap-2 rounded-md cursor-pointer select-none ${compact ? "p-2" : "p-3"}`}
      style={{ background: accepted ? "rgba(0,229,255,0.05)" : "rgba(255,107,170,0.07)", border: `1px solid ${accepted ? "rgba(0,229,255,0.35)" : "rgba(255,107,170,0.5)"}` }}
    >
      <input
        type="checkbox"
        checked={accepted}
        onChange={(e) => onChange(e.target.checked)}
        data-testid={`${testid}-checkbox`}
        className="mt-0.5 h-4 w-4 shrink-0 accent-pink-500"
      />
      <span className={`${compact ? "text-[10px]" : "text-xs"} leading-relaxed text-zinc-300`} data-testid={`${testid}-text`}>
        <strong className="text-white">Accetto:</strong> {UGC_DISCLAIMER_TEXT}
        {!accepted && <span className="block mt-1 font-mono uppercase tracking-wider" style={{ color: "#FF6BAA" }}>Spunta per poter inviare</span>}
      </span>
    </label>
  );
}
