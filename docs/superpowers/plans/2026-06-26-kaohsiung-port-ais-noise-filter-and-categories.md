# 高雄港 AIS 非船舶雜訊過濾 + 船型分類擴充 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 export 階段濾掉約 20% 非船舶 AIS 目標(助航浮標/漁網標/手持機/損壞訊號),修分類表破洞並新增「遊艇」「工程」2 個船型類別。

**Architecture:** 純函式分類器 `classifyAisTarget`/`isVessel` 置於 `data/ais.ts`(單一事實來源、可測試);`buildTracksFile` 於 export 時套用,新 CLI `refilter-tracks.ts` 對既有 commit 檔做一次性 re-bake。分類擴充改 `palette.ts`(類別+配色+對照表)、`data/ais.ts`(AIS碼對照)、`scene/portPoints.ts`(footprint 尺寸)。UI 篩選/KPI/3D fallback 皆資料驅動,自動跟上、零改動。

**Tech Stack:** TypeScript、vite-node(CLI runner)、vitest(測試)。Three.js 引擎 `src/` **零改動**。

## Global Constraints

- 引擎 `src/` 一律不動;改動只在 `examples/kaohsiung-port/`、`docs/`。
- 測試框架 vitest;測試檔在 repo 根 `test/`,以相對路徑 import `../examples/kaohsiung-port/...`。
- 既有測試須維持全綠(目前 **209**);每個 task 結尾跑 `npm test` 與 `npx tsc --noEmit -p tsconfig.json`(0 錯)。
- 類別順序相依:`SHIP_CATEGORIES`、`SHIP_CATEGORY_COLORS`、`TYPE_DIMS_M` 三者必須同步;新類別插在 `其他` **之前**(其他維持最後=兜底灰),既有 7 類 index 不變。
- 非船過濾**不靜默丟棄**:CLI / export 須印出「丟棄 N、依原因明細」。
- 分類器只接受有把握的丟棄;台灣正規 MMSI(首碼 `[2-7]`,含 416)+ 正常船名者**一律不丟**。
- 不做任何 3D 模型(延後);不新增 90-99「特殊作業」類別。
- commit 訊息結尾加 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

---

## File Structure

| 檔案 | 職責 | 動作 |
|---|---|---|
| `examples/kaohsiung-port/data/ais.ts` | 新增 `classifyAisTarget`/`isVessel`/`refilterTracksFile` 純函式;`buildTracksFile` 套過濾;`mapAisTypeToCategory` 補碼;`AisTracksFile.meta` 加 `droppedNonVessel` | Modify |
| `examples/kaohsiung-port/data/refilter-tracks.ts` | CLI:對既有 `khh-*.json` 重洗 | Create |
| `examples/kaohsiung-port/palette.ts` | `SHIP_CATEGORIES`/`SHIP_CATEGORY_COLORS` 加 2 類;`TYPE_TO_CATEGORY` 補 12 漏列名 | Modify |
| `examples/kaohsiung-port/scene/portPoints.ts` | `TYPE_DIMS_M` 加 遊艇/工程 | Modify |
| `package.json` | 加 `port:ais:refilter` script | Modify |
| `test/port-ais.test.ts` | `classifyAisTarget`/`isVessel`/`buildTracksFile`/`refilterTracksFile` 測試 | Modify |
| `test/port-palette.test.ts` | 新類別 + mapping 測試 | Modify |
| `examples/kaohsiung-port/data/ais-tracks/khh-2026-06-19.json`、`khh-2026-06-18.json` | re-bake 洗淨資料 | Modify(資料) |
| `docs/vscode-dev-guide.md`、`docs/superpowers/2026-06-14-handoff.md` | 文件 | Modify |

---

## Task 1: 純函式分類器 `classifyAisTarget` / `isVessel`

**Files:**
- Modify: `examples/kaohsiung-port/data/ais.ts`(在 `mapAisTypeToCategory` 之前插入)
- Test: `test/port-ais.test.ts`(append 新 describe)

