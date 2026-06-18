# VS Code 開發指南 — 高雄港 LiDAR 戰情室

針對本專案(Vite + TypeScript + Three.js + Liquid Glass HUD)的日常開發、視覺調校與除錯流程。

> **關於截圖**:下方「執行畫面」截圖是**實際跑起來的 App**(瀏覽器畫面)。VS Code 介面本身(擴充面板、F5 除錯列、內嵌 DevTools、測試側欄)屬於你編輯器的 GUI,無法從這邊截圖,因此以「哪個圖示、在哪裡」的文字精準描述。

---

## 0. 前置

- Node 18+ 與 npm 已安裝。第一次先在專案根目錄 `npm install`。
- 用 VS Code 開啟專案資料夾根目錄(含 `package.json` 那層)。

## 1. 專案結構地圖(先認識在哪改什麼)

分成兩塊:**可重用的渲染引擎**(`src/`)與**高雄港 App**(`examples/kaohsiung-port/`)。引擎是「加法擴充」——所有新功能預設關,洞穴 demo(`examples/basic/`)不受影響。

```
src/                              ← 引擎(@lidar 函式庫,可重用)
├── core/
│   ├── LidarEngine.ts            ← 場景/相機/render loop;bloom、fog、addLayer 等 options
│   ├── PointCloud.ts             ← GPU 點雲;colorMode、pulseHz、sizeAttenuation…
│   ├── postfx.ts                 ← selective bloom(多群組)、createSelectiveBloom
│   └── RaycastSampler / RingBuffer / types
├── shaders/points.vert|frag.glsl ← 點的著色器(類別色、霧、閃爍 uPulseHz)
├── ramps/                        ← 色階 / 類別 LUT(buildCategoryLUT…)
└── index.ts                      ← 對外匯出

examples/kaohsiung-port/          ← 戰情室 App
├── index.html                    ← 殼層:載 liquid-glass + theme.css + main.ts
├── main.ts                       ← 組裝:點雲層、bloom 群組、底圖、overlay、互動、__twin
├── ui/
│   ├── overlay.ts                ← 玻璃 HUD(navbar/側欄/時間軸/詳情卡)+ 折射修復
│   ├── theme.css                 ← 配色 token(--lg-tint / --ink / --signal-*)+ fade-rise
│   └── liquid-glass.css|js       ← vendored Liquid Glass Kit v0.1(勿手改;見 §3d)
├── palette.ts                    ← 船型 8 類別色、狀態色、valueFor
├── scene/portPoints.ts           ← 把船/海岸線取樣成點
├── time/occupancy.ts             ← 泊位佔用、24h 趨勢、即將進港(純函式,有測試)
├── geo/ · berths.ts              ← 經緯度投影、碼頭線
└── data/                         ← 凍結快照 + 抓取腳本(見 §7 資料管線)
```

兩個可跑的頁面:
- 戰情室:`/examples/kaohsiung-port/index.html`(本指南主角)
- 引擎洞穴 demo:`/examples/basic/index.html`(驗證引擎沒被改壞)

## 2. 安裝建議擴充

專案已附 `.vscode/extensions.json`,打開專案時 VS Code 右下角會跳「安裝建議擴充」。或手動:**⌘ + ⇧ + X** → 搜尋框輸入 **`@recommended`** → 逐一安裝:

| 擴充 | 用途 |
|---|---|
| Microsoft Edge Tools (`ms-edgedevtools.vscode-edge-devtools`) | 在編輯器內開 DevTools;**改 CSS 自動寫回原始碼** |
| Vitest (`vitest.explorer`) | 測試側欄,行號顯示綠勾/紅叉 |
| Color Highlight (`naumovs.color-highlight`) | hex/rgba 行內顯示色塊 |
| Shader languages (`slevesque.shader`) | `.glsl` 語法高亮 |
| Error Lens (`usernamehw.errorlens`) | 錯誤直接顯示在該行行尾 |
| GitLens (`eamodio.gitlens`) | 行級 commit/blame |
| Prettier (`esbenp.prettier-vscode`) | 自動排版(選用) |

