import { describe, it, expect } from 'vitest';
import { mulberry32, surfaceSample, normalizeToUnit, type Triangle } from '../examples/kaohsiung-port/scene/meshSampling';

// 單一三角形落在 z=0 平面 → 所有取樣點應 z≈0 且在三角形 bbox 內。
const flat: Triangle = { a: { x: 0, y: 0, z: 0 }, b: { x: 4, y: 0, z: 0 }, c: { x: 0, y: 3, z: 0 } };

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const r1 = mulberry32(42), r2 = mulberry32(42);
    expect(r1()).toBe(r2());
    expect(r1()).toBe(r2());
  });
});

describe('surfaceSample', () => {
  it('returns count*3 floats', () => {
    const out = surfaceSample([flat], 100, mulberry32(1));
    expect(out.length).toBe(300);
  });

  it('keeps points on the source triangle plane (z=0) and inside its bbox', () => {
    const out = surfaceSample([flat], 500, mulberry32(7));
    for (let i = 0; i < out.length; i += 3) {
      const x = out[i], y = out[i + 1], z = out[i + 2];
      expect(Math.abs(z)).toBeLessThan(1e-6);
      expect(x).toBeGreaterThanOrEqual(-1e-6);
      expect(y).toBeGreaterThanOrEqual(-1e-6);
      expect(x / 4 + y / 3).toBeLessThanOrEqual(1 + 1e-6); // inside triangle (hypotenuse x/4+y/3=1)
    }
  });

  it('is deterministic for a given seed', () => {
    const a = surfaceSample([flat], 50, mulberry32(9));
    const b = surfaceSample([flat], 50, mulberry32(9));
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('distributes points by triangle area', () => {
    // big triangle area 8, small area 0.5 → ~16:1. tolerance loose.
    const big: Triangle = { a: { x: 0, y: 0, z: 0 }, b: { x: 4, y: 0, z: 0 }, c: { x: 0, y: 4, z: 0 } };
    const small: Triangle = { a: { x: 10, y: 0, z: 0 }, b: { x: 11, y: 0, z: 0 }, c: { x: 10, y: 1, z: 0 } };
    const out = surfaceSample([big, small], 1700, mulberry32(3));
    let inBig = 0;
    for (let i = 0; i < out.length; i += 3) if (out[i] < 5) inBig++;
    const ratio = inBig / (1700 - inBig);
    expect(ratio).toBeGreaterThan(8); // expected ~16, allow wide margin
  });
});

// helper: pack a list of xyz into Float32Array
function pack(pts: number[][]): Float32Array {
  const a = new Float32Array(pts.length * 3);
  pts.forEach((p, i) => { a[i * 3] = p[0]; a[i * 3 + 1] = p[1]; a[i * 3 + 2] = p[2]; });
  return a;
}

describe('normalizeToUnit', () => {
  // A box spanning x:[0,4] (long), y:[0,1], z:[0,2]; forward already +x, up +y.
  const box = pack([
    [0, 0, 0], [4, 0, 0], [0, 1, 0], [0, 0, 2], [4, 1, 2],
  ]);

  it('scales the long (x) axis span to 1, uniformly', () => {
    const { positions } = normalizeToUnit(box, { forwardAxis: 'x', upAxis: 'y' });
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      minX = Math.min(minX, positions[i]); maxX = Math.max(maxX, positions[i]);
      minZ = Math.min(minZ, positions[i + 2]); maxZ = Math.max(maxZ, positions[i + 2]);
    }
    expect(maxX - minX).toBeCloseTo(1, 5);
    expect(maxZ - minZ).toBeCloseTo(2 / 4, 5); // z span 2 scaled by 1/4 (uniform)
  });

  it('centers x and z, and rests min-y at 0', () => {
    const { positions } = normalizeToUnit(box, { forwardAxis: 'x', upAxis: 'y' });
    let minX = Infinity, maxX = -Infinity, minY = Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      minX = Math.min(minX, positions[i]); maxX = Math.max(maxX, positions[i]);
      minY = Math.min(minY, positions[i + 1]);
      minZ = Math.min(minZ, positions[i + 2]); maxZ = Math.max(maxZ, positions[i + 2]);
    }
    expect(minX + maxX).toBeCloseTo(0, 5); // x centered
    expect(minZ + maxZ).toBeCloseTo(0, 5); // z centered
    expect(minY).toBeCloseTo(0, 5);        // keel on water plane
  });

  it('remaps a +z-forward model so its long axis becomes +x', () => {
    // long axis is z:[0,6]; forwardAxis z → after normalize, x span should be 1.
    const zLong = pack([[0, 0, 0], [0, 0, 6], [1, 0, 0], [0, 2, 3]]);
    const { positions } = normalizeToUnit(zLong, { forwardAxis: 'z', upAxis: 'y' });
    let minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < positions.length; i += 3) { minX = Math.min(minX, positions[i]); maxX = Math.max(maxX, positions[i]); }
    expect(maxX - minX).toBeCloseTo(1, 5);
  });

  it('reports the original input bounds', () => {
    const { bounds } = normalizeToUnit(box, { forwardAxis: 'x', upAxis: 'y' });
    expect(bounds.min).toEqual({ x: 0, y: 0, z: 0 });
    expect(bounds.max).toEqual({ x: 4, y: 1, z: 2 });
  });
});
