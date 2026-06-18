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
