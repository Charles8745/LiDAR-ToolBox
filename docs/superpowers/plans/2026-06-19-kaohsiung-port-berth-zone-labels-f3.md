# 高雄港 F3 碼頭/分區標籤 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在高雄港 3D 戰情室加入三層距離 LOD 文字標籤(商港區 / 貨櫃中心 / 個別碼頭),碼頭層用官方真實船席座標,與真實 AIS 船位對齊。

**Architecture:** 官方 `GetMarker` 真實船席座標 → bake `berths-khh.json`;純資料/數學模組(`scene/portZones.ts` 分區表 + LOD 數學、`data/berthGeometry.ts` 解析)可單元測試;troika-three-text 在場景內畫 billboard SDF 文字(`scene/textLabels.ts`);引擎加一個 `addUpdate`/`tick` 每幀 hook 驅動 billboard + LOD。

**Tech Stack:** TypeScript、Three.js 0.171、troika-three-text(新,devDependency)、vite/vite-node、vitest、fonttools `pyftsubset`(字型子集化)。

## Global Constraints

- 引擎(`src/`)只做**加法擴充**;洞穴 demo(`examples/basic`)與既有 API 不受影響。
- 標籤**不進任何 bloom 群組**(UI 文字不發光)。
- troika 放 **devDependencies**(example-only;library entry 是 `src/index.ts`,引擎不依賴 troika)。
- LOD **單一全域度量**:所有 tier 淡化都用「相機到 `sceneCenter` 距離」;`sceneCenter = proj.toWorld(KAOHSIUNG_ORIGIN)`(= `{x:0,z:0}`)。berth 層的逐標籤距離只當**次級** declutter。
- z 分離**只用 yLift(~1u)**,**不用 polygonOffset**(底圖 `depthWrite:false`、y=0 結構是 Points,polygonOffset 無效)。`depthTest:true` 負責遮擋。
- 標籤**不沿用 `BERTH_LINE` 內插**(誠實度問題);碼頭位置一律來自 `berths-khh.json`。
- 建置/型別證明用 **`npx tsc --noEmit`**(根 tsconfig,涵蓋 examples)+ `npm run dev` 目視;**不**用 `npm run build`(lib 模式不碰 examples)。
- 測試模組路徑風格:`from '../examples/kaohsiung-port/...'`(test/ 在 repo 根)。
- 世界尺度:`WORLD_SCALE=0.025`(1u=40m),`S = WORLD_SCALE/0.01 = 2.5`;世界單位尺寸乘 `S`。
- basemap bounds(座標健檢用):`n=22.644432, s=22.522706, w=120.234375, e=120.344238`。
- commit 訊息結尾加:`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

---

### Task 1: troika 依賴 spike(硬前置)

確認 troika-three-text 能在本專案 vite/tsc 下運作;這是後續所有渲染任務的前提。

**Files:**
- Modify: `package.json`(devDependencies + 可能的 vite.config optimizeDeps)
- Possibly modify: `vite.config.ts`

**Interfaces:**
- Produces: 可用的 `import { Text } from 'troika-three-text'`;`npm run dev` 與 `npx tsc --noEmit` 皆過。

- [ ] **Step 1: 安裝 troika 為 devDependency**

Run: `npm i -D troika-three-text`
Expected: 安裝成功,`package.json` devDependencies 出現 `troika-three-text`,連帶 `troika-three-utils`/`troika-worker-utils`/`bidi-js`/`webgl-sdf-generator`。

- [ ] **Step 2: 建一個臨時 smoke 檔驗證 import 解析**

建立 `examples/kaohsiung-port/_troika-smoke.ts`:

```ts
import { Text } from 'troika-three-text';
const t = new Text();
t.text = '蓬萊';
console.log('troika Text constructed:', typeof t.sync);
```

- [ ] **Step 3: 型別檢查 + dev 解析**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 0 錯。**若報 troika 無型別宣告**,建立 `examples/kaohsiung-port/troika.d.ts`:

```ts
declare module 'troika-three-text' {
  import { Mesh, Color } from 'three';
  export class Text extends Mesh {
    text: string;
    font: string | null;
    fontSize: number;
    color: number | string | Color;
    anchorX: number | 'left' | 'center' | 'right' | string;
    anchorY: number | 'top' | 'middle' | 'bottom' | string;
    outlineWidth: number | string;
    outlineColor: number | string | Color;
    outlineOpacity: number;
    fillOpacity: number;
    depthOffset: number;
    sync(callback?: () => void): void;
    dispose(): void;
  }
}
```

Run: `npm run dev &` 然後 `curl -sS -m 10 http://localhost:5173/examples/kaohsiung-port/_troika-smoke.ts >/dev/null; echo done`(或瀏覽器載入該模組)。**若 vite 報 `webgl-sdf-generator` "does not provide an export named 'default'"**,在 `vite.config.ts` 加:

```ts
  optimizeDeps: { include: ['troika-three-text', 'webgl-sdf-generator'] },
```

Expected: dev server 啟動、模組可被 vite 轉譯無錯。停掉 dev server。

- [ ] **Step 4: 移除 smoke 檔,保留設定**

Run: `rm examples/kaohsiung-port/_troika-smoke.ts`

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vite.config.ts examples/kaohsiung-port/troika.d.ts 2>/dev/null
git commit -m "build(port-f3): add troika-three-text devDep + verify vite/tsc integration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 官方碼頭幾何解析(純,可測)

