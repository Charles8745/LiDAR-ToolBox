# 設計 — GLB 3D 模型 → 點雲烘焙器(船立體化第一用例)

- **日期**:2026-06-23
- **狀態**:設計定案,待寫實作計畫
- **動機**:目前高雄港的船是用 [`sampleShipFootprint`](../../../examples/kaohsiung-port/scene/portPoints.ts) 在 `Y_SHIP=0.5` 撒一張**平面網格**的點,沒有體積感。要做一個**通用的「輸入 3D 模型 → 自動表面取樣成點雲」**能力,第一個用例是把船立體化(每個船型各一個 GLB 模型)。

## 已定決策(brainstorm 拍板,別重新討論)

1. **功能定位 = 通用模型匯入器**,船是第一個用例(設計成可重用於任何物件,不寫死成「船專用」)。
2. **轉換時機 = 開發時 CLI 烘焙**,跟 `port:osm` / `port:basemap` 同模式:模型檔放 repo → 跑指令取樣成點雲 JSON → commit。執行期零解析、可重現。
3. **取樣風格 = 表面取樣(surface)**,面積加權均勻撒點,任何 orbit 角度都有實心輪廓 —— 貼合現有 LiDAR 點雲質感(海岸線/碼頭/儲槽皆表面/線取樣)。
4. **模型格式 = glTF / GLB**,three.js 原生支援最好。
5. **船型對應 = 每個船型各一個模型**(8 類:貨櫃/油品/散雜/LNG/工作/軍艦/客運/其他),用 registry 對應;**缺模型的類別自動 fallback 回現有平面 footprint**,讓 8 個模型可逐步補齊而不破壞現狀。
6. **架構取向 = A:正規化模板 + 執行期變換**。烘焙產出單位空間正規化點雲模板;執行期每艘船依其 `heading` 旋轉、縮放、平移到船位,接進現有 [`updateShips`](../../../examples/kaohsiung-port/main.ts)(`main.ts`)每幀重建迴圈。**引擎 `src/` 零改動**(不走 GPU instancing,以免動引擎核心)。
7. **縮放模式 = 等比縮到 LOA(保留模型原比例)**。模型只依該船船長 `LOA` 等比放大縮小,x/y/z 同一倍率,各船型模型保持自身正確的寬/高外型;**不**依每艘船真實 beam 各軸拉伸(避免變形)。`SHIP_FOOTPRINT` 去重疊係數仍以等比方式套用。

## 三個安全閥(設計的核心約束)

- **引擎 `src/` 零改動** —— 全部加在 `examples/kaohsiung-port/`,延續「加法擴充、洞穴 demo 不受影響」慣例。
- **沿用既有 bake 管線** —— 新 `port:models` 指令與既有 `port:*` 同形;產物是 commit 進 repo 的 JSON。
- **缺模型自動 fallback** —— 沒有 GLB 的船型仍走現有平面 footprint,功能可逐型漸進。

---

## 元件設計

### 1. 純取樣函式 — `scene/meshSampling.ts`(新檔,引擎無關、可測)

純函式,無 three.js / 檔案 IO 相依,單元測試覆蓋:

- 型別:`Vec3 = { x:number; y:number; z:number }`、`Triangle = { a:Vec3; b:Vec3; c:Vec3 }`、
  `Bounds = { min:Vec3; max:Vec3; center:Vec3 }`、
  `SampledModel = { positions: Float32Array; bounds: Bounds }`。
- **`surfaceSample(triangles: Triangle[], count: number, rng: () => number): Float32Array`**
  - 面積加權取樣:對每個三角形算面積 → 建累積分布(CDF)→ 取 `count` 個點,每點先依 CDF 隨機選一個三角形,再用重心座標 `(1-√r1, √r1·(1-r2), √r1·r2)` 落在面內(`√r1` 保證面內均勻)。
  - `rng` 是**可注入的 seeded PRNG**(例如 mulberry32),讓烘焙**可重現、git diff 穩定**;測試傳固定種子。
