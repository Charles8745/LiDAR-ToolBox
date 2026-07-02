// examples/kaohsiung-port/data/fetch-ship-models.ts
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { dirname, join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Group } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { collectTriangles } from '../scene/meshTriangles';
import { surfaceSample, sliceSample, voxelDownsample, normalizeToUnit, mulberry32, type Axis } from '../scene/meshSampling';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = join(HERE, 'models');
const OUT_DIR = join(HERE, 'ship-models');

interface BakeCfg {
  forwardAxis: Axis; upAxis: Axis; signForward: 1 | -1; seed: number;
  sampling: 'surface' | 'slice';
  count: number;              // 'surface': total points (area-weighted)
  layers: number;             // 'slice': number of cut planes along upAxis
  stepFrac: number;           // 'slice': dense spacing along cut lines = stepFrac × bbox diagonal
  cellFrac: number;           // 'slice': voxel-downsample cell (in NORMALIZED unit space; long axis = 1)
}
// DEFAULT = 'slice' (contour scan-lines): cut the mesh with `layers` horizontal planes along upAxis,
// dot the intersection lines DENSELY (small stepFrac), then VOXEL-downsample (cellFrac) so the points
// are even and clean — preserving hull contour lines + container-stack grid (vs random subsample,
// which scatters the lines back into noise). Reads as a ship, very LiDAR-like.
// ('surface' = area-weighted dots over the whole hull — dormant code path; fuzzy blob at low counts.)
const DEFAULT_CFG: BakeCfg = {
  forwardAxis: 'x', upAxis: 'y', signForward: 1, seed: 1,
  sampling: 'slice', count: 2500, layers: 48, stepFrac: 0.004, cellFrac: 0.012,
};
// Per-source overrides keyed by filename without extension. Adjust forward/up/layers after eyeballing;
// 貨櫃 just uses the slice defaults. Set sampling:'surface' here only if a model genuinely needs it.
// These 7 source models are authored length-along-Z (raw bbox: longest axis = z; 貨櫃 alone is
// length-along-x) → forwardAxis:'z'. Without it the ship bakes rotated 90° and ~8× oversized.
// upAxis stays 'y' (Sketchfab Y-up). cellFrac evens on-screen density toward 貨櫃's proven look.
// Verified raw axes via data/_axes-probe.ts; see §4k.
const MODEL_BAKE_CONFIG: Record<string, Partial<BakeCfg>> = {
  散雜: { forwardAxis: 'z', cellFrac: 0.018 },
  LNG: { forwardAxis: 'z', cellFrac: 0.016 },
  客運: { forwardAxis: 'z', cellFrac: 0.016 },
  油品: { forwardAxis: 'z', cellFrac: 0.014 },
  工作: { forwardAxis: 'z', cellFrac: 0.028 },
  軍艦: { forwardAxis: 'z', cellFrac: 0.014 },
  // 遊艇 (CC-BY-NC yacht): length-along-z; cellFrac 0.024 → ~1237 pts (kept under 1500 budget).
  遊艇: { forwardAxis: 'z', cellFrac: 0.024 },
  // 儲槽 (CC-BY-4.0 Process Storage Tank): 徑向對稱靜態地物,免定向。upAxis=垂直軸讓槽站直、
  // 水平切片成環;forwardAxis=任一水平軸。cellFrac 0.06(0.03→3332 點過多;0.06→925 點,在 1500 預算內)。
  儲槽: { forwardAxis: 'x', upAxis: 'y', cellFrac: 0.06 },
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
  const sampled = cfg.sampling === 'slice'
    ? sliceSample(tris, { axis: cfg.upAxis, layers: cfg.layers, stepFrac: cfg.stepFrac })
    : surfaceSample(tris, cfg.count, mulberry32(cfg.seed));
  const norm = normalizeToUnit(sampled, cfg);
  const bounds = norm.bounds;
  // 'slice' produces a dense, clumpy contour set → voxel-downsample in unit space to even, clean lines.
  const positions = cfg.sampling === 'slice' ? voxelDownsample(norm.positions, cfg.cellFrac) : norm.positions;
  const nPts = positions.length / 3;
  const lengthM = Math.max(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z);
  const out = {
    sourceFile: `models/${file}`,
    sampledAt: new Date().toISOString(),
    sampling: cfg.sampling,
    count: nPts,
    lengthM,
    forwardAxis: cfg.forwardAxis,
    points: Array.from(positions),
  };
  await mkdir(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, `${key}.json`);
  await writeFile(outPath, JSON.stringify(out));
  console.log(`  ✓ ${file} → ship-models/${key}.json (${tris.length} tris → ${cfg.sampling} → ${nPts} pts)`);
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
