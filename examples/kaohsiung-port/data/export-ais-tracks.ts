import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildTracksFile, type AisPing } from './ais';

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, 'ais-tracks');

// 取最新的 raw-khh-*.jsonl(或由 argv[2] 指定檔名)
const arg = process.argv[2];
const file = arg ?? readdirSync(dir).filter((f) => f.startsWith('raw-khh-') && f.endsWith('.jsonl')).sort().pop();
if (!file) throw new Error(`no raw-khh-*.jsonl in ${dir} — run \`npm run port:ais:record\` first`);

const pings: AisPing[] = [];
for (const line of readFileSync(resolve(dir, file), 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const rec = JSON.parse(line) as { pings: AisPing[] };
  if (Array.isArray(rec.pings)) pings.push(...rec.pings);
}

const out = buildTracksFile(pings);
const date = file.replace('raw-khh-', '').replace('.jsonl', '');
const outPath = resolve(dir, `khh-${date}.json`);
writeFileSync(outPath, JSON.stringify(out));
console.log(`wrote ${outPath}: ${out.ships.length} ships, ${new Date(out.meta.fromMs).toISOString()}–${new Date(out.meta.toMs).toISOString()}`);
