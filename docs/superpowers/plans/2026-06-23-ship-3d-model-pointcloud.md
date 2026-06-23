# GLB 3D 模型 → 點雲烘焙器(船立體化)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓開發者把 glTF/GLB 3D 模型用 CLI 烘焙成正規化點雲模板,執行期把船從平面 footprint 換成依各船 LOA 等比縮放、依 heading 旋轉的立體點雲(缺模型的船型自動 fallback 回平面)。

**Architecture:** 取向 A「正規化模板 + 執行期變換」。純數學取樣(`meshSampling.ts`)與 three 幾何抽取(`meshTriangles.ts`)解耦;CLI(`fetch-ship-models.ts`)把 GLB→三角形→面積加權取樣→正規化單位模板 JSON;執行期 `shipModels.ts` 的 `placeModelPoints` 在 `main.ts` 的 `updateShips` 迴圈內把模板展開成世界座標。引擎 `src/` 完全不動。

**Tech Stack:** TypeScript、three 0.171(含 `examples/jsm/loaders/GLTFLoader`,僅 CLI/型別用)、vitest(node env)、vite-node(CLI runner)。

## Global Constraints

- **引擎 `src/` 零改動** —— 所有新增/修改僅在 `examples/kaohsiung-port/`(延續「加法擴充、洞穴 demo 不受影響」慣例)。
- **不新增 runtime 相依** —— `GLTFLoader` 來自既有 `three` 套件,只在 CLI(Node)與型別匯入使用,不進瀏覽器 bundle 的關鍵路徑。
- **測試**:檔案放 `test/*.test.ts`,`import` 自 `../examples/kaohsiung-port/...`;用 `vitest`(`describe/it/expect`),跑 `npm test`(= `vitest run`)。env 為 node。
- **縮放模式**:等比縮到 LOA —— 模板每軸同倍率 = 該船 `loaU`,**不**依 beam 各軸拉伸。
- **點數預算**:`shipPC` capacity = `300_000`([main.ts](../../../examples/kaohsiung-port/main.ts) 約 120 行),底層 RingBuffer **滿了覆蓋最舊**(超量不報錯但會吃掉先加入的船的點)。每幀預算 = `Σ(該幀可見船的點數)`。模型船每艘 = 烘焙 `count`(預設 300);平面 fallback 船每艘 ~39。**規則**:`count × 尖峰同框船數 < 300_000`(單類別 300×~227 ≈ 68k,安全)。若多船型都啟用立體、尖峰逼近 300k,把 `main.ts` 的 `shipPC` capacity 調高(加法、不影響他層)。
- **JSON import**:`tsconfig.json` 必須有 `resolveJsonModule: true`(Task 5 加),否則 `import …json` 過不了 `tsc`(`bundler` 解析也需要它;`npm run build` 只檢 `src/` 抓不到此錯)。
- **旋轉慣例**:必須沿用 `sampleShipFootprint` —— local +x(長軸)→ 世界 `(cos h, sin h)`、local +z(寬)→ `(−sin h, cos h)`(在 (x,z) 平面)。
- **模板座標約定**:正規化單位空間 —— 長軸 = +x、x/z 置中、**min-y = 0**(龍骨貼 y=0)。
- **缺模型 fallback**:`CATEGORY_MODEL_KEYS` 初始全為 `null` → 行為等同現狀(全平面 footprint);逐型補 GLB 後才換立體。
- 參考 spec:[docs/superpowers/specs/2026-06-23-ship-3d-model-pointcloud-design.md](../specs/2026-06-23-ship-3d-model-pointcloud-design.md)。

---

### Task 1: Seeded PRNG + 面積加權表面取樣 `surfaceSample`

**Files:**
- Create: `examples/kaohsiung-port/scene/meshSampling.ts`
- Test: `test/port-mesh-sampling.test.ts`

**Interfaces:**
- Consumes: 無(本檔為純數學起點)。
- Produces:
  - `export interface Vec3 { x: number; y: number; z: number }`
  - `export interface Triangle { a: Vec3; b: Vec3; c: Vec3 }`
  - `export function mulberry32(seed: number): () => number`(回傳 `[0,1)` PRNG)
  - `export function surfaceSample(tris: Triangle[], count: number, rng: () => number): Float32Array`(長度 `count*3`,xyz 連續)

- [ ] **Step 1: Write the failing test**

