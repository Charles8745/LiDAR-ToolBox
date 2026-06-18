import { appendFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseAisFeature, inKaohsiungBBox, type AisPing } from './ais';

const URL = 'https://mpbais.motcmpb.gov.tw/aismpb/tools/geojsonais.ashx';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/json,text/javascript,*/*;q=0.01',
  Referer: 'https://mpbais.motcmpb.gov.tw/',
};
const POLL_MS = Number(process.env.AIS_POLL_MS ?? 30_000);

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, 'ais-tracks');
mkdirSync(dir, { recursive: true });
const date = new Date().toISOString().slice(0, 10);
const outPath = resolve(dir, `raw-khh-${date}.jsonl`);

let backoff = POLL_MS;
async function pollOnce(): Promise<void> {
  const polledAtMs = Date.now();
  const res = await fetch(URL, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const doc = JSON.parse(await res.text()) as { features?: unknown[] };
  const feats = Array.isArray(doc.features) ? doc.features : [];
  const pings: AisPing[] = [];
  for (const f of feats) {
    const p = parseAisFeature(f);
    if (!p) continue;
    if (!inKaohsiungBBox(p.lat, p.lon)) continue;
    if (!p.recordedAtMs) p.recordedAtMs = polledAtMs; // 備援:無定位時間用輪詢時間
    pings.push(p);
  }
  appendFileSync(outPath, JSON.stringify({ polledAtMs, pings }) + '\n');
  console.log(`${new Date(polledAtMs).toISOString()}  +${pings.length} pings → ${outPath}`);
}

console.log(`recording KHH AIS every ${POLL_MS / 1000}s → ${outPath}  (Ctrl-C to stop)`);
// 韌性 loop:錯誤指數退避、永不退出。
for (;;) {
  try {
    await pollOnce();
    backoff = POLL_MS;
  } catch (e) {
    console.warn(`poll failed: ${(e as Error).message}; retry in ${Math.round(backoff / 1000)}s`);
    backoff = Math.min(backoff * 2, 5 * 60_000);
  }
  await new Promise((r) => setTimeout(r, backoff));
}
