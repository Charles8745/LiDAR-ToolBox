// examples/kaohsiung-port/data/fetch-crane-orient.ts
// Offline crane boom-orientation baker. The authoritative source is a HAND-TRACED land/water boundary
// (data/land-sea-boundary.json, captured in-app via __twin.trace). For each crane:
//   1. QUAY TANGENT = PCA of the nearest boundary points — the drawn edge IS the real coastline, so the
//      boom comes out perpendicular to the actual land (fixes skew the OSM piers / crane-row PCA left).
//   2. WATER SIDE = of the two perpendiculars, the one whose probe (sampled AT the boundary point, where
//      land/water contrast is maximal) lands on the DARKER aerial side. Robust on any shore, any heading.
// Writes per-crane headings to a committed JSON the runtime loads. Run: `npm run port:crane-orient`.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createProjection, KAOHSIUNG_ORIGIN, WORLD_SCALE } from '../geo/projection';
import { boundaryBoomHeading, principalAxisAngle } from '../scene/orient';
import type { LatLon } from './osm';
import basemapMeta from './basemap-khh.json';
import osm from './osm-khh.json';
import boundary from './land-sea-boundary.json';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'crane-orient.json');

const K_BOUNDARY = 4;          // nearest boundary points → local quay tangent (PCA)
const STRONG_OFFSET = 0.5;    // |across-quay offset| (u) above which the crane is clearly inland → geometry decides
const PROBES = [1.5, 3, 4.5]; // world units sampled along each perpendicular for the open-water ray (1u → 40 m)
const RAY_MARGIN = 6;         // min mean-luminance gap between sides for the ray to be conclusive

// Manual water-side corrections (boom += 180°), verified in-app in the 3D scene (__twin.labelCranes).
// These cranes sit on the narrow central peninsula / its inner slip, where the NEAREST traced boundary
// point lies on the opposite quay face, so both the geometry and the short open-water ray pick the wrong
// side and aim the boom into the container yard. Flipping is the honest fix for these few; everything else
// the boundary resolves correctly. Keep this list in sync if the boundary or crane set changes.
const FLIP = new Set([2, 3, 4, 5, 6, 10, 12, 13, 14, 15, 16, 17, 52]);

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
  let geom = 0, ray = 0;
  for (let i = 0; i < centers.length; i++) {
    const c = centers[i];
    let heading = boundaryBoomHeading(c, edge, bright, { k: K_BOUNDARY, strongOffset: STRONG_OFFSET, probes: PROBES, rayMargin: RAY_MARGIN });
    if (FLIP.has(i)) heading += Math.PI;          // manual water-side correction (see FLIP above)
    headings.push(+heading.toFixed(5));
    // Diagnostic: did this crane resolve geometrically (clearly inland) or via the open-water ray?
    const near = edge.map((p) => ({ p, d: (p.x - c.x) ** 2 + (p.z - c.z) ** 2 })).sort((a, b) => a.d - b.d).slice(0, K_BOUNDARY);
    const t = principalAxisAngle(near.map((o) => o.p));
    const mx = near.reduce((s, o) => s + o.p.x, 0) / near.length, mz = near.reduce((s, o) => s + o.p.z, 0) / near.length;
    const perp = Math.abs(Math.cos(t + Math.PI / 2) * (c.x - mx) + Math.sin(t + Math.PI / 2) * (c.z - mz));
    if (perp >= STRONG_OFFSET) geom++; else ray++;
  }
  await writeFile(OUT, JSON.stringify({ source: 'hand-traced land/water boundary (PCA tangent + geometry/open-water-ray side) + manual 3D-verified flips', count: headings.length, headings }));
  console.log(`✓ crane-orient.json: ${headings.length} headings from ${edge.length}-pt boundary (${geom} geometric, ${ray} open-water-ray, ${FLIP.size} manual flips)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
