import { writeFileSync, renameSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fetchTwportSnapshot } from './twport-fetch';
import { upsertVessels, buildUnionSnapshot, type VesselRecord, type TwportSnapshot } from './twport';

// 防呆:非數字/<=0 的 TWPORT_POLL_MIN 退回預設 15min(避免 NaN → setTimeout 立即觸發熱迴圈)。
const pollMin = Number(process.env.TWPORT_POLL_MIN);
const POLL_MS = (Number.isFinite(pollMin) && pollMin > 0 ? pollMin : 15) * 60_000;

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
