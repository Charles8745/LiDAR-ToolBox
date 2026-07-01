# 設計:高雄港儲槽換真實圓柱 3D 模型（任務 A 第二塊）

- **日期**：2026-07-01
- **狀態**：設計已與使用者確認，待寫 plan
- **範圍**：把港區 246 座程序生成的圓柱殼儲槽，換成真實 GLB 模型烘成的點雲，於每座 OSM 儲槽輪廓中心靜態實例化、依真實 footprint 半徑縮放。**先全部用圓柱模型，球形延後。** 另含一次性的「儲槽位置真實性」核對。

---

## 1. 目標與背景

港區 3D 升級「任務 A 第二塊」：現況儲槽是 `scene/landmarks.ts` 的 `sampleCylinderShell` 程序圓柱殼（`kind:'cylinder'` 圖層，246 座，半徑由 footprint 推算）。本案換成真實 3D 模型烘成的點雲模板，提升擬真度，對齊已驗證的船舶 / 起重機 GLB→點雲管線。

**可重用的既有基礎：**
- **GLB→點雲管線（dev-guide §4k）**：`data/fetch-ship-models.ts`（`npm run port:models`，`MODEL_BAKE_CONFIG` + `sliceSample`/`voxelDownsample`/`normalizeToUnit`）、`scene/meshSampling.ts`、`scene/meshTriangles.ts`、`scene/shipModels.ts`（`RAW` registry + `toTemplate` + `placeModelPoints`）。
- **`kind:'model'` 靜態地物圖層（起重機留下的）**：`scene/landmarkModels.ts`（`loadLandmarkModel` + `buildModelInstances`）、`scene/layers.ts` 的 `'model'` 分支。**起重機雖已從場景隱藏，但這套 model 基礎程式碼保留可用。**

**使用者已放入的素材：**
- `data/models/cylinder_Storage_Tank/`（gltf 資料夾：scene.gltf + scene.bin + textures + license.txt）。授權 **CC-BY-4.0（可商用）**，作者 Deepak Singh，"Process Storage Tank"（Sketchfab）。
- `data/models/sphere_Storage_Tank/`（同格式，CC-BY-4.0，"Gas / Oil Tank / Refinery / Storage"）——**本案不使用，延後。**

**關鍵事實（探索得出）：**
- OSM `man_made=storage_tank` 只存了封閉輪廓多邊形（`osm.tanks: Polyline[]`），**沒有任何區分圓柱/球形的標籤**。
- footprint 半徑分布：median 7.6m、範圍 2.9–31.4m、大小重疊 → **無法用半徑可靠區分圓柱/球形**（故球形延後、先全部圓柱）。

---

## 2. 需求

1. 重抓最新 OSM，核對 246（或更新後數量）座儲槽位置在航照底圖上是否真實（錯位 / 漏標 / 幻影）。
2. 把 cylinder tank GLB 烘成 unit 點雲模板。
3. 儲槽圖層由程序圓柱殼改為「模板 × 每座 OSM 座標」的靜態點雲，**每座依自己的 footprint 半徑等比縮放**（大槽大、小槽小），免定向（徑向對稱）。
4. 引擎 `src/` 零改動；tsc 0、測試綠、瀏覽器目視通過。

---

## 3. 設計

### 3.1 位置驗證（一次性）
1. `npm run port:osm` 重抓 → 更新 `data/osm-khh.json`（記錄新 tank 數）。
2. **一次性診斷 baker**（temp 腳本，非常駐）：把每座 tank 的中心點 + 輪廓多邊形，用既有 geo→world→pixel 映射（與 `main.ts buildBasemapPlane` / crane baker 一致：`u=(wx-sw.x)/(ne.x-sw.x)`、`v=(sw.z-wz)/(sw.z-ne.z)`、`row=(1-v)*H`，`sw=toWorld(b.s,b.w)`、`ne=toWorld(b.n,b.e)`）疊到 `data/basemap-khh.jpg`，輸出比對圖。
3. 目視核對。**若發現重大偏差（大量錯位/漏標），先回報使用者再決定處理方式，不自行改座標。** 驗完刪除診斷 temp 檔（比照 crane 診斷做法）。

**驗收標準**：疊圖上絕大多數 tank 標記落在航照可見的圓形儲槽上；無系統性偏移。

### 3.2 模型烘焙（§4k GLB 管線）
1. 剝材質：去 gltf 的 `images`/`textures`/`samplers`/`materials`（+ primitive `material`），避免 Node `GLTFLoader.parse` 因無 DOM `createImageBitmap` 而拋錯（§4k 已知陷阱）。
2. `gltf-pipeline -i stripped.gltf -o <純幾何>.glb`（若遇 `~/.npm` 權限問題，`export npm_config_cache=<scratch>/npmcache`）。
3. 在 `MODEL_BAKE_CONFIG` 加 `儲槽` 條目：以 raw world bbox 驗 `upAxis`（讓槽站直；Sketchfab 多為 Y-up）；徑向對稱故 `forwardAxis` 任意（維持預設或設對齊最長水平軸）；`cellFrac` 控點數。
4. `npm run port:models` → 產出 `data/ship-models/儲槽.json`（烘後 `git checkout` 還原其餘船模 JSON，只留新檔，避免動時間戳）。
5. `data/models/CREDITS.md` 補一條 CC-BY-4.0 條目。