**Interfaces:**
- Consumes: 既有 `AisTrack`(`{ mmsi, imo, callSign, name, aisType, path }`)。
- Produces:
  - `classifyAisTarget(t: Pick<AisTrack,'mmsi'|'name'|'aisType'>): { vessel: boolean; reason: NonVesselReason | '' }`
  - `isVessel(t: Pick<AisTrack,'mmsi'|'name'|'aisType'>): boolean`
  - `type NonVesselReason = 'aton' | 'handheld-sart' | 'sar-aircraft' | 'anomalous-mmsi' | 'buoy-name' | 'garbled'`

- [ ] **Step 1: Write the failing tests**

Append to `test/port-ais.test.ts`(import 行加上 `classifyAisTarget, isVessel`):

```ts
import { classifyAisTarget, isVessel } from '../examples/kaohsiung-port/data/ais';

const tgt = (mmsi: string, name: string, aisType = 0) => ({ mmsi, name, aisType });

describe('classifyAisTarget / isVessel', () => {
  it('keeps a normal Taiwan vessel (MMSI 416, plain name)', () => {
    expect(classifyAisTarget(tgt('416005912', 'KMSC NO502', 52))).toEqual({ vessel: true, reason: '' });
    expect(isVessel(tgt('416005912', 'KMSC NO502', 52))).toBe(true);
  });
  it('keeps a foreign vessel (MMSI first digit 2-7)', () => {
    expect(isVessel(tgt('249123456', 'BOKA CENTRE', 52))).toBe(true);
  });
  it('drops AtoN navigation aids (MMSI 99x)', () => {
    expect(classifyAisTarget(tgt('994160462', 'BUOY4314601', 0))).toEqual({ vessel: false, reason: 'aton' });
  });
  it('drops handheld VHF (MMSI 8x, 9 digits)', () => {
    expect(classifyAisTarget(tgt('888160001', '', 0))).toEqual({ vessel: false, reason: 'handheld-sart' });
  });
  it('drops SART/MOB/EPIRB (MMSI 970/972/974)', () => {
    expect(classifyAisTarget(tgt('972123456', '', 0)).reason).toBe('handheld-sart');
  });
  it('drops SAR aircraft (MMSI 111x)', () => {
    expect(classifyAisTarget(tgt('111232001', '', 0)).reason).toBe('sar-aircraft');
  });
  it('drops anomalous MMSI (not a 9-digit 2-7 station)', () => {
    expect(classifyAisTarget(tgt('904160462', '', 0)).reason).toBe('anomalous-mmsi');
    expect(classifyAisTarget(tgt('12345678', 'NEWLINE', 0)).reason).toBe('anomalous-mmsi');
  });
  it('drops fishing-net markers by name (battery % suffix) even on a legit MMSI', () => {
    expect(classifyAisTarget(tgt('416005111', '5897-07-93%', 0)).reason).toBe('buoy-name');
    expect(classifyAisTarget(tgt('416005112', 'HSD-NET-60%', 0)).reason).toBe('buoy-name');
    expect(classifyAisTarget(tgt('416005113', 'LONGLINEBUOY-T00881%', 0)).reason).toBe('buoy-name');
  });
  it('drops garbled names only when AIS code is illegal (>99)', () => {
    expect(classifyAisTarget(tgt('590123456', 'H3OL7CL20L0SL<2,F3/\\\\', 200)).reason).toBe('garbled');
  });
  it('keeps a plain-named code-0 unknown vessel', () => {
    expect(isVessel(tgt('416123456', 'TRITON 8', 0))).toBe(true);
  });
  it('does not flag a normal name with a single punctuation as garbled', () => {
    expect(isVessel(tgt('416123456', 'DER JIN TSAIR NO3', 0))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/port-ais.test.ts -t "classifyAisTarget"`
Expected: FAIL — `classifyAisTarget is not a function` / import error.

- [ ] **Step 3: Implement the classifier**

Insert into `examples/kaohsiung-port/data/ais.ts` immediately before `mapAisTypeToCategory` (around line 188):

