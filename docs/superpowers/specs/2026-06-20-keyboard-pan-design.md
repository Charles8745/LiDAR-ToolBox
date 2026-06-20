# 設計:方向鍵平移視角

- **日期**:2026-06-20
- **狀態**:設計定案(已與使用者確認),精簡流程直接實作
- **脈絡**:高雄港戰情室相機用 OrbitControls(orbit 模式 + 阻尼 + 縮放上下限)。目前只能滑鼠拖曳/縮放。新增**方向鍵平移**,讓使用者用 ↑↓←→ 把視角中心滑到港口不同區域。

## 目標

orbit 相機在按住 ↑↓←→ 時**沿地面平面持續、平順平移**視角中心:上/下=沿相機水平朝向前/後、左/右=側移;**無垂直(上下)分量**。滑鼠拖曳/縮放維持不變。

## 非目標(YAGNI)

- 不做旋轉/俯仰(使用者選 pan,非轉角度)。
- 不做 pan 邊界夾制(可無限平移,使用者自會平移回來)。
- 不做 Shift 切換模式、不做可調鍵位。

## 決策(經一輪目視回饋修正)

**自寫「持續、沿地面」平移**,不用 OrbitControls 內建鍵盤。內建是**每次按鍵離散一步**(靠 OS 按鍵重複,會頓)且用**螢幕空間平移**(斜視角下上/下鍵帶垂直分量,感覺怪)。改成:按住鍵 → 每幀沿**地面平面**滑動 → 平順、純水平。

## 架構(加法,引擎不破壞既有 API)

- **`src/core/LidarEngine.ts`**(既有,加):
  - `LidarEngineOptions` 新增 `keyboardPan?: boolean`(預設 `false`)、`keyPanSpeed?: number`(地面平移速度因子,預設 0.8 = 每秒移動約 0.8× 當前縮放距離)。
  - orbit 模式且 `keyboardPan` 為真:`window` 掛 keydown/keyup,維護一個「目前按住的方向鍵」Set(keydown 時 `preventDefault` 擋頁面捲動);render loop 每幀呼叫 `applyKeyboardPan(dt)`。
  - `applyKeyboardPan`:取相機朝向投影到地面(`getWorldDirection` → `y=0` → normalize)得「前」;`cross(前, worldUp)` 得「右」;`step = keyPanSpeed × 到 target 距離 × dt`(隨縮放等比,任何縮放層級手感一致);依按住的鍵把 `camera.position` 與 `controls.target` **同步位移**(保持 orbit 距離/角度)。`camera.position.y` 永不變。
  - `dispose()` 移除 keydown/keyup 監聽。
  - **洞穴 demo(`examples/basic`)不受影響**(預設關;且非 orbit 模式)。
- **`examples/kaohsiung-port/main.ts`**(既有,改):engine options 加 `keyboardPan: true, keyPanSpeed: 0.8`。

## 取捨 / 誠實邊界

- 監聽掛 `window`(全域),最穩定。唯一邊角:若焦點落在某 range 滑桿,方向鍵會同時動滑桿——實務罕見,可接受;日後嫌煩再改綁 canvas + `tabindex`。
- `keyPanSpeed` 為起始值,可在 console 或常數再調。

## 測試 / 驗證

- 此為設定透傳;引擎建構子需 `WebGLRenderer`,**無法 headless 單元測試**(與既有 `cameraMinDistance`/`cameraMaxDistance` 同性質)。
- 驗證 = **瀏覽器目視**:`npm run dev` → 按 ↑↓←→ 看視角中心平移、滑鼠拖曳/縮放仍正常、主控台無 error。
- `npm test`(177 綠)、`npx tsc --noEmit` 0 維持不變。
