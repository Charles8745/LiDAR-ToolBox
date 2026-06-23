// examples/kaohsiung-port/data/fetch-ship-models.ts
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { dirname, join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Group } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { collectTriangles } from '../scene/meshTriangles';
import { surfaceSample, normalizeToUnit, mulberry32, type Axis } from '../scene/meshSampling';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = join(HERE, 'models');
const OUT_DIR = join(HERE, 'ship-models');

interface BakeCfg { forwardAxis: Axis; upAxis: Axis; signForward: 1 | -1; count: number; seed: number }
// count 300 ≈ 8× 現有平面 footprint(大船 ~39 點),足夠 orbit 有體積感又不擠爆 shipPC
// 的 300k 容量(見 Global Constraints 的點數預算)。小船型可在下方 override 調更低。
const DEFAULT_CFG: BakeCfg = { forwardAxis: 'x', upAxis: 'y', signForward: 1, count: 300, seed: 1 };
// Per-source overrides keyed by filename without extension. Adjust forward/up after eyeballing.
const MODEL_BAKE_CONFIG: Record<string, Partial<BakeCfg>> = {
  // 貨櫃: { forwardAxis: 'z', count: 800 },
};

function parseGlb(buf: ArrayBuffer): Promise<Group> {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(buf, '', (gltf) => resolve(gltf.scene), reject);
  });
}

async function bakeOne(file: string): Promise<void> {
  const key = basename(file, extname(file));
  const cfg = { ...DEFAULT_CFG, ...(MODEL_BAKE_CONFIG[key] ?? {}) };
  const buf = await readFile(join(MODELS_DIR, file));
  const scene = await parseGlb(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const tris = collectTriangles(scene);
  if (tris.length === 0) { console.warn(`  ! ${file}: no triangles, skipped`); return; }
  const sampled = surfaceSample(tris, cfg.count, mulberry32(cfg.seed));
  const { positions, bounds } = normalizeToUnit(sampled, cfg);
  const lengthM = Math.max(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z);
  const out = {
    sourceFile: `models/${file}`,
    sampledAt: new Date().toISOString(),
    count: cfg.count,
    lengthM,
    forwardAxis: cfg.forwardAxis,
    points: Array.from(positions),
  };
  await mkdir(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, `${key}.json`);
  await writeFile(outPath, JSON.stringify(out));
  console.log(`  ✓ ${file} → ship-models/${key}.json (${tris.length} tris → ${cfg.count} pts)`);
}

async function main(): Promise<void> {
  let files: string[] = [];
  try { files = (await readdir(MODELS_DIR)).filter((f) => extname(f).toLowerCase() === '.glb'); }
  catch { console.log('No models/ dir; nothing to bake.'); return; }
  if (files.length === 0) { console.log('No .glb files in data/models/; drop a model and re-run.'); return; }
  console.log(`Baking ${files.length} model(s)…`);
  for (const f of files) await bakeOne(f);
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