```ts
export type NonVesselReason =
  | 'aton' | 'handheld-sart' | 'sar-aircraft' | 'anomalous-mmsi' | 'buoy-name' | 'garbled';

// Fishing-net AIS markers / buoys: name contains BUOY, or ends with a battery
// percentage like "-93%" / "--49%". (Bare "NET" intentionally NOT matched — the
// %-suffix already catches Taiwan net markers, and "NET" would false-hit names
// like PLANET; verified zero difference on real data 2026-06-19.)
const BUOY_NAME = /BUOY|--?\d{1,2}%/i;

/** Classify an AIS target as a real vessel or non-vessel noise (buoy / handheld /
 *  corrupt). Rules from ITU-R M.585 (MMSI prefixes) + M.1371 (type codes) + the
 *  Taiwan fishing-net-marker naming convention. See spec 2026-06-26. */
export function classifyAisTarget(
  t: Pick<AisTrack, 'mmsi' | 'name' | 'aisType'>,
): { vessel: boolean; reason: NonVesselReason | '' } {
  const m = String(t.mmsi ?? '').trim();
  const name = String(t.name ?? '').trim();
  // MMSI-based (highest confidence, ITU-R M.585)
  if (/^99\d{7}$/.test(m)) return { vessel: false, reason: 'aton' };
  if (/^8\d{8}$/.test(m) || /^97[024]\d{6}$/.test(m)) return { vessel: false, reason: 'handheld-sart' };
  if (/^111\d{6}$/.test(m)) return { vessel: false, reason: 'sar-aircraft' };
  if (!/^[2-7]\d{8}$/.test(m)) return { vessel: false, reason: 'anomalous-mmsi' };
  // Name-based (Taiwan net markers on otherwise-legit MMSIs)
  if (BUOY_NAME.test(name)) return { vessel: false, reason: 'buoy-name' };
  // Corrupt transmission: illegal AIS type code (>99) AND a garbled name.
  if (t.aisType > 99) {
    const junk = (name.match(/[^A-Za-z0-9 .\-一-鿿]/g) || []).length;
    if (junk >= 2) return { vessel: false, reason: 'garbled' };
  }
  return { vessel: true, reason: '' };
}

export function isVessel(t: Pick<AisTrack, 'mmsi' | 'name' | 'aisType'>): boolean {
  return classifyAisTarget(t).vessel;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/port-ais.test.ts -t "classifyAisTarget"`
Expected: PASS (all 11 cases).

- [ ] **Step 5: Typecheck + full suite**

Run: `npx tsc --noEmit -p tsconfig.json && npm test`
Expected: 0 type errors; suite green (209 + 11 new = 220).

- [ ] **Step 6: Commit**

```bash
git add examples/kaohsiung-port/data/ais.ts test/port-ais.test.ts
git commit -m "feat(port): add isVessel/classifyAisTarget non-vessel AIS classifier

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `buildTracksFile` 套過濾 + `meta.droppedNonVessel`

**Files:**
- Modify: `examples/kaohsiung-port/data/ais.ts`(`AisTracksFile` 型別、`buildTracksFile`)
- Test: `test/port-ais.test.ts`

**Interfaces:**
- Consumes: `isVessel`(Task 1)、既有 `aggregateTracks`/`cleanTracks`。
- Produces: `buildTracksFile` 回傳的 `meta` 多一欄 `droppedNonVessel: number`;`ships` 已濾除非船。

- [ ] **Step 1: Write the failing test**

Append to `test/port-ais.test.ts`. **Reuse the existing `ping(p: Partial<AisPing>)` helper (defined at line 73) and the existing `buildTracksFile`/`AisPing` imports — do NOT re-declare or re-import them** (duplicate identifier = TS error):

```ts
describe('buildTracksFile non-vessel filtering', () => {
  it('drops non-vessel pings and records the count in meta', () => {
    const out = buildTracksFile([
      ping({ mmsi: '416005912', name: 'REAL SHIP', aisType: 70, lat: 22.60, lon: 120.30, recordedAtMs: 1000 }),   // keep
      ping({ mmsi: '994160462', name: 'BUOY4314601', aisType: 0, lat: 22.60, lon: 120.30, recordedAtMs: 1000 }),  // drop: aton
      ping({ mmsi: '416005111', name: '5897-07-93%', aisType: 0, lat: 22.60, lon: 120.30, recordedAtMs: 1000 }),  // drop: buoy-name
    ]);
    expect(out.ships.map((s) => s.mmsi)).toEqual(['416005912']);
    expect(out.meta.count).toBe(1);
    expect(out.meta.droppedNonVessel).toBe(2);
  });
});
```

> `AisPing` real shape (`data/ais.ts:5-14`): `{ mmsi, lat, lon, sogKn, cogDeg, headingDeg, aisType, name, imo, callSign, loaM?, beamM?, recordedAtMs }`. The existing `ping()` helper fills defaults, so only the fields above need to be passed.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/port-ais.test.ts -t "non-vessel filtering"`
Expected: FAIL — `droppedNonVessel` undefined / ships still contains 3.

