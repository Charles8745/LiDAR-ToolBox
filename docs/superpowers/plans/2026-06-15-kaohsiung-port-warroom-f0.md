# F0 戰情室視覺基礎 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把高雄港孿生升級成暗色 IOC 指揮中心大屏 —— 3D 做 selective bloom + fog,HUD 用 Liquid Glass Kit 重建成命令中心版面(中性炭灰配色)。

**Architecture:** 引擎以「加法、預設關」方式新增 post-processing(`postfx.ts` 選擇性泛光 + 自訂點 shader 支援 three 內建 fog),洞穴 demo 行為不變。App 端 vendored Liquid Glass Kit,重寫 `overlay.ts` 為玻璃指揮介面(維持既有 `OverlayApi`/`OverlayHandlers` 介面契約 + 新增 `setTrend`/`setIncoming`),所有面板數字由現有 `intervals` 真實算出(零造假)。

**Tech Stack:** TypeScript · Three.js 0.171(`examples/jsm/postprocessing/*`)· Vite · Vitest(node env)· Liquid Glass Kit v0.1(零依賴 vendored CSS/JS)。

**Spec:** [specs/2026-06-15-kaohsiung-port-warroom-f0-design.md](../specs/2026-06-15-kaohsiung-port-warroom-f0-design.md)

---

## File Structure

**引擎(`src/`,加法擴充,洞穴 demo 不受影響)**
- `src/shaders/points.vert.glsl` / `points.frag.glsl` — 加 three 內建 fog chunks(`USE_FOG` 未定義時編譯為空 → 預設無行為改變)。
- `src/core/PointCloud.ts` — ShaderMaterial 加 `fog: true`(預設惰性)。
- `src/core/postfx.ts` — **新增**:`BLOOM_LAYER`、`hideNonBloomed`/`restoreHidden`(node 可測純函式)、`createSelectiveBloom`(composer 工廠,瀏覽器驗證)。
- `src/core/LidarEngine.ts` — 加 `bloom`/`fog` options、`addLayer(obj,{bloom})`、composer 渲染路徑。
- `src/index.ts` — 匯出 postfx 公開面。

**App(`examples/kaohsiung-port/`)**
- `time/occupancy.ts` — 加 `buildOccupancyTrend`、`buildIncomingList`(node 可測純函式)。
- `ui/liquid-glass.css` / `ui/liquid-glass.js` — **新增**:vendored Kit v0.1(複製)。
- `ui/theme.css` — **新增**:配色 token + `--lg-*` 覆寫 + `fade-rise`。
- `ui/overlay.ts` — 重寫為 Liquid Glass 指揮介面。
- `main.ts` — 接線:bloom 層、fog、底圖 re-tint、餵 trend/incoming。
- `index.html` — 載 kit/theme、`data-lg-theme="dark"`、頁面 bg。

**測試(`test/`,flat,node env)**
- `test/PointCloud.test.ts` — 加 fog 旗標斷言。
- `test/postfx.test.ts` — **新增**:hide/restore 純函式。
- `test/exports.test.ts` — 加 postfx 匯出斷言。
- `test/port-derive.test.ts` — **新增**:trend + incoming 純函式。

---

## Task 1: 點 shader 支援 three 內建 fog(預設惰性)

**Files:**
- Modify: `src/shaders/points.vert.glsl`
- Modify: `src/shaders/points.frag.glsl`
- Modify: `src/core/PointCloud.ts:58-75`(ShaderMaterial 建構)
- Test: `test/PointCloud.test.ts`(append)

- [ ] **Step 1: Write the failing test** — append to `test/PointCloud.test.ts`:

```ts
describe('PointCloud fog flag', () => {
  it('enables three built-in fog on the material (inert until scene.fog is set)', () => {
    const pc = new PointCloud({ capacity: 2, ramp, persistence: 'accumulate' });
    expect((pc.points.material as THREE.ShaderMaterial).fog).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/PointCloud.test.ts -t "fog flag"`
