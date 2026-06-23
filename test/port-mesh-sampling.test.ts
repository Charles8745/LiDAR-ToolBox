import { describe, it, expect } from 'vitest';
import { mulberry32, surfaceSample, normalizeToUnit, sliceSample, subsample, voxelDownsample, type Triangle } from '../examples/kaohsiung-port/scene/meshSampling';

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

describe('sliceSample', () => {
  // A vertical wall in the z=0 plane spanning x:[0,2], y:[0,2] (two triangles).
  const wall: Triangle[] = [
    { a: { x: 0, y: 0, z: 0 }, b: { x: 2, y: 0, z: 0 }, c: { x: 2, y: 2, z: 0 } },
    { a: { x: 0, y: 0, z: 0 }, b: { x: 2, y: 2, z: 0 }, c: { x: 0, y: 2, z: 0 } },
  ];

  it('emits points on horizontal cut lines (constant y) lying on the wall (z≈0, x in [0,2])', () => {
    const out = sliceSample(wall, { axis: 'y', layers: 4, stepFrac: 0.2 });
    expect(out.length).toBeGreaterThan(0);
    const ys = new Set<number>();
    for (let i = 0; i < out.length; i += 3) {
      expect(Math.abs(out[i + 2])).toBeLessThan(1e-6);        // z ≈ 0 (on the wall)
      expect(out[i]).toBeGreaterThanOrEqual(-1e-6);           // x within [0,2]
      expect(out[i]).toBeLessThanOrEqual(2 + 1e-6);
      ys.add(Math.round(out[i + 1] * 1000) / 1000);
    }
    expect(ys.size).toBe(4); // one distinct cut height per layer
  });

  it('is deterministic (no rng) — identical output across calls', () => {
    const a = sliceSample(wall, { axis: 'y', layers: 5, stepFrac: 0.25 });
    const b = sliceSample(wall, { axis: 'y', layers: 5, stepFrac: 0.25 });
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('returns empty for zero layers or empty input', () => {
    expect(sliceSample(wall, { axis: 'y', layers: 0, stepFrac: 0.2 }).length).toBe(0);
    expect(sliceSample([], { axis: 'y', layers: 4, stepFrac: 0.2 }).length).toBe(0);
  });
});

describe('subsample', () => {
  // 10 points packed as xyz
  const pts = new Float32Array(Array.from({ length: 30 }, (_, i) => i));

  it('caps to target count, keeping whole xyz triples from the source', () => {
    const out = subsample(pts, 4, mulberry32(1));
    expect(out.length).toBe(12); // 4 points
    for (let i = 0; i < out.length; i += 3) {
      const x = out[i];
      expect(x % 3).toBe(0);                 // x of a source point is a multiple of 3 (index*3)
      expect(out[i + 1]).toBe(x + 1);        // triple stayed intact
      expect(out[i + 2]).toBe(x + 2);
    }
  });

  it('returns input unchanged when target ≥ count', () => {
    expect(subsample(pts, 10, mulberry32(1))).toBe(pts);
    expect(subsample(pts, 99, mulberry32(1))).toBe(pts);
  });

  it('is deterministic for a given seed', () => {
    expect(Array.from(subsample(pts, 5, mulberry32(7)))).toEqual(Array.from(subsample(pts, 5, mulberry32(7))));
  });
});

describe('voxelDownsample', () => {
  it('keeps one point per occupied grid cell', () => {
    // 10 points along x at 0,0.1,...,0.9 (y=z=0); cell 0.5 → 2 occupied cells.
    const line = new Float32Array(30);
    for (let i = 0; i < 10; i++) { line[i * 3] = i * 0.1; }
    const out = voxelDownsample(line, 0.5);
    expect(out.length).toBe(6); // 2 points
  });

  it('preserves distinct cells (no over-merging) and is idempotent', () => {
    const line = new Float32Array(30);
    for (let i = 0; i < 10; i++) { line[i * 3] = i * 0.1; }
    const once = voxelDownsample(line, 0.25); // cells 0,0,0 | ... → 0..0.225, .25.., .5.., .75.. = 4 cells
    expect(once.length).toBe(12);
    expect(Array.from(voxelDownsample(once, 0.25))).toEqual(Array.from(once)); // idempotent
  });

  it('returns input unchanged for non-positive cell', () => {
    const a = new Float32Array([1, 2, 3]);
    expect(voxelDownsample(a, 0)).toBe(a);
  });
});
