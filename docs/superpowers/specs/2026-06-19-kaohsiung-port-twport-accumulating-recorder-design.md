# 設計:TWPort 累積錄製器(F1 補強)

- **日期**:2026-06-19
- **狀態**:設計定案,待寫實作計畫
- **脈絡**:F1 真實 AIS 已完成。AIS feed 提供即時位置 + 拼音船名 + AIS 類型碼,但**不含中文船名與官方指泊船席**——那些只存在於 TWPort 開放資料,於 `main.ts` 執行期以 IMO→呼號→船名 join。目前 TWPort 只有一份**過時的單點 snapshot**(`khh-2026-06-14.json`),與未來新錄的 AIS 時間不對齊,且單點無法涵蓋 24h 內進進出出的船 → join 覆蓋率受限。

## 目標

在 AIS 錄製的同時,於台灣機器**並行累積** TWPort 指泊/預報名單,產出一份**涵蓋整段錄製窗、所有出現過船舶**的 union snapshot,讓 `main.ts` 的 join 在整條時間軸都能補上中文船名/船型/船席。

## 非目標

- 不改 `main.ts`、不改引擎(`src/`)。輸出沿用既有 `Snapshot` 介面,是 `fetch-snapshot.ts` 的超集。
- 不做 TWPort 的逐輪時間序列(我們只要最終身分字典 + 最新預報,不需要回放 TWPort)。
- 不碰 AIS 管線的既有行為。

## 架構

**單一持續迴圈 + 記憶體 union + 每輪原子整檔覆寫**,刻意不仿 AIS 的「raw-log → export」兩段式——因為只需要最終結果,停止當下檔案即為最終 snapshot,無後處理步驟。

### 元件

| 檔案 | 職責 | 測試 |
|---|---|---|
| `data/twport.ts`(既有,擴充) | 新增純函式 `unionKey(v)`、`upsertVessels(map, records)`、`buildUnionSnapshot(map, lastForecast, capturedAtMs)` | node 單元測試 |
| `data/twport-fetch.ts`(新,重構抽出) | 無副作用的 `fetchTwportSnapshot()`(BIG5 解碼 + type=1/5 + 3 次重試),供 `fetch-snapshot.ts` 與錄製器共用 | 不測(網路副作用層) |
| `data/fetch-snapshot.ts`(既有,改) | 改成呼叫 `fetchTwportSnapshot()` + 寫檔,行為與輸出不變 | — |
| `data/record-twport.ts`(新) | 韌性迴圈:每 N 分鐘抓取 → upsert union → 原子覆寫 snapshot | 不測(網路/IO 副作用層) |
| `data/run-ais-record.sh`(既有,改) | 並行啟動 TWPort 背景錄製、與 AIS 同 `DURATION` 限時收尾 | — |
| `package.json` | 新增 `port:twport:record` 別名 | — |

### 純函式契約(`twport.ts`)

```
unionKey(v: VesselRecord): string | null
  回傳 v.visaNo || v.imo || v.callSign || v.nameEn || v.nameZh(皆 trim);全空回 null。

upsertVessels(map: Map<string, VesselRecord>, records: VesselRecord[]): void
  對每筆 record:key = unionKey(record);key 為 null 則跳過;否則 map.set(key, record)(latest-wins)。
  呼叫端負責順序:每輪先 upsert 該輪 forecast、再 upsert 該輪 berthing
  → 同 visaNo 時 berthing(實際靠泊)覆蓋 forecast。

buildUnionSnapshot(map, lastForecast: VesselRecord[], capturedAtMs: number): Snapshot
  回傳 { capturedAtMs, berthing: [...map.values()], forecast: lastForecast }。
  注意:union 同時含 berthing+forecast 來源的船 → 放進 berthing 欄位當 join 池;
  forecast 欄位獨立保留最後一輪,供「即將進港」面板(語義正確,不堆疊過時預報)。
```

### 錄製器流程(`record-twport.ts`)

```
POLL_MS = (TWPORT_POLL_MIN env ?? 15) * 60_000
date    = 啟動當下 UTC 日期(算一次,整段寫同一檔)
outPath = snapshots/khh-<date>.json

union: Map<string, VesselRecord> = {}
重啟韌性:啟動時若 outPath 已存在,讀入其 berthing 灌進 union 當起點。

lastForecast = []   lastCapturedAtMs = 0

無限迴圈(指數退避,複用 fetchTwportSnapshot 的重試):
  try:
    capturedAtMs = Date.now()
    { berthing, forecast } = await fetchTwportSnapshot()      // 成功才往下
    upsertVessels(union, forecast)
    upsertVessels(union, berthing)                            // berthing 覆蓋 forecast
    lastForecast = forecast;  lastCapturedAtMs = capturedAtMs
    snap = buildUnionSnapshot(union, lastForecast, lastCapturedAtMs)
    原子寫入(snap)→ outPath                                 // 見下
    log("union N 艘, forecast M 艘")
    backoff = POLL_MS
  catch e:
    warn(e); backoff = min(backoff*2, 5min)                   // 失敗輪不覆寫:好檔保留
  sleep(backoff)
```