Expected: FAIL — `expected undefined to be true`(material.fog 預設 false/undefined）。

- [ ] **Step 3: Add fog chunks to the vertex shader** — `src/shaders/points.vert.glsl`. Add `#include <fog_pars_vertex>` directly above `void main() {`, and `#include <fog_vertex>` as the last line inside `main()` (after `gl_Position = ...;`). Result:

```glsl
attribute float aDistance;
attribute float aBirth;
attribute float aValue;

uniform float uTime;
uniform float uMaxDistance;
uniform float uPointSize;
uniform float uMaxPointSize;
uniform float uSizeAttenuation;

varying float vDist01;
varying float vValue01;
varying float vAge;

#include <fog_pars_vertex>

void main() {
  vDist01 = clamp(aDistance / uMaxDistance, 0.0, 1.0);
  vValue01 = clamp(aValue, 0.0, 1.0);
  vAge = uTime - aBirth;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  // Perspective-attenuated size, clamped so near points stay small dots.
  float sz = (uSizeAttenuation > 0.5) ? (uPointSize * (12.0 / max(-mvPosition.z, 0.001))) : uPointSize;
  gl_PointSize = clamp(sz, 1.0, uMaxPointSize);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
```

- [ ] **Step 4: Add fog chunks to the fragment shader** — `src/shaders/points.frag.glsl`. Add `#include <fog_pars_fragment>` above `void main()`, and `#include <fog_fragment>` as the last line inside `main()` (after `gl_FragColor = vec4(col, alpha);`). Result:

```glsl
uniform sampler2D uRamp;
uniform float uFade;          // 0 = accumulate, 1 = fade
uniform float uFadeDuration;  // seconds
uniform float uColorMode;     // 0 = color by distance, 1 = color by value

varying float vDist01;
varying float vValue01;
varying float vAge;

#include <fog_pars_fragment>

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  float soft = smoothstep(0.5, 0.38, d);

  float coord = mix(vDist01, vValue01, step(0.5, uColorMode));
  vec3 col = texture2D(uRamp, vec2(coord, 0.5)).rgb;
  float alpha = soft;
  if (uFade > 0.5) {
    alpha *= clamp(1.0 - vAge / max(uFadeDuration, 0.001), 0.0, 1.0);
    if (alpha < 0.01) discard;
  }
  gl_FragColor = vec4(col, alpha);
  #include <fog_fragment>
}
```

- [ ] **Step 5: Set `fog: true` on the material** — `src/core/PointCloud.ts`, in the `new THREE.ShaderMaterial({...})` block add `fog: true,` next to `transparent: true,`:

```ts
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: true,
      blending: THREE.NormalBlending,
      fog: true,
```

- [ ] **Step 6: Run tests to verify pass + no regression**

Run: `npx vitest run test/PointCloud.test.ts`
Expected: PASS（含新 fog 斷言 + 既有點雲測試全綠)。

- [ ] **Step 7: Commit**

```bash
git add src/shaders/points.vert.glsl src/shaders/points.frag.glsl src/core/PointCloud.ts test/PointCloud.test.ts
git commit -m "$(printf 'feat(engine): point shader supports three built-in fog (inert by default)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 2: postfx 選擇性泛光模組(純函式可測 + composer 工廠)

**Files:**
- Create: `src/core/postfx.ts`
- Test: `test/postfx.test.ts`

- [ ] **Step 1: Write the failing test** — create `test/postfx.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BLOOM_LAYER, hideNonBloomed, restoreHidden } from '../src/core/postfx';

function pts(): THREE.Points {
  return new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial());
}

