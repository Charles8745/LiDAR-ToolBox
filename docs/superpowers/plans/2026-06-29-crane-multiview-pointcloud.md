# 橋式起重機 multi-view→pointcloud + 靜態地物實例化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把港區「起重機」圖層從程序生成的透空線框升級為「3D 模型軸向截圖 → visual-hull 雕刻」的真實 STS 橋式起重機點雲,於每個 OSM crane 座標靜態實例化、依碼頭線朝水定向;缺模板自動 fallback。

**Architecture:** 沿用 §4m 多視圖管線(`port:scan-views`,baker 零改動)烘出 unit 模板 JSON。新增純邏輯模組 `scene/orient.ts`(碼頭切線 + 水側判定)與 `scene/landmarkModels.ts`(地物模板註冊 + 實例化)。`scene/layers.ts` 新增 `kind:'model'` 分支,重用 `placeModelPoints`(ship)做每座 crane 的 scale+rotate。引擎 `src/` 零改動。

**Tech Stack:** TypeScript、Vite、Vitest、Three.js(僅消費既有 PointCloud)、sharp(僅烘焙期)、vite-node(CLI)。

## Global Constraints

- **引擎 `src/` 零改動** —— 本計畫只動 `examples/kaohsiung-port/**` 與 docs。
- **點數預算**:每座 crane ≤ ~1500 點;靜態層只建一次(非每幀)。以雕刻 `cellFrac` 控密度。
- **測試框架 = Vitest**;測試檔放 `test/`,命名 `port-<topic>.test.ts`;跑單檔 `npx vitest run test/<file> -t '<name>'`,全跑 `npm test`。
- **型別檢查**:每個程式碼任務結束前 `npx tsc --noEmit -p tsconfig.json` 必須 0 錯。
- **世界尺度**:`WORLD_SCALE = 0.025`(1 world unit = 40 m),`S = WORLD_SCALE/0.01 = 2.5`。世界尺寸旋鈕用 `公尺/100 × S` 慣例(例:100 m → `1.0 * S`)。
- **heading 慣例**:heading `h` 對應 (x,z) 平面方向向量 `(cos h, sin h)`(與 `placeModelPoints` 一致:local +x → `(cos h, sin h)`)。
- **原始截圖不進版控**(`data/models/*` 已 gitignore),只 commit 烘出的 `data/ship-models/起重機.json`。
- **每個 commit 訊息結尾加**:`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

---

## File Structure

| 檔案 | 動作 | 職責 |
|---|---|---|
| `examples/kaohsiung-port/scene/orient.ts` | 建立 | 純邏輯:`Seg`/`CraneOrientOpts` 型別、`buildPierSegs`、`nearestPierTangent`、`collectLandPoints`、`waterSideSign`、`craneBoomHeading`。 |
| `test/port-orient.test.ts` | 建立 | `scene/orient.ts` 單元測試。 |
| `examples/kaohsiung-port/main.ts` | 修改 | 去重:改 import `buildPierSegs`/`nearestPierTangent`(移除原地 `Seg`/`nearestPier`)。(Task 5 再切 crane 圖層 kind。) |
| `examples/kaohsiung-port/scene/landmarkModels.ts` | 建立 | 地物模板註冊(`RAW`/`loadLandmarkModel`,重用 ship 的 `toTemplate`/`ShipModelTemplate`)+ 純 `buildModelInstances`(模板×座標→世界點)。 |
| `test/port-landmark-models.test.ts` | 建立 | `scene/landmarkModels.ts` 單元測試。 |
| `examples/kaohsiung-port/scene/layers.ts` | 修改 | `LayerKind` 加 `'model'`;`LayerConfig` 加 `modelKey`/`scaleU`/`orientStepU`/`orientProbeR`/`headingOverrides`;`buildLayerPoints` 加 `'model'` 分支(+ gantry fallback)。 |
| `test/port-layers.test.ts` | 修改 | 加 `'model'` kind 的 fallback 測試。 |
| `examples/kaohsiung-port/data/scan-views.ts` | 修改 | `VIEW_BAKE_CONFIG` 加 `起重機`(`frontMaskMaxHeightFrac:1.0` + `cellFrac`)。 |
| `test/port-scan-views.test.ts` | 修改 | 斷言 `VIEW_BAKE_CONFIG['起重機']` 設定值。 |
| `examples/kaohsiung-port/data/models/views/起重機/*.png` | (使用者放) | 軸向截圖(gitignore)。 |
| `examples/kaohsiung-port/data/ship-models/起重機.json` | (Task 5 烘出) | unit 模板;commit。 |
| `examples/kaohsiung-port/data/models/CREDITS.md` | (Task 5 視情況) | 第三方模型授權。 |

---

## Task 1: `scene/orient.ts` — 碼頭對齊與水側判定(純邏輯)

**Files:**
- Create: `examples/kaohsiung-port/scene/orient.ts`
- Test: `test/port-orient.test.ts`
- Modify: `examples/kaohsiung-port/main.ts:62-81`(移除本地 `Seg`/`pierSegs` 迴圈/`nearestPier`)、`main.ts` 原 `:95` 的 `nearestPier` 呼叫(replace 後行號上移 ~18 → 以文字定位、勿用行號)

**Interfaces:**
- Consumes: `Projection`/`World`(`../geo/projection`)、`OsmGeometry`/`Polyline`/`LatLon`(`../data/osm`)。
- Produces:
  - `interface Seg { ax:number; az:number; bx:number; bz:number }`
  - `interface CraneOrientOpts { stepU:number; probeR:number }`
  - `buildPierSegs(piers: Polyline[], proj: Projection): Seg[]`
  - `nearestPierTangent(x:number, z:number, segs: Seg[]): { headingRad:number; distU:number }`
  - `collectLandPoints(osm: OsmGeometry, proj: Projection): World[]`
  - `waterSideSign(center: World, tangentRad:number, land: World[], opts: CraneOrientOpts): 1 | -1`
  - `craneBoomHeading(center: World, segs: Seg[], land: World[], opts: CraneOrientOpts, override?: 1 | -1): number`

- [ ] **Step 1: 寫失敗測試**

`test/port-orient.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  buildPierSegs, nearestPierTangent, collectLandPoints, waterSideSign, craneBoomHeading,
} from '../examples/kaohsiung-port/scene/orient';
import type { OsmGeometry } from '../examples/kaohsiung-port/data/osm';

const idProj = { toWorld: (lat: number, lon: number) => ({ x: lon, z: lat }) } as any;

describe('buildPierSegs', () => {
  it('flattens polylines into world segments', () => {
    const segs = buildPierSegs([[{ lat: 0, lon: 0 }, { lat: 0, lon: 10 }]], idProj);
    expect(segs).toEqual([{ ax: 0, az: 0, bx: 10, bz: 0 }]); // x=lon, z=lat
  });
  it('emits one seg per consecutive vertex pair', () => {
    const segs = buildPierSegs([[{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 0, lon: 2 }]], idProj);
    expect(segs.length).toBe(2);
  });
});

describe('nearestPierTangent', () => {
  const segs = [{ ax: 0, az: 0, bx: 10, bz: 0 }]; // horizontal pier along +x
  it('returns tangent heading 0 and perpendicular distance', () => {
    const r = nearestPierTangent(5, 3, segs);
    expect(r.headingRad).toBeCloseTo(0, 6);
    expect(r.distU).toBeCloseTo(3, 6);
  });
});

describe('collectLandPoints', () => {
  it('gathers coastline+piers+tanks+breakwater vertices (not cranes/anchorages)', () => {
    const osm: OsmGeometry = {
      coastline: [[{ lat: 0, lon: 0 }]],
      piers: [[{ lat: 1, lon: 1 }]],
      breakwater: [[{ lat: 2, lon: 2 }]],
      tanks: [[{ lat: 3, lon: 3 }]],
      cranes: [{ lat: 9, lon: 9 }],
      anchorages: [[{ lat: 8, lon: 8 }]],
    };
    const pts = collectLandPoints(osm, idProj);
    expect(pts.length).toBe(4);
  });
});

describe('waterSideSign', () => {
  // pier tangent 0 → perpendiculars are +z (heading +π/2) and -z (heading -π/2).
  it('returns the sign pointing AWAY from the land cluster (fewer features)', () => {
    const land = [{ x: 0, z: 5 }]; // land on +z side
    const sign = waterSideSign({ x: 0, z: 0 }, 0, land, { stepU: 5, probeR: 2 });
    expect(sign).toBe(-1); // water = -z → heading 0 + (-1)*π/2
  });
  it('ties resolve to +1 (leave to manual override)', () => {
    const sign = waterSideSign({ x: 0, z: 0 }, 0, [], { stepU: 5, probeR: 2 });
    expect(sign).toBe(1);
  });
});

describe('craneBoomHeading', () => {
  const segs = [{ ax: -10, az: 0, bx: 10, bz: 0 }]; // tangent 0
  const land = [{ x: 0, z: 5 }];                      // land on +z
  it('combines pier tangent with water side', () => {
    const h = craneBoomHeading({ x: 0, z: 0 }, segs, land, { stepU: 5, probeR: 2 });
    expect(h).toBeCloseTo(-Math.PI / 2, 6); // boom toward water (-z)
  });
  it('honours an explicit override sign', () => {
    const h = craneBoomHeading({ x: 0, z: 0 }, segs, land, { stepU: 5, probeR: 2 }, 1);
    expect(h).toBeCloseTo(Math.PI / 2, 6);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/port-orient.test.ts`
Expected: FAIL —「Failed to resolve import ... scene/orient」。

- [ ] **Step 3: 實作 `scene/orient.ts`**

```ts
// examples/kaohsiung-port/scene/orient.ts
import type { Projection, World } from '../geo/projection';
import type { OsmGeometry, Polyline, LatLon } from '../data/osm';

export interface Seg { ax: number; az: number; bx: number; bz: number; }
export interface CraneOrientOpts { stepU: number; probeR: number; }

const toWorld = (proj: Projection, ll: LatLon): World => proj.toWorld(ll.lat, ll.lon);

/** Flatten OSM pier polylines into world-space line segments. */
export function buildPierSegs(piers: Polyline[], proj: Projection): Seg[] {
  const segs: Seg[] = [];
  for (const poly of piers) {
    const w = poly.map((ll) => toWorld(proj, ll));
    for (let i = 0; i < w.length - 1; i++) segs.push({ ax: w[i].x, az: w[i].z, bx: w[i + 1].x, bz: w[i + 1].z });
  }
  return segs;
}

