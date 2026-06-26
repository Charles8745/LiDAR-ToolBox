# Multi-view → Point-cloud Ship (Visual-Hull Carving) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a general "axis-view screenshots → point-cloud template" baker (orthographic visual-hull voxel carving) that outputs the same `data/ship-models/<船型>.json` as the GLB path, unblocking ship types with no free 3D model — first use case: 工程/dredger.

**Architecture:** New pure-logic module `scene/viewCarving.ts` (chroma-key silhouette → robust crop → 3-axis voxel carve → surface shell → reuse `meshSampling`'s `normalizeToUnit`+`voxelDownsample`). New CLI `data/scan-views.ts` (`sharp` decode + filename convention + write JSON), mirroring `data/fetch-ship-models.ts`. Wire the baked `工程.json` into `scene/shipModels.ts` `RAW` exactly like the yacht. Engine `src/` untouched.

**Tech Stack:** TypeScript, vite-node CLI, `sharp` (already a dep, used by `port:basemap`), `three` types only indirectly, vitest. Reuses `examples/kaohsiung-port/scene/meshSampling.ts`.

## Global Constraints

- **Engine `src/` ZERO changes** — everything lives under `examples/kaohsiung-port/`.
- **Point budget ≤ 1500** points per baked template (`cellFrac` is the density knob; target ~1.3k).
- **Raw screenshots git-ignored** (`data/models/views/`), only the baked `data/ship-models/<船型>.json` is committed (raw-vs-baked convention).
- **Output JSON shape identical to the GLB path:** `{ sourceFile, sampledAt, sampling:'visual-hull', count, lengthM, forwardAxis:'z', points:number[] }`. `placeModelPoints`/`toTemplate` consume only `points`.
- **Reuse, don't reinvent:** `normalizeToUnit({forwardAxis:'z',upAxis:'y'})` + `voxelDownsample(cellFrac)` from `meshSampling.ts` for the back half.
- **Pure logic vs IO separation:** `viewCarving.ts` has NO `sharp`/filesystem; image decode + file IO live only in `scan-views.ts`.
- **Grid axis convention:** `x = beam`, `y = height (world-up)`, `z = length (bow at +z)`. `surfaceShell` emits points in these grid coords; `normalizeToUnit` then rotates length(z)→x.
- **Coordinate detail:** world-up `uy` (0=bottom,1=top) maps to image row `vImg = 1 - uy` (image origin top-left).

---

### Task 1: Silhouette extraction + robust crop — `viewCarving.ts` (part 1)

**Files:**
- Create: `examples/kaohsiung-port/scene/viewCarving.ts`
- Test: `test/port-view-carving.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `interface Mask { data: Uint8Array; w: number; h: number }` (1=foreground/ship, 0=background; row-major)
  - `interface Extent { x0: number; x1: number; y0: number; y1: number }`
  - `extractSilhouette(rgba: Uint8Array, w: number, h: number, bgTolerance: number): Mask`
  - `robustExtent(mask: Mask, coverFrac: number): Extent`
  - `cropToContent(mask: Mask, coverFrac: number): Mask`
  - `mirrorX(mask: Mask): Mask`

- [ ] **Step 1: Write the failing test**

```ts
// test/port-view-carving.test.ts
import { describe, it, expect } from 'vitest';
import {
  extractSilhouette, robustExtent, cropToContent, mirrorX, type Mask,
} from '../examples/kaohsiung-port/scene/viewCarving';

// Build an RGBA buffer: uniform bg, with a foreground rect painted in fg color.
function makeRgba(w: number, h: number, bg: [number,number,number], rects: {x0:number;y0:number;x1:number;y1:number;color:[number,number,number]}[]): Uint8Array {
  const a = new Uint8Array(w*h*4);
  for (let i=0;i<w*h;i++){ a[i*4]=bg[0]; a[i*4+1]=bg[1]; a[i*4+2]=bg[2]; a[i*4+3]=255; }
  for (const r of rects) for (let y=r.y0;y<=r.y1;y++) for (let x=r.x0;x<=r.x1;x++){
    const i=(y*w+x)*4; a[i]=r.color[0]; a[i+1]=r.color[1]; a[i+2]=r.color[2];
  }
  return a;
}
const bg: [number,number,number] = [168,184,188]; // the screenshots' blue-grey

describe('extractSilhouette', () => {
  it('marks the foreground rect as 1 and background as 0', () => {
    const w=20,h=20;
    const rgba = makeRgba(w,h,bg,[{x0:5,y0:5,x1:14,y1:14,color:[200,60,40]}]);
    const m = extractSilhouette(rgba,w,h,40);
    expect(m.data[10*w+10]).toBe(1); // center of rect = fg
    expect(m.data[0]).toBe(0);       // corner = bg
  });

  it('keeps an enclosed background-coloured hole as foreground (filled silhouette)', () => {
    const w=20,h=20;
    // big fg rect 4..15, with a bg-coloured 1px hole at (10,10) fully enclosed
    const rgba = makeRgba(w,h,bg,[{x0:4,y0:4,x1:15,y1:15,color:[200,60,40]}]);
    const i=(10*w+10)*4; rgba[i]=bg[0]; rgba[i+1]=bg[1]; rgba[i+2]=bg[2]; // poke a bg hole
    const m = extractSilhouette(rgba,w,h,40);
    expect(m.data[10*w+10]).toBe(1); // enclosed hole stays filled (not reachable from border)
  });
});

describe('robustExtent', () => {
  it('ignores a 1px-wide spike when finding the extent', () => {
    const w=30,h=30; const data=new Uint8Array(w*h);
    for (let y=10;y<=20;y++) for (let x=10;x<=20;x++) data[y*w+x]=1; // solid 11x11 block
    for (let y=0;y<10;y++) data[y*w+15]=1;                          // 1px spike upward
    const e = robustExtent({data,w,h}, 0.1);
    expect(e.y0).toBe(10); // spike ignored (coverage below threshold)
    expect(e.x0).toBe(10); expect(e.x1).toBe(20); expect(e.y1).toBe(20);
  });
});

describe('cropToContent', () => {
  it('crops to the robust block size', () => {
    const w=30,h=30; const data=new Uint8Array(w*h);
    for (let y=10;y<=20;y++) for (let x=5;x<=24;x++) data[y*w+x]=1; // 20 wide x 11 tall
    const c = cropToContent({data,w,h}, 0.1);
    expect(c.w).toBe(20); expect(c.h).toBe(11);
  });
});

describe('mirrorX', () => {
  it('flips along width', () => {
    const m: Mask = { data: new Uint8Array([1,0, 0,0]), w:2, h:2 };
    const r = mirrorX(m);
    expect(Array.from(r.data)).toEqual([0,1, 0,0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/port-view-carving.test.ts`
Expected: FAIL — "Failed to resolve import '../examples/kaohsiung-port/scene/viewCarving'".

- [ ] **Step 3: Write minimal implementation**

```ts
// examples/kaohsiung-port/scene/viewCarving.ts
import { normalizeToUnit, voxelDownsample } from './meshSampling';

export interface Mask { data: Uint8Array; w: number; h: number }
export interface Extent { x0: number; x1: number; y0: number; y1: number }

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
    if (fg[p] === 0) return;       // already marked background
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

/** Robust bbox: only count rows/cols whose foreground coverage ≥ coverFrac × span → ignores
 *  1–2px masts/antennas/booms that would otherwise inflate the extent. */
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/port-view-carving.test.ts`
Expected: PASS (all Task-1 describes green).

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/scene/viewCarving.ts test/port-view-carving.test.ts
git commit -m "feat(port): viewCarving silhouette extraction + robust crop"
```

---

### Task 2: Mask sampling + grid registration — `viewCarving.ts` (part 2)

**Files:**
- Modify: `examples/kaohsiung-port/scene/viewCarving.ts` (append)
- Test: `test/port-view-carving.test.ts` (append)

**Interfaces:**
- Consumes: `Mask` (Task 1).
- Produces:
  - `interface GridDims { nx: number; ny: number; nz: number }` (x=beam, y=height, z=length)
  - `sampleMask(m: Mask, u: number, v: number): number` (nearest; u,v in [0,1); 0 if out of range)
  - `unionMask(a: Mask, b: Mask): Mask` (b resampled onto a's grid, then OR)
  - `registerGrid(side: Mask, top: Mask, front: Mask, gridLong: number): GridDims`

- [ ] **Step 1: Write the failing test**

```ts
// append to test/port-view-carving.test.ts
import { sampleMask, unionMask, registerGrid, type GridDims } from '../examples/kaohsiung-port/scene/viewCarving';

function solid(w: number, h: number): Mask { return { data: new Uint8Array(w*h).fill(1), w, h }; }

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
    const a: Mask = { data: new Uint8Array(4*4), w:4, h:4 };          // empty
    const b = solid(8,8);                                              // full (higher res)
    const u = unionMask(a, b);
    expect(u.w).toBe(4); expect(u.h).toBe(4);
    expect(Array.from(u.data).every((v) => v === 1)).toBe(true);
  });
});

describe('registerGrid', () => {
  it('anchors length to gridLong and derives beam/height from aspect ratios', () => {
    // side: length(w)=200, height(h)=50 → ny = 160*50/200 = 40
    // top:  length(w)=200, beam(h)=40   → nx = 160*40/200 = 32
    const side = solid(200,50), top = solid(200,40), front = solid(32,40); // front: beam(w)=32,height(h)=40
    const d: GridDims = registerGrid(side, top, front, 160);
    expect(d.nz).toBe(160);
    expect(d.ny).toBe(40);
    expect(d.nx).toBe(32);
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

/** Union b onto a's pixel grid (nearest resample) then OR. Used to merge the opposite-direction
 *  view per axis (already mirror-aligned by the caller). Result lives on a's grid. */
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
git commit -m "feat(port): viewCarving mask sampling + grid registration"
```

---

### Task 3: Visual-hull carve + surface shell + template — `viewCarving.ts` (part 3)

**Files:**
- Modify: `examples/kaohsiung-port/scene/viewCarving.ts` (append)
- Test: `test/port-view-carving.test.ts` (append)

**Interfaces:**
- Consumes: `Mask`, `GridDims`, `sampleMask`, `registerGrid` (Tasks 1–2); `normalizeToUnit`, `voxelDownsample` (`meshSampling`).
- Produces:
  - `carveVisualHull(side: Mask, top: Mask, front: Mask, dims: GridDims, frontMaskMaxHeightFrac: number): Uint8Array` (length nx*ny*nz; index `(iz*ny+iy)*nx+ix`)
  - `surfaceShell(grid: Uint8Array, dims: GridDims): Float32Array` (packed xyz in grid coords: x=beam, y=height, z=length)
  - `interface CarveCfg { gridLong: number; bgTolerance: number; coverFrac: number; frontMaskMaxHeightFrac: number; cellFrac: number; signForward: 1 | -1 }`
  - `carveToTemplate(side: Mask, top: Mask, front: Mask, cfg: CarveCfg): Float32Array` (final normalized+downsampled points)

- [ ] **Step 1: Write the failing test**

```ts
// append to test/port-view-carving.test.ts
import { carveVisualHull, surfaceShell, carveToTemplate, type CarveCfg } from '../examples/kaohsiung-port/scene/viewCarving';

describe('carveVisualHull + surfaceShell', () => {
  it('three solid silhouettes carve a hollow box shell', () => {
    const side = solid(40,20), top = solid(40,16), front = solid(16,20);
    const dims = registerGrid(side, top, front, 40); // nz40, ny20, nx16
    const grid = carveVisualHull(side, top, front, dims, 1.0); // front applies everywhere
    // interior voxel is solid...
    const iz=20, iy=10, ix=8;
    expect(grid[(iz*dims.ny+iy)*dims.nx+ix]).toBe(1);
    // ...but the shell excludes it (interior voxel has all 6 neighbours solid)
    const shell = surfaceShell(grid, dims);
    let hasInterior = false;
    for (let i=0;i<shell.length;i+=3) if (shell[i]===ix && shell[i+1]===iy && shell[i+2]===iz) hasInterior = true;
    expect(hasInterior).toBe(false);
    expect(shell.length).toBeGreaterThan(0);
  });

  it('frontMaskMaxHeightFrac prevents a far-end tower from ghosting onto the near end', () => {
    const nz=40, ny=20, nx=16;
    const side = solid(nz,ny);                       // tall everywhere (both ends tall)
    const top  = solid(nz,nx);                       // full beam everywhere
    // front mask: a tower only in the UPPER half, at the LEFT beam half (ux<0.5)
    const front: Mask = { data: new Uint8Array(nx*ny), w:nx, h:ny };
    for (let y=0;y<ny;y++) for (let x=0;x<nx;x++) {
      const upper = y < ny/2;                        // image upper half = high (vImg small = high)
      if (!upper) front.data[y*nx+x] = 1;            // hull (lower) full beam
      else if (x < nx/2) front.data[y*nx+x] = 1;     // tower only left half, upper
    }
    const dims = { nx, ny, nz };
    // With front active full-height, the upper-right would be carved away everywhere (no ghost there anyway);
    // assert the mitigation keeps upper structure as a box (side×top) above the deck fraction:
    const grid = carveVisualHull(side, top, front, dims, 0.5); // front only below mid-height
    // a high voxel on the RIGHT beam half exists (carved by side×top box, NOT cut by front):
    const izHi=20, iyHi=ny-2, ixHi=nx-2;
    expect(grid[(izHi*ny+iyHi)*nx+ixHi]).toBe(1);
  });
});

describe('carveToTemplate', () => {
  it('returns ≤ budget normalized points (x longest ≈1, min-y≈0)', () => {
    const side = solid(120,30), top = solid(120,24), front = solid(24,30);
    const cfg: CarveCfg = { gridLong:120, bgTolerance:40, coverFrac:0.02, frontMaskMaxHeightFrac:0.45, cellFrac:0.03, signForward:1 };
    const pts = carveToTemplate(side, top, front, cfg);
    expect(pts.length % 3).toBe(0);
    expect(pts.length / 3).toBeLessThanOrEqual(1500);
    // x spans ~[-0.5,0.5] (length normalized to 1); min-y ≈ 0
    let minY=Infinity, maxX=-Infinity, minX=Infinity;
    for (let i=0;i<pts.length;i+=3){ minY=Math.min(minY,pts[i+1]); maxX=Math.max(maxX,pts[i]); minX=Math.min(minX,pts[i]); }
    expect(minY).toBeGreaterThanOrEqual(-1e-6);
    expect(maxX - minX).toBeGreaterThan(0.9); // longest axis ≈ 1
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/port-view-carving.test.ts`
Expected: FAIL — `carveVisualHull`/`surfaceShell`/`carveToTemplate` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to examples/kaohsiung-port/scene/viewCarving.ts
/** Orthographic visual hull. A voxel is solid iff inside side(z,y) ∧ top(z,x) ∧ frontConstraint.
 *  frontConstraint: below the deck-height fraction the front silhouette applies (shapes the hull
 *  V/bulwark); above it the front is "open" (=1) so end-towers are carved by side×top box envelopes
 *  only — removes the two-tower ghosting artifact. */
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
}

/** Full carve: register grid → carve hull → surface shell → normalize (length→x, min-y=0) → voxel downsample. */
export function carveToTemplate(side: Mask, top: Mask, front: Mask, cfg: CarveCfg): Float32Array {
  const dims = registerGrid(side, top, front, cfg.gridLong);
  const grid = carveVisualHull(side, top, front, dims, cfg.frontMaskMaxHeightFrac);
  const shell = surfaceShell(grid, dims);
  const norm = normalizeToUnit(shell, { forwardAxis: 'z', upAxis: 'y', signForward: cfg.signForward });
  return voxelDownsample(norm.positions, cfg.cellFrac);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/port-view-carving.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS; tsc 0 errors.

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/scene/viewCarving.ts test/port-view-carving.test.ts
git commit -m "feat(port): viewCarving visual-hull carve + surface shell + template"
```

---

### Task 4: Bake CLI — `data/scan-views.ts` + npm script + gitignore

**Files:**
- Create: `examples/kaohsiung-port/data/scan-views.ts`
- Modify: `package.json` (add `port:scan-views` script)
- Modify: `.gitignore` (ignore raw views)
- Test: `test/port-scan-views.test.ts`

**Interfaces:**
- Consumes: `viewCarving` (Tasks 1–3); `sharp`.
- Produces:
  - `classifyView(filename: string): 'front'|'stern'|'side'|'side2'|'top'|'bottom'|null` (pure)
  - `decodeMask(buf: Buffer, bgTolerance: number): Promise<Mask>` (sharp decode → `extractSilhouette`)
  - `bakeCategory(viewsDir: string, cfg: CarveCfg): Promise<{ points: number[]; count: number }>`

- [ ] **Step 1: Write the failing test** (pure `classifyView` + a sharp encode→decode round-trip for `decodeMask`)

```ts
// test/port-scan-views.test.ts
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { classifyView, decodeMask } from '../examples/kaohsiung-port/data/scan-views';

describe('classifyView', () => {
  it('maps filename keywords to view kinds', () => {
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
    expect(m.data[10*20+10]).toBe(1); // rect center fg
    expect(m.data[0]).toBe(0);        // corner bg
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/port-scan-views.test.ts`
Expected: FAIL — cannot resolve `../examples/kaohsiung-port/data/scan-views`.

- [ ] **Step 3: Write minimal implementation**

```ts
// examples/kaohsiung-port/data/scan-views.ts
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  extractSilhouette, cropToContent, mirrorX, unionMask, carveToTemplate,
  type Mask, type CarveCfg,
} from '../scene/viewCarving';

const HERE = dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = join(HERE, 'models', 'views');
const OUT_DIR = join(HERE, 'ship-models');

export type ViewKind = 'front' | 'stern' | 'side' | 'side2' | 'top' | 'bottom';

const DEFAULT_CFG: CarveCfg = {
  gridLong: 160, bgTolerance: 42, coverFrac: 0.02, frontMaskMaxHeightFrac: 0.45, cellFrac: 0.03, signForward: 1,
};
// Per-category overrides (tune after eyeballing in the browser).
const VIEW_BAKE_CONFIG: Record<string, Partial<CarveCfg>> = {
  // 工程: { cellFrac: 0.03, frontMaskMaxHeightFrac: 0.45 },
};

/** Filename keyword → view kind. Order matters: check the more specific keywords first. */
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
  // sharp raw is RGBA when ensureAlpha(); pack into Uint8Array view.
  return extractSilhouette(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), info.width, info.height, bgTolerance);
}

/** Decode every view in a category dir, crop, mirror-align + union per axis, carve → template points. */
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
  // Per axis: primary mask, OR the mirror-aligned secondary if present.
  const need = (k: ViewKind): Mask => { if (!byKind[k]) throw new Error(`missing required view: ${k}`); return byKind[k]!; };
  let side = need('side');
  if (byKind.side2) side = unionMask(side, mirrorX(byKind.side2));
  let top = need('top');
  if (byKind.bottom) top = unionMask(top, mirrorX(byKind.bottom));
  let front = need('front');
  if (byKind.stern) front = unionMask(front, mirrorX(byKind.stern));
  const pts = carveToTemplate(side, top, front, cfg);
  return { points: Array.from(pts), count: pts.length / 3 };
}

async function main(): Promise<void> {
  let cats: string[] = [];
  try { cats = (await readdir(VIEWS_DIR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name); }
  catch { console.log('No models/views/ dir; nothing to bake.'); return; }
  if (cats.length === 0) { console.log('No category dirs under data/models/views/; drop screenshots and re-run.'); return; }
  console.log(`Carving ${cats.length} category(ies)…`);
  for (const cat of cats) {
    const cfg = { ...DEFAULT_CFG, ...(VIEW_BAKE_CONFIG[cat] ?? {}) };
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

// Run as CLI (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Add the npm script and gitignore entry**

In `package.json` `scripts`, after the `port:models` line, add:
```json
    "port:scan-views": "vite-node examples/kaohsiung-port/data/scan-views.ts",
```
In `.gitignore`, add:
```
examples/kaohsiung-port/data/models/views/
```

- [ ] **Step 5: Run tests + type-check**

Run: `npx vitest run test/port-scan-views.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS; tsc 0 errors.

- [ ] **Step 6: Commit**

```bash
git add examples/kaohsiung-port/data/scan-views.ts test/port-scan-views.test.ts package.json .gitignore
git commit -m "feat(port): port:scan-views CLI (multi-view → point cloud baker)"
```

---

### Task 5: Bake the dredger + wire into the scene + browser-verify

**Prerequisite (user-supplied, like the yacht glb):**
- 6 screenshots saved into `examples/kaohsiung-port/data/models/views/工程/` named so `classifyView` maps them: `front.png`, `stern.png`, `side.png`, `side2.png`, `top.png`, `bottom.png`.
- Dredger source URL + license (for `CREDITS.md`).

If the screenshots are not yet in place, STOP and ask the user to drop them before this task.

**Files:**
- Modify: `examples/kaohsiung-port/scene/shipModels.ts` (import + `RAW`)
- Create (baked, committed): `examples/kaohsiung-port/data/ship-models/工程.json`
- Modify: `examples/kaohsiung-port/data/models/CREDITS.md`
- (No test file — verification is the bake output + browser eyeball.)

**Interfaces:**
- Consumes: `bakeCategory` via `npm run port:scan-views` (Task 4); `RAW` registry (`scene/shipModels.ts`).
- Produces: a stereoscopic 工程 ship at runtime (no new exported API).

- [ ] **Step 1: Bake**

Run: `export npm_config_cache=/tmp/npmcache && npm run port:scan-views`
Expected: `  ✓ 工程 → ship-models/工程.json (NNNN pts)` with **NNNN ≤ 1500**. If > 1500, raise `cellFrac` in `VIEW_BAKE_CONFIG['工程']` and re-run. If a "missing required view" error: check filenames against `classifyView`.

- [ ] **Step 2: Wire into the RAW registry**

In `examples/kaohsiung-port/scene/shipModels.ts`, add the import after the yacht import:
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

Run `npm run dev`, open `http://localhost:5173/examples/kaohsiung-port/index.html`. In the console, point the camera at a 工程 vessel (there are ~5 in the AIS data) — same approach used for the yacht:
```js
// find 工程 ship centers
(()=>{const t=window.__twin,out=[];for(const sc of t.shipCenters){const m=t.trackMeta.get(sc.track?.mmsi);if(m?.category==='工程')out.push({name:sc.track?.name,x:+sc.x.toFixed(1),z:+sc.z.toFixed(1)});}return out;})()
// then aim: const e=__twin.engine,c=e.controls; c.minDistance=0.5; c.target.set(X,0.4,Z); e.camera.position.set(X+2,1.5,Z+2.5); c.update();
```
Confirm: reads as a dredger (long low hull + bow bridge + stern tower), **sits on water**, olive colour `[160,175,95]`, correct heading axis (not rotated 90°/oversized), no tower ghosting, console only favicon 404.

Tuning loop (re-bake via `npm run port:scan-views` after editing `VIEW_BAKE_CONFIG['工程']`):
- Rotated/oversized hull → `signForward: -1` or check view filenames.
- Phantom tower at the wrong end → lower `frontMaskMaxHeightFrac` (e.g. 0.35).
- Too dense/sparse → adjust `cellFrac` (larger = fewer points; keep ≤ 1500).
- Background leaking into the silhouette / halo → adjust `bgTolerance`.

- [ ] **Step 5: Update CREDITS.md**

Append a `## 工程 (dredger)` section to `examples/kaohsiung-port/data/models/CREDITS.md` with the model title/author/source URL/license the user provided. If the license is non-commercial, flag it like the yacht's NC note.

- [ ] **Step 6: Commit**

```bash
git add examples/kaohsiung-port/scene/shipModels.ts examples/kaohsiung-port/data/ship-models/工程.json examples/kaohsiung-port/data/models/CREDITS.md
git commit -m "feat(port): add 工程 (dredger) 3D model via multi-view carving"
```
(The raw screenshots under `data/models/views/工程/` stay git-ignored.)

---

## Self-Review

**Spec coverage:**
- `extractSilhouette` (chroma-key, enclosed-hole fill) → Task 1 ✓
- `robustExtent`/`cropToContent` (ignore thin spurs) → Task 1 ✓
- 視圖方向約定 + `mirrorX` alignment → Task 1 (mirrorX) + Task 4 (union of mirror-aligned secondaries) ✓
- `registerGrid` (length-anchored + consistency warn) → Task 2 ✓
- `carveVisualHull` + `frontMaskMaxHeightFrac` ghosting fix → Task 3 ✓
- `surfaceShell` (boundary voxels, hollow) → Task 3 ✓
- Reuse `normalizeToUnit`+`voxelDownsample`, same JSON shape → Task 3 (`carveToTemplate`) + Task 4 (write) ✓
- CLI `port:scan-views`, filename convention, `VIEW_BAKE_CONFIG`, gitignore views → Task 4 ✓
- Wire `RAW['工程']`, point budget ≤1500, browser verify, CREDITS/license → Task 5 ✓
- Tests for ghosting-mitigation + robustExtent → Task 3 + Task 1 ✓

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N" — all steps carry complete code. The single commented-out `VIEW_BAKE_CONFIG['工程']` line is an intentional config template, filled during Task 5 tuning.

**Type consistency:** `Mask`/`Extent`/`GridDims`/`CarveCfg`/`ViewKind` defined once and reused; `carveToTemplate(side, top, front, cfg)` signature matches its caller in `bakeCategory`; grid index `(iz*ny+iy)*nx+ix` identical in `carveVisualHull` and `surfaceShell`; output JSON keys match the GLB path consumed by `toTemplate` (`points` only).

**Note:** Tasks 1–4 are fully self-contained and testable WITHOUT the user's screenshots (pure functions + synthetic sharp round-trip). Only Task 5 needs the real images + license — it can be deferred without blocking 1–4.
