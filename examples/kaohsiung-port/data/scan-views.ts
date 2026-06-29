// examples/kaohsiung-port/data/scan-views.ts
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  extractSilhouette, cropToContent, assembleAxes, carveToTemplate,
  type Mask, type CarveCfg, type ViewKind,
} from '../scene/viewCarving';

const HERE = dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = join(HERE, 'models', 'views');
const OUT_DIR = join(HERE, 'ship-models');

export const DEFAULT_CFG: CarveCfg = {
  gridLong: 160, bgTolerance: 32, coverFrac: 0.02, frontMaskMaxHeightFrac: 0.45,
  cellFrac: 0.022, signForward: 1, minPoints: 50,
};
// Per-category overrides (tune after eyeballing in the browser — see plan Task 5).
export const VIEW_BAKE_CONFIG: Record<string, Partial<CarveCfg>> = {
  // dredger: 0.022 → 1570 pts (over the 1500 budget); 0.024 → 1230, still reads as a working vessel.
  工程: { cellFrac: 0.024 },
  // STS gantry crane: front view = open portal (two legs + top beam) → front mask must apply at ALL
  // heights (≠ ships' 0.45 anti-tower carve) to cut the leg gap & boom profile. cellFrac tuned post-bake.
  // top view was captured boom-vertical → rotate 270 (CCW) so boom lies on the x-axis matching side
  // (side has boom-tip on the left/uz=0; rotate 270 sends top-of-image → left). Baked from the 3 clean
  // required views (side/front/top); side2/stern/bottom set aside (same-handedness → mirror-union conflict).
  起重機: { frontMaskMaxHeightFrac: 1.0, cellFrac: 0.024, perView: { top: { rotate: 270 } } },
};

/** Filename keyword → view kind. Order matters: more-specific keywords first. */
export function classifyView(filename: string): ViewKind | null {
  const n = basename(filename, extname(filename)).toLowerCase();
  if (/side2|starboard|stbd/.test(n)) return 'side2';
  if (/bottom|hull|keel/.test(n)) return 'bottom';
  if (/front|bow/.test(n)) return 'front';
  if (/stern|aft|back/.test(n)) return 'stern';
  if (/top|deck|plan/.test(n)) return 'top';
  if (/side|port/.test(n)) return 'side';
  return null;
}

export async function decodeMask(buf: Buffer, bgTolerance: number): Promise<Mask> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgba = new Uint8Array(data.buffer, data.byteOffset, data.byteLength); // RGBA (ensureAlpha → 4ch)
  return extractSilhouette(rgba, info.width, info.height, bgTolerance);
}

/** Decode every view in a category dir, crop, assemble axes (orient + union), carve → template points. */
export async function bakeCategory(viewsDir: string, cfg: CarveCfg): Promise<{ points: number[]; count: number }> {
  const files = await readdir(viewsDir);
  const byKind: Partial<Record<ViewKind, Mask>> = {};
  for (const f of files) {
    if (!/\.(png|jpe?g|webp)$/i.test(f)) continue;
    const kind = classifyView(f);
    if (!kind) continue;
    const raw = await decodeMask(await readFile(join(viewsDir, f)), cfg.bgTolerance);
    byKind[kind] = cropToContent(raw, cfg.coverFrac);
  }
  const { side, top, front } = assembleAxes(byKind, cfg.perView);
  const pts = carveToTemplate(side, top, front, cfg);
  return { points: Array.from(pts), count: pts.length / 3 };
}

export async function main(): Promise<void> {
  let cats: string[] = [];
  try { cats = (await readdir(VIEWS_DIR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name); }
  catch { console.log('No models/views/ dir; nothing to bake.'); return; }
  if (cats.length === 0) { console.log('No category dirs under data/models/views/; drop screenshots and re-run.'); return; }
  console.log(`Carving ${cats.length} category(ies)…`);
  for (const cat of cats) {
    const cfg: CarveCfg = { ...DEFAULT_CFG, ...(VIEW_BAKE_CONFIG[cat] ?? {}) };
    try {
      const { points, count } = await bakeCategory(join(VIEWS_DIR, cat), cfg);
      const out = { sourceFile: `models/views/${cat}`, sampledAt: new Date().toISOString(), sampling: 'visual-hull', count, lengthM: null, forwardAxis: 'z', points };
      await mkdir(OUT_DIR, { recursive: true });
      await writeFile(join(OUT_DIR, `${cat}.json`), JSON.stringify(out));
      console.log(`  ✓ ${cat} → ship-models/${cat}.json (${count} pts)`);
    } catch (e) { console.error(`  ! ${cat}: ${(e as Error).message}`); }
  }
  console.log('Done.');
}
