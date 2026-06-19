# TWPort Accumulating Recorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a resilient TWPort recorder that polls berthing/forecast in parallel with AIS recording and accumulates a union snapshot, so `main.ts`'s join finds Chinese names / berths across the whole timeline.

**Architecture:** Extract the existing TWPort fetch logic into a side-effect-free helper, add pure union/dedup functions to `twport.ts`, build a single-loop recorder that upserts an in-memory `Map` and atomically rewrites the snapshot each poll, and run it in parallel from `run-ais-record.sh`. The output reuses the existing `Snapshot` shape, so `main.ts` and the engine are untouched.

**Tech Stack:** TypeScript, `vite-node` (runs `.ts` directly), `vitest` (node env), bash.

## Global Constraints

- `main.ts` and engine (`src/`) MUST NOT change. Output stays compatible with the existing `Snapshot` shape `{ capturedAtMs, berthing, forecast }`.
- `npm run port:fetch` behavior and output format MUST remain identical after the refactor.
- Tests: `vitest`, node environment, files in `./test/`, importing from `../examples/kaohsiung-port/data/...`.
- All TWPort fetches: BIG5 decode, `type=1` (berthing) + `type=5` (forecast), 3-attempt retry. Reuse one helper — no duplicated fetch logic.
- Dedup key precedence (exact): `visaNo || imo || callSign || nameEn || nameZh`, each `.trim()`ed; all-empty → skip.
- Upsert order per poll: forecast first, then berthing (berthing wins on key collision).
- Snapshot writes from the recorder MUST be atomic (temp file + rename) and only happen after a successful poll.
- Quality gate at the end: `npm test` green, `npx tsc --noEmit` 0 errors, `npm run build` ok.

---

### Task 1: Extract side-effect-free TWPort fetch helper

