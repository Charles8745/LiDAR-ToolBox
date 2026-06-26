# 設計:高雄港 AIS 非船舶雜訊過濾 + 船型分類擴充

- **日期**:2026-06-26
- **狀態**:設計定案,待寫實作計畫
- **前置調查**:見本文件「背景」一節(已完成資料勘查 + 三線索方法 + web 權威查證)

## 目標(一句話)

把高雄港 AIS 資料裡**約 20% 根本不是船**的目標(助航浮標 / 漁網示標 / 手持機 / 損壞訊號)在**資料管線(export)階段濾掉**,並把被現有分類邏輯**誤丟進「其他」的真船**導回正確類別、新增「遊艇」「工程」2 個類別。結果:畫面只剩真船、「在港船數」KPI 變誠實、配色階層更精確。

## 背景:為什麼要做(已查證)

對 commit 的 24h 真實資料 `data/ais-tracks/khh-2026-06-19.json`(551 個 AIS 目標)做分類勘查,發現「其他」類別佔 **202 艘(36.7%)**,是第二大類。逐一拆解後:

| 「其他」202 的組成 | 數量 | 判定 |
|---|---|---|
| AtoN 助航浮標(MMSI `99x`) | 69 | ❌ 非船 |
| 漁網/示位浮標(名稱含 `BUOY`/`NET`/結尾電量%) | 29 | ❌ 非船 |
| 手持 VHF / SART(MMSI `8x`/`97x`) | 2 | ❌ 非船 |
| 異常 MMSI(非正規船舶格式) | 3 | ❌ 雜訊 |
| 損壞船名(亂碼 + 非法 AIS 碼 >99) | 7 | ❌ 雜訊 |
| 遊艇/帆船(AIS code 36/37) | 15 | ✅ 真船(誤歸其他) |
| 挖泥/水下作業(code 33/34) | 5 | ✅ 真船(誤歸其他) |
| 其他類型(code 90-99) | 24 | ✅ 真船(保守保留) |
| 真未知(code 0 名正常) | 38 | ✅ 真船(保守保留) |
| 雜項(分類表漏列的拖船等) | 10 | ✅ 真船(誤歸其他) |

**全 551 目標中,約 110 個(20%)是非船 / 雜訊**,目前全被畫成灰色船舶 footprint,並被 KPI `vesselsInPortAt` 灌進「在港船數」。

> **注意(self-review 校正)**:上表是「**目標本質**」分類(逐目標歸一類,優先序 MMSI→名稱),非過濾器逐條規則的丟棄數。以 §架構A 的規則**實跑** `khh-2026-06-19.json` 的權威結果為:**丟棄 108、保留 443、誤殺 0**(台灣正規 MMSI + 正常船名者無一被丟);逐規則:AtoN 69 / 手持·SART **15** / 異常MMSI **7** / 浮標名 **13** / 亂碼損壞 **4**。逐規則數與上表本質分類數因評估順序不同而異(例:`8x`-MMSI 又取浮標名的目標,規則歸「手持」、本質表歸「浮標」),涵蓋同一組目標。實作以規則實跑數為準。

### 分辨方法(三條獨立線索互相驗證)

1. **MMSI 前綴(ITU-R M.585,最硬)**:`99xxxxxxx`=AIS 助航設施(AtoN);`8xxxxxxxx`=手持 VHF;`970/972/974`=SART/MOB/EPIRB;正規船舶台=首碼 2–7 的 9 碼。船無法竄改前綴語意。
2. **AIS 類型碼(ITU-R M.1371)**:`0`=未填(default)、`33`=挖泥/水下、`36`=帆船、`37`=遊艇、`52`=拖船、`90-99`=其他類型、`>99`=非法(訊號損壞)。
3. **船名樣式**:漁網 AIS 示標的命名慣例 —— `BUOY…`、`…NET…`、同基號+流水號+尾數電量%(如 `5897-07-93%`)。用來抓「用合法 MMSI 偽裝的網標」。

### Web 權威查證結論

- ✅ 線索 1、2:ITU-R M.585 / M.1371 官方文件 + VT Explorer / NOAA / MarineTraffic 對照表**直接證實**,可直接作為過濾規則。
- ✅ 線索 3:漁網 AIS 示標為**真實量產設備**(每分鐘發射);「過濾浮標/漁網雜訊」是**業界與學界標準做法**(美國專利 US 10,330,794 明文 "remove noisy data, such as buoys or fishing nets with AIS signals");台灣近海 feed(航港局 MPB,本專案資料源)漁船密度高、此現象尤盛。
- ⚠️ 唯一推論:「船名結尾 `-NN%` = 電量」無官方命名規範文件,是從資料樣式 + 設備電池概念推得;但「這些是漁網標」結論有強旁證。故名稱類規則信心列為「高」而非「極高」,且**只丟有把握者**。

