import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';
import { tileRangeForBbox, compositeBounds, TILE_SIZE, type Bbox } from '../geo/tiles';

const BBOX: Bbox = { s: 22.53, w: 120.24, n: 22.64, e: 120.34 };
const Z = 15;
const LAYER = 'PHOTO2';
const tileUrl = (z: number, x: number, y: number) =>
  `https://wmts.nlsc.gov.tw/wmts/${LAYER}/default/GoogleMapsCompatible/${z}/${y}/${x}`;

async function fetchTile(z: number, x: number, y: number): Promise<Buffer> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(tileUrl(z, x, y), { headers: { 'User-Agent': 'LiDAR-fetch/1.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      lastErr = e;
      console.warn(`retry ${attempt + 1}/3 tile z=${z} x=${x} y=${y}: ${e}`);
      await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
    }
  }
  throw new Error(`tile ${z}/${y}/${x} failed after 3 attempts: ${lastErr}`);
}

const range = tileRangeForBbox(BBOX, Z);
const { bounds, sizePx } = compositeBounds(range, Z);

const layers: sharp.OverlayOptions[] = [];
// First iteration (xMin,yMin = NW tile) doubles as the fail-fast zoom-availability probe.
for (let x = range.xMin; x <= range.xMax; x++) {
  for (let y = range.yMin; y <= range.yMax; y++) {
    const buf = await fetchTile(Z, x, y);
    layers.push({ input: buf, left: (x - range.xMin) * TILE_SIZE, top: (y - range.yMin) * TILE_SIZE });
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const imgPath = resolve(here, 'basemap-khh.jpg');
const metaPath = resolve(here, 'basemap-khh.json');

await sharp({ create: { width: sizePx.w, height: sizePx.h, channels: 3, background: { r: 0, g: 0, b: 0 } } })
  .composite(layers)
  .jpeg({ quality: 85 })
  .toFile(imgPath);

writeFileSync(metaPath, JSON.stringify(
  { z: Z, layer: LAYER, bbox: BBOX, tileRange: range, bounds, sizePx, source: 'NLSC PHOTO2 WMTS · 內政部國土測繪中心' },
  null, 2,
));

console.log(`wrote ${imgPath} (${sizePx.w}x${sizePx.h}px, ${layers.length} tiles) and ${metaPath}`);
