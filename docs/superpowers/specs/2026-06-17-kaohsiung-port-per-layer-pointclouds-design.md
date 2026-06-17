# 設計 — 高雄港戰情室:每類別獨立圖層 + 新增地物(F4)

- **日期**:2026-06-17
- **狀態**:設計定案,待寫實作計畫。
- **子專案代號**:F4(「3D UI 戰情室」軌跡下的新子題,接續 F0/F2)
- **一句話**:把靜態地物從「coastline+pier 合一的 `basePC`」重構成**每類別一個獨立 PointCloud 圖層**,用 config 驅動的 registry 統一管理,並新增 `breakwater / storage_tank(3D) / crane(3D) / anchorage` 四種地物;每層可獨立開關/改色/調亮度/調大小(透過 `__twin.layers` console 把手)。

---

## 1. 動機 / 問題

目前 [main.ts](../../../examples/kaohsiung-port/main.ts) 把海岸線與碼頭塞進**同一個** `basePC`,顏色靠類別值區分,無法單獨開關或調某一類。要做更豐富的港口地物(油槽群、橋式機、錨地)且要能逐類微調視覺,現行結構不夠用。

使用者需求:**每一個地物種類各自一個點雲 instance**,方便獨立調「開/關、顏色、亮度、大小」;並把要呈現的地物擴充為 `coastline, pier, breakwater, storage_tank, crane, anchorage`,其中 **storage_tank 與 crane 做成 3D 呈現**。

## 2. 目標 / 非目標

**目標**
- 每類別獨立 PointCloud 圖層,可單獨開關/改色/調亮度/調大小。
- 新增地物:防波堤、儲槽(3D)、起重機(3D)、錨地。
- 用 config 驅動的 registry 管理圖層,新增/移除類別 = 改一筆設定。
- 控制介面:`__twin.layers` console 把手(開發期即時調)。
- 全測試綠 + `tsc --noEmit` 0 錯;洞穴 demo(`examples/basic`)不受影響。

**非目標(YAGNI)**
- 不做 HUD 圖層控制面板(之後另立子題;本輪只做 console 把手)。
- 不把 storage_tank/crane 做成實心 mesh(維持點雲一致性與統一控制)。
- 不把動態的船舶/進港層納入 registry(它們已是獨立 instance、且是逐 scrub 重建的特殊層;維持現狀)。
- 不接新資料源(沿用 OSM Overpass + 凍結快照模式)。

## 3. 已定決策(brainstorming 2026-06-17)

1. **3D 呈現 = 點構成的 3D 體**(非實心 mesh):儲槽 = 點排成的圓柱殼、起重機 = 點排成的龍門骨架。好處:全部圖層共用同一套控制(ramp/pulse/size/brightness)、會發光會閃、效能好、最一致。
2. **控制介面 = `__twin.layers` console 把手**(非 HUD 面板):貼合現有開發工作流、零 UI 工。
3. **架構 = config 驅動的圖層 registry**(非逐一寫死、非極簡 Map):一筆設定描述一個圖層的所有旋鈕。

## 4. 架構

### 4.1 資料管線

**抓取**([data/fetch-osm.ts](../../../examples/kaohsiung-port/data/fetch-osm.ts) 的 `QUERY`,同 bbox `22.53,120.24,22.64,120.34`)新增四種:
```overpassql
way["man_made"="breakwater"](bbox);     // 防波堤(線)
way["man_made"="storage_tank"](bbox);   // 儲槽(封閉多邊形 footprint)
node["man_made"="crane"](bbox);          // 起重機(點)
nwr["seamark:type"="anchorage"](bbox);   // 錨地(點或面)
out geom;
```
bbox 內實測量(2026-06-17 探測):breakwater 20、storage_tank 246、crane 70、anchorage 5。

**解析**([data/osm.ts](../../../examples/kaohsiung-port/data/osm.ts)):`parseOsmWays` 改名 `parseOsm`,一併更新所有呼叫端([fetch-osm.ts](../../../examples/kaohsiung-port/data/fetch-osm.ts) 與測試,不留相容別名)。輸出型別擴充:
```ts
interface OsmGeometry {
  coastline:  Polyline[];  // 既有(way)
  piers:      Polyline[];  // 既有(way)
  breakwater: Polyline[];  // way → 線
  tanks:      Polyline[];  // way → 封閉 footprint(產生器算 centroid + 平均半徑)
  cranes:     LatLon[];    // node → 點(取 el.lat/el.lon)
  anchorages: Polyline[];  // way → 多邊形外框;node → 存成單點折線(長度 1),產生器畫預設半徑圈
}
```
- 現有 parse 只看 `el.geometry`(way);需新增 **node 分支**(讀 `el.lat`/`el.lon`)。
- 重跑 `npm run port:osm` 覆寫 `data/osm-khh.json`(資料為 live OSM,屬正常管線行為)。

