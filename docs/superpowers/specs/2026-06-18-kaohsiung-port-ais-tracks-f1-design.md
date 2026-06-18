# F1 設計 — 真實 AIS 船位與航跡(高雄港數位孿生)

- **日期**:2026-06-18
- **子專案**:F1(承 handoff `docs/superpowers/2026-06-14-handoff.md`)
- **狀態**:設計定案、待 review → writing-plans
- **一句話**:用航港局 MPB 公開 AIS GeoJSON(免金鑰),以「本機輪詢累積 → 凍結 snapshot → 回放」取得**真實船位與航跡**,接管船位與回放時間軸,直接修掉現有「船在陸地上」(合成 `BERTH_LINE` 線性映射)的問題。

---

## 1. 動機與目標

現況(見 handoff 2026-06-18 節):船席 1–121 被線性映射到一條 8 點手描 `BERTH_LINE`,實測中位偏差 98m、最大 376m、約 43% 偏 >100m → 船會出現在陸地上。其餘所有圖層(海岸線/碼頭/儲槽/起重機/底圖)都走真實 OSM/NLSC 經緯度 + 同一 projection,確實對齊現實。

**F1 目標**:用真實 AIS 經緯度取代合成船位,並呈現船隻沿真實航跡的移動與淡出拖尾,讓回放時間軸成為**真實 AIS 時間**。

**非目標(F1 不做)**:碼頭編號標籤(F3)、線拖尾/InstancedMesh 船型(已否決,用點雲)、即時線上串流(用凍結 snapshot 回放)。

## 2. 資料來源決策

- **來源**:航港局 MPB 公開 AIS GeoJSON
  `https://mpbais.motcmpb.gov.tw/aismpb/tools/geojsonais.ashx`
- **免金鑰**;經實證需**台灣 IP**(非 TW 環境回 `totalFeatures:0`),且參考專案送 `User-Agent` / `Accept` / `Referer` headers。
- **形態 = 快照輪詢**(非串流):單次 GET 回傳當下全台海域船舶。要取得航跡 → 每 N 秒輪詢、按 MMSI 累積成 `path`。
- **取代 handoff 鎖定的 aisstream 方案**:aisstream 需金鑰、瀏覽器藏不住、要 24h 連續 websocket;MPB 端點皆免除,且與現有 `data/fetch-snapshot.ts`(HTTP GET TWPort)完全同模式。
- **參考實作**:`github.com/ianlkl11234s/gis-data-collectors`(`collectors/ship_ais.py`、`external/ship_ais_vm/ship_ais_collect.py`)+ `mini-taiwan-pulse`(`scripts/export/export-ship-data.py`、`src/data/shipLoader.ts`)。借鑑其欄位抽取、per-MMSI `path` 結構、GPS anomaly 過濾。

### ⚠️ Task 0:本機探針(硬性前置)
整個 F1 壓在此端點上,但設計階段在被地理封鎖環境只看到空結果。**第一個任務**必須在使用者(台灣)機器上:單跑一次 fetch、dump 原始 JSON、確認:
1. `totalFeatures > 0`、回傳真實船舶。
2. **實際 property 鍵名**(MMSI / 船名 / 船型 / 經緯度 / SOG / COG / heading / IMO / 呼號 / 定位時間)。
3. **時間欄位格式**(epoch? UTC+8 字串? ROC?)。
4. 是否需 bbox / 時間 query 參數。

探針結果回填進 parser;後續所有任務以此為前提。parser 寫成**容錯**:未知鍵記 warning,不崩。

## 3. 整體架構(三段解耦)

```
[1] 錄製器 standalone            [2] snapshot 檔               [3] app 回放
record-ais.ts  ──每30s──▶  raw-khh-<date>.jsonl              讀 tracks JSON
(本機/另一台機 24h)         (append-only)                    ↓
                                  │ export-ais-tracks.ts      依 AIS 時間軸插值真實船位
                                  ▼                           + 點雲淡尾(引擎零改動)
                            khh-<date>.json (app 讀)           + TWPort IMO/呼號 join 補靜態資料
```

三段彼此獨立:錄製器無 app/vite 依賴;app 讀到多長 snapshot 就回放多長(短窗驗證 → 之後換 24h 檔)。

## 4. 元件設計