/** Nearest pier segment: tangent heading (atan2(dz,dx)) and perpendicular distance (world units). */
export function nearestPierTangent(x: number, z: number, segs: Seg[]): { headingRad: number; distU: number } {
  let bestD = Infinity, h = 0;
  for (const s of segs) {
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    const len2 = dx * dx + dz * dz || 1e-9;
    const tt = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / len2));
    const px = s.ax + dx * tt, pz = s.az + dz * tt;
    const d = (x - px) ** 2 + (z - pz) ** 2;
    if (d < bestD) { bestD = d; h = Math.atan2(dz, dx); }
  }
  return { headingRad: h, distU: Math.sqrt(bestD) };
}

/** World-space vertices of the "land" features (coastline + piers + tanks + breakwater). */
export function collectLandPoints(osm: OsmGeometry, proj: Projection): World[] {
  const out: World[] = [];
  const add = (polys: Polyline[]): void => { for (const poly of polys) for (const ll of poly) out.push(toWorld(proj, ll)); };
  add(osm.coastline); add(osm.piers); add(osm.breakwater); add(osm.tanks);
  return out;
}

/** Of the two pier-perpendiculars, the one whose δ-endpoint has FEWER nearby land features = water.
 *  Tie → +1 (caller may force via override). */
export function waterSideSign(center: World, tangentRad: number, land: World[], opts: CraneOrientOpts): 1 | -1 {
  const r2 = opts.probeR * opts.probeR;
  const count = (s: 1 | -1): number => {
    const h = tangentRad + s * (Math.PI / 2);
    const ex = center.x + Math.cos(h) * opts.stepU;
    const ez = center.z + Math.sin(h) * opts.stepU;
    let c = 0;
    for (const p of land) if ((p.x - ex) ** 2 + (p.z - ez) ** 2 <= r2) c++;
    return c;
  };
  const cPlus = count(1), cMinus = count(-1);
  if (cPlus === cMinus) return 1;
  return cPlus < cMinus ? 1 : -1;
}

