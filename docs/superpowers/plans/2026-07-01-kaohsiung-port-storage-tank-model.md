# 高雄港儲槽換真實圓柱 3D 模型 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把港區 246 座程序圓柱殼儲槽,換成真實 GLB 烘成的點雲模板,於每座 OSM 儲槽輪廓中心靜態實例化、依真實 footprint 半徑等比縮放、免定向;並先重抓 OSM + 疊航照核對儲槽位置真實性。

**Architecture:** 重用既有 GLB→點雲烘焙管線(`fetch-ship-models.ts` / `port:models`)產出 unit 模板;重用 `kind:'model'` 靜態地物圖層(起重機留下的 `landmarkModels.ts` + `layers.ts` model 分支),新增一個「per-instance 縮放、免定向」的 instancing 函式與一個 `scaleByFootprint` 圖層路徑,讓每座儲槽依 `footprintCentroidRadius` 算出的真實半徑縮放。球形延後,全部先用圓柱。

**Tech Stack:** TypeScript、Three.js(自研 lidar-engine 點雲)、vite / vite-node、vitest、sharp(診斷疊圖)、gltf-pipeline(模型轉純幾何)。

## Global Constraints

- 引擎 `src/` **零改動**(所有變更限 `examples/kaohsiung-port/` 與 `test/`)。
- 表現形式 = **點雲**(維持 LiDAR 美學,沿用既有 bloom / 配色階層)。
- **先全部圓柱**;球形模型(`sphere_Storage_Tank`)本案**不使用**、延後。
- 每座縮放 = `footprintRadius / templateUnitHorizontalRadius`(世界單位,不額外乘 `S`);免定向(heading 固定 0)。
- 模板存 `examples/kaohsiung-port/data/ship-models/儲槽.json`;原始 `data/models/*`(含 `儲槽.glb`、`cylinder_Storage_Tank/`)維持 **gitignore**,只 commit 烘出的 JSON。
- 模型授權 **CC-BY-4.0(可商用)**,須在 `data/models/CREDITS.md` 補作者。
- 每步結束跑對應驗證(TDD:先看測試失敗再實作);頻繁 commit。
- 位置若發現重大偏差,**先回報使用者**,不自行改座標。

---

### Task 1: 重抓最新 OSM 並疊航照核對儲槽位置

**Files:**
- Modify: `examples/kaohsiung-port/data/osm-khh.json`(由 `port:osm` 重新產生)
- Create(暫存,驗完刪除): `_tank-check.ts`(repo 根目錄)、`_tank-overlay*.png`

**Interfaces:**
- Consumes: 既有 `geo/projection`(`createProjection`/`KAOHSIUNG_ORIGIN`/`WORLD_SCALE`)、`data/basemap-khh.json` bounds、`data/basemap-khh.jpg`、`scene/landmarks` 的 `footprintCentroidRadius`。
- Produces: 驗證過的 `osm-khh.json`(下游所有 task 用它的 `tanks`)。

- [ ] **Step 1: 重抓 OSM**

Run: `npm run port:osm`
Expected: 印出 `wrote .../osm-khh.json: N coastline, N piers, N breakwater, N tanks, N cranes, N anchorages`。**記下新的 tanks 數**(原本 246)。

- [ ] **Step 2: 安全 diff——確認非儲槽圖層沒被大幅改動**

Run:
```bash
git diff --stat examples/kaohsiung-port/data/osm-khh.json
node -e "const o=require('./examples/kaohsiung-port/data/osm-khh.json'); console.log('coastline',o.coastline.length,'piers',o.piers.length,'breakwater',o.breakwater.length,'tanks',o.tanks.length,'cranes',o.cranes.length,'anchorages',o.anchorages.length);"
```
Expected: tanks 約在 246 附近;coastline/piers/breakwater/cranes/anchorages 與原本相近。**若某層數量暴增/暴減(例如 piers 少一半),STOP 並回報使用者**——OSM 上游改動可能影響其他圖層,需人工判斷。

- [ ] **Step 3: 寫一次性疊圖診斷腳本 `_tank-check.ts`**

