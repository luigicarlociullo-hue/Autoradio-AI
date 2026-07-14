import React from "react";

/**
 * NEURA·FM channel bug (like TV channel logos in the top-right of broadcasts).
 * "NEURA" static + "FM" orbiting in an elliptical path below it.
 * Renders as absolute-positioned so it sits inside any container.
 */
export default function LogoWatermark({
  size = 1,
  position = "top-right",
  opacity = 0.9,
}) {
  const scale = size;
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
        transform: `scale(${scale})`,
        transformOrigin: position.startsWith("top-") ? "top" : "bottom",
        opacity,
        zIndex: 40,
      }}
      aria-hidden
      data-testid="logo-watermark"
    >
      {/* Container is 88x60px */}
      <div
        style={{
          position: "relative",
          width: 88,
          height: 60,
          fontFamily: "'Unbounded', sans-serif",
        }}
      >
        {/* Static NEURA */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            textAlign: "center",
            fontWeight: 900,
            fontSize: 18,
            letterSpacing: "0.02em",
            color: "#ffffff",
            textShadow:
              "0 0 8px rgba(255, 20, 147, 0.55), 0 0 18px rgba(138, 43, 226, 0.35)",
            lineHeight: 1,
          }}
        >
          NEURA
        </div>

        {/* Tiny separator dot with subtle pulse */}
        <div
          style={{
            position: "absolute",
            top: 21,
            left: "50%",
            width: 3,
            height: 3,
            marginLeft: -1.5,
            borderRadius: "50%",
            background: "#FF1493",
            boxShadow: "0 0 6px #FF1493",
            animation: "neuralPulse 1.6s ease-in-out infinite",
          }}
        />

        {/* Elliptical orbit path visualization (subtle) */}
        <div
          style={{
            position: "absolute",
            top: 34,
            left: "50%",
            width: 60,
            height: 22,
            marginLeft: -30,
            border: "1px dashed rgba(34, 211, 238, 0.25)",
            borderRadius: "50%",
          }}
        />

        {/* "FM" orbiting in ellipse */}
        <div
          style={{
            position: "absolute",
            top: 41,
            left: "50%",
            width: 0,
            height: 0,
            animation: "fmOrbit 3.2s linear infinite",
          }}
        >
          <div
            style={{
              position: "absolute",
              transform: "translate(-50%, -50%)",
              fontWeight: 900,
              fontSize: 12,
              letterSpacing: "0.08em",
              color: "#22d3ee",
              textShadow:
                "0 0 6px rgba(34, 211, 238, 0.9), 0 0 14px rgba(34, 211, 238, 0.55)",
              whiteSpace: "nowrap",
            }}
          >
            FM
          </div>
        </div>
      </div>

      {/* keyframes injected once via inline style tag (safe – idempotent) */}
      <style>{`
        @keyframes fmOrbit {
          0%   { transform: translate(-30px, 0) scale(1); }
          25%  { transform: translate(0, 6px) scale(1.12); }
          50%  { transform: translate(30px, 0) scale(1); }
          75%  { transform: translate(0, -6px) scale(0.86); }
          100% { transform: translate(-30px, 0) scale(1); }
        }
        @keyframes neuralPulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50%      { transform: scale(1.6); opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}