### 4.1 純函式核心 `data/ais.ts`(全上單元測試)
- `parseAisFeature(feature) → AisPing`:容錯抽取 `{mmsi, lat, lon, sogKn, cogDeg, headingDeg, aisType, name, imo, callSign, loaM?, beamM?, recordedAtMs}`。
- `parseAisTime(raw) → number | null`:依 Task 0 確認的格式解析成 epoch ms(TW 政府常用 UTC+8,沿用 `parseTaipeiDate` 思路)。
- `inKaohsiungBBox(lat, lon) → boolean`:預設框 `lat 22.50–22.66, lon 120.24–120.40`(常數可調)。
- `aggregateTracks(pings[]) → AisTrack[]`:按 MMSI 聚合,點以 `recordedAtMs` 排序去重(**同一定位時間的點只留一筆** → 避免輪詢造成假密度)。
- `cleanTrack(track) → AisTrack`:丟 GPS 跳點(相鄰點隱含船速 >40kn)、丟無效 MMSI(`111111111` 等測試序)。**保留低速/靜止船**(不套參考專案的 `sog>0.5/≥5 點` 移動過濾 —— 靠泊船正是 F1 要顯示的)。

### 4.2 錄製器(Node,`vite-node`,standalone)
- `data/record-ais.ts`(`npm run port:ais:record`):
  - 韌性 poll loop,預設每 30s GET MPB 端點(帶 headers)。
  - 失敗指數退避重試、**永不退出**(設計給 24h / 跨夜)。
  - 每輪把 `{polledAtMs, pings: AisPing[]}`(已過 bbox)**append 一行**進 `data/ais-tracks/raw-khh-<date>.jsonl`。append-only → 中斷只丟最後未寫完那行。
  - 短窗驗證 = 同程式跑 30–60 分鐘即停。
  - 24h 模式 = 在另一台機器長跑;產出的 `.jsonl`/`.json` 手動 copy 回 `data/ais-tracks/`(無 app 依賴,乾淨)。
- `data/export-ais-tracks.ts`(`npm run port:ais:export`):
  - 讀 `.jsonl` → `aggregateTracks` → `cleanTrack` → 寫 `data/ais-tracks/khh-<date>.json`。
  - 輸出格式:
    ```
    { meta: { fromMs, toMs, count, bbox },
      ships: [ { mmsi, imo, callSign, name, aisType, loaM?, beamM?,
                 path: [[lat, lon, tMs], ...] } ] }
    ```

### 4.3 回放與時間模型 `time/ais-replay.ts`(純函式、可測)
- `positionAt(track, tMs) → {lat, lon, headingDeg} | null`:在 `path` 找夾住 `t` 的兩點**線性插值**(經緯度 + heading);`t` 在該船 path 範圍外 → `null`(該時刻不存在)。
- `trailPointsAt(track, tMs, windowMs) → [lat,lon,age01][]`:回傳 `t` 之前 `windowMs` 內的真實 path 點 + 各點老化比(供淡出);只對有移動的船產生非空拖尾。
- `vesselsInPortAt(tracks, tMs) → count`:該時刻落在 bbox 內的船數(供 KPI / 趨勢)。
- `incomingAt(tracks, tMs, windowMs) → AisTrack[]`:此刻在 bbox 外、但於 `windowMs` 內**進入** bbox 的船(啟發式進港判斷;語義較粗,記入誠實邊界)。

### 4.4 app 組裝(`main.ts` 改寫)
- 讀 `ais-tracks/*.json`(`import.meta.glob`,同 snapshot 模式)。
- 時間軸:`overlay.setTimeRange` / `setTrend` / scrubber 改吃 `meta.fromMs–meta.toMs`(取代 TWPort `nowMs±12h`)。
- **回放 ticker**:~10–15Hz 推進 `currentMs`、呼叫輕量 `updateShips(t)`;不在每個 rAF 全量重建。
- 渲染(**引擎零改動**):沿用 `shipPC`(PointCloud,bloom 群組1)。每 tick:對每艘 `positionAt` 有解的船,在插值位置用真實 heading 定向畫 footprint(取樣保持精簡);拖尾用 `trailPointsAt` 的稀疏真實點,以 `value`/brightness 沿尾端淡出(同一 PointCloud)。
- 退掉 `buildShipLayer` 的合成 `BERTH_LINE` 路徑;`berths.ts` / `buildShipLayer` **保留**(F3 可能用、既有測試不動)。
- KPI / 趨勢 / 進港:全部改由 §4.3 的 AIS 函式算(`vesselsInPortAt` / `incomingAt`),沿用現有 incoming 琥珀標記層與 overlay 介面。