Create `_tank-check.ts`(repo 根目錄):
```ts
// TEMP: overlay OSM tank centroids + outlines on the aerial basemap to verify positions are real.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createProjection, KAOHSIUNG_ORIGIN, WORLD_SCALE } from './examples/kaohsiung-port/geo/projection';
import { footprintCentroidRadius } from './examples/kaohsiung-port/scene/landmarks';
import basemapMeta from './examples/kaohsiung-port/data/basemap-khh.json';
import osm from './examples/kaohsiung-port/data/osm-khh.json';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, 'examples/kaohsiung-port/data');

async function run() {
  const proj = createProjection(KAOHSIUNG_ORIGIN.lat, KAOHSIUNG_ORIGIN.lon, WORLD_SCALE);
  const b = basemapMeta.bounds;
  const sw = proj.toWorld(b.s, b.w), ne = proj.toWorld(b.n, b.e);
  const buf = await readFile(join(DATA, 'basemap-khh.jpg'));
  const meta = await sharp(buf).metadata();
  const W = meta.width!, H = meta.height!;
  const px = (wx: number, wz: number) => ({ X: ((wx - sw.x) / (ne.x - sw.x)) * W, Y: (1 - (sw.z - wz) / (sw.z - ne.z)) * H });
  const tanks = osm.tanks as { lat: number; lon: number }[][];
  let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`;
  for (const poly of tanks) {
    const w = poly.map((l) => proj.toWorld(l.lat, l.lon));
    const { center, radius } = footprintCentroidRadius(w);
    const c = px(center.x, center.z);
    const edge = px(center.x + radius, center.z);
    const rpx = Math.hypot(edge.X - c.X, edge.Y - c.Y);
    svg += `<circle cx="${c.X}" cy="${c.Y}" r="${rpx}" fill="none" stroke="#39ff14" stroke-width="1.5"/>`;
    svg += `<circle cx="${c.X}" cy="${c.Y}" r="1.5" fill="#ff2d55"/>`;
  }
  svg += `</svg>`;
  const composed = await sharp(buf).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
  await sharp(composed).resize(1400).toFile(join(HERE, '_tank-overlay-full.png'));
  // 兩個放大裁切,細看儲槽群是否對齊(座標依 basemap 2560×3072;必要時自行調整)
  await sharp(composed).extract({ left: 1700, top: 1400, width: 700, height: 700 }).resize(900).toFile(join(HERE, '_tank-overlay-a.png'));
  await sharp(composed).extract({ left: 1900, top: 2000, width: 700, height: 700 }).resize(900).toFile(join(HERE, '_tank-overlay-b.png'));
  console.log(`ok ${W}x${H}, tanks=${tanks.length}`);
}
run().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: 執行診斷**

Run: `npx vite-node _tank-check.ts`
Expected: `ok 2560x3072, tanks=<N>`,並產生 `_tank-overlay-full.png` / `-a.png` / `-b.png`。

- [ ] **Step 5: 目視核對**

用 Read 工具開啟 `_tank-overlay-full.png` 與兩張裁切。確認綠圈(OSM 儲槽輪廓)絕大多數落在航照可見的圓形儲槽上、無系統性偏移。
- 通過 → 繼續。
- **若大量錯位/漏標/幻影 → STOP,把疊圖與問題回報使用者再決定**(不自行改座標)。

- [ ] **Step 6: 清除暫存並 commit 已驗證的 OSM**

```bash
rm -f _tank-check.ts _tank-overlay-full.png _tank-overlay-a.png _tank-overlay-b.png
git add examples/kaohsiung-port/data/osm-khh.json
git commit -m "chore(port): 重抓 OSM 快照並疊航照核對儲槽位置(位置驗證通過)"
```
> 若 `git diff` 顯示 `osm-khh.json` 無變化(OSM 無更新),仍算通過,略過 commit。

---

### Task 2: 烘焙 cylinder tank GLB → `儲槽.json`

**Files:**
- Create: `examples/kaohsiung-port/data/models/儲槽.glb`(純幾何,gitignored)
- Modify: `examples/kaohsiung-port/data/fetch-ship-models.ts`(加 `MODEL_BAKE_CONFIG['儲槽']`)
- Create: `examples/kaohsiung-port/data/ship-models/儲槽.json`(烘出的模板,commit 這個)

**Interfaces:**
- Consumes: `data/models/cylinder_Storage_Tank/`(使用者已放,gltf 資料夾)。
- Produces: `data/ship-models/儲槽.json`(shape `{ points: number[], count, lengthM, ... }`),供 Task 3 的 `RAW` import。

- [ ] **Step 1: 剝材質(避免 Node GLTFLoader 因無 DOM 而炸)**

