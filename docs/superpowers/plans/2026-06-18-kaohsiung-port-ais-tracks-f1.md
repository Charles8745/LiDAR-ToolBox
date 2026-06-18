# F1 真實 AIS 船位與航跡 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用航港局 MPB 公開 AIS GeoJSON(免金鑰)取得真實船位與航跡,以「本機輪詢累積 → 凍結 snapshot → 回放」取代合成 `BERTH_LINE` 船位,讓 app 以真實 AIS 經緯度與真實時間軸呈現船隻移動與淡出拖尾。

**Architecture:** 三段解耦 —— ① standalone Node 錄製器輪詢 MPB 端點、append 進 `.jsonl`;② export 成 app 讀的 per-MMSI tracks JSON;③ `main.ts` 依 AIS 時間軸插值真實船位、用既有 PointCloud(bloom 群組1)畫 footprint + 點雲淡尾,TWPort 經 IMO/呼號 join 補靜態資料。引擎(`src/`)零改動。

**Tech Stack:** TypeScript、vite / vite-node、vitest、Three.js(既有 `PointCloud`/`LidarEngine`,不改)。

**Spec:** [docs/superpowers/specs/2026-06-18-kaohsiung-port-ais-tracks-f1-design.md](../specs/2026-06-18-kaohsiung-port-ais-tracks-f1-design.md)

**慣例提醒(給執行者):**
- 測試在 `test/port-*.test.ts`,`import` 路徑為 `../examples/kaohsiung-port/...`,用 `vitest`。
- 跑單一測試檔:`npx vitest run test/<file>.test.ts`。全測試:`npm test`。型別:`npx tsc --noEmit -p tsconfig.json`。
- 每個 commit 訊息結尾加上標準 trailer:`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- 不得破壞既有 120 綠、`tsc` 0、`npm run build`。

---

## 檔案結構

| 檔案 | 職責 | 動作 |
|---|---|---|
| `examples/kaohsiung-port/data/ais.ts` | AIS 純函式:型別、解析 feature、時間解析、bbox、聚合去重、清洗、type→類別 | Create |
| `examples/kaohsiung-port/data/probe-ais.ts` | 一次性探針:打端點、印結構、存樣本 | Create |
| `examples/kaohsiung-port/data/record-ais.ts` | standalone 韌性輪詢錄製器 → append `.jsonl` | Create |
| `examples/kaohsiung-port/data/export-ais-tracks.ts` | `.jsonl` → tracks JSON | Create |
| `examples/kaohsiung-port/time/ais-replay.ts` | `positionAt` / `trailPointsAt` / `vesselsInPortAt` / `incomingAt` / 角度插值 | Create |
| `examples/kaohsiung-port/data/join.ts` | AIS↔TWPort join、類別決定 | Create |
| `examples/kaohsiung-port/ui/overlay.ts` | KPI 語義改「範圍內 AIS 船數」、詳情卡吃 enrich | Modify |
| `examples/kaohsiung-port/main.ts` | 改寫:讀 tracks、AIS 時間軸、回放 ticker、render、click-pick、KPI 來源 | Modify |
| `package.json` | `port:ais:probe` / `port:ais:record` / `port:ais:export` scripts | Modify |
| `.gitignore` | 忽略 raw `.jsonl` | Modify |
| `test/port-ais.test.ts` / `test/port-ais-replay.test.ts` / `test/port-join.test.ts` | 單元測試 | Create |
| `docs/superpowers/2026-06-14-handoff.md` | F1 進度更新 | Modify |

**核心型別(跨任務一致,Task 1 定義於 `data/ais.ts`):**

```typescript
export interface AisPing {
  mmsi: string;
  lat: number; lon: number;
  sogKn: number;        // speed over ground, knots (無則 0)
  cogDeg: number;       // course over ground, deg (無則 -1)
  headingDeg: number;   // vessel heading, deg (無則 -1)
  aisType: number;      // AIS ship type code 0–99 (無則 0)
  name: string;
  imo: string;
  callSign: string;
  loaM?: number;        // length overall, m (AIS 有才填)
  beamM?: number;       // beam, m
  recordedAtMs: number; // AIS 定位時間 epoch ms (無則 polledAtMs 備援)
}

/** path point: [lat, lon, tMs, hdgDeg]; hdgDeg = -1 表示該點無 AIS 船艏向。 */
export type AisPathPoint = [number, number, number, number];

export interface AisTrack {
  mmsi: string; imo: string; callSign: string; name: string;
  aisType: number; loaM?: number; beamM?: number;
  path: AisPathPoint[];  // 依 tMs 升序、同 tMs 去重
}

export interface AisTracksFile {
  meta: { fromMs: number; toMs: number; count: number; bbox: BBox };
  ships: AisTrack[];
}
```

---

## Task 0:MPB 端點探針(硬性前置,需台灣 IP 機器執行)

**Files:**
- Create: `examples/kaohsiung-port/data/probe-ais.ts`
- Modify: `package.json`(加 `port:ais:probe`)

此任務無單元測試;目的是在真實環境確認端點回傳與**實際欄位鍵名/時間格式**,結果回填 Task 1 的候選鍵清單。

- [ ] **Step 1: 寫探針腳本**

`examples/kaohsiung-port/data/probe-ais.ts`:

```typescript
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const URL = 'https://mpbais.motcmpb.gov.tw/aismpb/tools/geojsonais.ashx';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/json,text/javascript,*/*;q=0.01',
  Referer: 'https://mpbais.motcmpb.gov.tw/',
};

const res = await fetch(URL, { headers: HEADERS });
const text = await res.text();
let doc: any;
try { doc = JSON.parse(text); } catch { throw new Error(`非 JSON 回應(前 200 字):${text.slice(0, 200)}`); }

const feats: any[] = Array.isArray(doc.features) ? doc.features : [];
console.log(`HTTP ${res.status} · totalFeatures=${doc.totalFeatures ?? '?'} · features=${feats.length}`);
if (feats.length > 0) {
  const f = feats[0];
  console.log('geometry:', JSON.stringify(f.geometry));
  console.log('property keys:', Object.keys(f.properties ?? {}).join(', '));
  console.log('first feature properties:', JSON.stringify(f.properties, null, 2));
}

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, 'ais-tracks');
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, '_probe-sample.json'), JSON.stringify(doc, null, 2).slice(0, 200_000));
console.log(`wrote ${resolve(dir, '_probe-sample.json')}`);
```

- [ ] **Step 2: 加 script**

`package.json` 的 `scripts` 區加(在 `port:basemap` 後):

```json
    "port:ais:probe": "vite-node examples/kaohsiung-port/data/probe-ais.ts",
```

- [ ] **Step 3: 在台灣機器執行並判讀**

Run: `npm run port:ais:probe`
Expected:`totalFeatures` > 0、印出 `property keys` 與第一筆 properties。**記下**:MMSI / 船名 / 船型(數字)/ SOG / COG / heading / IMO / 呼號 / 定位時間 的實際鍵名、以及時間欄位格式(epoch? `YYYY-MM-DD HH:mm:ss`? UTC+8?)。
若 `totalFeatures=0`:確認在台灣 IP、必要時調整 `Referer`/headers,重跑直到有資料。

- [ ] **Step 4: 回填候選鍵**

把 Step 3 觀察到的實際鍵名,加進 Task 1 `parseAisFeature` 的候選鍵陣列(若與預設不同)。**不需 commit `_probe-sample.json`**(Task 14 會 gitignore `ais-tracks/` 的暫存樣本)。

- [ ] **Step 5: Commit(僅腳本與 script)**

```bash
git add examples/kaohsiung-port/data/probe-ais.ts package.json
git commit -m "feat(port-ais): MPB AIS endpoint probe script"
```

---

## Task 1:`data/ais.ts` — 型別 + `parseAisFeature` + `parseAisTime`

**Files:**
- Create: `examples/kaohsiung-port/data/ais.ts`
- Test: `test/port-ais.test.ts`

- [ ] **Step 1: 寫失敗測試**

`test/port-ais.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseAisFeature, parseAisTime } from '../examples/kaohsiung-port/data/ais';

const feature = (props: Record<string, unknown>, coords: [number, number] = [120.30, 22.60]) => ({
  type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: props,
});

describe('parseAisTime', () => {
  it('parses UTC+8 "YYYY-MM-DD HH:mm:ss" to epoch ms', () => {
    // 2026-02-18 08:00:00 (Taipei) === 2026-02-18 00:00:00 UTC
    expect(parseAisTime('2026-02-18 08:00:00')).toBe(Date.UTC(2026, 1, 18, 0, 0, 0));
  });
  it('parses epoch-second numbers', () => {
    expect(parseAisTime(1771300800)).toBe(1771300800 * 1000);
  });
  it('returns null on garbage', () => {
    expect(parseAisTime('not-a-date')).toBeNull();
    expect(parseAisTime('')).toBeNull();
  });
});

describe('parseAisFeature', () => {
  it('reads lon/lat from geometry and core fields from properties', () => {
    const p = parseAisFeature(feature({
      MMSI: '416000123', SHIPNAME: 'EVER GIVEN', TYPE: 70, SOG: 12.3, COG: 181.2,
      HEADING: 180, IMO: '9811000', CALLSIGN: 'BMXX', LASTTIME: '2026-02-18 08:00:00',
    }));
    expect(p).not.toBeNull();
    expect(p!.mmsi).toBe('416000123');
    expect(p!.lat).toBeCloseTo(22.60);
    expect(p!.lon).toBeCloseTo(120.30);
    expect(p!.aisType).toBe(70);
    expect(p!.sogKn).toBeCloseTo(12.3);
    expect(p!.headingDeg).toBe(180);
    expect(p!.imo).toBe('9811000');
    expect(p!.recordedAtMs).toBe(Date.UTC(2026, 1, 18, 0, 0, 0));
  });
  it('tolerates missing optional fields with safe defaults', () => {
    const p = parseAisFeature(feature({ MMSI: '999' }));
    expect(p!.sogKn).toBe(0);
    expect(p!.cogDeg).toBe(-1);
    expect(p!.headingDeg).toBe(-1);
    expect(p!.aisType).toBe(0);
    expect(p!.name).toBe('');
  });
  it('returns null when MMSI or coordinates are absent', () => {
    expect(parseAisFeature(feature({ SHIPNAME: 'x' }, undefined as any))).toBeNull();
    expect(parseAisFeature({ type: 'Feature', geometry: null, properties: { MMSI: '1' } } as any)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/port-ais.test.ts`
Expected: FAIL（`parseAisFeature`/`parseAisTime` 未定義）。

- [ ] **Step 3: 實作**

`examples/kaohsiung-port/data/ais.ts`(先放型別 + 這兩個函式;後續任務在同檔追加):

```typescript
export interface BBox { s: number; n: number; w: number; e: number; }

export interface AisPing {
  mmsi: string;
  lat: number; lon: number;
  sogKn: number; cogDeg: number; headingDeg: number;
  aisType: number;
  name: string; imo: string; callSign: string;
  loaM?: number; beamM?: number;
  recordedAtMs: number;
}

export type AisPathPoint = [number, number, number, number]; // [lat, lon, tMs, hdgDeg]

export interface AisTrack {
  mmsi: string; imo: string; callSign: string; name: string;
  aisType: number; loaM?: number; beamM?: number;
  path: AisPathPoint[];
}

export interface AisTracksFile {
  meta: { fromMs: number; toMs: number; count: number; bbox: BBox };
  ships: AisTrack[];
}

const TAIPEI_OFFSET_H = 8;

/** Parse AIS report time → epoch ms. Accepts epoch sec/ms numbers or "YYYY-MM-DD HH:mm:ss" (UTC+8). */
export function parseAisTime(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw > 1e12 ? raw : raw * 1000; // >1e12 已是 ms
  }
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) { const n = Number(s); return Number.isFinite(n) && n > 0 ? (n > 1e12 ? n : n * 1000) : null; }
  const [, y, mo, d, hh, mi, se] = m;
  return Date.UTC(+y, +mo - 1, +d, +hh - TAIPEI_OFFSET_H, +mi, +(se ?? 0));
}

