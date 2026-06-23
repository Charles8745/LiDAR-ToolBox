export interface Vec3 { x: number; y: number; z: number }
export interface Triangle { a: Vec3; b: Vec3; c: Vec3 }

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
