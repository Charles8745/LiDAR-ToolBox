# NLSC 航照底圖(戰情室染暗) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把高雄港孿生的「離線手繪海圖 plane」換成真實 NLSC 正射航照(離線烘焙成一張合成圖),並於執行期染暗融入暗色戰情室 HUD。

**Architecture:** 純邏輯 slippy-tile 數學模組(`geo/tiles.ts`,有單元測試)→ 建置腳本(`fetch-basemap.ts`,用 `sharp` 下載+拼接 NLSC 圖磚成單張 jpg + bounds metadata,commit 進專案)→ 執行期改寫 `buildMapPlane()` 載入該圖貼到對齊投影的 plane,以 `MeshBasicMaterial.color` 相乘染暗,預設開。

**Tech Stack:** TypeScript、Three.js、Vite、vite-node、vitest、sharp(新 devDependency)、NLSC WMTS(`PHOTO2`,EPSG:3857 GoogleMapsCompatible XYZ)。

**Spec:** [docs/superpowers/specs/2026-06-15-kaohsiung-port-nlsc-basemap-design.md](../specs/2026-06-15-kaohsiung-port-nlsc-basemap-design.md)

**Convention:** 每個 commit 訊息結尾加上
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`(下方各 commit 已含)。在 `feat/nlsc-basemap` 分支上進行。

**Prerequisites:** 執行 Task 3 需可連線 `wmts.nlsc.gov.tw`,且 `sharp` 原生模組可安裝/編譯。

---

## File Structure

| 動作 | 路徑 | 責任 |
|---|---|---|
| Create | `examples/kaohsiung-port/geo/tiles.ts` | 純 Web-Mercator slippy-tile 數學(無 I/O) |
| Create | `test/port-tiles.test.ts` | `tiles.ts` 的 vitest 單元測試 |
| Create | `examples/kaohsiung-port/data/fetch-basemap.ts` | 建置腳本:下載+拼接 NLSC 圖磚 → jpg + json |
| Create(生成資產) | `examples/kaohsiung-port/data/basemap-khh.jpg` | 烘焙的乾淨航照合成圖(committed) |
| Create(生成資產) | `examples/kaohsiung-port/data/basemap-khh.json` | 合成圖地理邊界 metadata(committed) |
| Modify | `examples/kaohsiung-port/main.ts` | `buildMapPlane()` 改載入航照圖 + 執行期染暗 + 預設開 |
| Modify | `examples/kaohsiung-port/ui/overlay.ts` | 底圖切換鈕初始狀態改為「開」 |
| Modify | `package.json` | 加 `port:basemap` script + `sharp` devDependency |

---

## Task 1: `geo/tiles.ts` — 經緯度 ↔ 圖磚轉換

**Files:**
- Create: `examples/kaohsiung-port/geo/tiles.ts`
- Test: `test/port-tiles.test.ts`

- [ ] **Step 1: 寫失敗測試**

Create `test/port-tiles.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { lonLatToTile, tileToLonLat } from '../examples/kaohsiung-port/geo/tiles';

describe('tileToLonLat', () => {
  it('maps tile (0,0) at z0 to the Web-Mercator NW corner (-180, ~85.0511)', () => {
    const c = tileToLonLat(0, 0, 0);
    expect(c.lon).toBeCloseTo(-180, 6);
    expect(c.lat).toBeCloseTo(85.0511, 3);
  });
});