/** Boom heading = nearest-pier tangent ± 90° toward water (or an explicit override sign). */
export function craneBoomHeading(
  center: World, segs: Seg[], land: World[], opts: CraneOrientOpts, override?: 1 | -1,
): number {
  const { headingRad: tangent } = nearestPierTangent(center.x, center.z, segs);
  const sign = override ?? waterSideSign(center, tangent, land, opts);
  return tangent + sign * (Math.PI / 2);
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/port-orient.test.ts`
Expected: PASS(全部 case)。

- [ ] **Step 5: 去重 main.ts —— 改用 orient.ts**

`main.ts` 頂部 import 區加(緊接其他 `./scene/...` import 之後):

```ts
import { buildPierSegs, nearestPierTangent } from './scene/orient';
```

把 `main.ts:62-81`(從註解「預建碼頭線段…」到 `nearestPier` 函式結尾)**整段**替換為:

```ts
// 預建碼頭線段(世界座標),供靠泊船朝向對齊用(L2:此 feed 無 heading,靜止船朝向不可靠)。
const pierSegs = buildPierSegs(osm.piers, proj);
```

把 main.ts 中這行(原 `:95`;上一段 replace 後行號會上移約 18 → 請以文字內容定位):

```ts
  const np = nearestPier(a.x, a.z);
```

改為:

```ts
  const np = nearestPierTangent(a.x, a.z, pierSegs);
```

(`np.headingRad`/`np.distU` 用法不變。)

- [ ] **Step 6: 型別檢查 + build + 全測試**

Run: `npx tsc --noEmit -p tsconfig.json && npm test`
Expected: tsc 0 錯;全測試綠(含新 `port-orient`)。
Run: `npm run build`
Expected: 成功(確認 main.ts 重構未破壞 app 打包)。

- [ ] **Step 7: Commit**

```bash
git add examples/kaohsiung-port/scene/orient.ts test/port-orient.test.ts examples/kaohsiung-port/main.ts
git commit -m "feat(port): scene/orient — pier-tangent + water-side heuristic, dedupe main.ts nearestPier" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `scene/landmarkModels.ts` — 地物模板註冊 + 實例化(純邏輯)

**Files:**
- Create: `examples/kaohsiung-port/scene/landmarkModels.ts`
- Test: `test/port-landmark-models.test.ts`

**Interfaces:**
- Consumes: `toTemplate`/`placeModelPoints`/`ShipModelTemplate`(`./shipModels`)、`craneBoomHeading`/`Seg`/`CraneOrientOpts`(`./orient`)、`World`(`../geo/projection`)。
- Produces:
  - `loadLandmarkModel(key: string): ShipModelTemplate | null`(空註冊表 → 一律 null,直到 Task 5 接 JSON)
  - `buildModelInstances(tpl: ShipModelTemplate, centers: World[], segs: Seg[], land: World[], opts: CraneOrientOpts, scaleU: number, baseY: number, overrides?: Record<number, 1 | -1>): number[]`

> **與 spec §1 簽章的蓄意差異**:spec 草簽的 `waterSideSign(center,tangentRad,osm,proj,opts)` / `craneBoomHeading(center,osm,proj,segs,overrides?)` 在此改為吃**預先算好**的 `land: World[]`(新增 `collectLandPoints(osm,proj)` 一次算出全部陸地頂點,避免每座 crane 重算)。功能等價、效能更好。

- [ ] **Step 1: 寫失敗測試**

`test/port-landmark-models.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toTemplate } from '../examples/kaohsiung-port/scene/shipModels';
import { loadLandmarkModel, buildModelInstances } from '../examples/kaohsiung-port/scene/landmarkModels';

describe('loadLandmarkModel', () => {
  it('returns null for an unregistered key', () => {
    // 'nope' is never wired by this plan → stable invariant across Task 2 (empty) and Task 5 (crane wired),
    // so no committed test has to be edited when RAW.crane goes live.
    expect(loadLandmarkModel('nope')).toBeNull();
  });
});

describe('buildModelInstances', () => {
  const tpl = toTemplate({ points: [0, 0, 0, 1, 0, 0] }); // 2 pts; #2 at +x unit (boom tip)
  const segs = [{ ax: -10, az: 0, bx: 10, bz: 0 }];        // tangent 0
  const land = [{ x: 0, z: 5 }];                            // land on +z → water = -z
  const opts = { stepU: 5, probeR: 2 };

  it('emits N × template points', () => {
    const out = buildModelInstances(tpl, [{ x: 0, z: 0 }], segs, land, opts, 2, 0);
    expect(out.length).toBe(1 * 2 * 3);
  });

  it('orients boom (+x) toward water and scales by scaleU', () => {
    const out = buildModelInstances(tpl, [{ x: 0, z: 0 }], segs, land, opts, 2, 0);
    // point #1 at template origin → center (0,0,0)
    expect(out[0]).toBeCloseTo(0, 5); expect(out[1]).toBeCloseTo(0, 5); expect(out[2]).toBeCloseTo(0, 5);
    // point #2: local (1,0,0)*2 = (2,0,0); heading -π/2 → (x,z)=(0,-2) → boom toward -z (water)
    expect(out[3]).toBeCloseTo(0, 5);
    expect(out[5]).toBeCloseTo(-2, 5);
  });

  it('honours per-index heading overrides', () => {
    const out = buildModelInstances(tpl, [{ x: 0, z: 0 }], segs, land, opts, 2, 0, { 0: 1 });
    // override +1 → heading +π/2 → boom tip at +z
    expect(out[5]).toBeCloseTo(2, 5);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/port-landmark-models.test.ts`
Expected: FAIL —「Failed to resolve import ... scene/landmarkModels」。

- [ ] **Step 3: 實作 `scene/landmarkModels.ts`**

```ts
// examples/kaohsiung-port/scene/landmarkModels.ts
import type { World } from '../geo/projection';
import { toTemplate, placeModelPoints, type ShipModelTemplate } from './shipModels';
import { craneBoomHeading, type Seg, type CraneOrientOpts } from './orient';

// Baked landmark templates keyed by modelKey. Empty until Task 5 wires the carved JSON:
//   import craneJson from '../data/ship-models/起重機.json';
//   const RAW = { crane: craneJson };
const RAW: Record<string, { points: number[] }> = {};

const cache = new Map<string, ShipModelTemplate>();
export function loadLandmarkModel(key: string): ShipModelTemplate | null {
  const raw = RAW[key];
  if (!raw) return null;
  let t = cache.get(key);
  if (!t) { t = toTemplate(raw); cache.set(key, t); }
  return t;
}

/** Place one unit template at each center: uniform-scale by scaleU, rotate boom (+x) to the
 *  pier-perpendicular-toward-water heading, lift by baseY. Returns a flat xyz array. */
export function buildModelInstances(
  tpl: ShipModelTemplate, centers: World[], segs: Seg[], land: World[],
  opts: CraneOrientOpts, scaleU: number, baseY: number,
  overrides?: Record<number, 1 | -1>,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < centers.length; i++) {
    const c = centers[i];
    const h = craneBoomHeading(c, segs, land, opts, overrides?.[i]);
    // values are regenerated as a constant 0.5 fill by buildLayers (single-colour layer) → pass 0.5.
    const b = placeModelPoints(tpl, c, h, scaleU, baseY, 0.5);
    for (let j = 0; j < b.positions.length; j++) out.push(b.positions[j]);
  }
  return out;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/port-landmark-models.test.ts`
Expected: PASS(全部 case)。

- [ ] **Step 5: 型別檢查**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 0 錯。

- [ ] **Step 6: Commit**

```bash
git add examples/kaohsiung-port/scene/landmarkModels.ts test/port-landmark-models.test.ts
git commit -m "feat(port): scene/landmarkModels — template registry + static instancing" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `scene/layers.ts` — `kind:'model'` 分支 + gantry fallback

**Files:**
- Modify: `examples/kaohsiung-port/scene/layers.ts:6`(import)、`:8`(`LayerKind`)、`:21-41`(`LayerConfig`)、`:57-87`(`buildLayerPoints`)
- Test: `test/port-layers.test.ts`(新增 case)

**Interfaces:**
- Consumes: `loadLandmarkModel`/`buildModelInstances`(`./landmarkModels`)、`buildPierSegs`/`collectLandPoints`(`./orient`)、既有 `sampleGantry`(`./landmarks`)。
- Produces: `LayerKind` 含 `'model'`;`LayerConfig` 新增可選欄位 `modelKey?:string`、`scaleU?:number`、`orientStepU?:number`、`orientProbeR?:number`、`headingOverrides?:Record<number,1|-1>`。

- [ ] **Step 1: 寫失敗測試**(`'model'` kind 在空註冊表時 fallback 回 gantry)

在 `test/port-layers.test.ts` 末端、`buildLayers` describe 之前插入:

```ts
import { sampleGantry } from '../examples/kaohsiung-port/scene/landmarks';

describe("buildLayerPoints kind:'model'", () => {
  const modelCfg: LayerConfig = {
    key: 'crane', label: 'K', source: 'cranes', kind: 'model', color: [70, 80, 90],
    pointSize: 2, maxPointSize: 4, bloomGroup: 4, baseY: 0,
    modelKey: 'crane', scaleU: 1, orientStepU: 1.5, orientProbeR: 1.5,
    legHeight: 0.6, baseW: 0.4, baseD: 0.4, boomLen: 0.5, spacing: 0.1,
  };
  it('falls back to a gantry wireframe when no template is registered', () => {
    const pts = buildLayerPoints(modelCfg, OSM, idProj as any);
    const expected = sampleGantry(
      { x: 5, z: 5 }, 0, { legHeight: 0.6, baseW: 0.4, baseD: 0.4, boomLen: 0.5, spacing: 0.1 },
    ); // OSM.cranes = [{lat:5,lon:5}] → idProj → {x:5,z:5}
    expect(pts.length).toBe(expected.length);
    expect(pts.length).toBeGreaterThan(0);
    expect(pts.length % 3).toBe(0);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/port-layers.test.ts -t "kind:'model'"`
Expected: FAIL — `kind:'model'` 尚無分支 → 落到 zone 分支,對 LatLon node 呼叫 `poly.map` 拋 `TypeError: poly.map is not a function`(cranes 是節點、非 polyline)。

- [ ] **Step 3: 實作 layers.ts 改動**

`layers.ts:6` import 行下方補:

```ts
import { loadLandmarkModel, buildModelInstances } from './landmarkModels';
import { buildPierSegs, collectLandPoints } from './orient';
```

`layers.ts:8` 改:

```ts
export type LayerKind = 'line' | 'cylinder' | 'gantry' | 'zone' | 'model';
```

`LayerConfig`(`layers.ts:21-41`)在 `// zone (node)` 區塊後、結尾 `}` 前補欄位:

```ts
  // model (carved landmark template instanced at each `source` point)
  modelKey?: string; scaleU?: number; orientStepU?: number; orientProbeR?: number;
  headingOverrides?: Record<number, 1 | -1>;
```

`buildLayerPoints`(`layers.ts:57-87`)在 `} else { // zone` 之前插入新分支:

```ts
  } else if (cfg.kind === 'model') {
    const cranePts = raw as LatLon[];
    const tpl = cfg.modelKey ? loadLandmarkModel(cfg.modelKey) : null;
    if (!tpl) { // no baked template → fall back to procedural gantry wireframe
      for (const pt of cranePts) {
        out.push(...sampleGantry(toWorld(proj, pt), cfg.baseY, {
          legHeight: cfg.legHeight ?? 0.6, baseW: cfg.baseW ?? 0.4,
          baseD: cfg.baseD ?? 0.4, boomLen: cfg.boomLen ?? 0.5, spacing: cfg.spacing ?? 0.05,
        }));
      }
      return out;
    }
    const segs = buildPierSegs((osm.piers ?? []) as Polyline[], proj);
    const land = collectLandPoints(osm, proj);
    const centers = cranePts.map((ll) => toWorld(proj, ll));
    const opts = { stepU: cfg.orientStepU ?? 1.5, probeR: cfg.orientProbeR ?? 1.5 };
    // Return directly — do NOT `out.push(...bigArray)`: ~70×1200×3 numbers spread as args overflows
    // the JS call-arg limit (RangeError). The model branch is exclusive, so `out` is still empty here.
    return buildModelInstances(tpl, centers, segs, land, opts, cfg.scaleU ?? 1, cfg.baseY, cfg.headingOverrides);
```

(`sampleGantry` 已在 `layers.ts:6` 既有 import 內;`LatLon`/`Polyline` 已在 `:4` import 內。)

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/port-layers.test.ts`
Expected: PASS(含新 `kind:'model'` case 與既有 case)。

- [ ] **Step 5: 型別檢查 + 全測試**

Run: `npx tsc --noEmit -p tsconfig.json && npm test`
Expected: tsc 0 錯;全測試綠。

- [ ] **Step 6: Commit**

```bash
git add examples/kaohsiung-port/scene/layers.ts test/port-layers.test.ts
git commit -m "feat(port): layers kind:'model' — instanced landmark template with gantry fallback" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `data/scan-views.ts` — crane 雕刻 config

**Files:**
- Modify: `examples/kaohsiung-port/data/scan-views.ts:20-23`(`VIEW_BAKE_CONFIG`)
- Test: `test/port-scan-views.test.ts`(新增 case)

**Interfaces:**
- Produces: `VIEW_BAKE_CONFIG['起重機'] = { frontMaskMaxHeightFrac: 1.0, cellFrac: 0.024 }`(`cellFrac` 為起點,Task 5 依烘出點數實調)。

- [ ] **Step 1: 寫失敗測試**

在 `test/port-scan-views.test.ts` 末端新增:

```ts
import { VIEW_BAKE_CONFIG } from '../examples/kaohsiung-port/data/scan-views';

describe('VIEW_BAKE_CONFIG', () => {
  it('crane uses full-height front mask (no ship anti-tower carve)', () => {
    expect(VIEW_BAKE_CONFIG['起重機']?.frontMaskMaxHeightFrac).toBe(1.0);
  });
  it('crane sets a density knob within budget', () => {
    expect(VIEW_BAKE_CONFIG['起重機']?.cellFrac).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/port-scan-views.test.ts -t "VIEW_BAKE_CONFIG"`
Expected: FAIL —`VIEW_BAKE_CONFIG['起重機']` 為 undefined。

- [ ] **Step 3: 實作 config**

`scan-views.ts` 的 `VIEW_BAKE_CONFIG`(`:20-23`)改為:

```ts
export const VIEW_BAKE_CONFIG: Record<string, Partial<CarveCfg>> = {
  // dredger: 0.022 → 1570 pts (over the 1500 budget); 0.024 → 1230, still reads as a working vessel.
  工程: { cellFrac: 0.024 },
  // STS gantry crane: front view = open portal (two legs + top beam) → front mask must apply at ALL
  // heights (≠ ships' 0.45 anti-tower carve) to cut the leg gap & boom profile. cellFrac tuned post-bake.
  起重機: { frontMaskMaxHeightFrac: 1.0, cellFrac: 0.024 },
};
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/port-scan-views.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/data/scan-views.ts test/port-scan-views.test.ts
git commit -m "feat(port): scan-views VIEW_BAKE_CONFIG 起重機 (full-height front mask)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 烘焙 + 接線 + 瀏覽器目視(**前置:使用者提供軸向截圖;迭代式,非純 TDD**)

> **前置條件(阻塞)**:使用者把 STS 起重機的軸向截圖放 `examples/kaohsiung-port/data/models/views/起重機/`,檔名用乾淨關鍵字 `side.png`/`side2.png`/`front.png`/`stern.png`/`top.png`/`bottom.png`(至少 `side`/`top`/`front` 三軸必需)。背景單色、正投影軸向角度。**沒有截圖前不要開始本任務。**

**Files:**
- Create(烘出): `examples/kaohsiung-port/data/ship-models/起重機.json`
- Modify: `examples/kaohsiung-port/scene/landmarkModels.ts`(接 JSON 進 `RAW`)
- Modify: `examples/kaohsiung-port/main.ts:112`(`LAYERS['crane']` 切 `kind:'model'`)
- Modify(視情況): `examples/kaohsiung-port/data/models/CREDITS.md`

- [ ] **Step 1: 烘焙模板**

Run: `npm run port:scan-views`
Expected: 輸出含 `✓ 起重機 → ship-models/起重機.json (<N> pts)`(可能也重烘 `工程`)。

- [ ] **Step 2: 還原非本次的烘出檔(避免時間戳 churn)**

Run: `git checkout examples/kaohsiung-port/data/ship-models/工程.json`
Expected: 只剩 `起重機.json` 為新增/變更。

- [ ] **Step 3: 接 JSON 進 landmarkModels 註冊表**

`scene/landmarkModels.ts` 頂部 import 區加:

```ts
import craneJson from '../data/ship-models/起重機.json';
```

把空 `RAW` 改為:

```ts
const RAW: Record<string, { points: number[] }> = { crane: craneJson };
```

- [ ] **Step 4: 切 main.ts crane 圖層為 model kind**

`main.ts:112` 的 `crane` 設定改為(保留 gantry 旋鈕當 fallback,新增 model 旋鈕):

```ts
  { key: 'crane',      label: '起重機', source: 'cranes',     kind: 'model',    color: [138, 150, 166], pointSize: 2, maxPointSize: 4, bloomGroup: 4, baseY: 0,       modelKey: 'crane', scaleU: 1.0 * S, orientStepU: 1.5 * S, orientProbeR: 1.5 * S, legHeight: 0.6 * S, baseW: 0.4 * S, baseD: 0.4 * S, boomLen: 0.5 * S, spacing: 0.05 * S },
```

(`scaleU: 1.0 * S` = boom 全跨 ~100 m;`orientStepU/ProbeR: 1.5 * S` = ~150 m 探測。)

- [ ] **Step 5: 型別 + 測試 + build**

Run: `npx tsc --noEmit -p tsconfig.json && npm test && npm run build`
Expected: tsc 0 錯;全測試綠;build 成功。
(註:`port-landmark-models` 的 null 斷言用永不註冊的 `'nope'` → crane 接線後測試仍綠,**不需改動已 commit 的測試**。)

- [ ] **Step 6: 瀏覽器目視驗證(chrome-devtools)**

Run: `npm run dev`(背景),導到 `/examples/kaohsiung-port/index.html`,推近一座貨櫃碼頭起重機。
驗收標準:
- 清楚的 STS 門架 + 懸臂 boom 剪影(外殼包絡、非線框);
- **吊臂朝水/朝船**(非朝內陸);
- 貼地(baseY 0,不浮空/不入地);
- 高度明顯高過鄰近船;鋼灰、低 bloom(結構階層);
- `window.__twin.layers` 找到 crane 層、`pc.count` 合理(70 × 單模板點數,未爆百萬);
- 主控台僅 favicon 404。

- [ ] **Step 7: 依目視結果調旋鈕(迭代)**

- 點數超 1500/座 → 調大 `scan-views.ts` 的 `起重機.cellFrac`(0.024→0.03…)→ 重跑 Step 1–2。
- 太小/太大 → 調 `main.ts` crane 的 `scaleU`(`__twin.layers` 可即時試)。
- 個別起重機吊臂判錯水側 → 記下其在 `osm.cranes` 的 index,填 `headingOverrides`,例:`headingOverrides: { 12: -1, 33: 1 }` 加進 `main.ts:112` 的 crane 設定 → 重新整理目視。
- 軸向歪/鏡像 → 在 `scan-views.ts` 的 `起重機` config 加 `perView`(rotate/flip 救個別視圖)或 `signForward`,重烘。

- [ ] **Step 8: 授權(若截自第三方模型)**

在 `data/models/CREDITS.md` 加一條起重機模型來源/授權(同遊艇/貨櫃格式);若自製則註明無第三方授權問題。

- [ ] **Step 9: Commit**

```bash
git add examples/kaohsiung-port/data/ship-models/起重機.json examples/kaohsiung-port/scene/landmarkModels.ts examples/kaohsiung-port/main.ts examples/kaohsiung-port/data/models/CREDITS.md
git commit -m "feat(port): 橋式起重機 3D — carved STS crane template, pier-aligned static instancing" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 完成後(收尾,非本計畫核心)

- 更新 `docs/superpowers/2026-06-14-handoff.md`(新增本次節點:Task A 第一塊完成、起重機 3D)。
- 更新 `docs/vscode-dev-guide.md`:§4m 補「地物也走多視圖管線」,新增一節描述 `scene/orient.ts` 水側旋鈕 + `kind:'model'` 圖層 + `headingOverrides`。
- 視需要更新記憶索引(港區 track)。

---

## Self-Review(寫計畫者自查)

**Spec 覆蓋**:① 端到端資料流 → Task 4(config)+Task 5(bake/wire);② 水側啟發式 → Task 1;③ crane 雕刻旋鈕 → Task 4;④ 執行期擺放(重用 placeModelPoints)→ Task 2;⑤ 視覺權衡 → Task 5 驗收標準;⑥ fallback+測試 → Task 3(fallback)+各任務測試。`kind:'model'` 可供 Task A 第二塊(儲槽)重用 ✓。

**型別一致**:`Seg`/`CraneOrientOpts`(orient,Task 1)被 landmarkModels(Task 2)、layers(Task 3)消費,簽章一致;`ShipModelTemplate`/`toTemplate`/`placeModelPoints` 重用 shipModels 既有 export;`loadLandmarkModel`/`buildModelInstances` 簽章在 Task 2 定義、Task 3 消費一致;`LayerConfig` 新欄位 Task 3 定義、Task 5 main.ts 使用一致。

**Placeholder**:無 TBD;`cellFrac:0.024` 為明確起點值(Task 5 Step 7 記載實調流程),非佔位。Task 5 為 gated/迭代任務,已標明前置與每步驗收。
