# 高雄港 LiDAR 數位孿生 — 設計文件

- **日期**:2026-06-14
- **狀態**:設計已確認,待寫實作計畫
- **目標**:用既有的 `lidar-engine`(Scanner Sombre 風格點雲引擎)做一個**可環繞的偽 3D / 2.5D 高雄港船舶停靠數位孿生**,以真實 OSM 港形與真實 TWPort 船舶停靠資料,呈現「常駐點雲 + 顏色表達狀態」的戰情畫面,並支援未來 24 小時時間軸沙盤推演。
- **範圍邊界**:本 spec **只涵蓋「港口停靠視覺化」這一塊**(對應航港盃報告主軸二「多目標泊位排程與沙盤推演」的視覺呈現)。報告中的碳權代幣、LLM+RAG 政策報告、ConvLSTM 氣象、疫情預警、PPO 排程引擎**不在本 spec 範圍**,各自應另立 spec。

---

## 1. 背景與動機

本團隊參加交通部航港局第 6 屆航港大數據創意應用競賽。報告提出「2.5D 數位孿生沙盤推演」,但刻意避開 3D 的龐大算力。本 repo 既有一個可重用的 LiDAR 點雲掃描引擎(見 [2026-06-13-lidar-scan-engine-design.md](2026-06-13-lidar-scan-engine-design.md)),其「黑底 + 累積彩色點 + 深度色階」美學辨識度高,且市面智慧港口數位孿生(鹿特丹、新加坡 MPA、漢堡、Corpus Christi 等)**沒有人用點雲 LiDAR 風格**呈現港口 —— 這是差異化切入點。

本設計把該引擎從「第一人稱掃描洞穴」retarget 成「俯瞰環繞的港口孿生」,realism 來自**真經緯度、真港形、真停靠資料**,而非地圖貼圖。

## 2. 六個已確認決策

| # | 決策 | 選擇 | 影響 |
|---|---|---|---|
| 1 | 互動模式 | **常駐點雲**(港口一直可見,顏色直接表達狀態) | 引擎需 per-point 狀態色 |
| 2 | 資料來源 | **真實佈局 + 真實船舶資料**(OSM + TWPort 開放資料) | 需地理投影 + 資料管線 |
| 3 | 視角 | **可環繞俯瞰 orbit**(拖曳旋轉、滾輪縮放) | 引擎需 orbit 相機 |
| 4 | 時間軸 | **即時快照 + 完整 24h 時間軸沙盤** | 需時序佔用模型 + 時間軸 UI |
| 5 | 技術路線 | **自研引擎當渲染器 + 「地理真實」資料管線**(借路線 C 的真實性,不用 deck.gl) | 真投影/真座標/真尺度 |
| 6 | 背景 | **B 海岸線點雲輪廓(預設)+ C 真實地圖底圖(可切換)** | C 為場景內貼圖地面平面 |

## 3. 真實資料來源(已實測可取得)

### 3.1 港區幾何 → OpenStreetMap Overpass API(免金鑰)
- 端點:`https://overpass-api.de/api/interpreter`
- 對高雄港 bbox `(22.53,120.24,22.64,120.34)` 查 `man_made=pier`、`seamark:type=harbour`。
- 實測取得:**54 條碼頭線 + 6 個港灣**(含新光碼頭、旗津、紅毛港),帶真實經緯度。
- 限制:OSM **無商港編號泊位**(`#22碼頭`),僅有實體碼頭線/海岸線。

