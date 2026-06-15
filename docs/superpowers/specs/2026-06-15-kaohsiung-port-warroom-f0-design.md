# 高雄港數位孿生 — F0 戰情室視覺基礎 · 設計文件

- **日期**:2026-06-15
- **狀態**:設計已確認,待寫實作計畫
- **目標**:把高雄港孿生從「會動的點雲」升級為一個**暗色指揮中心(IOC 戰情室)大屏** —— 3D 場景做 selective bloom + fog 發光升級,HUD 用 **Liquid Glass Kit** 重建成資料密集的玻璃指揮介面。
- **範圍邊界**:本 spec 是「類數位孿生 3D UI 展示」四條工作流中的 **F0(戰情室視覺基礎)**。其餘三條 —— F2 衛星/航照底圖(✅ 已完成)、F3 碼頭編號標籤、F1 真實 AIS 航跡 —— 各自另立 spec,不在本文件範圍。
- **核心原則**:**只做視覺升級,不碰資料、不造假**。所有面板數字(在港數、佔用率、24h 趨勢、即將進港)皆由現有 `intervals` 真實算出。

---

## 1. 背景與動機

現有孿生(F1 MVP + F2 航照底圖)已具備:常駐點雲、依船型上色、orbit、24h 時間軸、真實航照底圖、純 DOM overlay(`ui/overlay.ts` 的 `.panel` 內嵌樣式)。但兩個缺口讓它還不像「戰情室」:

1. **3D 場景平**:點雲不發光、無景深霧、底圖染藍但整體缺乏「大屏」的視覺層次。
2. **HUD 陽春**:overlay 是手寫深色方塊,資訊密度低,沒有指揮中心的儀表感。

研究(2026-06-15)結論:海委會 3DMap(ArcGIS 日間 GIS)與高港船席圖(Leaflet 2D)**都不是暗色戰情室大屏** —— 這正是本專案的差異點。F0 就是把這個差異點做出來。

使用者另外指定:HUD 採用其桌面 `UI-ToolBox` 的 **Liquid Glass Kit**(零依賴液態玻璃 UI 工具包),並借用 `UI_Pompt範例` 中 prompt 的結構紀律來建構;**不用背景影片**(3D 場景本身即視覺底層)。

## 2. 已確認決策

| # | 決策 | 選擇 | 理由 |
|---|---|---|---|
| 1 | 版面 | **B · 指揮中心框架**(3D 居中、左右常駐玻璃側欄) | 最貼合 IOC 戰情大屏、發揮 Kit 儀表元件,又不像「三分割」犧牲 3D 面積 |
| 2 | HUD 技術棧 | **純 TS + Liquid Glass Kit**(借範例 prompt 結構,不引入 React/Tailwind) | 不在純 TS 專案硬塞框架;Kit 本身即零依賴原生 class |
| 3 | 配色 | **中性炭灰 / Ink Wash**(銀鉻 UI、飽和度全留給船色) | 使用者從 Figma 色彩庫四組非藍方向中選定;中性底讓 bloom 後的船色最跳 |
| 4 | 3D 發光 | **selective bloom(只船+進港標記)+ fog** | 船是主角;海岸線/碼頭/底圖當暗 context |
| 5 | Water/Sky | **不做** Three.js Water/Sky,改暗色漸層背景 + fog | 底圖已是真實航照(含水域),動態水面會打架;Sky 日光不合暗房 |
| 6 | 引擎整合 | **引擎內建可選 post-processing**(預設關,加法) | 可重用、main.ts 乾淨、洞穴 demo 不受影響;`addLayer(obj,{bloom:true})` 標記發光層 |
| 7 | 資料 | **零造假**;趨勢/進港由 `intervals` 真實取樣 | 延續 §6 誠實邊界哲學 |

## 3. 配色 token(中性炭灰 / Ink Wash)

| 角色 | hex | 用在 |
|---|---|---|
| 底 60% | `#0B0C0E` | 頁面 bg、`renderer.setClearColor`、fog 色、暗背景漸層 |
| 鋼灰 30% | `#20242B` | 玻璃面板底 tint、邊框 |
| 銀(accent 10%) | `#CBD5DF` | 數字、圖表線、重點(取代原 cyan 計畫) |
| 警示 | `#FF8A4D` | 即將進港、告警狀態 |
| 正常 | `#5FE39A` | 在港 / 佔用 OK |
| 字 | `#F2F5F8`(主) / `#93A0AD`(次) | 文字階層 |