### 4.2 3D 取點產生器(新檔 `scene/landmarks.ts`,純函式可測)

每個產生器吃世界座標、回傳 flat xyz `number[]`;顏色由圖層的單色 LUT 統一給(同現有進港標記做法),產生器只管位置。

| kind | 用於 | 產生方式 | 可調參數 |
|---|---|---|---|
| `line` | coastline / pier / breakwater | 沿折線等距撒點(複用既有 [samplePolyline](../../../examples/kaohsiung-port/scene/portPoints.ts)),y = baseY | `spacing` |
| `cylinder` | storage_tank | 由 footprint 多邊形算**質心 + 平均半徑**;半徑上繞圈撒點、垂直堆 N 層 → 圓柱殼(含頂蓋圈) | `height`、垂直層數、每圈點數 |
| `gantry` | crane | 以節點為基準生**龍門吊骨架**:4 支垂直腿 + 頂部水平大樑(點構成),固定朝向、固定尺寸 | 腿高、底座寬深、樑長、點距 |
| `zone` | anchorage | 水面高度畫**圓形外框 + 中心點**(area 則描多邊形外框) | 半徑、點數 |

**預設參數量級**(world 單位,1 單位 ≈ 100m;瀏覽器內再微調):
- 儲槽:`height ≈ 0.3`(≈30m)、6 垂直層、每圈 32 點 → 246 槽 × ~190 點 ≈ 47k 點。
- 起重機:腿高 `≈ 0.6`(≈60m)、樑長 `≈ 0.5` → 70 台 × ~100 點 ≈ 7k 點。
- 錨地:外框半徑取實際面尺寸或預設 `≈ 1.0`,5 處,點數少。

總點數遠低於各層 capacity,效能無虞。

### 4.3 圖層 registry(新檔 `scene/layers.ts`)

```ts
type LayerKind = 'line' | 'cylinder' | 'gantry' | 'zone';

interface LayerConfig {
  key: string;                 // 'coastline' | 'pier' | 'breakwater' | 'tank' | 'crane' | 'anchorage'
  label: string;               // 給 console / 之後圖例用
  source: keyof OsmGeometry;   // 對應 osm 哪個欄位
  kind: LayerKind;
  color: RGB;                  // 單色
  pointSize: number; maxPointSize: number;
  brightness?: number;         // 預設 1
  pulseHz?: number;            // 預設 0
  bloomGroup: number;          // 指派到哪個 bloom 群組
  baseY: number;               // 基準高度
  visible?: boolean;           // 預設 true
  spacing?: number; height?: number;  // kind 專屬參數
}

interface LayerHandle {
  key: string; pc: PointCloud;
  setVisible(on: boolean): void;   // pc.points.visible
  setColor(rgb: RGB): void;        // 重建單色 LUT → pc.setRamp
  setBrightness(b: number): void;  // pc.setBrightness
  setSize(px: number): void;       // pc.setPointSize
  setPulseHz(hz: number): void;    // pc.setPulseHz
}
```
`buildLayers(configs, osm, proj)`:對每筆 config → `osm[config.source]` 取原始資料 → 投影 → 依 `kind` 跑對應產生器 → 建單色 PointCloud(`buildCategoryLUT([color])`)→ `addPoints` → 回傳 `LayerHandle`。`main.ts` 只剩一份 `LAYERS` 設定陣列 + 一個迴圈(建層、`engine.addLayer(pc.points,{bloom:bloomGroup})`、掛 handle)。

**遷移**:現有 `basePC`(coastline+pier 合一)退場,由 `coastline`、`pier` 兩筆設定取代。[portPoints.ts](../../../examples/kaohsiung-port/scene/portPoints.ts) 的 `buildBaseLayer` 由 `line` 產生器取代而成為死碼 → 移除,並更新其測試;`samplePolyline` 保留(被 `line` 產生器複用)。

### 4.4 引擎增補(加法,預設不變,洞穴 demo 不受影響)

