import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseOsm } from './osm';

const QUERY = `[out:json][timeout:120];
(
  way["natural"="coastline"](22.53,120.24,22.64,120.34);
  way["man_made"="pier"](22.53,120.24,22.64,120.34);
  way["man_made"="breakwater"](22.53,120.24,22.64,120.34);
  way["man_made"="storage_tank"](22.53,120.24,22.64,120.34);
  node["man_made"="crane"](22.53,120.24,22.64,120.34);
  nwr["seamark:type"="anchorage"](22.53,120.24,22.64,120.34);
);
out geom;`;

const res = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  body: 'data=' + encodeURIComponent(QUERY),
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': 'LiDAR-fetch/1.0',
  },
});
if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
const geo = parseOsm(await res.json());
const here = dirname(fileURLToPath(import.meta.url));
const path = resolve(here, 'osm-khh.json');
writeFileSync(path, JSON.stringify(geo));
console.log(`wrote ${path}: ${geo.coastline.length} coastline, ${geo.piers.length} piers, ${geo.breakwater.length} breakwater, ${geo.tanks.length} tanks, ${geo.cranes.length} cranes, ${geo.anchorages.length} anchorages`);
