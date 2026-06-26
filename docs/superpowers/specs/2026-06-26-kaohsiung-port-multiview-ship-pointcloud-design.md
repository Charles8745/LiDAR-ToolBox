# 設計 — 多視圖 → 點雲船(正投影 Visual-Hull 體素雕刻)

- **日期**:2026-06-26
- **狀態**:設計定案,待寫實作計畫
- **動機**:有些缺模型的船型(當下是 **工程/挖泥船**)在網路上**找不到免費的 3D 模型**,所以無法走既有 §4k 的「GLB → 點雲」管線。改為從 3D 網站對該模型**截圖數張軸向視圖**(船首/船尾/左右舷/甲板/船底),用**正投影 visual-hull 體素雕刻**把外殼「掃描」成點雲模板,產出與 GLB 路徑**完全相同**的 `data/ship-models/<船型>.json`,接同一個 `RAW` 與 §4k 執行期。

## 已定決策(brainstorm 拍板,別重新討論)

1. **方法 = 正投影 Visual-Hull(體素雕刻 / shape-from-silhouette)**。三軸剪影各一(每軸最多 2 張、方向相反者取聯集)→ 體素網格,某體素保留 ⟺ 投影到三個剪影內都命中 → 取表面殼 → 點雲。純數學、確定性、零 ML、零外部服務。(評估過經典 CAD 線框重建=對有機曲面太脆;AI image-to-3D=重依賴/非確定性,皆否決。)
2. **擬真度 = A「外殼包絡 reads-as-挖泥船」就夠**。會忠實雕出:長條低船殼、尖艏、船首端駕駛台、船尾端高排料塔(挖泥船辨識特徵)、船殼 V 底。**會丟失**:細吸料管/桁架臂/桅杆天線、開放料艙內凹 —— 在港區尺度的點雲本就看不清,且與現有 7 個外殼點雲觀感一致。
3. **功能定位 = 通用「多視圖→點雲」烘焙器**,工程/挖泥船是第一個用例(設計成可重用於任何缺模型的船型,不寫死)。
4. **輸入形式 = 3D 網站貼圖截圖、近單一背景、每軸向 1–2 張**。用**邊框 flood-fill 去背(chroma key)自動抽實心剪影**,使用者不需手動描遮罩。
5. **轉換時機 = 開發時 CLI 烘焙**,與 `port:models` / `port:osm` 同模式:截圖放 repo(gitignore)→ 跑指令 → 點雲 JSON(commit)。執行期零解析、可重現。
6. **輸出 = 與 GLB 路徑相同的 `data/ship-models/<船型>.json`**,接既有 `scene/shipModels.ts` 的 `RAW` 註冊表;`placeModelPoints` 與執行期**零改動**;缺模型仍自動 fallback 平面 footprint。
7. **點數預算 ≤ 1500**(沿用遊艇慣例),`cellFrac` 為主旋鈕,目標 ~1.3k。

## 三個安全閥(設計核心約束)

- **引擎 `src/` 零改動** —— 全部加在 `examples/kaohsiung-port/`,延續「加法擴充」慣例。
- **重用既有後半段管線** —— 雕出的殼點直接餵 `meshSampling.ts` 既有的 `normalizeToUnit` + `voxelDownsample`,輸出同款 JSON,接同一個 `RAW`。新程式只負責「圖 → 殼點」前半段。
- **純邏輯與 IO 分離** —— 影像解碼(`sharp`)留在 CLI;去背/雕刻/取殼是純函式,可用合成遮罩單元測試。

---

## 元件設計

### 1. 純邏輯 — `scene/viewCarving.ts`(新檔,無 IO、可測)

純函式,只吃/吐 typed array 與純資料;無 `sharp`、無檔案 IO。重用 `meshSampling.ts` 的 `Axis` 型別。

- 型別:
  - `Mask = { data: Uint8Array; w: number; h: number }`(1=前景/船,0=背景;row-major)。
  - `AxisKey = 'length' | 'beam' | 'height'`。
  - `ViewKind = 'front' | 'stern' | 'side' | 'side2' | 'top' | 'bottom'`。
  - `GridDims = { nx: number; ny: number; nz: number }`(x=beam、y=height、z=length)。
