# LiDAR 掃描引擎 — 設計文件

- **日期**:2026-06-13
- **狀態**:設計已確認,待寫實作計畫
- **目標**:打造一個可重用的「激光雷達掃描」引擎(函式庫),重現 *Scanner Sombre* 在黑暗中以彩色點雲逐步揭示空間的效果,並附一個可互動的範例 demo。應用場景留待引擎完成後再決定。

---

## 1. 動機與背景

*Scanner Sombre*(Introversion Software, 2017)的核心視覺:玩家身處全黑空間,手持 LiDAR 掃描器朝瞄準方向「每秒發射數千條射線」,命中場景幾何處生成**永久保存的彩色點**,顏色以彩虹漸層編碼到掃描器的距離。整個世界本質上是一團不斷長大、可達數百萬點的粒子雲,玩家用滑鼠「畫」出空間。

研究後歸納出三個技術家族:

| 家族 | 運作 | 特徵 |
|---|---|---|
| A. 射線+累積點雲 | 對真實幾何投射射線,命中處生成持久彩色點 | 可塗抹揭示、點堆積、最忠於原作 |
| B. 螢幕空間脈衝(shader) | 場景遮黑,用膨脹的世界座標球體遮罩顯示像素 | 聲納式脈衝、不堆積、像濾鏡 |
| C. 預計算點雲揭示 | 網格離線採樣成稠密點緩衝,GPU 繪製 | 撐百萬點、適合 web 沉浸式展示 |

本引擎以 **家族 A** 為靈魂(可互動累積),建構在 Three.js 上,並以模組化插槽吸納 B/C 的優點(脈衝發射器、可換配色)。

## 2. 範圍

**本次要做:**
- 一個建構在 Three.js 上的可重用掃描引擎核心。
- 三組預設「插槽」實作(程序場景、游標錐形發射器、彩虹深度配色)。
- 一個可互動的範例 demo,並能 live 切換插槽以證明可重用性。

**本次不做(YAGNI):**
- 不綁定任何特定真實 UI / 產品介面(應用後續再議)。
- 不做 VR、不做網路多人、不做關卡/遊戲邏輯。
- 不做 WebGPU compute 路徑(列為未來可能)。

## 3. 技術決定(已確認)

| # | 決定 | 選擇 | 理由 |
|---|---|---|---|
| 1 | 渲染底座 | **Three.js / WebGL** | 內建 `Raycaster`、`Points`/`BufferGeometry`、3D 相機;生態成熟,Scannable 只是可抽換 mesh |
| 2 | 開發語言 | **TypeScript** + Vite,輸出 ES module | 函式庫需要型別保障使用者與內部接點 |
| 3 | 射線命中 | **`Raycaster` + `three-mesh-bvh`** | BVH 讓每幀對任意網格打數百~上千射線可行;能掃任何 glTF,不只程序場景 |
| 4 | 配色 | **shader + 距離 LUT** | 距離存成 per-point attribute,顏色在 GPU 查可抽換 LUT 材質 → 可 live 換色、效能佳 |
| 5 | 持久模式 | **`accumulate`(預設)** + `fade` | accumulate 忠於原作;fade 用「年齡 attribute + 時間 uniform」在 shader 算 |

**依賴:** `three`、`three-mesh-bvh`;開發:`vite`、`typescript`、`vitest`。

## 4. 架構

固定的**核心管線** + 三個可抽換**插槽**。換插槽即套不同應用,核心寫一次共用。

```
[Scannable 場景源]→[Scan Emitter 發射器]→[Raycaster 命中]→[Point Store 累積]→[Renderer 渲染]→[Color Ramp 配色]
      ↑插槽                  ↑插槽              核心            核心           核心          ↑插槽
```

- **Scannable(插槽)**:被掃描的幾何,一組帶 BVH 的 `THREE.Object3D`。預設為程序生成洞穴;另提供 glTF 載入器。
- **Scan Emitter(插槽)**:每幀依瞄準狀態產生一批射線。預設 `cursorCone`;另含 `autoSweep`、`pulseRing`。
- **Raycaster(核心)**:`RaycastSampler` 用 three-mesh-bvh 求命中點與距離。
- **Point Store(核心)**:`PointCloud` 持有 GPU 環狀緩衝(FIFO);純邏輯部分抽到 `RingBuffer`。
- **Renderer(核心)**:單一 `THREE.Points` + 自訂 ShaderMaterial;相機投影、可選餘暉/淡出。
- **Color Ramp(插槽)**:距離→顏色的 LUT 材質;預設 `rainbowDepth`,另含 `thermal`、`monoNeon`。

## 5. 資料流(每幀)

1. **Emitter** 依目前瞄準/相機狀態產生一批射線(origin + 多個方向,如游標錐形內隨機 ~400 條)。
2. **RaycastSampler** 將射線打到 Scannable,回傳命中點座標 + 到掃描器的距離。
3. **PointCloud** 將命中點寫入預配置 GPU 環狀緩衝(位置、距離、年齡各為 attribute);寫滿則從最舊覆蓋(FIFO = 點數預算)。每幀僅標記更新被寫入的區段,不重傳整個緩衝。
4. **Renderer** 用自訂 shader 繪製:顏色於 GPU 由「距離 attribute」查 Ramp LUT 求得;`fade` 模式時依「年齡 + 時間 uniform」調整 alpha。

