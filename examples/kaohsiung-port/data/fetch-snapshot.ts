import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fetchTwportSnapshot } from './twport-fetch';

const here = dirname(fileURLToPath(import.meta.url));

// Stamp capturedAtMs BEFORE fetches — it represents the snapshot's reference "now".
const capturedAtMs = Date.now();
const { berthing, forecast } = await fetchTwportSnapshot();
const out = { capturedAtMs, berthing, forecast };

const dir = resolve(here, 'snapshots');
mkdirSync(dir, { recursive: true });
const date = new Date(capturedAtMs).toISOString().slice(0, 10);
const path = resolve(dir, `khh-${date}.json`);
writeFileSync(path, JSON.stringify(out, null, 2));
console.log(`wrote ${path}: ${berthing.length} berthing, ${forecast.length} forecast`);
