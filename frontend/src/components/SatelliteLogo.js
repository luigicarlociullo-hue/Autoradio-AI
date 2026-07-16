import React, { useState } from "react";

/**
 * NEURA·FM satellite watermark — fixed to the bottom-right of the viewport.
 * "NEURA" stays centered, "FM" orbits around it like a satellite.
 * Semi-transparent (0.35) by default, 0.6 on hover.
 */
export default function SatelliteLogo() {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      data-testid="satellite-logo"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        opacity: hovered ? 0.6 : 0.35,
        transition: "opacity 0.3s ease",
        zIndex: 100,
        userSelect: "none",
      }}
      aria-hidden
    >
      <div className="satellite-logo-wrapper">
        <span className="satellite-neura">NEURA</span>
        <span className="satellite-fm">FM</span>
      </div>

      <style>{`
        .satellite-logo-wrapper {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 80px;
          height: 80px;
        }
        .satellite-neura {
          font-family: 'Unbounded', sans-serif;
          font-size: 1.05em;
          font-weight: 900;
          color: #ffffff;
          letter-spacing: 2px;
          text-shadow: 0 0 6px rgba(255, 20, 147, 0.55), 0 0 14px rgba(138, 43, 226, 0.35);
          z-index: 2;
        }
        .satellite-fm {
          position: absolute;
          top: 50%;
          left: 50%;
          margin-left: -8px;
          margin-top: -6px;
          font-family: 'Unbounded', sans-serif;
          font-size: 0.6em;
          font-weight: 900;
          color: #00eaff;
          text-shadow: 0 0 6px #00eaff, 0 0 14px rgba(0, 234, 255, 0.6);
          letter-spacing: 1px;
          animation: satOrbit 4s linear infinite;
          transform-origin: center center;
        }
        @keyframes satOrbit {
          from { transform: rotate(0deg) translateX(38px) rotate(0deg); }
          to   { transform: rotate(360deg) translateX(38px) rotate(-360deg); }
        }
      `}</style>
    </div>
  );
}
