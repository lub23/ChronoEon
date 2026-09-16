import { useMemo } from "react";

type Layer = "back" | "mid" | "front";

interface Leaf {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rotate: number;
  opacity: number;
  layer: Layer;
}

function createRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function buildFoliage(): Leaf[] {
  const rng = createRng(0x51a3e0);
  const leaves: Leaf[] = [];

  const addCluster = (cx: number, cy: number, radius: number, count: number, layer: Layer) => {
    for (let i = 0; i < count; i += 1) {
      const angle = rng() * Math.PI * 2;
      const distance = Math.sqrt(rng()) * radius;
      const base = layer === "back" ? 0.13 + rng() * 0.14
        : layer === "mid" ? 0.17 + rng() * 0.16
        : 0.08 + rng() * 0.08;
      leaves.push({
        cx: cx + Math.cos(angle) * distance,
        cy: cy + Math.sin(angle) * distance * 0.68,
        rx: 36 + rng() * 72,
        ry: 18 + rng() * 42,
        rotate: rng() * 360,
        opacity: base,
        layer,
      });
    }
  };

  // Distant canopy ceiling — broad, soft coverage across the top.
  for (let i = 0; i < 18; i += 1) {
    addCluster(-80 + rng() * 1600, -120 + Math.pow(rng(), 0.68) * 430, 160 + rng() * 200, 3, "back");
  }
  // Side edges — foliage climbing the left/right margins.
  for (let i = 0; i < 8; i += 1) {
    addCluster(i % 2 ? -90 + rng() * 250 : 1280 + rng() * 250, 80 + rng() * 560, 140 + rng() * 180, 2, "back");
  }
  // Mid canopy — denser clusters behind the calendar panels.
  for (let i = 0; i < 14; i += 1) {
    addCluster(200 + rng() * 1040, 100 + rng() * 400, 180 + rng() * 140, 3, "mid");
  }
  // Foreground — a few soft impressions at the edges.
  for (let i = 0; i < 8; i += 1) {
    addCluster(rng() * 1440, 80 + rng() * 500, 110 + rng() * 140, 2, "front");
  }

  return leaves;
}

/**
 * A lightweight foliage-only canopy. The trunk, branches and the expensive
 * `feTurbulence`/`feDisplacementMap` SVG filter that made the old tree slow
 * have been removed; only the randomly distributed leaf ellipses remain,
 * rendered as a single SVG with per-layer CSS blur for depth.
 */
export function TreeCanopy() {
  const leaves = useMemo(buildFoliage, []);
  const groups = useMemo(() => ({
    back: leaves.filter((l) => l.layer === "back"),
    mid: leaves.filter((l) => l.layer === "mid"),
    front: leaves.filter((l) => l.layer === "front"),
  }), [leaves]);

  const renderGroup = (layer: Layer, items: Leaf[]) => (
    <g className={`canopy-${layer}`} fill="currentColor" stroke="none">
      {items.map((leaf, i) => (
        <ellipse
          key={i}
          cx={leaf.cx.toFixed(1)}
          cy={leaf.cy.toFixed(1)}
          rx={leaf.rx.toFixed(1)}
          ry={leaf.ry.toFixed(1)}
          fillOpacity={leaf.opacity.toFixed(3)}
          transform={`rotate(${leaf.rotate.toFixed(1)} ${leaf.cx.toFixed(1)} ${leaf.cy.toFixed(1)})`}
        />
      ))}
    </g>
  );

  return (
    <div className="canopy-stage" aria-hidden="true">
      <svg className="canopy-svg" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMax slice" role="presentation">
        {renderGroup("back", groups.back)}
        {renderGroup("mid", groups.mid)}
        {renderGroup("front", groups.front)}
      </svg>
    </div>
  );
}