**Files:**
- Create: `examples/kaohsiung-port/data/berthGeometry.ts`
- Test: `test/port-berth-geometry.test.ts`

**Interfaces:**
- Produces:
  - `interface BerthMarker { code: string; lat: number; lon: number; angle: number; nameZh: string }`
  - `parseGetMarker(raw: { v?: unknown[] }): BerthMarker[]` — 取 `v`、過濾無座標、取兩端中點、distinct by `PIER`(latest-wins)。
  - `upsertBerths(map: Map<string, BerthMarker>, markers: BerthMarker[]): void` — union,latest-wins by `code`。

- [ ] **Step 1: 寫失敗測試**

建立 `test/port-berth-geometry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseGetMarker, upsertBerths, type BerthMarker } from '../examples/kaohsiung-port/data/berthGeometry';

// 取自實測 GetMarker 的精簡 fixture(d.v 數筆)。
const RAW = {
  v: [
    { PIER: '1001', LAT1: 22.61872, LONG1: 120.27507, LAT2: 22.61756, LONG2: 120.27938, ANGLE: 166, SP_NAME: '立揚' },
    { PIER: '1001', LAT1: 22.61872, LONG1: 120.27507, LAT2: 22.61756, LONG2: 120.27938, ANGLE: 166, SP_NAME: '後到的船' }, // 同碼頭 → latest-wins
    { PIER: '0003', LAT1: 22.61788, LONG1: 120.28504, LAT2: 22.61847, LONG2: 120.28378, ANGLE: 207, SP_NAME: '嶼戀' },
    { PIER: '   ', LAT1: 22.6, LONG1: 120.3, LAT2: 22.6, LONG2: 120.3, ANGLE: 0, SP_NAME: 'x' }, // 空 code → 跳過
    { PIER: '9999', LAT1: null, LONG1: null, LAT2: null, LONG2: null, ANGLE: 0, SP_NAME: 'y' }, // 無座標 → 跳過
  ],
};

describe('parseGetMarker', () => {
  it('returns distinct berths by PIER with midpoint coords, skipping invalid', () => {
    const out = parseGetMarker(RAW);
    expect(out.length).toBe(2);
    const b1 = out.find((b) => b.code === '1001')!;
    expect(b1.lat).toBeCloseTo((22.61872 + 22.61756) / 2, 5);
    expect(b1.lon).toBeCloseTo((120.27507 + 120.27938) / 2, 5);
    expect(b1.angle).toBe(166);
    expect(b1.nameZh).toBe('後到的船'); // latest-wins
  });
  it('handles empty/missing v', () => {
    expect(parseGetMarker({}).length).toBe(0);
    expect(parseGetMarker({ v: [] }).length).toBe(0);
  });
  it('falls back to endpoint 1 when endpoint 2 missing', () => {
    const out = parseGetMarker({ v: [{ PIER: '5', LAT1: 22.5, LONG1: 120.3 }] });
    expect(out[0].lat).toBeCloseTo(22.5, 6);
    expect(out[0].lon).toBeCloseTo(120.3, 6);
  });
});

describe('upsertBerths', () => {
  it('unions latest-wins by code', () => {
    const map = new Map<string, BerthMarker>();
    upsertBerths(map, [{ code: 'A', lat: 1, lon: 1, angle: 0, nameZh: 'old' }]);
    upsertBerths(map, [{ code: 'A', lat: 2, lon: 2, angle: 0, nameZh: 'new' }, { code: 'B', lat: 3, lon: 3, angle: 0, nameZh: '' }]);
    expect(map.size).toBe(2);
    expect(map.get('A')!.nameZh).toBe('new');
    expect(map.get('A')!.lat).toBe(2);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/port-berth-geometry.test.ts`
Expected: FAIL（`Cannot find module '.../data/berthGeometry'`）。

- [ ] **Step 3: 實作**

建立 `examples/kaohsiung-port/data/berthGeometry.ts`:

```ts
/** One berth's static geometry, parsed from the official KHB GetMarker feed. */
export interface BerthMarker {
  code: string;   // official 4-digit pier code, e.g. "1001"
  lat: number;    // midpoint of the two surveyed berth endpoints (WGS84)
  lon: number;
  angle: number;  // berth orientation in degrees (informational; from ANGLE)
  nameZh: string; // last-seen vessel name at the berth (informational; may be '')
}

interface RawVessel {
  PIER?: string;
  LAT1?: number | string | null; LONG1?: number | string | null;
  LAT2?: number | string | null; LONG2?: number | string | null;
  ANGLE?: number | string | null; SP_NAME?: string | null;
}

/**
 * Parse the (already JSON-decoded) GetMarker `d` object into distinct berth markers.
 * `v` is the occupied-vessel array; each entry carries its berth's surveyed endpoints.
 * Distinct by PIER (latest-wins); entries without a code or without endpoint 1 are skipped.
 */
export function parseGetMarker(raw: { v?: unknown[] }): BerthMarker[] {
  const map = new Map<string, BerthMarker>();
  for (const item of (raw.v ?? []) as RawVessel[]) {
    const code = String(item.PIER ?? '').trim();
    if (!code) continue;
    const lat1 = Number(item.LAT1), lon1 = Number(item.LONG1);
    if (!Number.isFinite(lat1) || !Number.isFinite(lon1)) continue;
    let lat2 = Number(item.LAT2), lon2 = Number(item.LONG2);
    if (!Number.isFinite(lat2) || !Number.isFinite(lon2)) { lat2 = lat1; lon2 = lon1; }
    map.set(code, {
      code,
      lat: (lat1 + lat2) / 2,
      lon: (lon1 + lon2) / 2,
      angle: Number(item.ANGLE) || 0,
      nameZh: String(item.SP_NAME ?? '').trim(),
    });
  }
  return [...map.values()];
}

/** Union new markers into an existing map, latest-wins by `code`. */
export function upsertBerths(map: Map<string, BerthMarker>, markers: BerthMarker[]): void {
  for (const m of markers) map.set(m.code, m);
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/port-berth-geometry.test.ts`
Expected: PASS（6 例)。

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/data/berthGeometry.ts test/port-berth-geometry.test.ts
git commit -m "feat(port-f3): parse official GetMarker into distinct berth markers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 碼頭資料採集 CLI + bake 工件

