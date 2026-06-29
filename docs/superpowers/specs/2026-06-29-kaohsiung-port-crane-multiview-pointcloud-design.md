# 設計 — 橋式起重機:多視圖 → 點雲 + 靜態地物實例化(Task A 第一塊)

- **日期**:2026-06-29
- **目標**:把港區「起重機」圖層從程序生成的透空線框(`sampleGantry`),升級成「3D 模型軸向截圖 → visual-hull 雕刻」的真實橋式起重機(STS / ship-to-shore crane)點雲模板,於每個 OSM crane 座標**靜態實例化**、依碼頭線**朝水定向**。
- **背景**:Task A(handoff「港區 3D 建模升級」)的第一塊。起重機沒有免費 3D 模型 → 走 §4m 多視圖管線(同挖泥船)。第二塊(儲槽換真實模型)日後可重用本設計新增的 `kind:'model'` 圖層。
- **狀態**:brainstorm 拍板(Approach A)。

---

## 已定決策(brainstorm 拍板,別重新討論)

1. **輸入 = 3D 模型軸向截圖**(非實景透視照、非三視圖)——visual-hull 需正投影軸向剪影,同挖泥船。
2. **擺放架構 = Approach A**:新 `LayerKind 'model'`,工廠載入烘出的 unit 模板、每座 crane 放一份 scaled + pier-aligned 副本;缺模板自動 fallback 回 `sampleGantry`。
3. **定向 = 沿碼頭線、吊臂朝水**(pier-aligned,boom 垂直於最近碼頭切線、指向水/船靠泊側)。
4. **烘焙輸出沿用 `data/ship-models/起重機.json`**(`port:scan-views` baker 零改動、最低風險;對 ships 是惰性檔,`shipModels.ts` 不 import 它)。`ship-models/` 名稱對此地物檔成輕微 misnomer,接受。
5. **接受視覺權衡**:visual-hull 是外殼包絡 → 開放桁架/斜撐融成實心面板(門架大缺口、腿間缺口仍會雕掉,因剪影看得見)。結果為「結實但清楚可辨的 STS 起重機剪影點雲」,非透空線框。
6. **引擎 `src/` 零改動**;表現形式維持點雲、結構配色階層(中性鋼灰、低 bloom,船才是主角)。

---

## 設計核心約束(安全閥)

- **點數預算**:每座 crane ≤ ~1500 點(對齊船);70 座 ≈ ~84k 靜態點。靜態層**只建一次**(非每幀重建),比船寬鬆;以 `cellFrac` 控密度。
- **決定性**:水側判定只用靜態 OSM,不依賴 AIS 快照;同輸入恆同輸出(利於測試)。
- **聚焦**:不做無關重構;唯一順手去重 = 把 main.ts 的 `nearestPier` 抽到新 `scene/orient.ts` 共用(因本工作需要同邏輯)。

---

## 元件設計

### 1. 純邏輯 — `scene/orient.ts`(新檔,無 IO、可測)

碼頭對齊 + 水側判定,從 main.ts 抽出 `nearestPier` 並擴充:

- `buildPierSegs(piers: Polyline[], proj): Seg[]` — 把 OSM pier 線轉世界座標線段集(main.ts 現有迴圈搬過來)。
- `nearestPierTangent(x, z, segs): { headingRad, distU }` — 最近碼頭線段的切線方向與距離(= main.ts 現有 `nearestPier`)。
- `waterSideSign(center, tangentRad, osm, proj, opts): +1 | -1` — **土地密度測試**:沿 tangent±90° 兩垂直方向各跨 δ(`stepU`,預設 ~200m×WORLD_SCALE),數該端點半徑 r(`probeR`)內的「陸地」特徵取樣點(pier+tank+coastline+breakwater);回傳特徵較少(=水)那側的正負號。平手時回 +1(交給人工覆寫)。
- `craneBoomHeading(center, osm, proj, segs, overrides?): headingRad` — 組合:`nearestPierTangent` → `tangent + waterSideSign·(π/2)`;若 `overrides` 有此 crane 的強制側則用覆寫。

main.ts 改 import `nearestPierTangent`/`buildPierSegs`(去除原地重複定義);ship 既有行為不變。

### 2. 雕刻 config — `data/scan-views.ts`(改 1 處)

`VIEW_BAKE_CONFIG` 新增:

```ts
起重機: { frontMaskMaxHeightFrac: 1.0, cellFrac: <調到 ≤1500 點> },
```

- `frontMaskMaxHeightFrac: 1.0`:**與船相反**。船用 0.45(甲板以上 front 開放、防雙塔幻影);crane 的 front 視圖即「兩腿+頂梁」開放門架,要全高度生效 front 剪影,才能正確雕出腿間缺口與 boom 輪廓。
- `cellFrac`:烘焙後看點數實調(挖泥船 0.024→1230 可參考起點)。
- 其餘沿用 `DEFAULT_CFG`(gridLong 160 / bgTolerance 32 / coverFrac 0.02 / signForward 1)。baker `main()`/`OUT_DIR`/CLI **零改動**。

> 注意:`port:scan-views` 會重烘 `models/views/` 下**所有**類別(含 `工程`)。為免動到 `工程.json` 時間戳,烘後 `git checkout data/ship-models/工程.json`(同 GLB 流程慣例),只留新 `起重機.json`。