## 3. 啟動開發伺服器

### 方式 A — 只看畫面(最常用)

按 **⌃ + `**(Control + 反引號)開終端機:

```bash
npm run dev
```
```
  VITE v6.4.3  ready in 116 ms
  ➜  Local:   http://localhost:5173/
```

瀏覽器開:`http://localhost:5173/examples/kaohsiung-port/index.html`

**改 `.ts` / `.css` 存檔(⌘S)→ Vite 熱重載,瀏覽器即時更新**(`.css` 不重整即套用;`.ts` 觸發整頁重載)。

啟動成功應看到:

![戰情室執行畫面](assets/vscode-guide/01-running.png)

> 頂列:標題 / LIVE / 時鐘。左欄:在港船舶(統計卡)、泊位佔用(環形儀表)、船型篩選。右欄:24h 在港趨勢、即將進港清單。底部:24h 時間軸。中央 3D 點雲為背景,只有「船 / 進港標記」會發光(selective bloom)。

### 方式 B — 下中斷點 Debug + 內嵌 DevTools

`.vscode/launch.json` 有兩個設定:
- **戰情室:Vite + Chrome**(預設、最通用)
- **戰情室:Vite + Edge**(可搭配 §4a 的 Edge DevTools 自動回寫 CSS)

1. 按 **F5**(切設定:左側 ▷「Run and Debug」→ 上方下拉)。
2. 它**自動先跑 `vite: dev` 任務**(等 `Local:` 出現)→ 開瀏覽器。
3. 在 `main.ts` / `ui/overlay.ts` 行號左側點紅點 = 中斷點。

> F5 卡在「正在執行 preLaunchTask」→ 多半 5173 被佔用,關掉舊終端機(見 §10)。選了 Edge 但沒裝 Edge → 改 Chrome 設定。

## 4. 視覺調校(亮度 / 大小 / 位置)

### 4a. Edge DevTools(改了自動回寫原始碼)

> 需 **Edge 瀏覽器 + Edge Tools 擴充**。只用 Chrome 跳到 §4b(效果一樣)。

F5(Edge 設定)後或點左側 **Edge Tools** 圖示 → **Elements / Console**。**CSS mirror editing**:在 Elements 改樣式 → 自動寫回 `ui/theme.css`(已設 `webRoot`)。

### 4b. DevTools Console 即時試(免重建,改動暫時、⌘R 還原)

> 第一次貼指令,瀏覽器要你先打一行 `allow pasting`。先確認 `__twin` 有回物件(見 §5)。

**亮度**
```js
__twin.setBasemapTint(0x101216)                 // 底圖更暗
__twin.mapPlane.material.opacity = 0.7; __twin.mapPlane.material.needsUpdate = true
__twin.mapPlane.visible = false                 // 底圖關掉
__twin.engine.scene.fog.color.setHex(0x0b0c0e)  // 霧 / 背景色
document.documentElement.style.setProperty('--lg-tint','rgba(26,29,35,0.9)') // 玻璃更不透
```
**船 / 進港標記閃爍與發光**
```js
__twin.incPC.setPulseHz(0)     // 停止進港標記閃爍(0=恆亮)
__twin.incPC.setPulseHz(2.5)   // 閃更快
```
**元件大小 / 位置**
```js
// 元素點選工具:DevTools 左上箭頭+方框(⌘⇧C)→ 點面板 → 該元素即變數 $0
$0.style.padding = '18px'; $0.style.width = '240px'
// 一次改同類($$ = querySelectorAll)
document.querySelectorAll('#overlay .lg-rail').forEach(r => r.style.width = '260px')
document.querySelectorAll('#overlay .lg-stat, #overlay .lg-card').forEach(e => e.style.padding = '16px')
```
例如把側欄加寬到 260px、玻璃 tint 調到 0.9:

![即時調校後](assets/vscode-guide/02-tuned.png)

### 4c. 永久生效的原始碼位置

**亮度 / 發光 / 配色** — 多在 `examples/kaohsiung-port/main.ts` 與 `ui/theme.css`:

| 想調 | 位置 | 說明 |
|---|---|---|
| 進港標記**顏色** | `main.ts` 頂部 `INCOMING_COLOR` | `[R,G,B]` 0–255 |
| 進港標記**閃爍頻率** | `main.ts` 頂部 `INCOMING_PULSE_HZ` | 每秒幾次,0=不閃(見 §4e) |
| **各群組 bloom** 強度 | `main.ts` engine `bloom: [ … ]` 陣列 | 每組 `{ layer, strength, radius, threshold }`(見 §4d) |
| 哪些層**發光** + 屬哪組 | `main.ts` `engine.addLayer(pc.points, { bloom: <層號> })` | 省略=不發光 |
| 底圖明暗 / 透明度 | `main.ts` `buildBasemapPlane()` 的 `MeshBasicMaterial({ color, opacity })` | 色越小越暗 |
| 霧濃淡 / 距離 | `main.ts` engine `fog: { color, near, far }` | near 變小→霧更早起 |
| 玻璃面板透明度 | `ui/theme.css` `--lg-tint` | 第 4 值(alpha)越大→越暗實、字越清楚 |
| 文字 / 重點 / 警示色 | `ui/theme.css` `--ink` / `--lg-accent` / `--signal-warn` / `--signal-ok` | hex |
| 船型 8 類別色 | `palette.ts` `SHIP_CATEGORY_COLORS` | `[R,G,B][]`(中性底上唯一彩色) |

**大小 / 位置** — 在 `ui/overlay.ts`(卡片內距在 `theme.css`):

| 想調 | 位置 | 現值 |
|---|---|---|
| 側欄寬度 / 上邊界 / 卡片間距 | `makeRail()` | `width:200px; top:70px; gap:12px` |
| 頂列 navbar 高度 / 位置 | `nav = bar(...)` | `top:14px; height:44px` |
| 底部時間軸 | `timeline = bar(...)` | `bottom:14px; height:46px` |
| 卡片內距 | `theme.css` | `#overlay .lg-stat, #overlay .lg-card { padding:12px }` |
| 環形儀表大小(正圓) | `gauge` 建立後設 `width=height` + `alignSelf:center` | 寬≠高會變橢圓 |
| 各卡片字級 | 各 `innerHTML` 的 `font-size` | 10 / 12px |
| 3D 取景距離 / 角度 | `main.ts` `dist` 與 `cameraPosition` | `dist = radius*1.7 + 30` |
| 點雲各層高度(y 堆疊) | `portPoints.ts` `Y_WATER`/`Y_SHIP`、`main.ts` 進港 `0.8`/底圖 `-0.5`(見 §4g) | 底圖 -0.5 / 海岸線 0 / 進港 0.8 / 船 1.5 |

### 4d. 多群組 bloom(各層獨立發光參數)

引擎支援多個獨立 bloom 群組,用圖層編號區分。`main.ts`:
```ts
bloom: [
  { layer: 1, strength: 0.5, radius: 0.4, threshold: 0.2 },  // 例:船
  { layer: 2, strength: 1.1, radius: 0.5, threshold: 0.0 },  // 例:進港標記(更亮更外擴)
],
// 指派物件到群組:
engine.addLayer(shipPC.points, { bloom: 1 });
engine.addLayer(incPC.points,  { bloom: 2 });
```
- `strength` 光暈亮度、`radius` 擴散(0–1)、`threshold` 只有比它亮的像素發光。
- 想加第三組:`bloom` 陣列加一筆 `{ layer: 3, … }`,再 `addLayer(x, { bloom: 3 })`。
- 單一物件 `{ strength, radius, threshold }`(非陣列)= 一個群組在預設 `BLOOM_LAYER`(向後相容)。

### 4e. 點雲閃爍(pulse)與顏色

