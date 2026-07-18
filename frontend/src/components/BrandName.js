import React from "react";

/**
 * BrandName · rende sempre "R-A.I." in modo leggibile.
 * Il font display "Unbounded" a peso 900 renderizza il trattino e i punti come
 * micro-punti quasi invisibili → separo lettere e simboli, dando ai simboli un
 * font di sistema con peso più leggero così restano ben visibili.
 */
export default function BrandName({ className = "", style = {}, suffix = "" }) {
  // Font display "Unbounded" a peso 900 rende hyphen e punti come micro-punti quasi
  // invisibili → forzo i simboli con font monospace, peso pieno e dimensione maggiore
  // dell'alfabeto attorno, così restano nettissimi e leggibili come "R-A.I."
  const symbolStyle = {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
    fontWeight: 900,
    fontSize: "1.05em",
    display: "inline-block",
    lineHeight: 1,
    margin: "0 0.06em",
    verticalAlign: "baseline",
  };
  return (
    <span className={className} style={{ letterSpacing: "0.03em", ...style }} data-testid="brand-name">
      R<span style={symbolStyle} aria-hidden>-</span>A<span style={symbolStyle} aria-hidden>.</span>I<span style={symbolStyle} aria-hidden>.</span>{suffix}
    </span>
  );
}
