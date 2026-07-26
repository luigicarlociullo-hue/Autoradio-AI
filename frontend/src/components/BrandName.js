import React from "react";

/**
 * BrandName - rende SEMPRE "R-A.I." in modo assolutamente inequivocabile.
 *
 * Storia del bug: il font display "Unbounded" a peso 900 (usato altrove nel
 * sito) collassa il trattino "-" e i punti "." in micro-glyph quasi invisibili,
 * il che faceva leggere "R-A.I." come "R.Un.io" o "RAI" a seconda del render
 * del browser (specialmente Safari mobile e Chrome ad alto DPI).
 *
 * Fix definitivo:
 *   1. Font locked: system monospace (ui-monospace / SFMono / Menlo / Consolas).
 *      Nessuna dipendenza da Unbounded o altri display font per il brand.
 *   2. Font weight 700 uniforme (non 900 -> evita collasso simboli).
 *   3. Letter-spacing generoso -> ogni carattere respira.
 *   4. Testo unico "R-A.I." in un solo <span> (niente span annidati che possono
 *      confondere il layout in certi engine di rendering).
 */
export default function BrandName({ className = "", style = {}, suffix = "" }) {
  const brandStyle = {
    fontFamily: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
    fontWeight: 700,
    letterSpacing: "0.08em",
    fontVariantLigatures: "none",
    ...style,
  };
  return (
    <span
      className={`notranslate ${className}`}
      style={brandStyle}
      data-testid="brand-name"
      data-brand="R-A.I."
      aria-label="R-A.I."
      translate="no"
    >
      R-A.I.{suffix}
    </span>
  );
}
