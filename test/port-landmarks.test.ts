import { describe, it, expect } from 'vitest';
import { footprintCentroidRadius, sampleCylinderShell } from '../examples/kaohsiung-port/scene/landmarks';

describe('footprintCentroidRadius', () => {
  it('returns centroid and mean radius of a square footprint', () => {
    const { center, radius } = footprintCentroidRadius([
      { x: -1, z: -1 }, { x: 1, z: -1 }, { x: 1, z: 1 }, { x: -1, z: 1 },
    ]);
    expect(center.x).toBeCloseTo(0);
    expect(center.z).toBeCloseTo(0);
    expect(radius).toBeCloseTo(Math.SQRT2); // each corner dist = sqrt(2)
  });
});

describe('sampleCylinderShell', () => {
  it('emits rings*perRing xyz points within [baseY, baseY+height] at the given radius', () => {
    const pts = sampleCylinderShell({ x: 5, z: -3 }, 2, 1, 0.6, 3, 8);
    expect(pts.length).toBe(3 * 8 * 3); // 24 points × xyz
    for (let i = 0; i < pts.length; i += 3) {
      const x = pts[i], y = pts[i + 1], z = pts[i + 2];
      expect(y).toBeGreaterThanOrEqual(1 - 1e-6);
      expect(y).toBeLessThanOrEqual(1.6 + 1e-6);
      expect(Math.hypot(x - 5, z - (-3))).toBeCloseTo(2);
    }
  });
});

import { sampleGantry } from '../examples/kaohsiung-port/scene/landmarks';

describe('sampleGantry', () => {
  const pts = sampleGantry({ x: 0, z: 0 }, 0, { legHeight: 0.6, baseW: 0.4, baseD: 0.4, boomLen: 0.5, spacing: 0.1 });
  it('emits xyz triples', () => {
    expect(pts.length).toBeGreaterThan(0);
    expect(pts.length % 3).toBe(0);
  });
  it('rises to legHeight and extends along +x by the boom', () => {
    let maxY = -Infinity, minY = Infinity, maxX = -Infinity;
    for (let i = 0; i < pts.length; i += 3) {
      maxY = Math.max(maxY, pts[i + 1]); minY = Math.min(minY, pts[i + 1]);
      maxX = Math.max(maxX, pts[i]);
    }
    expect(maxY).toBeCloseTo(0.6);          // top
    expect(minY).toBeCloseTo(0);            // base
    expect(maxX).toBeCloseTo(0.2 + 0.5);    // hw(0.2) + boomLen(0.5)
  });
});
