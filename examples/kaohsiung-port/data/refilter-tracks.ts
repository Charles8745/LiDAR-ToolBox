import { readFileSync, writeFileSync, readdirSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { refilterTracksFile, type AisTracksFile } from './ais';

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, 'ais-tracks');

// argv[2] = specific filename, else every committed khh-*.json (skip raw-/_probe).
const arg = process.argv[2];
const files = arg
  ? [arg]
  : readdirSync(dir).filter((f) => f.startsWith('khh-') && f.endsWith('.json'));
if (files.length === 0) throw new Error(`no khh-*.json in ${dir}`);

for (const f of files) {
  const path = resolve(dir, f);
  const before = JSON.parse(readFileSync(path, 'utf8')) as AisTracksFile;
  const { file, dropped } = refilterTracksFile(before);
  const total = Object.values(dropped).reduce((a, b) => a + b, 0);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(file));
  renameSync(tmp, path);
  console.log(
    `${f}: ${before.ships.length} → ${file.ships.length} ships ` +
    `(dropped ${total}: ${JSON.stringify(dropped)})`,
  );
}
