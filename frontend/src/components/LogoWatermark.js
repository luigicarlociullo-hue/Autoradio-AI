import React from "react";

/**
 * NEURA·FM channel bug — appears inside the visualizer/YouTube visual area.
 * "NEURA" static. "FM" orbits around it in a 3D-like path: for half of the
 * cycle it passes IN FRONT of "NEURA", for the other half it passes BEHIND
 * (smaller, dimmer, blurred) to fake depth.
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
      <div className="logo-orbit-wrapper">
        {/* FM passing BEHIND — dimmer, smaller, blurred, first half of the loop */}
        <span className="fm-orbit fm-back">FM</span>

        {/* Static NEURA in the middle */}
        <span className="neura-static">NEURA</span>

        {/* FM passing IN FRONT — full brightness, second half of the loop */}
        <span className="fm-orbit fm-front">FM</span>
      </div>

      <style>{`
        .logo-orbit-wrapper {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 92px;
          height: 60px;
          font-family: 'Unbounded', sans-serif;
        }
        .neura-static {
          position: relative;
          z-index: 2;
          font-weight: 900;
          font-size: 18px;
          letter-spacing: 0.03em;
          color: #ffffff;
          text-shadow:
            0 0 8px rgba(255, 20, 147, 0.55),
            0 0 18px rgba(138, 43, 226, 0.35);
          line-height: 1;
        }
        .fm-orbit {
          position: absolute;
          top: 50%;
          left: 50%;
          margin-left: -9px;
          margin-top: -7px;
          font-weight: 900;
          letter-spacing: 0.08em;
          color: #22d3ee;
          transform-origin: center center;
          will-change: transform, opacity;
        }
        /* Front pass: on top of NEURA (z-index 3), full brightness.
           Visible only during the second half of the loop (behind → front). */
        .fm-front {
          z-index: 3;
          font-size: 12px;
          text-shadow:
            0 0 6px rgba(34, 211, 238, 0.95),
            0 0 14px rgba(34, 211, 238, 0.55);
          animation: fmOrbitFront 3.6s linear infinite;
        }
        /* Back pass: behind NEURA (z-index 1), smaller + blurred + dimmer,
           visible only during the first half of the loop (front → behind). */
        .fm-back {
          z-index: 1;
          font-size: 10.5px;
          color: rgba(34, 211, 238, 0.75);
          text-shadow: 0 0 4px rgba(34, 211, 238, 0.5);
          filter: blur(0.5px);
          animation: fmOrbitBack 3.6s linear infinite;
        }

        /* Elliptical orbit. Both keyframes share the same path (rx=32px, ry=10px);
           front/back visibility is toggled discretely at the 50% mark using
           step-wise opacity so the switch happens at the "edge" of the ellipse. */
        @keyframes fmOrbitFront {
          0%   { transform: translate(32px, 0) scale(1);    opacity: 0; }
          0.01%{ opacity: 1; }
          25%  { transform: translate(0, 10px) scale(1.1); opacity: 1; }
          49.99%{ transform: translate(-32px, 0) scale(1); opacity: 1; }
          50%  { opacity: 0; }
          100% { transform: translate(32px, 0) scale(1);   opacity: 0; }
        }
        @keyframes fmOrbitBack {
          0%   { transform: translate(32px, 0) scale(0.85); opacity: 0; }
          50%  { opacity: 0; }
          50.01%{ transform: translate(-32px, 0) scale(0.85); opacity: 1; }
          75%  { transform: translate(0, -10px) scale(0.72); opacity: 1; }
          99.99%{ transform: translate(32px, 0) scale(0.85); opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