- [ ] **Step 3: Implement filtering in buildTracksFile**

In `examples/kaohsiung-port/data/ais.ts`:

Extend the `AisTracksFile` meta type (line ~24):

```ts
export interface AisTracksFile {
  meta: { fromMs: number; toMs: number; count: number; bbox: BBox; droppedNonVessel: number };
  ships: AisTrack[];
}
```

Replace `buildTracksFile` body (line ~200):

```ts
/** Pings → cleaned, aggregated, non-vessel-filtered tracks file with meta. */
export function buildTracksFile(pings: AisPing[]): AisTracksFile {
  const all = cleanTracks(aggregateTracks(pings));
  const ships = all.filter(isVessel);
  const droppedNonVessel = all.length - ships.length;
  let fromMs = Infinity, toMs = -Infinity;
  for (const s of ships) for (const p of s.path) {
    if (p[2] < fromMs) fromMs = p[2];
    if (p[2] > toMs) toMs = p[2];
  }
  if (!Number.isFinite(fromMs)) { fromMs = 0; toMs = 0; }
  return { meta: { fromMs, toMs, count: ships.length, bbox: KHH_BBOX, droppedNonVessel }, ships };
}
```

- [ ] **Step 4: Run test + full suite to verify pass**

Run: `npx vitest run test/port-ais.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS. If any existing test asserted `buildTracksFile(...).meta` shape exactly, update it to include `droppedNonVessel`.

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/data/ais.ts test/port-ais.test.ts
git commit -m "feat(port): filter non-vessel targets in buildTracksFile + meta.droppedNonVessel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: refilter CLI + re-bake committed data

**Files:**
- Modify: `examples/kaohsiung-port/data/ais.ts`(加純函式 `refilterTracksFile`)
- Create: `examples/kaohsiung-port/data/refilter-tracks.ts`(CLI)
- Modify: `package.json`(script)
- Test: `test/port-ais.test.ts`
- Modify(資料): `data/ais-tracks/khh-2026-06-19.json`、`khh-2026-06-18.json`

**Interfaces:**
- Consumes: `isVessel`、`classifyAisTarget`、`AisTracksFile`。
- Produces: `refilterTracksFile(file: AisTracksFile): { file: AisTracksFile; dropped: Record<NonVesselReason, number> }` — 純函式,過濾 `ships`、重算 `meta.count`/`droppedNonVessel`、回傳依原因統計。

- [ ] **Step 1: Write the failing test**

Append to `test/port-ais.test.ts`:

```ts
import { refilterTracksFile } from '../examples/kaohsiung-port/data/ais';

const track = (mmsi: string, name: string, aisType: number) => ({
  mmsi, imo: '', callSign: '', name, aisType, path: [[22.6, 120.3, 1, -1]] as [number, number, number, number][],
});