Run(在 `examples/kaohsiung-port/data/models/` 底下):
```bash
cd examples/kaohsiung-port/data/models
python3 - <<'PY'
import json
d=json.load(open('cylinder_Storage_Tank/scene.gltf'))
for k in ('images','textures','samplers','materials'): d.pop(k,None)
for m in d.get('meshes',[]):
    for p in m.get('primitives',[]): p.pop('material',None)
json.dump(d, open('cylinder_Storage_Tank/scene_geom.gltf','w'))
print('stripped')
PY
```
Expected: `stripped`。

- [ ] **Step 2: 轉純幾何 glb**

Run(仍在 `data/models/`):
```bash
npm_config_cache=/tmp/npmcache npx gltf-pipeline -i cylinder_Storage_Tank/scene_geom.gltf -o 儲槽.glb
cd -
```
Expected: 產生 `examples/kaohsiung-port/data/models/儲槽.glb`(無報錯)。

- [ ] **Step 3: 量原始軸向(決定 upAxis / forwardAxis)**

Create `_axes.ts`(repo 根目錄):
```ts
import { readFile } from 'node:fs/promises';
import { Group } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { collectTriangles } from './examples/kaohsiung-port/scene/meshTriangles';

const buf = await readFile('examples/kaohsiung-port/data/models/儲槽.glb');
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const scene: Group = await new Promise((res, rej) => new GLTFLoader().parse(ab, '', (g) => res(g.scene), rej));
const tris = collectTriangles(scene);
let mnx=1e9,mny=1e9,mnz=1e9,mxx=-1e9,mxy=-1e9,mxz=-1e9;
for (const t of tris) for (const v of [t.a,t.b,t.c]) { mnx=Math.min(mnx,v.x);mny=Math.min(mny,v.y);mnz=Math.min(mnz,v.z);mxx=Math.max(mxx,v.x);mxy=Math.max(mxy,v.y);mxz=Math.max(mxz,v.z); }
console.log('span x',(mxx-mnx).toFixed(2),'y',(mxy-mny).toFixed(2),'z',(mxz-mnz).toFixed(2));
```
Run: `npx vite-node _axes.ts`
判定準則:**span 最大的那個軸最可能是圓柱高度(垂直)→ 設 `upAxis` = 該軸**(若三軸相近,儲槽偏矮,則垂直軸通常是 Sketchfab 慣例的 `y`);`forwardAxis` 設「另一個水平軸」(徑向對稱,選哪個都行,但別跟 upAxis 相同)。記下結果,`rm _axes.ts`。
> 注意:`collectTriangles` 回傳的三角形頂點型別以實際 `meshTriangles.ts` 為準;若欄位非 `.a/.b/.c/.x/.y/.z`,依該檔調整取值(僅影響這支一次性量測腳本)。

- [ ] **Step 4: 加烘焙設定**

Modify `examples/kaohsiung-port/data/fetch-ship-models.ts` 的 `MODEL_BAKE_CONFIG`,在物件內加一行(用 Step 3 判定的軸;範例假設 upAxis=`y`、水平 forwardAxis=`x`):
```ts
  // 儲槽 (CC-BY-4.0 Process Storage Tank): 徑向對稱靜態地物,免定向。upAxis=垂直軸讓槽站直、
  // 水平切片成環;forwardAxis=任一水平軸。cellFrac 起手 0.03,依瀏覽器目視微調點數。
  儲槽: { forwardAxis: 'x', upAxis: 'y', cellFrac: 0.03 },
```

- [ ] **Step 5: 烘焙,並還原其他船模 JSON(只留 儲槽.json 變動)**

Run:
```bash
npm run port:models
git checkout -- examples/kaohsiung-port/data/ship-models/
```
Expected: 烘焙印出 `✓ 儲槽.glb → ship-models/儲槽.json (... pts)`;`git checkout` 把其餘已追蹤的船模 JSON 還原(它們因 `sampledAt` 時間戳被重寫),新的未追蹤 `儲槽.json` 保留。

- [ ] **Step 6: 檢查烘出模板**