來源:ITU-R M.585-9、ITU-R M.1371、[VT Explorer AIS types](https://api.vtexplorer.com/docs/ref-aistypes.html)、[NOAA VesselTypeCodes2018](https://coast.noaa.gov/data/marinecadastre/ais/VesselTypeCodes2018.pdf)、USPTO US10330794、[CSIS gray-zone analysis](https://www.csis.org/analysis/signals-swarm-data-behind-chinas-maritime-gray-zone-campaign-near-taiwan)。

## 決策(brainstorm 已拍板)

1. **非船目標 → 完全濾掉**(不畫、不算 KPI)。本質是雜訊;戰情室主角是船。
2. **過濾發生在 export 階段**(改資料管線本身),純函式分類器置於 `data/ais.ts`,現有 commit 檔以一次性 re-filter 重洗。執行期 `main.ts` 零改動。
3. **修分類表破洞 + 新增 2 類別**(遊艇、工程)。**不加** 90-99「特殊作業」類(異質性高、語意弱)。
4. **本 spec 只做資料/分類清理**;3D 模型(含新類別)**延到下個 session**,照 `docs/vscode-dev-guide.md` §4k 逐類補,缺模型自動 fallback 平面。

## 架構與元件

### A. 純函式分類器 — `data/ais.ts`

新增 `isVessel(track: AisTrack): boolean`(內部用具名 predicate 組合,並可回傳原因供記錄)。**任一規則命中 → 非船,回傳 false**:

| 規則(predicate) | 條件 | 信心 |
|---|---|---|
| `isAtoN` | MMSI `^99\d{7}$` | 極高 |
| `isHandheldOrSart` | MMSI `^8\d{8}$` 或 `^97[024]\d{6}$` | 高 |
| `isSarAircraft` | MMSI `^111\d{6}$` | 高 |
| `isAnomalousMmsi` | MMSI **非** `^[2-7]\d{8}$` 且未被上列匹配 | 中 |
| `looksLikeBuoyName` | 名稱含 `BUOY`、`NET`,或結尾 `--?\d{1,2}%` | 高 |
| `isGarbled` | AIS 類型碼 `>99`(非法)**且**船名含 ≥2 個非英數/非中日韓字元 | 高 |

設計要點:
- 各 predicate 獨立、可單測;`isVessel` = 「以上皆不命中」。
- **不靜默丟棄**:提供 `classifyAisTarget(track)` 回傳 `{ vessel, reason }`;export/refilter 彙總列印「丟棄 N 個,依原因明細」,並寫入檔案 `meta.droppedNonVessel`。
- **保守**:信心「中」的(`isAnomalousMmsi`)與名稱類仍丟,但僅限明確命中;code 90-99 純數字疑似標**不在規則內** → 保留為「其他」。台灣船 MMSI(416…)首碼 4 落在 `[2-7]`,不誤殺。

### B. 套用點 — export + 一次性 re-bake

- `buildTracksFile(pings)`(`data/ais.ts`):聚合 + 清洗後,**以 `isVessel` 過濾 tracks**,並把丟棄統計寫進 `meta`。未來每次 `port:ais:export` 自動乾淨。
- 新 CLI `data/refilter-tracks.ts` + npm script `port:ais:refilter`:讀既有 `khh-*.json` → 以 `isVessel` 過濾 `ships[]` → 重算 `meta`(含 `droppedNonVessel`)→ 原子覆寫。**冪等**(對已乾淨檔再跑 = no-op,丟棄 0)。用於洗 commit 的 `khh-2026-06-19.json`(不需 raw `.jsonl`)。

### C. 分類擴充 — `palette.ts`、`data/ais.ts`、`scene/portPoints.ts`

- `SHIP_CATEGORIES`:`[..., '客運', '遊艇', '工程', '其他']`(在「其他」前插入,其他維持最後=兜底)。8 → 10。
- `SHIP_CATEGORY_COLORS`(與類別順序對齊,index 相依):新增 遊艇=`[235,205,95]`(暖黃)、工程=`[160,175,95]`(橄欖)。**起始值,瀏覽器目視微調**;須維持「船=均衡分類色、只避紅」階層。
- `TYPE_TO_CATEGORY` 補漏列官方船型名 —— **已對 snapshot 全掃,實際漏列 12 種**(self-review 校正,取代原 6 種估計):

  | 官方船型名(精確字串) | 出現次數 | → 類別 |
  |---|---|---|
  | `拖船` | 7 | 工作 |
  | `多用途工作船` | 4 | 工作 |
  | `工作平台船` | 2 | 工作 |
  | `運輸補給船` | 2 | 工作 |
  | `拖船兼消防` | 1 | 工作 |
  | `起重船` | 1 | 工作 |
  | `漁船` | 1 | 工作 |
  | `運輸駁船` | 2 | 散雜 |
  | `多用途船` | 1 | 散雜 |
  | `化學液體船` | 2 | 油品 |
  | `油駁船` | 1 | 油品 |
  | `貨櫃輪(有導槽)` | 1 | 貨櫃 |

  注:`貨櫃輪(有導槽)` 用**全形括號**(8 字元),需逐字比對。實作時再對最新 snapshot 掃一次以防新漏列。
- `mapAisTypeToCategory` 補:`33,34 → 工程`、`36,37 → 遊艇`(其餘維持;`90-99`、`0`、非法碼仍 → 其他)。
- `scene/portPoints.ts` `TYPE_DIMS_M`:加 遊艇 `{loa:30,beam:8}`、工程 `{loa:90,beam:20}`(平面 footprint fallback 尺寸)。

### D. 自動跟上(本設計刻意零改動)

- **UI 船型篩選**:`ui/overlay.ts:127` 從 `SHIP_CATEGORIES` 迴圈生成 checkbox + 彩色點 → 自動多 2 列。
- **執行期 filter Set**:`main.ts:267` `new Set(SHIP_CATEGORIES)` → 自動含新類別。
- **KPI**:`time/ais-replay.ts` `vesselsInPortAt` 數 bbox 內 tracks;資料層已濾非船 → **自動變誠實**(數字降約 20%)。無需改 KPI 程式。
- **3D 模型**:`scene/shipModels.ts` 對缺模型類別回傳平面 fallback → 新類別自動走平面,不需改。

## 資料流

```
新錄製:record-ais → export(buildTracksFile 套 isVessel 過濾) → 乾淨 khh-*.json
現有檔:port:ais:refilter(tracks→tracks,套 isVessel) → 洗淨 khh-2026-06-19.json(commit)
執行期:main.ts 讀乾淨檔 → categoryForTrack 回 遊艇/工程/正確類 → palette 上色 → UI 自動篩選 → KPI 只算真船
```

## 測試

- `isVessel` / `classifyAisTarget`:每條 predicate 命中與不命中、邊界(台灣 416 真船不誤殺、99x 浮標必丟、`5897-07-93%` 網標必丟、亂碼+非法碼必丟、正常 code-0 真船保留)。
- 新增 mapping:`mapAisTypeToCategory(33/34)=工程`、`(36/37)=遊艇`;`TYPE_TO_CATEGORY` 新增鍵。
- `refilter` 冪等:乾淨檔再跑丟棄 0、ships 數不變。
- 既有測試維持綠(目前 209)。

## 收尾

- 對 `khh-2026-06-19.json` 跑 `port:ais:refilter` 並 commit 洗淨檔(**實跑驗證:551 → 443 艘**,丟 108)。
- 瀏覽器目視驗證:畫面無灰色浮標群、新增遊艇/工程 checkbox 與彩色點、KPI 在港數下降且合理、點擊新類別船詳情正確。
- 更新 `docs/vscode-dev-guide.md`:分類規則 + `port:ais:refilter` 用法 + 新類別。
- 更新 handoff `docs/superpowers/2026-06-14-handoff.md`:本清理完成;**遊艇/工程 3D 模型延下個 session**(§4k)。

## 範圍邊界(明確不做)

- 不做任何 3D 模型(含新類別)。
- 不碰引擎 `src/`。
- 不新增 90-99「特殊作業」類別;24 個疑似網標(code90-99 數字名)保守保留為「其他」。
- 不動相機 / 其餘視覺。
- 不重新錄製 AIS(raw 在台灣機器);只重洗既有聚合檔。

## 風險與緩解

- **名稱類規則誤殺真船**:風險低(「電量%結尾 / BUOY / NET」樣式特異),且 export/refilter **列印丟棄明細**可稽核;若日後發現誤殺,調該 predicate 即可(單一事實來源)。
- **配色撞色 / 階層失衡**:新 2 色為起始值,瀏覽器目視微調;維持避紅、結構灰退背景的既定階層。
- **類別 index 漂移**:`SHIP_CATEGORY_COLORS`、`TYPE_DIMS_M` 與 `SHIP_CATEGORIES` 順序相依 → 測試覆蓋 index 對齊;新類別插在「其他」前,既有 7 類 index 不變。
