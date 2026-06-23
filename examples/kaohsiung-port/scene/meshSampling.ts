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

/**
 * Randomly downsample a packed xyz point set to `target` points (seeded → reproducible).
 * Returns the input unchanged when it already has ≤ target points. Used to cap the dense
 * output of sliceSample while keeping the points on their contour lines.
 */
export function subsample(positions: Float32Array, target: number, rng: () => number): Float32Array {
  const n = positions.length / 3;
  if (target >= n || target <= 0) return positions;
  // Partial Fisher–Yates over indices [0..n) to pick `target` distinct points.
  const idx = new Int32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  for (let i = 0; i < target; i++) {
    const j = i + Math.floor(rng() * (n - i));
    const tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp;
  }
  const out = new Float32Array(target * 3);
  for (let i = 0; i < target; i++) {
    const s = idx[i] * 3;
    out[i * 3] = positions[s]; out[i * 3 + 1] = positions[s + 1]; out[i * 3 + 2] = positions[s + 2];
  }
  return out;
}

/**
 * Voxel-grid downsample: snap every point to a `cell`-sized 3D grid and keep one point per
 * occupied cell. Unlike random subsample (which scatters structured lines back into noise), this
 * yields an evenly-spaced cloud that PRESERVES structure — clean contour lines stay clean lines.
 * Deterministic (keeps the first point seen per cell).
 */
export function voxelDownsample(positions: Float32Array, cell: number): Float32Array {
  const n = positions.length / 3;
  if (n === 0 || cell <= 0) return positions;
  const seen = new Set<string>();
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const key = `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(x, y, z);
  }
  return Float32Array.from(out);
}

export interface SliceOpts { axis: Axis; layers: number; stepFrac: number }

/**
 * Contour ("scan-line") sampling: cut the mesh with `layers` planes evenly spaced along `axis`,
 * and for every triangle the plane crosses, sample points along the intersection segment at a
 * world step = `stepFrac` × bbox diagonal. Unlike surfaceSample (which fills flat faces), this
 * concentrates points on each layer's boundary — the outer silhouette plus internal feature edges
 * (e.g. a ship's hull lines + stacked-container grid) — giving a far more readable shape.
 */
export function sliceSample(tris: Triangle[], opts: SliceOpts): Float32Array {
  if (tris.length === 0 || opts.layers < 1) return new Float32Array(0);
  const ai = AXES.indexOf(opts.axis);
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  const vget = (v: Vec3): number[] => [v.x, v.y, v.z];
  for (const t of tris) for (const v of [t.a, t.b, t.c]) {
    const a = vget(v);
    for (let k = 0; k < 3; k++) { if (a[k] < mn[k]) mn[k] = a[k]; if (a[k] > mx[k]) mx[k] = a[k]; }
  }
  const span = mx[ai] - mn[ai];
  if (span <= 0) return new Float32Array(0);
  const diag = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
  const step = Math.max(diag * opts.stepFrac, 1e-6);
  const out: number[] = [];
  for (let L = 0; L < opts.layers; L++) {
    const plane = mn[ai] + span * ((L + 0.5) / opts.layers); // mid-of-band, avoids exact min/max edges
    for (const t of tris) {
      const verts = [vget(t.a), vget(t.b), vget(t.c)];
      const d = [verts[0][ai] - plane, verts[1][ai] - plane, verts[2][ai] - plane];
      const cps: number[][] = [];
      for (let e = 0; e < 3; e++) {
        const i = e, j = (e + 1) % 3;
        if ((d[i] < 0 && d[j] >= 0) || (d[i] >= 0 && d[j] < 0)) {
          const s = d[i] / (d[i] - d[j]);
          cps.push([
            verts[i][0] + (verts[j][0] - verts[i][0]) * s,
            verts[i][1] + (verts[j][1] - verts[i][1]) * s,
            verts[i][2] + (verts[j][2] - verts[i][2]) * s,
          ]);
        }
      }
      if (cps.length !== 2) continue; // a clean crossing yields exactly 2 edge intersections
      const [p, q] = cps;
      const len = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
      const segN = Math.max(1, Math.round(len / step));
      for (let s = 0; s <= segN; s++) {
        const f = s / segN;
        out.push(p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f);
      }
    }
  }
  return Float32Array.from(out);
}
