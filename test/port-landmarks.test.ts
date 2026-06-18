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

import { sampleZoneRing } from '../examples/kaohsiung-port/scene/landmarks';

describe('sampleZoneRing', () => {
  it('emits count ring points at radius plus a center point', () => {
    const pts = sampleZoneRing({ x: 2, z: 2 }, 1.5, 0.05, 12);
    expect(pts.length).toBe((12 + 1) * 3); // 12 ring + 1 center
    // last triple is the center
    const n = pts.length;
    expect([pts[n - 3], pts[n - 2], pts[n - 1]]).toEqual([2, 0.05, 2]);
    // every ring point sits at radius from center, at y
    for (let i = 0; i < 12 * 3; i += 3) {
      expect(pts[i + 1]).toBeCloseTo(0.05);
      expect(Math.hypot(pts[i] - 2, pts[i + 2] - 2)).toBeCloseTo(1.5);
    }
  });
});