```ts
// test/port-mesh-sampling.test.ts
import { describe, it, expect } from 'vitest';
import { mulberry32, surfaceSample, type Triangle } from '../examples/kaohsiung-port/scene/meshSampling';

// 單一三角形落在 z=0 平面 → 所有取樣點應 z≈0 且在三角形 bbox 內。
const flat: Triangle = { a: { x: 0, y: 0, z: 0 }, b: { x: 4, y: 0, z: 0 }, c: { x: 0, y: 3, z: 0 } };

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const r1 = mulberry32(42), r2 = mulberry32(42);
    expect(r1()).toBe(r2());
    expect(r1()).toBe(r2());
  });
});

describe('surfaceSample', () => {
  it('returns count*3 floats', () => {
    const out = surfaceSample([flat], 100, mulberry32(1));
    expect(out.length).toBe(300);
  });

  it('keeps points on the source triangle plane (z=0) and inside its bbox', () => {
    const out = surfaceSample([flat], 500, mulberry32(7));
    for (let i = 0; i < out.length; i += 3) {
      const x = out[i], y = out[i + 1], z = out[i + 2];
      expect(Math.abs(z)).toBeLessThan(1e-6);
      expect(x).toBeGreaterThanOrEqual(-1e-6);
      expect(y).toBeGreaterThanOrEqual(-1e-6);
      expect(x / 4 + y / 3).toBeLessThanOrEqual(1 + 1e-6); // inside triangle (hypotenuse x/4+y/3=1)
    }
  });

  it('is deterministic for a given seed', () => {
    const a = surfaceSample([flat], 50, mulberry32(9));
    const b = surfaceSample([flat], 50, mulberry32(9));
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('distributes points by triangle area', () => {
    // big triangle area 8, small area 0.5 → ~16:1. tolerance loose.
    const big: Triangle = { a: { x: 0, y: 0, z: 0 }, b: { x: 4, y: 0, z: 0 }, c: { x: 0, y: 4, z: 0 } };
    const small: Triangle = { a: { x: 10, y: 0, z: 0 }, b: { x: 11, y: 0, z: 0 }, c: { x: 10, y: 1, z: 0 } };
    const out = surfaceSample([big, small], 1700, mulberry32(3));
    let inBig = 0;
    for (let i = 0; i < out.length; i += 3) if (out[i] < 5) inBig++;
    const ratio = inBig / (1700 - inBig);
    expect(ratio).toBeGreaterThan(8); // expected ~16, allow wide margin
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/port-mesh-sampling.test.ts`
Expected: FAIL（`meshSampling` 模組不存在 / 函式未定義）。

- [ ] **Step 3: Write minimal implementation**

```ts
// examples/kaohsiung-port/scene/meshSampling.ts
export interface Vec3 { x: number; y: number; z: number }
export interface Triangle { a: Vec3; b: Vec3; c: Vec3 }

/** Small fast seeded PRNG → reproducible bakes / stable git diffs. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function triArea(t: Triangle): number {
  const ux = t.b.x - t.a.x, uy = t.b.y - t.a.y, uz = t.b.z - t.a.z;
  const vx = t.c.x - t.a.x, vy = t.c.y - t.a.y, vz = t.c.z - t.a.z;
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  return 0.5 * Math.hypot(cx, cy, cz);
}

/** Area-weighted uniform surface sampling. `count` points, xyz packed. */
export function surfaceSample(tris: Triangle[], count: number, rng: () => number): Float32Array {
  const out = new Float32Array(Math.max(0, count) * 3);
  if (tris.length === 0 || count <= 0) return out;
  // Build cumulative-area CDF.
  const cdf = new Float64Array(tris.length);
  let acc = 0;
  for (let i = 0; i < tris.length; i++) { acc += triArea(tris[i]); cdf[i] = acc; }
  const total = acc || 1;
  for (let n = 0; n < count; n++) {
    // Pick a triangle weighted by area (linear scan; tri counts are modest).
    const target = rng() * total;
    let ti = 0;
    while (ti < tris.length - 1 && cdf[ti] < target) ti++;
    const t = tris[ti];
    // Uniform barycentric point: sqrt(r1) keeps it uniform over the area.
    let r1 = rng(), r2 = rng();
    const su = Math.sqrt(r1);
    const b0 = 1 - su, b1 = su * (1 - r2), b2 = su * r2;
    out[n * 3] = b0 * t.a.x + b1 * t.b.x + b2 * t.c.x;
    out[n * 3 + 1] = b0 * t.a.y + b1 * t.b.y + b2 * t.c.y;
    out[n * 3 + 2] = b0 * t.a.z + b1 * t.b.z + b2 * t.c.z;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/port-mesh-sampling.test.ts`