describe('lonLatToTile', () => {
  it('floors to the containing tile (z=1 quadrants)', () => {
    expect(lonLatToTile(-90, 45, 1)).toEqual({ x: 0, y: 0 }); // NW
    expect(lonLatToTile(90, -45, 1)).toEqual({ x: 1, y: 1 });  // SE
  });

  it('round-trips: the containing tile brackets the point (NW≤pt<SE)', () => {
    const pts = [
      { lon: 120.30, lat: 22.59 },
      { lon: 120.24, lat: 22.64 },
      { lon: 120.34, lat: 22.53 },
    ];
    for (const z of [12, 15, 16]) {
      for (const p of pts) {
        const t = lonLatToTile(p.lon, p.lat, z);
        const nw = tileToLonLat(t.x, t.y, z);
        const se = tileToLonLat(t.x + 1, t.y + 1, z);
        expect(nw.lon).toBeLessThanOrEqual(p.lon);
        expect(se.lon).toBeGreaterThan(p.lon);
        expect(nw.lat).toBeGreaterThanOrEqual(p.lat); // north edge ≥ point
        expect(se.lat).toBeLessThan(p.lat);           // south edge < point
      }
    }
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/port-tiles.test.ts`
Expected: FAIL — `Failed to resolve import ".../geo/tiles"` / `lonLatToTile is not a function`.

- [ ] **Step 3: 寫最小實作**

Create `examples/kaohsiung-port/geo/tiles.ts`:

```ts
export interface TileXY { x: number; y: number; }
export interface LonLat { lon: number; lat: number; }

export const TILE_SIZE = 256;

/** Fractional Web-Mercator tile coords for a lon/lat at zoom z. */
export function lonLatToTileFloat(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

/** Integer tile index containing a lon/lat at zoom z. */
export function lonLatToTile(lon: number, lat: number, z: number): TileXY {
  const f = lonLatToTileFloat(lon, lat, z);
  return { x: Math.floor(f.x), y: Math.floor(f.y) };
}

/** Lon/lat of the NW (top-left) corner of integer tile (x,y) at zoom z. */
export function tileToLonLat(x: number, y: number, z: number): LonLat {
  const n = 2 ** z;
  const lon = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return { lon, lat };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/port-tiles.test.ts`
Expected: PASS(3 個 test 全綠)。

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/geo/tiles.ts test/port-tiles.test.ts
git commit -m "$(cat <<'EOF'
feat(port): geo/tiles slippy-tile lon/lat conversions

Pure Web-Mercator tile math for the NLSC basemap pipeline (F2):
lonLatToTile / tileToLonLat with invariant + known-value tests.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `geo/tiles.ts` — bbox → 圖磚範圍 + 合成邊界

**Files:**
- Modify: `examples/kaohsiung-port/geo/tiles.ts`(append)
- Test: `test/port-tiles.test.ts`(append)

- [ ] **Step 1: 寫失敗測試(append 到 `test/port-tiles.test.ts`)**

```ts
import { tileRangeForBbox, compositeBounds, TILE_SIZE } from '../examples/kaohsiung-port/geo/tiles';

const BBOX = { s: 22.53, w: 120.24, n: 22.64, e: 120.34 };

describe('tileRangeForBbox', () => {
  it('orders the range (xMin≤xMax, yMin≤yMax)', () => {
    const r = tileRangeForBbox(BBOX, 15);
    expect(r.xMin).toBeLessThanOrEqual(r.xMax);
    expect(r.yMin).toBeLessThanOrEqual(r.yMax);
  });

  it('covers all four bbox corners at z15', () => {
    const z = 15;
    const r = tileRangeForBbox(BBOX, z);
    const corners = [
      { lon: BBOX.w, lat: BBOX.n }, { lon: BBOX.e, lat: BBOX.n },
      { lon: BBOX.w, lat: BBOX.s }, { lon: BBOX.e, lat: BBOX.s },
    ];
    for (const c of corners) {
      const t = lonLatToTile(c.lon, c.lat, z);
      expect(t.x).toBeGreaterThanOrEqual(r.xMin);
      expect(t.x).toBeLessThanOrEqual(r.xMax);
      expect(t.y).toBeGreaterThanOrEqual(r.yMin);
      expect(t.y).toBeLessThanOrEqual(r.yMax);
    }
  });
});

describe('compositeBounds', () => {
  it('fully contains the bbox and sizes pixels by tile count', () => {
    const z = 15;
    const r = tileRangeForBbox(BBOX, z);
    const c = compositeBounds(r, z);
    expect(c.bounds.w).toBeLessThanOrEqual(BBOX.w);
    expect(c.bounds.e).toBeGreaterThanOrEqual(BBOX.e);
    expect(c.bounds.n).toBeGreaterThanOrEqual(BBOX.n);
    expect(c.bounds.s).toBeLessThanOrEqual(BBOX.s);
    expect(c.sizePx.w).toBe((r.xMax - r.xMin + 1) * TILE_SIZE);
    expect(c.sizePx.h).toBe((r.yMax - r.yMin + 1) * TILE_SIZE);
  });
});
```

> 注意:`lonLatToTile` 已在檔案上方 import;新增的 import 行加在檔頭即可(vitest 允許多個 import,同檔重複 describe 沒問題)。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/port-tiles.test.ts`
Expected: FAIL — `tileRangeForBbox is not a function` / `compositeBounds is not a function`。

- [ ] **Step 3: 寫最小實作(append 到 `geo/tiles.ts`)**

```ts
export interface Bbox { s: number; w: number; n: number; e: number; }
export interface TileRange { xMin: number; xMax: number; yMin: number; yMax: number; }
export interface CompositeInfo {
  bounds: { n: number; s: number; e: number; w: number };
  sizePx: { w: number; h: number };
}

/** Inclusive tile-index range covering the bbox at zoom z. */
export function tileRangeForBbox(bbox: Bbox, z: number): TileRange {
  const nw = lonLatToTile(bbox.w, bbox.n, z); // west+north → smallest x, smallest y
  const se = lonLatToTile(bbox.e, bbox.s, z); // east+south → largest x, largest y
  return { xMin: nw.x, xMax: se.x, yMin: nw.y, yMax: se.y };
}

/** Geographic bounds + pixel size of the composite covering a tile range. */
export function compositeBounds(range: TileRange, z: number): CompositeInfo {
  const nw = tileToLonLat(range.xMin, range.yMin, z);          // NW corner of first tile
  const se = tileToLonLat(range.xMax + 1, range.yMax + 1, z);  // NW corner of tile past the last
  return {
    bounds: { n: nw.lat, w: nw.lon, s: se.lat, e: se.lon },
    sizePx: {
      w: (range.xMax - range.xMin + 1) * TILE_SIZE,
      h: (range.yMax - range.yMin + 1) * TILE_SIZE,
    },
  };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/port-tiles.test.ts`
Expected: PASS(全部 5 個 test 綠)。

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/geo/tiles.ts test/port-tiles.test.ts
git commit -m "$(cat <<'EOF'
feat(port): geo/tiles bbox→tile-range + composite bounds

tileRangeForBbox covers a bbox; compositeBounds returns the integer-
tile geographic bounds + pixel size for the stitched basemap (F2).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: NLSC 下載+拼接腳本 → 生成並 commit 資產

**Files:**
- Create: `examples/kaohsiung-port/data/fetch-basemap.ts`
- Modify: `package.json`(scripts + devDependency)
- Create(生成): `examples/kaohsiung-port/data/basemap-khh.jpg`、`data/basemap-khh.json`

- [ ] **Step 1: 安裝 `sharp`**

Run: `npm install -D sharp`
Expected: `package.json` devDependencies 出現 `sharp`;`node_modules/sharp` 可載入。

- [ ] **Step 2: 加 `port:basemap` script**

Modify `package.json` `"scripts"`,在 `port:osm` 後加一行:

```json
    "port:osm": "vite-node examples/kaohsiung-port/data/fetch-osm.ts",
    "port:basemap": "vite-node examples/kaohsiung-port/data/fetch-basemap.ts"
```

- [ ] **Step 3: 寫 `data/fetch-basemap.ts`**

Create `examples/kaohsiung-port/data/fetch-basemap.ts`:

```ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';
import { tileRangeForBbox, compositeBounds, TILE_SIZE, type Bbox } from '../geo/tiles';

const BBOX: Bbox = { s: 22.53, w: 120.24, n: 22.64, e: 120.34 };
const Z = 15;
const LAYER = 'PHOTO2';
const tileUrl = (z: number, x: number, y: number) =>
  `https://wmts.nlsc.gov.tw/wmts/${LAYER}/default/GoogleMapsCompatible/${z}/${y}/${x}`;

async function fetchTile(z: number, x: number, y: number): Promise<Buffer> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(tileUrl(z, x, y), { headers: { 'User-Agent': 'LiDAR-fetch/1.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
    }
  }
  throw new Error(`tile ${z}/${y}/${x} failed after 3 attempts: ${lastErr}`);
}

const range = tileRangeForBbox(BBOX, Z);
const { bounds, sizePx } = compositeBounds(range, Z);

// Probe the NW tile first — fail fast with a clear message if zoom is unavailable.
await fetchTile(Z, range.xMin, range.yMin);

const layers: sharp.OverlayOptions[] = [];
for (let x = range.xMin; x <= range.xMax; x++) {
  for (let y = range.yMin; y <= range.yMax; y++) {
    const buf = await fetchTile(Z, x, y);
    layers.push({ input: buf, left: (x - range.xMin) * TILE_SIZE, top: (y - range.yMin) * TILE_SIZE });
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const imgPath = resolve(here, 'basemap-khh.jpg');
const metaPath = resolve(here, 'basemap-khh.json');

await sharp({ create: { width: sizePx.w, height: sizePx.h, channels: 3, background: { r: 0, g: 0, b: 0 } } })
  .composite(layers)
  .jpeg({ quality: 85 })
  .toFile(imgPath);

writeFileSync(metaPath, JSON.stringify(
  { z: Z, layer: LAYER, bbox: BBOX, tileRange: range, bounds, sizePx, source: 'NLSC PHOTO2 WMTS · 內政部國土測繪中心' },
  null, 2,
));

console.log(`wrote ${imgPath} (${sizePx.w}x${sizePx.h}px, ${layers.length} tiles) and ${metaPath}`);
```

- [ ] **Step 4: 執行腳本生成資產**

Run: `npm run port:basemap`
Expected: 印出 `wrote .../basemap-khh.jpg (2560x2816px, 110 tiles) and .../basemap-khh.json`(數字依實際圖磚範圍而定)。`data/basemap-khh.jpg`(約 2–4 MB)與 `data/basemap-khh.json` 生成。

- [ ] **Step 5: 驗證資產合理**

Run: `node -e "const m=require('./examples/kaohsiung-port/data/basemap-khh.json'); console.log(m.bounds, m.sizePx); const c=m.bounds; if(!(c.w<=120.24 && c.e>=120.34 && c.n>=22.64 && c.s<=22.53)) throw new Error('bounds do not contain bbox'); console.log('bounds OK')"`
Expected: 印出 bounds/sizePx 與 `bounds OK`。
Run: `git check-ignore examples/kaohsiung-port/data/basemap-khh.jpg || echo 'jpg is tracked'`
Expected: `jpg is tracked`(若被 ignore,於 `.gitignore` 加例外 `!examples/kaohsiung-port/data/basemap-khh.jpg`)。

- [ ] **Step 6: Commit**

```bash
git add package.json examples/kaohsiung-port/data/fetch-basemap.ts \
  examples/kaohsiung-port/data/basemap-khh.jpg examples/kaohsiung-port/data/basemap-khh.json
git commit -m "$(cat <<'EOF'
feat(port): fetch+bake NLSC PHOTO2 aerial basemap snapshot

npm run port:basemap downloads NLSC PHOTO2 tiles for the port bbox at
z15, stitches them with sharp into one committed composite (jpg) plus
bounds metadata (json). Frozen, reproducible, no runtime key/CORS.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 執行期改寫 — 航照 plane + 預設開

**Files:**
- Modify: `examples/kaohsiung-port/main.ts`(imports、`buildMapPlane()`、`__twin`)
- Modify: `examples/kaohsiung-port/ui/overlay.ts`(底圖鈕初始狀態)

- [ ] **Step 1: main.ts 加資產 import**

在 `main.ts` 第 12 行 `import osmData from './data/osm-khh.json';` 之後新增兩行:

```ts
import basemapMeta from './data/basemap-khh.json';
import basemapUrl from './data/basemap-khh.jpg';
```

- [ ] **Step 2: 替換 `buildMapPlane()`**

把 `main.ts` 現有第 104–137 行(從註解 `// C backdrop: a chart-style map plane ...` 到 `const mapPlane = buildMapPlane();`)整段替換為:

```ts
// C backdrop: real NLSC aerial orthophoto (baked offline, see data/fetch-basemap.ts),
// tinted at runtime via material color-multiply for the dark situation-room look.
function buildBasemapPlane(): THREE.Mesh {
  const b = basemapMeta.bounds;
  const sw = proj.toWorld(b.s, b.w), ne = proj.toWorld(b.n, b.e);
  const pw = Math.abs(ne.x - sw.x), ph = Math.abs(ne.z - sw.z);
  const mat = new THREE.MeshBasicMaterial({ color: 0x3a5a72, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((sw.x + ne.x) / 2, -0.5, (sw.z + ne.z) / 2);
  mesh.visible = true; // default ON — the aerial base is the new centerpiece
  new THREE.TextureLoader().load(
    basemapUrl,
    (tex) => { tex.colorSpace = THREE.SRGBColorSpace; mat.map = tex; mat.needsUpdate = true; },
    undefined,
    () => { mesh.visible = false; console.warn('[basemap] texture load failed; hiding plane'); },
  );
  return mesh;
}
const mapPlane = buildBasemapPlane();
```

(第 138 行 `engine.addLayer(mapPlane);` 保留不動。)

- [ ] **Step 3: `__twin` 加 `setBasemapTint`**

把 `main.ts` 最後的 `window.__twin = { ... }` 物件(現第 178 行)結尾加入除錯把手。將:

```ts
(window as any).__twin = { engine, basePC, shipPC, incPC, mapPlane, rebuildShips, rebuildIncoming, refresh, nowMs, intervals, get shipCenters() { return shipCenters; } };
```

改為:

```ts
(window as any).__twin = {
  engine, basePC, shipPC, incPC, mapPlane, rebuildShips, rebuildIncoming, refresh, nowMs, intervals,
  get shipCenters() { return shipCenters; },
  setBasemapTint: (hex: number) => { (mapPlane.material as THREE.MeshBasicMaterial).color.setHex(hex); },
};
```

- [ ] **Step 4: overlay.ts 底圖鈕預設「開」**

在 `examples/kaohsiung-port/ui/overlay.ts`:
- 第 62 行 `bgBtn.textContent = '🗺️ 地圖底圖:關';` → `bgBtn.textContent = '🗺️ 地圖底圖:開';`
- 第 64 行 `let bgOn = false;` → `let bgOn = true;`

- [ ] **Step 5: 型別檢查 + build 通過**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 0 錯(`.jpg` 由 `vite/client` 提供型別、`.json` import 由既有 `osm-khh.json` 模式證實可用)。
Run: `npm run build`
Expected: vite 打包 + tsc 宣告成功。

- [ ] **Step 6: Commit**

```bash
git add examples/kaohsiung-port/main.ts examples/kaohsiung-port/ui/overlay.ts
git commit -m "$(cat <<'EOF'
feat(port): swap chart plane for NLSC aerial basemap, default on

buildMapPlane → buildBasemapPlane: loads the baked NLSC orthophoto as
the ground texture, aligned via projection bounds, color-multiplied to
the war-room tint (0x3a5a72). Backdrop toggle now defaults to on;
__twin.setBasemapTint exposed for tuning.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 全面驗證(測試 / 型別 / 視覺對齊)

**Files:** 無新增;必要時微調 `main.ts`(對齊/色值)。

- [ ] **Step 1: 全測試綠**

Run: `npm test`
Expected: 全部 test 綠(原 87 + 新 port-tiles 5 = 92)。

- [ ] **Step 2: 型別 + build**

Run: `npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: 0 錯、build 成功。

- [ ] **Step 3: 視覺驗證(航照顯示 + 對齊)**

Run: `npm run dev`(背景),用瀏覽器開 `http://localhost:5173/examples/kaohsiung-port/index.html`,截圖。
Expected:預設即顯示**染暗航照底圖**,港灣水域/碼頭與彩色船點**在正確位置對齊**(船點落在碼頭岸線上,非偏移/鏡像)。
- 若航照**南北或東西鏡像/偏移**:於 `buildBasemapPlane` 的 texture onLoad 內調整 —— 先試 `tex.center.set(0.5,0.5); tex.flipY` 或對 plane 在對應軸 `mesh.scale.x = -1`(東西鏡像)/旋轉 180°(南北),重跑視覺驗證。記錄最終修正。
- 點「🗺️ 地圖底圖」鈕應能關/開航照。

- [ ] **Step 4: 主控台無 error**

用瀏覽器列出 console messages。
Expected:無 error(尤其無 texture 載入失敗、無 NaN 幾何警告)。

- [ ] **Step 5: 若有對齊修正則 commit**

```bash
git add examples/kaohsiung-port/main.ts
git commit -m "$(cat <<'EOF'
fix(port): correct NLSC basemap texture orientation/alignment

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

(無修正則跳過此步。)

---

## Self-Review

**1. Spec coverage**(對照 [spec](../specs/2026-06-15-kaohsiung-port-nlsc-basemap-design.md)):
- §2-1 NLSC PHOTO2 來源 → Task 3 `LAYER='PHOTO2'`、`tileUrl`。✓
- §2-2 戰情室染暗 → Task 4 `MeshBasicMaterial.color=0x3a5a72`。✓
- §2-3 離線烘焙單張 → Task 3 sharp 合成 jpg。✓
- §2-4 染暗在執行期(資產乾淨) → 染暗在 Task 4 材質,Task 3 jpg 不染色。✓
- §2-5 sharp → Task 3 Step 1。✓
- §2-6 預設開 + 保留點雲 → Task 4 `visible=true` + overlay「開」;`basePC` 未動。✓
- §3 z15 / bbox / GetCapabilities 意圖 → Task 3 `Z=15`、BBOX、NW-tile probe(以 probe 取代 GetCapabilities,等效失敗保護)。✓
- §5.2 純函式 → Task 1/2。✓
- §5.3 腳本+重試+缺磚 throw → Task 3 `fetchTile` 3 次退避 + throw。✓
- §5.4 對齊/材質/切換/`setBasemapTint` → Task 4。✓
- §6 測試 → Task 1/2 + Task 5。✓
- §7 錯誤處理(腳本 throw、執行期 fallback 隱藏) → Task 3 + Task 4 onError。✓
- §8 誠實邊界(乾淨資產、bounds 記錄、來源標註) → Task 3 metadata `source`。✓

**2. Placeholder scan:** 無 TBD/TODO;所有 step 含實際 code/command/expected。Task 5 Step 3 的對齊修正為「條件式、附具體手法」,非 placeholder。✓

**3. Type consistency:** `lonLatToTile`/`tileToLonLat`/`tileRangeForBbox`/`compositeBounds`/`TILE_SIZE`/`Bbox` 在 Task 1/2 定義,Task 3 import 一致;`buildBasemapPlane` 回傳 `THREE.Mesh`,`mapPlane.material as THREE.MeshBasicMaterial` 一致;`basemapMeta.bounds` 形狀 `{n,s,e,w}` 與 Task 3 寫出的 json 一致。✓
