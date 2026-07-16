import React from "react";

/**
 * R-A.I. channel bug — appears inside the visualizer / YouTube visual area.
 * Simple static wordmark; no orbit (the "FM" satellite belonged to the old brand).
 */
export default function LogoWatermark({
  size = 1,
  position = "top-right",
  opacity = 0.9,
}) {
  const positionMap = {
    "top-right":    { top: 12, right: 14, bottom: "auto", left: "auto" },
    "top-left":     { top: 12, left: 14, bottom: "auto", right: "auto" },
    "bottom-right": { bottom: 12, right: 14, top: "auto", left: "auto" },
    "bottom-left":  { bottom: 12, left: 14, top: "auto", right: "auto" },
  };
  const pos = positionMap[position] || positionMap["top-right"];

  return (
    <div
      className="pointer-events-none select-none"
      style={{
        position: "absolute",
        ...pos,
        transform: `scale(${size})`,
        transformOrigin: position.startsWith("top-") ? "top" : "bottom",
        opacity,
        zIndex: 40,
      }}
      aria-hidden
      data-testid="logo-watermark"
    >
      <span
        style={{
          fontFamily: "'Unbounded', sans-serif",
          fontWeight: 900,
          fontSize: 20,
          letterSpacing: "0.06em",
          color: "#ffffff",
          textShadow:
            "0 0 8px rgba(255, 20, 147, 0.55), 0 0 20px rgba(34, 211, 238, 0.35)",
        }}
      >
        R-A.I.
      </span>
    </div>
  );
}