- **`extractSilhouette(rgba: Uint8Array, w: number, h: number, opts: { bgTolerance: number }): Mask`**
  - 取四角像素中位數當背景色;從**所有邊框像素** flood-fill(4 鄰接),凡與背景色距離 ≤ `bgTolerance`(在 RGB 歐氏距離)且連到邊框者標記為背景(0);其餘為前景(1)。
  - 效果:船內被前景包住的同色洞(窗/縫)保留為實心;**開放到邊框背景**的縫(如桁架腿間)會被雕掉(正確)。
- **`cropToContent(mask: Mask): Mask`** —— 裁到前景 bbox,移除位置/留白差異,使各視圖只剩「物體本身」的比例。
- **視圖方向約定**(裁切後):`side`/`top` 以 **length 沿影像寬**(landscape)、`front`/`stern` 以 **beam 沿影像寬、height 沿影像高**。非此方向(如俯視拍成直立)用 `VIEW_BAKE_CONFIG` 的 per-view `rotate`/`flip` 覆寫;`registerGrid` 的比例推導都基於此約定。
- **`registerGrid(side: Mask, top: Mask, front: Mask, gridLong: number): GridDims`**
  - 以最長軸 length = `nz = gridLong` 為基準:`ny = round(gridLong × side.h / side.w)`(側視寬=length、高=height)、`nx = round(gridLong × top.h / top.w)`(俯視 寬=length、另一維=beam;依約定方向)。
  - **一致性檢查**:front 的 寬/高 = `front.w/front.h` 應 ≈ `nx/ny`;偏差 > 容差則 `console.warn`(透視/比例不一致),仍以 length-anchored 結果續行。
- **`carveVisualHull(masks, dims: GridDims): Uint8Array`**(回傳 `nx*ny*nz` 佔用格)
  - 對每體素 `(ix,iy,iz)` 算正規化 `(ux,uy,uz)∈[0,1)`,取樣:`side[uz,uy] ∧ top[uz,ux] ∧ front[ux,uy]`(每軸若有 2 張已先**聯集**)。三者皆 1 → 實心。
  - 方向約定:bow 在 +z、port 在 +x、deck 在 +y;每張輸入遮罩依其 `ViewKind` 做確定性翻轉對齊(stern 沿 z 鏡像後與 front 聯集;side2 沿 z 鏡像後與 side 聯集;bottom 沿 z 鏡像後與 top 聯集)。
- **`surfaceShell(grid: Uint8Array, dims: GridDims): Float32Array`**
  - 只留「至少一個 6-鄰居為空(或在格邊)」的實心體素,輸出其**中心點**座標(格座標:x∈beam、y∈height、z∈length)→ 中空殼,點數低、像掃描表面。

### 2. 烘焙 CLI — `data/scan-views.ts`(新檔,`npm run port:scan-views`)

結構鏡像 `data/fetch-ship-models.ts`(`DEFAULT_CFG` + 每船型 `VIEW_BAKE_CONFIG` 覆寫)。

- 掃描 `data/models/views/<船型>/`,依**檔名關鍵字**歸視圖:`front`/`bow`→front、`stern`/`aft`/`back`→stern、`side`/`port`→side、`starboard`/`side2`→side2、`top`/`deck`→top、`bottom`/`hull`/`keel`→bottom。
- 每張用 `sharp(path).ensureAlpha().raw().toBuffer({resolveWithObject:true})` 解碼成 rgba → `extractSilhouette` → `cropToContent`。同軸 2 張先翻轉對齊再**聯集**(`unionPerAxis`,預設 true)。
- `registerGrid` → `carveVisualHull` → `surfaceShell` → 殼點。
- **重用** `meshSampling`:`normalizeToUnit(shellPts, { forwardAxis:'z', upAxis:'y' })`(格子 length=z、height=y、beam=x,天生對齊)→ `voxelDownsample(cellFrac)` 控密度/點數。
- 寫 `data/ship-models/<船型>.json`,形狀對齊 GLB 路徑:`{ sourceFile:'models/views/<船型>', sampledAt, sampling:'visual-hull', count, lengthM:null, forwardAxis:'z', points:number[] }`(`lengthM` 無真實尺度 → null;執行期 `placeModelPoints` 只用 `points`、依各船 LOA 縮放,故 `lengthM` 僅資訊性)。

