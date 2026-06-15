# 高雄港數位孿生 — NLSC 航照底圖(戰情室染暗) · 設計文件

- **日期**:2026-06-15
- **狀態**:設計已確認,待寫實作計畫
- **目標**:把高雄港孿生現有的「離線手繪海圖 plane」(`buildMapPlane()`,canvas 畫 OSM 線稿)**升級為真實 NLSC 正射航照底圖**,並以「戰情室染暗」呈現,讓 3D 場景坐落在可辨識的真實港區影像上。
- **範圍邊界**:本 spec 是「類數位孿生 3D UI 展示」四條工作流中的 **F2(衛星/航照底圖)**,只涵蓋底圖本身。其餘三條 —— F0 戰情室視覺基礎(bloom/主題/三屏版面/水面)、F3 碼頭編號標籤、F1 真實 AIS 航跡 —— **各自另立 spec**,不在本文件範圍。

---

## 1. 背景與動機

現有孿生的「C 地圖底圖」是 `examples/kaohsiung-port/main.ts` 的 `buildMapPlane()`:在 1024² canvas 上以純色背景畫 OSM 海岸線/碼頭線,當作場景地面平面(預設隱藏,可切換)。它離線、零依賴,但只是線稿,缺乏真實地貌。

研究(2026-06-15,見對話紀錄)確認:
- **政府站 A**(內政部海洋 3D 圖臺)本身就用 **NLSC 國土測繪中心 WMTS** 當底圖 —— 我們採同源、官方、免費、在地高解析的影像。
- 「3D 戰情室 / 數字孿生大屏」設計慣例為**暗藍 HUD 美學**;明亮日間航照會與暗色 HUD 打架、且會吃掉發光船點/航跡。

使用者在視覺輔助中比較四個真實底圖選項(NLSC 航照 / NLSC 電子地圖 / 航照+染暗 / Esri 衛星)後,選定 **「航照 + 戰情室染暗」**:保有航照辨識度,又能融入暗色 HUD。

## 2. 已確認決策

| # | 決策 | 選擇 | 理由 |
|---|---|---|---|
| 1 | 影像來源 | **NLSC `PHOTO2` 正射航照 WMTS** | 免金鑰、官方、在地高解析;政府站 A 同源 |
| 2 | 外觀 | **戰情室染暗**(壓暗偏青,但保留航照辨識度) | 融入暗色 HUD,不壓死細節 |
| 3 | 圖磚架構 | **離線烘焙單張合成圖**(build 期拼接 → commit) | 可重現、無執行期金鑰/CORS;契合既有 frozen-snapshot 哲學 |
| 4 | 染暗時機 | **執行期材質著色**,不烘進檔案 | committed 資產=乾淨真實航照(誠實、可重用);外觀可調、可切明暗、F0 可換 shader |
| 5 | 拼接工具 | 腳本內用 **`sharp`**(新 devDependency) | 把多圖磚合成一張的標準做法;零依賴替代見 §10 |
| 6 | 預設與點雲 | 底圖**預設開**;海岸線點雲 `basePC` **保留**疊在航照上 | 航照是新主角;點雲是「LiDAR 數位孿生」身分,F0 再讓它發光 |

## 3. 資料來源

### NLSC 正射影像 → 國土測繪中心 WMTS(免金鑰)
- RESTful 圖磚模板:`https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{y}/{x}`
- TileMatrixSet = `GoogleMapsCompatible`(`EPSG:3857` Web Mercator,標準 slippy z/x/y,惟路徑順序為 `{z}/{y}/{x}`)。
- GetCapabilities(查可用 zoom 上限):`https://wmts.nlsc.gov.tw/wmts?SERVICE=WMTS&REQUEST=GetCapabilities&VERSION=1.0.0`
- 免註冊、免金鑰。標註慣例:**「資料來源:內政部國土測繪中心」**。
- 港區 bbox 沿用既有:`{ s: 22.53, w: 120.24, n: 22.64, e: 120.34 }`。
- 縮放層級:**z15**(港區約 10×11=110 張圖磚 → 合成約 2560×2816 px,JPEG 約 2–4 MB)。腳本以 GetCapabilities 驗證 z15 可用,缺磚即失敗。

## 4. 範圍

**本次要做:**
- 純邏輯模組 `geo/tiles.ts`(slippy tile 數學)+ 單元測試。
- 建置腳本 `data/fetch-basemap.ts`(`npm run port:basemap`):下載 NLSC PHOTO2 圖磚 → 拼接 → 輸出 `data/basemap-khh.jpg` + `data/basemap-khh.json`(合成圖實際地理邊界)。
- 改寫 `main.ts` 的 `buildMapPlane()`:載入合成航照圖貼到對齊的 PlaneGeometry + 執行期染暗 + 切換 + 載入失敗 fallback。
- committed 資產:`data/basemap-khh.jpg`、`data/basemap-khh.json`。

**本次不做(YAGNI / 後續):**
- 線上即時圖磚、無限縮放、線上/離線混合模式(見 §10)。
- Mercator↔等距投影的精確校正(港區尺度差 <0.5%,忽略)。
- 多 zoom LOD / 多解析度 mipmapped 圖磚金字塔。
- F0/F1/F3 的內容(發光、水面、標籤、AIS)。

## 5. 架構

