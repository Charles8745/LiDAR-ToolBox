import { writeFileSync, renameSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseGetMarker, upsertBerths, type BerthMarker } from './berthGeometry';

const ENDPOINT = 'https://sdci.twport.com.tw/khbweb/osmx2.aspx/GetMarker';

/** POST GetMarker, unwrap the double-encoded `{d:"<json>"}`, return the inner object. */
async function fetchGetMarker(): Promise<{ v?: unknown[] }> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: '{}',
      });
      if (!res.ok) throw new Error(`GetMarker HTTP ${res.status}`);
      const outer = (await res.json()) as { d?: string };
      if (!outer.d) throw new Error('GetMarker: missing `d`');
      return JSON.parse(outer.d) as { v?: unknown[] };
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastErr;
}

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, 'berths-khh.json');

// Accumulate: load existing berths as union seed (GetMarker only returns currently-occupied
// berths each call; running this repeatedly grows coverage toward the full set).
const union = new Map<string, BerthMarker>();
if (existsSync(outPath)) {
  try {
    const prev = JSON.parse(readFileSync(outPath, 'utf8')) as { berths?: BerthMarker[] };
    if (Array.isArray(prev.berths)) upsertBerths(union, prev.berths);
    console.log(`resuming from ${outPath}: ${union.size} berths in union`);
  } catch {
    console.warn(`existing ${outPath} unreadable; starting fresh`);
  }
}

const capturedAtMs = Date.now();
const fresh = parseGetMarker(await fetchGetMarker());
upsertBerths(union, fresh);
const berths = [...union.values()].sort((a, b) => a.code.localeCompare(b.code));

mkdirSync(here, { recursive: true });
const tmp = `${outPath}.tmp`;
writeFileSync(tmp, JSON.stringify({ capturedAtMs, berths }, null, 2));
renameSync(tmp, outPath);
console.log(`wrote ${outPath}: +${fresh.length} this run, ${berths.length} total distinct berths`);