Run:
```bash
node -e "const t=require('./examples/kaohsiung-port/data/ship-models/儲槽.json');const p=t.points;let mnx=1e9,mny=1e9,mnz=1e9,mxx=-1e9,mxy=-1e9,mxz=-1e9;for(let i=0;i<p.length;i+=3){mnx=Math.min(mnx,p[i]);mxx=Math.max(mxx,p[i]);mny=Math.min(mny,p[i+1]);mxy=Math.max(mxy,p[i+1]);mnz=Math.min(mnz,p[i+2]);mxz=Math.max(mxz,p[i+2]);}console.log('pts',t.count,'spanx',(mxx-mnx).toFixed(3),'spany',(mxy-mny).toFixed(3),'spanz',(mxz-mnz).toFixed(3),'miny',mny.toFixed(3));"
```
Expected(站直、貼地):`miny ≈ 0`;`spanx ≈ 1`(forwardAxis 被正規化成 1);`spany`/`spanz` 為合理比例(高度/直徑)。`pts` 落在 ~300–1000。
- 若 `miny` 遠離 0 或槽比例明顯躺平(spany 極小而 spanz≈1)→ upAxis 判錯,回 Step 4 改軸重烘。
- 若 pts 太多/太少 → 調 `cellFrac`(大=少、小=多)重烘。

- [ ] **Step 7: Commit**

```bash
git add examples/kaohsiung-port/data/fetch-ship-models.ts examples/kaohsiung-port/data/ship-models/儲槽.json
git commit -m "feat(port): 烘焙圓柱儲槽 GLB → ship-models/儲槽.json"
```

---

### Task 3: `buildScaledInstances` + `templateHorizontalRadius`(TDD)+ 註冊 儲槽 模板

**Files:**
- Modify: `examples/kaohsiung-port/scene/landmarkModels.ts`
- Test: `test/port-landmark-models.test.ts`

**Interfaces:**
- Consumes: `ShipModelTemplate`(`{ points: Float32Array }`)、`placeModelPoints`(`scene/shipModels`)、`World`。
- Produces:
  - `buildScaledInstances(tpl: ShipModelTemplate, centers: World[], scales: number[], baseY: number): number[]` —— 每座以 `scales[i]` 均勻縮放、heading 0(不旋轉)、貼 `baseY`,回傳 flat xyz。
  - `templateHorizontalRadius(tpl: ShipModelTemplate): number` —— 模板點雲在水平面(x,z)的最大半徑(`max hypot(x,z)`,至少回 1 避免除零)。
  - `RAW['儲槽']` 註冊(供 `loadLandmarkModel('儲槽')`)。

- [ ] **Step 1: 寫失敗測試**

在 `test/port-landmark-models.test.ts` 檔尾加:
```ts
import { buildScaledInstances, templateHorizontalRadius } from '../examples/kaohsiung-port/scene/landmarkModels';

describe('templateHorizontalRadius', () => {
  it('回傳水平面(x,z)最大半徑,忽略 y', () => {
    const tpl = { points: new Float32Array([3, 0, 4, /* r=5 */ 1, 9, 1 /* r≈1.41 */]) };
    expect(templateHorizontalRadius(tpl)).toBeCloseTo(5, 6);
  });
  it('全在原點時回退為 1(避免除零)', () => {
    expect(templateHorizontalRadius({ points: new Float32Array([0, 5, 0]) })).toBe(1);
  });
});

describe('buildScaledInstances', () => {
  it('每座依 scales[i] 均勻縮放、不旋轉、貼 baseY、位移到 center', () => {
    const tpl = { points: new Float32Array([1, 0, 0, 0, 2, 0]) }; // A(1,0,0) B(0,2,0)
    const out = buildScaledInstances(tpl, [{ x: 10, y: 0, z: 20 }, { x: 5, y: 0, z: 5 }] as any, [2, 3], 0);
    expect(out.length).toBe(2 * 2 * 3); // 2 座 × 2 點 × xyz
    // 座0 scale2: A→(12,0,20) B→(10,4,20)
    expect(Array.from(out.slice(0, 6))).toEqual([12, 0, 20, 10, 4, 20]);
    // 座1 scale3: A→(8,0,5) B→(5,6,5)
    expect(Array.from(out.slice(6, 12))).toEqual([8, 0, 5, 5, 6, 5]);
  });
});
```

- [ ] **Step 2: 跑測試看它失敗**

Run: `npx vitest run test/port-landmark-models.test.ts`
Expected: FAIL —— `buildScaledInstances`/`templateHorizontalRadius` is not a function(尚未匯出)。

- [ ] **Step 3: 實作(landmarkModels.ts)**