Pull the `fetchType` logic out of `fetch-snapshot.ts` (which has top-level `await` side effects and can't be imported) into a reusable module, then rewire `fetch-snapshot.ts` to use it. Pure refactor — no behavior change.

**Files:**
- Create: `examples/kaohsiung-port/data/twport-fetch.ts`
- Modify: `examples/kaohsiung-port/data/fetch-snapshot.ts` (full rewrite, see Step 3)

**Interfaces:**
- Consumes: `parseTwportXml`, `VesselRecord` from `./twport`.
- Produces: `fetchTwportSnapshot(): Promise<{ berthing: VesselRecord[]; forecast: VesselRecord[] }>` — fetches both types with retry, throws after 3 failed attempts, no file IO.

- [x] **Step 1: Create the helper module**

Create `examples/kaohsiung-port/data/twport-fetch.ts`:

```ts
import { parseTwportXml, type VesselRecord } from './twport';

const BASE = 'https://tpnet.twport.com.tw/IFAWeb/Reports/OpenData/GetOpenData';

// Module-level decoder: fails fast on unsupported encoding instead of silently retrying.
const BIG5 = new TextDecoder('big5');

async function fetchType(type: number, source: 'berthing' | 'forecast'): Promise<VesselRecord[]> {
  const url = `${BASE}?port=KHH&type=${type}`;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`TWPort type=${type} HTTP ${res.status}`);
      const xml = BIG5.decode(await res.arrayBuffer());
      const records = parseTwportXml(xml, source);
      if (source === 'berthing' && records.length === 0) {
        throw new Error(`TWPort type=${type} returned no <SHIP> records (${xml.length} bytes) — likely a maintenance/error page`);
      }
      return records;
    } catch (e) {
      lastErr = e;
      if (attempt < 3) {
        console.warn(`attempt ${attempt} failed for type=${type}, retrying...`);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  }
  throw lastErr;
}

/** Fetch one TWPort snapshot (berthing=type1, forecast=type5). Throws after retries. No file IO. */
export async function fetchTwportSnapshot(): Promise<{ berthing: VesselRecord[]; forecast: VesselRecord[] }> {
  const berthing = await fetchType(1, 'berthing');
  const forecast = await fetchType(5, 'forecast');
  return { berthing, forecast };
}
```

- [x] **Step 2: Run type-check to verify the helper compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 0 errors.

- [x] **Step 3: Rewire `fetch-snapshot.ts` to use the helper**

Replace the entire contents of `examples/kaohsiung-port/data/fetch-snapshot.ts` with:

```ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fetchTwportSnapshot } from './twport-fetch';

const here = dirname(fileURLToPath(import.meta.url));

// Stamp capturedAtMs BEFORE fetches — it represents the snapshot's reference "now".
const capturedAtMs = Date.now();
const { berthing, forecast } = await fetchTwportSnapshot();
const out = { capturedAtMs, berthing, forecast };

const dir = resolve(here, 'snapshots');
mkdirSync(dir, { recursive: true });
const date = new Date(capturedAtMs).toISOString().slice(0, 10);
const path = resolve(dir, `khh-${date}.json`);
writeFileSync(path, JSON.stringify(out, null, 2));
console.log(`wrote ${path}: ${berthing.length} berthing, ${forecast.length} forecast`);
```

- [x] **Step 4: Type-check + build to verify nothing broke**

Run: `npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: tsc 0 errors; build succeeds.

- [x] **Step 5: (Optional, needs Taiwan IP) verify `port:fetch` still works**

Run: `npm run port:fetch`
Expected: prints `wrote .../snapshots/khh-<today>.json: N berthing, M forecast`.
Then discard the freshly-written file so the committed 06-14 fixture stays the only tracked snapshot:
Run: `git status --short examples/kaohsiung-port/data/snapshots/` then `rm -f examples/kaohsiung-port/data/snapshots/khh-<today>.json` (only the new dated file; never delete `khh-2026-06-14.json`).
If no Taiwan IP, skip this step — Step 4 already proves the refactor compiles and builds.

- [x] **Step 6: Commit**

```bash
git add examples/kaohsiung-port/data/twport-fetch.ts examples/kaohsiung-port/data/fetch-snapshot.ts
git commit -m "refactor(port): extract fetchTwportSnapshot() helper (no behavior change)"
```

---

### Task 2: Pure union/dedup functions + tests

Add the accumulation primitives to `twport.ts` with full unit-test coverage. This is the only task with meaningful pure logic to TDD.

**Files:**
- Modify: `examples/kaohsiung-port/data/twport.ts` (append exports)
- Test: `test/port-twport-aggregate.test.ts`

**Interfaces:**
- Consumes: `VesselRecord` (existing, from `./twport`).
- Produces:
  - `interface TwportSnapshot { capturedAtMs: number; berthing: VesselRecord[]; forecast: VesselRecord[] }`
  - `unionKey(v: VesselRecord): string | null`
  - `upsertVessels(map: Map<string, VesselRecord>, records: VesselRecord[]): void`
  - `buildUnionSnapshot(map: Map<string, VesselRecord>, lastForecast: VesselRecord[], capturedAtMs: number): TwportSnapshot`

- [x] **Step 1: Write the failing tests**

Create `test/port-twport-aggregate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  unionKey,
  upsertVessels,
  buildUnionSnapshot,
  type VesselRecord,
} from '../examples/kaohsiung-port/data/twport';

function mk(p: Partial<VesselRecord>): VesselRecord {
  return {
    visaNo: '', nameZh: '', nameEn: '', shipType: '', wharfName: '', berthNo: null,
    status: '', etaMs: null, etdMs: null, actPortMs: null, leaveMs: null,
    beforePort: '', nextPort: '', imo: '', callSign: '', source: 'berthing', ...p,
  };
}

