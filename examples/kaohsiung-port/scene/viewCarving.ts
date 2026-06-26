// examples/kaohsiung-port/scene/viewCarving.ts
// normalizeToUnit/voxelDownsample are consumed in Task 3 (carveToTemplate). Until then this import
// is unused; @ts-expect-error self-enforces removal of this line once Task 3 wires them in.
// @ts-expect-error TS6192 forward-referenced import; delete this directive when the functions are used
import { normalizeToUnit, voxelDownsample } from './meshSampling';

export interface Mask { data: Uint8Array; w: number; h: number }
export interface Extent { x0: number; x1: number; y0: number; y1: number }
export type ViewKind = 'front' | 'stern' | 'side' | 'side2' | 'top' | 'bottom';
export interface Orient { rotate?: 0 | 90 | 180 | 270; flipX?: boolean; flipY?: boolean }

function median3(vals: number[]): number {
  const s = [...vals].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Chroma-key silhouette: bg = median of 4 corners; flood-fill bg from borders (within bgTolerance
 *  RGB euclidean distance). Everything not reached = foreground (1), incl. enclosed bg-coloured holes. */
export function extractSilhouette(rgba: Uint8Array, w: number, h: number, bgTolerance: number): Mask {
  const cornerIdx = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
  const bg = [0, 1, 2].map((c) => median3(cornerIdx.map(([x, y]) => rgba[(y * w + x) * 4 + c])));
  const tol2 = bgTolerance * bgTolerance;
  const fg = new Uint8Array(w * h).fill(1);
  const isBg = (x: number, y: number): boolean => {
    const i = (y * w + x) * 4;
    const dr = rgba[i] - bg[0], dg = rgba[i + 1] - bg[1], db = rgba[i + 2] - bg[2];
    return dr * dr + dg * dg + db * db <= tol2;
  };
  const stack: number[] = [];
  const visit = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = y * w + x;
    if (fg[p] === 0) return;       // already background
    if (!isBg(x, y)) return;       // foreground edge → stop
    fg[p] = 0; stack.push(p);
  };
  for (let x = 0; x < w; x++) { visit(x, 0); visit(x, h - 1); }
  for (let y = 0; y < h; y++) { visit(0, y); visit(w - 1, y); }
  while (stack.length) {
    const p = stack.pop()!; const x = p % w, y = (p - x) / w;
    visit(x + 1, y); visit(x - 1, y); visit(x, y + 1); visit(x, y - 1);
  }
  return { data: fg, w, h };
}

/** Robust bbox: only count rows/cols with foreground coverage ≥ coverFrac × span → ignores
 *  1–2px masts/antennas/booms that would inflate the extent. */
export function robustExtent(mask: Mask, coverFrac: number): Extent {
  const { data, w, h } = mask;
  const col = new Int32Array(w), row = new Int32Array(h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[y * w + x]) { col[x]++; row[y]++; }
  const colT = Math.max(1, Math.floor(coverFrac * h));
  const rowT = Math.max(1, Math.floor(coverFrac * w));
  let x0 = 0; while (x0 < w && col[x0] < colT) x0++;
  let x1 = w - 1; while (x1 >= 0 && col[x1] < colT) x1--;
  let y0 = 0; while (y0 < h && row[y0] < rowT) y0++;
  let y1 = h - 1; while (y1 >= 0 && row[y1] < rowT) y1--;
  if (x1 < x0 || y1 < y0) return { x0: 0, x1: w - 1, y0: 0, y1: h - 1 };
  return { x0, x1, y0, y1 };
}

export function cropToContent(mask: Mask, coverFrac: number): Mask {
  const e = robustExtent(mask, coverFrac);
  const w = e.x1 - e.x0 + 1, h = e.y1 - e.y0 + 1;
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = mask.data[(y + e.y0) * mask.w + (x + e.x0)];
  return { data, w, h };
}

export function mirrorX(mask: Mask): Mask {
  const { data, w, h } = mask;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + (w - 1 - x)] = data[y * w + x];
  return { data: out, w, h };
}

export function flipY(mask: Mask): Mask {
  const { data, w, h } = mask;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[(h - 1 - y) * w + x] = data[y * w + x];
  return { data: out, w, h };
}

/** Clockwise 90°: (x,y) in WxH → (H-1-y, x) in HxW. */
export function rotate90(mask: Mask): Mask {
  const { data, w, h } = mask;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[x * h + (h - 1 - y)] = data[y * w + x];
  return { data: out, w: h, h: w };
}

/** Per-view orientation escape hatch (spec §1/§2): rotate (CW) then optional flips. */
export function applyOrient(mask: Mask, o: Orient): Mask {
  let m = mask;
  const turns = ((o.rotate ?? 0) / 90) % 4;
  for (let i = 0; i < turns; i++) m = rotate90(m);
  if (o.flipX) m = mirrorX(m);
  if (o.flipY) m = flipY(m);
  return m;
}

export interface GridDims { nx: number; ny: number; nz: number } // x=beam, y=height, z=length

export function sampleMask(m: Mask, u: number, v: number): number {
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return 0;
  const x = Math.min(m.w - 1, Math.floor(u * m.w));
  const y = Math.min(m.h - 1, Math.floor(v * m.h));
  return m.data[y * m.w + x];
}

/** Union b onto a's pixel grid (nearest resample) then OR. Caller mirror-aligns b first. */
export function unionMask(a: Mask, b: Mask): Mask {
  const out = new Uint8Array(a.w * a.h);
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
    const u = (x + 0.5) / a.w, v = (y + 0.5) / a.h;
    out[y * a.w + x] = (a.data[y * a.w + x] || sampleMask(b, u, v)) ? 1 : 0;
  }
  return { data: out, w: a.w, h: a.h };
}

/** length(z)=gridLong; height(y),beam(x) from side/top aspect ratios. front aspect is a consistency
 *  check only (warns on perspective/scale mismatch). side.w=length, side.h=height; top.w=length, top.h=beam. */
export function registerGrid(side: Mask, top: Mask, front: Mask, gridLong: number): GridDims {
  const nz = gridLong;
  const ny = Math.max(1, Math.round(gridLong * side.h / side.w));
  const nx = Math.max(1, Math.round(gridLong * top.h / top.w));
  const frontAspect = front.w / front.h;          // beam/height
  const derived = nx / ny;
  if (derived > 0 && Math.abs(frontAspect - derived) / derived > 0.35) {
    console.warn(`registerGrid: front beam/height ${frontAspect.toFixed(2)} vs side+top-derived ${derived.toFixed(2)} — perspective/scale mismatch (continuing length-anchored)`);
  }
  return { nx, ny, nz };
}