## 6. 對外 API

```ts
import { LidarEngine, emitters, ramps, scannables } from 'lidar-engine';

const engine = new LidarEngine({
  canvas:      document.querySelector('#view'),
  scannable:   scannables.proceduralCave(),                                // 插槽
  emitter:     emitters.cursorCone({ halfAngle: 0.1, raysPerFrame: 400 }), // 插槽
  ramp:        ramps.rainbowDepth,                                         // 插槽
  pointBudget: 500_000,
  persistence: 'accumulate',  // 或 'fade'
});

engine.start();

// 執行期控制
engine.aimAt(clientX, clientY);   // 螢幕座標 → 瞄準方向
engine.look(dx, dy);              // 拖曳環顧
engine.clear();                   // 清空點雲
engine.setRamp(ramps.thermal);    // 即時換色(不重掃)
engine.setEmitter(emitters.pulseRing({ speed: 8 }));
engine.pause(); engine.resume();
engine.dispose();

engine.pointCount;                // 目前點數
```

**插槽公開介面(使用者可自訂):**
```ts
interface Scannable { objects: THREE.Object3D[]; }                 // 帶 BVH 的網格
interface Emitter   { emit(ctx: EmitContext): Ray[]; }             // 每幀產生射線
type      ColorRamp = THREE.Texture | ((dist01: number) => RGB);   // 距離→色
type      Ray       = { origin: THREE.Vector3; direction: THREE.Vector3 };
```

## 7. 範例 demo(`examples/basic`)

- **用真實 THREE 網格**搭的程序生成洞穴/走廊場景(故意用真 mesh,確保走真實 raycast+BVH 路徑,與未來掃 glTF 同一條路)。
- 預設**游標錐形掃描**(`cursorCone`)。載入時的「自動掃掠」由 demo 程式以 Lissajous 軌跡呼叫 `engine.aimAt()` 驅動,使用者一動滑鼠即接手——`cursorCone` 本身保持單純;另有獨立的 `autoSweep` 發射器供無人操作展示用。拖曳可環顧四周。
- 輕量 HUD,**現場展示可重用性**:按鈕 live 切換配色(彩虹/熱感/霓虹)、切換發射器(錐形/脈衝環)、清空、切 accumulate/fade;角落顯示點數與 FPS。
- 此 demo 同時驗證:(a) Scanner Sombre 風格效果可運行;(b) 抽換插槽即變化。

## 8. 專案結構

```
lidar-engine/
  src/
    index.ts              # 對外匯出
    core/
      LidarEngine.ts      # 協調者:render loop + 相機 + 對外方法
      PointCloud.ts       # GPU 環狀緩衝 + 自訂 ShaderMaterial
      RaycastSampler.ts   # three-mesh-bvh 射線命中封裝
      RingBuffer.ts       # 純邏輯:寫頭/環繞/預算(可測,不碰 GPU)
      types.ts            # Scannable / Emitter / ColorRamp / Ray
    emitters/             # cursorCone, autoSweep, pulseRing, index
    scannables/           # procedural(範例洞穴), gltf(載入器), index
    ramps/                # rainbowDepth, thermal, monoNeon (LUT 材質), index
    shaders/              # points.vert.glsl, points.frag.glsl
  examples/basic/         # index.html + main.ts + HUD
  test/                   # 單元測試
  package.json / tsconfig.json / vite.config.ts
```

## 9. 測試策略

對純邏輯做 TDD,渲染做煙霧測試:

- **`RingBuffer`**(單元):寫頭前進、滿了環繞覆蓋、點數封頂、只標記更新到的區段。
- **Emitters**(單元):固定種子 RNG 下,`cursorCone` 射線落在錐角內、`pulseRing` 半徑遞增、數量正確。
- **Ramps**(單元):LUT 在關鍵停點取樣出預期顏色。
- **`RaycastSampler`**(單元,headless):對已知盒/面網格打射線,驗證命中點與距離(raycasting 為 CPU 數學,不需 WebGL)。
- **渲染/相機/shader**(視覺煙霧):以 `examples/basic` 人工驗證;另加 headless 測試確認引擎 boot 不丟錯。

## 10. 效能預算

- 目標 **60fps**。預設 `raysPerFrame ≈ 400`、`pointBudget = 500k`(可調至百萬級)。
- **單一 `THREE.Points` draw call**;每幀僅上傳新寫入的緩衝區段。
- 記憶體:500k 點 ×(位置3 + 距離1 + 年齡1)float ≈ **10MB**。
- 避免每幀配置:重用 typed array 與射線池。

## 11. 錯誤處理

- 無 WebGL2:丟出明確錯誤。
- 空場景 / 全 miss:不新增點,不當機。
- canvas resize:更新相機長寬比與渲染尺寸。
- `dispose()`:釋放幾何、材質、BVH、事件監聽。

## 12. 未來可能(非本次範圍)

- WebGPU compute 發射/累積路徑(爆量點數)。
- 圖片 + 深度圖的 Scannable。
- 接上真實產品 UI 作為應用層。