### 4.5 TWPort 靜態 enrich `data/join.ts`(可測)
- `joinTwport(track, vessels[]) → VesselRecord | null`:用 **IMO(主)→ callSign(次)→ 船名(備援)** 配對。`VesselRecord` **無 mmsi 欄位**,故不以 mmsi join。
- 用途:補中文船名、船席、詳情卡;join 不到的 AIS 船以自身欄位顯示。
- **船型配色**:優先用 join 到的 TWPort `SHIP_TYPE_NAME` 走現有 `shipCategoryIndex`;join 不到才用 AIS 數字 type code 粗對映:`80–89→油品、70–79→散雜、60–69→客運、35→軍艦、30/31–32/50–59→工作、其餘→其他`(AIS type 無法分貨櫃/散雜/LNG,故 TWPort 優先)。

## 5. 誠實邊界(寫入 spec,延續原 spec §6「不做假動畫」)
1. 回放是**真實 AIS 取樣點之間的線性插值**,非逐秒原始軌跡 —— 插值發生在真實點之間,非捏造運動。
2. AIS type code 對映粗略(無法分貨櫃/散雜/LNG),故優先採 TWPort 真實船型。
3. MPB 端點需台灣 IP;非 TW 環境回空資料(已知限制)。
4. 短窗 snapshot 時間軸短、船數少,屬預期;24h 檔由獨立機器產生後替換。
5. 「進港(incoming)」為 bbox 進入啟發式判斷,非官方進港報告,語義較粗。

## 6. 測試與品質門檻
- **單元測試**(node,沿用專案慣例):`ais.ts`(parse / 時間 / bbox / 聚合去重 / 清洗 / anomaly / 保留靜止船)、`ais-replay.ts`(插值 / 端點 null / 拖尾窗 / in-port 計數 / incoming)、`join.ts`(IMO→呼號→船名 配對與 miss)。
- **不破既有**:`tsc --noEmit` 0、`npm run build` ok、既有 120 綠不退。
- **目視驗證**(`npm run dev` + 瀏覽器):船在水面(非陸地)、沿真實航跡移動、拖尾淡出、scrub 連動、KPI/趨勢隨 AIS 變動、點船出(join 到的)中文詳情卡。

## 7. 風險與緩解
| 風險 | 緩解 |
|---|---|
| 端點欄位/參數/時間格式未實證 | Task 0 本機探針為硬性前置;parser 容錯 |
| 端點地理封鎖 / 暫時無資料 | 需 TW IP;探針先確認;錄製器重試不退出 |
| 逐幀重建效能 | 回放 tick ~10–15Hz、footprint 取樣精簡、拖尾用稀疏真實點 |
| 停泊船被誤刪 | 清洗只丟垃圾/跳點,保留低速船 |
| TWPort join 命中率低(IMO 空白) | 多級 fallback;miss 時用 AIS 欄位,不阻斷顯示 |
| 24h 檔搬運 | 錄製器無 app 依賴,手動 copy 回 data/ |

## 8. 交付物清單
- `data/ais.ts`(+ 測試)、`data/record-ais.ts`、`data/export-ais-tracks.ts`
- `time/ais-replay.ts`(+ 測試)、`data/join.ts`(+ 測試)
- `main.ts` 改寫(時間軸/回放 ticker/渲染/KPI 來源)
- `package.json`:`port:ais:record`、`port:ais:export` scripts
- `data/ais-tracks/`:raw `.jsonl` **gitignore**(可能很大);export `khh-<date>.json` **commit**(短窗檔小,app 須有真實資料可繪,同既有 snapshot 慣例)
- handoff 更新

## 9. 沿用的既有決策(不重議)
- 配色階層(進港 > 船 > 地標 > 結構)、bloom 4 群組 —— 不動。
- 同一 projection(`createProjection` + `KAOHSIUNG_ORIGIN` + `WORLD_SCALE`)—— AIS 經緯度走此投影即與 OSM/底圖對齊。
- 點雲美學、`sizeAttenuation:false` + 明確 pointSize。