Expected: PASS（4 個 surfaceSample 案例 + mulberry32 案例全綠）。

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/scene/meshSampling.ts test/port-mesh-sampling.test.ts
git commit -m "feat(port): seeded PRNG + area-weighted surfaceSample"
```

---

### Task 2: 模型正規化 `normalizeToUnit`

**Files:**
- Modify: `examples/kaohsiung-port/scene/meshSampling.ts`
- Modify: `test/port-mesh-sampling.test.ts`

**Interfaces:**
- Consumes: `Vec3` (Task 1)。
- Produces:
  - `export type Axis = 'x' | 'y' | 'z'`
  - `export interface Bounds { min: Vec3; max: Vec3; center: Vec3 }`
  - `export interface NormalizeOpts { forwardAxis: Axis; upAxis: Axis; signForward?: 1 | -1 }`
  - `export function normalizeToUnit(positions: Float32Array, opts: NormalizeOpts): { positions: Float32Array; bounds: Bounds }`
    - 輸出:長軸(x)長度 = 1、x/z 置中、min-y = 0;`bounds` 為**輸入原始** bbox(供記錄真實尺寸)。

- [ ] **Step 1: Write the failing test**

```ts
// append to test/port-mesh-sampling.test.ts
import { normalizeToUnit } from '../examples/kaohsiung-port/scene/meshSampling';

// helper: pack a list of xyz into Float32Array
function pack(pts: number[][]): Float32Array {
  const a = new Float32Array(pts.length * 3);
  pts.forEach((p, i) => { a[i * 3] = p[0]; a[i * 3 + 1] = p[1]; a[i * 3 + 2] = p[2]; });
  return a;
}