### 3.2 船舶停靠資料 → 港務公司 TWPort 開放資料(免金鑰,官方)
- 端點:`https://tpnet.twport.com.tw/IFAWeb/Reports/OpenData/GetOpenData?port=KHH&type=N`(BIG5 XML)
- 採用:
  - **type=1「當日船席指泊明細表」**= 今日真實停靠(實測 67 艘,**40 艘在編號碼頭** #1–#116,其餘港外/錨地)。
  - **type=5「進港預報次序」**= 未來進港(實測 51 艘,含 ETA + 指定碼頭)。
- 每筆欄位:`VESSEL_CNAME / VESSEL_ENAME`(船名)、`SHIP_TYPE_NAME`(船型,16 類)、`WHARF_NAME / WHARF_CODE`(碼頭,如 `#108碼頭` / `KHHX108X`)、`ACT_PORT_DT / ETA_DT / ETD_DT / LEAVE_DT`(時序)、`BEFORE_PORT / NEXT_PORT`(航跡)、`IMO / CALL_SIGN`(識別)。
- 2026-06-14 實測船型分布(供配色參考):全貨櫃 17、雜貨 11、散裝 7、工作船 14、油/油化 6、軍艦 2、半貨櫃/客貨/LNG/液化氣/水泥/駛上駛下 各 1–3。
- 附帶價值:`BEFORE_PORT → NEXT_PORT` 可供未來「疫情航跡追溯」模組重用。

### 3.3 唯一缺口:碼頭編號 → 座標
TWPort 有「編號 + 船」、OSM 有「碼頭幾何」,但無對照。解法見 §5.2(一次性建 `berths.json`)。

## 4. 範圍

**本次要做(MVP):**
- 引擎兩項加法擴充:直接灌點 + per-point 狀態色;orbit 相機。
- 高雄港 app:地理投影、TWPort/OSM 解析、碼頭座標表、點雲採樣、24h 時序佔用模型、時間軸、HTML 疊層(圖例/KPI/詳情卡/篩選/底圖開關/檢視切換)。
- 「進港滑入」小成本 eye-candy 動畫。
- B 海岸線點雲(預設)+ C 地圖底圖(可切換)。

**本次不做(YAGNI / 後續):**
- 真實 AIS 連續航跡(需 aisstream 免費金鑰)→ 後續。
- 報告其他四模組(碳權、RAG 報告、氣象、疫情、PPO 排程演算法本身)。
- 公分級碼頭測量精度;3D 寫實建模;VR;WebGPU。

## 5. 架構

### 5.1 核心原則
`lidar-engine` 維持為**通用引擎**(不綁高雄港);高雄港孿生是**新消費端 app**(`examples/kaohsiung-port/`)。引擎僅兩項加法擴充,洞穴 demo 與既有測試不受影響。

### 5.2 引擎擴充(加法,不破壞既有)

**① 直接灌點 + per-point 狀態值**
- 新增直接灌點 API(如 `pointCloud.addPoints(positions, values)`),把採樣好的點直接推進緩衝,**不經 emitter/raycaster**。
- 每點新增 `aValue` 屬性 + 顏色模式 uniform:`distance`(現狀,預設)或 `value`(查狀態/類別 LUT)。
- 觸及:[src/core/types.ts](../../../src/core/types.ts)、[src/core/PointCloud.ts](../../../src/core/PointCloud.ts)、[src/shaders/points.vert.glsl](../../../src/shaders/points.vert.glsl)、[src/shaders/points.frag.glsl](../../../src/shaders/points.frag.glsl)、[src/core/LidarEngine.ts](../../../src/core/LidarEngine.ts)。
- 點大小改為可設定/隨縮放調整(現夾在 1–5px,港口拉遠太稀)。

**② Orbit 相機模式**
- 「繞中心 orbit」:拖曳旋轉、滾輪縮放、平移。用 three 內建 `OrbitControls`(**不增依賴**),以 `cameraMode: 'orbit' | 'lookAround'` 切換,預設仍 `lookAround` 保留原 demo。
- 觸及:[src/core/LidarEngine.ts](../../../src/core/LidarEngine.ts) 的 `look()` / 相機建立。

### 5.3 新 app 模組(`examples/kaohsiung-port/`,單一職責、可獨立測)

| 模組 | 職責 | 依賴 |
|---|---|---|
| `geo/projection` | 經緯度 → 高雄原點本地公尺 → 世界座標(純函式) | 無 |
| `data/twport` | 解析 TWPort BIG5 XML(type=1/5)→ 正規化船舶記錄 | projection |
| `data/osm` | 解析 OSM 幾何 → 世界座標折線 | projection |
| `berths` | `#1–#121 → 座標` 表(一次性建)+ `WHARF_NAME → 泊位` 對應 | osm/projection |
| `scene/portPoints` | 海岸線/碼頭/船體採樣成帶類別值的點;時間改變只重建船點 | engine, berths |
| `time/occupancy` | 由 ETA/ETD/預報建 `occupancyAt(t)` 時序模型 | data |
| `ui/overlay` | HTML 疊層:圖例、KPI、時間軸、詳情卡、底圖開關、篩選 | 全部 |
| `app` | 組裝 + render loop 掛勾 | 全部 |

### 5.4 資料流
`TWPort 快照 + OSM 幾何 →(geo 投影)→ 真座標折線 + 泊位表 →(occupancy 時序模型)→ 某時刻佔用 →(portPoints 採樣)→ 帶狀態值的點 →(引擎 value 模式 + orbit)→ 畫面;UI 疊層提供圖例/時間軸/詳情`

## 6. 資料管線與時序模型

### 6.1 取得與轉檔(建置期,非瀏覽器即時)
TWPort 為 BIG5 且跨域多被 CORS 擋 → **Node 腳本建置期抓 → 轉 UTF-8 → 正規化 JSON**,app 靜態載入(順帶滿足「凍結快照」可重現)。
- 產物:`data/snapshots/khh-YYYY-MM-DD.json`(canonical demo 資料);`--live` 旗標可重抓。
- 日期 `M/D/YYYY h:mm:ss AM/PM` → epoch;**一律 Asia/Taipei 時區**。

### 6.2 碼頭座標表(唯一手工建一次的資產)
建 `berths.json`:`碼頭號 → {lat, lon, 走向}`。沿 OSM 東岸碼頭折線,錨定已知點(#1 蓬萊、中島貨櫃 #30–70、前鎮 #70s、小港/洲際 #100–121),其餘**依弧長內插**。非編號泊位(港外/錨地/防波堤外)對應到港外錨地群集座標。

### 6.3 時序佔用模型
- 佔用區間 = `[抵達, 離開)`:過去用實際(`ACT_PORT_DT`→`LEAVE_DT`),未來用預報(`ETA_DT`→`ETD_DT`)。
- `occupancyAt(t)`:每泊位找區間含 t 的船。
- 泊位狀態色:**紅=佔用 / 綠=空 / 琥珀=即將進港(預設 2 小時內,可設定)**。
- 時間軸以「現在」分隔:左過去(實際)、右未來(預報虛線),可 scrub、可播放。

## 7. 渲染與互動

### 7.1 渲染
- **採樣成點**:海岸線/碼頭折線沿線取點、陸地邊緣淺填;船體依**真實尺寸(LOA×船寬,由船型推估 — 查「船型→典型尺寸」對照表)**填成點塊。
- **兩層點雲**:靜態底層(海岸線+碼頭,建一次)+ 動態船層(scrub 時 `clear()`+`addPoints()` 重建)。
- **配色(value 模式 LUT)**:泊位狀態 紅/綠/琥珀;船舶依船型(貨櫃=藍、油/化=橙、散裝/雜貨=土黃、LNG/液化氣=紫、工作/巡護=灰、軍艦=綠、客貨=青);陸地暗青灰、水極淡藍。**檢視可在「狀態 ↔ 船型」切換**(預設:泊位看狀態、船看船型)。
- **Orbit**:目標=港口中心,預設俯角 ~50°,限制縮放;閒置可緩慢自轉。
- **背景開關**:預設 B 海岸線點雲;C 模式在場景放**貼真實地圖紋理的地面平面**(隨 orbit 一起轉,投影對齊),失敗則退回 B。

### 7.2 互動 / UI 疊層(HTML)
- **版面**:上=標題+KPI(在港船數、泊位佔用 X/Y、各船型計數、日期);左=泊位狀態圖例+船型篩選+搜尋;右=點船後詳情卡(船名/船型/泊位/ETA·ETD/前一港→下一港/IMO);右下=底圖&檢視切換;底=24h 時間軸。
- **挑選**:每艘船記 `worldPos`,每幀投影螢幕;點擊取最近船心 → 詳情卡(不需逐點 picking)。
- **標籤**:碼頭號/船名僅 hover/選中時顯示;放大到一定程度才顯示碼頭號刻度。

## 8. 錯誤處理(原則:執行期不依賴外部即時端點)
- app 一律讀凍結 JSON;建置期抓取失敗 → 沿用上一份快照。
- 髒資料:無法解析 `WHARF_NAME` → 歸港外/錨地群、計數記錄不崩;缺 ETA/ETD → 用現有時間,全缺標「在港·離港未知」;查無碼頭 → 退備援座標 + log。
- BIG5 壞字元 replace 續跑;空資料 → 只畫底層 + 「無資料」狀態。
- C 底圖載入失敗 → 靜默退回 B;無 WebGL2 → 引擎既有明確報錯;`resize` 更新相機/尺寸;`dispose()` 釋放緩衝/OrbitControls/監聽。

## 9. 效能預算(目標 60fps)
- 點數:靜態底層 ~100–200k;動態船層 ~20–40k。遠低於 50 萬預算。
- 兩個 `THREE.Points`:底層上傳一次;船層只在「佔用真的改變」時重建(diff,非每幀)。
- 播放以模擬分鐘步進、變動才重建;挑選只投影 ~40 船心;C 底圖單一貼圖平面。
- 記憶體:~200k 點 ×(pos3+value1)float ≈ 數 MB;重用 typed array 避免每幀配置。

## 10. 測試策略(沿用 repo:純邏輯 TDD、渲染煙霧測)
- **純邏輯單元(TDD)**:`projection`(經緯度↔公尺、已知點、比例);`twport` 解析(BIG5 fixture→記錄、AM/PM、`#22碼頭`→22、港外判定、缺欄);`occupancy`(邊界時刻正確、狀態判定、clamp);`berths`(碼頭→座標、未知退備援)。
- **引擎加法**:`addPoints`+`aValue`(點/值入緩衝、draw range、value LUT 取色 — 擴充既有 PointCloud/ramp 測試);orbit boot 煙霧 + clamp 數學。
- **渲染煙霧**:app headless 啟動不丟錯;Playwright 對 app 截圖 + 驗 canvas 有渲染、console 無錯。
- **快照 schema 驗證**:凍結 JSON 結構檢查。
- **回歸**:洞穴 demo 與既有測試保持綠燈(引擎改動全為加法)。

## 11. 誠實邊界與風險
1. **這是「泊位佔用隨時間變化」,不是 AIS 連續航跡動畫。** TWPort 只給泊位+離散時間,無逐秒經緯度。船在區間內出現於泊位、區間外消失;「進港滑入」為純動畫非真軌跡。真航跡需另接 aisstream(後續)。
2. **碼頭座標為描圖內插的近似**(地理順序對、絕對位置非測量級);對點雲視覺無感,但不宜宣稱公分級。
3. **TWPort 為當日資料,每天變動**;故以凍結快照為 canonical demo 集,確保展示與評審重跑一致。
4. **C 地圖底圖需圖磚來源**(Mapbox token 或離線圖磚);無則僅 B 模式可用(不影響 MVP 主體)。
5. 研究中多數港口孿生渲染技術未公開、泊位顏色為業界慣例非標準 —— 本案配色採通用慣例並以圖例標明。

## 12. 階段建議
- **Phase 1(MVP)**:引擎兩項擴充 + app 全模組 + 即時快照常駐點雲 + orbit + 24h 時間軸 + UI 疊層 + B/C 背景切換(C 用離線地圖圖,免 token)。
- **Phase 2(加分)**:進港滑入動畫打磨、放大顯示碼頭號刻度、C 改用線上 Mapbox 高解析底圖。
- **Phase 3(後續)**:真實 AIS 航跡(aisstream)、串接報告其他模組(疫情航跡用 BEFORE/NEXT_PORT)。

## 13. 參考
- 引擎設計:[2026-06-13-lidar-scan-engine-design.md](2026-06-13-lidar-scan-engine-design.md)
- 資料:OSM Overpass API;TWPort 開放資料(data.gov.tw dataset 16826/16831/8157;`tpnet.twport.com.tw` OpenData 端點)。
- 參照案例:Port of Corpus Christi OPTICS(Unity 即時 AIS 3D 港);deck.gl PointCloudLayer/TripsLayer(點雲+航跡技術參照);Radiohead "House of Cards"(深度著色點雲美學源頭)。