describe('refilterTracksFile', () => {
  const dirty = {
    meta: { fromMs: 1, toMs: 2, count: 3, bbox: { s: 22.5, n: 22.66, w: 120.24, e: 120.4 }, droppedNonVessel: 0 },
    ships: [track('416005912', 'REAL', 70), track('994160462', 'BUOY1', 0), track('416005111', 'X-07-93%', 0)],
  };
  it('removes non-vessels and tallies reasons', () => {
    const { file, dropped } = refilterTracksFile(dirty);
    expect(file.ships).toHaveLength(1);
    expect(file.meta.count).toBe(1);
    expect(file.meta.droppedNonVessel).toBe(2);
    expect(dropped.aton).toBe(1);
    expect(dropped['buoy-name']).toBe(1);
  });
  it('is idempotent on already-clean data', () => {
    const { file } = refilterTracksFile(dirty);
    const { file: again, dropped } = refilterTracksFile(file);
    expect(again.ships).toHaveLength(1);
    expect(Object.values(dropped).reduce((a, b) => a + b, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/port-ais.test.ts -t "refilterTracksFile"`
Expected: FAIL — `refilterTracksFile is not a function`.

- [ ] **Step 3: Implement `refilterTracksFile` (pure) in ais.ts**

Add after `buildTracksFile` in `examples/kaohsiung-port/data/ais.ts`:

```ts
/** Re-filter an already-aggregated tracks file: drop non-vessels, recompute
 *  meta counts, return per-reason tally. Idempotent. Used by the refilter CLI
 *  to clean committed khh-*.json without re-processing raw .jsonl. */
export function refilterTracksFile(
  file: AisTracksFile,
): { file: AisTracksFile; dropped: Record<NonVesselReason, number> } {
  const dropped: Record<NonVesselReason, number> = {
    'aton': 0, 'handheld-sart': 0, 'sar-aircraft': 0, 'anomalous-mmsi': 0, 'buoy-name': 0, 'garbled': 0,
  };
  const ships = file.ships.filter((s) => {
    const c = classifyAisTarget(s);
    if (!c.vessel && c.reason) dropped[c.reason]++;
    return c.vessel;
  });
  const droppedNonVessel = file.ships.length - ships.length;
  return { file: { meta: { ...file.meta, count: ships.length, droppedNonVessel }, ships }, dropped };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/port-ais.test.ts -t "refilterTracksFile"`
Expected: PASS (both cases).

- [ ] **Step 5: Write the CLI**

Create `examples/kaohsiung-port/data/refilter-tracks.ts`:

```ts
import { readFileSync, writeFileSync, readdirSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { refilterTracksFile, type AisTracksFile } from './ais';

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, 'ais-tracks');

// argv[2] = specific filename, else every committed khh-*.json (skip raw-/_probe).
const arg = process.argv[2];
const files = arg
  ? [arg]
  : readdirSync(dir).filter((f) => f.startsWith('khh-') && f.endsWith('.json'));
if (files.length === 0) throw new Error(`no khh-*.json in ${dir}`);

for (const f of files) {
  const path = resolve(dir, f);
  const before = JSON.parse(readFileSync(path, 'utf8')) as AisTracksFile;
  const { file, dropped } = refilterTracksFile(before);
  const total = Object.values(dropped).reduce((a, b) => a + b, 0);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(file));
  renameSync(tmp, path);
  console.log(
    `${f}: ${before.ships.length} → ${file.ships.length} ships ` +
    `(dropped ${total}: ${JSON.stringify(dropped)})`,
  );
}
```

- [ ] **Step 6: Add npm script**

In `package.json`, after the `port:ais:export` line:

```json
"port:ais:refilter": "vite-node examples/kaohsiung-port/data/refilter-tracks.ts",
```

- [ ] **Step 7: Run the CLI to re-bake committed data**

Run: `npm run port:ais:refilter`
Expected output (verified figures for the 06-19 file):
```
khh-2026-06-19.json: 551 → 443 ships (dropped 108: {"aton":69,"handheld-sart":15,"sar-aircraft":0,"anomalous-mmsi":7,"buoy-name":13,"garbled":4})
khh-2026-06-18.json: 257 → <NNN> ships (dropped <M>: {...})
```
(06-18 numbers are whatever the 2h sample yields — record them, no fixed expectation.)

- [ ] **Step 8: Verify idempotency**

Run: `npm run port:ais:refilter`
Expected: every file reports `dropped 0` and unchanged ship count (proves idempotent + clean).

- [ ] **Step 9: Full suite + typecheck + commit**

Run: `npm test && npx tsc --noEmit -p tsconfig.json`
Expected: green.

```bash
git add examples/kaohsiung-port/data/ais.ts examples/kaohsiung-port/data/refilter-tracks.ts \
        package.json test/port-ais.test.ts \
        examples/kaohsiung-port/data/ais-tracks/khh-2026-06-19.json \
        examples/kaohsiung-port/data/ais-tracks/khh-2026-06-18.json
git commit -m "feat(port): add port:ais:refilter CLI + re-bake committed AIS tracks (551→443)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 新增「遊艇」「工程」2 類別(palette + dims)

**Files:**
- Modify: `examples/kaohsiung-port/palette.ts`(`SHIP_CATEGORIES`、`SHIP_CATEGORY_COLORS`)
- Modify: `examples/kaohsiung-port/scene/portPoints.ts`(`TYPE_DIMS_M`)
- Test: `test/port-palette.test.ts`

**Interfaces:**
- Consumes: 無新依賴。
- Produces: `SHIP_CATEGORIES` 10 元素,新增 `'遊艇'`(index 7)、`'工程'`(index 8);`其他` 移到 index 9。`SHIP_CATEGORY_COLORS` 與 `TYPE_DIMS_M` 同步。

- [ ] **Step 1: Write the failing test**

Append to `test/port-palette.test.ts`:

```ts
describe('expanded categories (遊艇 / 工程)', () => {
  it('has 10 categories with 其他 last and the two new ones before it', () => {
    expect(SHIP_CATEGORIES).toHaveLength(10);
    expect(SHIP_CATEGORIES[SHIP_CATEGORIES.length - 1]).toBe('其他');
    expect(SHIP_CATEGORIES).toContain('遊艇');
    expect(SHIP_CATEGORIES).toContain('工程');
  });
  it('keeps a colour per category', () => {
    expect(SHIP_CATEGORY_COLORS).toHaveLength(SHIP_CATEGORIES.length);
  });
  it('does not shift the indices of the original 7 categories', () => {
    expect(SHIP_CATEGORIES.indexOf('貨櫃')).toBe(0);
    expect(SHIP_CATEGORIES.indexOf('客運')).toBe(6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/port-palette.test.ts -t "expanded categories"`
Expected: FAIL — length 8, no 遊艇/工程.

- [ ] **Step 3: Edit palette.ts**

`examples/kaohsiung-port/palette.ts` line 3:

```ts
export const SHIP_CATEGORIES = ['貨櫃', '油品', '散雜', 'LNG', '工作', '軍艦', '客運', '遊艇', '工程', '其他'] as const;
```

`SHIP_CATEGORY_COLORS` (insert two RGBs before the grey 其他 entry; keep alignment):

```ts
export const SHIP_CATEGORY_COLORS: RGB[] = [
  [70, 150, 235],  // 貨櫃 blue
  [240, 150, 55],  // 油品 orange
  [175, 120, 80],  // 散雜 brown
  [175, 120, 225], // LNG purple
  [230, 120, 180], // 工作 pink
  [85, 190, 110],  // 軍艦 green
  [60, 195, 200],  // 客運 teal
  [235, 205, 95],  // 遊艇 warm yellow
  [160, 175, 95],  // 工程 olive
  [180, 185, 195], // 其他 grey
];
```

- [ ] **Step 4: Edit TYPE_DIMS_M (compile-enforced)**

`examples/kaohsiung-port/scene/portPoints.ts` — add two entries before `其他` in `TYPE_DIMS_M`:

```ts
  '客運': { loa: 200, beam: 32 },
  '遊艇': { loa: 30, beam: 8 },
  '工程': { loa: 90, beam: 20 },
  '其他': { loa: 120, beam: 20 },
```

(Omitting these is a compile error via `satisfies Record<ShipCategory, …>`.)

- [ ] **Step 5: Run test + typecheck + full suite**

Run: `npx vitest run test/port-palette.test.ts && npx tsc --noEmit -p tsconfig.json && npm test`
Expected: PASS; 0 type errors; suite green.

- [ ] **Step 6: Commit**

```bash
git add examples/kaohsiung-port/palette.ts examples/kaohsiung-port/scene/portPoints.ts test/port-palette.test.ts
git commit -m "feat(port): add 遊艇/工程 ship categories (palette + footprint dims)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 分類對照修補(AIS 碼 + TWPort 船型名)

**Files:**
- Modify: `examples/kaohsiung-port/data/ais.ts`(`mapAisTypeToCategory`)
- Modify: `examples/kaohsiung-port/palette.ts`(`TYPE_TO_CATEGORY`)
- Test: `test/port-ais.test.ts`、`test/port-palette.test.ts`

**Interfaces:**
- Consumes: 既有 `mapAisTypeToCategory`、`shipCategoryIndex`、`TYPE_TO_CATEGORY`、新類別(Task 4)。
- Produces: AIS 碼 33/34→工程、36/37→遊艇;`TYPE_TO_CATEGORY` 多 12 個官方船型名鍵。

- [ ] **Step 1: Write the failing tests**

Append to `test/port-ais.test.ts`. **`mapAisTypeToCategory` is already imported (line 147) — do NOT re-import it:**

```ts
describe('mapAisTypeToCategory new codes', () => {
  it('maps dredging/underwater (33,34) to 工程', () => {
    expect(mapAisTypeToCategory(33)).toBe('工程');
    expect(mapAisTypeToCategory(34)).toBe('工程');
  });
  it('maps sailing/pleasure (36,37) to 遊艇', () => {
    expect(mapAisTypeToCategory(36)).toBe('遊艇');
    expect(mapAisTypeToCategory(37)).toBe('遊艇');
  });
  it('still maps fishing/tug (30-32,50-59) to 工作 and 90/0 to 其他', () => {
    expect(mapAisTypeToCategory(30)).toBe('工作');
    expect(mapAisTypeToCategory(52)).toBe('工作');
    expect(mapAisTypeToCategory(90)).toBe('其他');
    expect(mapAisTypeToCategory(0)).toBe('其他');
  });
});
```

Append to `test/port-palette.test.ts`(import already has `shipCategoryIndex, SHIP_CATEGORIES`):

```ts
describe('TYPE_TO_CATEGORY gap fixes', () => {
  const cat = (t: string) => SHIP_CATEGORIES[shipCategoryIndex(t)];
  it('routes previously-unlisted official types to the right category', () => {
    expect(cat('拖船')).toBe('工作');
    expect(cat('起重船')).toBe('工作');
    expect(cat('多用途工作船')).toBe('工作');
    expect(cat('工作平台船')).toBe('工作');
    expect(cat('運輸補給船')).toBe('工作');
    expect(cat('拖船兼消防')).toBe('工作');
    expect(cat('漁船')).toBe('工作');
    expect(cat('運輸駁船')).toBe('散雜');
    expect(cat('多用途船')).toBe('散雜');
    expect(cat('化學液體船')).toBe('油品');
    expect(cat('油駁船')).toBe('油品');
    expect(cat('貨櫃輪(有導槽)')).toBe('貨櫃');
  });
});
```

> Note: `貨櫃輪(有導槽)` uses FULL-WIDTH parens `（）`. Copy the exact string from the test below into the table key.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/port-ais.test.ts -t "new codes" test/port-palette.test.ts -t "gap fixes"`
Expected: FAIL — 33→其他, 拖船→其他, etc.

- [ ] **Step 3: Edit mapAisTypeToCategory**

`examples/kaohsiung-port/data/ais.ts`, `mapAisTypeToCategory` body — add two lines before the `工作` line:

```ts
export function mapAisTypeToCategory(code: number): ShipCategory {
  if (code >= 80 && code <= 89) return '油品';
  if (code >= 70 && code <= 79) return '散雜';
  if (code >= 60 && code <= 69) return '客運';
  if (code === 35) return '軍艦';
  if (code === 33 || code === 34) return '工程';
  if (code === 36 || code === 37) return '遊艇';
  if ((code >= 30 && code <= 32) || (code >= 50 && code <= 59)) return '工作';
  return '其他';
}
```

- [ ] **Step 4: Edit TYPE_TO_CATEGORY**

`examples/kaohsiung-port/palette.ts`, extend the `TYPE_TO_CATEGORY` literal (append these keys; full-width parens on the last):

```ts
  '拖船': '工作', '起重船': '工作', '多用途工作船': '工作', '工作平台船': '工作',
  '運輸補給船': '工作', '拖船兼消防': '工作', '漁船': '工作',
  '運輸駁船': '散雜', '多用途船': '散雜',
  '化學液體船': '油品', '油駁船': '油品',
  '貨櫃輪(有導槽)': '貨櫃',
```

- [ ] **Step 5: Run tests + typecheck + full suite to verify pass**

Run: `npm test && npx tsc --noEmit -p tsconfig.json`
Expected: PASS; suite green.

- [ ] **Step 6: Commit**

```bash
git add examples/kaohsiung-port/data/ais.ts examples/kaohsiung-port/palette.ts \
        test/port-ais.test.ts test/port-palette.test.ts
git commit -m "fix(port): route dredger/yacht AIS codes + 12 unlisted TWPort types to correct categories

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: 文件更新 + 瀏覽器目視驗證

**Files:**
- Modify: `docs/vscode-dev-guide.md`
- Modify: `docs/superpowers/2026-06-14-handoff.md`

**Interfaces:** 無程式碼;整合驗證 + 文件。

- [ ] **Step 1: Browser visual verification**

Run: `npm run dev`,開 `/examples/kaohsiung-port/index.html`。逐項確認:
- 港區內**不再有成群灰色浮標**(原漂在水面/網位的灰點群消失)。
- 左側「船型篩選」面板**多出「遊艇」「工程」兩列** checkbox + 各自彩色點(暖黃 / 橄欖)。
- 中央 KPI「在港船數」尖峰**較先前下降約 20%**(551→443 量級)且數字合理。
- 切換「遊艇」「工程」checkbox 能各自開關對應船隻;點一艘新類別船,詳情卡類別顯示正確。
- 主控台無新 error(favicon 404 可忽略)。

若發現配色撞色或階層失衡,於 `palette.ts` 微調 `SHIP_CATEGORY_COLORS` 的遊艇/工程兩色後重看(視覺微調不需改測試)。

- [ ] **Step 2: Update dev-guide**

在 `docs/vscode-dev-guide.md` 適當章節(資料管線 / 圖層段)新增小節,涵蓋:
- 非船過濾規則(MMSI 99x/8x/97x/111x、異常 MMSI、`BUOY`/`%`-suffix 名、亂碼+非法碼)與信心分級;指到 `data/ais.ts` 的 `classifyAisTarget`。
- `npm run port:ais:refilter` 用途(對既有 `khh-*.json` 重洗、冪等)與 `buildTracksFile` 已內建過濾(未來 export 自動乾淨)。
- 船型類別由 8 擴為 10(遊艇/工程),三處同步點(`SHIP_CATEGORIES`/`SHIP_CATEGORY_COLORS`/`TYPE_DIMS_M`)。

- [ ] **Step 3: Update handoff**

在 `docs/superpowers/2026-06-14-handoff.md` 最上方新增一節「🆕 更新 2026-06-26 — AIS 非船雜訊過濾 + 類別擴充」,記錄:
- 完成內容(濾掉 108 非船 551→443、KPI 修正、新增遊艇/工程、修 12 漏列船型名)。
- **明確標註下一個工作:遊艇/工程的 3D 模型延到下個 session**,照 `docs/vscode-dev-guide.md` §4k 逐類補(缺模型自動 fallback 平面)。
- 測試數更新(220+)、push 狀態。

- [ ] **Step 4: Final verification + commit**

Run: `npm test && npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: 全綠、型別 0 錯、build 成功。

```bash
git add docs/vscode-dev-guide.md docs/superpowers/2026-06-14-handoff.md
git commit -m "docs(port): document AIS noise filter + 2 new categories; handoff (3D models next)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage**
- 純函式分類器(6 規則、信心分級、不靜默丟棄)→ Task 1 ✅
- export 階段套用 → Task 2 ✅
- 一次性 re-bake CLI(冪等、不需 raw)→ Task 3 ✅
- 新增遊艇/工程(配色 + footprint dims + UI 自動)→ Task 4 ✅
- 分類表破洞(AIS 33/34/36/37 + 12 TWPort 名)→ Task 5 ✅
- KPI 自動修正(資料層過濾)→ Task 3 re-bake 後自然成立,Task 6 目視確認 ✅
- 文件 + handoff(3D 延後)→ Task 6 ✅
- 範圍邊界(無 3D、不碰 src、不加 90-99 類)→ 全程遵守 ✅

**2. Placeholder scan:** 無 TBD/TODO;每個 code step 有完整程式碼。06-18 re-bake 數字標為「實跑記錄」而非佔位(該檔為 2h 樣本,無固定預期值,屬合理未知)。

**3. Type consistency:** `classifyAisTarget`/`isVessel`/`refilterTracksFile`/`NonVesselReason` 在 Task 1/3 定義,Task 2/3 一致引用;`AisTracksFile.meta.droppedNonVessel` 在 Task 2 加入、Task 3 沿用;`SHIP_CATEGORIES`/`SHIP_CATEGORY_COLORS`/`TYPE_DIMS_M` 三處在 Task 4 同步,Task 5 的 mapping 依賴 Task 4 的新類別存在(故 Task 4 在 Task 5 之前)。