describe('normalizeToUnit', () => {
  // A box spanning x:[0,4] (long), y:[0,1], z:[0,2]; forward already +x, up +y.
  const box = pack([
    [0, 0, 0], [4, 0, 0], [0, 1, 0], [0, 0, 2], [4, 1, 2],
  ]);

  it('scales the long (x) axis span to 1, uniformly', () => {
    const { positions } = normalizeToUnit(box, { forwardAxis: 'x', upAxis: 'y' });
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      minX = Math.min(minX, positions[i]); maxX = Math.max(maxX, positions[i]);
      minZ = Math.min(minZ, positions[i + 2]); maxZ = Math.max(maxZ, positions[i + 2]);
    }
    expect(maxX - minX).toBeCloseTo(1, 5);
    expect(maxZ - minZ).toBeCloseTo(2 / 4, 5); // z span 2 scaled by 1/4 (uniform)
  });

  it('centers x and z, and rests min-y at 0', () => {
    const { positions } = normalizeToUnit(box, { forwardAxis: 'x', upAxis: 'y' });
    let minX = Infinity, maxX = -Infinity, minY = Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      minX = Math.min(minX, positions[i]); maxX = Math.max(maxX, positions[i]);
      minY = Math.min(minY, positions[i + 1]);
      minZ = Math.min(minZ, positions[i + 2]); maxZ = Math.max(maxZ, positions[i + 2]);
    }
    expect(minX + maxX).toBeCloseTo(0, 5); // x centered
    expect(minZ + maxZ).toBeCloseTo(0, 5); // z centered
    expect(minY).toBeCloseTo(0, 5);        // keel on water plane
  });

  it('remaps a +z-forward model so its long axis becomes +x', () => {
    // long axis is z:[0,6]; forwardAxis z → after normalize, x span should be 1.
    const zLong = pack([[0, 0, 0], [0, 0, 6], [1, 0, 0], [0, 2, 3]]);
    const { positions } = normalizeToUnit(zLong, { forwardAxis: 'z', upAxis: 'y' });
    let minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < positions.length; i += 3) { minX = Math.min(minX, positions[i]); maxX = Math.max(maxX, positions[i]); }
    expect(maxX - minX).toBeCloseTo(1, 5);
  });

  it('reports the original input bounds', () => {
    const { bounds } = normalizeToUnit(box, { forwardAxis: 'x', upAxis: 'y' });
    expect(bounds.min).toEqual({ x: 0, y: 0, z: 0 });
    expect(bounds.max).toEqual({ x: 4, y: 1, z: 2 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/port-mesh-sampling.test.ts`
Expected: FAIL（`normalizeToUnit` 未定義）。

- [ ] **Step 3: Write minimal implementation**

```ts
// append to examples/kaohsiung-port/scene/meshSampling.ts
export type Axis = 'x' | 'y' | 'z';
export interface Bounds { min: Vec3; max: Vec3; center: Vec3 }
export interface NormalizeOpts { forwardAxis: Axis; upAxis: Axis; signForward?: 1 | -1 }

const AXES: Axis[] = ['x', 'y', 'z'];
function readAxis(arr: Float32Array, i: number, ax: Axis): number {
  return arr[i + AXES.indexOf(ax)];
}

/**
 * Rotate model so forwardAxis→+x, upAxis→+y (third axis→+z by remap), uniform-scale the
 * long (x) axis span to 1, then translate to x/z-centered with min-y=0 (keel on y=0).
 * `bounds` returned is the ORIGINAL input bbox.
 */
export function normalizeToUnit(positions: Float32Array, opts: NormalizeOpts): { positions: Float32Array; bounds: Bounds } {
  const sign = opts.signForward ?? 1;
  // remaining axis = the one that is neither forward nor up → becomes z
  const sideAxis = AXES.find((a) => a !== opts.forwardAxis && a !== opts.upAxis)!;

  // Remap into x=forward, y=up, z=side.
  const remapped = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    remapped[i] = sign * readAxis(positions, i, opts.forwardAxis);
    remapped[i + 1] = readAxis(positions, i, opts.upAxis);
    remapped[i + 2] = readAxis(positions, i, sideAxis);
  }

  // Bounds of remapped to compute scale/translate; original bounds tracked separately.
  let rMinX = Infinity, rMaxX = -Infinity, rMinY = Infinity, rMinZ = Infinity, rMaxZ = -Infinity;
  let oMinX = Infinity, oMinY = Infinity, oMinZ = Infinity, oMaxX = -Infinity, oMaxY = -Infinity, oMaxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    rMinX = Math.min(rMinX, remapped[i]); rMaxX = Math.max(rMaxX, remapped[i]);
    rMinY = Math.min(rMinY, remapped[i + 1]);
    rMinZ = Math.min(rMinZ, remapped[i + 2]); rMaxZ = Math.max(rMaxZ, remapped[i + 2]);
    oMinX = Math.min(oMinX, positions[i]); oMaxX = Math.max(oMaxX, positions[i]);
    oMinY = Math.min(oMinY, positions[i + 1]); oMaxY = Math.max(oMaxY, positions[i + 1]);
    oMinZ = Math.min(oMinZ, positions[i + 2]); oMaxZ = Math.max(oMaxZ, positions[i + 2]);
  }
  const lenX = rMaxX - rMinX || 1;
  const scale = 1 / lenX;
  const cx = (rMinX + rMaxX) / 2, cz = (rMinZ + rMaxZ) / 2;

  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    out[i] = (remapped[i] - cx) * scale;
    out[i + 1] = (remapped[i + 1] - rMinY) * scale; // min-y → 0
    out[i + 2] = (remapped[i + 2] - cz) * scale;
  }
  return {
    positions: out,
    bounds: {
      min: { x: oMinX, y: oMinY, z: oMinZ },
      max: { x: oMaxX, y: oMaxY, z: oMaxZ },
      center: { x: (oMinX + oMaxX) / 2, y: (oMinY + oMaxY) / 2, z: (oMinZ + oMaxZ) / 2 },
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/port-mesh-sampling.test.ts`
Expected: PASS（全部 normalizeToUnit 案例 + Task 1 案例綠）。

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/scene/meshSampling.ts test/port-mesh-sampling.test.ts
git commit -m "feat(port): normalizeToUnit (axis remap, uniform long-axis=1, keel on y=0)"
```

---

### Task 3: three 幾何 → 三角形抽取 `collectTriangles`

**Files:**
- Create: `examples/kaohsiung-port/scene/meshTriangles.ts`
- Test: `test/port-mesh-triangles.test.ts`

**Interfaces:**
- Consumes: `Triangle` (Task 1)、`three` 的 `Object3D`/`Mesh`/`BufferGeometry`。
- Produces:
  - `export function collectTriangles(root: import('three').Object3D): Triangle[]`
    - 遍歷所有 `Mesh`,套用各 mesh 的 world matrix,展開(含 index)成世界座標三角形。

- [ ] **Step 1: Write the failing test**

```ts
// test/port-mesh-triangles.test.ts
import { describe, it, expect } from 'vitest';
import { BoxGeometry, Mesh, MeshBasicMaterial, Group } from 'three';
import { collectTriangles } from '../examples/kaohsiung-port/scene/meshTriangles';

describe('collectTriangles', () => {
  it('expands a box mesh into 12 world-space triangles', () => {
    const mesh = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial());
    const tris = collectTriangles(mesh);
    expect(tris.length).toBe(12); // a box = 6 faces × 2
  });

  it('applies the mesh world transform (translation)', () => {
    const mesh = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial());
    mesh.position.set(100, 0, 0);
    const group = new Group();
    group.add(mesh);
    const tris = collectTriangles(group);
    // every vertex x should be shifted near +100 (box half-extent 1 → x in [99,101]).
    for (const t of tris) for (const v of [t.a, t.b, t.c]) {
      expect(v.x).toBeGreaterThan(98);
      expect(v.x).toBeLessThan(102);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/port-mesh-triangles.test.ts`
Expected: FAIL（`meshTriangles` 未定義）。

- [ ] **Step 3: Write minimal implementation**

```ts
// examples/kaohsiung-port/scene/meshTriangles.ts
import { Mesh, Vector3, type Object3D, type BufferGeometry } from 'three';
import type { Triangle } from './meshSampling';

/** Traverse all meshes under `root`, apply world matrices, return world-space triangles. */
export function collectTriangles(root: Object3D): Triangle[] {
  root.updateWorldMatrix(true, true);
  const out: Triangle[] = [];
  const va = new Vector3(), vb = new Vector3(), vc = new Vector3();
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!(mesh instanceof Mesh)) return;
    const geom = mesh.geometry as BufferGeometry;
    const pos = geom.getAttribute('position');
    if (!pos) return;
    const index = geom.getIndex();
    const triCount = index ? index.count / 3 : pos.count / 3;
    for (let t = 0; t < triCount; t++) {
      const i0 = index ? index.getX(t * 3) : t * 3;
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      va.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld);
      vb.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld);
      vc.fromBufferAttribute(pos, i2).applyMatrix4(mesh.matrixWorld);
      out.push({
        a: { x: va.x, y: va.y, z: va.z },
        b: { x: vb.x, y: vb.y, z: vb.z },
        c: { x: vc.x, y: vc.y, z: vc.z },
      });
    }
  });
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/port-mesh-triangles.test.ts`
Expected: PASS（兩案例綠）。

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/scene/meshTriangles.ts test/port-mesh-triangles.test.ts
git commit -m "feat(port): collectTriangles — three meshes → world-space triangles"
```

---

### Task 4: 烘焙 CLI `port:models`

**Files:**
- Create: `examples/kaohsiung-port/data/fetch-ship-models.ts`
- Modify: `package.json`（新增 script）
- Create: `examples/kaohsiung-port/data/models/.gitkeep`（素材目錄佔位)
- Create: `examples/kaohsiung-port/data/ship-models/.gitkeep`（產物目錄佔位)

**Interfaces:**
- Consumes: `collectTriangles` (Task 3)、`surfaceSample`/`normalizeToUnit`/`mulberry32` (Task 1–2)、`GLTFLoader`（`three/examples/jsm/loaders/GLTFLoader.js`）。
- Produces: 跑 `npm run port:models` → 對 `data/models/*.glb` 逐檔輸出 `data/ship-models/<同名>.json`:
  `{ sourceFile, sampledAt, count, lengthM, forwardAxis, points: number[] }`。
- 無自動單元測試(需 GLB 素材);驗證 = 跑指令 + 檢視產物。

> **MODEL_BAKE_CONFIG**:每個來源檔可指定 `forwardAxis`/`upAxis`/`signForward`/`count`/`seed`。預設 `{ forwardAxis: 'x', upAxis: 'y', signForward: 1, count: 600, seed: 1 }`。鍵 = 不含副檔名的檔名(例如 `貨櫃.glb` → 鍵 `貨櫃`)。

- [ ] **Step 1: 寫 CLI 實作**

```ts
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
```

- [ ] **Step 2: 加 npm script**

在 `package.json` 的 `scripts` 區塊,於 `port:berths` 之後加一行:

```json
    "port:berths": "vite-node examples/kaohsiung-port/data/fetch-berths.ts",
    "port:models": "vite-node examples/kaohsiung-port/data/fetch-ship-models.ts"
```

- [ ] **Step 3: 建空目錄佔位**

```bash
mkdir -p examples/kaohsiung-port/data/models examples/kaohsiung-port/data/ship-models
touch examples/kaohsiung-port/data/models/.gitkeep examples/kaohsiung-port/data/ship-models/.gitkeep
```

- [ ] **Step 4: 煙霧驗證(空目錄)**

Run: `npm run port:models`
Expected: 印出 `No .glb files in data/models/; drop a model and re-run.`,exit 0(無素材時 CLI 不報錯)。

- [ ] **Step 5: 型別檢查**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 0 錯。

- [ ] **Step 6: Commit**

```bash
git add examples/kaohsiung-port/data/fetch-ship-models.ts package.json \
  examples/kaohsiung-port/data/models/.gitkeep examples/kaohsiung-port/data/ship-models/.gitkeep
git commit -m "feat(port): port:models CLI — bake GLB → normalized point-cloud JSON"
```

---

### Task 5: Registry + `placeModelPoints` + `loadShipModel`

**Files:**
- Create: `examples/kaohsiung-port/scene/shipModels.ts`
- Modify: `tsconfig.json`（加 `resolveJsonModule`,讓 Task 7 的 `import …json` 過 tsc)
- Test: `test/port-ship-models.test.ts`

**Interfaces:**
- Consumes: `World`（`../geo/projection`)、`ShipCategory`（`../palette`)、`PointBatch`（`./portPoints`,既有 `{ positions: Float32Array; values: Float32Array }`)。
- Produces:
  - `export interface ShipModelTemplate { points: Float32Array }`（單位空間,長軸 +x、x/z 置中、min-y=0)
  - `export function toTemplate(raw: { points: number[] }): ShipModelTemplate`
  - `export function placeModelPoints(tpl: ShipModelTemplate, center: World, headingRad: number, lengthU: number, baseY: number, v01: number): PointBatch`
  - `export const CATEGORY_MODEL_KEYS: Record<ShipCategory, string | null>`（初始全 `null`)
  - `export function loadShipModel(category: ShipCategory): ShipModelTemplate | null`

- [ ] **Step 1: Write the failing test**

```ts
// test/port-ship-models.test.ts
import { describe, it, expect } from 'vitest';
import { toTemplate, placeModelPoints, loadShipModel } from '../examples/kaohsiung-port/scene/shipModels';

describe('toTemplate', () => {
  it('wraps raw points into a Float32Array template', () => {
    const t = toTemplate({ points: [0, 0, 0, 0.5, 0.2, 0.1] });
    expect(t.points).toBeInstanceOf(Float32Array);
    expect(t.points.length).toBe(6);
  });
});

describe('placeModelPoints', () => {
  const tpl = toTemplate({ points: [0, 0, 0, 0.5, 1, 0.25] }); // two unit-space points

  it('uniform-scales by lengthU and lifts by baseY (heading 0)', () => {
    const b = placeModelPoints(tpl, { x: 10, z: 20 }, 0, 4, 0.5, 0.3);
    // point #1 at origin → (cx, baseY, cz)
    expect(b.positions[0]).toBeCloseTo(10, 5);
    expect(b.positions[1]).toBeCloseTo(0.5, 5);
    expect(b.positions[2]).toBeCloseTo(20, 5);
    // point #2: mx=0.5,my=1,mz=0.25 ; L=4 → x=10+2, y=0.5+4, z=20+1
    expect(b.positions[3]).toBeCloseTo(12, 5);
    expect(b.positions[4]).toBeCloseTo(4.5, 5);
    expect(b.positions[5]).toBeCloseTo(21, 5);
  });

  it('rotates long axis (+x) to (cos h, sin h) — heading 90°', () => {
    const h = Math.PI / 2; // cos0, sin1
    const b = placeModelPoints(tpl, { x: 0, z: 0 }, h, 4, 0, 0.3);
    // point #2 local (mx=0.5,mz=0.25)*L=4 → (2, ,1); rotate: worldX = 2*cos - 1*sin = -1; worldZ = 2*sin + 1*cos = 2
    expect(b.positions[3]).toBeCloseTo(-1, 5);
    expect(b.positions[5]).toBeCloseTo(2, 5);
  });

  it('fills every value with v01', () => {
    const b = placeModelPoints(tpl, { x: 0, z: 0 }, 0, 4, 0, 0.42);
    expect(Array.from(b.values)).toEqual([0.42, 0.42]);
  });
});

describe('loadShipModel', () => {
  it('returns null for categories with no baked model (default state)', () => {
    expect(loadShipModel('貨櫃')).toBeNull();
    expect(loadShipModel('其他')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/port-ship-models.test.ts`
Expected: FAIL（`shipModels` 未定義)。

- [ ] **Step 3: Write minimal implementation**

```ts
// examples/kaohsiung-port/scene/shipModels.ts
import type { World } from '../geo/projection';
import type { ShipCategory } from '../palette';
import { SHIP_CATEGORIES } from '../palette';
import type { PointBatch } from './portPoints';

/** Unit-space model: long axis +x (length 1), x/z centered, min-y=0. Geometry only. */
export interface ShipModelTemplate { points: Float32Array }

export function toTemplate(raw: { points: number[] }): ShipModelTemplate {
  return { points: new Float32Array(raw.points) };
}

/**
 * Expand a unit template into world points for one ship: uniform-scale every axis by
 * `lengthU` (= the ship's LOA in world units), rotate the long axis (+x) to (cos h, sin h)
 * matching sampleShipFootprint, lift by baseY (template min-y=0 → rests on water).
 */
export function placeModelPoints(
  tpl: ShipModelTemplate, center: World, headingRad: number, lengthU: number, baseY: number, v01: number,
): PointBatch {
  const src = tpl.points;
  const n = src.length / 3;
  const positions = new Float32Array(n * 3);
  const values = new Float32Array(n);
  const cos = Math.cos(headingRad), sin = Math.sin(headingRad);
  for (let i = 0; i < n; i++) {
    const mx = src[i * 3] * lengthU;
    const my = src[i * 3 + 1] * lengthU;
    const mz = src[i * 3 + 2] * lengthU;
    positions[i * 3] = center.x + mx * cos - mz * sin;
    positions[i * 3 + 1] = baseY + my;
    positions[i * 3 + 2] = center.z + mx * sin + mz * cos;
    values[i] = v01;
  }
  return { positions, values };
}

// ── Registry ──────────────────────────────────────────────────────────────
// Baked templates keyed by category. To enable a model:
//   1. drop data/models/<name>.glb, run `npm run port:models`
//   2. import the JSON below and map the category to it.
// e.g.  import containerJson from '../data/ship-models/貨櫃.json';
const RAW: Partial<Record<ShipCategory, { points: number[] }>> = {
  // 貨櫃: containerJson,
};

export const CATEGORY_MODEL_KEYS: Record<ShipCategory, string | null> = Object.fromEntries(
  SHIP_CATEGORIES.map((c) => [c, RAW[c] ? c : null]),
) as Record<ShipCategory, string | null>;

const cache = new Map<ShipCategory, ShipModelTemplate>();
export function loadShipModel(category: ShipCategory): ShipModelTemplate | null {
  const raw = RAW[category];
  if (!raw) return null;
  let t = cache.get(category);
  if (!t) { t = toTemplate(raw); cache.set(category, t); }
  return t;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/port-ship-models.test.ts`
Expected: PASS（toTemplate / placeModelPoints×3 / loadShipModel 全綠)。

- [ ] **Step 5: 開啟 resolveJsonModule(Task 7 的 JSON import 前置)**

在 `tsconfig.json` 的 `compilerOptions` 加一行(放在 `esModuleInterop` 之後):

```json
    "esModuleInterop": true,
    "resolveJsonModule": true,
```

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 0 錯(此時 `RAW` 仍空、無 JSON import,純粹把基建準備好)。

- [ ] **Step 6: Commit**

```bash
git add examples/kaohsiung-port/scene/shipModels.ts test/port-ship-models.test.ts tsconfig.json
git commit -m "feat(port): shipModels registry + placeModelPoints + loadShipModel"
```

---

### Task 6: 接進 `updateShips`(立體 / fallback 平面)

**Files:**
- Modify: `examples/kaohsiung-port/main.ts`（`updateShips` 迴圈,約 134–153 行;import 區)

**Interfaces:**
- Consumes: `loadShipModel`/`placeModelPoints` (Task 5)、既有迴圈變數 `c`(World 船位)、`loaU`、`h`、`v01`、`SHIP_Y`、`meta.category`、`spacing`。
- Produces: 行為變更 —— 有模板的船型畫立體點雲,無模板者 fallback 現有 `sampleShipFootprint`。對外介面/HUD 不變。

- [ ] **Step 1: 加 import**

在 `main.ts` 既有 `import { sampleShipFootprint, TYPE_DIMS_M } from './scene/portPoints';` 之後加:

```ts
import { loadShipModel, placeModelPoints } from './scene/shipModels';
```

- [ ] **Step 2: 改 updateShips 迴圈內的取點段**

找到現有這行(`main.ts` 約 151 行):

```ts
    for (const p of sampleShipFootprint(c, loaU, beamU, h, spacing)) { pos.push(p.x, SHIP_Y, p.z); val.push(v01); }
```

替換為:

```ts
    const tpl = loadShipModel(meta.category);
    if (tpl) {
      const batch = placeModelPoints(tpl, c, h, loaU, SHIP_Y, v01);
      for (let k = 0; k < batch.positions.length; k += 3) {
        pos.push(batch.positions[k], batch.positions[k + 1], batch.positions[k + 2]);
        val.push(batch.values[k / 3]);
      }
    } else {
      for (const p of sampleShipFootprint(c, loaU, beamU, h, spacing)) { pos.push(p.x, SHIP_Y, p.z); val.push(v01); }
    }
```

- [ ] **Step 3: 型別檢查**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 0 錯。

- [ ] **Step 4: 全測試 + build**

Run: `npm test && npm run build`
Expected: 全綠(現有 182 + 新增約 13 案例)、build 成功。

- [ ] **Step 5: 瀏覽器煙霧驗證(此時仍全 fallback)**

Run: `npm run dev`,瀏覽器開 `/examples/kaohsiung-port/index.html`。
Expected: 船仍是現有平面 footprint(因 `RAW` 尚空、全 fallback),主控台無 error —— 證明整合無迴歸。

- [ ] **Step 6: Commit**

```bash
git add examples/kaohsiung-port/main.ts
git commit -m "feat(port): updateShips uses ship model templates with footprint fallback"
```

---

### Task 7: 接一個真實模型 + 瀏覽器目視驗證(需使用者 GLB 素材)

> **此 task 需要使用者提供至少一個 `.glb` 船模型。** 在素材到位前可暫停;到位後依下列步驟完成「平面→立體」的可見成果。

**Files:**
- Add(素材): `examples/kaohsiung-port/data/models/<船型>.glb`(使用者準備)
- Generate(產物): `examples/kaohsiung-port/data/ship-models/<船型>.json`(`port:models` 產出)
- Modify: `examples/kaohsiung-port/scene/shipModels.ts`(啟用該模型的 import + RAW 對應)

**Interfaces:**
- Consumes: Task 4 的 `port:models`、Task 5 的 `RAW` 機制。
- Produces: 該船型的船改為立體點雲;其餘船型維持 fallback。

- [ ] **Step 1: 放素材並烘焙**

把模型放成 `data/models/<船型>.glb`(檔名用該 `ShipCategory`,例如 `貨櫃.glb`)。

Run: `npm run port:models`
Expected: 印出 `✓ 貨櫃.glb → ship-models/貨櫃.json (… tris → 300 pts)`,產出 JSON。

- [ ] **Step 2: 啟用 registry 對應**

在 `scene/shipModels.ts`:解除該行 import 註解、並在 `RAW` 加入對應(以「貨櫃」為例):

```ts
import containerJson from '../data/ship-models/貨櫃.json';
const RAW: Partial<Record<ShipCategory, { points: number[] }>> = {
  貨櫃: containerJson,
};
```

- [ ] **Step 3: 型別 + 測試 + build**

Run: `npx tsc --noEmit -p tsconfig.json && npm test && npm run build`
Expected: 0 型別錯、測試全綠、build 成功。

- [ ] **Step 4: 瀏覽器目視驗證**

Run: `npm run dev` → 開 `/examples/kaohsiung-port/index.html`。
逐項確認:
1. 貨櫃船從平面變**立體點雲**(orbit 各角度有體積感、坐在水面非半沉)。
2. 船**依 heading 朝向**(長軸沿航向;靠泊船貼碼頭線)。
3. 其他船型仍是平面 footprint(fallback 正常、無迴歸)。
4. 船型篩選 / 詳情卡點選 / bloom / 播放時間軸照舊。
5. 主控台無 error(favicon 404 可忽略)。

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/data/models examples/kaohsiung-port/data/ship-models \
  examples/kaohsiung-port/scene/shipModels.ts
git commit -m "feat(port): enable container ship 3D model (first baked model)"
```

---

## 完成後

- 更新 handoff(`docs/superpowers/2026-06-14-handoff.md`)新增一節,並更新記憶體索引條目。
- 剩餘 7 個船型逐一補 GLB:重複 Task 7(放素材→`port:models`→啟用 RAW 對應→目視),缺的維持 fallback。
- 若效能不足(目標點/船過高),先降 `MODEL_BAKE_CONFIG[...].count` 重烘;仍不足才考慮 spec 的取向 B(GPU instancing,需動引擎)。

### 已知微調(非 bug,日後可收斂)
- **小船型同 count 浪費**:`placeModelPoints` 對 40m 工作船與 300m 貨櫃船用相同 `count`。工作/拖船型可在 `MODEL_BAKE_CONFIG` 設較低 `count`(如 120)省預算。
- **非預設 forward 軸會鏡像**:`normalizeToUnit` 用軸重映射,若 `forwardAxis`/`upAxis` 造成左右手座標翻轉(例如 forward='z' 把 x↔z 交換,行列式 −1),模型會左右鏡像。對大致對稱的船殼視覺無妨;若模型有不對稱特徵且翻面,改用 `signForward: -1` 或在來源把模型轉正後用預設 `forwardAxis: 'x'`。
- **GLTFLoader 幾何優先**:CLI 只取幾何,不需貼圖。若某 GLB 因內嵌貼圖/特殊擴充讓 `parse` 失敗,最簡解是在來源工具把模型**匯出成無貼圖 GLB** 再烘焙。