`PointCloud` 的 `pulseHz` 讓該層**亮度脈動**(因為在 bloom 群組,光暈也會一閃一閃):
```ts
const incPC = new PointCloud({ … , ramp: buildCategoryLUT([INCOMING_COLOR]), pulseHz: INCOMING_PULSE_HZ });
incPC.setPulseHz(2);  // 執行期改頻率;0 = 恆亮
```
顏色:給 `ramp: buildCategoryLUT([單一色])` 即單色層(進港標記就是這樣,色值來自 `INCOMING_COLOR` 常數)。

### 4f. ⚠️ Liquid Glass 折射在重載後不顯影 — 已修,但要知道

**現象**:整頁重載(存 `.ts` / SPA)後玻璃面板只剩平面磨砂、**沒折射**;存一次 `theme.css` 就「突然出現」。
**根因**:折射用 SVG `<feImage>` 的 PNG data-URI 位移貼圖,Chromium **非同步解碼**,而 `backdrop-filter` 合成節點在首次繪製就定型、不會等解碼完重建——要一次**文件層級樣式重算**才會。
**已內建修復**(`ui/overlay.ts` 的 `reviveGlass()`):attach 後在頭幾秒多次「拆 backdrop-filter → 還原 → clone+cache-bust 換掉一個同源 `<link>`」強迫重算。所以**正常情況不用管**。
- 手動重觸發(改了面板、或想立即喚醒):Console 打 `__reviveGlass()`。
- 完整原理與 `reviveGlass` 程式碼寫在工具包的 `~/Desktop/UI-ToolBox/CLAUDE.md`「已知陷阱」一節。
- `prefers-reduced-motion` / 非 Chromium 走磨砂 fallback(`LiquidGlass.supported===false`),不受此問題影響、不需 revive。

### 4g. 點雲高度分層(y 軸:各層上下堆疊)

座標系:**北 = -z、東 = +x、上 = +y**。各層的「高度」就是它的 y 值。由下而上目前的堆疊:

| 層 | 目前 y | 永久生效的位置 |
|---|---|---|
| 航照底圖平面 | `-0.5` | `main.ts` `buildBasemapPlane()` 的 `mesh.position.set(…, -0.5, …)` |
| 底層點雲(海岸線 + 碼頭) | `0`(`Y_WATER`) | `scene/portPoints.ts` 頂部常數 `Y_WATER`(只被 `buildBaseLayer` 引用) |
| 進港標記 | `0.8`(寫死) | `main.ts` `rebuildIncoming()` 的 `pos.push(p.x, 0.8, p.z)` |
| 船舶點雲 | `1.5`(`Y_SHIP`) | `scene/portPoints.ts` 頂部常數 `Y_SHIP`(`buildShipLayer` 用,亦寫進 `centers.y`) |

- **改底層 / 船層** 最乾淨的是改 `scene/portPoints.ts` 最上面那兩個常數(各只被引用一處):
  ```ts
  const Y_WATER = 0;    // 海岸線 + 碼頭的高度
  const Y_SHIP  = 1.5;  // 船舶點雲的高度
  ```
- **單位換算**:`WORLD_SCALE = 0.01`(1 單位 = 100m),所以 `Y_SHIP = 1.5` ≈ 真實 150m 高。這裡純粹是視覺分層,別當公尺解讀。
- **改 `Y_SHIP` 會連帶影響點擊挑選**:`buildShipLayer` 把同一個 `Y_SHIP` 寫進 `centers.y`,而 `main.ts` 點船是用 `centers` 投影到螢幕做最近距離比對——只要點雲與 `centers` 用同一常數(現況如此)就一致、不會點不到。
- 想避免相鄰層 z-fighting / 互相遮擋,讓各層 y 值保持間隔即可(底圖最低、船最高)。Console 即時試:`__twin.shipPC.points.position.y = 3; `(整層平移,暫時性,⌘R 還原)。

### 4h. 圖層 registry(每類別獨立點雲)

靜態地物改成**每類別一個獨立 PointCloud 圖層**,由 `main.ts` 頂部的 `LAYERS` 設定陣列(單一事實來源)+ `scene/layers.ts` 的 `buildLayers` 建出。每筆設定描述一個圖層的所有旋鈕。