describe('unionKey', () => {
  it('prefers visaNo, then imo, callSign, nameEn, nameZh', () => {
    expect(unionKey(mk({ visaNo: 'V1', imo: '9', callSign: 'C', nameEn: 'E', nameZh: 'Z' }))).toBe('V1');
    expect(unionKey(mk({ imo: '9281346', callSign: 'C', nameEn: 'E' }))).toBe('9281346');
    expect(unionKey(mk({ callSign: 'VRWC7', nameEn: 'E' }))).toBe('VRWC7');
    expect(unionKey(mk({ nameEn: 'DONG FANG' }))).toBe('DONG FANG');
    expect(unionKey(mk({ nameZh: '東方廈門' }))).toBe('東方廈門');
  });
  it('trims whitespace and returns null when all keys are empty/blank', () => {
    expect(unionKey(mk({ visaNo: '  A1  ' }))).toBe('A1');
    expect(unionKey(mk({ visaNo: '   ', imo: '  ' }))).toBeNull();
    expect(unionKey(mk({}))).toBeNull();
  });
});

describe('upsertVessels', () => {
  it('de-duplicates by key (latest-wins) and skips unidentifiable records', () => {
    const m = new Map<string, VesselRecord>();
    upsertVessels(m, [mk({ visaNo: 'A1', nameZh: '舊' }), mk({ visaNo: 'A1', nameZh: '新' })]);
    upsertVessels(m, [mk({ /* no key */ shipType: '工作船' })]);
    expect(m.size).toBe(1);
    expect(m.get('A1')!.nameZh).toBe('新');
  });
  it('forecast-then-berthing order lets berthing overwrite the same key', () => {
    const m = new Map<string, VesselRecord>();
    const forecast = [mk({ visaNo: 'A1', source: 'forecast', berthNo: null })];
    const berthing = [mk({ visaNo: 'A1', source: 'berthing', berthNo: 108 })];
    upsertVessels(m, forecast);
    upsertVessels(m, berthing);
    expect(m.get('A1')!.source).toBe('berthing');
    expect(m.get('A1')!.berthNo).toBe(108);
  });
  it('merges a reloaded prior union with a new poll (restart resilience)', () => {
    const m = new Map<string, VesselRecord>();
    upsertVessels(m, [mk({ visaNo: 'OLD' })]);          // reloaded from existing snapshot
    upsertVessels(m, [mk({ visaNo: 'NEW' }), mk({ visaNo: 'OLD', nameZh: '更新' })]);
    expect(m.size).toBe(2);
    expect(m.get('OLD')!.nameZh).toBe('更新');
  });
});

