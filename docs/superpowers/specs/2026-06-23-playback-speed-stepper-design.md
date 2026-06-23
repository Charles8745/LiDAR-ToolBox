# 設計 spec — 播放速度 stepper + toolbox 元件升級

- **日期**:2026-06-23
- **狀態**:設計定稿(使用者已核准),待寫 implementation plan
- **目標**:在高雄港戰情室時間軸加一個「播放速度」stepper(1–10 級,1=10%、10=100%,把今天的播放手感定為 80%=第 8 級),預設載入第 5 級;同時把 UI-ToolBox 新版 liquid-glass 重新 vendored 進專案,並把現有幾個原生控制項換成玻璃元件、移除一顆用不到的按鈕與一段 dead code。

---

## 1. 背景與動機

戰情室目前的 24h 時間軸播放是**固定速度**:[overlay.ts](../../../examples/kaohsiung-port/ui/overlay.ts) 底部時間軸列的 ▶ 按鈕用 `requestAnimationFrame` 迴圈,每幀把 slider 推進 `(max-min)/600`,約 60fps 下 **~10 秒掃完整段 24h**。使用者無法調快慢。

需求:加一個 **stepper** 控制播放速度,1–10 級。把**現在的速度定義為 80%(第 8 級)**,所以第 10 級(100%)比現在快 1.25×、第 1 級(10%)比現在慢。

順帶:UI-ToolBox 自 2026-06-15 vendored 進專案後又新增了「表單控制家族 A」(含 stepper)。藉這次需求把 vendored 版本更新,並把幾個現有原生控制項換成玻璃元件。

### 既有兩套播放機制(釐清)