在 `examples/kaohsiung-port/scene/landmarkModels.ts`:
1. 檔頭 import 區加(`placeModelPoints` 已可用,`craneJson` 那組附近):
```ts
import tankJson from '../data/ship-models/儲槽.json';
```
2. `RAW` 物件加 `儲槽`:
```ts
const RAW: Record<string, { points: number[] }> = { crane: craneJson, 儲槽: tankJson };
```
3. 檔尾加兩個函式:
```ts
/** 模板點雲在水平面(x,z)的最大半徑;至少回 1 避免除零。用來把 unit 模板縮到真實 footprint 半徑。 */
export function templateHorizontalRadius(tpl: ShipModelTemplate): number {
  const p = tpl.points;
  let max = 0;
  for (let i = 0; i < p.length; i += 3) {
    const r = Math.hypot(p[i], p[i + 2]);
    if (r > max) max = r;
  }
  return max || 1;
}

/** 把 unit 模板放到每個 center,以 scales[i] 均勻縮放、不旋轉(heading 0,徑向對稱地物用)、貼 baseY。
 *  回傳 flat xyz。與 buildModelInstances 平行,但每座獨立縮放且免定向。 */
export function buildScaledInstances(
  tpl: ShipModelTemplate, centers: World[], scales: number[], baseY: number,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < centers.length; i++) {
    const b = placeModelPoints(tpl, centers[i], 0, scales[i], baseY, 0.5);
    for (let j = 0; j < b.positions.length; j++) out.push(b.positions[j]);
  }
  return out;
}
```
> `ShipModelTemplate`/`placeModelPoints`/`World` 已在此檔 import(crane 用)。若 `World` 未 import,從 `'../geo/projection'` 補。

- [ ] **Step 4: 跑測試看它通過**

Run: `npx vitest run test/port-landmark-models.test.ts`
Expected: PASS(含既有 6 測試)。

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/scene/landmarkModels.ts test/port-landmark-models.test.ts
git commit -m "feat(port): landmarkModels 加 buildScaledInstances/templateHorizontalRadius + 註冊儲槽模板"
```

---

### Task 4: `layers.ts` 新增 `scaleByFootprint` 儲槽路徑(TDD)

**Files:**
- Modify: `examples/kaohsiung-port/scene/layers.ts`
- Test: `test/port-layers.test.ts`

**Interfaces:**
- Consumes: `buildScaledInstances`/`templateHorizontalRadius`/`loadLandmarkModel`(Task 3)、`footprintCentroidRadius`/`sampleCylinderShell`(既有)。
- Produces: `LayerConfig.scaleByFootprint?: boolean`;`buildLayerPoints` 對 `kind:'model' + scaleByFootprint` 的 `Polyline[]` 來源,回傳「模板 × 每座 footprint 半徑縮放」的點雲(無模板時 fallback 回 `sampleCylinderShell`)。

- [ ] **Step 1: 寫失敗測試**

在 `test/port-layers.test.ts` 檔尾加:
```ts
import { buildLayerPoints } from '../examples/kaohsiung-port/scene/layers';

describe('buildLayerPoints kind:model scaleByFootprint(儲槽)', () => {
  const idProj = { toWorld: (lat: number, lon: number) => ({ x: lon, z: lat }) } as any;
  const square = (cx: number, cz: number, r: number) => [
    { lat: cz - r, lon: cx - r }, { lat: cz - r, lon: cx + r },
    { lat: cz + r, lon: cx + r }, { lat: cz + r, lon: cx - r }, { lat: cz - r, lon: cx - r },
  ];
  const osm = { coastline: [], piers: [], breakwater: [], tanks: [square(0, 0, 1), square(50, 50, 2)], cranes: [], anchorages: [] } as any;
  const cfg = {
    key: 'tank', label: '儲槽', source: 'tanks', kind: 'model', modelKey: '儲槽', scaleByFootprint: true,
    color: [1, 1, 1], pointSize: 2, maxPointSize: 4, bloomGroup: 4, baseY: 0,
  } as any;
  it('每座 footprint 產生一份縮放後的模板點雲(非空、xyz 對齊)', () => {
    const pts = buildLayerPoints(cfg, osm, idProj);
    expect(pts.length).toBeGreaterThan(0);
    expect(pts.length % 3).toBe(0);
    // 2 座 × 模板點數 × 3
    const tplPts = require('../examples/kaohsiung-port/data/ship-models/儲槽.json').count;
    expect(pts.length).toBe(2 * tplPts * 3);
  });
});
```

- [ ] **Step 2: 跑測試看它失敗**

Run: `npx vitest run test/port-layers.test.ts`
Expected: FAIL —— `scaleByFootprint` 尚未處理,`buildLayerPoints` 走到 crane 的 `raw as LatLon[]` 路徑對 `Polyline[]` 取值 → 產生錯誤點數(或 NaN),斷言不符。

- [ ] **Step 3: 實作(layers.ts)**

1. import 區(已 import `loadLandmarkModel, loadLandmarkOrient, buildModelInstances`)加:
```ts
import { loadLandmarkModel, loadLandmarkOrient, buildModelInstances, buildScaledInstances, templateHorizontalRadius } from './landmarkModels';
```
2. `LayerConfig` interface 加一個欄位(在 `modelKey?` 那組附近):
```ts
  scaleByFootprint?: boolean; // model 層:來源為 Polyline[] footprint,每座依半徑縮放、免定向(儲槽)