describe('buildUnionSnapshot', () => {
  it('puts the full union into berthing and the last poll into forecast', () => {
    const m = new Map<string, VesselRecord>();
    upsertVessels(m, [mk({ visaNo: 'A1' }), mk({ visaNo: 'A2' })]);
    const lastForecast = [mk({ visaNo: 'F1', source: 'forecast' })];
    const snap = buildUnionSnapshot(m, lastForecast, 1750000000000);
    expect(snap.capturedAtMs).toBe(1750000000000);
    expect(snap.berthing.map((v) => v.visaNo).sort()).toEqual(['A1', 'A2']);
    expect(snap.forecast).toBe(lastForecast);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/port-twport-aggregate.test.ts`
Expected: FAIL — `unionKey`/`upsertVessels`/`buildUnionSnapshot` are not exported.

- [x] **Step 3: Implement the functions**

Append to `examples/kaohsiung-port/data/twport.ts` (after the existing `parseTwportXml`):

```ts
/** Snapshot shape consumed by main.ts (structurally compatible with its local interface). */
export interface TwportSnapshot {
  capturedAtMs: number;
  berthing: VesselRecord[];
  forecast: VesselRecord[];
}

/** Identity key for de-duplicating a vessel across polls. Null if unidentifiable. */
export function unionKey(v: VesselRecord): string | null {
  const k =
    v.visaNo.trim() || v.imo.trim() || v.callSign.trim() || v.nameEn.trim() || v.nameZh.trim();
  return k || null;
}

/** Upsert records into the union map keyed by unionKey (latest-wins). Unidentifiable records are skipped. */
export function upsertVessels(map: Map<string, VesselRecord>, records: VesselRecord[]): void {
  for (const r of records) {
    const k = unionKey(r);
    if (k) map.set(k, r);
  }
}

/** Build a snapshot from the accumulated union map plus the most recent forecast poll. */
export function buildUnionSnapshot(
  map: Map<string, VesselRecord>,
  lastForecast: VesselRecord[],
  capturedAtMs: number,
): TwportSnapshot {
  return { capturedAtMs, berthing: [...map.values()], forecast: lastForecast };
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/port-twport-aggregate.test.ts`
Expected: PASS (all cases).

- [x] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/data/twport.ts test/port-twport-aggregate.test.ts
git commit -m "feat(port-twport): union/dedup primitives for accumulating snapshot"
```

---

### Task 3: TWPort recorder + standalone npm script

Build the resilient recorder loop and a way to run it standalone.

**Files:**
- Create: `examples/kaohsiung-port/data/record-twport.ts`
- Modify: `package.json` (add `port:twport:record` script)

**Interfaces:**
- Consumes: `fetchTwportSnapshot` from `./twport-fetch`; `upsertVessels`, `buildUnionSnapshot`, `VesselRecord`, `TwportSnapshot` from `./twport`.
- Produces: a long-running process writing `examples/kaohsiung-port/data/snapshots/khh-<UTC-date>.json`. Env knob `TWPORT_POLL_MIN` (default 15).

- [x] **Step 1: Create the recorder**

Create `examples/kaohsiung-port/data/record-twport.ts`:

```ts
import { writeFileSync, renameSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fetchTwportSnapshot } from './twport-fetch';
import { upsertVessels, buildUnionSnapshot, type VesselRecord, type TwportSnapshot } from './twport';

const POLL_MS = Number(process.env.TWPORT_POLL_MIN ?? 15) * 60_000;

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, 'snapshots');
mkdirSync(dir, { recursive: true });
const date = new Date().toISOString().slice(0, 10); // 啟動算一次,整段寫同一檔(跨午夜不歸零)
const outPath = resolve(dir, `khh-${date}.json`);

// 重啟韌性:載入既有 snapshot 的 berthing 當 union 起點,不丟先前累積。
const union = new Map<string, VesselRecord>();
if (existsSync(outPath)) {
  try {
    const prev = JSON.parse(readFileSync(outPath, 'utf8')) as TwportSnapshot;
    if (Array.isArray(prev.berthing)) upsertVessels(union, prev.berthing);
    console.log(`resuming from ${outPath}: ${union.size} vessels in union`);
  } catch {
    console.warn(`existing ${outPath} unreadable; starting fresh`);
  }
}

// 原子寫入:寫 .tmp 再 rename,保證讀者永遠看到完整合法 JSON。
function writeAtomic(snap: TwportSnapshot): void {
  const tmp = `${outPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(snap, null, 2));
  renameSync(tmp, outPath);
}

let lastForecast: VesselRecord[] = [];
let backoff = POLL_MS;

async function pollOnce(): Promise<void> {
  const capturedAtMs = Date.now();
  const { berthing, forecast } = await fetchTwportSnapshot(); // 成功才往下(失敗 throw → 不覆寫)
  upsertVessels(union, forecast); // forecast 先
  upsertVessels(union, berthing); // berthing 後 → 同 key 覆蓋
  lastForecast = forecast;
  writeAtomic(buildUnionSnapshot(union, lastForecast, capturedAtMs));
  console.log(`${new Date(capturedAtMs).toISOString()}  union ${union.size}, forecast ${forecast.length} → ${outPath}`);
}

console.log(`recording KHH TWPort every ${POLL_MS / 60_000}min → ${outPath}  (Ctrl-C to stop)`);
// 韌性 loop:錯誤指數退避、永不退出;失敗輪不覆寫既有好檔。
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

- [x] **Step 2: Add the standalone npm script**

In `package.json`, add this line to `scripts` immediately after the `port:ais:auto` line:

```json
    "port:twport:record": "vite-node examples/kaohsiung-port/data/record-twport.ts",
```

(Ensure the preceding `port:ais:auto` line ends with a comma.)

- [x] **Step 3: Type-check + build**

Run: `npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: tsc 0 errors; build succeeds.

- [x] **Step 4: (Optional, needs Taiwan IP) one-cycle live smoke**

Run: `TWPORT_POLL_MIN=15 timeout 40s npm run port:twport:record || true`
Expected: prints at least one `... union N, forecast M → .../snapshots/khh-<today>.json` line, and the file is valid JSON:
Run: `node -e "const s=require('./examples/kaohsiung-port/data/snapshots/khh-<today>.json'); console.log('berthing', s.berthing.length, 'forecast', s.forecast.length, 'capturedAtMs', s.capturedAtMs)"`
Then discard the dated artifact (keep only the committed 06-14 fixture):
Run: `rm -f examples/kaohsiung-port/data/snapshots/khh-<today>.json`
If no Taiwan IP, skip — Step 3 proves it compiles.

- [x] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/data/record-twport.ts package.json
git commit -m "feat(port-twport): resilient accumulating recorder + port:twport:record"
```

---

### Task 4: Parallel integration into the auto script

Run the TWPort recorder in parallel with AIS recording under the same duration, and report both output files.

**Files:**
- Modify: `examples/kaohsiung-port/data/run-ais-record.sh`

**Interfaces:**
- Consumes: `record-twport.ts` (Task 3), the existing AIS record/export flow.
- Produces: `npm run port:ais:auto` now also produces an accumulated `snapshots/khh-<date>.json`. New knobs: `TWPORT_POLL_MIN` (default 15), `SKIP_TWPORT` (default 0).

- [x] **Step 1: Add the two new knobs**

In `run-ais-record.sh`, in the knob block near the top (right after the `BACKGROUND="${BACKGROUND:-0}"` line), add:

```bash
SKIP_TWPORT="${SKIP_TWPORT:-0}"
TWPORT_POLL_MIN="${TWPORT_POLL_MIN:-15}"
```

- [x] **Step 2: Declare the recorder path**

In the path block (where `REC_TS`, `EXPORT_TS` etc. are defined), add:

```bash
TWPORT_TS="$DATA_DIR/record-twport.ts"
```

- [x] **Step 3: Launch TWPort in parallel before the AIS foreground record**

Locate the line `log "開始錄製:時長 ${DURATION_HOURS}h..."` (the AIS record section, just after `export AIS_POLL_MS=...`). Immediately BEFORE that `log` line, insert:

```bash
# 並行啟動 TWPort 累積錄製(自我限時同 DURATION),與 AIS 並跑、獨立輸出檔。
TW_PID=""
if [ "$SKIP_TWPORT" = "1" ]; then
  log "SKIP_TWPORT=1 → 不並行錄 TWPort"
else
  log "並行啟動 TWPort 錄製:每 ${TWPORT_POLL_MIN}min · 限時同 ${DURATION_HOURS}h"
  if command -v timeout >/dev/null 2>&1; then
    TWPORT_POLL_MIN="$TWPORT_POLL_MIN" timeout --signal=TERM --kill-after=20s "${DURATION_SECONDS}s" "$VITE_NODE" "$TWPORT_TS" &
    TW_PID=$!
  else
    TWPORT_POLL_MIN="$TWPORT_POLL_MIN" "$VITE_NODE" "$TWPORT_TS" &
    TW_PID=$!
    ( sleep "$DURATION_SECONDS"; kill -TERM "$TW_PID" 2>/dev/null ) &
  fi
fi
```

- [x] **Step 4: Wait for TWPort to finish after AIS recording**

Locate the AIS record-result `case "$REC_RC" in ... esac` block. Immediately AFTER that `esac`, insert:

```bash
# AIS 已收尾;等並行的 TWPort 也自我限時結束(原子寫入確保最後一檔完整)。
if [ -n "${TW_PID:-}" ]; then
  log "等待 TWPort 錄製收尾…"
  wait "$TW_PID" 2>/dev/null || true
  log "TWPort 錄製結束"
fi
```

- [x] **Step 5: Report the TWPort snapshot at the end**

At the very end of the file, after the final `log "把這個檔 copy 回開發機..."` line, append:

```bash
LATEST_SNAP="$(ls -t "$DATA_DIR/snapshots"/khh-*.json 2>/dev/null | head -1 || true)"
if [ -n "$LATEST_SNAP" ]; then
  log "TWPort snapshot:$LATEST_SNAP($(du -h "$LATEST_SNAP" | cut -f1))"
  log "提醒:把 ais-tracks/khh-*.json 與 snapshots/khh-*.json 兩個檔一起 copy 回開發機。"
fi
```

- [x] **Step 6: Syntax check**

Run: `bash -n examples/kaohsiung-port/data/run-ais-record.sh`
Expected: no output (syntax OK).

- [x] **Step 7: (Optional, needs Taiwan IP) end-to-end smoke + cleanup**

Run a ~40s full auto run that exercises both recorders without polluting tracked fixtures:
Run: `SKIP_PROBE=1 DURATION_HOURS=0.011 npm run port:ais:auto`
Expected: logs show AIS recording, "並行啟動 TWPort 錄製", "等待 TWPort 錄製收尾", an AIS `khh-<today>.json` export line, and a final "TWPort snapshot: ...khh-<today>.json" line.
Then verify both artifacts are valid and discard them (they are dated, untracked, gitignored for raw):
Run: `node -e "const s=require('./examples/kaohsiung-port/data/snapshots/khh-<today>.json'); console.log('snap berthing', s.berthing.length, 'forecast', s.forecast.length)"`
Run: `rm -f examples/kaohsiung-port/data/snapshots/khh-<today>.json examples/kaohsiung-port/data/ais-tracks/raw-khh-<today>.jsonl examples/kaohsiung-port/data/ais-tracks/khh-<today>.json`
If no Taiwan IP, skip this step — Step 6 covers syntax and the recorder was proven in Task 3.

- [x] **Step 8: Full quality gate**

Run: `npm test && npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: all tests green (including the new aggregate tests), tsc 0 errors, build succeeds.

- [x] **Step 9: Confirm working tree has no stray data artifacts**

Run: `git status --short`
Expected: only `M examples/kaohsiung-port/data/run-ais-record.sh` staged-or-modified; NO `khh-2026-06-*.json` changes under `snapshots/` other than the committed fixture, and no `raw-khh-*.jsonl` (gitignored). If a dated artifact appears, remove it (never the committed `khh-2026-06-14.json`).

- [x] **Step 10: Commit**

```bash
git add examples/kaohsiung-port/data/run-ais-record.sh
git commit -m "feat(port-ais): run TWPort accumulating recorder in parallel from port:ais:auto"
```

---

## Notes for the implementer

- `vite-node` runs `.ts` directly; there is no separate compile step for the scripts. `npm run build` (vite + `tsc -p tsconfig.build.json`) is the type/declaration gate.
- The recorder is a side-effect/IO process (network + file writes + infinite loop); it is intentionally NOT unit-tested. The pure logic it depends on is fully covered in Task 2. Validate the recorder via the optional live smokes and the type/build gate.
- Never delete or overwrite the committed fixture `examples/kaohsiung-port/data/snapshots/khh-2026-06-14.json`. Live smokes write a different dated file; always clean up that dated file, not the fixture.
- `main.ts` picks the lexicographically-latest snapshot file; a newer dated snapshot would shadow the 06-14 fixture in local dev. That is fine on the Taiwan machine (intended), but in this repo keep only the committed fixture tracked.