**Files:**
- Create: `examples/kaohsiung-port/data/fetch-berths.ts`
- Create (產出): `examples/kaohsiung-port/data/berths-khh.json`
- Modify: `package.json`(scripts 加 `port:berths`)

**Interfaces:**
- Consumes: `parseGetMarker`, `upsertBerths`, `BerthMarker`(Task 2)。
- Produces: `berths-khh.json` 形如 `{ capturedAtMs: number, berths: BerthMarker[] }`(供 Task 8 import)。

- [ ] **Step 1: 寫 CLI(累積式,比照 record-twport 的原子寫 + resume)**

建立 `examples/kaohsiung-port/data/fetch-berths.ts`:

```ts
import { writeFileSync, renameSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseGetMarker, upsertBerths, type BerthMarker } from './berthGeometry';

const ENDPOINT = 'https://sdci.twport.com.tw/khbweb/osmx2.aspx/GetMarker';

/** POST GetMarker, unwrap the double-encoded `{d:"<json>"}`, return the inner object. */
async function fetchGetMarker(): Promise<{ v?: unknown[] }> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: '{}',
      });
      if (!res.ok) throw new Error(`GetMarker HTTP ${res.status}`);
      const outer = (await res.json()) as { d?: string };
      if (!outer.d) throw new Error('GetMarker: missing `d`');
      return JSON.parse(outer.d) as { v?: unknown[] };
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastErr;
}

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, 'berths-khh.json');

// Accumulate: load existing berths as union seed (GetMarker only returns currently-occupied
// berths each call; running this repeatedly grows coverage toward the full set).
const union = new Map<string, BerthMarker>();
if (existsSync(outPath)) {
  try {
    const prev = JSON.parse(readFileSync(outPath, 'utf8')) as { berths?: BerthMarker[] };
    if (Array.isArray(prev.berths)) upsertBerths(union, prev.berths);
    console.log(`resuming from ${outPath}: ${union.size} berths in union`);
  } catch {
    console.warn(`existing ${outPath} unreadable; starting fresh`);
  }
}

const capturedAtMs = Date.now();
const fresh = parseGetMarker(await fetchGetMarker());
upsertBerths(union, fresh);
const berths = [...union.values()].sort((a, b) => a.code.localeCompare(b.code));

mkdirSync(here, { recursive: true });
const tmp = `${outPath}.tmp`;
writeFileSync(tmp, JSON.stringify({ capturedAtMs, berths }, null, 2));
renameSync(tmp, outPath);
console.log(`wrote ${outPath}: +${fresh.length} this run, ${berths.length} total distinct berths`);
```

- [ ] **Step 2: 加 npm script**

在 `package.json` `scripts` 加一行(接在 `port:twport:record` 後):

```json
    "port:berths": "vite-node examples/kaohsiung-port/data/fetch-berths.ts"
```

- [ ] **Step 3: 跑一次產生工件**

Run: `npm run port:berths`
Expected: 印出 `wrote .../berths-khh.json: +N this run, N total distinct berths`(N ≈ 70–120)。**若因網路不可達失敗**,記錄並改在可達環境重跑(endpoint 已實測從開發機可達)。

- [ ] **Step 4: 健檢工件**

Run: `node -e "const d=require('./examples/kaohsiung-port/data/berths-khh.json'); console.log('berths',d.berths.length); const b=d.berths[0]; console.log(b.code, b.lat.toFixed(5), b.lon.toFixed(5), 'ang='+b.angle); const inB=d.berths.every(x=>x.lat>22.52&&x.lat<22.65&&x.lon>120.23&&x.lon<120.35); console.log('all in bbox:', inB)"`
Expected: `all in bbox: true`,座標合理。

- [ ] **Step 5: Commit(含工件)**

```bash
git add examples/kaohsiung-port/data/fetch-berths.ts examples/kaohsiung-port/data/berths-khh.json package.json
git commit -m "feat(port-f3): fetch-berths CLI + baked official berth geometry artifact

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: 分區表 + LOD 純函式(`scene/portZones.ts`)

**Files:**
- Create: `examples/kaohsiung-port/scene/portZones.ts`
- Test: `test/port-zones.test.ts`

**Interfaces:**
- Produces:
  - `type ZoneTier = 'district' | 'terminal'`
  - `interface PortZone { label: string; lat: number; lon: number; tier: ZoneTier }`
  - `const PORT_ZONES: PortZone[]`(13 區:4 district + 9 terminal)
  - `type Band = [number, number, number, number]`、`interface LodBands { district: Band; terminal: Band; berth: Band }`
  - `const DEFAULT_BANDS: LodBands`
  - `tierOpacity(tier: keyof LodBands, camDist: number, bands: LodBands): number`
  - `berthDeclutterVisible(labelDistToCamera: number, nearRadius: number): boolean`

- [ ] **Step 1: 寫失敗測試**

建立 `test/port-zones.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  PORT_ZONES, DEFAULT_BANDS, tierOpacity, berthDeclutterVisible, type LodBands,
} from '../examples/kaohsiung-port/scene/portZones';

