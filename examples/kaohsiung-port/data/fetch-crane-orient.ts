// examples/kaohsiung-port/data/fetch-crane-orient.ts
// Offline crane boom-orientation baker. The OSM land-density water-side heuristic is unreliable in
// Kaohsiung (narrow two-bank harbour; inland container yards are featureless in OSM → indistinguishable
// from open channel). Instead, sample the committed NLSC aerial basemap (water = dark) along each
// pier-perpendicular and point the boom toward the darker (water) side. Writes per-crane headings to a
// committed JSON the runtime loads. Run: `npm run port:crane-orient`.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createProjection, KAOHSIUNG_ORIGIN, WORLD_SCALE } from '../geo/projection';
import { buildPierSegs, nearestPierTangent } from '../scene/orient';
import type { LatLon, Polyline } from './osm';
import basemapMeta from './basemap-khh.json';
import osm from './osm-khh.json';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'crane-orient.json');

// Probe distances (world units; WORLD_SCALE 0.025 → 1u = 40 m) out along each perpendicular.
const PROBES = [2, 3, 4, 5];

export async function main(): Promise<void> {
  const proj = createProjection(KAOHSIUNG_ORIGIN.lat, KAOHSIUNG_ORIGIN.lon, WORLD_SCALE);
  const b = basemapMeta.bounds;
  const sw = proj.toWorld(b.s, b.w), ne = proj.toWorld(b.n, b.e); // plane corners (matches main.ts buildBasemapPlane)

  // Decode the committed basemap to a raw RGB buffer.
  const buf = await readFile(join(HERE, 'basemap-khh.jpg'));
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, CH = info.channels;

  /** Average aerial brightness (0–255) near world (wx,wz); null if outside the basemap. */
  const bright = (wx: number, wz: number): number | null => {
    const u = (wx - sw.x) / (ne.x - sw.x);          // 0 at west, 1 at east
    const v = (sw.z - wz) / (sw.z - ne.z);          // 0 at south, 1 at north
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    const col = Math.min(W - 1, Math.max(0, Math.round(u * W)));
    const row = Math.min(H - 1, Math.max(0, Math.round((1 - v) * H))); // image row 0 = north (top)
    let s = 0, n = 0;
    for (let dy = -5; dy <= 5; dy += 2) for (let dx = -5; dx <= 5; dx += 2) {
      const x = col + dx, y = row + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = (y * W + x) * CH;
      s += (data[i] + data[i + 1] + data[i + 2]) / 3; n++;
    }
    return n ? s / n : null;
  };

  /** Mean brightness sampled along a heading from a center (skips off-map probes). */
  const rayBrightness = (cx: number, cz: number, heading: number): number => {
    const dx = Math.cos(heading), dz = Math.sin(heading);
    let s = 0, n = 0;
    for (const t of PROBES) { const v = bright(cx + dx * t, cz + dz * t); if (v != null) { s += v; n++; } }
    return n ? s / n : Infinity; // all-off-map → treat as bright (not water)
  };

  const segs = buildPierSegs(osm.piers as unknown as Polyline[], proj);
  const cranes = osm.cranes as unknown as LatLon[];
  const headings: number[] = [];
  let darkN = 0, brightN = 0;
  for (const ll of cranes) {
    const c = proj.toWorld(ll.lat, ll.lon);
    const tangent = nearestPierTangent(c.x, c.z, segs).headingRad;
    const hPlus = tangent + Math.PI / 2, hMinus = tangent - Math.PI / 2;
    const bPlus = rayBrightness(c.x, c.z, hPlus), bMinus = rayBrightness(c.x, c.z, hMinus);
    // boom points toward the DARKER (water) side; template +x is aimed along this heading at runtime.
    const heading = bPlus <= bMinus ? hPlus : hMinus;
    headings.push(+heading.toFixed(5));
    if (Math.min(bPlus, bMinus) < 110) darkN++; else brightN++;
  }
  await writeFile(OUT, JSON.stringify({ source: 'basemap-khh.jpg brightness', count: headings.length, headings }));
  console.log(`✓ crane-orient.json: ${headings.length} headings (water-side from aerial; ${darkN} have a clear dark/water side, ${brightN} weak signal)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
