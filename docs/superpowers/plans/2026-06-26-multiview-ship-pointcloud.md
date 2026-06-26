# Multi-view → Point-cloud Ship (Visual-Hull Carving) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a general "axis-view screenshots → point-cloud template" baker (orthographic visual-hull voxel carving) that outputs the same `data/ship-models/<船型>.json` as the GLB path, unblocking ship types with no free 3D model — first use case: 工程/dredger.

**Architecture:** New pure-logic module `scene/viewCarving.ts` (chroma-key silhouette → robust crop → per-view orient → 3-axis voxel carve → surface shell → reuse `meshSampling`'s `normalizeToUnit`+`voxelDownsample`). A library `data/scan-views.ts` (`sharp` decode + filename convention + assembly + JSON write, NO top-level execution) plus a thin CLI entry `data/scan-views.cli.ts`. Wire the baked `工程.json` into `scene/shipModels.ts` `RAW` exactly like the yacht. Engine `src/` untouched.

**Tech Stack:** TypeScript, vite-node CLI, `sharp` (already a dep, used by `port:basemap`), vitest. Reuses `examples/kaohsiung-port/scene/meshSampling.ts`.

## Global Constraints

- **Engine `src/` ZERO changes** — everything lives under `examples/kaohsiung-port/`.
- **Point budget ≤ 1500** points per baked template (`cellFrac` is the density knob; target ~1–1.4k, and NOT too sparse — see Task 5 tuning).
- **Raw screenshots git-ignored:** they live under `data/models/views/`, already covered by the existing `.gitignore` rule `examples/kaohsiung-port/data/models/*` (allowlisting `.gitkeep`/`CREDITS.md`). Do NOT add a new ignore rule. Only the baked `data/ship-models/<船型>.json` (under `ship-models/`, not `models/`) is committed.
- **Output JSON shape:** `{ sourceFile, sampledAt, sampling:'visual-hull', count, lengthM, forwardAxis:'z', points:number[] }`. The runtime consumer `toTemplate`/`RAW` (typed `Partial<Record<ShipCategory,{points:number[]}>>`) reads ONLY `points`, so `lengthM:null` is safe; the import compiles under `resolveJsonModule`.
- **Reuse, don't reinvent:** `normalizeToUnit({forwardAxis:'z',upAxis:'y'})` + `voxelDownsample(cellFrac)` from `meshSampling.ts` for the back half.
- **Pure logic vs IO separation:** `viewCarving.ts` has NO `sharp`/filesystem. Image decode + file IO live only in `scan-views.ts`; the CLI run-call lives only in `scan-views.cli.ts`. Tests import `viewCarving.ts` and the pure exports of `scan-views.ts`, never the `.cli.ts`.
- **Grid axis convention:** `x = beam`, `y = height (world-up)`, `z = length (bow at +z)`. `surfaceShell` emits points in these grid coords; `normalizeToUnit` then rotates length(z)→x.
- **Coordinate detail:** world-up `uy` (0=bottom,1=top) maps to image row `vImg = 1 - uy` (image origin top-left). `mirrorX` flips the image WIDTH axis — for `side2`/`bottom` (width=length) that flips length; for `stern` (width=beam) that flips beam. Both are the correct opposite-view alignment.

---

### Task 1: Silhouette extraction, robust crop, orientation — `viewCarving.ts` (part 1)

**Files:**
- Create: `examples/kaohsiung-port/scene/viewCarving.ts`
- Test: `test/port-view-carving.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `interface Mask { data: Uint8Array; w: number; h: number }` (1=foreground/ship, 0=background; row-major)
  - `interface Extent { x0: number; x1: number; y0: number; y1: number }`
  - `type ViewKind = 'front' | 'stern' | 'side' | 'side2' | 'top' | 'bottom'`
  - `interface Orient { rotate?: 0 | 90 | 180 | 270; flipX?: boolean; flipY?: boolean }`
  - `extractSilhouette(rgba: Uint8Array, w: number, h: number, bgTolerance: number): Mask`
  - `robustExtent(mask: Mask, coverFrac: number): Extent`
  - `cropToContent(mask: Mask, coverFrac: number): Mask`
  - `mirrorX(mask: Mask): Mask`
  - `flipY(mask: Mask): Mask`
  - `rotate90(mask: Mask): Mask`
  - `applyOrient(mask: Mask, o: Orient): Mask`

- [ ] **Step 1: Write the failing test**

```ts
// test/port-view-carving.test.ts
import { describe, it, expect } from 'vitest';
import {
  extractSilhouette, robustExtent, cropToContent, mirrorX, flipY, rotate90, applyOrient, type Mask,
} from '../examples/kaohsiung-port/scene/viewCarving';

// RGBA buffer: uniform bg, with foreground rects painted in fg colors.
function makeRgba(w: number, h: number, bg: [number,number,number], rects: {x0:number;y0:number;x1:number;y1:number;color:[number,number,number]}[]): Uint8Array {
  const a = new Uint8Array(w*h*4);
  for (let i=0;i<w*h;i++){ a[i*4]=bg[0]; a[i*4+1]=bg[1]; a[i*4+2]=bg[2]; a[i*4+3]=255; }
  for (const r of rects) for (let y=r.y0;y<=r.y1;y++) for (let x=r.x0;x<=r.x1;x++){
    const i=(y*w+x)*4; a[i]=r.color[0]; a[i+1]=r.color[1]; a[i+2]=r.color[2];
  }
  return a;
}
const BG: [number,number,number] = [168,184,188];

describe('extractSilhouette', () => {
  it('marks foreground rect as 1 and background as 0', () => {
    const w=20,h=20;
    const rgba = makeRgba(w,h,BG,[{x0:5,y0:5,x1:14,y1:14,color:[200,60,40]}]);
    const m = extractSilhouette(rgba,w,h,40);
    expect(m.data[10*w+10]).toBe(1);
    expect(m.data[0]).toBe(0);
  });
  it('keeps an enclosed background-coloured hole filled (not reachable from border)', () => {
    const w=20,h=20;
    const rgba = makeRgba(w,h,BG,[{x0:4,y0:4,x1:15,y1:15,color:[200,60,40]}]);
    const i=(10*w+10)*4; rgba[i]=BG[0]; rgba[i+1]=BG[1]; rgba[i+2]=BG[2];
    const m = extractSilhouette(rgba,w,h,40);
    expect(m.data[10*w+10]).toBe(1);
  });
});

describe('robustExtent', () => {
  it('ignores a 1px-wide spike', () => {
    const w=30,h=30; const data=new Uint8Array(w*h);
    for (let y=10;y<=20;y++) for (let x=10;x<=20;x++) data[y*w+x]=1; // 11x11 block
    for (let y=0;y<10;y++) data[y*w+15]=1;                          // 1px spike up
    const e = robustExtent({data,w,h}, 0.1);
    expect(e.y0).toBe(10); expect(e.x0).toBe(10); expect(e.x1).toBe(20); expect(e.y1).toBe(20);
  });
});

describe('cropToContent', () => {
  it('crops to the robust block size', () => {
    const w=30,h=30; const data=new Uint8Array(w*h);
    for (let y=10;y<=20;y++) for (let x=5;x<=24;x++) data[y*w+x]=1; // 20w x 11h
    const c = cropToContent({data,w,h}, 0.1);
    expect(c.w).toBe(20); expect(c.h).toBe(11);
  });
});

describe('mirrorX / flipY', () => {
  it('mirrorX flips a non-square asymmetric mask', () => {
    const m: Mask = { data: new Uint8Array([1,0,0, 0,0,1]), w:3, h:2 };
    expect(Array.from(mirrorX(m).data)).toEqual([0,0,1, 1,0,0]);
  });
  it('flipY flips rows', () => {
    const m: Mask = { data: new Uint8Array([1,0,0, 0,0,1]), w:3, h:2 };
    expect(Array.from(flipY(m).data)).toEqual([0,0,1, 1,0,0]);
  });
});

describe('rotate90 / applyOrient', () => {
  it('rotate90 swaps dims and rotates clockwise', () => {
    // 3w x 2h, top-left set. CW 90° → 2w x 3h, top-right set.
    const m: Mask = { data: new Uint8Array([1,0,0, 0,0,0]), w:3, h:2 };
    const r = rotate90(m);
    expect(r.w).toBe(2); expect(r.h).toBe(3);
    expect(r.data[0*2+1]).toBe(1); // top-right
  });
  it('applyOrient composes rotate then flips', () => {
    const m: Mask = { data: new Uint8Array([1,0,0, 0,0,0]), w:3, h:2 };
    const out = applyOrient(m, { rotate: 0, flipX: true });
    expect(Array.from(out.data)).toEqual([0,0,1, 0,0,0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/port-view-carving.test.ts`
Expected: FAIL — cannot resolve `../examples/kaohsiung-port/scene/viewCarving`.

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/port-view-carving.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/scene/viewCarving.ts test/port-view-carving.test.ts
git commit -m "feat(port): viewCarving silhouette extraction + robust crop + orient"
```

---

### Task 2: Mask sampling + union + grid registration — `viewCarving.ts` (part 2)

**Files:**
- Modify: `examples/kaohsiung-port/scene/viewCarving.ts` (append)
- Test: `test/port-view-carving.test.ts` (append)

**Interfaces:**
- Consumes: `Mask` (Task 1).
- Produces:
  - `interface GridDims { nx: number; ny: number; nz: number }` (x=beam, y=height, z=length)
  - `sampleMask(m: Mask, u: number, v: number): number` (nearest; u,v in [0,1); 0 if out of range)
  - `unionMask(a: Mask, b: Mask): Mask` (b nearest-resampled onto a's grid, then OR)
  - `registerGrid(side: Mask, top: Mask, front: Mask, gridLong: number): GridDims`

- [ ] **Step 1: Write the failing test**

```ts
// append to test/port-view-carving.test.ts
import { vi } from 'vitest';
import { sampleMask, unionMask, registerGrid, type GridDims } from '../examples/kaohsiung-port/scene/viewCarving';

export function solid(w: number, h: number): Mask { return { data: new Uint8Array(w*h).fill(1), w, h }; }

describe('sampleMask', () => {
  it('returns 1 inside, 0 out of [0,1)', () => {
    const m = solid(10,10);
    expect(sampleMask(m, 0.5, 0.5)).toBe(1);
    expect(sampleMask(m, -0.1, 0.5)).toBe(0);
    expect(sampleMask(m, 1.0, 0.5)).toBe(0);
  });
});

describe('unionMask', () => {
  it('ORs b (resampled) into a', () => {
    const a: Mask = { data: new Uint8Array(4*4), w:4, h:4 };
    const u = unionMask(a, solid(8,8));
    expect(u.w).toBe(4); expect(u.h).toBe(4);
    expect(Array.from(u.data).every((v) => v === 1)).toBe(true);
  });
});

describe('registerGrid', () => {
  it('anchors length to gridLong and derives beam/height from aspect ratios', () => {
    const d: GridDims = registerGrid(solid(200,50), solid(200,40), solid(32,40), 160);
    expect(d.nz).toBe(160); expect(d.ny).toBe(40); expect(d.nx).toBe(32);
  });
  it('warns when front aspect is inconsistent with side+top', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerGrid(solid(200,50), solid(200,40), solid(60,40), 160); // front 1.5 vs derived 0.8
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
  it('does not warn for consistent aspects', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerGrid(solid(200,50), solid(200,40), solid(32,40), 160); // front 0.8 == derived 0.8
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/port-view-carving.test.ts`
Expected: FAIL — `sampleMask`/`unionMask`/`registerGrid` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to examples/kaohsiung-port/scene/viewCarving.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/port-view-carving.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/scene/viewCarving.ts test/port-view-carving.test.ts
git commit -m "feat(port): viewCarving mask sampling + union + grid registration"
```

---

### Task 3: Visual-hull carve, shell, axis assembly, template — `viewCarving.ts` (part 3)

**Files:**
- Modify: `examples/kaohsiung-port/scene/viewCarving.ts` (append)
- Test: `test/port-view-carving.test.ts` (append)

**Interfaces:**
- Consumes: `Mask`, `GridDims`, `ViewKind`, `Orient`, `sampleMask`, `registerGrid`, `mirrorX`, `unionMask`, `applyOrient` (Tasks 1–2); `normalizeToUnit`, `voxelDownsample` (`meshSampling`).
- Produces:
  - `carveVisualHull(side: Mask, top: Mask, front: Mask, dims: GridDims, frontMaskMaxHeightFrac: number): Uint8Array` (length nx*ny*nz; index `(iz*ny+iy)*nx+ix`)
  - `surfaceShell(grid: Uint8Array, dims: GridDims): Float32Array` (packed xyz grid coords: x=beam, y=height, z=length)
  - `interface CarveCfg { gridLong: number; bgTolerance: number; coverFrac: number; frontMaskMaxHeightFrac: number; cellFrac: number; signForward: 1 | -1; minPoints: number; perView?: Partial<Record<ViewKind, Orient>> }`
  - `assembleAxes(byKind: Partial<Record<ViewKind, Mask>>, perView?: Partial<Record<ViewKind, Orient>>): { side: Mask; top: Mask; front: Mask }` (throws `missing required view: <kind>`)
  - `carveToTemplate(side: Mask, top: Mask, front: Mask, cfg: CarveCfg): Float32Array` (throws on degenerate/empty carve)

- [ ] **Step 1: Write the failing test**

```ts
// append to test/port-view-carving.test.ts
import {
  carveVisualHull, surfaceShell, assembleAxes, carveToTemplate, type CarveCfg,
} from '../examples/kaohsiung-port/scene/viewCarving';

const cfgBase: CarveCfg = { gridLong:120, bgTolerance:32, coverFrac:0.02, frontMaskMaxHeightFrac:0.45, cellFrac:0.022, signForward:1, minPoints:30 };

describe('carveVisualHull + surfaceShell', () => {
  it('three solid silhouettes carve a HOLLOW box shell', () => {
    const side = solid(40,20), top = solid(40,16), front = solid(16,20);
    const dims = registerGrid(side, top, front, 40); // nz40, ny20, nx16
    const grid = carveVisualHull(side, top, front, dims, 1.0);
    const iz=20, iy=10, ix=8;
    expect(grid[(iz*dims.ny+iy)*dims.nx+ix]).toBe(1);        // interior solid
    const shell = surfaceShell(grid, dims);
    let hasInterior = false;
    for (let i=0;i<shell.length;i+=3) if (shell[i]===ix && shell[i+1]===iy && shell[i+2]===iz) hasInterior = true;
    expect(hasInterior).toBe(false);                          // interior excluded from shell
    expect(shell.length).toBeGreaterThan(0);
  });

  it('the FRONT silhouette carves the hull cross-section below the deck line', () => {
    const nz=20, ny=20, nx=16;
    const side = solid(nz,ny), top = solid(nz,nx);
    const front: Mask = { data: new Uint8Array(nx*ny), w:nx, h:ny }; // solid only central beam band
    for (let y=0;y<ny;y++) for (let x=0;x<nx;x++) if (x>=nx/4 && x<3*nx/4) front.data[y*nx+x]=1;
    const grid = carveVisualHull(side, top, front, { nx, ny, nz }, 1.0); // front applies everywhere
    const izL=10, iyL=2;
    expect(grid[(izL*ny+iyL)*nx+1]).toBe(0);  // outside front beam band → carved
    expect(grid[(izL*ny+iyL)*nx+8]).toBe(1);  // inside band → solid
  });

  it('above-deck structure localizes to z where SIDE is tall (no mid-ship phantom tower)', () => {
    const nz=40, ny=20, nx=16;
    const side: Mask = { data: new Uint8Array(nz*ny), w:nz, h:ny };
    for (let z=0;z<nz;z++) for (let y=0;y<ny;y++){
      const endBand = z < nz*0.2 || z > nz*0.8;   // bow + stern tall
      const lowHull = y >= ny*0.6;                 // bottom rows (low height) = hull everywhere
      if (endBand || lowHull) side.data[y*nz+z] = 1;
    }
    const grid = carveVisualHull(side, solid(nz,nx), solid(nx,ny), { nx, ny, nz }, 0.45);
    const highAt = (z:number): boolean => {
      for (let iy=Math.floor(ny*0.6); iy<ny; iy++) for (let ix=0;ix<nx;ix++) if (grid[(z*ny+iy)*nx+ix]) return true;
      return false;
    };
    expect(highAt(2)).toBe(true);                  // bow end: side tall → tower
    expect(highAt(nz-3)).toBe(true);               // stern end: side tall → tower
    expect(highAt(Math.floor(nz/2))).toBe(false);  // mid-ship: side low → NO phantom tower
  });

  it('a circular FRONT silhouette carves a rounded (non-box) cross-section', () => {
    const nz=30, D=20;
    const circle = (d:number): Mask => {
      const data=new Uint8Array(d*d); const c=(d-1)/2, r=d/2;
      for (let y=0;y<d;y++) for (let x=0;x<d;x++){ const dx=x-c,dy=y-c; if (dx*dx+dy*dy<=r*r) data[y*d+x]=1; }
      return { data, w:d, h:d };
    };
    const grid = carveVisualHull(solid(nz,D), solid(nz,D), circle(D), { nx:D, ny:D, nz }, 1.0);
    const izM=15;
    expect(grid[(izM*D + Math.floor(D/2))*D + Math.floor(D/2)]).toBe(1); // center solid
    expect(grid[(izM*D + 1)*D + 1]).toBe(0);                              // corner carved (rounded)
    expect(grid[(izM*D + (D-2))*D + (D-2)]).toBe(0);
  });
});

describe('assembleAxes', () => {
  it('returns side/top/front and unions a mirror-aligned secondary', () => {
    const r = assembleAxes({ side: solid(10,4), top: solid(10,3), front: solid(3,4), side2: solid(10,4) });
    expect(r.side.w).toBe(10); expect(r.top.w).toBe(10); expect(r.front.w).toBe(3);
  });
  it('throws when a required view is missing', () => {
    expect(() => assembleAxes({ side: solid(10,4), top: solid(10,3) })).toThrow(/missing required view: front/);
  });
});

describe('carveToTemplate', () => {
  it('returns ≤ budget normalized points (x longest ≈1, min-y≈0)', () => {
    const pts = carveToTemplate(solid(120,30), solid(120,24), solid(24,30), cfgBase);
    expect(pts.length % 3).toBe(0);
    expect(pts.length / 3).toBeLessThanOrEqual(1500);
    expect(pts.length / 3).toBeGreaterThanOrEqual(cfgBase.minPoints);
    let minY=Infinity, maxX=-Infinity, minX=Infinity;
    for (let i=0;i<pts.length;i+=3){ minY=Math.min(minY,pts[i+1]); maxX=Math.max(maxX,pts[i]); minX=Math.min(minX,pts[i]); }
    expect(minY).toBeGreaterThanOrEqual(-1e-6);
    expect(maxX - minX).toBeGreaterThan(0.9);
  });
  it('throws on a degenerate (empty) carve instead of writing 0 points', () => {
    const empty: Mask = { data: new Uint8Array(120*30), w:120, h:30 };
    expect(() => carveToTemplate(empty, empty, empty, cfgBase)).toThrow(/degenerate/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/port-view-carving.test.ts`
Expected: FAIL — `carveVisualHull`/`surfaceShell`/`assembleAxes`/`carveToTemplate` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to examples/kaohsiung-port/scene/viewCarving.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/port-view-carving.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS; tsc 0 errors.

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/scene/viewCarving.ts test/port-view-carving.test.ts
git commit -m "feat(port): viewCarving visual-hull carve + shell + assembly + template"
```

---

### Task 4: Bake library + CLI entry + npm script — `scan-views.ts` / `scan-views.cli.ts`

**Files:**
- Create: `examples/kaohsiung-port/data/scan-views.ts` (library — NO top-level execution)
- Create: `examples/kaohsiung-port/data/scan-views.cli.ts` (thin CLI entry that calls `main()`)
- Modify: `package.json` (add `port:scan-views` script → the `.cli.ts`)
- Test: `test/port-scan-views.test.ts`

> **Do NOT add a `.gitignore` entry.** Raw views under `data/models/views/` are already ignored by the existing `examples/kaohsiung-port/data/models/*` rule. Verify with `git check-ignore -v examples/kaohsiung-port/data/models/views/工程/front.png`.
> **Why two files:** under `vite-node` an `import.meta.url === file://${process.argv[1]}` run-guard is ALWAYS false (`process.argv[1]` is the vite-node binary, not the script) — it would make the CLI silently do nothing. The repo convention is that test-imported modules are pure libraries and CLI files call `main()` unconditionally. So `scan-views.ts` exports `main` (no self-call); `scan-views.cli.ts` calls it; the test imports only `scan-views.ts`.

**Interfaces:**
- Consumes: `viewCarving` (Tasks 1–3); `sharp`.
- Produces (from `scan-views.ts`):
  - `classifyView(filename: string): ViewKind | null` (pure)
  - `decodeMask(buf: Buffer, bgTolerance: number): Promise<Mask>` (sharp decode → `extractSilhouette`)
  - `bakeCategory(viewsDir: string, cfg: CarveCfg): Promise<{ points: number[]; count: number }>`
  - `DEFAULT_CFG: CarveCfg`, `VIEW_BAKE_CONFIG: Record<string, Partial<CarveCfg>>`, `main(): Promise<void>`

- [ ] **Step 1: Write the failing test** (`classifyView` pure + `decodeMask` via a sharp encode→decode round-trip)

```ts
// test/port-scan-views.test.ts
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { classifyView, decodeMask } from '../examples/kaohsiung-port/data/scan-views';

describe('classifyView', () => {
  it('maps filename keywords to view kinds (specific before generic)', () => {
    expect(classifyView('front.png')).toBe('front');
    expect(classifyView('bow_01.jpg')).toBe('front');
    expect(classifyView('stern.png')).toBe('stern');
    expect(classifyView('aft.png')).toBe('stern');
    expect(classifyView('side.png')).toBe('side');
    expect(classifyView('port.png')).toBe('side');
    expect(classifyView('starboard.png')).toBe('side2');
    expect(classifyView('side2.png')).toBe('side2');
    expect(classifyView('top.png')).toBe('top');
    expect(classifyView('deck.png')).toBe('top');
    expect(classifyView('bottom.png')).toBe('bottom');
    expect(classifyView('hull.png')).toBe('bottom');
    expect(classifyView('readme.txt')).toBe(null);
  });
});

describe('decodeMask', () => {
  it('decodes a PNG and extracts the foreground silhouette', async () => {
    const w=20,h=20; const raw=Buffer.alloc(w*h*3);
    for (let i=0;i<w*h;i++){ raw[i*3]=168; raw[i*3+1]=184; raw[i*3+2]=188; } // bg
    for (let y=5;y<=14;y++) for (let x=5;x<=14;x++){ const i=(y*w+x)*3; raw[i]=200; raw[i+1]=60; raw[i+2]=40; }
    const png = await sharp(raw, { raw:{ width:w, height:h, channels:3 } }).png().toBuffer();
    const m = await decodeMask(png, 40);
    expect(m.w).toBe(20); expect(m.h).toBe(20);
    expect(m.data[10*20+10]).toBe(1);
    expect(m.data[0]).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/port-scan-views.test.ts`
Expected: FAIL — cannot resolve `../examples/kaohsiung-port/data/scan-views`.

- [ ] **Step 3: Write the library `scan-views.ts`**

```ts
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
const VIEW_BAKE_CONFIG: Record<string, Partial<CarveCfg>> = {
  // 工程: { cellFrac: 0.022, frontMaskMaxHeightFrac: 0.45, bgTolerance: 30 },
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
```

- [ ] **Step 4: Write the CLI entry `scan-views.cli.ts`**

```ts
// examples/kaohsiung-port/data/scan-views.cli.ts
import { main } from './scan-views';

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 5: Add the npm script**

In `package.json` `scripts`, after the `port:models` line, add (note: points at the `.cli.ts`):
```json
    "port:scan-views": "vite-node examples/kaohsiung-port/data/scan-views.cli.ts",
```

- [ ] **Step 6: Run tests + type-check**

Run: `npx vitest run test/port-scan-views.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS; tsc 0 errors.

- [ ] **Step 7: Smoke the CLI does not silently no-op**

Run: `export npm_config_cache=/tmp/npmcache && npm run port:scan-views`
Expected: prints `No models/views/ dir; nothing to bake.` (the views dir is git-ignored/absent) — proving `main()` actually RUNS under vite-node (the bug this task's structure fixes). It must NOT exit silently with no output.

- [ ] **Step 8: Commit**

```bash
git add examples/kaohsiung-port/data/scan-views.ts examples/kaohsiung-port/data/scan-views.cli.ts test/port-scan-views.test.ts package.json
git commit -m "feat(port): port:scan-views CLI (multi-view → point cloud baker)"
```

---

### Task 5: Bake the dredger + wire into the scene + browser-verify

**Prerequisite (user-supplied, like the yacht glb):**
- 6 screenshots saved into `examples/kaohsiung-port/data/models/views/工程/`, named so `classifyView` maps them: `front.png`, `stern.png`, `side.png`, `side2.png`, `top.png`, `bottom.png`.
- Dredger source URL + license (for `CREDITS.md`).

If the screenshots are not yet in place, STOP and ask the user to drop them before this task.

**Files:**
- Modify: `examples/kaohsiung-port/scene/shipModels.ts` (import + `RAW`)
- Create (baked, committed): `examples/kaohsiung-port/data/ship-models/工程.json`
- Modify: `examples/kaohsiung-port/data/models/CREDITS.md`

**Interfaces:**
- Consumes: `bakeCategory` via `npm run port:scan-views` (Task 4); `RAW` registry (`scene/shipModels.ts`).
- Produces: a stereoscopic 工程 ship at runtime (no new exported API).

- [ ] **Step 1: Bake**

Run: `export npm_config_cache=/tmp/npmcache && npm run port:scan-views`
Expected: `  ✓ 工程 → ship-models/工程.json (NNNN pts)` with **50 ≤ NNNN ≤ 1500**.
- "missing required view" → check filenames against `classifyView`.
- "degenerate carve" → a silhouette keyed empty: lower `bgTolerance` (ship eaten) or check that view's orientation; set `VIEW_BAKE_CONFIG['工程']`.
- count > 1500 → raise `cellFrac`. count < ~400 or reads too sparse → lower `cellFrac` and/or raise `gridLong`.

- [ ] **Step 2: Wire into the RAW registry**

In `examples/kaohsiung-port/scene/shipModels.ts`, add after the yacht import:
```ts
import dredgerJson from '../data/ship-models/工程.json';
```
And in `RAW`, add the entry + update the trailing comment:
```ts
  遊艇: yachtJson,
  工程: dredgerJson,
  // 其他: 無模型 → 平面 footprint fallback
```

- [ ] **Step 3: Type-check + tests + build**

Run: `npx tsc --noEmit -p tsconfig.json && npm test && npm run build`
Expected: tsc 0; all tests pass; build ok.

- [ ] **Step 4: Browser visual verification**

`npm run dev`, open `http://localhost:5173/examples/kaohsiung-port/index.html`. Aim the camera at a 工程 vessel (~5 in the AIS data), as done for the yacht:
```js
(()=>{const t=window.__twin,out=[];for(const sc of t.shipCenters){const m=t.trackMeta.get(sc.track?.mmsi);if(m?.category==='工程')out.push({name:sc.track?.name,x:+sc.x.toFixed(1),z:+sc.z.toFixed(1)});}return out;})()
// const e=__twin.engine,c=e.controls; c.minDistance=0.5; c.target.set(X,0.4,Z); e.camera.position.set(X+2,1.5,Z+2.5); c.update();
```
Confirm: reads as a dredger (long low hull + bow bridge + stern tower), **sits on water**, olive colour `[160,175,95]`, correct heading axis (not rotated/oversized), no phantom mid-ship tower, console only favicon 404.

Tuning loop (edit `VIEW_BAKE_CONFIG['工程']`, re-run `npm run port:scan-views`):
- Rotated/oversized hull → check view filenames; a transposed/portrait view → add `perView: { <kind>: { rotate: 90 } }`.
- Bow points the wrong way → `signForward: -1`. NOTE: this negates the LENGTH axis only, so it also mirrors port/starboard handedness; harmless for the symmetric dredger, but for an asymmetric vessel fix a reversed bow by re-capturing/rotating the views, not by `signForward`.
- Phantom tall structure mid-ship → lower `frontMaskMaxHeightFrac` (e.g. 0.35) AND check the side crop genuinely shows a low mid-deck (the mitigation needs the side view to be low mid-ship).
- Ship silhouette eaten / holes → lower `bgTolerance` or re-capture with higher ship/background contrast.
- Background halo kept → raise `bgTolerance` (robustExtent strips thin halos; wide soft shadows may need a cleaner capture).
- Too sparse to read bow-bridge vs stern-tower → lower `cellFrac` (denser) and/or raise `gridLong`; keep ≤ 1500.

- [ ] **Step 5: Update CREDITS.md**

Append a `## 工程 (dredger)` section to `examples/kaohsiung-port/data/models/CREDITS.md` with the model title/author/source URL/license the user provided. If the license is non-commercial, flag it like the yacht's NC note.

- [ ] **Step 6: Commit**

```bash
git add examples/kaohsiung-port/scene/shipModels.ts examples/kaohsiung-port/data/ship-models/工程.json examples/kaohsiung-port/data/models/CREDITS.md
git commit -m "feat(port): add 工程 (dredger) 3D model via multi-view carving"
```
(Raw screenshots under `data/models/views/工程/` stay git-ignored via the existing `models/*` rule.)

---

## Self-Review

**Spec coverage:**
- chroma-key `extractSilhouette` (corner-median bg, enclosed-hole fill) → Task 1 ✓
- `robustExtent`/`cropToContent` (ignore thin spurs) → Task 1 ✓
- per-view rotate/flip override (spec §1 line 41, §2 line 62) → Task 1 (`applyOrient`/`rotate90`/`flipY`) + Task 3 (`CarveCfg.perView`, `assembleAxes`) + Task 5 tuning ✓
- view-orientation convention + `mirrorX` alignment → Global Constraints (per-view mirror meaning) + Task 3 `assembleAxes` ✓
- `registerGrid` (length-anchored + consistency warn, TESTED) → Task 2 ✓
- `carveVisualHull` + `frontMaskMaxHeightFrac` ghosting fix (+ true z-localization test + front-hull test + cylinder test) → Task 3 ✓
- `surfaceShell` hollow → Task 3 ✓
- reuse `normalizeToUnit`+`voxelDownsample`, same JSON shape, `lengthM:null` safe → Task 3 + Global Constraints ✓
- degenerate/empty-carve guard → Task 3 `carveToTemplate` (throws) + test ✓
- CLI `port:scan-views` (works under vite-node via `.cli.ts` split), filename convention, `VIEW_BAKE_CONFIG`, missing-view error → Task 4 ✓
- raw views git-ignored by existing `models/*` (no new rule) → Global Constraints + Task 4 note ✓
- wire `RAW['工程']`, point budget 50–1500, browser verify, CREDITS/license → Task 5 ✓

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N" — every step carries complete code. The single commented `VIEW_BAKE_CONFIG['工程']` line is an intentional config template filled during Task 5.

**Type consistency:** `Mask`/`Extent`/`GridDims`/`ViewKind`/`Orient`/`CarveCfg` defined once in `viewCarving.ts` and imported everywhere; `carveToTemplate(side,top,front,cfg)` and `assembleAxes(byKind,perView)` signatures match their callers in `bakeCategory`; grid index `(iz*ny+iy)*nx+ix` identical across `carveVisualHull`/`surfaceShell`/tests; `extractSilhouette(rgba,w,h,bgTolerance)` positional form is used consistently by its test and by `decodeMask`; output JSON keys match what `toTemplate`/`RAW` consume (`points` only). `scan-views.ts` exports `main` but never self-invokes; `scan-views.cli.ts` is the only caller.

**Notes for the implementer:**
- Tasks 1–4 are fully self-contained and testable WITHOUT the user's screenshots (pure functions + a sharp encode→decode round-trip). Only Task 5 needs the 6 real images + license.
- The plan deliberately flattens the spec's `extractSilhouette(..., opts:{bgTolerance})` to a positional `bgTolerance` for ergonomics (functionally identical).
- Anti-ghosting depends on the SIDE view genuinely being low mid-ship; if a dredger has a continuously-tall side profile the towers will read as a long high slab (correct, not a ghost). Task 5's tuning note covers this.