// Candidate property keys (confirmed/extended from Task 0 probe). Tolerant of name variants.
const K = {
  mmsi: ['MMSI', 'mmsi', 'Mmsi'],
  name: ['SHIPNAME', 'NAME', 'shipname', 'VESSEL_NAME', 'name'],
  type: ['TYPE', 'SHIPTYPE', 'shiptype', 'type', 'ship_type'],
  sog: ['SOG', 'sog', 'SPEED', 'speed'],
  cog: ['COG', 'cog', 'COURSE', 'course'],
  hdg: ['HEADING', 'HDG', 'heading', 'hdg'],
  imo: ['IMO', 'imo'],
  call: ['CALLSIGN', 'CALL_SIGN', 'callsign'],
  time: ['LASTTIME', 'RECORD_TIME', 'UTC', 'lasttime', 'TIME', 'time', 'TIMESTAMP'],
  loa: ['LENGTH', 'LOA', 'length'],
  beam: ['WIDTH', 'BEAM', 'width'],
} as const;

function pick(props: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const k of keys) if (props[k] != null && props[k] !== '') return props[k];
  return undefined;
}
const num = (v: unknown, dflt: number): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : dflt;
};
const str = (v: unknown): string => (v == null ? '' : String(v).trim());

/** Parse one GeoJSON feature → AisPing, or null if MMSI/coords are missing. */
export function parseAisFeature(feature: unknown): AisPing | null {
  const f = feature as { geometry?: { coordinates?: [number, number] }; properties?: Record<string, unknown> };
  const coords = f?.geometry?.coordinates;
  const props = f?.properties;
  if (!props || !Array.isArray(coords) || coords.length < 2) return null;
  const mmsi = str(pick(props, K.mmsi));
  if (!mmsi) return null;
  const [lon, lat] = coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const loa = num(pick(props, K.loa), -1);
  const beam = num(pick(props, K.beam), -1);
  return {
    mmsi, lat, lon,
    sogKn: num(pick(props, K.sog), 0),
    cogDeg: num(pick(props, K.cog), -1),
    headingDeg: num(pick(props, K.hdg), -1),
    aisType: num(pick(props, K.type), 0),
    name: str(pick(props, K.name)),
    imo: str(pick(props, K.imo)),
    callSign: str(pick(props, K.call)),
    loaM: loa > 0 ? loa : undefined,
    beamM: beam > 0 ? beam : undefined,
    recordedAtMs: parseAisTime(pick(props, K.time)) ?? 0,
  };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/port-ais.test.ts`
Expected: PASS（全部）。

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/data/ais.ts test/port-ais.test.ts
git commit -m "feat(port-ais): AisPing types, parseAisFeature, parseAisTime"
```

---

## Task 2:`data/ais.ts` — `KHH_BBOX` + `inKaohsiungBBox`

**Files:**
- Modify: `examples/kaohsiung-port/data/ais.ts`
- Test: `test/port-ais.test.ts`

- [ ] **Step 1: 追加失敗測試**

在 `test/port-ais.test.ts` 末尾加(同檔加新 import 名稱):

```typescript
import { inKaohsiungBBox, KHH_BBOX } from '../examples/kaohsiung-port/data/ais';

describe('KHH bbox', () => {
  it('accepts a point inside the port', () => {
    expect(inKaohsiungBBox(22.60, 120.30)).toBe(true);
  });
  it('rejects points outside', () => {
    expect(inKaohsiungBBox(25.04, 121.51)).toBe(false); // 台北
    expect(inKaohsiungBBox(22.60, 120.10)).toBe(false); // 偏西
  });
  it('KHH_BBOX matches spec defaults', () => {
    expect(KHH_BBOX).toEqual({ s: 22.50, n: 22.66, w: 120.24, e: 120.40 });
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/port-ais.test.ts`
Expected: FAIL（`inKaohsiungBBox`/`KHH_BBOX` 未定義）。

- [ ] **Step 3: 實作（追加到 `data/ais.ts`）**

```typescript
export const KHH_BBOX: BBox = { s: 22.50, n: 22.66, w: 120.24, e: 120.40 };

export function inBBox(lat: number, lon: number, b: BBox): boolean {
  return lat >= b.s && lat <= b.n && lon >= b.w && lon <= b.e;
}
export function inKaohsiungBBox(lat: number, lon: number): boolean {
  return inBBox(lat, lon, KHH_BBOX);
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/port-ais.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/data/ais.ts test/port-ais.test.ts
git commit -m "feat(port-ais): Kaohsiung bounding box filter"
```

---

## Task 3:`data/ais.ts` — `aggregateTracks`（按 MMSI 聚合、依時間排序去重）

**Files:**
- Modify: `examples/kaohsiung-port/data/ais.ts`
- Test: `test/port-ais.test.ts`

- [ ] **Step 1: 追加失敗測試**

```typescript
import { aggregateTracks } from '../examples/kaohsiung-port/data/ais';
import type { AisPing } from '../examples/kaohsiung-port/data/ais';

const ping = (p: Partial<AisPing>): AisPing => ({
  mmsi: '1', lat: 22.6, lon: 120.3, sogKn: 0, cogDeg: -1, headingDeg: -1, aisType: 0,
  name: '', imo: '', callSign: '', recordedAtMs: 0, ...p,
});

describe('aggregateTracks', () => {
  it('groups pings by mmsi into time-sorted paths', () => {
    const tracks = aggregateTracks([
      ping({ mmsi: 'A', lat: 22.61, lon: 120.31, recordedAtMs: 2000, headingDeg: 90 }),
      ping({ mmsi: 'A', lat: 22.60, lon: 120.30, recordedAtMs: 1000, headingDeg: 80 }),
      ping({ mmsi: 'B', lat: 22.55, lon: 120.33, recordedAtMs: 1500 }),
    ]);
    expect(tracks).toHaveLength(2);
    const a = tracks.find((t) => t.mmsi === 'A')!;
    expect(a.path.map((p) => p[2])).toEqual([1000, 2000]); // 升序
    expect(a.path[0]).toEqual([22.60, 120.30, 1000, 80]);
  });
  it('dedupes points sharing the same recordedAtMs (keeps first seen)', () => {
    const tracks = aggregateTracks([
      ping({ mmsi: 'A', lat: 22.60, lon: 120.30, recordedAtMs: 1000 }),
      ping({ mmsi: 'A', lat: 22.61, lon: 120.31, recordedAtMs: 1000 }),
    ]);
    expect(tracks[0].path).toHaveLength(1);
  });
  it('carries latest non-empty identity/dims onto the track', () => {
    const [t] = aggregateTracks([
      ping({ mmsi: 'A', recordedAtMs: 1000, name: '', imo: '' }),
      ping({ mmsi: 'A', recordedAtMs: 2000, name: 'EVER', imo: '9811000', aisType: 70, loaM: 300, beamM: 45 }),
    ]);
    expect(t.name).toBe('EVER');
    expect(t.imo).toBe('9811000');
    expect(t.aisType).toBe(70);
    expect(t.loaM).toBe(300);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/port-ais.test.ts`
Expected: FAIL（`aggregateTracks` 未定義）。

- [ ] **Step 3: 實作（追加到 `data/ais.ts`）**

```typescript
/** Group pings by MMSI → AisTrack with time-sorted, same-time-deduped paths. */
export function aggregateTracks(pings: AisPing[]): AisTrack[] {
  const byMmsi = new Map<string, AisPing[]>();
  for (const p of pings) {
    const arr = byMmsi.get(p.mmsi);
    if (arr) arr.push(p); else byMmsi.set(p.mmsi, [p]);
  }
  const out: AisTrack[] = [];
  for (const [mmsi, arr] of byMmsi) {
    arr.sort((a, b) => a.recordedAtMs - b.recordedAtMs);
    const path: AisPathPoint[] = [];
    const seen = new Set<number>();
    for (const p of arr) {
      if (seen.has(p.recordedAtMs)) continue;
      seen.add(p.recordedAtMs);
      path.push([p.lat, p.lon, p.recordedAtMs, p.headingDeg]);
    }
    // identity/dims: 取最後一筆有值者
    const id = { name: '', imo: '', callSign: '', aisType: 0, loaM: undefined as number | undefined, beamM: undefined as number | undefined };
    for (const p of arr) {
      if (p.name) id.name = p.name;
      if (p.imo) id.imo = p.imo;
      if (p.callSign) id.callSign = p.callSign;
      if (p.aisType) id.aisType = p.aisType;
      if (p.loaM) id.loaM = p.loaM;
      if (p.beamM) id.beamM = p.beamM;
    }
    out.push({ mmsi, ...id, path });
  }
  return out;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/port-ais.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/data/ais.ts test/port-ais.test.ts
git commit -m "feat(port-ais): aggregate pings into per-MMSI tracks"
```

---

## Task 4:`data/ais.ts` — `cleanTracks`（丟垃圾/跳點,保留靜止船）

**Files:**
- Modify: `examples/kaohsiung-port/data/ais.ts`
- Test: `test/port-ais.test.ts`

- [ ] **Step 1: 追加失敗測試**

```typescript
import { cleanTracks } from '../examples/kaohsiung-port/data/ais';
import type { AisTrack } from '../examples/kaohsiung-port/data/ais';

const trk = (mmsi: string, path: [number, number, number, number][]): AisTrack =>
  ({ mmsi, imo: '', callSign: '', name: '', aisType: 0, path });

describe('cleanTracks', () => {
  it('keeps stationary vessels (sog≈0 berthed ships must survive)', () => {
    const t = trk('416000123', [[22.60, 120.30, 1000, 10], [22.60, 120.30, 60_000, 10]]);
    expect(cleanTracks([t])).toHaveLength(1);
    expect(cleanTracks([t])[0].path).toHaveLength(2);
  });
  it('drops a GPS spike point (implied speed > 40 kn)', () => {
    // 0.5° lat ≈ 55 km in 60 s ⇒ absurd speed ⇒ middle point dropped
    const t = trk('416000123', [[22.60, 120.30, 0, 10], [23.10, 120.30, 60_000, 10], [22.60, 120.31, 120_000, 10]]);
    const cleaned = cleanTracks([t]);
    expect(cleaned[0].path).toHaveLength(2);
    expect(cleaned[0].path.some((p) => p[0] === 23.10)).toBe(false);
  });
  it('drops invalid/test MMSIs', () => {
    expect(cleanTracks([trk('111111111', [[22.6, 120.3, 0, 0]])])).toHaveLength(0);
    expect(cleanTracks([trk('', [[22.6, 120.3, 0, 0]])])).toHaveLength(0);
  });
  it('drops tracks left with no points', () => {
    expect(cleanTracks([trk('416000123', [])])).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/port-ais.test.ts`
Expected: FAIL（`cleanTracks` 未定義）。

- [ ] **Step 3: 實作（追加到 `data/ais.ts`）**

```typescript
const INVALID_MMSI = new Set(['', '0', '111111111', '222222222', '999999999', '123456789']);
const MAX_KN = 40;

/** Haversine-ish metres between two lat/lon (small-distance approximation). */
function metresBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const mPerDegLat = 111_320;
  const mPerDegLon = mPerDegLat * Math.cos((aLat * Math.PI) / 180);
  const dx = (bLon - aLon) * mPerDegLon;
  const dy = (bLat - aLat) * mPerDegLat;
  return Math.hypot(dx, dy);
}

/** Remove invalid MMSIs and GPS-spike points (>40 kn implied); keep stationary vessels. */
export function cleanTracks(tracks: AisTrack[]): AisTrack[] {
  const out: AisTrack[] = [];
  for (const t of tracks) {
    if (INVALID_MMSI.has(t.mmsi) || !/^\d{6,9}$/.test(t.mmsi)) continue;
    const path: AisPathPoint[] = [];
    for (const pt of t.path) {
      const prev = path[path.length - 1];
      if (prev) {
        const dtSec = (pt[2] - prev[2]) / 1000;
        if (dtSec > 0) {
          const knots = (metresBetween(prev[0], prev[1], pt[0], pt[1]) / dtSec) * 1.94384;
          if (knots > MAX_KN) continue; // 跳點:丟此點,保留 prev
        }
      }
      path.push(pt);
    }
    if (path.length > 0) out.push({ ...t, path });
  }
  return out;
}
```
(上面程式碼已無佔位行,可直接照抄。)

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/port-ais.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/data/ais.ts test/port-ais.test.ts
git commit -m "feat(port-ais): clean tracks — drop spikes/invalid MMSI, keep stationary"
```

---

## Task 5:`data/ais.ts` — `mapAisTypeToCategory`

**Files:**
- Modify: `examples/kaohsiung-port/data/ais.ts`
- Test: `test/port-ais.test.ts`

注:`ShipCategory` 由 `palette.ts` 匯出(現有 8 類:貨櫃/油品/散雜/LNG/工作/軍艦/客運/其他)。

- [ ] **Step 1: 追加失敗測試**

```typescript
import { mapAisTypeToCategory } from '../examples/kaohsiung-port/data/ais';

describe('mapAisTypeToCategory', () => {
  it('maps AIS ship-type codes to our coarse categories', () => {
    expect(mapAisTypeToCategory(85)).toBe('油品'); // tanker 80–89
    expect(mapAisTypeToCategory(74)).toBe('散雜'); // cargo 70–79
    expect(mapAisTypeToCategory(60)).toBe('客運'); // passenger 60–69
    expect(mapAisTypeToCategory(35)).toBe('軍艦'); // military
    expect(mapAisTypeToCategory(52)).toBe('工作'); // tug
    expect(mapAisTypeToCategory(30)).toBe('工作'); // fishing
    expect(mapAisTypeToCategory(0)).toBe('其他');
    expect(mapAisTypeToCategory(99)).toBe('其他');
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/port-ais.test.ts`
Expected: FAIL（`mapAisTypeToCategory` 未定義）。

- [ ] **Step 3: 實作（追加到 `data/ais.ts`）**

```typescript
// ↓ 此 import 請加到 data/ais.ts **頂部** import 區(勿留在檔案中段);其餘只 append 函式。
import type { ShipCategory } from '../palette';

/** AIS ship-type code (0–99) → coarse category. AIS can't split container/bulk/LNG;
 *  callers should prefer TWPort SHIP_TYPE_NAME when a join exists (see data/join.ts). */
export function mapAisTypeToCategory(code: number): ShipCategory {
  if (code >= 80 && code <= 89) return '油品';
  if (code >= 70 && code <= 79) return '散雜';
  if (code >= 60 && code <= 69) return '客運';
  if (code === 35) return '軍艦';
  if (code === 30 || (code >= 31 && code <= 32) || (code >= 50 && code <= 59)) return '工作';
  return '其他';
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/port-ais.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/data/ais.ts test/port-ais.test.ts
git commit -m "feat(port-ais): map AIS ship-type code to coarse category"
```

---

## Task 6:`data/export-ais-tracks.ts` — `.jsonl` → tracks JSON（純轉換可測）

**Files:**
- Create: `examples/kaohsiung-port/data/export-ais-tracks.ts`
- Modify: `examples/kaohsiung-port/data/ais.ts`（加 `buildTracksFile`）、`package.json`
- Test: `test/port-ais.test.ts`

先在 `ais.ts` 加純函式 `buildTracksFile`(可測),再寫薄的 CLI wrapper(I/O,不測)。

- [ ] **Step 1: 追加失敗測試**

```typescript
import { buildTracksFile } from '../examples/kaohsiung-port/data/ais';
import type { AisPing } from '../examples/kaohsiung-port/data/ais';

describe('buildTracksFile', () => {
  it('aggregates+cleans pings into a tracks file with meta time range', () => {
    const pings: AisPing[] = [
      ping({ mmsi: '416000001', lat: 22.60, lon: 120.30, recordedAtMs: 1000 }),
      ping({ mmsi: '416000001', lat: 22.601, lon: 120.301, recordedAtMs: 61_000 }),
      ping({ mmsi: '416000002', lat: 22.55, lon: 120.33, recordedAtMs: 30_000 }),
    ];
    const file = buildTracksFile(pings);
    expect(file.ships).toHaveLength(2);
    expect(file.meta.count).toBe(2);
    expect(file.meta.fromMs).toBe(1000);
    expect(file.meta.toMs).toBe(61_000);
    expect(file.meta.bbox).toBeDefined();
  });
});
```
（沿用 Task 3 已定義的 `ping()` helper。）

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/port-ais.test.ts`
Expected: FAIL（`buildTracksFile` 未定義）。

- [ ] **Step 3: 實作 `buildTracksFile`（追加到 `data/ais.ts`）**

```typescript
/** Pings → cleaned, aggregated tracks file with meta. */
export function buildTracksFile(pings: AisPing[]): AisTracksFile {
  const ships = cleanTracks(aggregateTracks(pings));
  let fromMs = Infinity, toMs = -Infinity;
  for (const s of ships) for (const p of s.path) {
    if (p[2] < fromMs) fromMs = p[2];
    if (p[2] > toMs) toMs = p[2];
  }
  if (!Number.isFinite(fromMs)) { fromMs = 0; toMs = 0; }
  return { meta: { fromMs, toMs, count: ships.length, bbox: KHH_BBOX }, ships };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/port-ais.test.ts`
Expected: PASS。

- [ ] **Step 5: 寫 CLI wrapper**

`examples/kaohsiung-port/data/export-ais-tracks.ts`:

```typescript
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildTracksFile, type AisPing } from './ais';

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, 'ais-tracks');

// 取最新的 raw-khh-*.jsonl(或由 argv[2] 指定檔名)
const arg = process.argv[2];
const file = arg ?? readdirSync(dir).filter((f) => f.startsWith('raw-khh-') && f.endsWith('.jsonl')).sort().pop();
if (!file) throw new Error(`no raw-khh-*.jsonl in ${dir} — run \`npm run port:ais:record\` first`);

const pings: AisPing[] = [];
for (const line of readFileSync(resolve(dir, file), 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const rec = JSON.parse(line) as { pings: AisPing[] };
  if (Array.isArray(rec.pings)) pings.push(...rec.pings);
}

const out = buildTracksFile(pings);
const date = file.replace('raw-khh-', '').replace('.jsonl', '');
const outPath = resolve(dir, `khh-${date}.json`);
writeFileSync(outPath, JSON.stringify(out));
console.log(`wrote ${outPath}: ${out.ships.length} ships, ${new Date(out.meta.fromMs).toISOString()}–${new Date(out.meta.toMs).toISOString()}`);
```

- [ ] **Step 6: 加 script**

`package.json` scripts 加:

```json
    "port:ais:export": "vite-node examples/kaohsiung-port/data/export-ais-tracks.ts",
```

- [ ] **Step 7: Commit**

```bash
git add examples/kaohsiung-port/data/ais.ts examples/kaohsiung-port/data/export-ais-tracks.ts package.json test/port-ais.test.ts
git commit -m "feat(port-ais): buildTracksFile + export-ais-tracks CLI"
```

---

## Task 7:`data/record-ais.ts` — standalone 韌性錄製器

**Files:**
- Create: `examples/kaohsiung-port/data/record-ais.ts`
- Modify: `package.json`

此檔為 I/O 迴圈,無單元測試(純解析/過濾已在 `ais.ts` 測過);以手動短窗執行驗證。

- [ ] **Step 1: 寫錄製器**

`examples/kaohsiung-port/data/record-ais.ts`:

```typescript
import { appendFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseAisFeature, inKaohsiungBBox, type AisPing } from './ais';

const URL = 'https://mpbais.motcmpb.gov.tw/aismpb/tools/geojsonais.ashx';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/json,text/javascript,*/*;q=0.01',
  Referer: 'https://mpbais.motcmpb.gov.tw/',
};
const POLL_MS = Number(process.env.AIS_POLL_MS ?? 30_000);

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, 'ais-tracks');
mkdirSync(dir, { recursive: true });
const date = new Date().toISOString().slice(0, 10);
const outPath = resolve(dir, `raw-khh-${date}.jsonl`);

let backoff = POLL_MS;
async function pollOnce(): Promise<void> {
  const polledAtMs = Date.now();
  const res = await fetch(URL, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const doc = JSON.parse(await res.text()) as { features?: unknown[] };
  const feats = Array.isArray(doc.features) ? doc.features : [];
  const pings: AisPing[] = [];
  for (const f of feats) {
    const p = parseAisFeature(f);
    if (!p) continue;
    if (!inKaohsiungBBox(p.lat, p.lon)) continue;
    if (!p.recordedAtMs) p.recordedAtMs = polledAtMs; // 備援:無定位時間用輪詢時間
    pings.push(p);
  }
  appendFileSync(outPath, JSON.stringify({ polledAtMs, pings }) + '\n');
  console.log(`${new Date(polledAtMs).toISOString()}  +${pings.length} pings → ${outPath}`);
}

console.log(`recording KHH AIS every ${POLL_MS / 1000}s → ${outPath}  (Ctrl-C to stop)`);
// 韌性 loop:錯誤指數退避、永不退出。
for (;;) {
  try {
    await pollOnce();
    backoff = POLL_MS;
  } catch (e) {
    console.warn(`poll failed: ${(e as Error).message}; retry in ${Math.round(backoff / 1000)}s`);
    backoff = Math.min(backoff * 2, 5 * 60_000);
  }
  await new Promise((r) => setTimeout(r, backoff));
}
```

- [ ] **Step 2: 加 script**

`package.json` scripts 加:

```json
    "port:ais:record": "vite-node examples/kaohsiung-port/data/record-ais.ts",
```

- [ ] **Step 3: 短窗手動驗證（台灣機器）**

Run: `npm run port:ais:record`（讓它跑 ~5 分鐘後 Ctrl-C）
Expected: 每 ~30s 印一行 `+N pings`、`ais-tracks/raw-khh-<date>.jsonl` 逐漸變大。
然後:`npm run port:ais:export`
Expected: 印出 `wrote .../khh-<date>.json: N ships, ...–...`。打開檔案確認 `ships[].path` 有多筆 `[lat,lon,t,hdg]`。

- [ ] **Step 4: Commit**

```bash
git add examples/kaohsiung-port/data/record-ais.ts package.json
git commit -m "feat(port-ais): standalone resilient AIS recorder (append JSONL)"
```

---

## Task 8:`time/ais-replay.ts` — `lerpAngleDeg` + `positionAt`

**Files:**
- Create: `examples/kaohsiung-port/time/ais-replay.ts`
- Test: `test/port-ais-replay.test.ts`

- [ ] **Step 1: 寫失敗測試**

`test/port-ais-replay.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { lerpAngleDeg, positionAt } from '../examples/kaohsiung-port/time/ais-replay';
import type { AisTrack } from '../examples/kaohsiung-port/data/ais';

const track = (path: [number, number, number, number][]): AisTrack =>
  ({ mmsi: 'A', imo: '', callSign: '', name: '', aisType: 0, path });

describe('lerpAngleDeg', () => {
  it('takes the shortest arc across the 0/360 wrap', () => {
    expect(lerpAngleDeg(350, 10, 0.5)).toBeCloseTo(0);   // 不是 180
    expect(lerpAngleDeg(10, 350, 0.5)).toBeCloseTo(0);
    expect(lerpAngleDeg(0, 90, 0.5)).toBeCloseTo(45);
  });
});

describe('positionAt', () => {
  const t = track([[22.60, 120.30, 1000, 90], [22.62, 120.34, 3000, 90]]);
  it('interpolates lat/lon at a mid time', () => {
    const p = positionAt(t, 2000)!;
    expect(p.lat).toBeCloseTo(22.61);
    expect(p.lon).toBeCloseTo(120.32);
  });
  it('returns null outside the track time range', () => {
    expect(positionAt(t, 500)).toBeNull();
    expect(positionAt(t, 9999)).toBeNull();
  });
  it('uses AIS heading when path points carry it', () => {
    expect(positionAt(t, 2000)!.headingDeg).toBeCloseTo(90);
  });
  it('falls back to bearing between points when heading is absent (-1)', () => {
    const t2 = track([[22.60, 120.30, 0, -1], [22.70, 120.30, 1000, -1]]); // 正北
    const h = positionAt(t2, 500)!.headingDeg;
    expect(h).toBeCloseTo(0, 0); // 約 0° (北)
  });
  it('single-point track resolves only at that exact time', () => {
    const t3 = track([[22.6, 120.3, 1000, 45]]);
    expect(positionAt(t3, 1000)!.lat).toBeCloseTo(22.6);
    expect(positionAt(t3, 1001)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/port-ais-replay.test.ts`
Expected: FAIL（模組不存在）。

- [ ] **Step 3: 實作**

`examples/kaohsiung-port/time/ais-replay.ts`:

```typescript
import type { AisTrack } from '../data/ais';

export interface ResolvedPos { lat: number; lon: number; headingDeg: number; }

/** Shortest-arc angular interpolation in degrees, result in [0,360). */
export function lerpAngleDeg(a: number, b: number, t: number): number {
  let d = ((b - a + 540) % 360) - 180; // [-180,180)
  return ((a + d * t) % 360 + 360) % 360;
}

/** Bearing from point A→B in degrees (0=N, clockwise), using local equirectangular. */
function bearingDeg(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const mPerDegLon = Math.cos((aLat * Math.PI) / 180);
  const east = (bLon - aLon) * mPerDegLon;
  const north = bLat - aLat;
  return (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
}

/** Interpolated position+heading at time tMs, or null if tMs is outside the track. */
export function positionAt(track: AisTrack, tMs: number): ResolvedPos | null {
  const p = track.path;
  if (p.length === 0) return null;
  if (p.length === 1) return tMs === p[0][2] ? { lat: p[0][0], lon: p[0][1], headingDeg: p[0][3] < 0 ? 0 : p[0][3] } : null;
  if (tMs < p[0][2] || tMs > p[p.length - 1][2]) return null;
  // 找夾住 t 的兩點
  let i = 0;
  while (i < p.length - 1 && p[i + 1][2] < tMs) i++;
  const a = p[i], b = p[i + 1] ?? a;
  const span = b[2] - a[2];
  const f = span > 0 ? (tMs - a[2]) / span : 0;
  const lat = a[0] + (b[0] - a[0]) * f;
  const lon = a[1] + (b[1] - a[1]) * f;
  // heading 優先序:兩端皆有 AIS heading → 最短弧插值;否則用 A→B 方位角。
  let headingDeg: number;
  if (a[3] >= 0 && b[3] >= 0) headingDeg = lerpAngleDeg(a[3], b[3], f);
  else if (a[3] >= 0) headingDeg = a[3];
  else if (b[3] >= 0) headingDeg = b[3];
  else headingDeg = bearingDeg(a[0], a[1], b[0], b[1]);
  return { lat, lon, headingDeg };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/port-ais-replay.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/time/ais-replay.ts test/port-ais-replay.test.ts
git commit -m "feat(port-ais): positionAt with shortest-arc heading interpolation"
```

---

## Task 9:`time/ais-replay.ts` — `trailPointsAt`

**Files:**
- Modify: `examples/kaohsiung-port/time/ais-replay.ts`
- Test: `test/port-ais-replay.test.ts`

- [ ] **Step 1: 追加失敗測試**

```typescript
import { trailPointsAt } from '../examples/kaohsiung-port/time/ais-replay';

describe('trailPointsAt', () => {
  const t = track([
    [22.60, 120.30, 0, 90], [22.61, 120.31, 60_000, 90],
    [22.62, 120.32, 120_000, 90], [22.63, 120.33, 180_000, 90],
  ]);
  it('returns real path points within the trailing window, with age01', () => {
    const trail = trailPointsAt(t, 180_000, 120_000); // 最近 2 分鐘
    expect(trail.length).toBe(3); // t=60k,120k,180k
    // 最舊點 age01≈1,最新點 age01≈0
    expect(trail[0][2]).toBeCloseTo(1, 1);
    expect(trail[trail.length - 1][2]).toBeCloseTo(0, 1);
  });
  it('is empty for a stationary single-sample-in-window vessel beyond window', () => {
    expect(trailPointsAt(t, 0, 120_000).length).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/port-ais-replay.test.ts`
Expected: FAIL（`trailPointsAt` 未定義）。

- [ ] **Step 3: 實作（追加到 `time/ais-replay.ts`）**

```typescript
/** Real path points in (tMs-windowMs, tMs], each as [lat, lon, age01] (0=newest,1=oldest). */
export function trailPointsAt(track: AisTrack, tMs: number, windowMs: number): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (const p of track.path) {
    if (p[2] > tMs || p[2] < tMs - windowMs) continue;
    const age01 = windowMs > 0 ? (tMs - p[2]) / windowMs : 0;
    out.push([p[0], p[1], age01]);
  }
  return out;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/port-ais-replay.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/time/ais-replay.ts test/port-ais-replay.test.ts
git commit -m "feat(port-ais): trailPointsAt — minute-scale faded trail points"
```

---

## Task 10:`time/ais-replay.ts` — `vesselsInPortAt` + `incomingAt`

**Files:**
- Modify: `examples/kaohsiung-port/time/ais-replay.ts`
- Test: `test/port-ais-replay.test.ts`

- [ ] **Step 1: 追加失敗測試**

```typescript
import { vesselsInPortAt, incomingAt } from '../examples/kaohsiung-port/time/ais-replay';

describe('vesselsInPortAt / incomingAt', () => {
  // A:已在港(bbox 內);B:t=0 在 bbox 外,t=120s 進入 bbox
  const inside = track([[22.60, 120.30, 0, 0], [22.60, 120.30, 200_000, 0]]); inside.mmsi = 'A';
  const arriving = track([[22.60, 120.10, 0, 90], [22.60, 120.30, 120_000, 90]]); arriving.mmsi = 'B';
  const tracks = [inside, arriving];

  it('counts vessels inside the bbox at time t', () => {
    expect(vesselsInPortAt(tracks, 0)).toBe(1);        // 只有 A
    expect(vesselsInPortAt(tracks, 120_000)).toBe(2);  // A + B 已進入
  });
  it('incomingAt finds vessels entering the bbox within the window', () => {
    const inc = incomingAt(tracks, 0, 130_000);
    expect(inc.map((t) => t.mmsi)).toContain('B');
    expect(inc.map((t) => t.mmsi)).not.toContain('A'); // A 已在港,不算 incoming
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/port-ais-replay.test.ts`
Expected: FAIL（兩函式未定義）。

- [ ] **Step 3: 實作（追加到 `time/ais-replay.ts`）**

```typescript
// ↓ 此 import 請加到 ais-replay.ts **頂部** import 區(與 `import type { AisTrack }` 並列);其餘只 append 函式。
import { inKaohsiungBBox } from '../data/ais';

/** Count tracks whose interpolated position at tMs is inside the KHH bbox. */
export function vesselsInPortAt(tracks: AisTrack[], tMs: number): number {
  let n = 0;
  for (const t of tracks) {
    const p = positionAt(t, tMs);
    if (p && inKaohsiungBBox(p.lat, p.lon)) n++;
  }
  return n;
}

/** Tracks that are outside the bbox at tMs but enter it within (tMs, tMs+windowMs]. */
export function incomingAt(tracks: AisTrack[], tMs: number, windowMs: number): AisTrack[] {
  const out: AisTrack[] = [];
  for (const t of tracks) {
    const now = positionAt(t, tMs);
    if (now && inKaohsiungBBox(now.lat, now.lon)) continue; // 已在港
    // 掃描窗內的真實 path 點,看是否進入 bbox
    const entered = t.path.some((p) => p[2] > tMs && p[2] <= tMs + windowMs && inKaohsiungBBox(p[0], p[1]));
    if (entered) out.push(t);
  }
  return out;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/port-ais-replay.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/time/ais-replay.ts test/port-ais-replay.test.ts
git commit -m "feat(port-ais): vesselsInPortAt + incomingAt (AIS-derived KPI/incoming)"
```

---

## Task 11:`data/join.ts` — AIS↔TWPort join + 類別決定

**Files:**
- Create: `examples/kaohsiung-port/data/join.ts`
- Test: `test/port-join.test.ts`

- [ ] **Step 1: 寫失敗測試**

`test/port-join.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { joinTwport, categoryForTrack } from '../examples/kaohsiung-port/data/join';
import type { VesselRecord } from '../examples/kaohsiung-port/data/twport';
import type { AisTrack } from '../examples/kaohsiung-port/data/ais';

function rec(p: Partial<VesselRecord>): VesselRecord {
  return { visaNo: '', nameZh: '', nameEn: '', shipType: '', wharfName: '', berthNo: null, status: '',
    etaMs: null, etdMs: null, actPortMs: null, leaveMs: null, beforePort: '', nextPort: '', imo: '',
    callSign: '', source: 'berthing', ...p };
}
const trk = (p: Partial<AisTrack>): AisTrack =>
  ({ mmsi: 'A', imo: '', callSign: '', name: '', aisType: 0, path: [], ...p });

describe('joinTwport', () => {
  const vessels = [rec({ nameZh: '長榮', imo: '9811000', callSign: 'BMXX', shipType: '全貨櫃船' })];
  it('joins by IMO first', () => {
    expect(joinTwport(trk({ imo: '9811000' }), vessels)?.nameZh).toBe('長榮');
  });
  it('falls back to call sign', () => {
    expect(joinTwport(trk({ imo: '', callSign: 'BMXX' }), vessels)?.nameZh).toBe('長榮');
  });
  it('falls back to ship name', () => {
    expect(joinTwport(trk({ name: '長榮' }), vessels)?.nameZh).toBe('長榮');
  });
  it('returns null when nothing matches', () => {
    expect(joinTwport(trk({ imo: '0000' }), vessels)).toBeNull();
  });
});

describe('categoryForTrack', () => {
  const vessels = [rec({ imo: '9811000', shipType: '全貨櫃船' })];
  it('prefers TWPort ship type when joined', () => {
    expect(categoryForTrack(trk({ imo: '9811000', aisType: 80 }), vessels)).toBe('貨櫃');
  });
  it('falls back to AIS type code when no join', () => {
    expect(categoryForTrack(trk({ imo: '0000', aisType: 80 }), vessels)).toBe('油品');
  });
});
```

注:`shipCategoryIndex('全貨櫃船')` 須回傳「貨櫃」的索引(現有 `palette.ts` 行為;若實測非如此,測試的 `shipType` 字串改成 `palette.ts` 實際能對到「貨櫃」的字串)。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/port-join.test.ts`
Expected: FAIL（模組不存在）。

- [ ] **Step 3: 實作**

`examples/kaohsiung-port/data/join.ts`:

```typescript
import type { VesselRecord } from './twport';
import type { AisTrack } from './ais';
import { mapAisTypeToCategory } from './ais';
import { SHIP_CATEGORIES, shipCategoryIndex } from '../palette';
import type { ShipCategory } from '../palette';

/** Match an AIS track to a TWPort record: IMO → call sign → ship name. Null if none. */
export function joinTwport(track: AisTrack, vessels: VesselRecord[]): VesselRecord | null {
  if (track.imo) { const m = vessels.find((v) => v.imo && v.imo === track.imo); if (m) return m; }
  if (track.callSign) { const m = vessels.find((v) => v.callSign && v.callSign === track.callSign); if (m) return m; }
  if (track.name) {
    const n = track.name.trim().toUpperCase();
    const m = vessels.find((v) => v.nameEn.trim().toUpperCase() === n || v.nameZh.trim() === track.name.trim());
    if (m) return m;
  }
  return null;
}

/** Category for a track: prefer joined TWPort ship type, else AIS type code. */
export function categoryForTrack(track: AisTrack, vessels: VesselRecord[]): ShipCategory {
  const v = joinTwport(track, vessels);
  if (v && v.shipType) return SHIP_CATEGORIES[shipCategoryIndex(v.shipType)] as ShipCategory;
  return mapAisTypeToCategory(track.aisType);
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run test/port-join.test.ts`
Expected: PASS。若 `categoryForTrack` 的「貨櫃」斷言失敗,先用 `node -e` 或臨時測試確認 `shipCategoryIndex` 對 `'全貨櫃船'` 的回傳,調整測試字串(palette 行為為準)。

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/data/join.ts test/port-join.test.ts
git commit -m "feat(port-ais): AIS↔TWPort join + category resolution"
```

---

## Task 12:`ui/overlay.ts` — KPI 語義改「範圍內 AIS 船數」

**Files:**
- Modify: `examples/kaohsiung-port/ui/overlay.ts`

無新單元測試(UI;既有測試不涉 overlay 內部)。改動小而精準:把「泊位佔用」環形儀表改成顯示範圍內船數脈絡、移除 `/total` 百分比語義。

- [ ] **Step 1: 改 gauge 標籤與 stat 文案**

把 [overlay.ts:106](../../../examples/kaohsiung-port/ui/overlay.ts) 的 gauge label、與 [overlay.ts:112](../../../examples/kaohsiung-port/ui/overlay.ts) 的 stat label 改為以「範圍內 AIS 船數」為主語義:

```typescript
// gauge: 由「泊位佔用%」改為在港船數環。並把 [overlay.ts:105] 的 data-lg-unit 由 '%' 改為 '艘',
// 避免被讀成佔用率(環形以 data-lg-value=船數 充填,值即「艘」)。
gauge.setAttribute('data-lg-label', '範圍內船舶');
gauge.setAttribute('data-lg-unit', '艘');
```
```typescript
// stat label
stat.innerHTML = `<span class="lg-stat__label">範圍內 AIS 船數</span>
    <div class="lg-stat__row"><span class="lg-stat__value" data-lg-value="0"></span></div>
    <svg class="lg-stat__spark" data-lg-spark="0,0"></svg>`;
```

- [ ] **Step 2: 改 `setKpi` 語義**

把 [overlay.ts:258-262](../../../examples/kaohsiung-port/ui/overlay.ts) 的 `setKpi` 改成以 `inPort` 為主、`total` 當環形上限(預設 80):

```typescript
    setKpi({ inPort }) {                               // 只取 inPort;occupied/total 已無意義
      statValue.setAttribute('data-lg-value', String(inPort));
      gauge.setAttribute('data-lg-value', String(inPort)); // 環形以船數充填(cap≈80 滿格)
    },
```
(介面 `setKpi(opts)` 簽名不變,實作只解構需要的 `inPort`;呼叫端仍傳完整物件,多餘欄位忽略。)

- [ ] **Step 3: 改趨勢標題**

把 [overlay.ts:150](../../../examples/kaohsiung-port/ui/overlay.ts) 的 `24h 在港趨勢` 改為:

```typescript
    chart.innerHTML = `<div class="lg-chart__head"><h4 class="lg-chart__title">在港船舶趨勢</h4></div>
    <svg class="lg-chart__svg" data-lg-chart="line" data-lg-points="0,0"></svg>`;
```

- [ ] **Step 3b: 改進港清單標題窗口(與實際窗口一致)**

把 [overlay.ts:156](../../../examples/kaohsiung-port/ui/overlay.ts) 的 `即將進港 · 2h` 改為 `即將進港 · 30 分`(對齊 Task 13 的 `INCOMING_WINDOW = 30 分`):

```typescript
  incoming.innerHTML = '<div style="opacity:.6;text-transform:uppercase;font-size:10px;margin-bottom:6px">即將進港 · 30 分</div><div data-rows></div>';
```

- [ ] **Step 4: 型別檢查 + build**

Run: `npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: 0 錯、build 成功。

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/ui/overlay.ts
git commit -m "refactor(port-ais): KPI semantics → vessels-in-range (no berth occupancy)"
```

---

## Task 13:`main.ts` 改寫 — AIS 接管船位、時間軸、回放、render、click-pick

**Files:**
- Modify: `examples/kaohsiung-port/main.ts`

這是整合任務。逐步替換:① 載入 tracks;② 時間軸來自 meta;③ render 函式(footprint + trail);④ 回放 ticker;⑤ KPI/趨勢/進港改 AIS;⑥ click-pick 改 AIS。每步後跑 `tsc`。

- [ ] **Step 1: 載入 AIS tracks(取最新檔)+ 保留 TWPort 供 join**

把 [main.ts:17-20](../../../examples/kaohsiung-port/main.ts) 的 snapshot 載入後,追加 tracks 載入。在 imports 區加:

```typescript
import type { AisTrack, AisTracksFile } from './data/ais';
import { positionAt, trailPointsAt, vesselsInPortAt, incomingAt } from './time/ais-replay';
import { joinTwport, categoryForTrack } from './data/join';
```
並同時修改既有 import:把 [main.ts:5] 的 `import { buildShipLayer, sampleShipFootprint, type ShipLayerResult } from './scene/portPoints';` 改為 `import { sampleShipFootprint, TYPE_DIMS_M } from './scene/portPoints';`(移除 `buildShipLayer`、`ShipLayerResult`,新增 `TYPE_DIMS_M` ← 取代 Step 3 原本的中段 import);並從 [main.ts:8] 的 palette import 移除 `shipCategoryIndex`(新 `updateShips` 改用 `SHIP_CATEGORIES.indexOf`)。

在 snapshot 載入後加:

```typescript
const trackFiles = import.meta.glob('./data/ais-tracks/khh-*.json', { eager: true, import: 'default' });
const tracksFile = Object.entries(trackFiles).sort(([a], [b]) => a.localeCompare(b)).pop()?.[1] as AisTracksFile | undefined;
if (!tracksFile) throw new Error('No AIS tracks in ./data/ais-tracks/ — run `npm run port:ais:record` then `npm run port:ais:export`');
const tracks: AisTrack[] = tracksFile.ships;
const allVessels: VesselRecord[] = [...snapshot.berthing, ...snapshot.forecast];
```

- [ ] **Step 2: 用 AIS meta 取代時間常數**

把 [main.ts:28-32](../../../examples/kaohsiung-port/main.ts) **整段**(`intervals`/`nowMs`/`TOTAL_BERTHS`/`HOUR`/`INCOMING_WINDOW`)替換為下列 AIS 常數 —— 務必刪掉舊的 `TOTAL_BERTHS`/`HOUR`/`INCOMING_WINDOW = 2 * HOUR`,否則 `INCOMING_WINDOW` 會重複宣告(TS2451)且殘留 `MAX_BERTH`/`MIN_BERTH` 參照:

```typescript
const fromMs = tracksFile.meta.fromMs;
const toMs = tracksFile.meta.toMs;
const nowMs = fromMs; // 回放從頭開始
const TRAIL_MS = 15 * 60_000; // 拖尾窗 15 分鐘
const INCOMING_WINDOW = 30 * 60_000; // 進港前瞻 30 分鐘
```
移除 `buildIntervals`/`occupancyAt`/`berthStatusAt`/`buildOccupancyTrend`/`buildIncomingList` 的 import(改用 ais-replay)。`MIN_BERTH`/`MAX_BERTH`/`berthPositionLatLon` 的 import 可移除(incoming 標記改 AIS)。

- [ ] **Step 3: 寫 AIS render 函式(footprint + trail),取代 `rebuildShips`/`rebuildIncoming`**

把 [main.ts:54-91](../../../examples/kaohsiung-port/main.ts) 的 `rebuildShips`/`rebuildIncoming`(及 `shipCenters`)整段替換為:

```typescript
// 動態 AIS 船層:真實位置 footprint + 點雲淡尾。
const shipTypeLUT = buildCategoryLUT(SHIP_CATEGORY_COLORS);
const shipPC = new PointCloud({
  capacity: 300_000, ramp: shipTypeLUT,
  persistence: 'accumulate', colorMode: 'value', sizeAttenuation: false, pointSize: 3, maxPointSize: 5,
});

// 進港標記層(沿用,改由 AIS incoming 餵)
const incPC = new PointCloud({
  capacity: 40_000, ramp: buildCategoryLUT([INCOMING_COLOR]),
  persistence: 'accumulate', colorMode: 'value', sizeAttenuation: false, pointSize: 3, maxPointSize: 5,
  pulseHz: INCOMING_PULSE_HZ,
});

// TYPE_DIMS_M:import 已於 Step 1 併入頂部 ./scene/portPoints import(export 見 Step 3a);此處勿再放 import。

interface AisCenter { track: AisTrack; vessel: VesselRecord | null; x: number; y: number; z: number; }
let shipCenters: AisCenter[] = [];

const SHIP_Y = 0.5;
function updateShips(tMs: number, mode: 'type' | 'status', enabled?: Set<string>) {
  const pos: number[] = []; const val: number[] = [];
  const centers: AisCenter[] = [];
  const statusVal = valueFor(statusIndex('occupied'), STATUS_COLORS.length);
  for (const t of tracks) {
    const rp = positionAt(t, tMs);
    if (!rp) continue;
    const cat = categoryForTrack(t, allVessels);
    if (enabled && !enabled.has(cat)) continue;
    const catIdx = SHIP_CATEGORIES.indexOf(cat);
    const c = proj.toWorld(rp.lat, rp.lon);
    const dim = TYPE_DIMS_M[cat];
    const loaU = (t.loaM ?? dim.loa) * WORLD_SCALE;
    const beamU = (t.beamM ?? dim.beam) * WORLD_SCALE;
    // heading(0=N,順時針)→ footprint headingRad,讓船長軸對齊 (sinθ,-cosθ)
    const theta = rp.headingDeg * Math.PI / 180;
    const h = Math.atan2(-Math.cos(theta), Math.sin(theta));
    const v01 = mode === 'type' ? valueFor(catIdx, SHIP_CATEGORY_COLORS.length) : statusVal;
    // 小船降取樣:大船細、小船粗
    const spacing = loaU > 1.5 ? 0.15 : 0.3;
    for (const p of sampleShipFootprint(c, loaU, beamU, h, spacing)) { pos.push(p.x, SHIP_Y, p.z); val.push(v01); }
    // 拖尾:稀疏真實點,沿尾端淡出(用較低的 value 當「暗」近似,或同色)
    for (const tp of trailPointsAt(t, tMs, TRAIL_MS)) {
      const w = proj.toWorld(tp[0], tp[1]);
      pos.push(w.x, SHIP_Y, w.z); val.push(v01 * (1 - tp[2] * 0.7));
    }
    centers.push({ track: t, vessel: joinTwport(t, allVessels), x: c.x, y: SHIP_Y, z: c.z });
  }
  shipCenters = centers;
  shipPC.setRamp(mode === 'type' ? shipTypeLUT : shipStatusLUT);
  shipPC.clear();
  shipPC.addPoints(new Float32Array(pos), new Float32Array(val));
}

const INCOMING_VAL = valueFor(statusIndex('incoming'), STATUS_COLORS.length);
function updateIncoming(tMs: number) {
  const pos: number[] = []; const val: number[] = [];
  for (const t of incomingAt(tracks, tMs, INCOMING_WINDOW)) {
    const rp = positionAt(t, tMs);
    if (!rp) continue;
    const c = proj.toWorld(rp.lat, rp.lon);
    for (const p of sampleShipFootprint(c, 0.3, 0.3, 0, 0.08)) { pos.push(p.x, 1.5, p.z); val.push(INCOMING_VAL); }
  }
  incPC.clear();
  incPC.addPoints(new Float32Array(pos), new Float32Array(val));
}
```

- [ ] **Step 3a: 由 `portPoints.ts` export `TYPE_DIMS_M`**

[portPoints.ts:43](../../../examples/kaohsiung-port/scene/portPoints.ts) 的 `const TYPE_DIMS_M` 改為 `export const TYPE_DIMS_M`。

- [ ] **Step 4: 修正初始化呼叫與 `shipStatusLUT`**

**(重新)宣告** `const shipStatusLUT = buildCategoryLUT(STATUS_COLORS);`(Step 3 的整段替換已刪掉原 main.ts:56,故在此重加,且必須在第一次 `updateShips` 呼叫之前);把原 [main.ts:93](../../../examples/kaohsiung-port/main.ts) 的 `rebuildShips(nowMs, 'type')` 改為:

```typescript
const shipStatusLUT = buildCategoryLUT(STATUS_COLORS);
updateShips(nowMs, 'type');
```
`frameOf(shipCenters...)`([main.ts:106](../../../examples/kaohsiung-port/main.ts))沿用(shipCenters 現為 AisCenter,仍有 x/z)。

- [ ] **Step 5: 時間軸 / 趨勢 / KPI / 進港改 AIS**

把 [main.ts:153-177](../../../examples/kaohsiung-port/main.ts) 的 overlay 組裝與 `refresh` 改為:

```typescript
let colorBy: 'type' | 'status' = 'type';
let filter = new Set<string>(SHIP_CATEGORIES);
let currentMs = nowMs;
const overlay = createOverlay(document.getElementById('overlay') as HTMLElement, {
  onFilter(enabled) { filter = enabled; refresh(currentMs); },
  onView(mode) { colorBy = mode; refresh(currentMs); },
  onScrub(tMs) { refresh(tMs); },
  onBackdrop(on) { mapPlane.visible = on; },
});
function refresh(tMs: number) {
  currentMs = tMs;
  updateShips(tMs, colorBy, filter);
  updateIncoming(tMs);
  const inPort = vesselsInPortAt(tracks, tMs);
  overlay.setKpi({ inPort, occupied: inPort, total: 80, dateMs: tMs });
  overlay.setIncoming(
    incomingAt(tracks, tMs, INCOMING_WINDOW).slice(0, 6).map((t) => {
      const v = joinTwport(t, allVessels);
      return { berthNo: v?.berthNo ?? 0, name: v?.nameZh || v?.nameEn || t.name || t.mmsi, etaMs: tMs };
    }),
  );
  overlay.setClock(tMs);
}

// 趨勢:在港船數沿時間軸取樣 24 點
function buildAisTrend(steps: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) out.push(vesselsInPortAt(tracks, fromMs + ((toMs - fromMs) * i) / steps));
  return out;
}
overlay.setTimeRange({ minMs: fromMs, maxMs: toMs, nowMs });
overlay.setTrend(buildAisTrend(24));
refresh(nowMs);
```

- [ ] **Step 6: 回放 ticker(~12Hz)**

在 `refresh(nowMs)` 後、click handler 前加一個輕量播放 ticker(覆蓋 overlay 內建的 rAF sweep,讓步進用真實時間;overlay 的 play 鈕已驅動 `onScrub`,但為平滑連續移動,額外加一個自走 ticker 由 `__twin` 控制):

```typescript
// 自走回放:每 ~80ms 推進(由 __twin.play()/pause() 控制;預設停)。
let playTimer = 0;
function play() {
  if (playTimer) return;
  playTimer = window.setInterval(() => {
    let t = currentMs + (toMs - fromMs) / 600; // 約 50s 掃完全程
    if (t > toMs) t = fromMs;
    refresh(t);
  }, 80);
}
function pause() { if (playTimer) { clearInterval(playTimer); playTimer = 0; } }
```
（overlay 既有的 play 鈕仍可 scrub;此 ticker 提供連續動畫,經 `__twin.play()` 觸發。)

- [ ] **Step 7: click-pick 改 AIS 中心 + enrich 詳情卡**

把 [main.ts:180-191](../../../examples/kaohsiung-port/main.ts) 的 click handler 改為用 `shipCenters`(AisCenter)、詳情卡用 join 後的 VesselRecord(join 不到則用 AIS 欄位組一個最小 VesselRecord):

```typescript
canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  let best: { c: AisCenter; d: number } | null = null;
  for (const c of shipCenters) {
    const p = new THREE.Vector3(c.x, c.y, c.z).project(engine.camera3D);
    const sx = (p.x * 0.5 + 0.5) * rect.width, sy = (-p.y * 0.5 + 0.5) * rect.height;
    const d = Math.hypot(sx - mx, sy - my);
    if (p.z < 1 && (!best || d < best.d)) best = { c, d };
  }
  if (best && best.d < 28) {
    const c = best.c;
    overlay.showVessel(c.vessel ?? {
      visaNo: '', nameZh: c.track.name, nameEn: '', shipType: `AIS type ${c.track.aisType}`,
      wharfName: '—', berthNo: null, status: '', etaMs: null, etdMs: null, actPortMs: null,
      leaveMs: null, beforePort: '', nextPort: '', imo: c.track.imo, callSign: c.track.callSign,
      source: 'berthing',
    });
  } else overlay.hideVessel();
});
```

- [ ] **Step 8: 更新 `__twin` 把手**

把 [main.ts:194-199](../../../examples/kaohsiung-port/main.ts) 的 `__twin` 改為:

```typescript
(window as any).__twin = {
  engine, shipPC, incPC, mapPlane, updateShips, updateIncoming, refresh, play, pause,
  fromMs, toMs, nowMs, tracks,
  layers: Object.fromEntries(layerHandles.map((h) => [h.key, h])),
  get shipCenters() { return shipCenters; },
  setBasemapTint: (hex: number) => { (mapPlane.material as THREE.MeshBasicMaterial).color.setHex(hex); },
};
```

- [ ] **Step 9: 型別檢查 + build**

Run: `npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: 0 錯、build 成功。`tsconfig.json` 開了 `noUnusedLocals`/`noUnusedParameters`,務必移除**所有**現已未使用的 import:`occupancy`(buildIntervals/occupancyAt/berthStatusAt/buildOccupancyTrend/buildIncomingList)、`berths`(MIN_BERTH/MAX_BERTH/berthPositionLatLon)、`shipCategoryIndex`、`buildShipLayer`、`ShipLayerResult`。

- [ ] **Step 10: Commit**

```bash
git add examples/kaohsiung-port/main.ts examples/kaohsiung-port/scene/portPoints.ts
git commit -m "feat(port-ais): main.ts — AIS positions/timeline/replay/trails/pick"
```

---

## Task 14:gitignore、短窗樣本、handoff,最終驗證

**Files:**
- Modify: `.gitignore`、`docs/superpowers/2026-06-14-handoff.md`
- Create(產出): `examples/kaohsiung-port/data/ais-tracks/khh-<date>.json`(短窗驗證檔,commit)

- [ ] **Step 1: gitignore raw jsonl 與探針樣本**

`.gitignore` 末尾加:

```
# AIS recorder raw logs (large) + probe samples — only the exported short-window khh-*.json is committed
examples/kaohsiung-port/data/ais-tracks/raw-khh-*.jsonl
examples/kaohsiung-port/data/ais-tracks/_probe-sample.json
```

- [ ] **Step 2: 在台灣機器產出短窗驗證檔**

Run: `npm run port:ais:record`（跑 30–60 分鐘後 Ctrl-C）→ `npm run port:ais:export`
產出 `examples/kaohsiung-port/data/ais-tracks/khh-<date>.json`。確認 `ships.length > 0`、`meta.toMs > meta.fromMs`。

- [ ] **Step 3: 全測試 + 型別 + build**

Run: `npm test && npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: 全綠(120 + 新增 AIS 測試)、tsc 0、build 成功。

- [ ] **Step 4: 瀏覽器目視驗證**

Run: `npm run dev`,瀏覽器開 `/examples/kaohsiung-port/index.html`,主控台 `__twin.play()`。
Expected 逐項確認:
- 船出現在**水面/碼頭邊**(非陸地中央)。
- `__twin.play()` 後船沿真實航跡移動、有移動的船拖出淡尾。
- 拖曳時間軸 → 船位連動。
- KPI「範圍內 AIS 船數」、趨勢線隨時間變動。
- 進港標記/清單在**時間軸前段**最明顯(`incomingAt` 前瞻未來 path 點,越接近 `toMs` 自然越少)→ 驗證進港時把 scrubber 拉到前段。
- 點船 → 出詳情卡(join 到顯示中文船名/船型/泊位;join 不到顯示 AIS 欄位)。
- 主控台無 error。

- [ ] **Step 5: 更新 handoff**

在 [docs/superpowers/2026-06-14-handoff.md](../2026-06-14-handoff.md) 頂部加 2026-06-18 F1 完成節:資料源改 MPB 公開 AIS(免金鑰)、三段管線、AIS 接管船位與時間軸、修好「船在陸地上」、KPI 改範圍內船數;子專案狀態 F1 ✅。記下「24h 錄製器在另一台機器長跑後 copy `khh-<date>.json` 回 `data/ais-tracks/` 即可替換」。並更新 §7 開發小抄:`__twin` 把手 `rebuildShips`/`rebuildIncoming` 已更名為 `updateShips`/`updateIncoming`,新增 `play()`/`pause()`;`basePC`/`intervals` 已移除。

- [ ] **Step 6: Commit**

```bash
git add .gitignore examples/kaohsiung-port/data/ais-tracks/khh-*.json docs/superpowers/2026-06-14-handoff.md
git commit -m "feat(port-ais): commit short-window tracks sample + gitignore raw + handoff"
```

---

## Self-Review(計畫對 spec 覆蓋檢查)

- **§2 資料源 / Task 0 探針**:Task 0 ✅。
- **§4.1 純函式核心**:parseAisFeature/parseAisTime(T1)、bbox(T2)、aggregate 去重(T3)、cleanTracks 保留靜止(T4)、type→類別(T5)✅。
- **§4.2 錄製器/export**:record-ais(T7)、export+buildTracksFile(T6)✅。
- **§4.3 回放函式**:lerpAngleDeg/positionAt(T8)、trailPointsAt 分鐘級(T9)、vesselsInPortAt/incomingAt(T10)✅。**朝向採 2 段(AIS heading → 點間方位角)**;COG tier 刻意不做(移動時 COG≈點間方位角,且 path 不存 COG),已對應修訂 spec §4.3 並補 §5 誠實邊界。
- **§4.4 main.ts**:tracks 載入取最新(T13.S1)、時間軸 meta(T13.S2)、ticker(T13.S6)、render footprint+trail+小船降取樣(T13.S3)、click-pick(T13.S7)、退 BERTH_LINE(T13.S3 取代)、KPI/趨勢/進港 AIS(T13.S5)✅。
- **§4.5 join**:joinTwport IMO→呼號→船名、categoryForTrack(T11)✅。
- **§5 誠實邊界**:插值(T8)、type 粗對映優先 TWPort(T5/T11)、KPI 語義(T12)、handoff 記錄(T14.S5)✅。
- **§6 測試/品質**:三個測試檔 + tsc + build + 目視(T1–T14)✅。

**型別一致性**:`AisPing`/`AisTrack`/`AisPathPoint`(4-tuple,含 hdg)/`AisTracksFile`/`BBox` 全程一致;`positionAt`→`ResolvedPos`;`categoryForTrack`/`joinTwport` 簽名跨 T11/T13 一致;`TYPE_DIMS_M` 於 T13.S3a export 後於 T13.S3 使用。

**佔位**:已移除 T4 Step 3 的 `KN_PER_MS_PER_DEG` 佔位行(對抗審查後修正);全計畫無剩餘佔位。

**對抗審查(4 視角)已修正**:trailPointsAt 窗口邊界 off-by-one(T9 impl 改 strict `<`)、cleanTracks 三個測試的非數字 MMSI(改 `416000123`)、三處檔案中段 import(T5/T10/T13 改頂部)、T13 Step2 範圍改 28-32(避免 `INCOMING_WINDOW` 重宣告)、未使用 import 清單補齊(`shipCategoryIndex`/`buildShipLayer`/`ShipLayerResult`)、KPI 環形改顯示船數+單位「艘」、進港清單標題改「30 分」。

**規模**:單一可獨立驗證的子專案(F1),14 任務,符合既有子專案粒度。
