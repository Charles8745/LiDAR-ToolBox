// examples/kaohsiung-port/scene/viewCarving.ts
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

/** Orthographic visual hull. Voxel solid iff side(z,y) ∧ top(z,x) ∧ frontConstraint.
 *  frontConstraint: below frontMaskMaxHeightFrac the front silhouette applies (shapes hull V/bulwark);
 *  above it the front is "open" (=1) so end-towers are carved by side×top only — the side mask's
 *  z-localization (tall only where real structure is) keeps towers at their true station, removing the
 *  two-tower ghost. */
export function carveVisualHull(side: Mask, top: Mask, front: Mask, dims: GridDims, frontMaskMaxHeightFrac: number): Uint8Array {
  const { nx, ny, nz } = dims;
  const grid = new Uint8Array(nx * ny * nz);
  for (let iz = 0; iz < nz; iz++) {
    const uz = (iz + 0.5) / nz;
    for (let iy = 0; iy < ny; iy++) {
      const uy = (iy + 0.5) / ny;        // 0=bottom,1=top (world up)
      const vImg = 1 - uy;               // image row (top-down)
      if (!sampleMask(side, uz, vImg)) continue;            // side: (length, height)
      for (let ix = 0; ix < nx; ix++) {
        const ux = (ix + 0.5) / nx;      // beam
        if (!sampleMask(top, uz, ux)) continue;             // top: (length, beam)
        const inFront = uy <= frontMaskMaxHeightFrac ? sampleMask(front, ux, vImg) : 1; // front: (beam, height)
        if (inFront) grid[(iz * ny + iy) * nx + ix] = 1;
      }
    }
  }
  return grid;
}

/** Keep only boundary voxels (≥1 of 6 face-neighbours empty/edge) → hollow shell.
 *  Emits packed xyz in grid coords: x=beam, y=height, z=length. */
export function surfaceShell(grid: Uint8Array, dims: GridDims): Float32Array {
  const { nx, ny, nz } = dims;
  const at = (x: number, y: number, z: number): number =>
    (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) ? 0 : grid[(z * ny + y) * nx + x];
  const out: number[] = [];
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    if (!grid[(z * ny + y) * nx + x]) continue;
    if (!at(x+1,y,z) || !at(x-1,y,z) || !at(x,y+1,z) || !at(x,y-1,z) || !at(x,y,z+1) || !at(x,y,z-1)) out.push(x, y, z);
  }
  return Float32Array.from(out);
}

export interface CarveCfg {
  gridLong: number; bgTolerance: number; coverFrac: number;
  frontMaskMaxHeightFrac: number; cellFrac: number; signForward: 1 | -1;
  minPoints: number;
  perView?: Partial<Record<ViewKind, Orient>>;
}

/** Apply per-view orient, then per axis: primary mask OR the mirror-aligned secondary. Throws on a
 *  missing required view (side/top/front). mirrorX aligns the opposite-direction secondary. */
export function assembleAxes(byKind: Partial<Record<ViewKind, Mask>>, perView?: Partial<Record<ViewKind, Orient>>): { side: Mask; top: Mask; front: Mask } {
  const get = (k: ViewKind): Mask | undefined => {
    const m = byKind[k]; if (!m) return undefined;
    const o = perView?.[k]; return o ? applyOrient(m, o) : m;
  };
  const need = (k: ViewKind): Mask => { const m = get(k); if (!m) throw new Error(`missing required view: ${k}`); return m; };
  let side = need('side');  const s2 = get('side2');  if (s2) side = unionMask(side, mirrorX(s2));
  let top = need('top');    const bo = get('bottom');  if (bo) top = unionMask(top, mirrorX(bo));
  let front = need('front'); const st = get('stern');  if (st) front = unionMask(front, mirrorX(st));
  return { side, top, front };
}

/** Full carve: register grid → carve hull → surface shell → normalize (length→x, min-y=0) → voxel
 *  downsample. Throws on a degenerate/empty carve (a silhouette likely keyed to empty). */
export function carveToTemplate(side: Mask, top: Mask, front: Mask, cfg: CarveCfg): Float32Array {
  const dims = registerGrid(side, top, front, cfg.gridLong);
  const grid = carveVisualHull(side, top, front, dims, cfg.frontMaskMaxHeightFrac);
  const shell = surfaceShell(grid, dims);
  if (shell.length / 3 < cfg.minPoints) {
    throw new Error(`degenerate carve: ${shell.length / 3} shell points (< minPoints ${cfg.minPoints}) — a silhouette likely keyed to empty (check bgTolerance / view orientation)`);
  }
  const norm = normalizeToUnit(shell, { forwardAxis: 'z', upAxis: 'y', signForward: cfg.signForward });
  const pts = voxelDownsample(norm.positions, cfg.cellFrac);
  if (pts.length / 3 < cfg.minPoints) {
    throw new Error(`degenerate carve: ${pts.length / 3} points after downsample (< minPoints ${cfg.minPoints})`);
  }
  return pts;
}