- **`normalizeToUnit(positions: Float32Array, opts: { forwardAxis:'x'|'y'|'z'; upAxis:'x'|'y'|'z'; signForward?:1|-1 }): { positions: Float32Array; bounds: Bounds }`**
  - 依 `forwardAxis`/`upAxis` 把模型旋到約定座標(**長軸 = +x、上 = +y**,對齊 footprint 的「長度沿 heading」)→ **等比**縮放到長軸(x)長度 = 1(y/z 同倍率,保留模型原比例)→ 平移成 **x/z 置中、min-y = 0**(龍骨貼 y=0,執行期才能正確坐在水面、而非半沉)。
  - 回傳正規化點 + **原始** bounds(供記錄真實尺寸 `lengthM` 等)。
  - ⚠️ 刻意:**y 不置中**(min-y=0),與 x/z 的「置中」不同 —— 因為船要從水面長上去。
- 取樣點數由烘焙參數決定(預設目標 ~600 點/船,可逐型調)。

### 2. 烘焙 CLI — `data/fetch-ship-models.ts`(新檔)+ npm script `port:models`

- 讀 `data/models/<category>.glb`(**原始素材,提交進 repo** 讓烘焙可重現;由使用者準備)。
- three `GLTFLoader.parse`(Node 環境,**只取幾何**,不碰材質/貼圖/DRACO)→ `scene.traverse` 找所有 `Mesh` → 對每個 mesh 套用其 world matrix → 從 `geometry` 的 position attribute + index 收集所有三角形(攤平成 `Triangle[]`)。
- `surfaceSample(...)` → `normalizeToUnit(...)` → 寫
  `data/ship-models/<category>.json`:
  ```json
  {
    "sourceFile": "models/貨櫃.glb",
    "sampledAt": "<ISO>",
    "count": 600,
    "lengthM": 0,
    "forwardAxis": "x",
    "points": [x,y,z, ...]
  }
  ```
  - `points` 為**正規化單位空間**(長軸 = +x、x/z 置中、min-y=0);**只存幾何,不存 values** —— 顏色在執行期由 `updateShips` 依 `mode`('type'/'status')逐船算 `v01`(見元件 3),模板存 value 會誤導。
- 每模型的烘焙參數(`forwardAxis`/`upAxis`/`signForward`/點數)放一個 `MODEL_BAKE_CONFIG: Partial<Record<ShipCategory, ...>>` 表,逐型可調(模型素材的朝向不一定一致)。

### 3. 執行期整合 — `scene/shipModels.ts`(新檔)+ 改 `main.ts` 的 `updateShips`

> ⚠️ **整合點是 [`main.ts:130 updateShips`](../../../examples/kaohsiung-port/main.ts),不是 `buildShipLayer`**。F1 AIS 之後 live 每幀的船點由 `updateShips` 直接呼叫 `sampleShipFootprint` 產生;`portPoints.ts` 的 `buildShipLayer` 是舊靜態快照路徑(live 不走、可能僅測試用),**本功能不動它**。

- **Registry**:`CATEGORY_MODEL_KEYS: Record<ShipCategory, string | null>`(缺模型 = `null`)。`loadShipModel(category): ShipModelTemplate | null`,讀烘焙 JSON 並**記憶體快取**模板(`{ points: Float32Array }`,僅幾何)。
  - JSON 在執行期如何取得:沿用 example 既有 `import ... from './data/...json'`(Vite)模式,或 fetch;與現有資料載入方式一致。
- **`placeModelPoints(template, center: World, headingRad: number, lengthU: number, baseY: number, v01: number): PointBatch`**(純函式、有測試):
  - 每點:先等比縮放 `mx*lengthU, my*lengthU, mz*lengthU`(**全軸同倍率=該船 LOA 世界單位**,保留模型原比例)→ 繞 y 軸旋 `headingRad`,**沿用 `sampleShipFootprint` 同一慣例**:
    - `worldX = center.x + (mx·lengthU)·cos(h) − (mz·lengthU)·sin(h)`
    - `worldZ = center.z + (mx·lengthU)·sin(h) + (mz·lengthU)·cos(h)`
    - `worldY = baseY + (my·lengthU)`(模板 min-y=0 → 坐在水面)
  - `values` 全填傳入的 `v01`(由呼叫端依 mode 算好);輸出世界座標 positions + values。