- [PointCloud](../../../src/core/PointCloud.ts) 加 `setPointSize(px)`:設 `uPointSize`(目前只能建構時設)= 「大小」旋鈕。
- [PointCloud](../../../src/core/PointCloud.ts) 加 `uBrightness` uniform(預設 1.0)+ `setBrightness(b)`;[points.frag.glsl](../../../src/shaders/points.frag.glsl) 最終 rgb 乘 `uBrightness` = 「亮度」旋鈕。
- 預設值維持原行為(brightness 1.0、size 不變),故引擎其他使用者(洞穴 demo)無感。

### 4.5 控制把手(`main.ts`)

所有 handle 收進 `__twin.layers`(以 key 索引):
```js
__twin.layers.tank.setVisible(false)
__twin.layers.crane.setColor([255,140,0])
__twin.layers.coastline.setBrightness(1.5)
__twin.layers.breakwater.setSize(4)
__twin.layers.anchorage.setPulseHz(0.5)
```
既有 `__twin`(engine/shipPC/incPC/refresh/…)保留;`basePC` 把手移除(由 `layers.coastline/.pier` 取代)。

### 4.6 bloom 群組規劃

每組 = 一個 composer/render pass,控制數量為 4:
- 群組 1 = 船(既有)、群組 2 = 進港(既有)
- 群組 3 = 結構(coastline / pier / breakwater,弱光輪廓)
- 群組 4 = 地標(tank / crane / anchorage,中等發光)

每組 `strength/radius/threshold` 在 `main.ts` 的 `bloom` 陣列調。

## 5. 測試(TDD)

| 測什麼 | 怎麼測 |
|---|---|
| `parseOsm` | 餵含 node+way+seamark 的 fixture,驗證拆出 breakwater/tanks/cranes/anchorages |
| `sampleCylinderShell` | 點數、所有點 y ∈ [baseY, baseY+height]、半徑符合 footprint |
| `sampleGantry` | bounding box 尺寸、有腿有樑(高/寬範圍) |
| `sampleZoneRing` | 點落在指定半徑圓上(距中心 ≈ 半徑) |
| `PointCloud.setPointSize` / `setBrightness` | uniform 值變化(沿用 postfx uniform 檢查風格) |
| `buildLayers` + handle | 給小設定建出 N 個 handle;`setVisible` 切 `points.visible`、`setColor` 換 ramp |

既有測試保持綠;更新引用 `parseOsmWays` / `basePC` 的測試與程式。**目標:全綠 + `tsc --noEmit` 0 錯**。

## 6. 誠實邊界 / 已知限制

- **起重機朝向固定**:OSM crane 是點、無朝向資訊;龍門骨架用固定朝向、固定尺寸(非每台真實量測)。
- **儲槽半徑為近似**:由 footprint 多邊形質心 + 平均半徑估,非真實槽體尺寸;高度為統一常數(OSM 無高度)。
- **錨地表現為示意**:node 型錨地用預設半徑圈,非真實錨區範圍;area 型才描真實外框。
- **bloom 群組數 = 4**:多一組多一個 render pass;若效能吃緊,可讓多層共用群組。
- **資料為凍結快照**:重跑 `npm run port:osm` 才更新地物(live OSM 會變)。

## 7. 受影響檔案一覽

**引擎(加法)**
- `src/core/PointCloud.ts`:`setPointSize`、`uBrightness` + `setBrightness`
- `src/shaders/points.frag.glsl`:乘 `uBrightness`

**高雄港 app**
- `data/osm.ts`:`parseOsm`(node/polygon/seamark 支援)+ 擴充 `OsmGeometry`
- `data/fetch-osm.ts`:`QUERY` 加四種 tag
- `data/osm-khh.json`:重烘(新增欄位)
- `scene/landmarks.ts`(新):`sampleCylinderShell` / `sampleGantry` / `sampleZoneRing`
- `scene/layers.ts`(新):`LayerConfig` / `LayerHandle` / `buildLayers`
- `scene/portPoints.ts`:移除死碼 `buildBaseLayer`(`samplePolyline` 保留)
- `main.ts`:`LAYERS` 設定 + 迴圈;移除 `basePC`;`__twin.layers`
- 對應測試檔

**文件**
- `docs/vscode-dev-guide.md`:補圖層 registry / `__twin.layers` 把手一節(實作後)
- `docs/superpowers/2026-06-14-handoff.md`:F4 進度(實作後)