### 5.1 資料流
```
[建置期 · npm run port:basemap]
  NLSC PHOTO2 WMTS (z15, bbox)
     │  geo/tiles.ts: tileRangeForBbox(bbox, 15)
     ▼  下載 10×11 圖磚 ──sharp 拼接──▶
     ├─▶ data/basemap-khh.jpg    (乾淨真實航照,不染色)
     └─▶ data/basemap-khh.json   { z, bbox, tileRange, bounds:{n,s,e,w}, sizePx:{w,h} }
[執行期 · 瀏覽器]
  import url + bounds ──▶ TextureLoader(jpg, SRGBColorSpace)
     ▼  PlaneGeometry(用 bounds 四角經 proj.toWorld 定尺寸/位置,同既有手法)
     ▼  MeshBasicMaterial({ map, color: 0x3a5a72 })   ← 染暗=color 相乘;白色=原始明亮
     ▼  engine.addLayer(plane);  預設 visible=true;  地圖底圖鈕切換
```

### 5.2 純邏輯模組 `geo/tiles.ts`(有單元測試)
標準 Web-Mercator slippy 數學,純函式、無 I/O:
- `lonLatToTile(lon, lat, z): { x, y }`(浮點,floor 取整數圖磚)
- `tileToLonLat(x, y, z): { lon, lat }`(回傳該圖磚**左上角**經緯度)
- `tileRangeForBbox(bbox, z): { xMin, xMax, yMin, yMax }`(含端覆蓋整個 bbox)
- `compositeBounds(range, z): { bounds:{ n, s, e, w }, sizePx:{ w, h } }`(整數圖磚邊界 + 像素尺寸,256/磚)

### 5.3 建置腳本 `data/fetch-basemap.ts`(不單元測試,如既有 fetch 腳本)
- 用 `geo/tiles` 算 range;逐磚 GET NLSC PHOTO2(重試+退避);**缺任一磚即 throw,不產破洞圖**。
- `sharp` 把各磚 composite 到 `sizePx` 空白畫布的對應 offset → 輸出 jpg(quality ~85)。
- 寫出 `basemap-khh.json` 中介資料(供執行期對齊)。
- 與 `port:fetch`/`port:osm` 並列加進 `package.json` scripts(`vite-node`)。

### 5.4 執行期改寫 `buildMapPlane()`
- `import basemapUrl from './data/basemap-khh.jpg'` + `import meta from './data/basemap-khh.json'`。
- 用 `meta.bounds` 四角經 `proj.toWorld` 求 plane 寬高與中心(沿用現有 sw/ne 算法),`rotation.x=-π/2`,`position.y=-0.5`。
- `MeshBasicMaterial({ map, color, transparent:true, opacity:1, depthWrite:false })`;`texture.colorSpace = SRGBColorSpace`。
- 切換沿用 `overlay` 的 `onBackdrop`;**初始 `visible=true`**、按鈕初始顯示「開」。
- `window.__twin.mapPlane` 沿用,另曝 `setBasemapTint(hex)` 供除錯/F0。

## 6. 測試策略
- `geo/tiles.ts`:vitest 單元測試 —— 已知座標對照(高雄港中心於 z15 的圖磚)、`lonLatToTile`↔`tileToLonLat` round-trip、`tileRangeForBbox` 完整覆蓋 bbox 四角、`compositeBounds` 像素尺寸與邊界。
- plane builder 薄、依賴 THREE/DOM,不強制單元測試;對齊數學若抽出可測則測。
- 維持 `npm test`(vitest)全綠、`npm run build` 與 `tsc --noEmit` 0 錯。

## 7. 錯誤處理
- **腳本**:圖磚下載失敗 → 重試(指數退避,上限 3 次);仍失敗 → throw 並列出缺磚,**不輸出半成品**。GetCapabilities 顯示 z15 不可用 → 明確報錯。
- **執行期**:`TextureLoader` 載入失敗 → `console.warn` + plane 維持隱藏(場景不崩);因資產為 committed 同源,正常情境不會發生。

## 8. 誠實邊界
- 航照為**真實 NLSC 正射影像**(標註「資料來源:內政部國土測繪中心」);「戰情室染暗」純屬呈現層,未竄改影像資料。
- 合成圖覆蓋**整數圖磚邊界**(略大於 bbox),`bounds` 已如實記錄供精確對齊。
- 影像為 **EPSG:3857 Web Mercator**,貼到本專案等距世界投影;港區尺度(約 12 km)失真 <0.5%,肉眼不可見,**不做校正**(已記錄)。
- 影像為**單一時點正射快照**(非即時);與既有 TWPort/OSM 快照同屬「凍結可重現」性質。

## 9. 檔案清單
| 動作 | 路徑 |
|---|---|
| 新增 | `examples/kaohsiung-port/geo/tiles.ts` |
| 新增 | `examples/kaohsiung-port/geo/tiles.test.ts` |
| 新增 | `examples/kaohsiung-port/data/fetch-basemap.ts` |
| 新增(committed 資產) | `examples/kaohsiung-port/data/basemap-khh.jpg` |
| 新增(committed 資產) | `examples/kaohsiung-port/data/basemap-khh.json` |
| 改寫 | `examples/kaohsiung-port/main.ts`(`buildMapPlane()` + 預設 visible) |
| 修改 | `package.json`(`port:basemap` script;`sharp` devDependency) |

## 10. 已確認的次要決策 / 實作微調項
- **`sharp` 依賴**:**已確認採用**(使用者 review 通過)。腳本內用 `sharp` 把圖磚 composite 成單張。(被否決的替代方案備存:「commit 圖磚集 + 瀏覽器端 canvas 拼接」,零新依賴但 commit ~110 個小檔。)
- **染暗色值**:`0x3a5a72` 為起始值,實作時對著場景微調;F0 階段可改為 shader-based 處理(scan-line/vignette)。