```
3. `buildLayerPoints` 的 `else if (cfg.kind === 'model')` 分支**開頭**改成先處理 footprint 路徑:
```ts
  } else if (cfg.kind === 'model') {
    const tpl = cfg.modelKey ? loadLandmarkModel(cfg.modelKey) : null;
    if (cfg.scaleByFootprint) {
      // 徑向對稱靜態地物(儲槽):來源為封閉 footprint 多邊形,每座取中心+半徑,依半徑縮放、免定向。
      const polys = raw as Polyline[];
      if (!tpl) { // 無模板 → fallback 回程序圓柱殼(維持現況外觀)
        for (const poly of polys) {
          const { center, radius } = footprintCentroidRadius(poly.map((l) => toWorld(proj, l)));
          out.push(...sampleCylinderShell(center, radius, cfg.baseY, cfg.height ?? 0.3, cfg.rings ?? 6, cfg.perRing ?? 32));
        }
        return out;
      }
      const thr = templateHorizontalRadius(tpl);
      const centers: World[] = [];
      const scales: number[] = [];
      for (const poly of polys) {
        const { center, radius } = footprintCentroidRadius(poly.map((l) => toWorld(proj, l)));
        centers.push(center);
        scales.push(radius / thr);
      }
      return buildScaledInstances(tpl, centers, scales, cfg.baseY);
    }
    const cranePts = raw as LatLon[];
    if (!tpl) { // no baked template → fall back to procedural gantry wireframe
```
   —— 即在既有 crane 路徑(`const cranePts = raw as LatLon[];` 起)之前插入 footprint 分支;crane 路徑保持不變(把原本 `const tpl = ...` 那行移到分支開頭共用,原位置移除)。

- [ ] **Step 4: 跑測試看它通過**

Run: `npx vitest run test/port-layers.test.ts`
Expected: PASS(含既有 8 測試)。

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/scene/layers.ts test/port-layers.test.ts
git commit -m "feat(port): layers 加 scaleByFootprint 儲槽路徑(footprint→per-instance 縮放,免定向)"
```

---

### Task 5: `main.ts` 儲槽圖層由 `cylinder` 改 `model`

**Files:**
- Modify: `examples/kaohsiung-port/main.ts`(`LAYERS` 的 `tank` 條目)

**Interfaces:**
- Consumes: Task 4 的 `scaleByFootprint`、Task 3 的 `modelKey:'儲槽'`。
- Produces: 場景儲槽層改用真實圓柱模型點雲。

- [ ] **Step 1: 改圖層設定**

Modify `examples/kaohsiung-port/main.ts` 的 tank 那行:
```ts
  { key: 'tank',       label: '儲槽',   source: 'tanks',      kind: 'cylinder', color: [118, 128, 142], pointSize: 2, maxPointSize: 4, bloomGroup: 4, baseY: 0,       height: 0.3 * S, rings: 6, perRing: 32, brightness: 0.9 },
```
改成:
```ts
  { key: 'tank',       label: '儲槽',   source: 'tanks',      kind: 'model',    color: [118, 128, 142], pointSize: 2, maxPointSize: 4, bloomGroup: 4, baseY: 0,       modelKey: '儲槽', scaleByFootprint: true, height: 0.3 * S, rings: 6, perRing: 32, brightness: 0.9 },
```
> 保留 `height/rings/perRing`:那是無模板時 `sampleCylinderShell` fallback 用的。

- [ ] **Step 2: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 0 錯。

- [ ] **Step 3: Commit**

```bash
git add examples/kaohsiung-port/main.ts
git commit -m "feat(port): 儲槽圖層改用真實圓柱模型(kind:model + scaleByFootprint)"
```

---

### Task 6: 瀏覽器目視 + CREDITS + 最終驗證

**Files:**
- Modify: `examples/kaohsiung-port/data/models/CREDITS.md`

**Interfaces:**
- Consumes: 全部前置 task。
- Produces: 驗收通過的功能、乾淨工作樹。

- [ ] **Step 1: 補授權**

在 `examples/kaohsiung-port/data/models/CREDITS.md` 補一條:
```markdown
## 儲槽 (Storage Tank, cylinder)
"Process Storage Tank" (https://sketchfab.com/3d-models/process-storage-tank-f3455e3692664237ae3ddf4c28932b43) by Deepak Singh (https://sketchfab.com/dy4in) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/). 烘焙成點雲模板 data/ship-models/儲槽.json。
```

- [ ] **Step 2: 瀏覽器目視**

Run: `npm run dev`(背景),開 `http://localhost:5173/examples/kaohsiung-port/`。
確認:儲槽呈真實圓柱點雲、大小依 footprint 半徑分布(大原油槽大、小槽小)、站直貼地、無躺平/膨脹;主控台無新錯誤(favicon 404 可忽略)。
- 若整體過大/過小 → 多半是 `templateHorizontalRadius` 被模型附屬結構(樓梯/管線)撐大 → 在 `templateHorizontalRadius` 改用穩健半徑(例:取 95 百分位 `hypot(x,z)` 而非 max)重跑 Task 3 測試;或微調 Task 2 的 `cellFrac`。
- 若點數尖峰過高(靜態層,通常無虞)→ 調大 `cellFrac` 重烘。

- [ ] **Step 3: 最終驗證**

Run:
```bash
npx tsc --noEmit && npx vitest run && npm run build
```
Expected: tsc 0、所有測試綠、build ok。

- [ ] **Step 4: Commit**

```bash
git add examples/kaohsiung-port/data/models/CREDITS.md
git commit -m "docs(port): CREDITS 補圓柱儲槽模型 CC-BY-4.0"
```

- [ ] **Step 5: 收尾**

用 `superpowers:finishing-a-development-branch` 決定合併方式(此分支 `feat/kaohsiung-port-tank-3d`;比照慣例 fast-forward merge 進 `main` 再 push——**push 前向使用者確認**)。更新 handoff + 記憶。

---

## Self-Review

**Spec coverage:**
- 需求 1(重抓 OSM + 疊圖核對位置)→ Task 1 ✅
- 需求 2(烘焙圓柱模板)→ Task 2 ✅
- 需求 3(每座依半徑縮放、免定向的靜態點雲)→ Task 3(instancing)+ Task 4(layers 路徑)+ Task 5(接線)✅
- 需求 4(src 零改動、tsc/測試/build/目視)→ Task 6 ✅
- 決定 (a) 一次性診斷 → Task 1 用暫存腳本並刪除 ✅;(b) 模板放 ship-models/儲槽.json → Task 2 ✅;(c) 高度隨半徑等比 → placeModelPoints 均勻縮放,天然成立 ✅;(d) 全圓柱、球形延後 → 全程只用 cylinder ✅;(e) 每座依 footprint 半徑 → Task 3/4 ✅
- CREDITS(CC-BY-4.0)→ Task 6 ✅

**Placeholder scan:** 無 TBD/TODO;每個程式步驟都有完整程式碼;upAxis/forwardAxis 為執行期依 raw bbox 判定(有明確準則,非占位)。

**Type consistency:** `buildScaledInstances(tpl, centers, scales, baseY)`、`templateHorizontalRadius(tpl)`、`LayerConfig.scaleByFootprint`、`modelKey:'儲槽'`、`RAW['儲槽']` 於各 task 一致;`placeModelPoints(tpl, center, heading, scale, baseY, v01)` 與既有簽名一致(heading 0、scale=每座值)。

## 範圍外(延後 / 不做)
- 球形儲槽模型與圓柱/球形分類(延後)。
- 以航照偵測圓形重建座標(不做;信任 OSM + 目視)。
