export interface Vec3 { x: number; y: number; z: number }
export interface Triangle { a: Vec3; b: Vec3; c: Vec3 }
export type Axis = 'x' | 'y' | 'z';
export interface Bounds { min: Vec3; max: Vec3; center: Vec3 }
export interface NormalizeOpts { forwardAxis: Axis; upAxis: Axis; signForward?: 1 | -1 }

/** Small fast seeded PRNG → reproducible bakes / stable git diffs. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function triArea(t: Triangle): number {
  const ux = t.b.x - t.a.x, uy = t.b.y - t.a.y, uz = t.b.z - t.a.z;
  const vx = t.c.x - t.a.x, vy = t.c.y - t.a.y, vz = t.c.z - t.a.z;
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  return 0.5 * Math.hypot(cx, cy, cz);
}

/** Area-weighted uniform surface sampling. `count` points, xyz packed. */
export function surfaceSample(tris: Triangle[], count: number, rng: () => number): Float32Array {
  const out = new Float32Array(Math.max(0, count) * 3);
  if (tris.length === 0 || count <= 0) return out;
  // Build cumulative-area CDF.
  const cdf = new Float64Array(tris.length);
  let acc = 0;
  for (let i = 0; i < tris.length; i++) { acc += triArea(tris[i]); cdf[i] = acc; }
  const total = acc || 1;
  for (let n = 0; n < count; n++) {
    // Pick a triangle weighted by area (linear scan; tri counts are modest).
    const target = rng() * total;
    let ti = 0;
    while (ti < tris.length - 1 && cdf[ti] < target) ti++;
    const t = tris[ti];
    // Uniform barycentric point: sqrt(r1) keeps it uniform over the area.
    let r1 = rng(), r2 = rng();
    const su = Math.sqrt(r1);
    const b0 = 1 - su, b1 = su * (1 - r2), b2 = su * r2;
    out[n * 3] = b0 * t.a.x + b1 * t.b.x + b2 * t.c.x;
    out[n * 3 + 1] = b0 * t.a.y + b1 * t.b.y + b2 * t.c.y;
    out[n * 3 + 2] = b0 * t.a.z + b1 * t.b.z + b2 * t.c.z;
  }
  return out;
}

const AXES: Axis[] = ['x', 'y', 'z'];
function readAxis(arr: Float32Array, i: number, ax: Axis): number {
  return arr[i + AXES.indexOf(ax)];
}

/**
 * Rotate model so forwardAxis→+x, upAxis→+y (third axis→+z by remap), uniform-scale the
 * long (x) axis span to 1, then translate to x/z-centered with min-y=0 (keel on y=0).
 * `bounds` returned is the ORIGINAL input bbox.
 */
export function normalizeToUnit(positions: Float32Array, opts: NormalizeOpts): { positions: Float32Array; bounds: Bounds } {
  const sign = opts.signForward ?? 1;
  // remaining axis = the one that is neither forward nor up → becomes z
  const sideAxis = AXES.find((a) => a !== opts.forwardAxis && a !== opts.upAxis)!;

  // Remap into x=forward, y=up, z=side.
  const remapped = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    remapped[i] = sign * readAxis(positions, i, opts.forwardAxis);
    remapped[i + 1] = readAxis(positions, i, opts.upAxis);
    remapped[i + 2] = readAxis(positions, i, sideAxis);
  }

  // Bounds of remapped to compute scale/translate; original bounds tracked separately.
  let rMinX = Infinity, rMaxX = -Infinity, rMinY = Infinity, rMinZ = Infinity, rMaxZ = -Infinity;
  let oMinX = Infinity, oMinY = Infinity, oMinZ = Infinity, oMaxX = -Infinity, oMaxY = -Infinity, oMaxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    rMinX = Math.min(rMinX, remapped[i]); rMaxX = Math.max(rMaxX, remapped[i]);
    rMinY = Math.min(rMinY, remapped[i + 1]);
    rMinZ = Math.min(rMinZ, remapped[i + 2]); rMaxZ = Math.max(rMaxZ, remapped[i + 2]);
    oMinX = Math.min(oMinX, positions[i]); oMaxX = Math.max(oMaxX, positions[i]);
    oMinY = Math.min(oMinY, positions[i + 1]); oMaxY = Math.max(oMaxY, positions[i + 1]);
    oMinZ = Math.min(oMinZ, positions[i + 2]); oMaxZ = Math.max(oMaxZ, positions[i + 2]);
  }
  const lenX = rMaxX - rMinX || 1;
  const scale = 1 / lenX;
  const cx = (rMinX + rMaxX) / 2, cz = (rMinZ + rMaxZ) / 2;

  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    out[i] = (remapped[i] - cx) * scale;
    out[i + 1] = (remapped[i + 1] - rMinY) * scale; // min-y → 0
    out[i + 2] = (remapped[i + 2] - cz) * scale;
  }
  return {
    positions: out,
    bounds: {
      min: { x: oMinX, y: oMinY, z: oMinZ },
      max: { x: oMaxX, y: oMaxY, z: oMaxZ },
      center: { x: (oMinX + oMaxX) / 2, y: (oMinY + oMaxY) / 2, z: (oMinZ + oMaxZ) / 2 },
    },
  };
}