const BBOX = { n: 22.644432, s: 22.522706, w: 120.234375, e: 120.344238 };

describe('PORT_ZONES', () => {
  it('has 13 zones (4 district + 9 terminal) with unique labels in bbox', () => {
    expect(PORT_ZONES.length).toBe(13);
    expect(PORT_ZONES.filter((z) => z.tier === 'district').length).toBe(4);
    expect(PORT_ZONES.filter((z) => z.tier === 'terminal').length).toBe(9);
    const labels = new Set(PORT_ZONES.map((z) => z.label));
    expect(labels.size).toBe(13);
    for (const z of PORT_ZONES) {
      expect(z.label.length).toBeGreaterThan(0);
      expect(z.lat).toBeGreaterThanOrEqual(BBOX.s);
      expect(z.lat).toBeLessThanOrEqual(BBOX.n);
      expect(z.lon).toBeGreaterThanOrEqual(BBOX.w);
      expect(z.lon).toBeLessThanOrEqual(BBOX.e);
    }
  });
});

describe('tierOpacity', () => {
  it('is 0 outside the band and ramps within fade edges', () => {
    const b: LodBands = { district: [100, 150, 1e9, 1e9], terminal: [40, 70, 170, 220], berth: [0, 0, 55, 90] };
    expect(tierOpacity('terminal', 30, b)).toBe(0);        // before fadeInStart
    expect(tierOpacity('terminal', 55, b)).toBeCloseTo(0.5, 1); // mid fade-in (40→70)
    expect(tierOpacity('terminal', 120, b)).toBe(1);       // full plateau
    expect(tierOpacity('terminal', 195, b)).toBeCloseTo(0.5, 1); // mid fade-out (170→220)
    expect(tierOpacity('terminal', 240, b)).toBe(0);       // after fadeOutEnd
  });
  it('berth tier is full near 0 and gone past its fade-out', () => {
    expect(tierOpacity('berth', 10, DEFAULT_BANDS)).toBe(1);
    expect(tierOpacity('berth', 1000, DEFAULT_BANDS)).toBe(0);
  });
  it('DEFAULT_BANDS leave no dead zone: some tier > 0 at every distance', () => {
    for (let d = 0; d <= 400; d += 5) {
      const total = tierOpacity('district', d, DEFAULT_BANDS)
        + tierOpacity('terminal', d, DEFAULT_BANDS)
        + tierOpacity('berth', d, DEFAULT_BANDS);
      expect(total).toBeGreaterThan(0);
    }
  });
});