### 3. 地物模板註冊 — `scene/landmarkModels.ts`(新檔)

鏡像 `scene/shipModels.ts` 的 RAW 模式,但供靜態地物用:

```ts
import craneJson from '../data/ship-models/起重機.json';
const RAW: Record<string, { points: number[] }> = { crane: craneJson };
export function loadLandmarkModel(key: string): LandmarkModelTemplate | null { … } // 同 toTemplate + cache
```

模板型別與 `ShipModelTemplate` 同形(unit space,長軸 +x,min-y=0)。

### 4. `kind:'model'` 圖層 — `scene/layers.ts`(改)

- `LayerKind` 加 `'model'`;`LayerConfig` 加可選 `modelKey: string`、`scaleU: number`(模板長軸→世界單位)、`orient?: 'pierWater'`(定向策略)、`headingOverrides?: Record<number,1|-1>`(水側人工覆寫,key=crane index)。
- `buildLayerPoints` 新增 `'model'` 分支:
  1. `tpl = loadLandmarkModel(cfg.modelKey)`;**若 null → 退回 `sampleGantry`**(讀 cfg 的 legHeight/baseW/… 舊旋鈕)。
  2. `segs = buildPierSegs(osm.piers, proj)`(僅此分支需要)。
  3. 每座 crane LatLon:`center = toWorld`、`h = craneBoomHeading(center, osm, proj, segs, overrides)`、`batch = placeModelPoints(tpl, center, h, cfg.scaleU, cfg.baseY, 0.5)`、push `batch.positions`。
- **重用** `scene/shipModels.ts` 的 `placeModelPoints`(靜態 heading/scale 餵入即可,免改)。

### 5. 圖層設定 — `main.ts`(改 1 行)

`LAYERS['crane']` 從 `kind:'gantry'` 改 `kind:'model'`,加 `modelKey:'crane'`、`scaleU`(boom 全跨 ≈100m → ~1.0×S,高度由截圖長寬比自動帶出、會高過船)、保留舊 gantry 旋鈕當 fallback。色彩/bloom/pointSize 不變(結構鋼灰階層)。

---

## 資料流

```
data/models/views/起重機/{side,side2,front,stern,top,bottom}.png   (gitignore，被 models/* 涵蓋)
        │  npm run port:scan-views   (baker 零改動)
        ▼
data/ship-models/起重機.json   { points:[…], sampling:'visual-hull', forwardAxis:'z' }
        │  import (build 期，resolveJsonModule)
        ▼
scene/landmarkModels.ts  RAW.crane → loadLandmarkModel('crane') → 模板 (cache)
        │
layers.ts buildLayerPoints(kind:'model')
   ├─ buildPierSegs(osm.piers)            (scene/orient.ts)
   ├─ for each crane: craneBoomHeading()  (pier 切線 ± 90° 朝水)
   └─ placeModelPoints(tpl, center, h, scaleU, baseY, 0.5)   (重用 shipModels.ts)
        ▼
單一 PointCloud(crane 層) → engine.addLayer (bloom group 4)
```

---

## 測試

- `scene/viewCarving.ts` 既有單元測試**不動**(雕刻邏輯共用)。
- **新** `scene/orient.test`:`nearestPierTangent`(線段切線/距離)、`waterSideSign`(造兩側不對稱特徵 → 驗證選到稀疏側)、`craneBoomHeading`(切線+水側合成、覆寫生效)。
- **新** `scene/layers` `kind:'model'` build 測試:給小模板 + N crane 座標 → 驗證輸出點數 = N × 模板點數;缺模板 → fallback 走 `sampleGantry`(點數 > 0、與 gantry 一致)。
- 維持:全測試綠、`tsc --noEmit` 0、`npm run build` ok。
- **瀏覽器目視**(chrome-devtools):推近一座貨櫃碼頭 crane → 清楚 STS 門架 + 懸臂 boom、貼地(baseY 0)、**吊臂朝水/朝船**、鋼灰、不破點數預算;主控台僅 favicon 404。少數判錯的 crane → 記下 index,填 `headingOverrides` 再驗。

---

## 限制(誠實揭露)

- **外殼包絡、非透空桁架**:開放斜撐/吊掛機構融成實心面板(§4m 已記載)。港區尺度點雲可接受。
- **水側為啟發式**:土地密度測試在「中間水、兩岸地」的主場景穩;複雜指狀碼頭可能判錯 → 人工覆寫表收尾(同「眼睛看了再調旋鈕」哲學)。
- **單一模板套全部 70 座**:不分廠牌/尺寸差異(同船「每類一模板」慣例)。`scaleU` 統一;若個別碼頭 crane 明顯大小不同,日後可加 per-instance scale。
- **原始截圖不進版控**(`models/*` gitignore),只 commit 烘出的 `起重機.json`(同 AIS raw-vs-processed 慣例)。

---

## 前置條件(實作前需使用者提供)

- **起重機 3D 模型軸向截圖**:至少 `side` / `top` / `front`(`assembleAxes` 必需三軸);建議補 `side2` / `bottom` / `stern` 提升對稱度。乾淨檔名(避免 `classifyView` substring 誤判)、乾淨單色背景、正投影軸向角度。丟 `examples/kaohsiung-port/data/models/views/起重機/`。
- **授權**:若截自第三方模型,記進 `data/models/CREDITS.md`(同遊艇/貨櫃);若自製則註明無第三方授權問題。
