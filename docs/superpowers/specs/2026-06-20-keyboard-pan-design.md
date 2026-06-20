# 設計:方向鍵平移視角

- **日期**:2026-06-20
- **狀態**:設計定案(已與使用者確認),精簡流程直接實作
- **脈絡**:高雄港戰情室相機用 OrbitControls(orbit 模式 + 阻尼 + 縮放上下限)。目前只能滑鼠拖曳/縮放。新增**方向鍵平移**,讓使用者用 ↑↓←→ 把視角中心滑到港口不同區域。

## 目標

orbit 相機在按 ↑↓←→ 時**平移(pan)**視角中心到港口不同區域;滑鼠拖曳/縮放維持不變。

## 非目標(YAGNI)

- 不做旋轉/俯仰(使用者選 pan,非轉角度)。
- 不做 pan 邊界夾制(可無限平移,使用者自會平移回來)。
- 不做 Shift 切換模式、不做可調鍵位。

## 決策

**用 OrbitControls 內建鍵盤平移**,不自寫。內建已正確處理螢幕空間平移(依相機朝向換算 world 位移),`controls.listenToKeyEvents(domElement)` + `controls.keys`(預設 `ArrowUp/Down/Left/Right`)+ `controls.keyPanSpeed`。自寫 pan 需重做投影/螢幕→world 數學,無必要。

## 架構(加法,引擎不破壞既有 API)

- **`src/core/LidarEngine.ts`**(既有,加):
  - `LidarEngineOptions` 新增 `keyboardPan?: boolean`(預設 `false`)、`keyPanSpeed?: number`(可選)。
  - orbit 模式建立 controls 後:`if (opts.keyboardPan) { this.controls.listenToKeyEvents(window); if (opts.keyPanSpeed !== undefined) this.controls.keyPanSpeed = opts.keyPanSpeed; }`。
  - **洞穴 demo(`examples/basic`)不受影響**(預設關;且非 orbit 模式)。
- **`examples/kaohsiung-port/main.ts`**(既有,改):engine options 加 `keyboardPan: true, keyPanSpeed: 25`(內建 7px 偏慢,港口世界大 → 調大讓平移有感)。

## 取捨 / 誠實邊界

- 監聽掛 `window`(全域),最穩定。唯一邊角:若焦點落在某 range 滑桿,方向鍵會同時動滑桿——實務罕見,可接受;日後嫌煩再改綁 canvas + `tabindex`。
- `keyPanSpeed` 為起始值,可在 console 或常數再調。

## 測試 / 驗證

- 此為設定透傳;引擎建構子需 `WebGLRenderer`,**無法 headless 單元測試**(與既有 `cameraMinDistance`/`cameraMaxDistance` 同性質)。
- 驗證 = **瀏覽器目視**:`npm run dev` → 按 ↑↓←→ 看視角中心平移、滑鼠拖曳/縮放仍正常、主控台無 error。
- `npm test`(177 綠)、`npx tsc --noEmit` 0 維持不變。
