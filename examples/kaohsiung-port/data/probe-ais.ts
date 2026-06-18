import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const URL = 'https://mpbais.motcmpb.gov.tw/aismpb/tools/geojsonais.ashx';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/json,text/javascript,*/*;q=0.01',
  Referer: 'https://mpbais.motcmpb.gov.tw/',
};

const res = await fetch(URL, { headers: HEADERS });
const text = await res.text();
let doc: any;
try { doc = JSON.parse(text); } catch { throw new Error(`非 JSON 回應(前 200 字):${text.slice(0, 200)}`); }

const feats: any[] = Array.isArray(doc.features) ? doc.features : [];
console.log(`HTTP ${res.status} · totalFeatures=${doc.totalFeatures ?? '?'} · features=${feats.length}`);
if (feats.length > 0) {
  const f = feats[0];
  console.log('geometry:', JSON.stringify(f.geometry));
  console.log('property keys:', Object.keys(f.properties ?? {}).join(', '));
  console.log('first feature properties:', JSON.stringify(f.properties, null, 2));
}

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, 'ais-tracks');
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, '_probe-sample.json'), JSON.stringify(doc, null, 2).slice(0, 200_000));
console.log(`wrote ${resolve(dir, '_probe-sample.json')}`);