- **Liquid Glass Kit tokens**(`:root` 覆寫 + `<html data-lg-theme="dark">`):`--lg-accent:#CBD5DF`、`--lg-tint`/`--lg-text` 對齊上表。
- **船型 8 類別色**:維持飽和(中性底上唯一的彩色),僅微調確保在 `#0B0C0E` 上對比足夠;此調整在 `palette.ts`。
- **底圖 re-tint**:F2 目前 `__twin.setBasemapTint` 染藍(`0x3a5a72`),F0 改中性偏灰(約 `0x2A2E33`),避免藍色回流。

## 4. 借用的「通用 prompt 模板」(F0 build blueprint)

從 `UI_Pompt範例/1.rtfd` 萃取的 8 段骨架,對應到本案(此模板亦可重用於 F1/F3 的 UI 工作):

| # | 範例骨架 | F0 對應 |
|---|---|---|
| 1 | 一句話目標 + 技術棧 | 高雄港 IOC 戰情室 HUD,純 TS + Liquid Glass Kit |
| 2 | 視覺底層來源 | **3D 點雲戰情室場景**(取代背景影片) |
| 3 | 字體(display/body CSS 變數) | 沿用系統 PingFang TC / Inter,設 `--font-*` 變數 |
| 4 | 色彩主題(token) | §3 |
| 5 | 逐區塊規格(class/間距/字級/文案) | §6 面板清單 |
| 6 | Liquid glass class | **不手刻 backdrop-filter,一律用 Kit 的 `.lg`** |
| 7 | 動畫(交錯入場) | 面板 `fade-rise`,stagger 0 / .08 / .16 / .24s |
| 8 | 版面哲學宣言 | 極簡、無裝飾性 blob/漸層;3D 提供所有視覺深度 |

## 5. 3D 場景發光(引擎,加法擴充)

### 5.1 引擎 API(`src/core/LidarEngine.ts`,預設關)
- 新增 options:`bloom?: { strength; radius; threshold } | boolean`、`fog?: { color; near; far } | boolean`。皆 optional;未給則行為與現在完全相同(洞穴 demo 不受影響)。
- `addLayer(obj, opts?: { bloom?: boolean })`:`bloom:true` 的物件被指派到 bloom 圖層。
- 啟用 bloom 時,引擎內部建 `EffectComposer` 並在 `loop()` 改走 `composer.render()`;否則維持 `renderer.render()`。
- 新增純函式模組 `src/core/postfx.ts`:組裝 composer / 計算 selective-bloom 的可測部分(例:layer 遮罩、材質暫存/還原邏輯)抽成可單元測試的小函式。

### 5.2 Selective bloom 配方(three.js 標準兩段式)
- 發光物件設 `layers.enable(BLOOM_LAYER)`;非發光物件保留 default layer。
- **發光層**:`shipPC.points`、`incPC.points`。**非發光**:`basePC.points`(海岸線/碼頭)、`mapPlane`(航照底圖)。
- 兩段式:① 將非 bloom 物件材質暫換黑 → 用 `UnrealBloomPass` 只渲發光層到 bloom buffer;② 還原材質渲正常場景 → additive 合成。`three/examples/jsm/postprocessing/*` 已可用,vite 已外部化 `^three/examples/`。

### 5.3 Fog 與背景
- `scene.fog = new THREE.Fog(0x0B0C0E, near, far)`,near/far 依場景尺度(相機 `dist` 推算)。
- 背景:`renderer` clearColor `#0B0C0E`;可選極淡徑向暗角漸層(CSS 於 canvas 後層或 scene background),YAGNI 先用純色。

## 6. HUD 指揮中心(版面 B,Liquid Glass Kit)

### 6.1 Kit 整合
- 把 `liquid-glass.css`、`liquid-glass.js` **vendored** 進 `examples/kaohsiung-port/ui/`(複製,不引用桌面外部路徑)。註明來源版本(Kit v0.1)。
- **圖示**:Kit 的 `.lg-stat` delta 用 `#ph-trend-up` 等 Phosphor sprite。F0 只內嵌**實際用到的少數圖示** SVG sprite 到 `index.html`,或對非必要處改用文字/Unicode,避免缺圖。
- Vite 載入:CSS 用 `import './ui/liquid-glass.css'`;JS 為 IIFE 掛 `window.LiquidGlass`,以 side-effect import 或 `index.html` `<script>` 載入;動態建立節點後呼叫 `LiquidGlass.attach(el)` / `refresh()`。

