# 高雄港戰情室 — 每類別獨立圖層 + 新增地物(F4)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把靜態地物重構成每類別一個獨立 PointCloud 圖層(config 驅動 registry、`__twin.layers` console 控制),並新增 breakwater / storage_tank(3D)/ crane(3D)/ anchorage。

**Architecture:** 引擎加兩個 per-layer 旋鈕(`setPointSize`、`uBrightness`/`setBrightness`,皆加法、預設不變);app 端新增 `scene/landmarks.ts`(3D 點產生器)與 `scene/layers.ts`(LayerConfig/LayerHandle/buildLayers);`main.ts` 改用一份 `LAYERS` 設定 + 迴圈建層,移除合一的 `basePC`;OSM 解析擴充 node/polygon/seamark,抓取腳本多抓四種 tag 並重烘快照。

**Tech Stack:** TypeScript、Three.js(raw ShaderMaterial 點雲)、Vite、Vitest、OSM Overpass API。

**設計依據:** [docs/superpowers/specs/2026-06-17-kaohsiung-port-per-layer-pointclouds-design.md](../specs/2026-06-17-kaohsiung-port-per-layer-pointclouds-design.md)

---

## 檔案結構(這次會新增/修改)

**引擎(`src/`,加法)**
- `src/core/PointCloud.ts` — 加 `setPointSize()`、`uBrightness` uniform + `setBrightness()`
- `src/shaders/points.frag.glsl` — 最終 rgb 乘 `uBrightness`

**高雄港 app(`examples/kaohsiung-port/`)**
- `data/osm.ts` — `parseOsmWays`→`parseOsm`,`OsmGeometry` 擴 4 欄,支援 node/polygon/seamark
- `data/fetch-osm.ts` — `QUERY` 加 4 種 tag、改用 `parseOsm`
- `data/osm-khh.json` — 重烘(新增欄位)
- `scene/landmarks.ts`(新)— `footprintCentroidRadius` / `sampleCylinderShell` / `sampleGantry` / `sampleZoneRing`
- `scene/layers.ts`(新)— `LayerConfig` / `LayerHandle` / `buildLayerPoints` / `buildLayers`
- `scene/portPoints.ts` — 移除死碼 `buildBaseLayer`(`samplePolyline` 保留)
- `main.ts` — `LAYERS` 設定 + 迴圈、移除 `basePC`、`__twin.layers`、bloom 改 4 組

**測試** — `test/PointCloud.test.ts`(加)、`test/port-osm.test.ts`(改)、`test/port-landmarks.test.ts`(新)、`test/port-layers.test.ts`(新)

---

## Task 1: PointCloud 加 `setPointSize()`(「大小」旋鈕)

**Files:**
- Modify: `src/core/PointCloud.ts`
- Test: `test/PointCloud.test.ts`

- [ ] **Step 1: 寫失敗測試**

在 `test/PointCloud.test.ts` 末尾(最後一個 `});` 之後)新增:
```ts
describe('PointCloud.setPointSize', () => {
  it('drives uPointSize from the option and setPointSize()', () => {
    const pc = new PointCloud({ capacity: 2, ramp, persistence: 'accumulate', pointSize: 2 });
    expect((pc.points.material as THREE.ShaderMaterial).uniforms.uPointSize.value).toBe(2);
    pc.setPointSize(7);
    expect((pc.points.material as THREE.ShaderMaterial).uniforms.uPointSize.value).toBe(7);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/PointCloud.test.ts -t "setPointSize"`
Expected: FAIL（`pc.setPointSize is not a function`）

- [ ] **Step 3: 實作**