- **改 `updateShips`**:迴圈內逐船判斷 `meta.category` —— `loadShipModel(category)` 有模板 → `placeModelPoints(tpl, c, h, loaU, SHIP_Y, v01)`;否則 **fallback 回現有 `sampleShipFootprint(c, loaU, beamU, h, spacing)`**(平面)。`loaU`/`h`/`v01`/`SHIP_Y` 皆為迴圈內既有變數,無需新增資料來源。
  - `pos`/`val` 累加方式、`centers`(點船詳情卡)、`shipPC.clear()/addPoints` 全照舊 → 其餘 `main.ts` 與 overlay 零改動。
- **點數預算旋鈕**:`main.ts` 頂部常數(目標點/船,模板烘焙時的 `count` 為主來源);沿用既有 `SHIP_FOOTPRINT`(目前 0.6)等比套用在 `loaU` 上,讓相鄰船不糊成一團。
- **上色不變**:value 仍由 `mode`('type'/'status')決定 → 既有 palette / 船型篩選 / bloom 全照舊。

### 4. 效能考量

- 取向 A 每幀(scrub/播放)為所有在範圍內的船重建點:551 船 × ~600 點 ≈ 330k 點的 translate/rotate/scale,純 JS 約 sub-ms~數 ms,可接受(現有平面 footprint 已是同量級每幀重建)。
- 旋鈕:目標點/船(烘焙時 + 執行期皆可再降取樣)。若日後不夠,升級路徑 = 取向 B(GPU instancing,需動引擎)。

## 測試 & 驗收

- **單元測試**:
  - `surfaceSample` —— 面積加權分布(大三角形拿到較多點)、seeded 同種子可重現、點落在三角面內。
  - `normalizeToUnit` —— 置中(centroid≈0)、軸對齊(長軸→+x)、長軸長度=1。
  - `placeModelPoints` —— 等比縮放 / 繞 y 旋轉(對齊 footprint 慣例)/ baseY 平移數值正確(對已知模板點驗算,如單位立方體模板)。
- **三角形收集 + 端到端**:用程式建一個已知 `THREE.BufferGeometry`(如 box)直接測「mesh→三角形→`surfaceSample`」串接,**避免提交二進位 GLB fixture**;真正的 `GLTFLoader.parse(GLB)` 路徑以手動/輕量煙霧驗證(跑一次 `port:models` 看產物)。
- **驗收門檻**:`npx tsc --noEmit` 0、測試全綠、`npm run dev` 瀏覽器目視 —— 船從平面變立體、依 heading 朝向、orbit 各角度有體積感、缺模型類別仍正常 fallback、主控台無 error。

## 新增 / 變更檔案一覽

| 檔案 | 動作 | 職責 |
|---|---|---|
| `scene/meshSampling.ts` | 新增 | 純取樣數學:`surfaceSample` / `normalizeToUnit` + seeded PRNG |
| `data/fetch-ship-models.ts` | 新增 | `port:models` CLI:GLB → 三角形 → 取樣 → 正規化 → JSON |
| `scene/shipModels.ts` | 新增 | category→model registry、`loadShipModel`、`placeModelPoints` |
| `main.ts` (`updateShips`) | 修改 | 逐船:有模板 → `placeModelPoints`;否則 fallback `sampleShipFootprint`(平面)。`buildShipLayer`/`portPoints.ts` 不動 |
| `data/models/*.glb` | 新增(素材) | 原始模型素材(使用者準備,commit 進 repo) |
| `data/ship-models/*.json` | 新增(產物) | 烘焙出的正規化點雲模板 |
| `package.json` | 修改 | 新 script `port:models` |

## 誠實邊界 / 已知取捨

- 點雲是**表面取樣的近似輪廓**,非掃描級精度;點數為視覺/效能折衷。
- 模型素材的朝向不一致 → 靠 `MODEL_BAKE_CONFIG` 逐型校正 `forwardAxis`/`upAxis`,可能需幾輪目視微調。
- 高度用長軸等比 (`y·lengthU`),非真實吃水/乾舷比例;單位模板已保留模型原比例,視覺上夠用。
- GLB 若含 DRACO 壓縮 / 特殊擴充,首版只保證標準幾何;遇到再加 decoder。
- 8 個船型模型逐步補齊,缺的走平面 fallback —— 過程中船海會是「立體 + 平面」混合,屬預期。