describe('selective bloom visibility helpers', () => {
  it('hides non-bloom objects and leaves bloom-layer objects visible', () => {
    const scene = new THREE.Scene();
    const glow = pts(); glow.layers.enable(BLOOM_LAYER);
    const dim = pts();
    scene.add(glow, dim);

    const bloomLayer = new THREE.Layers(); bloomLayer.set(BLOOM_LAYER);
    const hidden: THREE.Object3D[] = [];
    hideNonBloomed(scene, bloomLayer, hidden);

    expect(glow.visible).toBe(true);
    expect(dim.visible).toBe(false);
    expect(hidden).toContain(dim);
    expect(hidden).not.toContain(glow);
  });

  it('restoreHidden re-shows everything and empties the list', () => {
    const dim = pts(); dim.visible = false;
    const hidden: THREE.Object3D[] = [dim];
    restoreHidden(hidden);
    expect(dim.visible).toBe(true);
    expect(hidden).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/postfx.test.ts`
Expected: FAIL — cannot resolve `../src/core/postfx`.

- [ ] **Step 3: Create `src/core/postfx.ts`**

```ts
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** Objects whose layers include BLOOM_LAYER glow; all others are hidden during the bloom pass. */
export const BLOOM_LAYER = 1;

export interface BloomOptions {
  strength?: number;
  radius?: number;
  threshold?: number;
}

/** Hide every mesh/points NOT on the bloom layer, recording them in `hidden` for restore. */
export function hideNonBloomed(scene: THREE.Object3D, bloomLayer: THREE.Layers, hidden: THREE.Object3D[]): void {
  scene.traverse((o) => {
    const r = o as THREE.Object3D & { isMesh?: boolean; isPoints?: boolean };
    if ((r.isMesh || r.isPoints) && o.visible && bloomLayer.test(o.layers) === false) {
      hidden.push(o);
      o.visible = false;
    }
  });
}

/** Re-show objects hidden by hideNonBloomed and empty the list. */
export function restoreHidden(hidden: THREE.Object3D[]): void {
  for (const o of hidden) o.visible = true;
  hidden.length = 0;
}

export interface SelectiveBloom {
  render(): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}

/** Two-pass selective bloom: bloom-layer objects glow; everything else is hidden during the bloom pass. */
export function createSelectiveBloom(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  opts: BloomOptions = {},
): SelectiveBloom {
  const size = renderer.getSize(new THREE.Vector2());
  const bloomLayer = new THREE.Layers();
  bloomLayer.set(BLOOM_LAYER);
  const hidden: THREE.Object3D[] = [];

  const renderPass = new RenderPass(scene, camera);
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(size.x, size.y),
    opts.strength ?? 0.9,
    opts.radius ?? 0.4,
    opts.threshold ?? 0.0,
  );

  const bloomComposer = new EffectComposer(renderer);
  bloomComposer.renderToScreen = false;
  bloomComposer.addPass(renderPass);
  bloomComposer.addPass(bloomPass);

  const mixPass = new ShaderPass(
    new THREE.ShaderMaterial({
      uniforms: {
        baseTexture: { value: null },
        bloomTexture: { value: bloomComposer.renderTarget2.texture },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform sampler2D baseTexture; uniform sampler2D bloomTexture; varying vec2 vUv; void main(){ gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv); }',
    }),
    'baseTexture',
  );
  mixPass.needsSwap = true;

  const finalComposer = new EffectComposer(renderer);
  finalComposer.addPass(renderPass);
  finalComposer.addPass(mixPass);
  finalComposer.addPass(new OutputPass());

  return {
    render() {
      hideNonBloomed(scene, bloomLayer, hidden);
      bloomComposer.render();
      restoreHidden(hidden);
      finalComposer.render();
    },
    setSize(width, height) {
      bloomComposer.setSize(width, height);
      finalComposer.setSize(width, height);
    },
    dispose() {
      bloomComposer.dispose();
      finalComposer.dispose();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/postfx.test.ts`
Expected: PASS（兩個案例綠)。

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/core/postfx.ts test/postfx.test.ts
git commit -m "$(printf 'feat(engine): selective-bloom postfx module (visibility-based, two-pass)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 3: 把 bloom/fog 接進 LidarEngine + 匯出

**Files:**
- Modify: `src/core/LidarEngine.ts`
- Modify: `src/index.ts`
- Test: `test/exports.test.ts`(append)

- [ ] **Step 1: Write the failing test** — append to `test/exports.test.ts` (and extend the import line):

```ts
import { BLOOM_LAYER, createSelectiveBloom } from '../src/index';

describe('bloom post-processing API', () => {
  it('exposes BLOOM_LAYER and createSelectiveBloom', () => {
    expect(BLOOM_LAYER).toBe(1);
    expect(typeof createSelectiveBloom).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/exports.test.ts -t "bloom post-processing"`
Expected: FAIL — `BLOOM_LAYER` 不是 export。

- [ ] **Step 3: Add postfx exports** — `src/index.ts`, append:

```ts
export { BLOOM_LAYER, createSelectiveBloom, hideNonBloomed, restoreHidden } from './core/postfx';
export type { BloomOptions, SelectiveBloom } from './core/postfx';
```

- [ ] **Step 4: Add options + import to LidarEngine** — `src/core/LidarEngine.ts`. Add import after the PointCloud import (line ~4):

```ts
import { createSelectiveBloom, BLOOM_LAYER, type SelectiveBloom, type BloomOptions } from './postfx';
```

Add two fields to `LidarEngineOptions` (after `autoScan?: boolean;`):

```ts
  fog?: { color?: number; near?: number; far?: number } | boolean;
  bloom?: BloomOptions | boolean;
```

Add a private field next to `private controls` (line ~44):

```ts
  private bloom: SelectiveBloom | null = null;
```

- [ ] **Step 5: Build fog + bloom in the constructor** — `src/core/LidarEngine.ts`, at the very end of the `constructor` (after the `if (opts.cameraMode === 'orbit') { ... } else { ... }` block):

```ts
    if (opts.fog) {
      const f = opts.fog === true ? {} : opts.fog;
      this.scene.fog = new THREE.Fog(f.color ?? 0x0b0c0e, f.near ?? far * 0.4, f.far ?? far * 1.2);
    }
    if (opts.bloom) {
      const b = opts.bloom === true ? {} : opts.bloom;
      this.bloom = createSelectiveBloom(this.renderer, this.scene, this.camera, b);
    }
```

(`far` is the `const far = opts.cameraFar ?? 500;` already declared earlier in the constructor.)

- [ ] **Step 6: Mark bloom layers in `addLayer`** — `src/core/LidarEngine.ts`, replace the existing `addLayer` method:

```ts
  /** Attach an app-owned object to the scene. `opts.bloom` makes it glow under selective bloom. */
  addLayer(obj: THREE.Object3D, opts?: { bloom?: boolean }): void {
    this.extraLayers.push(obj);
    if (opts?.bloom) obj.layers.enable(BLOOM_LAYER);
    this.scene.add(obj);
  }
```

- [ ] **Step 7: Route the render + resize + dispose through the composer** — `src/core/LidarEngine.ts`:

In `loop()`, replace `this.renderer.render(this.scene, this.camera);` with:

```ts
    if (this.bloom) this.bloom.render();
    else this.renderer.render(this.scene, this.camera);
```

In `resize()`, after the `this.renderer.setSize(...)` line add:

```ts
    if (this.bloom) this.bloom.setSize(c.clientWidth, c.clientHeight);
```

In `dispose()`, after `this.controls?.dispose();` add:

```ts
    this.bloom?.dispose();
```

- [ ] **Step 8: Run tests + type-check + full regression**

Run: `npx vitest run test/exports.test.ts && npx tsc --noEmit -p tsconfig.json && npm test`
Expected: 新匯出斷言 PASS;tsc 0 errors;`npm test` 全綠（既有 + postfx + fog,~96 測試)。

- [ ] **Step 9: Commit**

```bash
git add src/core/LidarEngine.ts src/index.ts test/exports.test.ts
git commit -m "$(printf 'feat(engine): opt-in bloom + fog options on LidarEngine (off by default)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 4: 真實衍生資料 — 24h 趨勢 + 進港清單(純函式)

**Files:**
- Modify: `examples/kaohsiung-port/time/occupancy.ts`(append)
- Test: `test/port-derive.test.ts`

- [ ] **Step 1: Write the failing test** — create `test/port-derive.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildIntervals, buildOccupancyTrend, buildIncomingList } from '../examples/kaohsiung-port/time/occupancy';
import type { VesselRecord } from '../examples/kaohsiung-port/data/twport';

function rec(p: Partial<VesselRecord>): VesselRecord {
  return { visaNo: '', nameZh: '', nameEn: '', shipType: '', wharfName: '', berthNo: null, status: '',
    etaMs: null, etdMs: null, actPortMs: null, leaveMs: null, beforePort: '', nextPort: '', imo: '',
    callSign: '', source: 'berthing', ...p };
}
const HOUR = 3600_000;

describe('buildOccupancyTrend', () => {
  const intervals = buildIntervals([
    rec({ berthNo: 1, actPortMs: 0, leaveMs: 4 * HOUR }),
    rec({ berthNo: 2, actPortMs: 2 * HOUR, leaveMs: 6 * HOUR }),
  ]);
  it('samples steps+1 in-port counts across [t0,t1]', () => {
    const trend = buildOccupancyTrend(intervals, 0, 6 * HOUR, 6);
    expect(trend).toHaveLength(7);
    expect(trend[0]).toBe(1);          // t=0 → berth 1
    expect(trend[3]).toBe(2);          // t=3h → berths 1 & 2
    expect(trend[6]).toBe(0);          // t=6h → both gone (end exclusive)
  });
  it('returns a single sample when steps < 1', () => {
    expect(buildOccupancyTrend(intervals, 0, 6 * HOUR, 0)).toEqual([1]);
  });
});

describe('buildIncomingList', () => {
  const intervals = buildIntervals([
    rec({ nameZh: '早', berthNo: 5, etaMs: 1 * HOUR, source: 'forecast' }),
    rec({ nameZh: '晚', berthNo: 6, etaMs: 3 * HOUR, source: 'forecast' }),
    rec({ nameZh: '過遠', berthNo: 7, etaMs: 9 * HOUR, source: 'forecast' }),
  ]);
  it('lists arrivals within the window, soonest first', () => {
    const list = buildIncomingList(intervals, 0, 4 * HOUR);
    expect(list.map((a) => a.vessel.nameZh)).toEqual(['早', '晚']);
    expect(list[0].etaMs).toBe(1 * HOUR);
    expect(list[0].berthNo).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/port-derive.test.ts`
Expected: FAIL — `buildOccupancyTrend`/`buildIncomingList` 不是 export。

- [ ] **Step 3: Append the two pure functions** — `examples/kaohsiung-port/time/occupancy.ts`:

```ts
/** In-port vessel count sampled at steps+1 evenly spaced times across [t0,t1]. */
export function buildOccupancyTrend(intervals: BerthInterval[], t0: number, t1: number, steps: number): number[] {
  if (steps < 1) return [occupancyAt(intervals, t0).size];
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((t1 - t0) * i) / steps;
    out.push(occupancyAt(intervals, t).size);
  }
  return out;
}

export interface IncomingArrival { berthNo: number; vessel: VesselRecord; etaMs: number; }

/** Vessels arriving within (tMs, tMs+windowMs], soonest first. */
export function buildIncomingList(intervals: BerthInterval[], tMs: number, windowMs: number): IncomingArrival[] {
  const out: IncomingArrival[] = [];
  for (const it of intervals) {
    if (it.startMs > tMs && it.startMs <= tMs + windowMs) {
      out.push({ berthNo: it.berthNo, vessel: it.vessel, etaMs: it.startMs });
    }
  }
  out.sort((a, b) => a.etaMs - b.etaMs);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/port-derive.test.ts`
Expected: PASS（全部案例綠)。

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/time/occupancy.ts test/port-derive.test.ts
git commit -m "$(printf 'feat(port): real 24h occupancy trend + incoming-list derivations\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 5: Vendored Liquid Glass Kit + theme.css

**Files:**
- Create: `examples/kaohsiung-port/ui/liquid-glass.css`(複製)
- Create: `examples/kaohsiung-port/ui/liquid-glass.js`(複製)
- Create: `examples/kaohsiung-port/ui/theme.css`

- [ ] **Step 1: Copy the kit (two files) into the project**

Run:
```bash
cp "/Users/charles88/Desktop/UI-ToolBox/liquid-glass.css" examples/kaohsiung-port/ui/liquid-glass.css
cp "/Users/charles88/Desktop/UI-ToolBox/liquid-glass.js" examples/kaohsiung-port/ui/liquid-glass.js
```
Expected: 兩檔出現在 `examples/kaohsiung-port/ui/`(`ls examples/kaohsiung-port/ui/` 應列出 liquid-glass.css / liquid-glass.js)。

- [ ] **Step 2: Create `examples/kaohsiung-port/ui/theme.css`**

```css
/* F0 戰情室主題 — 中性炭灰 (Ink Wash);UI 用銀鉻,飽和度留給船色。 */
:root {
  --ink: #F2F5F8;
  --ink-dim: #93A0AD;
  --signal-ok: #5FE39A;
  --signal-warn: #FF8A4D;
  /* Liquid Glass Kit token overrides */
  --lg-accent: #CBD5DF;
  --lg-text: #F2F5F8;
  --lg-tint: rgba(32, 36, 43, 0.55);
}
html, body { background: #0B0C0E; color: var(--ink); }
#overlay .lg, #overlay .lg-navbar, #overlay .lg-card, #overlay .lg-stat,
#overlay .lg-gauge, #overlay .lg-chart { color: var(--ink); }

@keyframes fade-rise {
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
}
.fade-rise { animation: fade-rise 0.6s ease-out both; }
@media (prefers-reduced-motion: reduce) { .fade-rise { animation: none; } }
```

- [ ] **Step 3: Sanity-check the kit attaches a global**

Run: `grep -c "window.LiquidGlass" examples/kaohsiung-port/ui/liquid-glass.js`
Expected: ≥ 1（確認 vendored 檔確實掛 `window.LiquidGlass`;若為 0,改抓 `LiquidGlass =` 確認全域名稱,後續 `index.html`/`overlay.ts` 依此調整)。

- [ ] **Step 4: Commit**

```bash
git add examples/kaohsiung-port/ui/liquid-glass.css examples/kaohsiung-port/ui/liquid-glass.js examples/kaohsiung-port/ui/theme.css
git commit -m "$(printf 'feat(port): vendor Liquid Glass Kit v0.1 + neutral-charcoal theme tokens\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 6: 重寫 overlay.ts 為 Liquid Glass 指揮介面

**Files:**
- Modify: `examples/kaohsiung-port/ui/overlay.ts`(整檔重寫)
- Test:(無 node 單元測試;`fmtClock` 由既有 `test/port-format.test.ts` 覆蓋 → 須維持簽章)。瀏覽器目視驗證見 Task 8。

> **介面契約**:`OverlayHandlers` 不變;`OverlayApi` 在原有方法上**新增** `setTrend(points)` 與 `setIncoming(items)`。`fmtClock(ms)` export 簽章不變(既有測試依賴)。

- [ ] **Step 1: Replace the whole file** — `examples/kaohsiung-port/ui/overlay.ts`:

```ts
import { SHIP_CATEGORIES, SHIP_CATEGORY_COLORS } from '../palette';
import type { VesselRecord } from '../data/twport';

const TAIPEI_MS = 8 * 3600_000;
const pad = (n: number) => String(n).padStart(2, '0');

/** Epoch ms → 'MM/DD HH:mm' in Asia/Taipei. */
export function fmtClock(ms: number): string {
  const d = new Date(ms + TAIPEI_MS);
  return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
const hm = (ms: number) => fmtClock(ms).slice(-5);
const rgb = (c: number[]) => `rgb(${c[0]},${c[1]},${c[2]})`;
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ESC[c]);

declare global {
  interface Window {
    LiquidGlass?: { init?: (c?: unknown) => void; attach?: (el: Element) => void; refresh?: () => void };
  }
}

export interface OverlayHandlers {
  onFilter(enabled: Set<string>): void;
  onView(mode: 'type' | 'status'): void;
  onScrub(tMs: number): void;
  onBackdrop(on: boolean): void;
}
export interface IncomingItem { berthNo: number; name: string; etaMs: number; }
export interface OverlayApi {
  setKpi(opts: { inPort: number; occupied: number; total: number; dateMs: number }): void;
  showVessel(v: VesselRecord): void;
  hideVessel(): void;
  setTimeRange(opts: { minMs: number; maxMs: number; nowMs: number }): void;
  setClock(ms: number): void;
  setTrend(points: number[]): void;
  setIncoming(items: IncomingItem[]): void;
}

export function createOverlay(root: HTMLElement, handlers: OverlayHandlers): OverlayApi {
  root.innerHTML = '';
  const enabled = new Set<string>(SHIP_CATEGORIES);
  let stagger = 0;
  const place = (el: HTMLElement, css: string): HTMLElement => {
    el.style.cssText = css;
    el.style.animationDelay = `${stagger.toFixed(2)}s`;
    el.classList.add('fade-rise');
    stagger += 0.08;
    root.appendChild(el);
    return el;
  };
  const glass = (cls: string, css: string): HTMLDivElement => {
    const el = document.createElement('div');
    el.className = cls;
    el.setAttribute('data-lg', '');
    return place(el, css) as HTMLDivElement;
  };

  // TOP navbar
  const nav = glass('lg lg-navbar', 'left:14px;right:14px;top:14px;height:44px;display:flex;align-items:center;gap:10px;padding:0 16px');
  nav.innerHTML = `<span class="lg-navbar__brand" style="font-weight:700">高雄港 IOC</span>
    <span style="color:var(--ink-dim);font-size:12px">· LiDAR 戰情室</span>
    <span class="lg-navbar__spacer" style="flex:1"></span>
    <span style="display:inline-flex;align-items:center;gap:6px;color:var(--signal-ok);font-size:12px">
      <span style="width:7px;height:7px;border-radius:50%;background:var(--signal-ok);box-shadow:0 0 8px var(--signal-ok)"></span>LIVE</span>`;
  const clock = document.createElement('span');
  clock.style.cssText = 'font-variant-numeric:tabular-nums;min-width:96px;text-align:right';
  nav.appendChild(clock);

  // LEFT: in-port stat (+spark)
  const stat = glass('lg lg-stat', 'left:14px;top:70px;width:172px;padding:12px');
  stat.innerHTML = `<span class="lg-stat__label">在港船舶</span>
    <div class="lg-stat__row"><span class="lg-stat__value" data-lg-value="0"></span></div>
    <svg class="lg-stat__spark" data-lg-spark="0,0"></svg>`;
  const statValue = stat.querySelector('.lg-stat__value') as HTMLElement;
  const statSpark = stat.querySelector('.lg-stat__spark') as SVGElement;

  // LEFT: occupancy gauge
  const gauge = glass('lg lg-gauge', 'left:14px;top:176px;width:172px');
  gauge.setAttribute('data-lg-profile', 'circle');
  gauge.setAttribute('data-lg-value', '0');
  gauge.setAttribute('data-lg-unit', '%');
  gauge.setAttribute('data-lg-label', '泊位佔用');

  // LEFT: ship-type filter + view/backdrop toggles
  const filter = glass('lg lg-card', 'left:14px;top:310px;width:172px;padding:12px');
  filter.innerHTML = '<div style="opacity:.6;text-transform:uppercase;font-size:10px;margin-bottom:6px">船型篩選</div>';
  SHIP_CATEGORIES.forEach((cat, i) => {
    const rowEl = document.createElement('label');
    rowEl.style.cssText = 'display:flex;align-items:center;gap:6px;margin:3px 0;cursor:pointer;font-size:12px';
    rowEl.innerHTML = `<input type="checkbox" checked>
      <span style="width:9px;height:9px;border-radius:50%;background:${rgb(SHIP_CATEGORY_COLORS[i])}"></span>${cat}`;
    const cb = rowEl.querySelector('input') as HTMLInputElement;
    cb.addEventListener('change', () => {
      if (cb.checked) enabled.add(cat); else enabled.delete(cat);
      handlers.onFilter(new Set(enabled));
    });
    filter.appendChild(rowEl);
  });
  let mode: 'type' | 'status' = 'type';
  const viewBtn = document.createElement('button');
  viewBtn.className = 'lg lg-btn lg-btn--sm'; viewBtn.setAttribute('data-lg', '');
  viewBtn.textContent = '檢視:船型 ↔ 狀態';
  viewBtn.style.cssText = 'margin-top:8px;width:100%';
  viewBtn.addEventListener('click', () => { mode = mode === 'type' ? 'status' : 'type'; handlers.onView(mode); });
  filter.appendChild(viewBtn);
  let bgOn = true;
  const bgBtn = document.createElement('button');
  bgBtn.className = 'lg lg-btn lg-btn--sm'; bgBtn.setAttribute('data-lg', '');
  bgBtn.textContent = '🗺️ 底圖:開';
  bgBtn.style.cssText = 'margin-top:6px;width:100%';
  bgBtn.addEventListener('click', () => { bgOn = !bgOn; bgBtn.textContent = `🗺️ 底圖:${bgOn ? '開' : '關'}`; handlers.onBackdrop(bgOn); });
  filter.appendChild(bgBtn);

  // RIGHT: 24h trend chart
  const chart = glass('lg lg-chart', 'right:14px;top:70px;width:190px');
  chart.innerHTML = `<div class="lg-chart__head"><h4 class="lg-chart__title">24h 在港趨勢</h4></div>
    <svg class="lg-chart__svg" data-lg-chart="line" data-lg-points="0,0"></svg>`;
  const chartSvg = chart.querySelector('.lg-chart__svg') as SVGElement;

  // RIGHT: incoming list
  const incoming = glass('lg lg-card', 'right:14px;top:212px;width:190px;padding:12px');
  incoming.innerHTML = '<div style="opacity:.6;text-transform:uppercase;font-size:10px;margin-bottom:6px">即將進港 · 2h</div><div data-rows></div>';
  const incRows = incoming.querySelector('[data-rows]') as HTMLElement;

  // detail card (hidden until pick)
  const card = glass('lg lg-card', 'right:14px;bottom:80px;width:200px;padding:12px;display:none');

  // BOTTOM timeline
  const bar = glass('lg', 'left:14px;right:14px;bottom:14px;height:46px;display:flex;gap:12px;align-items:center;padding:0 14px;border-radius:14px');
  const play = document.createElement('button');
  play.className = 'lg lg-btn lg-btn--icon'; play.setAttribute('data-lg', '');
  play.textContent = '▶';
  const slider = document.createElement('input');
  slider.type = 'range'; slider.style.flex = '1';
  const tclock = document.createElement('span');
  tclock.style.cssText = 'min-width:96px;text-align:right;font-variant-numeric:tabular-nums';
  bar.append(play, slider, tclock);

  let playing = false; let timer = 0;
  function stopPlay() { playing = false; play.textContent = '▶'; if (timer) cancelAnimationFrame(timer); }
  slider.addEventListener('input', () => { stopPlay(); handlers.onScrub(+slider.value); });
  play.addEventListener('click', () => {
    playing = !playing; play.textContent = playing ? '⏸' : '▶';
    const stepFn = () => {
      if (!playing) return;
      let v = +slider.value + (+slider.max - +slider.min) / 600; // ~10s sweep across the range
      if (v > +slider.max) v = +slider.min;
      slider.value = String(v); handlers.onScrub(v); timer = requestAnimationFrame(stepFn);
    };
    if (playing) timer = requestAnimationFrame(stepFn);
  });

  // Enhance freshly-built glass nodes (no-op in non-Chromium / if kit absent).
  window.LiquidGlass?.refresh?.();

  return {
    setKpi({ inPort, occupied, total }) {
      statValue.setAttribute('data-lg-value', String(inPort));
      const pct = total > 0 ? Math.round((occupied / total) * 100) : 0;
      gauge.setAttribute('data-lg-value', String(pct));
    },
    showVessel(v) {
      card.style.display = 'block';
      card.innerHTML = `<b>${esc(v.nameZh)} ${esc(v.nameEn)}</b>
        <div style="margin-top:6px;font-size:12px">船型:${esc(v.shipType)}</div>
        <div style="font-size:12px">泊位:${esc(v.wharfName)}</div>
        <div style="font-size:12px">前一港:${esc(v.beforePort)}</div>
        <div style="font-size:12px">下一港:${esc(v.nextPort)}</div>
        <div style="font-size:12px">IMO:${esc(v.imo) || '—'}</div>`;
    },
    hideVessel() { card.style.display = 'none'; },
    setTimeRange({ minMs, maxMs, nowMs }) {
      slider.min = String(minMs); slider.max = String(maxMs); slider.value = String(nowMs);
    },
    setClock(ms) { clock.textContent = fmtClock(ms); tclock.textContent = fmtClock(ms); },
    setTrend(points) {
      const pts = points.length ? points : [0, 0];
      chartSvg.setAttribute('data-lg-points', pts.join(','));
      statSpark.setAttribute('data-lg-spark', pts.slice(-12).join(','));
    },
    setIncoming(items) {
      if (!items.length) { incRows.innerHTML = '<div style="opacity:.5;font-size:12px">— 無 —</div>'; return; }
      incRows.innerHTML = items.slice(0, 6).map((it) => `
        <div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;border-bottom:1px solid rgba(120,140,160,.12)">
          <span>#${it.berthNo} ${esc(it.name)}</span><span style="color:var(--signal-warn)">${hm(it.etaMs)}</span></div>`).join('');
    },
  };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 0 errors.

- [ ] **Step 3: Run the format test (fmtClock contract intact)**

Run: `npx vitest run test/port-format.test.ts`
Expected: PASS（`fmtClock` 簽章/輸出未變)。

- [ ] **Step 4: Commit**

```bash
git add examples/kaohsiung-port/ui/overlay.ts
git commit -m "$(printf 'feat(port): rebuild overlay as Liquid Glass command-center HUD\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 7: 接線 main.ts + index.html(bloom 層 / fog / 底圖 re-tint / 餵資料 / 載 kit)

**Files:**
- Modify: `examples/kaohsiung-port/main.ts`
- Modify: `examples/kaohsiung-port/index.html`

- [ ] **Step 1: Load kit + theme + dark theme attr** — replace `examples/kaohsiung-port/index.html` entirely:

```html
<!doctype html>
<html lang="zh-Hant" data-lg-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>高雄港 LiDAR 戰情室</title>
    <link rel="stylesheet" href="./ui/liquid-glass.css" />
    <link rel="stylesheet" href="./ui/theme.css" />
    <style>
      html, body { margin: 0; height: 100%; overflow: hidden;
        font-family: -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif; }
      #view { display: block; width: 100vw; height: 100vh; }
      #overlay { position: fixed; inset: 0; pointer-events: none; }
      #overlay > * { position: fixed; pointer-events: auto; }
    </style>
  </head>
  <body>
    <canvas id="view"></canvas>
    <div id="overlay"></div>
    <script src="./ui/liquid-glass.js"></script>
    <script>window.LiquidGlass && window.LiquidGlass.init && window.LiquidGlass.init();</script>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Import the new derivations** — `examples/kaohsiung-port/main.ts`, extend the occupancy import (line ~6):

```ts
import { buildIntervals, occupancyAt, berthStatusAt, buildOccupancyTrend, buildIncomingList } from './time/occupancy';
```

- [ ] **Step 3: Enable engine bloom + fog** — `examples/kaohsiung-port/main.ts`, in the `new LidarEngine({...})` options object (after `pointBudget: 1,`):

```ts
  bloom: { strength: 0.9, radius: 0.4, threshold: 0.0 },
  fog: { color: 0x0b0c0e, near: dist * 0.6, far: dist * 3.0 },
```

- [ ] **Step 4: Mark ship + incoming layers to glow** — `examples/kaohsiung-port/main.ts`, replace the three `engine.addLayer(...)` lines:

```ts
engine.addLayer(basePC.points);                 // context — no bloom
engine.addLayer(shipPC.points, { bloom: true }); // ships glow
engine.addLayer(incPC.points, { bloom: true });  // incoming markers glow
```

- [ ] **Step 5: Re-tint the basemap neutral** — `examples/kaohsiung-port/main.ts`, in `buildBasemapPlane()` change the material color from `0x3a5a72` to `0x2a2e33`:

```ts
  const mat = new THREE.MeshBasicMaterial({ color: 0x2a2e33, transparent: true, depthWrite: false });
```

- [ ] **Step 6: Feed real trend + incoming into the overlay** — `examples/kaohsiung-port/main.ts`:

In `refresh(tMs)`, after the `overlay.setKpi({...})` line add:

```ts
  overlay.setIncoming(
    buildIncomingList(intervals, tMs, INCOMING_WINDOW).map((a) => ({
      berthNo: a.berthNo, name: a.vessel.nameZh || a.vessel.nameEn, etaMs: a.etaMs,
    })),
  );
```

After the `overlay.setTimeRange({...})` call (just before the final `refresh(nowMs)` near line ~148) add the once-computed 24h trend:

```ts
overlay.setTrend(buildOccupancyTrend(intervals, nowMs - 12 * HOUR, nowMs + 12 * HOUR, 24));
```

- [ ] **Step 7: Type-check + full regression**

Run: `npx tsc --noEmit -p tsconfig.json && npm test`
Expected: tsc 0 errors;`npm test` 全綠(~96 測試)。

- [ ] **Step 8: Production build**

Run: `npm run build`
Expected: vite 打包 + tsc 宣告成功,無錯。

- [ ] **Step 9: Commit**

```bash
git add examples/kaohsiung-port/main.ts examples/kaohsiung-port/index.html
git commit -m "$(printf 'feat(port): wire war-room — bloom layers, fog, neutral basemap, real trend/incoming, glass HUD\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 8: 瀏覽器目視驗證 + handoff 更新

**Files:**
- Modify: `docs/superpowers/2026-06-14-handoff.md`

- [ ] **Step 1: Launch dev server + drive the browser**

Run `npm run dev`(背景),用瀏覽器工具導到 `http://localhost:5173/examples/kaohsiung-port/index.html`,截圖。
Expected(目視):① 暗炭灰底;② 船點/進港標記**發光**(bloom),海岸線/碼頭/底圖不發光;③ 左欄玻璃統計卡(在港數)+環形儀表(佔用率)+船型篩選;④ 右欄趨勢折線 + 即將進港清單;⑤ 頂 navbar(標題/LIVE/時鐘)、底時間軸玻璃化;⑥ 主控台無 error。

- [ ] **Step 2: Verify interactions**

目視確認:拖時間軸 → 船/進港清單/在港數/佔用率隨之更新;點船 → 玻璃詳情卡;船型篩選 checkbox 生效;底圖開關生效;檢視「船型↔狀態」切換生效。
（非 Chromium 瀏覽器玻璃降級為磨砂,版面與互動不變 — 屬預期。)

- [ ] **Step 3: Add debug handles** — if missing, extend `window.__twin` in `main.ts` to expose what's useful for verification (engine 已含 bloom)。確認既有 `__twin` 仍可用;`setBasemapTint` 仍可調底圖明暗。

- [ ] **Step 4: Update the handoff doc** — `docs/superpowers/2026-06-14-handoff.md`:新增一節「更新 2026-06-15 — F0 戰情室視覺基礎完成」,記:bloom(只船+進港)+fog 由引擎內建(預設關)、Liquid Glass Kit vendored、overlay 重寫為指揮中心、中性炭灰配色、趨勢/進港為真實資料、測試數(~96 綠)、新檔(`src/core/postfx.ts`、`ui/liquid-glass.*`、`ui/theme.css`)。更新 §4 引擎/app 表與 §8(F0 從候選移除)。

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/2026-06-14-handoff.md
git commit -m "$(printf 'docs: handoff update — F0 war-room visual base shipped\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Self-Review

**Spec coverage:**
- §2 決策 1 版面 B → Task 6 overlay 左右側欄。
- §2 決策 2 純 TS + Kit → Task 5 vendored、Task 6 用 `.lg` class。
- §2 決策 3 / §3 配色 → Task 5 `theme.css`、Task 7 `data-lg-theme`/底圖 re-tint。
- §2 決策 4 / §5 selective bloom + fog → Task 1(fog)、2(bloom 模組)、3(引擎接線)、7(標 bloom 層)。
- §2 決策 5 不做 Water/Sky → 計畫無此任務(明確不含)。
- §2 決策 6 引擎內建 post-fx 預設關 → Task 3 options 預設關 + Task 2 模組。
- §2 決策 7 / §6.3 零造假資料 → Task 4 真實 trend/incoming + Task 7 餵入。
- §4 prompt 模板 → 體現在 Task 5/6(token→逐區塊→glass→fade-rise)。
- §6.4 介面契約 → Task 6 保留 `OverlayApi`/`OverlayHandlers`、main.ts 僅小幅接線(Task 7)。
- §8 測試 → Task 1/2/3/4 各帶 node 測試;bloom/glass 瀏覽器驗證(Task 8)。

**Placeholder scan:** 無 TBD/TODO;每個 code step 均含完整內容。`__twin` 擴充(Task 8 Step 3)為條件式(若缺再加),非佔位。

**Type consistency:** `BLOOM_LAYER`(1)、`createSelectiveBloom`、`hideNonBloomed`/`restoreHidden`、`SelectiveBloom`、`BloomOptions` 在 Task 2 定義、Task 3 匯入/匯出一致;`buildOccupancyTrend`/`buildIncomingList`/`IncomingArrival` 在 Task 4 定義、Task 7 使用一致;`OverlayApi` 新增 `setTrend`/`setIncoming`/`IncomingItem` 在 Task 6 定義、Task 7 呼叫一致;`addLayer(obj,{bloom})` 簽章 Task 3 定義、Task 7 使用一致。