### 原子寫入

```
writeFileSync(outPath + '.tmp', JSON.stringify(snap, null, 2))
renameSync(outPath + '.tmp', outPath)
```

保證 `khh-<date>.json` 永遠是完整合法 JSON——每 N 分鐘覆寫一次、且結束時會被 SIGTERM 砍,原子 rename 避免 main.ts 讀到半截檔而 `JSON.parse` 爆掉。

### `run-ais-record.sh` 整合

於 probe 通過後、AIS 錄製**之前**,背景啟動 TWPort 錄製器,用**自己的 `timeout ${DURATION_SECONDS}s`** 自我限時:

```
SKIP_TWPORT (預設 0) / TWPORT_POLL_MIN (預設 15) 旋鈕
若未 SKIP_TWPORT:
  TWPORT_POLL_MIN=$TWPORT_POLL_MIN timeout ${DURATION_SECONDS}s "$VITE_NODE" record-twport.ts &
  TW_PID=$!
AIS 前景 timeout 錄製(既有)
AIS 結束 → 若有 TW_PID:wait "$TW_PID"(讓它自然限時收尾;原子寫入確保安全)
AIS export(既有)
完成訊息加印 TWPort snapshot 路徑 + 船數
```

`timeout` fallback 分支(無 coreutils)同理用背景 + sleep + kill 收 TWPort。

## 資料流

```
台灣機器:
  record-ais.ts   →(30s)→ ais-tracks/raw-khh-<date>.jsonl ─export→ ais-tracks/khh-<date>.json
  record-twport.ts→(15m)→ snapshots/khh-<date>.json(每輪原子覆寫,union)
        ↓ 兩檔一起 copy 回開發機
開發機 main.ts:
  讀最新 ais-tracks/khh-*.json(位置/航跡/時間軸)
  讀最新 snapshots/khh-*.json(join 字典 berthing∪ + 最後一輪 forecast)
  → joinTwport / categoryForTrack 補中文名/船型/船席;buildIncomingList 用 forecast
```

## 錯誤處理

- **抓取失敗**:指數退避(上限 5 分鐘),永不退出;失敗輪**不覆寫**既有好檔。
- **整段失敗**(零成功輪):outPath 若先前存在則維持原樣;若全新則不產生檔(main.ts 會 fallback 到既有 06-14 或報「run port:fetch」)。
- **空 visaNo / 全空鍵**:`unionKey` 回 null → 該筆跳過(無法識別,對 join 無用)。
- **SIGTERM 收尾**:`timeout` 送 SIGTERM;迴圈中斷,最後一次原子寫入的完整檔留存。
- **重啟**:載入既有 berthing 當 union 起點,不丟先前累積。

## 測試策略

純函式單元測試(`test/port-twport-aggregate.test.ts`):
- `unionKey`:fallback 鏈順序;全空回 null;欄位含空白會 trim。
- `upsertVessels`:去重(16 組重複 visaNo 應收斂)、latest-wins、forecast→berthing 順序使 berthing 勝、空鍵略過。
- `buildUnionSnapshot`:berthing = union 全值、forecast = 傳入的 lastForecast、capturedAtMs 正確帶出。
- 重啟模擬:把既有 snapshot.berthing 灌入 map 後再 upsert 新輪,總數正確合併。

網路迴圈、原子寫入、shell 整合不寫自動化測試(副作用層),以台灣機器實跑 + 目視 snapshot 船數驗證。

## 驗收標準

1. `npm run port:twport:record` 在台灣機器可單獨長跑,每 15 分鐘原子更新 `snapshots/khh-<date>.json`,union 船數隨時間單調增加(或持平)。
2. `npm run port:ais:auto` 一個指令並行跑 AIS + TWPort,同 `DURATION` 收尾,結束印出兩個產出檔路徑與船數。
3. 產出的 snapshot 套回開發機後,`main.ts` 零改動可讀;join 命中率不低於單點 snapshot(理想:整條時間軸都有中文名)。
4. 既有 `npm run port:fetch` 行為與輸出不變(重構後)。
5. `npm test` 全綠、`tsc --noEmit` 0 錯、`npm run build` 成功。

## 可調旋鈕一覽

| 變數 | 預設 | 作用 |
|---|---|---|
| `TWPORT_POLL_MIN` | `15` | TWPort 輪詢間隔(分鐘) |
| `SKIP_TWPORT` | `0` | `port:ais:auto` 中跳過 TWPort 並行錄製 |
| (沿用)`DURATION_HOURS` | `24` | AIS+TWPort 共用錄製時長 |

## 未定 / 後續

- 若日後要讓「即將進港」面板隨 AIS 時鐘連動(而非固定 capturedAtMs),需另案處理 forecast 的時間軸化——本案不做。