`VIEW_BAKE_CONFIG['工程']` 旋鈕:`gridLong`(雕刻解析度,預設 160)、`bgTolerance`(去背閾值)、`cellFrac`(最終密度→點數,調到 ~1.3k)、`unionPerAxis`、以及必要時的 per-view 手動翻轉/單張覆寫。

### 3. 接線 — `scene/shipModels.ts`(改 1 處)

`import dredgerJson from '../data/ship-models/工程.json'` + `RAW` 加 `工程: dredgerJson`。`placeModelPoints`、`updateShips`、`main.ts` **零改動**(與遊艇相同)。

### 4. 其他接點

- `package.json`:加 `"port:scan-views": "vite-node examples/kaohsiung-port/data/scan-views.ts"`。
- `.gitignore`:加 `examples/kaohsiung-port/data/models/views/`(原始截圖不進版控,只 commit 烘出的 JSON,延續 raw-vs-baked 慣例)。
- `data/models/CREDITS.md`:補挖泥船來源截圖的**出處 + 授權**(見下「待補資訊」)。

---

## 資料流

```
data/models/views/工程/{front,stern,side,side2,top,bottom}.png   (gitignored 截圖)
        │  sharp 解碼 rgba
        ▼
extractSilhouette ─ cropToContent              每張 → Mask(1=船)
        │  同軸聯集(stern→front / side2→side / bottom→top)
        ▼
registerGrid → carveVisualHull → surfaceShell  三軸交集 → 表面殼點
        │  重用 meshSampling
        ▼
normalizeToUnit(forwardAxis:'z',upAxis:'y') → voxelDownsample(cellFrac)
        ▼
data/ship-models/工程.json   (committed,同 GLB 路徑格式)
        ▼
scene/shipModels.ts RAW['工程']  →  §4k placeModelPoints  (執行期零改動)
```

## 測試

- **純單元測試**(`test/port-view-carving.test.ts`,合成遮罩、無影像檔):
  - `extractSilhouette`:rgba 邊框背景 + 中央前景塊 + **被包住的同色洞** → 洞保留為前景、邊框背景移除。
  - `carveVisualHull`:三張實心矩形 → 盒狀殼;斷言尺寸符合 `GridDims`、且**內部空心**(`surfaceShell` 不含內層體素)。
  - 圓(top)× 矩形(side)× 圓(front)→ 近圓柱,點數/外型 sanity。
  - `registerGrid`:給定三遮罩比例 → 斷言 `nx/ny/nz` 比例正確 + 不一致時 warn。
- **瀏覽器目視**(同遊艇收尾):`port:scan-views` 烘 → 接 `RAW` → `npm run dev` → 工程類別(現有 AIS 5 艘)reads-as-挖泥船(長船+兩端高結構)、貼水面、橄欖色 `[160,175,95]`、軸向對(沒躺平/膨脹)、點數 ≤1500、console 僅 favicon 404。

## 限制(誠實揭露)

- Visual-hull 是三剪影的**可分離交集** → 細吸料管/桁架/桅杆丟失(已同意 A);沿長度變化的非分離凹形無法還原。
- 極少數情況三剪影偶然重疊處會出現微小「幻影」體素(船型通常無害;必要時提高 `gridLong` 或人工檢視)。
- 透視截圖(非真正正投影)有輕微變形;側視最輕,可接受。
- 無真實尺度 → `lengthM:null`;執行期仍以各船 LOA 等比縮放(與既有一致)。

## 待補資訊(實作前需使用者提供)

- ⚠️ **挖泥船來源 + 授權**:截圖→點雲為衍生作品。需該 3D 模型的**網址 + 授權**寫進 `CREDITS.md`;若付費/NC,使用者明示接受與否(同遊艇 CC-BY-NC 流程)。
