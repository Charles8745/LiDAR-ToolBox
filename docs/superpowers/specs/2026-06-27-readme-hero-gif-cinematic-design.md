# 設計 — README hero GIF 重錄(電影感三拍運鏡:遠景→特寫)

- **日期**:2026-06-27
- **狀態**:設計定案,待寫實作計畫
- **動機**:現有 README hero GIF(`docs/assets/kaohsiung-warroom.gif`,1100×557、12 格、6/20 製)是**立體船上線前**的舊版 UI。重錄成一段**電影感連續運鏡**:從全港遠景一路推進到繁忙碼頭的立體點雲船海特寫,當作專案的 hero。

## 已定決策(brainstorm 拍板,別重新討論)

1. **特寫收尾(money shot)= 最豐富的繁忙船群**:停在實拍勘景找到的密集大船叢集 `(x≈-2.4, z≈22)`(17 艘 / 10 艘大船:油品/散雜/貨櫃/客運 + 工作/其他),展示這次做的 3D 立體點雲船陣容。
2. **純場景,無 HUD**:擷取前**隱藏戰情室 DOM 疊層**(玻璃面板/趨勢/即將進港/篩選/時間軸)。整段是乾淨的 3D 場景。
3. **碼頭編號標籤隱藏**:特寫近距離會觸發的 troika 碼頭標籤(`57/58/…`,場景元素非 HUD)在擷取前**隱藏**(`__twin.labels`),最純粹的 ship-海。
4. **AIS 時間以最慢速度緩緩前進**:從峰值時刻(`nowMs`,在港 280 艘)起跳,每格推進 = app 最慢檔(step 1)的量 `dtMs = (toMs−fromMs)/4800 ≈ 18s/格`,全片約推進 ~14 分 AIS 時間 → 船沿真實航跡**微漂**(有生命感、不喧賓奪主)。`dtMs` 可微調。
5. **三拍連續運鏡(非硬切)**:三個相機 keyframe 之間做 **ease-in-out 連續插值**(慢起→中段加速俯衝→慢收貼近),全程單一 dolly。
6. **loop 用淡出黑收尾**:結尾數格淡出黑、開頭數格淡入,循環無縫、避免「特寫硬跳回遠景」。

## 相機 keyframe(實拍勘景座標,世界單位)

| 拍 | pos `(x,y,z)` | target `(x,y,z)` | dist | 畫面 |
|---|---|---|---|---|
| **K0 遠景定場** | `(2, 205, 270)` | `(-2, 0, 60)` | ≈293 | 高空鳥瞰全港:水道/錨地輪廓 + 沿碼頭彩色船海 + 地形底圖 |
| **K1 俯衝下降+微轉** | `(10, 92, 152)` | `(-2, 1, 44)` | ≈142 | 傾斜俯衝,船沿碼頭線一字排開,往密集區壓低 |
| **K2 推進特寫** | `(13, 5.5, 47)` | `(-2.4, 1.6, 24)` | ≈28 | 低角度貼近大船叢集(青客運/白灰/琥珀油品散雜貨櫃) |

- **插值**:對 pos 與 target 各自用 **Catmull-Rom**(控制點 K0,K1,K2,端點用鏡像 phantom 求切線),參數 `s = smootherstep(frameIndex/(N−1))`(慢-快-慢)。每格得一組 `{pos, target}` → `camera.position.set` + `controls.target.set` + `controls.update()`。
- `controls.maxDistance` 擷取期暫設大值(如 2000),避免遠景 keyframe 被 dolly 夾回。

## 輸出規格

| 項目 | 值 |
|---|---|
| 檔案 | `docs/assets/kaohsiung-warroom.gif`(**覆寫**,README line 9 連結不變)|
| 解析度 | ~1000×500(由擷取畫面 `sharp` 縮放;維持寬螢幕比例)|
| 格數 / fps | **~45 格 @ 15fps ≈ 3 秒** loop |
| 調色盤 | gifenc,**≤128 色**(暗底 + 彩色點/bloom,調色盤壓縮率高)|
| 檔案大小 | 目標 **~3–4MB**(B 的時間前進使每格不同 → 比舊版 12 格肥);超標就降格數(→36)/解析度(→900×456)/色數,**以 README 友善為準** |

## 製作管線(一次性工具,產出後清掉)

沿用 6/20 那套精神(無 ffmpeg/IM → 純 JS):

1. **準備**:`npm run dev` → 開頁;隱藏 HUD 疊層 + `__twin.labels`;暫停引擎 RAF(改逐格手動 render);`maxDistance=2000`。
2. **逐格擷取**(N 格):算 `s=smootherstep(i/(N−1))` → Catmull-Rom 取 `{pos,target}` → 設相機;`__twin.refresh(nowMs + i*dtMs)`(慢速時間)→ **同步 render 一格** → 取畫面。
   - **主方法(in-page)**:讀 `engine.renderer.domElement.toDataURL('image/png')`(render 後同步讀)。**首格先驗證非空白**(WebGL 若無 `preserveDrawingBuffer` 可能讀到空 → 改用 fallback)。
   - **fallback**:controller 用 chrome-devtools `take_screenshot` 逐格存檔(HUD 已隱藏,畫面即場景;捕捉 bloom 最忠實,但 N 次 round-trip 較慢)。
3. **淡出黑**:最後 ~3 格的 RGB × 漸降係數(→0);開頭 ~2 格淡入。
4. **組裝**:`sharp` 解碼/縮放各格 → **`gifenc`(純 JS,重新加 devDependency)** 量化調色盤 + 編碼 → 寫 `docs/assets/kaohsiung-warroom.gif`。
5. **清理**:刪一次性擷取/編碼腳本 + 暫存幀 + `gifenc` devDep,`package.json` 回乾淨(僅留 commit 的 `.gif`)。引擎 `src/` 與 example 程式**零改動**(純資產更新)。

## README

- `README.md` line 9 圖片連結**不變**(同檔覆寫)。line 18「Operate it」操作說明仍適用(互動把手未變),不需改。
- commit 只含 `docs/assets/kaohsiung-warroom.gif`(+ 若有暫時的 package.json 變動須在清理後還原)。

## 驗證

- 純函式 `smootherstep` + Catmull-Rom keyframe 插值可單元測試(給定 s=0/0.5/1 → 回 K0/K1/K2;單調、連續),若做成暫存腳本則至少自測印幾個取樣點。
- **最終驗證 = 目視 GIF**:三拍連續、無 HUD、無碼頭標籤、船微漂、淡出黑 loop 無縫;`sips` 確認 dims 與**檔案大小 ≤ 目標**;在 README 預覽(或 GitHub)確認 hero 顯示正常。

## 限制 / 風險

- **WebGL 空白擷取**:`toDataURL` 在無 `preserveDrawingBuffer` 時可能空白 → 已備 chrome-devtools 螢幕擷取 fallback(首格即驗證)。
- **檔案大小**:時間前進讓每格差異大、調色盤壓縮率下降;若 >~4MB,優先降格數再降解析度,最後降色數。
- 一次性工具(同 6/20)→ 不留永久測試/程式;hero 是視覺產物,品質由目視把關。
