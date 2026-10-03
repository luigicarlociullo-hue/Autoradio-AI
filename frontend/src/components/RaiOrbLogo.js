// v13.41 · Logo animato R-AI: sfera wireframe CSS 3D che ruota sull'asse Y
// + anello di testo "R-AI" che orbita a velocità diversa. Puro CSS (zero JS
// per frame). Dimensioni ereditate dal contenitore (w-14 h-14).
const LETTERS = "R-AI · R-AI · ".split("");

export const RaiOrbLogo = ({ size = 56 }) => {
  const r = size / 2;
  const meridians = [0, 30, 60, 90, 120, 150];
  return (
    <div className="rai-orb" style={{ width: size, height: size, perspective: `${Math.round(size * 2.9)}px` }} data-testid="rai-orb-logo" aria-label="R-AI">
      <div className="rai-orb-scene">
        <div className="rai-orb-sphere">
          <div className="rai-orb-core" />
          {meridians.map((deg) => (
            <div key={`m${deg}`} className="rai-orb-ring" style={{ transform: `rotateY(${deg}deg)` }} />
          ))}
          {[-0.62, 0, 0.62].map((k) => {
            const ry = Math.sqrt(1 - k * k) * 100;
            return (
              <div
                key={`p${k}`}
                className="rai-orb-ring rai-orb-parallel"
                style={{ transform: `rotateX(90deg) translateZ(${-k * r * 0.72}px) scale(${ry / 100})` }}
              />
            );
          })}
        </div>
        <div className="rai-orb-text" style={{ fontSize: Math.max(7.5, size * 0.125) }}>
          {LETTERS.map((ch, i) => (
            <span
              key={i}
              style={{ transform: `rotate(${(360 / LETTERS.length) * i}deg) translateY(${-r + 3}px)` }}
            >
              {ch}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