| 欄位 | 說明 |
|---|---|
| `key` / `label` | 識別字 / 顯示名 |
| `source` | 對應 `osm` 的哪個欄位(coastline/piers/breakwater/tanks/cranes/anchorages) |
| `kind` | `line`(海岸線/碼頭/防波堤)、`cylinder`(儲槽 3D)、`gantry`(起重機 3D)、`zone`(錨地圈) |
| `color` | 單色 `[R,G,B]` 0–255 |
| `pointSize` / `maxPointSize` | 點大小 / 上限 |
| `brightness` / `pulseHz` | 亮度倍率(預設 1)/ 閃爍頻率(預設 0) |
| `bloomGroup` | 指派 bloom 群組(結構=3、地標=4) |
| `baseY` / `visible` | 基準高度 / 預設開關 |
| kind 專屬 | cylinder:`height`/`rings`/`perRing`;gantry:`legHeight`/`baseW`/`baseD`/`boomLen`/`spacing`;zone:`radius`/`ringCount`/`spacing`;line:`spacing` |

3D 點產生器在 `scene/landmarks.ts`(`sampleCylinderShell` 圓柱殼、`sampleGantry` 龍門骨架、`sampleZoneRing` 錨地圈,皆純函式可測)。

**Console 即時調(每層獨立)**:
```js
__twin.layers.tank.setVisible(false)        // 關掉儲槽
__twin.layers.crane.setColor([255,140,0])   // 起重機改橙
__twin.layers.coastline.setBrightness(1.5)  // 海岸線變亮
__twin.layers.breakwater.setSize(4)         // 防波堤點放大
__twin.layers.anchorage.setPulseHz(0.5)     // 錨地慢閃
__twin.layers.anchorage.setVisible(false)   // 錨地圈很大很亮,可關掉或調暗
```
新增/移除一個類別 = 改 `main.ts` 的 `LAYERS` 一筆設定。引擎 `PointCloud` 為此新增了 `setPointSize()`(會一併抬高 `uMaxPointSize` 上限)與 `setBrightness()`(`uBrightness` 倍率)。

## 5. `__twin` 除錯把手(Console)

`main.ts` 把這些掛在 `window.__twin`(+ `overlay.ts` 掛 `window.__reviveGlass`):

| 把手 | 用途 |
|---|---|
| `__twin.engine` | `LidarEngine`(`.scene` / `.camera3D` / `.renderer`) |
| `__twin.shipPC / incPC` | 船 / 進港層 `PointCloud`(`.setPulseHz`、`.points.material.uniforms`…) |
| `__twin.layers.<key>` | 六個靜態圖層的 handle(coastline/pier/breakwater/tank/crane/anchorage);`.setVisible/.setColor/.setBrightness/.setSize/.setPulseHz` |
| `__twin.mapPlane` | 航照底圖 mesh(`.visible` / `.material.opacity`) |
| `__twin.setBasemapTint(0x……)` | 即時改底圖染色 |
| `__twin.rebuildShips(tMs, mode, enabled?)` | 重建船層 |
| `__twin.rebuildIncoming(tMs)` | 重建進港標記 |
| `__twin.refresh(tMs)` | 重整到某時間(同拖時間軸) |
| `__twin.intervals` / `nowMs` / `shipCenters` | 佔用區間 / 快照時間 / 目前船中心 |
| `__reviveGlass()` | 強制重觸發玻璃折射合成 |

例:`__twin.refresh(__twin.nowMs + 6*3600000)`(跳到 6 小時後)。

## 6. 測試 / 型別檢查 / 打包

```bash
npm test          # vitest 一次跑完(目前 22 檔、103 測試)
npm run test:watch  # 監看模式,改檔即重跑
npx vitest run test/postfx.test.ts   # 只跑單檔
npx tsc --noEmit -p tsconfig.json    # 全專案型別檢查(0 錯才算過)
npm run build     # vite 打包 + tsc 宣告(出 dist/)
```
- 左側 **Testing**(燒杯)→ Vitest 列出全部測試,點 ▷ 跑單一個、可下中斷點 debug。
- **能測的是純邏輯**(`time/occupancy.ts`、`postfx` 的可見度輔助、`PointCloud` uniforms…);**bloom / 玻璃折射 / 動畫無法單元測**,只能瀏覽器目視(headless 也渲染不出 SVG 折射)。
- 裝 **Error Lens** 後 tsc 錯誤顯示在該行行尾;**Color Highlight** 在 `theme.css` / `palette.ts` 行內顯示色塊。