在 `src/core/PointCloud.ts` 的 `setPulseHz` 方法之後加:
```ts
  /** Set the point size (uPointSize). */
  setPointSize(px: number): void {
    this.material.uniforms.uPointSize.value = px;
  }
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/PointCloud.test.ts -t "setPointSize"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/PointCloud.ts test/PointCloud.test.ts
git commit -m "$(printf 'feat(engine): PointCloud.setPointSize() live point-size knob\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 2: PointCloud 加 `uBrightness` + `setBrightness()`(「亮度」旋鈕)

**Files:**
- Modify: `src/core/PointCloud.ts`、`src/shaders/points.frag.glsl`
- Test: `test/PointCloud.test.ts`

- [ ] **Step 1: 寫失敗測試**

在 `test/PointCloud.test.ts` 末尾新增:
```ts
describe('PointCloud.setBrightness', () => {
  it('defaults uBrightness to 1 and setBrightness() changes it', () => {
    const pc = new PointCloud({ capacity: 2, ramp, persistence: 'accumulate' });
    expect((pc.points.material as THREE.ShaderMaterial).uniforms.uBrightness.value).toBe(1);
    pc.setBrightness(2.5);
    expect((pc.points.material as THREE.ShaderMaterial).uniforms.uBrightness.value).toBe(2.5);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/PointCloud.test.ts -t "setBrightness"`
Expected: FAIL（`Cannot read properties of undefined (reading 'value')` — uBrightness 不存在)

- [ ] **Step 3: 實作 — 加 uniform + 方法**

在 `src/core/PointCloud.ts` 的 uniforms 區塊,`uPulseHz` 那行之後加:
```ts
        uPulseHz: { value: opts.pulseHz ?? 0 },
        uBrightness: { value: 1 },
```
（保留既有 `uPulseHz` 行,只在其後加 `uBrightness` 行。）

在 `setPointSize` 方法之後加:
```ts
  /** Set the global brightness multiplier (1 = unchanged). */
  setBrightness(b: number): void {
    this.material.uniforms.uBrightness.value = b;
  }
```

- [ ] **Step 4: 實作 — shader 乘上 uBrightness**

在 `src/shaders/points.frag.glsl`,`uniform float uPulseHz;` 那行之後加:
```glsl
uniform float uBrightness;    // global brightness multiplier (1 = unchanged)
```
並在 `if (uPulseHz > 0.0) { ... }` 區塊之後、`gl_FragColor` 之前加一行:
```glsl
  col *= uBrightness;
  gl_FragColor = vec4(col, alpha);
```
（把原本的 `gl_FragColor = vec4(col, alpha);` 替換成上面兩行。)

- [ ] **Step 5: 跑測試確認通過 + 型別檢查**

Run: `npx vitest run test/PointCloud.test.ts -t "setBrightness" && npx tsc --noEmit -p tsconfig.json`
Expected: PASS、tsc 0 錯

- [ ] **Step 6: Commit**

```bash
git add src/core/PointCloud.ts src/shaders/points.frag.glsl test/PointCloud.test.ts
git commit -m "$(printf 'feat(engine): PointCloud uBrightness multiplier + setBrightness()\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 3: OSM 解析擴充(`parseOsmWays`→`parseOsm`,支援 node/polygon/seamark)

**Files:**
- Modify: `examples/kaohsiung-port/data/osm.ts`、`examples/kaohsiung-port/data/fetch-osm.ts`
- Test: `test/port-osm.test.ts`

- [ ] **Step 1: 改寫測試(失敗)**

把 `test/port-osm.test.ts` 整檔換成:
```ts
import { describe, it, expect } from 'vitest';
import { parseOsm, type OverpassDoc } from '../examples/kaohsiung-port/data/osm';

const OVERPASS: OverpassDoc = {
  elements: [
    { type: 'way', tags: { natural: 'coastline' }, geometry: [{ lat: 22.6, lon: 120.27 }, { lat: 22.59, lon: 120.28 }] },
    { type: 'way', tags: { man_made: 'pier' }, geometry: [{ lat: 22.58, lon: 120.31 }, { lat: 22.575, lon: 120.31 }] },
    { type: 'way', tags: { man_made: 'breakwater' }, geometry: [{ lat: 22.55, lon: 120.30 }, { lat: 22.55, lon: 120.31 }] },
    { type: 'way', tags: { man_made: 'storage_tank' }, geometry: [
      { lat: 22.56, lon: 120.30 }, { lat: 22.56, lon: 120.301 }, { lat: 22.561, lon: 120.301 }, { lat: 22.56, lon: 120.30 } ] },
    { type: 'node', tags: { man_made: 'crane' }, lat: 22.57, lon: 120.31 },
    { type: 'node', tags: { 'seamark:type': 'anchorage' }, lat: 22.62, lon: 120.26 },
    { type: 'way', tags: { 'seamark:type': 'anchorage' }, geometry: [{ lat: 22.63, lon: 120.25 }, { lat: 22.63, lon: 120.26 }] },
    { type: 'node', tags: {}, lat: 22.6, lon: 120.3 }, // untagged node → ignored
  ],
};

describe('parseOsm', () => {
  const r = parseOsm(OVERPASS);
  it('classifies coastline / pier ways into polylines', () => {
    expect(r.coastline).toHaveLength(1);
    expect(r.piers).toHaveLength(1);
    expect(r.coastline[0]).toEqual([{ lat: 22.6, lon: 120.27 }, { lat: 22.59, lon: 120.28 }]);
  });
  it('extracts breakwater ways and storage_tank footprints', () => {
    expect(r.breakwater).toHaveLength(1);
    expect(r.tanks).toHaveLength(1);
    expect(r.tanks[0].length).toBe(4);
  });
  it('extracts crane nodes as points', () => {
    expect(r.cranes).toEqual([{ lat: 22.57, lon: 120.31 }]);
  });
  it('extracts anchorage nodes (length-1 polyline) and areas', () => {
    expect(r.anchorages).toHaveLength(2);
    const lens = r.anchorages.map((a) => a.length).sort();
    expect(lens).toEqual([1, 2]); // one node (1), one area (2)
  });
  it('ignores untagged nodes and short ways', () => {
    const r2 = parseOsm({ elements: [
      { type: 'way', tags: { natural: 'coastline' }, geometry: [{ lat: 22.6, lon: 120.27 }] },
      { type: 'node', tags: {}, lat: 1, lon: 1 },
    ] });
    expect(r2.coastline).toHaveLength(0);
    expect(r2.cranes).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/port-osm.test.ts`
Expected: FAIL（`parseOsm` 未匯出)

- [ ] **Step 3: 改寫 `data/osm.ts`**

把 `examples/kaohsiung-port/data/osm.ts` 整檔換成:
```ts
export interface LatLon { lat: number; lon: number; }
export type Polyline = LatLon[];
export interface OsmGeometry {
  coastline: Polyline[];
  piers: Polyline[];
  breakwater: Polyline[];
  tanks: Polyline[];       // closed footprint polygons (man_made=storage_tank)
  cranes: LatLon[];        // man_made=crane nodes
  anchorages: Polyline[];  // seamark anchorage: way→outline, node→length-1 polyline
}

export interface OverpassEl { type: string; tags?: Record<string, string>; geometry?: LatLon[]; lat?: number; lon?: number; }
export interface OverpassDoc { elements: OverpassEl[]; }

/** Split Overpass `out geom` elements into typed geometry buckets. */
export function parseOsm(doc: OverpassDoc): OsmGeometry {
  const coastline: Polyline[] = [];
  const piers: Polyline[] = [];
  const breakwater: Polyline[] = [];
  const tanks: Polyline[] = [];
  const cranes: LatLon[] = [];
  const anchorages: Polyline[] = [];
  for (const el of doc.elements) {
    const t = el.tags ?? {};
    if (el.type === 'node') {
      if (el.lat === undefined || el.lon === undefined) continue;
      const ll = { lat: el.lat, lon: el.lon };
      if (t.man_made === 'crane') cranes.push(ll);
      else if (t['seamark:type'] === 'anchorage') anchorages.push([ll]);
      continue;
    }
    if (el.type === 'way' && el.geometry && el.geometry.length >= 2) {
      const line = el.geometry.map((g) => ({ lat: g.lat, lon: g.lon }));
      if (t.natural === 'coastline') coastline.push(line);
      else if (t.man_made === 'pier') piers.push(line);
      else if (t.man_made === 'breakwater') breakwater.push(line);
      else if (t.man_made === 'storage_tank') tanks.push(line);
      else if (t['seamark:type'] === 'anchorage') anchorages.push(line);
    }
  }
  return { coastline, piers, breakwater, tanks, cranes, anchorages };
}
```

- [ ] **Step 4: 更新 `fetch-osm.ts` 的 import（暫不改 QUERY)**

在 `examples/kaohsiung-port/data/fetch-osm.ts`,把:
```ts
import { parseOsmWays } from './osm';
```
改成:
```ts
import { parseOsm } from './osm';
```
並把:
```ts
const geo = parseOsmWays(await res.json());
```
改成:
```ts
const geo = parseOsm(await res.json());
```

- [ ] **Step 5: 跑測試 + 型別檢查**

Run: `npx vitest run test/port-osm.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS、tsc 0 錯

- [ ] **Step 6: Commit**

```bash
git add examples/kaohsiung-port/data/osm.ts examples/kaohsiung-port/data/fetch-osm.ts test/port-osm.test.ts
git commit -m "$(printf 'feat(port): parseOsm extracts breakwater/tank/crane/anchorage (node+polygon+seamark)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 4: 抓取腳本擴充 4 種 tag + 重烘快照

> **需要網路**(同既有 `npm run port:osm`)。若離線無法執行此 Task;其餘 Task 皆以 fixture 測試、可離線完成。

**Files:**
- Modify: `examples/kaohsiung-port/data/fetch-osm.ts`
- Regenerate: `examples/kaohsiung-port/data/osm-khh.json`

- [ ] **Step 1: 擴充 QUERY**

在 `examples/kaohsiung-port/data/fetch-osm.ts`,把 `QUERY` 換成:
```ts
const QUERY = `[out:json][timeout:120];
(
  way["natural"="coastline"](22.53,120.24,22.64,120.34);
  way["man_made"="pier"](22.53,120.24,22.64,120.34);
  way["man_made"="breakwater"](22.53,120.24,22.64,120.34);
  way["man_made"="storage_tank"](22.53,120.24,22.64,120.34);
  node["man_made"="crane"](22.53,120.24,22.64,120.34);
  nwr["seamark:type"="anchorage"](22.53,120.24,22.64,120.34);
);
out geom;`;
```

並把結尾 log 換成:
```ts
console.log(`wrote ${path}: ${geo.coastline.length} coastline, ${geo.piers.length} piers, ${geo.breakwater.length} breakwater, ${geo.tanks.length} tanks, ${geo.cranes.length} cranes, ${geo.anchorages.length} anchorages`);
```

- [ ] **Step 2: 重烘快照**

Run: `npm run port:osm`
Expected: 印出類似 `... 75 coastline, 88 piers, ~20 breakwater, ~246 tanks, ~70 cranes, ≥1 anchorages`(數字隨 live OSM 微動)。

- [ ] **Step 3: 確認 JSON 含新欄位**

Run: `node -e "const d=require('./examples/kaohsiung-port/data/osm-khh.json'); console.log(Object.keys(d), d.tanks.length, d.cranes.length, d.breakwater.length, d.anchorages.length)"`
Expected: keys 含 `coastline,piers,breakwater,tanks,cranes,anchorages`,且 tanks/cranes 非 0。

- [ ] **Step 4: Commit**

```bash
git add examples/kaohsiung-port/data/fetch-osm.ts examples/kaohsiung-port/data/osm-khh.json
git commit -m "$(printf 'feat(port): fetch breakwater/tank/crane/anchorage from OSM + rebake snapshot\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 5: 3D 產生器 — 圓柱殼(儲槽)+ footprint 幾何

**Files:**
- Create: `examples/kaohsiung-port/scene/landmarks.ts`
- Test: `test/port-landmarks.test.ts`

- [ ] **Step 1: 寫失敗測試**

建 `test/port-landmarks.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { footprintCentroidRadius, sampleCylinderShell } from '../examples/kaohsiung-port/scene/landmarks';

describe('footprintCentroidRadius', () => {
  it('returns centroid and mean radius of a square footprint', () => {
    const { center, radius } = footprintCentroidRadius([
      { x: -1, z: -1 }, { x: 1, z: -1 }, { x: 1, z: 1 }, { x: -1, z: 1 },
    ]);
    expect(center.x).toBeCloseTo(0);
    expect(center.z).toBeCloseTo(0);
    expect(radius).toBeCloseTo(Math.SQRT2); // each corner dist = sqrt(2)
  });
});

describe('sampleCylinderShell', () => {
  it('emits rings*perRing xyz points within [baseY, baseY+height] at the given radius', () => {
    const pts = sampleCylinderShell({ x: 5, z: -3 }, 2, 1, 0.6, 3, 8);
    expect(pts.length).toBe(3 * 8 * 3); // 24 points × xyz
    for (let i = 0; i < pts.length; i += 3) {
      const x = pts[i], y = pts[i + 1], z = pts[i + 2];
      expect(y).toBeGreaterThanOrEqual(1 - 1e-6);
      expect(y).toBeLessThanOrEqual(1.6 + 1e-6);
      expect(Math.hypot(x - 5, z - (-3))).toBeCloseTo(2);
    }
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/port-landmarks.test.ts`
Expected: FAIL（模組不存在)

- [ ] **Step 3: 建 `scene/landmarks.ts`(本 Task 部分)**

```ts
import type { World } from '../geo/projection';

/** Centroid + mean radius of a footprint polygon (world coords). */
export function footprintCentroidRadius(poly: World[]): { center: World; radius: number } {
  const n = poly.length;
  if (n === 0) return { center: { x: 0, z: 0 }, radius: 0 };
  let sx = 0, sz = 0;
  for (const p of poly) { sx += p.x; sz += p.z; }
  const center = { x: sx / n, z: sz / n };
  let sr = 0;
  for (const p of poly) sr += Math.hypot(p.x - center.x, p.z - center.z);
  return { center, radius: sr / n };
}

/** Vertical cylinder shell of points: `rings` levels from baseY to baseY+height, `perRing` points each. */
export function sampleCylinderShell(
  center: World, radius: number, baseY: number, height: number, rings: number, perRing: number,
): number[] {
  const out: number[] = [];
  const R = Math.max(radius, 1e-4);
  const levels = Math.max(2, rings);
  for (let r = 0; r < levels; r++) {
    const y = baseY + (height * r) / (levels - 1);
    for (let k = 0; k < perRing; k++) {
      const a = (k / perRing) * Math.PI * 2;
      out.push(center.x + R * Math.cos(a), y, center.z + R * Math.sin(a));
    }
  }
  return out;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/port-landmarks.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/scene/landmarks.ts test/port-landmarks.test.ts
git commit -m "$(printf 'feat(port): landmarks cylinder-shell generator + footprint geometry\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 6: 3D 產生器 — 龍門骨架(起重機)

**Files:**
- Modify: `examples/kaohsiung-port/scene/landmarks.ts`
- Test: `test/port-landmarks.test.ts`

- [ ] **Step 1: 寫失敗測試**

在 `test/port-landmarks.test.ts` 末尾新增:
```ts
import { sampleGantry } from '../examples/kaohsiung-port/scene/landmarks';

describe('sampleGantry', () => {
  const pts = sampleGantry({ x: 0, z: 0 }, 0, { legHeight: 0.6, baseW: 0.4, baseD: 0.4, boomLen: 0.5, spacing: 0.1 });
  it('emits xyz triples', () => {
    expect(pts.length).toBeGreaterThan(0);
    expect(pts.length % 3).toBe(0);
  });
  it('rises to legHeight and extends along +x by the boom', () => {
    let maxY = -Infinity, minY = Infinity, maxX = -Infinity;
    for (let i = 0; i < pts.length; i += 3) {
      maxY = Math.max(maxY, pts[i + 1]); minY = Math.min(minY, pts[i + 1]);
      maxX = Math.max(maxX, pts[i]);
    }
    expect(maxY).toBeCloseTo(0.6);          // top
    expect(minY).toBeCloseTo(0);            // base
    expect(maxX).toBeCloseTo(0.2 + 0.5);    // hw(0.2) + boomLen(0.5)
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/port-landmarks.test.ts -t "sampleGantry"`
Expected: FAIL（`sampleGantry` 未匯出)

- [ ] **Step 3: 實作 — 在 `scene/landmarks.ts` 加 helper + `sampleGantry`**

在檔案末尾加:
```ts
interface P3 { x: number; y: number; z: number; }
function linePts(a: P3, b: P3, spacing: number, out: number[]): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const steps = Math.max(1, Math.round(len / spacing));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    out.push(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
  }
}

/** Stylized container-gantry skeleton of points at `center`, base on baseY, boom along +x. */
export function sampleGantry(
  center: World, baseY: number,
  opts: { legHeight: number; baseW: number; baseD: number; boomLen: number; spacing: number },
): number[] {
  const { legHeight, baseW, baseD, boomLen, spacing } = opts;
  const hw = baseW / 2, hd = baseD / 2;
  const top = baseY + legHeight;
  const out: number[] = [];
  const corners = [
    { x: center.x - hw, z: center.z - hd },
    { x: center.x + hw, z: center.z - hd },
    { x: center.x + hw, z: center.z + hd },
    { x: center.x - hw, z: center.z + hd },
  ];
  for (const c of corners) linePts({ x: c.x, y: baseY, z: c.z }, { x: c.x, y: top, z: c.z }, spacing, out); // 4 legs
  for (let i = 0; i < 4; i++) {                                                                              // top frame
    const a = corners[i], b = corners[(i + 1) % 4];
    linePts({ x: a.x, y: top, z: a.z }, { x: b.x, y: top, z: b.z }, spacing, out);
  }
  linePts({ x: center.x - hw, y: top, z: center.z }, { x: center.x + hw + boomLen, y: top, z: center.z }, spacing, out); // boom +x
  return out;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/port-landmarks.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/scene/landmarks.ts test/port-landmarks.test.ts
git commit -m "$(printf 'feat(port): landmarks gantry-skeleton generator for cranes\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 7: 3D 產生器 — 錨地圓框

**Files:**
- Modify: `examples/kaohsiung-port/scene/landmarks.ts`
- Test: `test/port-landmarks.test.ts`

- [ ] **Step 1: 寫失敗測試**

在 `test/port-landmarks.test.ts` 末尾新增:
```ts
import { sampleZoneRing } from '../examples/kaohsiung-port/scene/landmarks';

describe('sampleZoneRing', () => {
  it('emits count ring points at radius plus a center point', () => {
    const pts = sampleZoneRing({ x: 2, z: 2 }, 1.5, 0.05, 12);
    expect(pts.length).toBe((12 + 1) * 3); // 12 ring + 1 center
    // last triple is the center
    const n = pts.length;
    expect([pts[n - 3], pts[n - 2], pts[n - 1]]).toEqual([2, 0.05, 2]);
    // every ring point sits at radius from center, at y
    for (let i = 0; i < 12 * 3; i += 3) {
      expect(pts[i + 1]).toBeCloseTo(0.05);
      expect(Math.hypot(pts[i] - 2, pts[i + 2] - 2)).toBeCloseTo(1.5);
    }
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/port-landmarks.test.ts -t "sampleZoneRing"`
Expected: FAIL（未匯出)

- [ ] **Step 3: 實作 — 在 `scene/landmarks.ts` 加 `sampleZoneRing`**

在檔案末尾加:
```ts
/** Flat ring outline of `count` points at `radius` around `center` at height `y`, plus a center point. */
export function sampleZoneRing(center: World, radius: number, y: number, count: number): number[] {
  const out: number[] = [];
  const n = Math.max(3, count);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    out.push(center.x + radius * Math.cos(a), y, center.z + radius * Math.sin(a));
  }
  out.push(center.x, y, center.z); // center dot
  return out;
}
```

- [ ] **Step 4: 跑測試確認通過 + 型別檢查**

Run: `npx vitest run test/port-landmarks.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS、tsc 0 錯

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/scene/landmarks.ts test/port-landmarks.test.ts
git commit -m "$(printf 'feat(port): landmarks zone-ring generator for anchorages\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 8: 圖層 registry(`scene/layers.ts`)

**Files:**
- Create: `examples/kaohsiung-port/scene/layers.ts`
- Test: `test/port-layers.test.ts`

- [ ] **Step 1: 寫失敗測試**

建 `test/port-layers.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildLayers, buildLayerPoints, type LayerConfig } from '../examples/kaohsiung-port/scene/layers';
import type { OsmGeometry } from '../examples/kaohsiung-port/data/osm';

const idProj = { toWorld: (lat: number, lon: number) => ({ x: lon, z: lat }) };

const OSM: OsmGeometry = {
  coastline: [[{ lat: 0, lon: 0 }, { lat: 0, lon: 10 }]],
  piers: [],
  breakwater: [],
  tanks: [[{ lat: 0, lon: 0 }, { lat: 0, lon: 2 }, { lat: 2, lon: 2 }, { lat: 2, lon: 0 }]],
  cranes: [{ lat: 5, lon: 5 }],
  anchorages: [[{ lat: 9, lon: 9 }]],
};

const CFG: LayerConfig[] = [
  { key: 'coastline', label: 'C', source: 'coastline', kind: 'line', color: [10, 20, 30], pointSize: 2, maxPointSize: 3, bloomGroup: 3, baseY: 0, spacing: 1 },
  { key: 'tank', label: 'T', source: 'tanks', kind: 'cylinder', color: [40, 50, 60], pointSize: 2, maxPointSize: 4, bloomGroup: 4, baseY: 0, height: 0.3, rings: 4, perRing: 8 },
  { key: 'crane', label: 'K', source: 'cranes', kind: 'gantry', color: [70, 80, 90], pointSize: 2, maxPointSize: 4, bloomGroup: 4, baseY: 0 },
  { key: 'anchorage', label: 'A', source: 'anchorages', kind: 'zone', color: [1, 2, 3], pointSize: 3, maxPointSize: 5, bloomGroup: 4, baseY: 0.05, radius: 1, ringCount: 12 },
];

describe('buildLayerPoints', () => {
  it('samples a line layer into xyz at baseY', () => {
    const pts = buildLayerPoints(CFG[0], OSM, idProj as any);
    expect(pts.length % 3).toBe(0);
    expect(pts.length).toBeGreaterThan(0);
    for (let i = 1; i < pts.length; i += 3) expect(pts[i]).toBe(0); // y == baseY
  });
  it('returns empty for a missing/empty source', () => {
    const pts = buildLayerPoints({ ...CFG[0], source: 'breakwater' }, OSM, idProj as any);
    expect(pts).toEqual([]);
  });
});

describe('buildLayers', () => {
  const handles = buildLayers(CFG, OSM, idProj as any);
  it('builds one handle per config with a non-empty point cloud', () => {
    expect(handles.map((h) => h.key)).toEqual(['coastline', 'tank', 'crane', 'anchorage']);
    for (const h of handles) expect(h.pc.count).toBeGreaterThan(0);
  });
  it('setVisible toggles points.visible', () => {
    const h = handles[0];
    h.setVisible(false);
    expect(h.pc.points.visible).toBe(false);
    h.setVisible(true);
    expect(h.pc.points.visible).toBe(true);
  });
  it('setColor swaps the ramp texture to the new RGB', () => {
    const h = handles[3];
    h.setColor([200, 100, 50]);
    const tex = (h.pc.points.material as THREE.ShaderMaterial).uniforms.uRamp.value as THREE.DataTexture;
    const d = tex.image.data as Uint8Array;
    expect([d[0], d[1], d[2]]).toEqual([200, 100, 50]);
  });
  it('setSize / setBrightness drive the uniforms', () => {
    const h = handles[1];
    h.setSize(9); h.setBrightness(1.7);
    const u = (h.pc.points.material as THREE.ShaderMaterial).uniforms;
    expect(u.uPointSize.value).toBe(9);
    expect(u.uBrightness.value).toBeCloseTo(1.7);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/port-layers.test.ts`
Expected: FAIL（模組不存在)

- [ ] **Step 3: 建 `scene/layers.ts`**

```ts
import { PointCloud, buildCategoryLUT } from '../../../src/index';
import type { RGB } from '../../../src/core/types';
import type { Projection, World } from '../geo/projection';
import type { OsmGeometry, Polyline, LatLon } from '../data/osm';
import { samplePolyline } from './portPoints';
import { footprintCentroidRadius, sampleCylinderShell, sampleGantry, sampleZoneRing } from './landmarks';

export type LayerKind = 'line' | 'cylinder' | 'gantry' | 'zone';

export interface LayerConfig {
  key: string;
  label: string;
  source: keyof OsmGeometry;
  kind: LayerKind;
  color: RGB;
  pointSize: number;
  maxPointSize: number;
  brightness?: number;   // default 1
  pulseHz?: number;      // default 0
  bloomGroup: number;
  baseY: number;
  visible?: boolean;     // default true
  spacing?: number;      // line / zone-area sampling
  // cylinder
  height?: number; rings?: number; perRing?: number;
  // gantry
  legHeight?: number; baseW?: number; baseD?: number; boomLen?: number;
  // zone (node)
  radius?: number; ringCount?: number;
}

export interface LayerHandle {
  key: string;
  config: LayerConfig;
  pc: PointCloud;
  setVisible(on: boolean): void;
  setColor(rgb: RGB): void;
  setBrightness(b: number): void;
  setSize(px: number): void;
  setPulseHz(hz: number): void;
}

const toWorld = (proj: Projection, ll: LatLon): World => proj.toWorld(ll.lat, ll.lon);

/** Generate the flat xyz point array for one layer config from its OSM source. */
export function buildLayerPoints(cfg: LayerConfig, osm: OsmGeometry, proj: Projection): number[] {
  const raw = (osm[cfg.source] ?? []) as unknown[];
  const out: number[] = [];
  if (cfg.kind === 'line') {
    const spacing = cfg.spacing ?? 0.8;
    for (const line of raw as Polyline[]) {
      for (const p of samplePolyline(line.map((l) => toWorld(proj, l)), spacing)) out.push(p.x, cfg.baseY, p.z);
    }
  } else if (cfg.kind === 'cylinder') {
    for (const poly of raw as Polyline[]) {
      const { center, radius } = footprintCentroidRadius(poly.map((l) => toWorld(proj, l)));
      out.push(...sampleCylinderShell(center, radius, cfg.baseY, cfg.height ?? 0.3, cfg.rings ?? 6, cfg.perRing ?? 32));
    }
  } else if (cfg.kind === 'gantry') {
    for (const pt of raw as LatLon[]) {
      out.push(...sampleGantry(toWorld(proj, pt), cfg.baseY, {
        legHeight: cfg.legHeight ?? 0.6, baseW: cfg.baseW ?? 0.4,
        baseD: cfg.baseD ?? 0.4, boomLen: cfg.boomLen ?? 0.5, spacing: cfg.spacing ?? 0.05,
      }));
    }
  } else { // zone
    for (const poly of raw as Polyline[]) {
      if (poly.length <= 1) {
        out.push(...sampleZoneRing(toWorld(proj, poly[0]), cfg.radius ?? 1.0, cfg.baseY, cfg.ringCount ?? 48));
      } else {
        for (const p of samplePolyline(poly.map((l) => toWorld(proj, l)), cfg.spacing ?? 0.5)) out.push(p.x, cfg.baseY, p.z);
      }
    }
  }
  return out;
}

/** Build one single-color PointCloud per config and return controllable handles. */
export function buildLayers(configs: LayerConfig[], osm: OsmGeometry, proj: Projection): LayerHandle[] {
  return configs.map((cfg) => {
    const positions = new Float32Array(buildLayerPoints(cfg, osm, proj));
    const values = new Float32Array(positions.length / 3).fill(0.5);
    const pc = new PointCloud({
      capacity: positions.length / 3 + 16,
      ramp: buildCategoryLUT([cfg.color]),
      persistence: 'accumulate',
      colorMode: 'value',
      sizeAttenuation: false,
      pointSize: cfg.pointSize,
      maxPointSize: cfg.maxPointSize,
      pulseHz: cfg.pulseHz ?? 0,
    });
    pc.addPoints(positions, values);
    pc.setBrightness(cfg.brightness ?? 1);
    pc.points.visible = cfg.visible !== false;
    return {
      key: cfg.key,
      config: cfg,
      pc,
      setVisible: (on: boolean) => { pc.points.visible = on; },
      setColor: (rgb: RGB) => { pc.setRamp(buildCategoryLUT([rgb])); },
      setBrightness: (b: number) => { pc.setBrightness(b); },
      setSize: (px: number) => { pc.setPointSize(px); },
      setPulseHz: (hz: number) => { pc.setPulseHz(hz); },
    };
  });
}
```

- [ ] **Step 4: 跑測試確認通過 + 型別檢查**

Run: `npx vitest run test/port-layers.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS、tsc 0 錯

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/scene/layers.ts test/port-layers.test.ts
git commit -m "$(printf 'feat(port): config-driven per-category layer registry + handles\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 9: `main.ts` 整合(LAYERS 設定、移除 basePC、`__twin.layers`、4 組 bloom)

**Files:**
- Modify: `examples/kaohsiung-port/main.ts`、`examples/kaohsiung-port/scene/portPoints.ts`

- [ ] **Step 1: 移除死碼 `buildBaseLayer` 及其連帶未使用符號**

`tsconfig` 開了 `noUnusedLocals`/`noUnusedParameters`,所以移除 `buildBaseLayer` 後,只被它用到的符號也要一起清掉,否則 tsc 報錯。在 `examples/kaohsiung-port/scene/portPoints.ts`:
  1. 刪除整個 `buildBaseLayer` 函式(第 46–55 行)。
  2. 刪除 `const llToWorld = ...;`(第 44 行,僅 buildBaseLayer 用)。
  3. 刪除 `const Y_WATER = 0;`(第 10 行,僅 buildBaseLayer 用)。
  4. 刪除第 2 行整行 `import type { LatLon, Polyline } from '../data/osm';`(`LatLon` 只被 llToWorld 用、`Polyline` 只被 buildBaseLayer 用)。
  5. 第 5 行 palette import 移除 `BASE_COLORS`(只被 buildBaseLayer 用),其餘保留:
     `import { SHIP_CATEGORY_COLORS, STATUS_COLORS, SHIP_CATEGORIES, shipCategoryIndex, statusIndex, valueFor } from '../palette';`

保留 `samplePolyline`、`sampleShipFootprint`、`buildShipLayer`、`PointBatch`、`ShipLayerResult`、`Y_SHIP`、`TYPE_DIMS_M`、`World`/`Projection`/`VesselRecord`/`ShipCategory`/`resolveBerthLatLon` 等仍被 buildShipLayer 使用的符號。

驗證:`npx tsc --noEmit -p tsconfig.json`(此時 main.ts 仍引用 buildBaseLayer 會報錯,屬正常,下一步修)。

- [ ] **Step 2: 改 `main.ts` import**

把:
```ts
import { buildBaseLayer, buildShipLayer, sampleShipFootprint, type ShipLayerResult } from './scene/portPoints';
```
改成:
```ts
import { buildShipLayer, sampleShipFootprint, type ShipLayerResult } from './scene/portPoints';
import { buildLayers, type LayerConfig } from './scene/layers';
```
（`BASE_COLORS` 仍由第 7 行的 palette import 引入,保留它供 LAYERS 用。)

- [ ] **Step 3: 用 LAYERS 取代 basePC 區塊**

把這段(`// Static base layer ...` 到 `basePC.addPoints(...)`):
```ts
// Static base layer (coastline + piers), constant-size points.
const base = buildBaseLayer(osm.coastline, osm.piers, proj);
const basePC = new PointCloud({
  capacity: base.values.length + 16, ramp: buildCategoryLUT(BASE_COLORS),
  persistence: 'accumulate', colorMode: 'value', sizeAttenuation: false, pointSize: 2, maxPointSize: 3,
});
basePC.addPoints(base.positions, base.values);
```
換成:
```ts
// Static layers (one independent PointCloud per category) — config-driven; tune via __twin.layers.
const LAYERS: LayerConfig[] = [
  { key: 'coastline',  label: '海岸線', source: 'coastline',  kind: 'line',     color: BASE_COLORS[0], pointSize: 2, maxPointSize: 3, bloomGroup: 3, baseY: 0,    spacing: 0.8 },
  { key: 'pier',       label: '碼頭',   source: 'piers',      kind: 'line',     color: BASE_COLORS[1], pointSize: 2, maxPointSize: 3, bloomGroup: 3, baseY: 0,    spacing: 0.8 },
  { key: 'breakwater', label: '防波堤', source: 'breakwater', kind: 'line',     color: [90, 130, 150], pointSize: 2, maxPointSize: 3, bloomGroup: 3, baseY: 0,    spacing: 0.8 },
  { key: 'tank',       label: '儲槽',   source: 'tanks',      kind: 'cylinder', color: [255, 150, 60], pointSize: 2, maxPointSize: 4, bloomGroup: 4, baseY: 0,    height: 0.3, rings: 6, perRing: 32 },
  { key: 'crane',      label: '起重機', source: 'cranes',     kind: 'gantry',   color: [120, 180, 255], pointSize: 2, maxPointSize: 4, bloomGroup: 4, baseY: 0,    legHeight: 0.6, baseW: 0.4, baseD: 0.4, boomLen: 0.5, spacing: 0.05 },
  { key: 'anchorage',  label: '錨地',   source: 'anchorages', kind: 'zone',     color: [200, 160, 255], pointSize: 3, maxPointSize: 5, bloomGroup: 4, baseY: 0.05, radius: 1.0, ringCount: 48, spacing: 0.5 },
];
const layerHandles = buildLayers(LAYERS, osm, proj);
```

- [ ] **Step 4: 改 engine bloom 為 4 組**

把 engine options 內的 `bloom: [ ... ]` 換成:
```ts
  bloom: [
    { layer: 1, strength: 0.3,  radius: 0.1, threshold: 0.1 },  // 群組1=船
    { layer: 2, strength: 1.1,  radius: 0.5, threshold: 0.0 },  // 群組2=進港
    { layer: 3, strength: 0.05, radius: 0.1, threshold: 0.0 },  // 群組3=結構(海岸線/碼頭/防波堤)
    { layer: 4, strength: 0.6,  radius: 0.3, threshold: 0.0 },  // 群組4=地標(儲槽/起重機/錨地)
  ],
```

- [ ] **Step 5: 改 addLayer — 用迴圈掛全部圖層**

把:
```ts
engine.addLayer(basePC.points, { bloom: 3});   // 輪廓點
engine.addLayer(shipPC.points, { bloom: 1 });  // 船 → bloom 群組 1
engine.addLayer(incPC.points, { bloom: 2 });   // 進港標記 → bloom 群組 2
```
換成:
```ts
for (const h of layerHandles) engine.addLayer(h.pc.points, { bloom: h.config.bloomGroup });
engine.addLayer(shipPC.points, { bloom: 1 });  // 船 → bloom 群組 1
engine.addLayer(incPC.points, { bloom: 2 });   // 進港標記 → bloom 群組 2
```

- [ ] **Step 6: 改 `__twin` — 移除 basePC、加 layers**

把:
```ts
(window as any).__twin = {
  engine, basePC, shipPC, incPC, mapPlane, rebuildShips, rebuildIncoming, refresh, nowMs, intervals,
  get shipCenters() { return shipCenters; },
  setBasemapTint: (hex: number) => { (mapPlane.material as THREE.MeshBasicMaterial).color.setHex(hex); },
};
```
換成:
```ts
(window as any).__twin = {
  engine, shipPC, incPC, mapPlane, rebuildShips, rebuildIncoming, refresh, nowMs, intervals,
  layers: Object.fromEntries(layerHandles.map((h) => [h.key, h])),
  get shipCenters() { return shipCenters; },
  setBasemapTint: (hex: number) => { (mapPlane.material as THREE.MeshBasicMaterial).color.setHex(hex); },
};
```

- [ ] **Step 7: 型別檢查 + 全測試 + build**

Run: `npx tsc --noEmit -p tsconfig.json && npm test && npm run build`
Expected: tsc 0 錯;全測試綠;build 成功。
（`buildCategoryLUT` 仍被 main.ts 的船型/狀態/進港 LUT 使用,**保留**第 3 行 import;`PointCloud` 亦仍被 shipPC/incPC 使用,保留。)

- [ ] **Step 8: 瀏覽器目視驗證**

Run: `npm run dev`(背景)→ 用瀏覽器開 `http://localhost:5173/examples/kaohsiung-port/index.html`。
確認:① 海岸線/碼頭/防波堤點線出現;② 儲槽呈圓柱點群、起重機呈龍門點群(站得起來、有高度);③ 錨地圓框;④ Console 試 `__twin.layers.tank.setVisible(false)` 會關掉儲槽、`__twin.layers.crane.setColor([255,140,0])` 變色、`__twin.layers.coastline.setSize(4)` 變大、`__twin.layers.anchorage.setBrightness(2)` 變亮;⑤ 主控台無 error。截圖存證。

- [ ] **Step 9: Commit**

```bash
git add examples/kaohsiung-port/main.ts examples/kaohsiung-port/scene/portPoints.ts
git commit -m "$(printf 'feat(port): per-category layers via registry; drop basePC; __twin.layers; 4 bloom groups\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 10: 文件更新

**Files:**
- Modify: `docs/vscode-dev-guide.md`、`docs/superpowers/2026-06-14-handoff.md`

- [ ] **Step 1: dev guide 加圖層 registry / `__twin.layers` 一節**

在 `docs/vscode-dev-guide.md` 的 §4g 之後新增 §4h「圖層 registry(每類別獨立點雲)」:說明 `main.ts` 的 `LAYERS` 設定陣列(每筆 = 一個類別的所有旋鈕:color/pointSize/brightness/pulseHz/bloomGroup/baseY/visible/kind 專屬參數)、新檔 `scene/layers.ts`(`buildLayers`)與 `scene/landmarks.ts`(3D 產生器),以及 console 用法:
```js
__twin.layers.tank.setVisible(false)
__twin.layers.crane.setColor([255,140,0])
__twin.layers.coastline.setBrightness(1.5)
__twin.layers.breakwater.setSize(4)
__twin.layers.anchorage.setPulseHz(0.5)
```
並在 §5 `__twin` 表把 `basePC` 那列改成 `layers.<key>`(每層一個 handle)。

- [ ] **Step 2: handoff 加 F4 進度節**

在 `docs/superpowers/2026-06-14-handoff.md` 最上方新增「🆕 更新 2026-06-17 — F4 每類別獨立圖層 + 新增地物」一節:列出做了什麼(per-category PointCloud registry、breakwater/tank(3D)/crane(3D)/anchorage、引擎 setPointSize/uBrightness、`__twin.layers`)、測試數(更新為實際綠燈數)、子專案狀態(F0/F2/F4 ✅,F1/F3 未開始)。

- [ ] **Step 3: Commit**

```bash
git add docs/vscode-dev-guide.md docs/superpowers/2026-06-14-handoff.md
git commit -m "$(printf 'docs: F4 per-layer registry — dev guide + handoff update\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## 完成準則

- `npm test` 全綠(新增 PointCloud setPointSize/setBrightness、parseOsm 擴充、landmarks 三個產生器、layers registry 的測試)。
- `npx tsc --noEmit -p tsconfig.json` 0 錯。
- `npm run build` 成功。
- 瀏覽器:六個靜態圖層各自可由 `__twin.layers.<key>` 獨立開關/改色/調亮度/調大小;儲槽/起重機呈 3D 點體;主控台無 error。
- 洞穴 demo(`examples/basic/index.html`)不受影響(引擎改動皆加法、預設不變)。