1. **畫面上實際的 ▶ 按鈕** = [overlay.ts:179-189](../../../examples/kaohsiung-port/ui/overlay.ts#L179-L189) 的 RAF 迴圈。**這是使用者看到、要加速度控制的對象。**
2. [main.ts:287-295](../../../examples/kaohsiung-port/main.ts#L287) 的 `play()/pause()`(`setInterval` 80ms)**只掛在 `__twin` 給除錯、沒接到任何 UI 按鈕** = dead code。本案一併移除。

---

## 2. 範圍

### 功能 1 — 播放速度 stepper(核心)

**速度語意**
- Stepper 值 `S ∈ [1,10]`,整數,step 1,**預設 5**。
- 今天每幀推進 `(max-min)/600`,定義為 `S=8`(80%)。
- 新公式:**每幀推進 = `(max-min)/600 × S/8` = `(max-min) × S / 4800`**。
  - `S=8` → `/600`(今天手感)
  - `S=10` → `/480`(×1.25,最快)
  - `S=5` → `/960`(×0.625,預設載入)
  - `S=1` → `/4800`(×0.125,最慢)
- **即時生效**:播放中改速度,下一幀就套用,不重啟迴圈。
- **刻意後果**:預設載入第 5 級 → 載入後的播放比今天慢。這是設計決定,非 bug。

**純函式(可測接縫)**
- 新檔 `examples/kaohsiung-port/time/playback.ts`:
  ```ts
  export function advancePerFrame(rangeMs: number, step: number): number {
    return (rangeMs * step) / 4800;
  }
  ```
- 邊界測試:`step 1 → rangeMs/4800`、`step 8 → rangeMs/600`、`step 10 → rangeMs/480`、`step 5 → rangeMs/960`。

**元件 + 接線**
- `.lg-stepper`,markup:
  ```html
  <div class="lg lg-stepper" data-lg>
    <button type="button" class="lg-stepper__btn" data-lg-step="-1" aria-label="減速">
      <svg viewBox="0 0 256 256"><use href="#ph-minus"/></svg></button>
    <input class="lg-stepper__input" type="number" min="1" max="10" step="1" value="5" aria-label="播放速度">
    <button type="button" class="lg-stepper__btn" data-lg-step="1" aria-label="加速">
      <svg viewBox="0 0 256 256"><use href="#ph-plus"/></svg></button>
  </div>
  ```
- 位置:**底部時間軸列、▶ 播放鍵左邊**。**無百分比讀數**(1–10 數字本身即讀數)。
- −/+ 由 vendored 的 `initSteppers()`(document 層級委派,動態元素免逐一接線)呼叫 `stepUp/stepDown` + 派 `input`/`change`。
- overlay 監聽 number input 的 `input` 事件 → 更新閉包內 `speedStep` 變數。原生 `min/max` 負責夾值。
- 播放迴圈 `stepFn` 改為每幀讀 `speedStep`:`v += advancePerFrame(+slider.max - +slider.min, speedStep)`。

### 功能 2 — 重新 vendored liquid-glass + 元件替換

- **整檔同步** `examples/kaohsiung-port/ui/liquid-glass.css` 與 `liquid-glass.js` ← `~/Desktop/UI-ToolBox/`(新版含表單控制家族 A:stepper/slider/check/switch 等)。
- **index.html 補 Phosphor `<symbol>` 定義**:`#ph-minus`、`#ph-plus`、`#ph-check`(從 UI-ToolBox index.html 取對應 symbol)。現有 index.html 完全沒有 ph sprite(現有 ▶ 是 textContent、gauge 由 JS 畫),故必補。
- **替換 1 — 時間軸 slider**:`<input type=range>` → `.lg-slider`(玻璃滑桿)。
  - markup:`<div class="lg lg-slider" data-lg><input class="lg-slider__input" type="range" ...></div>`(**拿掉** toolbox 範例的 sun 圖示 → 純滑桿,免再加 symbol)。
  - 動態建立後呼叫 `LiquidGlass.behaviors.slider(input)` 接玻璃填色行為。
  - scrub 行為(`input` → `onScrub`)不變。
- **替換 2 — 船型篩選 checkbox**:原生 `<input type=checkbox>` → `.lg-check`。
  - 各類別**彩色小圓點保留**,塞進 `.lg-check__label` 內(`<span 彩色點></span>類別名`)。
  - 純 CSS,無需 JS。`change` 事件邏輯(加入/移除 `enabled` set)不變。
- **替換 3 — 底圖按鈕**:`.lg-btn` 切換鈕 → `.lg-switch`(開/關)。
  - markup:`<label class="lg-switch"><input type=checkbox checked><span class="lg-switch__track"><span class="lg-switch__thumb"></span></span>底圖</label>`。
  - 動態建立後呼叫 `LiquidGlass.behaviors.switchTension(label)` 接彈簧。
  - 切換 → `onBackdrop`/底圖顯隱邏輯不變。
- **刪除 — 檢視(船型↔狀態)按鈕**:移除 [overlay.ts:133-139](../../../examples/kaohsiung-port/ui/overlay.ts#L133-L139) 的 `viewBtn` 與 `ApiHandlers.onView`;main.ts 移除 `colorBy` 變數與 `onView` handler,UI **恆以船型上色**。status 上色路徑保留在 `__twin.updateShips(t,'status')` 供除錯(不留 UI 死按鈕);`updateShips` 簽章不變(`mode` 預設由呼叫端傳 `'type'`)。

### 功能 3 — 清理 dead code

- 移除 [main.ts:286-295](../../../examples/kaohsiung-port/main.ts#L286) 的 `play()`/`pause()`/`playTimer`;`__twin`(main.ts:321)拿掉 `play, pause` 兩個 key。overlay 的 RAF 迴圈成為唯一播放來源。

---

## 3. 不做(YAGNI / 明確排除)

- **不**顯示速度百分比讀數(使用者決定)。
- **不**把其餘新元件(OTP/Upload/Rating/Radio/Textarea)塞進戰情室。
- **不**為「檢視:船型↔狀態」做替換元件(直接刪)。
- **不**改速度公式的非線性(線性 `S/8` 即可)。
- **不**碰引擎 `src/`(全是 example 層 UI 改動)。

---

## 4. 整合風險與注意

- **重新 vendored 的外觀回歸風險**:新版 `liquid-glass.css` 可能改到現有面板用到的 class(`lg-btn / lg-card / lg-stat / lg-gauge / lg-navbar / lg-chart / lg-spark / lg-points / lg-value / lg-rail`)外觀。→ 重新 vendored 後**逐面板對照現況截圖目視 diff**,確認沒走樣再往下做。
- **`reviveGlass` 不受影響**:它在 [overlay.ts:206](../../../examples/kaohsiung-port/ui/overlay.ts#L206),**不在** liquid-glass.js;重新 vendored 不碰它。新加的 `data-lg` 元件(stepper/slider/switch)會被既有 `reviveGlass`/`attach` 的 `[data-lg]` 掃描自動涵蓋玻璃折射。
- **動態 behavior init**:`LiquidGlass.init()` 有 `inited` 守衛只跑一次([index.html:21](../../../examples/kaohsiung-port/index.html#L21) 觸發),overlay 在那之後才建 DOM → slider/switch 的**行為**(非玻璃)必須顯式呼叫 `LiquidGlass.behaviors.slider()` / `.switchTension()`;stepper −/+ 因是 document 委派**免**。
- **`theme.css` 變數覆寫**:戰情室靠 `ui/theme.css` 覆寫 glass 變數;impl 時確認新版 liquid-glass.css 沒改變數名導致覆寫失效。
- **input.value 型別**:stepper number input 的 `value` 是字串,讀取時 `parseInt`/`+`。

---

## 5. 測試策略

- **單元**(node test):`advancePerFrame(rangeMs, step)` 邊界 —— step 1/5/8/10 對應 `/4800`、`/960`、`/600`、`/480`。
- **目視**(`npm run dev` + 瀏覽器):
  1. 速度 1 / 5 / 8 / 10 播放時掃描快慢明顯不同;改速度即時生效不重啟。
  2. stepper 在 1 與 10 夾值(按不過界)。
  3. 時間軸 `.lg-slider` 拖曳 scrub 正常、玻璃填色顯影。
  4. 篩選 `.lg-check` 勾選切換正常、彩色點仍在。
  5. 底圖 `.lg-switch` 開/關切換底圖正常。
  6. 「檢視」按鈕已消失。
  7. 現有面板(KPI/gauge/趨勢/進港/navbar/詳情卡)外觀與現況一致、無走樣。
  8. `__twin` 無 `play/pause`;console 無 error(favicon 404 除外)。
- **型別 / 建置**:`npx tsc --noEmit` 0、`npm run build` 成功。

---

## 6. 受影響檔案(預估)

| 檔案 | 動作 |
|---|---|
| `examples/kaohsiung-port/time/playback.ts` | 新增 `advancePerFrame` 純函式 |
| `test/port-playback.test.ts`(或既有 time 測試檔) | 新增 `advancePerFrame` 邊界測試 |
| `examples/kaohsiung-port/ui/liquid-glass.css` | 整檔重新 vendored |
| `examples/kaohsiung-port/ui/liquid-glass.js` | 整檔重新 vendored |
| `examples/kaohsiung-port/index.html` | 補 `#ph-minus/#ph-plus/#ph-check` symbol |
| `examples/kaohsiung-port/ui/overlay.ts` | 加 stepper、slider→.lg-slider、check→.lg-check、bg→.lg-switch、刪 viewBtn、改 stepFn 讀速度、behaviors 接線 |
| `examples/kaohsiung-port/main.ts` | 刪 play/pause/playTimer、刪 onView/colorBy、`__twin` 調整 |

---

## 7. 開放項 / 未來可選

- 速度百分比讀數(本案刻意不做,日後想要可加 `速度 X%` 小字)。
- 其餘 toolbox 新元件(OTP/Upload/Rating 等)視需要再 dogfood。
