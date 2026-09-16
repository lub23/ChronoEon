import { useMemo } from "react";
import type { CSSProperties } from "react";

/**
 * A small, fixed particle budget for the shell's calm atmosphere.
 */
const COUNT = 20;

function jitter(index: number, salt: number): number {
  const value = Math.sin((index + 1) * 43.1287 + salt * 17.913) * 9853.117;
  return value - Math.floor(value);
}

export function AmbientParticles() {
  const particles = useMemo(() => Array.from({ length: COUNT }, (_, index) => ({
    key: index,
    style: {
      "--particle-x": `${(jitter(index, 1) * 104 - 2).toFixed(2)}%`,
      "--particle-y": `${(jitter(index, 2) * 100).toFixed(2)}%`,
      "--particle-drift": `${((jitter(index, 3) - 0.5) * 2).toFixed(2)}`,
      "--particle-delay": `${(-jitter(index, 4) * 26).toFixed(2)}s`,
      "--particle-duration": `${(34 + jitter(index, 5) * 26).toFixed(2)}s`,
      "--particle-scale": `${(0.45 + jitter(index, 6) * 1.15).toFixed(2)}`,
      "--particle-opacity": `${(0.22 + jitter(index, 7) * 0.26).toFixed(2)}`,
      "--particle-color": index % 4 === 0 ? "var(--accent)" : index % 4 === 1 ? "var(--gold)" : index % 4 === 2 ? "var(--violet)" : "var(--green)",
    } as CSSProperties,
  })), []);

  return (
    <div className="ambient-particles" aria-hidden="true">
      {particles.map((particle, index) => (
        <i key={particle.key} className={index % 6 === 2 ? "ambient-particle--leaf" : ""} style={particle.style} />
      ))}
    </div>
  );
}
