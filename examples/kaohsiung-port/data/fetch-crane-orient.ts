// examples/kaohsiung-port/data/fetch-crane-orient.ts
// Offline crane boom-orientation baker. For each crane:
//   1. QUAY TANGENT — from the crane ROW itself (PCA of the crane + its nearest crane neighbours). STS cranes
//      are installed in straight lines along the wharf, so the row IS the quay edge → adjacent cranes come out
//      parallel and the boom perpendicular to the real quay (no skew). A tight CLUSTER (low PCA linearity, e.g.
//      the 4-crane west blob) has no reliable row direction, so it falls back to the PCA tangent of the nearest
//      hand-traced boundary points (data/land-sea-boundary.json, captured in-app via __twin.trace).
//   2. WATER SIDE — of the two perpendiculars, the water-ward one: an open-water brightness ray (darker aerial
//      side = water), with the boundary geometry as the tie-breaker. See scene/orient.ts waterwardPerp.
// Writes per-crane headings to a committed JSON the runtime loads. Run: `npm run port:crane-orient`.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createProjection, KAOHSIUNG_ORIGIN, WORLD_SCALE } from '../geo/projection';
import { craneRowAxis, principalAxisAngle, waterwardPerp } from '../scene/orient';
import type { LatLon } from './osm';
import basemapMeta from './basemap-khh.json';
import osm from './osm-khh.json';
import boundary from './land-sea-boundary.json';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'crane-orient.json');

const K_ROW = 4;             // crane neighbours → local quay tangent (PCA); cranes line up along the wharf
const RATIO_MIN = 80;        // row eigen-ratio at/above which the cranes form a clean ROW (trust its tangent);
                            // below ⇒ a tight cluster with no reliable row → fall back to the boundary tangent
const K_BOUNDARY = 4;        // nearest boundary points → fallback quay tangent (PCA) for cluster cranes
const PROBES = [2, 4, 6, 8]; // world units sampled along each perpendicular for the open-water ray (1u → 40 m)
const RAY_MARGIN = 6;        // min mean-luminance gap between sides for the ray to beat the geometry tie-breaker

export async function main(): Promise<void> {
  const proj = createProjection(KAOHSIUNG_ORIGIN.lat, KAOHSIUNG_ORIGIN.lon, WORLD_SCALE);
  const b = basemapMeta.bounds;
  const sw = proj.toWorld(b.s, b.w), ne = proj.toWorld(b.n, b.e); // plane corners (matches main.ts buildBasemapPlane)

  // Decode the committed basemap to a raw RGB buffer.
  const buf = await readFile(join(HERE, 'basemap-khh.jpg'));
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, CH = info.channels;

  /** Average aerial brightness (0–255) near world (wx,wz); 255 (bright/land) if outside the basemap. */
  const bright = (wx: number, wz: number): number => {
    const u = (wx - sw.x) / (ne.x - sw.x);          // 0 at west, 1 at east
    const v = (sw.z - wz) / (sw.z - ne.z);          // 0 at south, 1 at north
    if (u < 0 || u > 1 || v < 0 || v > 1) return 255;
    const col = Math.min(W - 1, Math.max(0, Math.round(u * W)));
    const row = Math.min(H - 1, Math.max(0, Math.round((1 - v) * H))); // image row 0 = north (top)
    let s = 0, n = 0;
    for (let dy = -5; dy <= 5; dy += 2) for (let dx = -5; dx <= 5; dx += 2) {
      const x = col + dx, y = row + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = (y * W + x) * CH;
      s += (data[i] + data[i + 1] + data[i + 2]) / 3; n++;
    }
    return n ? s / n : 255;
  };

  const edge = boundary.points as { x: number; z: number }[];
  const cranes = osm.cranes as unknown as LatLon[];
  const centers = cranes.map((ll) => proj.toWorld(ll.lat, ll.lon));
  const headings: number[] = [];
  let row = 0, bnd = 0;
  for (let i = 0; i < centers.length; i++) {
    const c = centers[i];
    // Tangent: the crane row if it forms a clean line, else the nearest hand-traced boundary points.
    const ra = craneRowAxis(i, centers, K_ROW);
    let tangent: number;
    if (ra.ratio >= RATIO_MIN) { tangent = ra.angle; row++; }
    else {
      const near = edge.map((p) => ({ p, d: (p.x - c.x) ** 2 + (p.z - c.z) ** 2 })).sort((a, b) => a.d - b.d).slice(0, K_BOUNDARY);
      tangent = principalAxisAngle(near.map((o) => o.p)); bnd++;
    }
    const heading = waterwardPerp(c, tangent, edge, bright, { probes: PROBES, rayMargin: RAY_MARGIN });
    headings.push(+heading.toFixed(5));
  }
  await writeFile(OUT, JSON.stringify({ source: 'crane-row PCA tangent (boundary-PCA fallback for clusters) + open-water-ray water side', count: headings.length, headings }));
  console.log(`✓ crane-orient.json: ${headings.length} headings (${row} crane-row tangent, ${bnd} boundary fallback) from ${edge.length}-pt boundary`);
}

main().catch((e) => { console.error(e); process.exit(1); });