### 6.2 面板清單(全部 `.lg` 玻璃,套 §3 token)
- **頂 navbar**(`.lg-navbar`):品牌「高雄港 IOC · LiDAR 戰情室」+ LIVE 點 + 時鐘。
- **左欄**:
  - 在港船舶 `.lg-stat`(大數字 + sparkline + delta)
  - 泊位佔用率 `.lg-gauge`(環形,值 = 佔用/總泊位)
  - 船型篩選(色票 chips,沿用 8 類別,checkbox 行為)
- **右欄**:
  - 24h 在港趨勢 `.lg-chart`(line) —— **真實資料**(見 §6.3)
  - 即將進港清單(碼頭#+船名+ETA,來自 `rebuildIncoming`)
  - 檢視切換(船型 ↔ 狀態)按鈕
- **底**:24h 時間軸(播放 + 拖曳),玻璃化沿用。
- **點船詳情**:`.lg-card`(沿用 `showVessel` 內容)。

### 6.3 真實趨勢資料
- 新增純函式 `buildOccupancyTrend(intervals, t0, t1, step)`:在 `[t0,t1]` 等距取樣 `occupancyAt(intervals, t).size`,回傳數列 → 餵 `.lg-chart` 的 `data-lg-points`。**有 node 單元測試**。

### 6.4 介面契約(降低 main.ts 異動)
- **重寫 `ui/overlay.ts` 用 `.lg` 元件,但維持現有 `OverlayApi` / `OverlayHandlers` 介面不變**(`setKpi`/`showVessel`/`setTimeRange`/`setClock`/`onFilter`/`onView`/`onScrub`/`onBackdrop`),`main.ts` 僅需:① 標記 bloom 層、② 底圖 re-tint、③ 多餵趨勢資料一條 setter。
- 入場動畫:面板掛 `fade-rise` 交錯 class。

## 7. 元件與檔案異動

**引擎(`src/`,加法,洞穴 demo 不受影響)**
| 檔案 | 異動 |
|---|---|
| `src/core/LidarEngine.ts` | +`bloom`/`fog` options、`addLayer(obj,{bloom})`、composer 渲染路徑 |
| `src/core/postfx.ts` | 新增:selective-bloom composer 組裝 + 可測純函式 |
| `src/index.ts` | 匯出新型別(如 `BloomOptions`/`FogOptions`) |

**App(`examples/kaohsiung-port/`)**
| 檔案 | 異動 |
|---|---|
| `ui/overlay.ts` | 重寫為 Liquid Glass 版,介面契約不變 |
| `ui/liquid-glass.css` / `ui/liquid-glass.js` | 新增:vendored Kit v0.1 |
| `ui/theme.css` | 新增:§3 token + `--lg-*` 覆寫 + `fade-rise` keyframes |
| `time/occupancy.ts`(或新 `time/trend.ts`) | +`buildOccupancyTrend` |
| `palette.ts` | 船型 8 色微調(中性底對比) |
| `main.ts` | 標 bloom 層、底圖 re-tint、餵趨勢、載 theme |
| `index.html` | 載 kit/theme、改頁面 bg、必要圖示 sprite |

## 8. 測試策略
- **純邏輯照測**:`buildOccupancyTrend`(新)、`postfx` 抽出的純函式(新)、`fmtClock` 等沿用。目標**現有 93 綠不破** + 新測試。
- **無法單元測**:bloom / 玻璃折射 / 動畫 = **瀏覽器目視驗證**(WebGL/CSS,程式環境無法渲染)。沿用 `npm run dev` → 截圖流程;`window.__twin` 補上新 handle(如 composer、setTrend)。

## 9. 已知邊界 / 限制
- **Liquid Glass 折射僅 Chromium**;Safari/Firefox 自動降級磨砂玻璃(版面與互動不變)。Bloom 在所有 WebGL 皆可。
- **趨勢圖/進港清單皆真實資料**,非造假動畫(延續 §6 誠實哲學)。
- Kit v0.1 為 vendored 快照;桌面 Kit 後續更新不會自動同步(需手動重 copy)。
- `prefers-reduced-motion` / 系統「減少透明度」時,Kit 自動停用折射/動畫;bloom 亦應尊重(可選關閉)。

## 10. 非目標(明確排除)
- F1 真實 AIS 航跡、F3 碼頭編號標籤(各自 spec)。
- Three.js Water / Sky(決策 5)。
- 引入 React / Tailwind / shadcn(決策 2)。
- 任何造假的即時資料或動畫。