## 7. 資料管線(真實資料,凍結快照)

App 讀**凍結快照**(可重現、無執行期金鑰)。要更新資料:
```bash
npm run port:fetch    # 高雄港 TWPort 指泊/預報 → data/snapshots/khh-YYYY-MM-DD.json
npm run port:osm      # OSM 海岸線 + 碼頭線 → data/osm-khh.json
npm run port:basemap  # NLSC 航照烘焙成 data/basemap-khh.jpg(+ .json bounds;需 sharp)
```
所有 HUD 數字(在港數、佔用率、24h 趨勢、即將進港)皆由 `time/occupancy.ts` 從快照**真實算出**,無造假動畫。

## 8. 常用快捷鍵(Mac)

| 鍵 | 作用 |
|---|---|
| ⌃ + ` | 開 / 關終端機 |
| F5 | 啟動 Debug(自動跑 vite) |
| ⌘ + ⇧ + P | 命令面板(打 `Run Task` 可單獨跑 `vite: dev`) |
| ⌘ + ⇧ + C | DevTools 元素點選工具 |
| ⌘ + P | 快速開檔 |
| ⌘ + S | 存檔(觸發熱重載) |
| ⌘ + ⇧ + V | Markdown 預覽(看本指南帶圖) |
| ⌘ + ⇧ + X | 擴充面板 |

## 9. 典型開發循環

1. `npm run dev`(或 F5)。
2. 改 `overlay.ts` / `theme.css` / `main.ts` → ⌘S → 瀏覽器即時更新。
3. 微調:Edge DevTools(自動回寫)或 Console 試 `__twin` / `$0` / `__reviveGlass()`。
4. 把滿意的值填回 §4c 的原始碼位置。
5. 收尾:`npm test` + `npx tsc --noEmit` 全綠 → commit。

## 10. 出問題時

| 症狀 | 處理 |
|---|---|
| 瀏覽器打不開 / 連線拒絕 | 確認 `npm run dev` 還在跑、網址含 `examples/kaohsiung-port/index.html` |
| `__twin` 是 undefined | 跑錯網址或還沒載完 → ⌘R 重整 |
| 玻璃面板沒折射(重載後) | 已內建 `reviveGlass`(§4f);若仍沒出來,Console 打 `__reviveGlass()`;非 Chromium 走磨砂 fallback 屬正常 |
| 環形儀表變橢圓 | gauge 寬≠高 + `border-radius:50%`;設 `width=height` 即正圓(§4c) |
| F5 卡「正在執行 preLaunchTask」/ port 5173 被佔用 | 已有 dev server 在跑;關掉舊終端機,或手動法:先 `npm run dev`,再把 `launch.json` 的 `"preLaunchTask"` 那行刪掉後 F5 |
| F5 報「問題模式無效」 | `tasks.json` 的 problemMatcher 已修(需有 `file`/`message` 捕捉群組) |
| F5 找不到瀏覽器 | 選了 Edge 但沒裝 → 改「Vite + Chrome」設定 |
| 改了沒反應 | 確認有存檔(⌘S);CSS 變數要改 `:root` 或 `setProperty` |
| 洞穴 demo 壞了 | 引擎改動應為「加法、預設關」;檢查 `examples/basic/index.html` 是否仍正常 |

## 11. 延伸閱讀

- 設計 spec / 實作計畫:`docs/superpowers/specs/` 與 `docs/superpowers/plans/`(F0 戰情室、F2 航照底圖…)
- 交接總覽:`docs/superpowers/2026-06-14-handoff.md`
- Liquid Glass Kit 規格 + 已知陷阱:`~/Desktop/UI-ToolBox/CLAUDE.md`