describe('berthDeclutterVisible', () => {
  it('hides labels farther than nearRadius from the camera', () => {
    expect(berthDeclutterVisible(30, 60)).toBe(true);
    expect(berthDeclutterVisible(90, 60)).toBe(false);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/port-zones.test.ts`
Expected: FAIL（模組不存在)。

- [ ] **Step 3: 實作(分區座標先放近似,Task 9 目視校正)**

建立 `examples/kaohsiung-port/scene/portZones.ts`:

```ts
export type ZoneTier = 'district' | 'terminal';
export interface PortZone { label: string; lat: number; lon: number; tier: ZoneTier }

/**
 * Official KHB zone taxonomy (osmx2.aspx dropdown a01–a13): 4 commercial districts +
 * 9 container/terminal zones. Coordinates are hand-placed against the NLSC basemap
 * (coarse area headers, not survey-grade) — calibrated visually in the final task.
 * North→south along the commercial wharf line.
 */
export const PORT_ZONES: PortZone[] = [
  { label: '蓬萊商港區', tier: 'district', lat: 22.6180, lon: 120.2790 },
  { label: '鹽埕商港區', tier: 'district', lat: 22.6120, lon: 120.2840 },
  { label: '苓雅商港區', tier: 'district', lat: 22.6040, lon: 120.2900 },
  { label: '中島商港區', tier: 'district', lat: 22.5930, lon: 120.2980 },
  { label: '第一貨櫃中心', tier: 'terminal', lat: 22.6090, lon: 120.2870 },
  { label: '第二貨櫃中心', tier: 'terminal', lat: 22.6000, lon: 120.2940 },
  { label: '第三貨櫃中心', tier: 'terminal', lat: 22.5870, lon: 120.3030 },
  { label: '第四貨櫃中心', tier: 'terminal', lat: 22.5760, lon: 120.3070 },
  { label: '第五貨櫃中心', tier: 'terminal', lat: 22.5650, lon: 120.3110 },
  { label: '第六貨櫃中心', tier: 'terminal', lat: 22.5540, lon: 120.3170 },
  { label: '第七貨櫃中心', tier: 'terminal', lat: 22.5470, lon: 120.3270 },
  { label: '洲際二期', tier: 'terminal', lat: 22.5420, lon: 120.3300 },
  { label: '海事工作船渠', tier: 'terminal', lat: 22.5700, lon: 120.3000 },
];

/** [fadeInStart, fullStart, fullEnd, fadeOutEnd] in world units (camera→sceneCenter distance). */
export type Band = [number, number, number, number];
export interface LodBands { district: Band; terminal: Band; berth: Band }

/**
 * Nominal bands for WORLD_SCALE=0.025 (1u=40m). Far→district, mid→terminal, near→berth.
 * Bands overlap at the seams for cross-fade and cover [0,∞) with no dead zone.
 * Tuned visually in the final task; live as constants in main.ts.
 */
export const DEFAULT_BANDS: LodBands = {
  district: [120, 180, 1e9, 1e9],
  terminal: [40, 70, 170, 220],
  berth: [0, 0, 55, 90],
};

/** Opacity ∈ [0,1] for a tier at a given global camera distance. 0 outside the band. */
export function tierOpacity(tier: keyof LodBands, camDist: number, bands: LodBands): number {
  const [inStart, full0, full1, outEnd] = bands[tier];
  if (camDist <= inStart || camDist >= outEnd) return 0;
  if (camDist < full0) return (camDist - inStart) / (full0 - inStart || 1);
  if (camDist <= full1) return 1;
  return (outEnd - camDist) / (outEnd - full1 || 1);
}

/** Secondary per-label declutter for the berth tier: visible only within nearRadius. */
export function berthDeclutterVisible(labelDistToCamera: number, nearRadius: number): boolean {
  return labelDistToCamera <= nearRadius;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/port-zones.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/scene/portZones.ts test/port-zones.test.ts
git commit -m "feat(port-f3): port zone taxonomy + LOD opacity/declutter pure fns

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: CJK 字型子集化工件

**Files:**
- Create (產出): `examples/kaohsiung-port/data/fonts/zones-subset.woff`

**Interfaces:**
- Consumes: `PORT_ZONES`(Task 4,取字元集)。
- Produces: 小型 .woff,含所有區段字 + `0123456789#`,供 Task 7/8 `fontUrl`。

- [ ] **Step 1: 從 PORT_ZONES 算出字元集**

Run:
```bash
node -e "const {PORT_ZONES}=require('./examples/kaohsiung-port/scene/portZones.ts'); " 2>/dev/null || \
node --experimental-strip-types -e "import('./examples/kaohsiung-port/scene/portZones.ts').then(m=>{const s=new Set([...m.PORT_ZONES.map(z=>z.label).join(''),...'0123456789#']);process.stdout.write([...s].join(''))})" > /tmp/charset.txt 2>/dev/null || \
printf '蓬萊商港區鹽埕苓雅中島第一二三四五六七貨櫃心洲際期海事工作船渠0123456789#' > /tmp/charset.txt
cat /tmp/charset.txt; echo
```
Expected: 印出含全部區段字 + 數字 + `#` 的字串(最後一個 fallback 已涵蓋目前 13 區用字;若 PORT_ZONES 文字有改,以前兩種動態取得為準)。

- [ ] **Step 2: 取得 Noto Sans TC 來源字型**

Run:
```bash
mkdir -p examples/kaohsiung-port/data/fonts
curl -sL -o /tmp/NotoSansTC.otf \
  "https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/TraditionalChinese/NotoSansCJKtc-Regular.otf" \
  && ls -la /tmp/NotoSansTC.otf
```
Expected: 下載成功(數 MB)。**若失敗**,改用系統 CJK 字型:`fc-list | grep -iE "PingFang|Noto.*CJK|Heiti" | head` 取一個 `.ttf/.otf/.ttc` 路徑當來源(ttc 加 `--font-number=0`)。

- [ ] **Step 3: 子集化成 woff**

Run:
```bash
pyftsubset /tmp/NotoSansTC.otf \
  --text="$(cat /tmp/charset.txt)" \
  --flavor=woff --no-hinting --desubroutinize \
  --output-file=examples/kaohsiung-port/data/fonts/zones-subset.woff \
  && ls -la examples/kaohsiung-port/data/fonts/zones-subset.woff
```
Expected: 產出 .woff,**大小 < 100KB**(理想 <50KB)。`pyftsubset` 來自 fonttools(已確認 `/opt/anaconda3/bin`;否則 `pip install fonttools brotli`)。

- [ ] **Step 4: 驗證 cmap 覆蓋(tofu 防呆)**

Run:
```bash
python3 -c "
from fontTools.ttLib import TTFont
f=TTFont('examples/kaohsiung-port/data/fonts/zones-subset.woff')
cmap=set(f.getBestCmap().keys())
need=set(ord(c) for c in open('/tmp/charset.txt',encoding='utf-8').read())
missing=[chr(c) for c in need-cmap]
print('missing glyphs:', missing)
assert not missing, missing
print('OK all', len(need), 'chars covered')
"
```
Expected: `OK all N chars covered`(無缺字)。

- [ ] **Step 5: Commit(含字型工件)**

```bash
git add examples/kaohsiung-port/data/fonts/zones-subset.woff
git commit -m "feat(port-f3): subsetted Noto Sans TC woff for zone/berth labels

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: 引擎每幀 hook(`addUpdate` / `tick`,可測)

**Files:**
- Create: `src/core/updaters.ts`
- Modify: `src/core/LidarEngine.ts`(import + field + methods + loop 呼叫)
- Test: `test/engine-updaters.test.ts`

**Interfaces:**
- Produces:
  - `type UpdateFn = (dt: number, time: number) => void`
  - `runUpdaters(updaters: readonly UpdateFn[], dt: number, time: number): void`
  - `LidarEngine.addUpdate(fn: UpdateFn): void`、`LidarEngine.tick(dt: number, time: number): void`

- [ ] **Step 1: 寫失敗測試(只測純調度,不實例化 WebGL 引擎)**

建立 `test/engine-updaters.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runUpdaters, type UpdateFn } from '../src/core/updaters';

describe('runUpdaters', () => {
  it('invokes each updater in registration order with (dt, time)', () => {
    const calls: Array<[string, number, number]> = [];
    const a: UpdateFn = (dt, t) => calls.push(['a', dt, t]);
    const b: UpdateFn = (dt, t) => calls.push(['b', dt, t]);
    runUpdaters([a, b], 0.016, 1.5);
    expect(calls).toEqual([['a', 0.016, 1.5], ['b', 0.016, 1.5]]);
  });
  it('does nothing for an empty list', () => {
    expect(() => runUpdaters([], 0.016, 0)).not.toThrow();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/engine-updaters.test.ts`
Expected: FAIL（模組不存在)。

- [ ] **Step 3: 實作純 helper**

建立 `src/core/updaters.ts`:

```ts
export type UpdateFn = (dt: number, time: number) => void;

/** Invoke each registered updater in order with the frame delta and absolute time. */
export function runUpdaters(updaters: readonly UpdateFn[], dt: number, time: number): void {
  for (const u of updaters) u(dt, time);
}
```

- [ ] **Step 4: 接進引擎**

在 `src/core/LidarEngine.ts`:

1) import(接在第 6 行 `buildRampTextureFromFn` import 後):
```ts
import { runUpdaters, type UpdateFn } from './updaters';
```

2) field(接在第 51 行 `private extraLayers...` 後):
```ts
  private updaters: UpdateFn[] = [];
```

3) loop 內呼叫:把 `this.controls?.update();`(現第 169 行)後、`if (this.bloom)`(現第 171 行)前,插入:
```ts
    this.tick(dt, this.time);
```

4) 公開方法(放在 `get camera3D()` getter 之前,約現第 244 行附近):
```ts
  /** Register a per-frame callback (dt seconds, absolute time). Runs once per rendered frame. */
  addUpdate(fn: UpdateFn): void { this.updaters.push(fn); }

  /** Run all registered updaters. Called by the render loop; exposed for headless testing. */
  tick(dt: number, time: number): void { runUpdaters(this.updaters, dt, time); }
```

- [ ] **Step 5: 跑測試 + 型別檢查**

Run: `npx vitest run test/engine-updaters.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS + 0 型別錯。

- [ ] **Step 6: Commit**

```bash
git add src/core/updaters.ts src/core/LidarEngine.ts test/engine-updaters.test.ts
git commit -m "feat(engine): addUpdate/tick per-frame hook (additive, headless-testable)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: troika 標籤層(`scene/textLabels.ts`)

**Files:**
- Create: `examples/kaohsiung-port/scene/textLabels.ts`

**Interfaces:**
- Consumes: `PortZone`/`LodBands`/`tierOpacity`/`berthDeclutterVisible`(Task 4)、`BerthMarker`(Task 2)、`Projection`(`geo/projection`)、troika `Text`(Task 1)。
- Produces:
  - `interface LabelLayerOpts { proj: Projection; bands: LodBands; nearRadius: number; yLift: number; fontUrl: string; color: number; outlineColor: number; sceneCenter: { x: number; z: number }; fontSizes: { district: number; terminal: number; berth: number } }`
  - `buildLabelLayer(zones: PortZone[], berths: BerthMarker[], opts: LabelLayerOpts): { group: THREE.Group; update(camera: THREE.Camera): void; setTierVisible(tier: 'district' | 'terminal' | 'berth', on: boolean): void; dispose(): void }`

- [ ] **Step 1: 實作(無單元測試;數學已在 portZones 測過,此層為 WebGL/troika 膠)**

建立 `examples/kaohsiung-port/scene/textLabels.ts`:

```ts
import * as THREE from 'three';
import { Text } from 'troika-three-text';
import type { Projection } from '../geo/projection';
import type { BerthMarker } from '../data/berthGeometry';
import { tierOpacity, berthDeclutterVisible, type PortZone, type LodBands } from './portZones';

export interface LabelLayerOpts {
  proj: Projection;
  bands: LodBands;
  nearRadius: number;                       // berth declutter threshold (world units)
  yLift: number;                            // height above y=0 to clear ground Points
  fontUrl: string;                          // CJK subset .woff (also covers digits + #)
  color: number;
  outlineColor: number;
  sceneCenter: { x: number; z: number };    // global LOD distance reference
  fontSizes: { district: number; terminal: number; berth: number };
}

type Tier = 'district' | 'terminal' | 'berth';
interface LabelEntry { text: Text; tier: Tier; x: number; z: number }

export function buildLabelLayer(zones: PortZone[], berths: BerthMarker[], opts: LabelLayerOpts) {
  const group = new THREE.Group();
  const entries: LabelEntry[] = [];
  const tierShown: Record<Tier, boolean> = { district: true, terminal: true, berth: true };

  function add(str: string, lat: number, lon: number, tier: Tier): void {
    const w = opts.proj.toWorld(lat, lon);
    const t = new Text();
    t.text = str;
    t.font = opts.fontUrl;
    t.fontSize = opts.fontSizes[tier];
    t.color = opts.color;
    t.outlineColor = opts.outlineColor;
    t.outlineWidth = '6%';
    t.anchorX = 'center';
    t.anchorY = 'middle';
    t.fillOpacity = 0;       // hidden until LOD raises it (and until SDF is ready)
    t.outlineOpacity = 0;
    t.position.set(w.x, opts.yLift, w.z);
    (t.material as THREE.Material).depthTest = true;
    t.sync();                // pre-warm SDF generation during load (avoids glyph pop-in)
    group.add(t);
    entries.push({ text: t, tier, x: w.x, z: w.z });
  }

  for (const z of zones) add(z.label, z.lat, z.lon, z.tier);
  for (const b of berths) add(b.code, b.lat, b.lon, 'berth');

  function update(camera: THREE.Camera): void {
    const dx = camera.position.x - opts.sceneCenter.x;
    const dz = camera.position.z - opts.sceneCenter.z;
    const camDist = Math.sqrt(dx * dx + camera.position.y * camera.position.y + dz * dz);
    for (const e of entries) {
      if (!tierShown[e.tier]) { e.text.visible = false; continue; }
      let op = tierOpacity(e.tier, camDist, opts.bands);
      if (e.tier === 'berth' && op > 0) {
        const ldx = camera.position.x - e.x, ldz = camera.position.z - e.z;
        const lDist = Math.sqrt(ldx * ldx + camera.position.y * camera.position.y + ldz * ldz);
        if (!berthDeclutterVisible(lDist, opts.nearRadius)) op = 0;
      }
      e.text.fillOpacity = op;
      e.text.outlineOpacity = op;
      e.text.visible = op > 0.01;
      if (e.text.visible) e.text.quaternion.copy(camera.quaternion); // billboard
    }
  }

  function setTierVisible(tier: Tier, on: boolean): void { tierShown[tier] = on; }
  function dispose(): void { for (const e of entries) e.text.dispose(); }

  return { group, update, setTierVisible, dispose };
}
```

- [ ] **Step 2: 型別檢查**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 0 錯(若 troika 型別缺,Task 1 的 `troika.d.ts` 已補)。

- [ ] **Step 3: Commit**

```bash
git add examples/kaohsiung-port/scene/textLabels.ts
git commit -m "feat(port-f3): troika billboard SDF label layer with LOD fade + declutter

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: main.ts 接線

**Files:**
- Modify: `examples/kaohsiung-port/main.ts`

**Interfaces:**
- Consumes: `buildLabelLayer`(Task 7)、`PORT_ZONES`/`DEFAULT_BANDS`(Task 4)、`BerthMarker`(Task 2)、`berths-khh.json`(Task 3)、`zones-subset.woff`(Task 5)、`engine.addUpdate`(Task 6)。

- [ ] **Step 1: import 標籤模組 + 資料 + 字型**

在 `main.ts` import 區(接在第 17 行 `basemapUrl` import 後)加:

```ts
import { buildLabelLayer } from './scene/textLabels';
import { PORT_ZONES, DEFAULT_BANDS } from './scene/portZones';
import type { BerthMarker } from './data/berthGeometry';
import berthsData from './data/berths-khh.json';
import labelFontUrl from './data/fonts/zones-subset.woff?url';
```

- [ ] **Step 2: 在 engine + 圖層建立後、`engine.start()` 前後接入標籤層**

在 `engine.addLayer(mapPlane);`(現第 208 行)之後、`engine.start();`(現第 209 行)之前,插入:

```ts
// F3: berth/zone labels — real official berth coords + 3-tier distance LOD (troika SDF).
const berths = (berthsData as { berths: BerthMarker[] }).berths;
const sceneCenter = proj.toWorld(KAOHSIUNG_ORIGIN.lat, KAOHSIUNG_ORIGIN.lon); // {x:0,z:0}
const labels = buildLabelLayer(PORT_ZONES, berths, {
  proj,
  bands: DEFAULT_BANDS,
  nearRadius: 60 * S,           // berth labels show within ~2.4km of camera
  yLift: 1.0 * S,               // clear of y=0 structure (ships sit at 0.5*S)
  fontUrl: labelFontUrl,
  color: 0xcbd5df,              // war-room silver
  outlineColor: 0x0b0c0e,       // dark ink outline for legibility
  sceneCenter: { x: sceneCenter.x, z: sceneCenter.z },
  fontSizes: { district: 3.0 * S, terminal: 2.2 * S, berth: 1.0 * S },
});
engine.addLayer(labels.group);  // NOT in any bloom group → labels don't glow
engine.addUpdate(() => labels.update(engine.camera3D));
```

- [ ] **Step 3: 字型載入失敗防呆(比照 basemap onError)**

在上段之後加:

```ts
fetch(labelFontUrl, { method: 'HEAD' }).then((r) => {
  if (!r.ok) { labels.group.visible = false; console.warn('[labels] font load failed; hiding labels'); }
}).catch(() => { labels.group.visible = false; console.warn('[labels] font fetch error; hiding labels'); });
```

- [ ] **Step 4: 暴露 __twin.labels 把手**

在 `__twin` 物件(現第 282–288 行)內加一個欄位(例如接在 `layers:` 行後):

```ts
  labels,
```

- [ ] **Step 5: 型別檢查 + dev 啟動目視 smoke**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 0 錯。

Run: `npm run dev`(背景),瀏覽器開 `/examples/kaohsiung-port/index.html`,主控台跑 `__twin.labels.setTierVisible('berth', true)`。
Expected: 場景出現文字標籤;拉遠見區段名、拉近見碼頭碼;主控台無 error(favicon 404 除外)。停掉 dev server。

- [ ] **Step 6: Commit**

```bash
git add examples/kaohsiung-port/main.ts
git commit -m "feat(port-f3): wire berth/zone label layer into the port scene

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: 目視校正(手動,無單元測試)

對著實際畫面調分區座標、LOD 帶、遮擋、對齊。**這是一個目視驗證任務**——用 `npm run dev` + 截圖反覆調,把調好的數值寫回常數。

**Files:**
- Modify: `examples/kaohsiung-port/scene/portZones.ts`(`PORT_ZONES` 座標、`DEFAULT_BANDS`)
- Modify: `examples/kaohsiung-port/main.ts`(`nearRadius`/`yLift`/`fontSizes` 等常數,如需)

- [ ] **Step 1: 啟動 dev + 截圖三個縮放層級**

Run: `npm run dev`;用瀏覽器工具導到 `/examples/kaohsiung-port/index.html`,在遠 / 中 / 近三個 orbit 距離各截一張。

- [ ] **Step 2: 校正分區座標**

對照 NLSC 底圖,把每個 `PORT_ZONES` 項目的 `lat/lon` 移到該港區/貨櫃中心在底圖上的正確位置(square marker 中心參考 Task 3 的真實碼頭點分布)。逐項微調直到落位合理。

- [ ] **Step 3: 校正 LOD 帶 + declutter + 遮擋**

驗證並調整(改 `DEFAULT_BANDS` / `nearRadius` / `yLift` / `fontSizes`):
- 遠只見商港區名;中見貨櫃中心名;近見碼頭碼;**跨 tier 交叉淡化平滑、無突跳、無「無標籤死區」**。
- 近距碼頭碼**只亮鏡頭附近幾個**(不糊成一團);與真實 AIS 船位**對齊**(同碼頭的船和碼頭碼相鄰)。
- 標籤**被起重機/地物正確遮擋**;**無與底圖 z-fighting**(yLift 足夠);**無 glyph 跳入**(預熱生效);**無 tofu 缺字**。
- 主控台無 error。

- [ ] **Step 4: Commit 校正後常數**

```bash
git add examples/kaohsiung-port/scene/portZones.ts examples/kaohsiung-port/main.ts
git commit -m "fix(port-f3): visually calibrate zone coords, LOD bands, label scale

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: 文件更新

**Files:**
- Modify: `docs/vscode-dev-guide.md`
- Modify: `docs/superpowers/2026-06-14-handoff.md`

**Interfaces:** 無(文件)。

- [ ] **Step 1: dev guide 補 F3 章節**

在 `docs/vscode-dev-guide.md` 加一節「F3 碼頭/分區標籤」:
- `__twin.labels`(`setTierVisible('district'|'terminal'|'berth', on)`、`dispose()`)。
- 調校旋鈕:`DEFAULT_BANDS`(三層距離帶)、main.ts 的 `nearRadius`/`yLift`/`fontSizes`/`color`。
- 資料更新:`npm run port:berths`(累積式,多跑幾次增碼頭覆蓋;占用相關)。
- 字型子集化指令(從 `PORT_ZONES` 字元集 + 數字 + `#` → `pyftsubset` → `data/fonts/zones-subset.woff`;改字後需重跑)。

- [ ] **Step 2: handoff 更新**

在 `docs/superpowers/2026-06-14-handoff.md` 頂部加 F3 完成節:狀態、新檔(`data/berthGeometry.ts`/`data/fetch-berths.ts`/`scene/portZones.ts`/`scene/textLabels.ts`/`src/core/updaters.ts`)、新 script(`port:berths`)、新依賴(troika devDep)、**官方 GetMarker 資料源備查**(POST `osmx2.aspx/GetMarker`,`d.v` 含 `PIER`/`LAT1-2`/`LONG1-2`/`ANGLE`/`SP_NAME`,本機可達、占用相關需累積)、測試數、子專案狀態(F3 ✅,bonus:berth `ANGLE` 日後可改善靠泊朝向)。

- [ ] **Step 3: 最終全套驗證**

Run: `npm test && npx tsc --noEmit -p tsconfig.json`
Expected: 全綠(160 + 新增)、0 型別錯。

- [ ] **Step 4: Commit**

```bash
git add docs/vscode-dev-guide.md docs/superpowers/2026-06-14-handoff.md
git commit -m "docs(port-f3): dev guide labels section + handoff F3 done

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review(plan 對 spec)

- **Spec coverage**:碼頭真實座標→Task 2/3;13 區分類→Task 4;troika SDF→Task 1/7;三層 LOD 單一度量→Task 4/7;引擎 hook(可測 seam)→Task 6;字型子集 + tofu 防呆→Task 5;dispose 洩漏→Task 7(handle.dispose);bloom 不發光→Task 8;yLift 無 polygonOffset→Task 7/8;tsc 門檻→各 Task + Task 10;誠實邊界(覆蓋率)→Task 3 + Task 10 dev guide;目視驗證→Task 9。
- **Placeholder scan**:無 TBD;每個 code step 有完整程式碼與指令。
- **Type consistency**:`BerthMarker`/`PortZone`/`LodBands`/`Band`/`tierOpacity`/`berthDeclutterVisible`/`UpdateFn`/`runUpdaters`/`buildLabelLayer` 簽章跨 Task 一致;`berths-khh.json` 形狀 `{capturedAtMs,berths}` 於 Task 3 產出、Task 8 消費一致。
- **已知後續**:`main.ts` 無 `engine.dispose()` 呼叫路徑(handle.dispose 已備,實際 teardown 留待有 dispose 路徑時接;非本案阻礙)。
