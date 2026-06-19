# 設計:碼頭/分區標籤(F3)

- **日期**:2026-06-19
- **狀態**:設計定案(經對抗式審查 + 資料源探勘修訂),待寫實作計畫
- **脈絡**:高雄港戰情室數位孿生 F0/F2/F4/F1 已完成。場景已有真實佈局 + 真實地物 + NLSC 航照底圖 + 真實 AIS 船位。**缺少地理導覽文字**——使用者看不出哪一段是哪個港區、哪個碼頭。F3 補上**場景內的碼頭/分區文字標籤**。
- **重大設計轉向(經查證)**:原案打算用 `BERTH_LINE` 線性內插放碼頭編號,但對抗式審查證明此法在拉近時誤差(中位 ~98m)**大於相鄰碼頭間距(~82m)**,標籤會與 F1 真實 AIS 船位**打架**。探勘官方高港圖 [`sdci.twport.com.tw/khbweb/osmx2.aspx`](https://sdci.twport.com.tw/khbweb/osmx2.aspx) 後發現其 `GetMarker` endpoint **回傳真實測量船席座標**,且**從開發機即可達(非地理封鎖)**。**決議改用官方真實船席座標**(使用者拍板方向 A)→ 標籤位置與編號皆真實、與 AIS 船位**天生對齊**、誠實度問題根除。

## 研究依據(2026-06-19)

- **官方資料源(已實測)**:`POST https://sdci.twport.com.tw/khbweb/osmx2.aspx/GetMarker`(ASP.NET page method,body `{}`,回 `{"d":"<JSON 字串>"}`)。`d.v` 為當下船舶陣列,每筆含:
  - `PIER`(官方四位數碼頭碼,如 `1001`/`0003`/`4021`)、`SP_NAME`(中文船名)、`FHP_IMO_NO`。
  - `LAT1/LONG1`、`LAT2/LONG2`(**船席兩端點真實 WGS84 經緯度**;官方圖以兩端**中點**畫 square marker)、`ANGLE`(船席方位角)、`LEFTSIDE`(靠泊側)。
  - 實測:單次回 ~321 船 / **~77–114 個不同占用碼頭(皆有真實座標)**。**`v` 是占用相關**——單次只涵蓋當下占用席;**完整覆蓋需累積多次抓取**(碼頭座標靜態 → union 去重即可長成全表)。
- **官方分區(13 區固定名單,a01–a13,已實測)**:`a01 蓬萊商港區`、`a02 鹽埕商港區`、`a03 苓雅商港區`、`a04 中島商港區`(=4 個 **district**);`a05 第一貨櫃中心`…`a11 第七貨櫃中心`、`a12 洲際二期`、`a13 海事工作船渠`(=9 個 **terminal**)。zone 名以 divIcon 畫在官方圖上。`PORT_ZONES` 即依此 13 區建表(tier:district×4 / terminal×9)。
- **各國 3D 地圖通則**(ArcGIS / Cesium / 地圖標籤專利):標籤按「高度分層 + 縮放 LOD」——拉遠只顯示廣域名稱,拉近時廣域淡出、細節淡入。

## 目標

在 3D 場景內疊加**三層距離 LOD 文字標籤**:

1. **商港區層**(遠):官方 13 區中的商港區(蓬萊/鹽埕/苓雅/中島…)。
2. **貨櫃中心層**(中):第一~第七貨櫃中心 + 海事工作船渠等。
3. **個別碼頭層**(近):**官方四位數碼頭碼**,落在**官方真實船席中點座標**。

標籤為**場景內 billboard SDF 文字**(troika-three-text),面向相機、**深度測試開(寫實遮擋)**、依**單一全域相機距離**交叉淡化。

## 非目標(YAGNI)

- **不做 hover 揭示**:距離 LOD 已覆蓋「拉近才現」;hover 與其重疊,日後易加。
- **不做完整 declutter 解算**:berth 層加一個**便宜的逐標籤距離/螢幕間距剔除**即可(見 LOD 節),不做通用碰撞器。
- **不改標籤隨時間軸/回放變動**:標籤是靜態基礎設施,與 AIS 回放時鐘無關。
- **不在本階段用 `ANGLE` 改船朝向**:官方船席方位角是 bonus 觀察,記錄備查,F3 不動 L2 靠泊朝向邏輯。
- **不沿用 `BERTH_LINE` 內插放碼頭編號**(已否決,理由見上)。`berths.ts`/`BERTH_LINE` 維持現狀供既有 `resolveBerthLatLon` 用,F3 不依賴它。

## 技術決策(已定案,別重新討論)

| 決策 | 結論 | 理由 |
|---|---|---|
| 碼頭座標來源 | **官方 `GetMarker` 真實船席座標** | 位置 + 編號皆真實、與 AIS 天生對齊;根除 `BERTH_LINE` 內插的誠實度問題。從開發機可達。 |
| 渲染技術 | **troika-three-text SDF** | 場景內 3D 文字、SDF 不糊、可 billboard、**depthTest → 被 3D 地物正確遮擋**。否決 CSS2D(會卡、永遠最上層無法被遮擋)。 |
| 遮擋 | **寫實遮擋(depthTest 開)** | 被 3D 起重機/地物正確遮擋。**僅靠 yLift 分離**(見下);**不用 polygonOffset**。 |
| z 分離 | **yLift(抬高 y,~1u)** | 審查證明:底圖 `MeshBasicMaterial` 是 `depthWrite:false`(main.ts:194)不會 z-fight;y=0 的真實地物是 `THREE.Points`,`POLYGON_OFFSET_FILL` 對點精靈無效 → polygonOffset 是 no-op。改用 yLift(SHIP_Y=0.5*S=1.25u,標籤抬 ~1u 即清楚離開 y=0 結構)。 |
| 區段名稱 | **官方 13 區名單** | 對齊官方分類。 |
| 區段座標 | **手描(對底圖)** | 區段是粗粒度區域標頭、不與精確船位比對,手描中點足矣;可選日後用真實碼頭中點 centroid 精修(見實作備註)。 |
| troika 依賴位置 | **devDependencies(example-only)** | 本套件是 library(vite lib entry=`src/index.ts`),引擎 `src/` 不用 troika;放 dependencies 會讓下游無謂安裝。 |

## 架構

**官方資料採集管線(bake JSON)+ 純資料/數學模組(可測)+ troika 薄膠層 + 引擎一處小加法**。

### 元件

| 檔案 | 職責 | 測試 |
|---|---|---|
| `data/berthGeometry.ts`(新,純) | 型別 `BerthMarker {code,lat,lon,angle,nameZh}`;純解析 `parseGetMarker(json): BerthMarker[]`(取 `d.v`、過濾無座標、取中點、distinct by `PIER` latest-wins);union helper `upsertBerths(map, markers)` | node 單元測試 |
| `data/fetch-berths.ts`(新,CLI) | `npm run port:berths` → POST GetMarker(重試)→ `parseGetMarker` → **與既有 `berths-khh.json` union**(累積覆蓋)→ 原子覆寫 | 不測(網路/IO 副作用層) |
| `data/berths-khh.json`(新工件) | bake 的 `{capturedAtMs, berths: BerthMarker[]}`,commit 進 repo(比照 `osm-khh.json`/`basemap-khh.json`) | — |
| `scene/portZones.ts`(新,純) | `PortZone {label,lat,lon,tier:'district'|'terminal'}` + 手描 `PORT_ZONES`;LOD 純函式 `tierOpacity` / `berthDeclutterVisible`;`LodBands` 型別 | node 單元測試 |
| `scene/textLabels.ts`(新,troika 膠) | `buildLabelLayer(zones, berths, opts)` → `{ group, update(camera), setTierVisible, dispose }`;每 label 建 troika `Text`、定位、樣式、**`.sync()` 預熱**;`update()` 每幀 billboard + 套 LOD 純函式 | 不測(WebGL/troika 副作用;數學已抽到 `portZones`) |
| `src/core/LidarEngine.ts`(既有,加) | 新增 `addUpdate(fn)` + 公開 `tick(dt,time)`(`loop()` 內呼叫);純調度抽成可測 helper | engine helper 單元測試(見下) |
| `main.ts`(既有,改) | 載入 `berths-khh.json` → `buildLabelLayer` → `engine.addLayer(group)` + `engine.addUpdate(()=>labels.update(engine.camera3D))`;`__twin.labels` 把手;teardown 呼叫 `labels.dispose()` | — |
| `data/fonts/zones-subset.woff`(新工件) | 子集化 CJK 字型(只含區段字串用到的字 + 數字 + `#`),commit 進 repo | — |
| `package.json` | `troika-three-text` 加入 **devDependencies**;新增 `port:berths` script | — |

### 純函式契約(`scene/portZones.ts`)

```ts
type ZoneTier = 'district' | 'terminal'
interface PortZone { label: string; lat: number; lon: number; tier: ZoneTier }

// 每 tier 的距離帶(世界單位,單調遞增):相機到 sceneCenter 的距離。
// 遠 tier 在大距離不透明、近距離淡出;近 tier 反之。相鄰 tier 帶重疊 → 交叉淡化。
type Band = [fadeInStart: number, fullStart: number, fullEnd: number, fadeOutEnd: number]
interface LodBands { district: Band; terminal: Band; berth: Band }

// 具體預設(對應 WORLD_SCALE=0.025 → 1u=40m;預設相機距離 ≈ radius*1.0+15,main.ts:168-174)。
// 放 main.ts 頂部常數,方便目視校正。場景對角 ≈ 港區 ~12km → ~300u。
// district：遠看全可見;terminal：中距;berth：近。三帶在交界重疊 ~一個帶寬。
const DEFAULT_BANDS: LodBands = {
  district: [120, 180, 1e9, 1e9],   // 距離 > ~150u(很遠)才主導;近端在 ~120u 淡出交給 terminal
  terminal: [40,  70,  170, 220],   // 中距主導
  berth:    [0,   0,   55,  90],    // 近距主導
}

tierOpacity(tier: keyof LodBands, camDist: number, bands: LodBands): number
  // 依該 tier 的 Band 線性內插出 fillOpacity ∈ [0,1];帶外為 0。純函式。

berthDeclutterVisible(labelDistToCamera: number, nearRadius: number): boolean
  // 次級逐標籤剔除:label 離相機 > nearRadius 即隱藏(避免拉近時 100+ 編號同框)。
  // 與 tierOpacity('berth',…) 相乘合成:finalOpacity = tierOpacity('berth') * (visible?1:0)。
```

**單一度量原則(修正原案)**:**所有 tier 的淡化都用同一個全域 `camDist`**(相機到 `sceneCenter` 距離),保證跨 tier 平滑交接、不出現「無標籤死區」。`berthDeclutterVisible` 只是 berth 層**額外**的逐標籤密度控制,**不**驅動 tier 交接。`sceneCenter` 用**明確地理中心** `proj.toWorld(KAOHSIUNG_ORIGIN)`(= `{x:0,z:0}`),**不**用 AIS 船群 frame 的 `cx/cz`(那與宣告無關的 AIS 狀態耦合)。

### troika 膠層契約(`scene/textLabels.ts`)

```ts
interface LabelLayerOpts {
  proj: Projection
  bands: LodBands
  nearRadius: number            // berth 層逐標籤門檻(世界單位)
  yLift: number                 // 標籤抬離 y=0(~1u;避免被 y=0 結構吃掉)
  fontUrl: string               // CJK 子集字型(數字 + # 一併納入子集)
  color: number; outlineColor: number
  sceneCenter: { x: number; z: number }   // = proj.toWorld(KAOHSIUNG_ORIGIN)
  fontSizes: { district: number; terminal: number; berth: number }  // 世界單位,隨 S 等比
}

buildLabelLayer(zones: PortZone[], berths: BerthMarker[], opts): {
  group: THREE.Group                  // engine.addLayer(group)
  update(camera: THREE.Camera): void  // 每幀:billboard 全部 Text + 套 tierOpacity/berthDeclutterVisible
  setTierVisible(tier, on): void      // __twin.labels 開關
  dispose(): void                     // 對每個 troika Text 呼叫 .dispose()(見記憶體節)
}
```

- 每 Text:`anchorX:'center'`、`anchorY:'middle'`、`material.depthTest=true`、`outlineWidth` 細描邊提升暗背景可讀性、`fillOpacity` 初始 0。
- 位置:`proj.toWorld(lat,lon)` → `(x, yLift, z)`(`proj.toWorld` 只回 `{x,z}`,y 用 yLift)。
- **預熱**:建完所有 Text 後對每個呼叫 `.sync()`(troika 在 web worker 非同步產 SDF;未 sync 完不顯影)→ 載入期先產好,避免首次顯示/首次 LOD 揭示時 glyph 跳入;`fillOpacity` 在對應 tier 該亮時才升起。
- billboard:`text.quaternion.copy(camera.quaternion)`(每幀)。
- 字體大小依 tier 分級(district 最大、berth 最小),世界單位,隨 `WORLD_SCALE`/`S` 由 main.ts 帶入。

### 引擎加法(`LidarEngine`)

```ts
private updaters: Array<(dt:number, time:number)=>void> = []
addUpdate(fn): void { this.updaters.push(fn) }
// 公開 tick 供測試直接呼叫(繞過 WebGL 渲染):
tick(dt:number, time:number): void { for (const u of this.updaters) u(dt, time) }
// loop() 內、controls.update() 之後、bloom/render 之前:this.tick(dt, this.time)
```

**為何加、為何可測**:`loop()` 是 private、無對外每幀 hook;空 `Group` 非 renderable → 其 `onBeforeRender` 不會被呼叫。`loop()` 已對 `extraLayers` 做每幀 uTime 更新(LidarEngine.ts:165-168),`addUpdate` 是其**一般化形式**,但屬**新公開 API**(有維護/測試成本,誠實標注)。**測試策略**:引擎建構子無條件 `new THREE.WebGLRenderer({canvas})`(LidarEngine.ts:69)+ `window.devicePixelRatio` → 在 `vite.config` 的 `environment:'node'` 下**無法 headless 實例化**。故**不**測整個引擎;把調度抽成純 helper 或測 `tick()` 對一個 stub updater 陣列的行為(以最小 fake `this` 呼叫)——驗證註冊的 fn 被依序以 `(dt,time)` 呼叫。

### 與 bloom 的相容性(已查證)

- `postfx.ts` selective bloom 用 `o.visible=false` 隱藏非 bloom 物件(`hideNonBloomed`,postfx.ts:36-42),**不做 material override** → troika 自訂 SDF 材質安全。
- 最終 pass 是 `RenderPass(scene, camera)` 渲染整個場景(postfx.ts:112)→ **標籤不掛任何 bloom 群組仍會顯示**。`addUpdate` 每幀只跑一次,bloom 多 pass 內部重渲染都觀察到一致的 billboard 狀態。
- **標籤不進 bloom 群組**(UI 文字不發光,符合視覺階層:進港>船>地標>結構>UI 文字)。

### 記憶體 / teardown(審查發現)

`LidarEngine.dispose()`(LidarEngine.ts:256-262)把每個 extraLayer **cast 成 `THREE.Points`** 並 dispose 其 geometry/material;`THREE.Group` 兩者皆無 → 130+ 子 troika Text(geometry + SDF 材質 + worker atlas)**不會被釋放**。對策:`buildLabelLayer` 回傳的 handle 提供 `dispose()`,對每個 troika Text 呼叫 `.dispose()`(troika 需逐 Text dispose);`main.ts` teardown 路徑呼叫它。(備註:`main.ts` 目前無 `engine.dispose()` 呼叫路徑,屬潛在問題;F3 至少讓 handle 自帶 `dispose()`,並可選擇把 `LidarEngine.dispose()` 改成 `traverse()` 泛型 dispose Mesh 的 geometry+material。)

### 資料流

```
GetMarker(官方,可達) ─ fetch-berths(累積 union)─► data/berths-khh.json ─┐
PORT_ZONES(手描,scene/portZones.ts)──────────────────────────────────┼─► buildLabelLayer ─► group ─► engine.addLayer
proj / DEFAULT_BANDS / sceneCenter / font ────────────────────────────┘         │
                                                                                 └─ update(camera) ◄─ engine.addUpdate(每幀 tick)
                                                                                       │
                                                              tierOpacity / berthDeclutterVisible(純,可測)
```

## CJK 字型處理

troika 渲染中文需 opentype 可解析的字型(.ttf/.otf/**.woff**;troika 不吃 .woff2)。

- **主路徑**:區段名是固定字串 → 用 `pyftsubset`(fonttools,已確認可用於 `/opt/anaconda3/bin`)子集化 Noto Sans TC 成「全部 `PORT_ZONES.label` 字元 ∪ `0123456789#`」,strip hinting → `data/fonts/zones-subset.woff`(<50KB),commit 進 repo。**子集化指令寫進 plan + dev guide**(從 `PORT_ZONES` 字元集自動產生 unicodes 清單,避免漏字)。
- **tofu 防呆**:troika 對缺字**靜默顯示 tofu(無 console error)**——會通過「主控台無 error」門檻卻顯示空白方塊。故加一個**小測試**:斷言所有標籤用到的字元都在子集字型的 cmap 內(或在 plan 列為目視檢查項)。
- **fallback**:無 fonttools 時 vendored 全字型(較重)。實作期擇一,plan 標注。
- 數字碼頭碼用同一子集字型(已納入數字字形),統一 fontUrl 較簡單。

## 誠實邊界(本案已大幅改善)

- **碼頭編號層現為真實**:位置 = 官方真實船席中點座標,編號 = 官方四位數碼,**與 AIS 船位同為真實世界座標 → 對齊**。原 `BERTH_LINE` 內插的近似問題**根除**。
- **覆蓋率誠實**:`GetMarker` 占用相關,`berths-khh.json` 涵蓋「累積抓取期間曾占用過的碼頭」。**未涵蓋的空席不會有標籤**(誠實,不偽造)。dev guide 說明:多跑幾次 `port:berths` 累積即增覆蓋。bake 檔記 `capturedAtMs`。
- **區段層**落在手描座標(對 NLSC 底圖校正),順序/可辨識,**非測量級**(粗粒度區域標頭,可接受;比照既有誠實邊界)。
- 標籤是**導覽輔助**;不偽稱精確。

## 測試

- **`test/port-berth-geometry.test.ts`**(新):`parseGetMarker` 對一份**精簡固定 fixture**(取自實測 `GetMarker` 的數筆 `v`)→ 正確取中點、過濾無座標、distinct by `PIER`;`upsertBerths` union/latest-wins。
- **`test/port-zones.test.ts`**(新):
  - `PORT_ZONES` 格式(label 非空且唯一、`tier` 合法、`lat/lon` 落在 **basemap bounds** `n=22.6444,s=22.5227,w=120.2344,e=120.3442`)。
  - `tierOpacity`:帶外為 0、帶內單調、相鄰 tier 在交界**並集不全為 0**(無死區);給定 `DEFAULT_BANDS` 掃一系列 `camDist`,斷言**每個距離至少一 tier opacity > 0**。
  - `berthDeclutterVisible`:`nearRadius` 門檻內外正確。
- **引擎 `tick`/`addUpdate`**(新,純):註冊的 fn 在 `tick(dt,time)` 被依序以正確參數呼叫(用最小 stub,不實例化 WebGL 引擎)。
- **目視驗證**(`npm run dev` + 瀏覽器截圖):
  - 遠只見商港區名;中見貨櫃中心名;近見個別四位碼頭碼,且只亮鏡頭附近幾個;跨 tier 拉近/拉遠**交叉淡化**平滑、無突跳、無「無標籤死區」。
  - 碼頭碼標籤**與真實 AIS 船位對齊**(同碼頭的船與其碼頭碼相鄰)。
  - 標籤**被起重機/地物正確遮擋**;**無與底圖 z-fighting**;**無 glyph 跳入**(預熱生效);**無 tofu 缺字**。
  - 主控台無 error;字型載入失敗有 console.warn(比照 basemap onError,main.ts:199-204);`__twin.labels.setTierVisible(...)` 可開關。

## 品質門檻

- `npm test` 全綠(現 **160** + 新增數例)。
- **`npx tsc --noEmit`(根 tsconfig,include `src/examples/test`)0 錯** —— 這才是型別檢查 example 的指令;**`npm run build` 是 lib 模式(`lib.entry=src/index.ts`,tsconfig.build `include:["src"]`),不碰 examples**,故 F3 的建置證明用 `tsc --noEmit` + `npm run dev` 目視,**不**用 `npm run build`。注意:example 程式 import troika 需 troika 附型別宣告(或加本地 d.ts shim)才能過 `tsc --noEmit`。
- 瀏覽器目視驗證通過(上列項目)。

## 階段切分(供 plan 參考)

1. **依賴 spike(硬前置)**:`npm i -D troika-three-text` → import `Text` → `npm run dev` **與** `npx tsc --noEmit`。若遇 `webgl-sdf-generator` 「no default export」之類 ESM/CJS 互通錯,加 `optimizeDeps:{include:['troika-three-text','webgl-sdf-generator']}`(必要時 `build.commonjsOptions.transformMixedEsModules`);把解出的設定寫進 plan。確認 SDF 文字能對 three 0.171 渲染。
2. **官方碼頭資料管線**:`data/berthGeometry.ts`(純解析 + union)+ 測試;`data/fetch-berths.ts`(`port:berths`,累積)+ 跑一次 bake `data/berths-khh.json`。
3. **字型子集化工件**:從 `PORT_ZONES` 字元集 + 數字產 `data/fonts/zones-subset.woff` + cmap 覆蓋檢查。
4. **`scene/portZones.ts`**:`PORT_ZONES`(座標先放近似、後目視校正)+ LOD 純函式 + 測試。
5. **`LidarEngine.addUpdate` + `tick`** + 純調度測試。
6. **`scene/textLabels.ts`** troika 膠層(建 Text + 預熱 + billboard + LOD + dispose)。
7. **`main.ts` 接線**:載入 berths/zones、`addLayer`+`addUpdate`、`__twin.labels`、LodBands/sceneCenter/fontSizes 常數、teardown dispose、字型載入失敗 onError。
8. **目視校正**:手描區段座標對底圖;跨 tier 淡化/遮擋/z 分離/declutter/對齊 AIS 調校。
9. **文件**:dev guide 補標籤調校配方 + `port:berths` 累積說明 + 字型子集化指令;handoff 更新(含 GetMarker 資料源備查)。

## 文件入口

- handoff:[docs/superpowers/2026-06-14-handoff.md](../2026-06-14-handoff.md)
- 引擎設計:[specs/2026-06-13-lidar-scan-engine-design.md](2026-06-13-lidar-scan-engine-design.md)
- 累積器模式可參考:[specs/2026-06-19-kaohsiung-port-twport-accumulating-recorder-design.md](2026-06-19-kaohsiung-port-twport-accumulating-recorder-design.md)
- 既有圖層 registry / `__twin` 把手:`docs/vscode-dev-guide.md`