**命名/位置決定**：模板放 `data/ship-models/儲槽.json`（沿用起重機先例，少動 registry）。原始 `cylinder_Storage_Tank/` 保持 gitignore（`models/*`），只 commit 烘出的 JSON。

### 3.3 每座縮放（方案 A 核心）
- 模板經 `normalizeToUnit` → 主軸=1、min-y=0（貼地）。
- 每座 `scale = footprintRadius / templateUnitHorizontalRadius`，其中 `templateUnitHorizontalRadius` = 烘出的 unit 模板在水平面（x/z）的最大半徑（= 水平 extent ÷ 2，一次性由模板算出的常數）。如此模型水平半徑 = 該座真實 OSM footprint 半徑（世界單位，大槽大、小槽小）。
- `footprintRadius` 由既有 `footprintCentroidRadius(poly)`（`scene/landmarks.ts`）算出，回傳世界單位半徑，與現行 `kind:'cylinder'` 同源 → 縮放結果已是世界單位，無需再乘 `S`（起重機的 `scaleU:1.0*S` 是另一種用法，不套用於此）。
- **限制（可接受）**：OSM 無高度資料 → 高度隨半徑等比（維持模型自身高徑比），不追求真實高度。

### 3.4 `kind:'model'` 圖層擴充
- 擴充 `buildModelInstances`（`scene/landmarkModels.ts`）支援：
  - **per-instance scale**：接受每座的縮放值（由 footprint 半徑換算），取代目前單一 `scaleU`。
  - **免定向**：heading 可固定 0（徑向對稱看不出朝向），不需 `segs`/`land`/`craneBoomHeading`。
  - 保持與起重機的相容（起重機仍可用單一 scale + baked heading 路徑）。
- `scene/layers.ts` `'model'` 分支：tank 走「每座 footprint 半徑 → per-instance scale、heading 0」；起重機維持原路徑。
- `main.ts` tank 層設定：`kind:'cylinder'` → `kind:'model'`、`modelKey:'儲槽'`，其餘 tier/color/bloom 沿用。舊 `sampleCylinderShell` 先保留（缺模板時 fallback，或日後清理）。

### 3.5 點數預算
- 靜態層只建一次（非每幀）。目標每模板 ~400–800 點 × ~246 座 ≈ 100k–200k，用 `cellFrac` 調到接近船的視覺密度。層容量足夠（靜態層獨立於動態 shipPC）。

### 3.6 測試（TDD）
- `buildModelInstances` per-instance scale 純函式：給定 centers + 每座 scale → 每座點雲正確縮放且位移到中心；heading 0 不旋轉。
- 縮放換算：footprint 半徑 → scale 的公式（unit 水平半徑校正）。
- 烘焙產出：JSON 非空、點數在預算內、min-y≈0（貼地）。
- 引擎 `src/` 零改動；既有 `footprintCentroidRadius`/`sampleCylinderShell` 測試不動。

---

## 4. 決定摘要（使用者已確認）
- **(a)** 位置驗證診斷 baker 為**一次性 temp**，非常駐 npm script。
- **(b)** 模板放 `data/ship-models/儲槽.json`。
- **(c)** 高度隨半徑等比（無 OSM 高度資料）。
- **(d)** **先全部圓柱**；球形模型延後。
- **(e)** 縮放 = 每座依 footprint 半徑（方案 A）。

## 5. 範圍外（延後 / 不做）
- 球形儲槽模型與圓柱/球形分類（延後）。
- 以航照偵測圓形重建座標（不做；信任 OSM + 目視核對）。
- 起重機重新啟用（無關）。

## 6. 成功標準
- 重抓 OSM 後位置疊圖目視通過（無系統性偏移）。
- 場景中 246 座儲槽為真實圓柱點雲模型、大小依真實半徑分布、貼地站直。
- tsc 0、測試綠、build ok、瀏覽器目視通過、引擎 `src/` 零改動。
- CREDITS.md 記錄 CC-BY-4.0。

## 7. 風險
- **OSM 重抓可能改變 tank 數或引入新誤差** → 靠 3.1 疊圖核對把關；重大偏差先回報。
- **烘焙 `upAxis` 判錯 → 槽躺平** → 以 raw bbox 驗證軸向（§4k 已知,船模曾因軸向錯而躺平/8× 膨脹）。
- **縮放校正係數 K 抓錯 → 全部過大/過小** → 用模板正規化後水平半徑推算並在瀏覽器目視校正。
- **點數過高** → `cellFrac` 調降。

## 8. 相關檔案
- 現況：`examples/kaohsiung-port/scene/landmarks.ts`（`footprintCentroidRadius`/`sampleCylinderShell`）、`examples/kaohsiung-port/main.ts`（`LAYERS` tank 條目）、`examples/kaohsiung-port/data/osm.ts` + `fetch-osm.ts`。
- 管線：`examples/kaohsiung-port/data/fetch-ship-models.ts`、`scene/shipModels.ts`、`scene/meshSampling.ts`、`scene/meshTriangles.ts`、`scene/landmarkModels.ts`、`scene/layers.ts`。
- 素材：`examples/kaohsiung-port/data/models/cylinder_Storage_Tank/`。
- 參考：dev-guide §4k（GLB 船管線）、§4m（多視圖）、handoff 2026-06-29 起重機節（`kind:'model'` 由來）。
