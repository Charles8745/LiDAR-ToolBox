# Kaohsiung Port LiDAR Digital-Twin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pseudo-3D (2.5D), orbitable, always-on point-cloud digital twin of Kaohsiung port that shows real berthing status over a 24-hour timeline, reusing the existing `lidar-engine`.

**Architecture:** Two *additive* extensions to the engine (per-point value/status coloring + direct `addPoints`; an orbit-camera / render-host mode) plus a new self-contained app under `examples/kaohsiung-port/`. The app projects real OpenStreetMap port geometry and real TWPort vessel/berth open data (frozen to JSON at build time) into two point layers — a static base (coastline + quays) and a dynamic ship layer rebuilt as the user scrubs a 24h time slider. Color encodes berth status / ship type via categorical LUTs. An HTML overlay provides legend, KPIs, ship detail, filters, and the time slider.

**Tech Stack:** TypeScript, Three.js (+ its bundled `OrbitControls`), Vite, Vitest (node env). No new runtime dependencies. Spec: [docs/superpowers/specs/2026-06-14-kaohsiung-port-lidar-twin-design.md](../specs/2026-06-14-kaohsiung-port-lidar-twin-design.md).

**Conventions (read before starting):**
- Run all tests: `npm test`. Run one file: `npx vitest run test/<file>.test.ts`. One case: add `-t "<name substring>"`.
- Tests live in `test/` (flat), import source via relative paths (`../src/...`, `../examples/kaohsiung-port/...`). Test env is **node** — no DOM/WebGL. Pure logic is unit-tested; anything that boots `LidarEngine` (needs WebGL) or touches the DOM is verified by running the dev server and screenshotting with the browser, **not** by a node unit test.
- Commit style: conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`). End every commit body with the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Work happens on branch `feat/kaohsiung-port-twin` (already created and checked out).
- **Regression rule:** the existing cave demo (`examples/basic`) and all existing tests must stay green. Every engine change is additive with backward-compatible defaults.

---

# PART A — Engine extensions (`src/`)

Each task here leaves the library shippable and the cave demo unchanged in behavior.

---

### Task 1: Per-point value/status coloring in `PointCloud` + shaders

Adds an `aValue` attribute and a `uColorMode` uniform so a point's color can be sampled from the ramp LUT by a per-point normalized value (status/type) instead of by distance. Distance mode stays the default.

**Files:**
- Modify: `src/core/PointCloud.ts`
- Modify: `src/shaders/points.vert.glsl`
- Modify: `src/shaders/points.frag.glsl`
- Test: `test/PointCloud.test.ts` (add cases)

- [ ] **Step 1: Write the failing tests** (append inside the existing `describe('PointCloud.addHits', ...)` file, as a new `describe`)

```ts
// append to test/PointCloud.test.ts
describe('PointCloud value/color mode', () => {
  it('defaults to distance color mode (uColorMode = 0)', () => {
    const pc = new PointCloud({ capacity: 4, ramp, persistence: 'accumulate' });
    expect((pc as any)['material'].uniforms.uColorMode.value).toBe(0);
  });

  it('constructor colorMode "value" sets uColorMode = 1', () => {
    const pc = new PointCloud({ capacity: 4, ramp, persistence: 'accumulate', colorMode: 'value' });
    expect((pc as any)['material'].uniforms.uColorMode.value).toBe(1);
  });

  it('setColorMode toggles the uniform', () => {
    const pc = new PointCloud({ capacity: 4, ramp, persistence: 'accumulate' });
    pc.setColorMode('value');
    expect((pc as any)['material'].uniforms.uColorMode.value).toBe(1);
    pc.setColorMode('distance');
    expect((pc as any)['material'].uniforms.uColorMode.value).toBe(0);
  });

  it('exposes a valueArray sized to capacity and an aValue attribute', () => {
    const pc = new PointCloud({ capacity: 4, ramp, persistence: 'accumulate' });
    expect(pc.valueArray.length).toBe(4);
    expect(pc.points.geometry.getAttribute('aValue')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/PointCloud.test.ts -t "value/color mode"`
Expected: FAIL (`colorMode` not accepted, `setColorMode`/`valueArray`/`uColorMode` undefined).

- [ ] **Step 3: Add `aValue` to the vertex shader**

Replace the whole of `src/shaders/points.vert.glsl` with:

```glsl
attribute float aDistance;
attribute float aBirth;
attribute float aValue;

uniform float uTime;
uniform float uMaxDistance;
uniform float uPointSize;
uniform float uMaxPointSize;

varying float vDist01;
varying float vValue01;
varying float vAge;

void main() {
  vDist01 = clamp(aDistance / uMaxDistance, 0.0, 1.0);
  vValue01 = clamp(aValue, 0.0, 1.0);
  vAge = uTime - aBirth;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  // Perspective-attenuated size, clamped so near points stay small dots.
  gl_PointSize = clamp(uPointSize * (12.0 / max(-mvPosition.z, 0.001)), 1.0, uMaxPointSize);
  gl_Position = projectionMatrix * mvPosition;
}
```

- [ ] **Step 4: Add `uColorMode` to the fragment shader**

Replace the whole of `src/shaders/points.frag.glsl` with:

```glsl
uniform sampler2D uRamp;
uniform float uFade;          // 0 = accumulate, 1 = fade
uniform float uFadeDuration;  // seconds
uniform float uColorMode;     // 0 = color by distance, 1 = color by value

varying float vDist01;
varying float vValue01;
varying float vAge;

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
}
```

- [ ] **Step 5: Wire `aValue` / `uColorMode` / `uMaxPointSize` into `PointCloud`**

In `src/core/PointCloud.ts`:

Add to `PointCloudOptions`:
```ts
  colorMode?: 'distance' | 'value';
  maxPointSize?: number;
```

Add fields next to the other arrays/attrs:
```ts
  readonly valueArray: Float32Array;
  private valueAttr: THREE.BufferAttribute;
```

In the constructor, after `this.birthArray = ...`:
```ts
    this.valueArray = new Float32Array(opts.capacity);
```
After `this.birthAttr = new THREE.BufferAttribute(...)`:
```ts
    this.valueAttr = new THREE.BufferAttribute(this.valueArray, 1);
    this.valueAttr.setUsage(THREE.DynamicDrawUsage);
```
After `this.geometry.setAttribute('aBirth', this.birthAttr);`:
```ts
    this.geometry.setAttribute('aValue', this.valueAttr);
```
In the `uniforms` object add:
```ts
        uColorMode: { value: opts.colorMode === 'value' ? 1 : 0 },
        uMaxPointSize: { value: opts.maxPointSize ?? 5 },
```
Add a method next to `setRamp`:
```ts
  setColorMode(mode: 'distance' | 'value'): void {
    this.material.uniforms.uColorMode.value = mode === 'value' ? 1 : 0;
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/PointCloud.test.ts`
Expected: PASS (new value-mode cases + all existing addHits cases).

- [ ] **Step 7: Run the full suite (regression)**

Run: `npm test`
Expected: PASS (all files green; cave demo untouched).

- [ ] **Step 8: Commit**

```bash
git add src/core/PointCloud.ts src/shaders/points.vert.glsl src/shaders/points.frag.glsl test/PointCloud.test.ts
git commit -m "$(printf 'feat(engine): per-point value/status color mode in PointCloud\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2: `PointCloud.addPoints()` — direct point ingest (no raycast)

Lets the app push a precomputed batch of points (positions + per-point values) straight into the buffer, bypassing the emitter/raycaster path.

**Files:**
- Modify: `src/core/PointCloud.ts`
- Test: `test/PointCloud.test.ts` (add cases)

- [ ] **Step 1: Write the failing tests**

```ts
// append to test/PointCloud.test.ts
describe('PointCloud.addPoints', () => {
  it('writes positions and values into the buffers', () => {
    const pc = new PointCloud({ capacity: 4, ramp, persistence: 'accumulate', colorMode: 'value' });
    pc.addPoints(new Float32Array([1, 2, 3, 4, 5, 6]), new Float32Array([0.25, 0.75]));
    expect(pc.count).toBe(2);
    expect([pc.positionArray[0], pc.positionArray[1], pc.positionArray[2]]).toEqual([1, 2, 3]);
    expect([pc.positionArray[3], pc.positionArray[4], pc.positionArray[5]]).toEqual([4, 5, 6]);
    expect(pc.valueArray[0]).toBeCloseTo(0.25);
    expect(pc.valueArray[1]).toBeCloseTo(0.75);
  });

  it('clear then addPoints rebuilds from slot 0 (supports per-frame layer rebuild)', () => {
    const pc = new PointCloud({ capacity: 8, ramp, persistence: 'accumulate', colorMode: 'value' });
    pc.addPoints(new Float32Array([9, 9, 9]), new Float32Array([0.5]));
    pc.clear();
    pc.addPoints(new Float32Array([1, 1, 1, 2, 2, 2]), new Float32Array([0.1, 0.2]));
    expect(pc.count).toBe(2);
    expect([pc.positionArray[0], pc.positionArray[1], pc.positionArray[2]]).toEqual([1, 1, 1]);
  });

  it('flags the written ranges for GPU upload', () => {
    const pc = new PointCloud({ capacity: 4, ramp, persistence: 'accumulate', colorMode: 'value' });
    pc.addPoints(new Float32Array([1, 2, 3, 4, 5, 6]), new Float32Array([0.25, 0.75]));
    const valAttr = pc.points.geometry.getAttribute('aValue') as THREE.BufferAttribute;
    expect(valAttr.updateRanges).toEqual([{ start: 0, count: 2 }]);
  });

  it('ignores an empty batch', () => {
    const pc = new PointCloud({ capacity: 4, ramp, persistence: 'accumulate', colorMode: 'value' });
    pc.addPoints(new Float32Array([]), new Float32Array([]));
    expect(pc.count).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/PointCloud.test.ts -t "addPoints"`
Expected: FAIL (`addPoints` is not a function).

- [ ] **Step 3: Implement `addPoints`**

In `src/core/PointCloud.ts`, add after `addHits(...)`:

```ts
  /**
   * Append a precomputed batch of points directly (no raycast).
   * `positions` is a flat xyz array (length = 3 × n); `values` is the
   * per-point normalized value in [0,1] used by the 'value' color mode.
   */
  addPoints(positions: ArrayLike<number>, values: ArrayLike<number>, time = 0): void {
    const n = values.length;
    if (n === 0) return;
    const segments = this.ring.reserve(n);
    let vi = 0;
    for (const seg of segments) {
      for (let i = 0; i < seg.length; i++) {
        const slot = seg.start + i;
        this.positionArray[slot * 3 + 0] = positions[vi * 3 + 0];
        this.positionArray[slot * 3 + 1] = positions[vi * 3 + 1];
        this.positionArray[slot * 3 + 2] = positions[vi * 3 + 2];
        this.valueArray[slot] = values[vi];
        this.distanceArray[slot] = 0;
        this.birthArray[slot] = time;
        vi++;
      }
      this.posAttr.addUpdateRange(seg.start * 3, seg.length * 3);
      this.valueAttr.addUpdateRange(seg.start, seg.length);
      this.distAttr.addUpdateRange(seg.start, seg.length);
      this.birthAttr.addUpdateRange(seg.start, seg.length);
    }
    this.posAttr.needsUpdate = true;
    this.valueAttr.needsUpdate = true;
    this.distAttr.needsUpdate = true;
    this.birthAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, this.ring.count);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/PointCloud.test.ts -t "addPoints"`
Expected: PASS.

- [ ] **Step 5: Run the full suite (regression)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/PointCloud.ts test/PointCloud.test.ts
git commit -m "$(printf 'feat(engine): PointCloud.addPoints for direct point ingest\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3: `buildCategoryLUT` + widen public exports

A categorical (NearestFilter) LUT so discrete statuses/ship-types map to crisp colors with no blending. Also export `PointCloud`, `buildCategoryLUT`, and `buildRampTextureFromFn` so the app can build layers and palettes.

**Files:**
- Modify: `src/ramps/lut.ts`
- Modify: `src/ramps/index.ts`
- Modify: `src/index.ts`
- Test: `test/lut.test.ts` (new)
- Test: `test/exports.test.ts` (add cases)

- [ ] **Step 1: Write the failing tests**

Create `test/lut.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildCategoryLUT } from '../src/ramps/lut';

describe('buildCategoryLUT', () => {
  it('builds a NearestFilter texture one texel wide per color', () => {
    const tex = buildCategoryLUT([[255, 0, 0], [0, 255, 0], [0, 0, 255]]);
    expect(tex.image.width).toBe(3);
    expect(tex.magFilter).toBe(THREE.NearestFilter);
    expect(tex.minFilter).toBe(THREE.NearestFilter);
  });

  it('writes the exact category colors into the texel data', () => {
    const tex = buildCategoryLUT([[10, 20, 30], [40, 50, 60]]);
    const d = tex.image.data as Uint8Array;
    expect([d[0], d[1], d[2], d[3]]).toEqual([10, 20, 30, 255]);
    expect([d[4], d[5], d[6], d[7]]).toEqual([40, 50, 60, 255]);
  });

  it('throws on an empty color list', () => {
    expect(() => buildCategoryLUT([])).toThrow();
  });
});
```

Add to `test/exports.test.ts` inside `describe('public API', ...)`:
```ts
  it('exposes PointCloud, buildCategoryLUT and buildRampTextureFromFn', async () => {
    const api = await import('../src/index');
    expect(typeof (api as any).PointCloud).toBe('function');
    expect(typeof (api as any).buildCategoryLUT).toBe('function');
    expect(typeof (api as any).buildRampTextureFromFn).toBe('function');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/lut.test.ts test/exports.test.ts`
Expected: FAIL (`buildCategoryLUT` undefined; new exports missing).

- [ ] **Step 3: Implement `buildCategoryLUT`**

Append to `src/ramps/lut.ts`:
```ts
/** Build a categorical LUT: one texel per color, NearestFilter (no blending). */
export function buildCategoryLUT(colors: RGB[]): THREE.DataTexture {
  if (colors.length < 1) throw new Error('buildCategoryLUT needs at least one color');
  const width = Math.max(colors.length, 2); // DataTexture needs width >= 1; keep >=2 for safety
  const data = new Uint8Array(new ArrayBuffer(width * 4));
  for (let i = 0; i < width; i++) {
    const [r, g, b] = colors[Math.min(i, colors.length - 1)];
    data[i * 4 + 0] = Math.round(r);
    data[i * 4 + 1] = Math.round(g);
    data[i * 4 + 2] = Math.round(b);
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}
```
> Note for the app: with `n` categories, set a point's `aValue = (index + 0.5) / n` so NearestFilter lands on texel `index`.

- [ ] **Step 4: Re-export from ramps and the package root**

In `src/ramps/index.ts` change the last line to:
```ts
export { buildRampTexture, buildRampTextureFromFn, buildCategoryLUT } from './lut';
```

In `src/index.ts` add:
```ts
export { PointCloud } from './core/PointCloud';
export type { PointCloudOptions } from './core/PointCloud';
export { buildRampTexture, buildRampTextureFromFn, buildCategoryLUT } from './ramps';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/lut.test.ts test/exports.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full suite + commit**

Run: `npm test` → Expected: PASS.
```bash
git add src/ramps/lut.ts src/ramps/index.ts src/index.ts test/lut.test.ts test/exports.test.ts
git commit -m "$(printf 'feat(engine): categorical LUT + export PointCloud/LUT builders\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 4: Orbit-camera / render-host mode in `LidarEngine`

Adds `cameraMode: 'orbit'` (drag-rotate, wheel-zoom, pan via Three's bundled `OrbitControls`), an `autoScan: false` path (skip emit/raycast so the engine can host externally-built point layers), `addLayer()` to attach app-owned layers, plus camera placement and a configurable far plane / max point size. Defaults preserve the cave demo exactly.

**Files:**
- Modify: `src/core/LidarEngine.ts`

> **Verification note:** `LidarEngine` constructs a `WebGLRenderer`, which needs WebGL — it cannot boot in the node test env. This task is verified by (a) `npm test` staying green (no signature breaks) and (b) running the cave demo and confirming it is unchanged. Automated render verification for orbit mode happens in Task 13 via the dev server + browser screenshot.

- [ ] **Step 1: Make `scannable`/`emitter` optional and add new options**

In `src/core/LidarEngine.ts`, change `LidarEngineOptions`:
```ts
export interface LidarEngineOptions {
  canvas: HTMLCanvasElement;
  scannable?: Scannable;
  emitter?: Emitter;
  ramp?: ColorRamp;
  pointBudget?: number;
  persistence?: Persistence;
  maxDistance?: number;
  pointSize?: number;
  maxPointSize?: number;
  fadeDuration?: number;
  colorMode?: 'distance' | 'value';
  cameraMode?: 'lookAround' | 'orbit';
  cameraPosition?: [number, number, number];
  cameraTarget?: [number, number, number];
  cameraFar?: number;
  autoScan?: boolean;
}
```

- [ ] **Step 2: Import OrbitControls and add fields**

At the top of the file, add:
```ts
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
```
Add private fields to the class:
```ts
  private controls: OrbitControls | null = null;
  private autoScan: boolean;
  private extraLayers: THREE.Object3D[] = [];
```

- [ ] **Step 3: Branch the constructor on camera mode**

Replace the camera/sampler/pointCloud/emitter setup block in the constructor with:
```ts
    const far = opts.cameraFar ?? 500;
    this.camera = new THREE.PerspectiveCamera(70, this.aspect(), 0.05, far);
    this.autoScan = opts.autoScan ?? true;

    this.sampler = new RaycastSampler(opts.scannable?.objects ?? []);
    const rampTex = resolveRamp(opts.ramp);
    this.ownedRamp = opts.ramp === undefined || typeof opts.ramp === 'function' ? rampTex : null;
    this.pointCloud = new PointCloud({
      capacity: opts.pointBudget ?? 500_000,
      ramp: rampTex,
      persistence: opts.persistence ?? 'accumulate',
      maxDistance: opts.maxDistance,
      pointSize: opts.pointSize,
      maxPointSize: opts.maxPointSize,
      fadeDuration: opts.fadeDuration,
      colorMode: opts.colorMode,
    });
    this.scene.add(this.pointCloud.points);
    this.emitter = opts.emitter ?? { emit: () => [] };

    if (opts.cameraMode === 'orbit') {
      this.camera.position.set(...(opts.cameraPosition ?? [0, 120, 160]));
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.target.set(...(opts.cameraTarget ?? [0, 0, 0]));
      this.controls.enableDamping = true;
      this.controls.update();
    } else {
      this.camera.position.set(0, 0, 0);
      this.applyCameraRotation();
    }
```
> `this.emitter` is now typed `Emitter`; keep its declaration as-is. `RaycastSampler` must accept an empty array — verify in Step 5.

- [ ] **Step 4: Skip scanning when `autoScan` is false and update controls each frame**

In `loop`, replace the body between `this.time += dt;` and `this.renderer.render(...)` with:
```ts
    if (this.autoScan) {
      this.camera.getWorldDirection(this.fwd);
      this.right.crossVectors(this.fwd, this.camera.up).normalize();
      this.upVec.crossVectors(this.right, this.fwd).normalize();

      const ctx: EmitContext = {
        origin: this.camera.position,
        forward: this.fwd,
        right: this.right,
        up: this.upVec,
        aim: this.aim,
        time: this.time,
        dt,
        rng: Math.random,
      };
      const rays = this.emitter.emit(ctx);
      const hits = this.sampler.sample(rays);
      this.pointCloud.addHits(hits, this.time);
    }
    this.pointCloud.update(this.time);
    this.controls?.update();
```

- [ ] **Step 5: Confirm `RaycastSampler` tolerates an empty object list**

Read `src/core/RaycastSampler.ts`. If its constructor or `sample()` throws on `[]`, guard it so an empty list yields no hits (e.g., early-return `[]` from `sample` when there are no meshes). If it already handles `[]`, make no change.

- [ ] **Step 6: Add `addLayer`, a scene accessor, and dispose handling**

Add methods:
```ts
  /** Attach an app-owned object (e.g. another PointCloud's `.points`) to the scene. */
  addLayer(obj: THREE.Object3D): void {
    this.extraLayers.push(obj);
    this.scene.add(obj);
  }
```
In `dispose()`, before `this.renderer.dispose();` add:
```ts
    this.controls?.dispose();
    for (const layer of this.extraLayers) this.scene.remove(layer);
    this.extraLayers.length = 0;
```

- [ ] **Step 7: Pass `maxPointSize` through (already added in Step 3) and run the suite**

Run: `npm test`
Expected: PASS (existing tests unaffected; `LidarEngine` is not booted in node).

- [ ] **Step 8: Manually verify the cave demo is unchanged**

Run: `npm run dev`, open the printed URL + `/examples/basic/index.html`. Confirm: scanning, drag-look, ramp/emitter/clear buttons all still work. Stop the server.

- [ ] **Step 9: Commit**

```bash
git add src/core/LidarEngine.ts src/core/RaycastSampler.ts
git commit -m "$(printf 'feat(engine): orbit camera + render-host (autoScan/addLayer) mode\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

# PART B — Kaohsiung port app (`examples/kaohsiung-port/`)

All pure-logic modules (projection, parsers, berths, occupancy, palette, portPoints) are node-unit-tested. Anything booting the engine or touching the DOM is verified by running `npm run dev` and screenshotting `/examples/kaohsiung-port/index.html` with the browser.

---

### Task 5: App scaffold — empty orbit scene boots

**Files:**
- Create: `examples/kaohsiung-port/index.html`
- Create: `examples/kaohsiung-port/main.ts`

- [ ] **Step 1: Create the HTML shell**

`examples/kaohsiung-port/index.html`:
```html
<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>高雄港 LiDAR 數位孿生</title>
    <style>
      html, body { margin: 0; height: 100%; background: #05060a; overflow: hidden;
        font-family: -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif; color: #cfe; }
      #view { display: block; width: 100vw; height: 100vh; }
      #overlay { position: fixed; inset: 0; pointer-events: none; }
      #overlay .panel { position: fixed; background: rgba(10,16,24,.82); border: 1px solid #213040;
        border-radius: 8px; pointer-events: auto; font-size: 12px; }
    </style>
  </head>
  <body>
    <canvas id="view"></canvas>
    <div id="overlay"></div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Create a minimal `main.ts` that boots an orbit scene with a few test points**

`examples/kaohsiung-port/main.ts`:
```ts
import { LidarEngine, PointCloud, buildCategoryLUT } from '../../src/index';

const canvas = document.getElementById('view') as HTMLCanvasElement;
function fit() { canvas.style.width = '100vw'; canvas.style.height = '100vh'; }
fit();

const engine = new LidarEngine({
  canvas,
  autoScan: false,
  cameraMode: 'orbit',
  cameraPosition: [0, 120, 160],
  cameraTarget: [0, 0, 0],
  pointBudget: 1000,
});
engine.start();

// Temporary: a small grid of test points to confirm value-mode rendering + orbit.
const lut = buildCategoryLUT([[255, 110, 110], [90, 230, 160], [120, 200, 255]]);
const layer = new PointCloud({ capacity: 1000, ramp: lut, persistence: 'accumulate', colorMode: 'value' });
const pos: number[] = []; const val: number[] = [];
for (let i = 0; i < 30; i++) {
  pos.push((i - 15) * 4, 0, 0); val.push(((i % 3) + 0.5) / 3);
}
layer.addPoints(new Float32Array(pos), new Float32Array(val));
engine.addLayer(layer.points);

window.addEventListener('resize', () => { fit(); engine.resize(); });
```

- [ ] **Step 3: Verify it boots and renders**

Run: `npm run dev`. Open `<printed-url>/examples/kaohsiung-port/index.html`. Use the browser tools to take a screenshot.
Expected: a horizontal row of colored dots (red/green/blue) on a dark background; dragging orbits the camera; scroll zooms; **no console errors**. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add examples/kaohsiung-port/index.html examples/kaohsiung-port/main.ts
git commit -m "$(printf 'feat(port): app scaffold boots orbit point-cloud scene\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 6: Geographic projection (lat/lon → world units)

**Files:**
- Create: `examples/kaohsiung-port/geo/projection.ts`
- Test: `test/port-projection.test.ts`

- [ ] **Step 1: Write the failing tests**

`test/port-projection.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createProjection, KAOHSIUNG_ORIGIN } from '../examples/kaohsiung-port/geo/projection';

describe('createProjection', () => {
  const proj = createProjection(KAOHSIUNG_ORIGIN.lat, KAOHSIUNG_ORIGIN.lon, 0.01);

  it('maps the origin to (0,0)', () => {
    const w = proj.toWorld(KAOHSIUNG_ORIGIN.lat, KAOHSIUNG_ORIGIN.lon);
    expect(w.x).toBeCloseTo(0); expect(w.z).toBeCloseTo(0);
  });

  it('places north as -z and east as +x', () => {
    const north = proj.toWorld(KAOHSIUNG_ORIGIN.lat + 0.01, KAOHSIUNG_ORIGIN.lon);
    const east = proj.toWorld(KAOHSIUNG_ORIGIN.lat, KAOHSIUNG_ORIGIN.lon + 0.01);
    expect(north.z).toBeLessThan(0);
    expect(east.x).toBeGreaterThan(0);
  });

  it('applies scale (1 deg lat ≈ 1113.2 units at scale 0.01)', () => {
    const p = proj.toWorld(KAOHSIUNG_ORIGIN.lat + 1, KAOHSIUNG_ORIGIN.lon);
    expect(Math.abs(p.z)).toBeCloseTo(111320 * 0.01, 0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/port-projection.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the projection**

`examples/kaohsiung-port/geo/projection.ts`:
```ts
export interface World { x: number; z: number; }
export interface Projection { toWorld(lat: number, lon: number): World; }

const M_PER_DEG_LAT = 111320;

/** Local equirectangular projection around an origin. North = -z, East = +x. */
export function createProjection(originLat: number, originLon: number, scale = 0.01): Projection {
  const mPerLon = M_PER_DEG_LAT * Math.cos((originLat * Math.PI) / 180);
  return {
    toWorld(lat: number, lon: number): World {
      return {
        x: (lon - originLon) * mPerLon * scale,
        z: -(lat - originLat) * M_PER_DEG_LAT * scale,
      };
    },
  };
}

export const KAOHSIUNG_ORIGIN = { lat: 22.59, lon: 120.30 };
export const WORLD_SCALE = 0.01; // 1 world unit ≈ 100 m
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/port-projection.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/geo/projection.ts test/port-projection.test.ts
git commit -m "$(printf 'feat(port): local equirectangular geo projection\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 7: TWPort BIG5-XML parser → normalized vessel records

**Files:**
- Create: `examples/kaohsiung-port/data/twport.ts`
- Test: `test/port-twport.test.ts`

- [ ] **Step 1: Write the failing tests**

`test/port-twport.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseTwportXml, parseTaipeiDate, parseBerthNo } from '../examples/kaohsiung-port/data/twport';

const FIXTURE = `<?xml version="1.0"?><OPEN_DATA><DESCRIPTION>x</DESCRIPTION><SHIPS>
<SHIP><PORT>KHH</PORT><VISA_NO>A1</VISA_NO><STATUS>進港</STATUS>
  <VESSEL_CNAME>東方廈門</VESSEL_CNAME><VESSEL_ENAME>DONG FANG XIAMEN</VESSEL_ENAME>
  <WHARF_CODE>KHHX108X</WHARF_CODE><WHARF_NAME>#108碼頭</WHARF_NAME>
  <ETA_DT>6/15/2026 7:00:00 AM</ETA_DT><ETD_DT>6/15/2026 7:30:00 PM</ETD_DT>
  <SHIP_TYPE_NAME>全貨櫃船</SHIP_TYPE_NAME><BEFORE_PORT>TWTXG Taichung</BEFORE_PORT>
  <NEXT_PORT>CNFOC Fuzhou</NEXT_PORT><IMO>9281346</IMO><CALL_SIGN>VRWC7</CALL_SIGN></SHIP>
<SHIP><PORT>KHH</PORT><VISA_NO>A2</VISA_NO><STATUS>移泊</STATUS>
  <VESSEL_CNAME>大林8號</VESSEL_CNAME><VESSEL_ENAME></VESSEL_ENAME>
  <WHARF_CODE>KHHL005X</WHARF_CODE><WHARF_NAME>二港口港外(防波堤外)</WHARF_NAME>
  <SHIP_TYPE_NAME>工作船</SHIP_TYPE_NAME></SHIP>
</SHIPS></OPEN_DATA>`;

describe('parseTaipeiDate', () => {
  it('parses M/D/YYYY h:mm:ss AM/PM as Asia/Taipei (UTC+8)', () => {
    expect(parseTaipeiDate('6/15/2026 7:00:00 AM')).toBe(Date.UTC(2026, 5, 15, 7 - 8, 0, 0));
  });
  it('handles 12 PM / 12 AM and empty', () => {
    expect(parseTaipeiDate('1/1/2026 12:00:00 PM')).toBe(Date.UTC(2026, 0, 1, 12 - 8, 0, 0));
    expect(parseTaipeiDate('1/1/2026 12:00:00 AM')).toBe(Date.UTC(2026, 0, 1, 0 - 8, 0, 0));
    expect(parseTaipeiDate('')).toBeNull();
  });
});

describe('parseBerthNo', () => {
  it('reads the berth number from WHARF_NAME', () => {
    expect(parseBerthNo('#108碼頭', 'KHHX108X')).toBe(108);
  });
  it('falls back to WHARF_CODE digits', () => {
    expect(parseBerthNo('', 'KHHX022X')).toBe(22);
  });
  it('returns null for outer/anchorage berths', () => {
    expect(parseBerthNo('二港口港外(防波堤外)', 'KHHL005X')).toBeNull();
  });
});

describe('parseTwportXml', () => {
  const recs = parseTwportXml(FIXTURE, 'berthing');
  it('extracts one record per SHIP with normalized fields', () => {
    expect(recs).toHaveLength(2);
    expect(recs[0]).toMatchObject({
      nameZh: '東方廈門', nameEn: 'DONG FANG XIAMEN', shipType: '全貨櫃船',
      berthNo: 108, status: '進港', beforePort: 'TWTXG Taichung', nextPort: 'CNFOC Fuzhou',
      imo: '9281346', source: 'berthing',
    });
    expect(recs[0].etaMs).toBe(Date.UTC(2026, 5, 15, 7 - 8, 0, 0));
  });
  it('marks outer berths with berthNo null', () => {
    expect(recs[1].berthNo).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/port-twport.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the parser**

`examples/kaohsiung-port/data/twport.ts`:
```ts
export interface VesselRecord {
  visaNo: string;
  nameZh: string;
  nameEn: string;
  shipType: string;
  wharfName: string;
  berthNo: number | null;
  status: string;
  etaMs: number | null;
  etdMs: number | null;
  actPortMs: number | null;
  leaveMs: number | null;
  beforePort: string;
  nextPort: string;
  imo: string;
  callSign: string;
  source: 'berthing' | 'forecast';
}

const TAIPEI_OFFSET_H = 8;

/** Parse `M/D/YYYY h:mm:ss AM/PM` (Asia/Taipei, fixed UTC+8) → epoch ms, or null. */
export function parseTaipeiDate(s: string): number | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  const [, mo, d, y, hh, mi, se, ap] = m;
  let h = parseInt(hh, 10) % 12;
  if (/PM/i.test(ap)) h += 12;
  return Date.UTC(+y, +mo - 1, +d, h - TAIPEI_OFFSET_H, +mi, +se);
}

/** Berth number from WHARF_NAME (`#108碼頭`) or WHARF_CODE (`KHHX108X`); null = outer/anchorage. */
export function parseBerthNo(wharfName: string, wharfCode: string): number | null {
  const byName = wharfName.match(/#?(\d+)\s*碼頭/);
  if (byName) return parseInt(byName[1], 10);
  const byCode = wharfCode.match(/^KHHX0*(\d+)X$/);
  if (byCode) return parseInt(byCode[1], 10);
  return null;
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : '';
}

export function parseTwportXml(xml: string, source: 'berthing' | 'forecast'): VesselRecord[] {
  const out: VesselRecord[] = [];
  for (const m of xml.matchAll(/<SHIP>([\s\S]*?)<\/SHIP>/g)) {
    const b = m[1];
    const wharfName = tag(b, 'WHARF_NAME');
    const wharfCode = tag(b, 'WHARF_CODE');
    out.push({
      visaNo: tag(b, 'VISA_NO'),
      nameZh: tag(b, 'VESSEL_CNAME'),
      nameEn: tag(b, 'VESSEL_ENAME'),
      shipType: tag(b, 'SHIP_TYPE_NAME'),
      wharfName,
      berthNo: parseBerthNo(wharfName, wharfCode),
      status: tag(b, 'STATUS'),
      etaMs: parseTaipeiDate(tag(b, 'ETA_DT')),
      etdMs: parseTaipeiDate(tag(b, 'ETD_DT')),
      actPortMs: parseTaipeiDate(tag(b, 'ACT_PORT_DT')),
      leaveMs: parseTaipeiDate(tag(b, 'LEAVE_DT')),
      beforePort: tag(b, 'BEFORE_PORT'),
      nextPort: tag(b, 'NEXT_PORT'),
      imo: tag(b, 'IMO'),
      callSign: tag(b, 'CALL_SIGN'),
      source,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/port-twport.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/data/twport.ts test/port-twport.test.ts
git commit -m "$(printf 'feat(port): TWPort BIG5-XML vessel parser\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 8: Build-time snapshot fetch → frozen JSON

Fetches the live TWPort feeds, decodes BIG5, parses with the Task 7 module, and writes a dated, reproducible JSON snapshot the app imports. Run via `vite-node` so it can import the TypeScript parser.

**Files:**
- Create: `examples/kaohsiung-port/data/fetch-snapshot.ts`
- Create (generated): `examples/kaohsiung-port/data/snapshots/khh-<date>.json`
- Modify: `package.json` (add a dev script + `vite-node` devDependency)

- [ ] **Step 1: Add `vite-node` and a script**

Run: `npm i -D vite-node`
Then in `package.json` `"scripts"` add:
```json
    "port:fetch": "vite-node examples/kaohsiung-port/data/fetch-snapshot.ts"
```

- [ ] **Step 2: Write the fetch script**

`examples/kaohsiung-port/data/fetch-snapshot.ts`:
```ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseTwportXml, type VesselRecord } from './twport';

const BASE = 'https://tpnet.twport.com.tw/IFAWeb/Reports/OpenData/GetOpenData';

async function fetchType(type: number, source: 'berthing' | 'forecast'): Promise<VesselRecord[]> {
  const res = await fetch(`${BASE}?port=KHH&type=${type}`);
  if (!res.ok) throw new Error(`TWPort type=${type} HTTP ${res.status}`);
  const xml = new TextDecoder('big5').decode(await res.arrayBuffer());
  return parseTwportXml(xml, source);
}

const here = dirname(fileURLToPath(import.meta.url));
const berthing = await fetchType(1, 'berthing');
const forecast = await fetchType(5, 'forecast');
const capturedAtMs = Date.now();
const out = { capturedAtMs, berthing, forecast };

const dir = resolve(here, 'snapshots');
mkdirSync(dir, { recursive: true });
const date = new Date(capturedAtMs).toISOString().slice(0, 10);
const path = resolve(dir, `khh-${date}.json`);
writeFileSync(path, JSON.stringify(out, null, 2));
console.log(`wrote ${path}: ${berthing.length} berthing, ${forecast.length} forecast`);
```

- [ ] **Step 3: Run it and verify BIG5 decoding works**

Run: `npm run port:fetch`
Expected: prints `wrote .../khh-<date>.json: N berthing, M forecast` with N>0. Open the JSON; confirm `nameZh` shows readable Chinese (e.g., a `碼頭` value), not mojibake.
- If `TextDecoder('big5')` throws "encoding not supported" (Node built without full ICU): run `npm i -D iconv-lite`, and in the script replace the decode line with `import iconv from 'iconv-lite'` + `iconv.decode(Buffer.from(await res.arrayBuffer()), 'big5')`.

- [ ] **Step 4: Add a snapshot schema sanity test**

`test/port-snapshot.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('frozen snapshot', () => {
  it('has a well-formed snapshot with berthing records at numbered berths', () => {
    const dir = resolve(__dirname, '../examples/kaohsiung-port/data/snapshots');
    const file = readdirSync(dir).find((f) => f.startsWith('khh-') && f.endsWith('.json'));
    expect(file, 'a khh-*.json snapshot must be committed').toBeDefined();
    const snap = JSON.parse(readFileSync(resolve(dir, file!), 'utf8'));
    expect(typeof snap.capturedAtMs).toBe('number');
    expect(Array.isArray(snap.berthing)).toBe(true);
    expect(snap.berthing.some((v: any) => typeof v.berthNo === 'number')).toBe(true);
  });
});
```

- [ ] **Step 5: Run the test, then commit script + snapshot + test**

Run: `npx vitest run test/port-snapshot.test.ts` → Expected: PASS.
```bash
git add package.json package-lock.json examples/kaohsiung-port/data/fetch-snapshot.ts examples/kaohsiung-port/data/snapshots/ test/port-snapshot.test.ts
git commit -m "$(printf 'feat(port): build-time TWPort snapshot fetch + frozen JSON\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 9: OSM geometry fetch + parser (coastline + piers)

**Files:**
- Create: `examples/kaohsiung-port/data/osm.ts`
- Create: `examples/kaohsiung-port/data/fetch-osm.ts`
- Create (generated): `examples/kaohsiung-port/data/osm-khh.json`
- Modify: `package.json` (add a script)
- Test: `test/port-osm.test.ts`

- [ ] **Step 1: Write the failing test**

`test/port-osm.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseOsmWays } from '../examples/kaohsiung-port/data/osm';

const OVERPASS = {
  elements: [
    { type: 'way', tags: { natural: 'coastline' }, geometry: [{ lat: 22.6, lon: 120.27 }, { lat: 22.59, lon: 120.28 }] },
    { type: 'way', tags: { man_made: 'pier' }, geometry: [{ lat: 22.58, lon: 120.31 }, { lat: 22.575, lon: 120.31 }] },
    { type: 'node', tags: {}, lat: 22.6, lon: 120.3 },
  ],
};

describe('parseOsmWays', () => {
  const r = parseOsmWays(OVERPASS);
  it('classifies coastline and pier ways into polylines', () => {
    expect(r.coastline).toHaveLength(1);
    expect(r.piers).toHaveLength(1);
    expect(r.coastline[0]).toEqual([{ lat: 22.6, lon: 120.27 }, { lat: 22.59, lon: 120.28 }]);
  });
  it('ignores elements without geometry', () => {
    const all = r.coastline.length + r.piers.length;
    expect(all).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/port-osm.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement the parser**

`examples/kaohsiung-port/data/osm.ts`:
```ts
export interface LatLon { lat: number; lon: number; }
export type Polyline = LatLon[];
export interface OsmGeometry { coastline: Polyline[]; piers: Polyline[]; }

interface OverpassEl { type: string; tags?: Record<string, string>; geometry?: LatLon[]; }
interface OverpassDoc { elements: OverpassEl[]; }

/** Split Overpass `out geom` ways into coastline vs pier polylines. */
export function parseOsmWays(doc: OverpassDoc): OsmGeometry {
  const coastline: Polyline[] = [];
  const piers: Polyline[] = [];
  for (const el of doc.elements) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const line = el.geometry.map((g) => ({ lat: g.lat, lon: g.lon }));
    if (el.tags?.natural === 'coastline') coastline.push(line);
    else if (el.tags?.man_made === 'pier') piers.push(line);
  }
  return { coastline, piers };
}
```

- [ ] **Step 4: Write the OSM fetch script**

`examples/kaohsiung-port/data/fetch-osm.ts`:
```ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseOsmWays } from './osm';

const QUERY = `[out:json][timeout:90];
(
  way["natural"="coastline"](22.53,120.24,22.64,120.34);
  way["man_made"="pier"](22.53,120.24,22.64,120.34);
);
out geom;`;

const res = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  body: 'data=' + encodeURIComponent(QUERY),
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
});
if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
const geo = parseOsmWays(await res.json());
const here = dirname(fileURLToPath(import.meta.url));
const path = resolve(here, 'osm-khh.json');
writeFileSync(path, JSON.stringify(geo));
console.log(`wrote ${path}: ${geo.coastline.length} coastline, ${geo.piers.length} piers`);
```

Add to `package.json` `"scripts"`:
```json
    "port:osm": "vite-node examples/kaohsiung-port/data/fetch-osm.ts"
```

- [ ] **Step 5: Run the fetch + tests, then commit**

Run: `npm run port:osm` → Expected: prints non-zero coastline + piers; `osm-khh.json` created.
Run: `npx vitest run test/port-osm.test.ts` → Expected: PASS.
```bash
git add package.json examples/kaohsiung-port/data/osm.ts examples/kaohsiung-port/data/fetch-osm.ts examples/kaohsiung-port/data/osm-khh.json test/port-osm.test.ts
git commit -m "$(printf 'feat(port): OSM coastline/pier geometry fetch + parser\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 10: Berth coordinate table (arc-length along the east-shore line)

**Files:**
- Create: `examples/kaohsiung-port/berths.ts`
- Test: `test/port-berths.test.ts`

- [ ] **Step 1: Write the failing tests**

`test/port-berths.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { berthPositionLatLon, resolveBerthLatLon, sampleAlong, MIN_BERTH, MAX_BERTH } from '../examples/kaohsiung-port/berths';

describe('sampleAlong', () => {
  const line = [{ lat: 0, lon: 0 }, { lat: 0, lon: 10 }];
  it('returns endpoints at frac 0 and 1', () => {
    expect(sampleAlong(line, 0)).toEqual({ lat: 0, lon: 0 });
    expect(sampleAlong(line, 1)).toEqual({ lat: 0, lon: 10 });
  });
  it('interpolates the midpoint at frac 0.5', () => {
    const m = sampleAlong(line, 0.5);
    expect(m.lon).toBeCloseTo(5);
  });
});

describe('berthPositionLatLon', () => {
  it('maps the first/last berths to the ends of the berth line', () => {
    const first = berthPositionLatLon(MIN_BERTH);
    const last = berthPositionLatLon(MAX_BERTH);
    expect(first.lat).toBeGreaterThan(last.lat); // berths run north → south
  });
  it('is monotonic in latitude as berth number grows', () => {
    expect(berthPositionLatLon(20).lat).toBeGreaterThan(berthPositionLatLon(100).lat);
  });
});

describe('resolveBerthLatLon', () => {
  it('returns a stable outer-zone position for null berthNo', () => {
    const a = resolveBerthLatLon({ berthNo: null, wharfName: '二港口港外' } as any);
    const b = resolveBerthLatLon({ berthNo: null, wharfName: '二港口港外' } as any);
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/port-berths.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement the berth table**

`examples/kaohsiung-port/berths.ts`:
```ts
import type { LatLon } from './data/osm';

export const MIN_BERTH = 1;
export const MAX_BERTH = 121;

/**
 * Ordered waypoints down Kaohsiung's east commercial wharf line, north→south:
 * 蓬萊/鼓山 → 中島貨櫃 → 前鎮 → 小港 → 洲際. Approximate (traced from OSM/satellite);
 * good enough for an ordered, recognizable 2.5D layout (see spec §11.2).
 */
export const BERTH_LINE: LatLon[] = [
  { lat: 22.6190, lon: 120.2790 }, // ~#1  蓬萊
  { lat: 22.6080, lon: 120.2880 },
  { lat: 22.5950, lon: 120.2980 }, // 中島貨櫃
  { lat: 22.5820, lon: 120.3050 },
  { lat: 22.5700, lon: 120.3090 }, // 前鎮
  { lat: 22.5600, lon: 120.3120 },
  { lat: 22.5520, lon: 120.3180 }, // 小港
  { lat: 22.5460, lon: 120.3280 }, // ~#121 洲際
];

const OUTER_ZONES: LatLon[] = [
  { lat: 22.6230, lon: 120.2710 }, // 一港口外
  { lat: 22.5420, lon: 120.3360 }, // 二港口外/防波堤外
  { lat: 22.6300, lon: 120.2600 }, // 北錨地
];

function segLen(a: LatLon, b: LatLon): number {
  return Math.hypot(b.lat - a.lat, b.lon - a.lon);
}

/** Sample a polyline by normalized arc length (frac in [0,1]). */
export function sampleAlong(line: LatLon[], frac: number): LatLon {
  if (line.length === 1) return line[0];
  const lens: number[] = [];
  let total = 0;
  for (let i = 0; i < line.length - 1; i++) { const l = segLen(line[i], line[i + 1]); lens.push(l); total += l; }
  let target = Math.max(0, Math.min(1, frac)) * total;
  for (let i = 0; i < lens.length; i++) {
    if (target <= lens[i] || i === lens.length - 1) {
      const t = lens[i] === 0 ? 0 : target / lens[i];
      return {
        lat: line[i].lat + (line[i + 1].lat - line[i].lat) * t,
        lon: line[i].lon + (line[i + 1].lon - line[i].lon) * t,
      };
    }
    target -= lens[i];
  }
  return line[line.length - 1];
}

export function berthPositionLatLon(berthNo: number): LatLon {
  const frac = (berthNo - MIN_BERTH) / (MAX_BERTH - MIN_BERTH);
  return sampleAlong(BERTH_LINE, frac);
}

/** Resolve any record (numbered berth or outer/anchorage) to a stable lat/lon. */
export function resolveBerthLatLon(rec: { berthNo: number | null; wharfName: string }): LatLon {
  if (rec.berthNo != null) return berthPositionLatLon(rec.berthNo);
  let h = 0;
  for (const ch of rec.wharfName) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return OUTER_ZONES[Math.abs(h) % OUTER_ZONES.length];
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/port-berths.test.ts` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/berths.ts test/port-berths.test.ts
git commit -m "$(printf 'feat(port): berth coordinate table via arc-length interpolation\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 11: Temporal occupancy model

**Files:**
- Create: `examples/kaohsiung-port/time/occupancy.ts`
- Test: `test/port-occupancy.test.ts`

- [ ] **Step 1: Write the failing tests**

`test/port-occupancy.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildIntervals, occupancyAt, berthStatusAt } from '../examples/kaohsiung-port/time/occupancy';
import type { VesselRecord } from '../examples/kaohsiung-port/data/twport';

function rec(p: Partial<VesselRecord>): VesselRecord {
  return { visaNo: '', nameZh: '', nameEn: '', shipType: '', wharfName: '', berthNo: null, status: '',
    etaMs: null, etdMs: null, actPortMs: null, leaveMs: null, beforePort: '', nextPort: '', imo: '',
    callSign: '', source: 'berthing', ...p };
}
const HOUR = 3600_000;

describe('occupancy', () => {
  const vessels = [
    rec({ nameZh: 'A', berthNo: 7, actPortMs: 0, leaveMs: 5 * HOUR }),
    rec({ nameZh: 'B', berthNo: 108, etaMs: 10 * HOUR, etdMs: 14 * HOUR, source: 'forecast' }),
  ];
  const intervals = buildIntervals(vessels);

  it('builds one interval per berthed vessel', () => {
    expect(intervals).toHaveLength(2);
    expect(intervals[0]).toMatchObject({ berthNo: 7, startMs: 0, endMs: 5 * HOUR });
  });

  it('occupancyAt returns the vessel occupying a berth at time t', () => {
    const at2h = occupancyAt(intervals, 2 * HOUR);
    expect(at2h.get(7)?.nameZh).toBe('A');
    expect(at2h.has(108)).toBe(false);
  });

  it('berthStatusAt: occupied / incoming / free', () => {
    expect(berthStatusAt(intervals, 7, 2 * HOUR, 2 * HOUR)).toBe('occupied');
    expect(berthStatusAt(intervals, 108, 9 * HOUR, 2 * HOUR)).toBe('incoming'); // arrives in 1h
    expect(berthStatusAt(intervals, 108, 2 * HOUR, 2 * HOUR)).toBe('free');     // arrival far off
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/port-occupancy.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement the model**

`examples/kaohsiung-port/time/occupancy.ts`:
```ts
import type { VesselRecord } from '../data/twport';

export interface BerthInterval { berthNo: number; vessel: VesselRecord; startMs: number; endMs: number; }
export type BerthStatus = 'occupied' | 'incoming' | 'free';

const DEFAULT_STAY_MS = 12 * 3600_000;

/** One occupancy interval per berthed vessel: [arrival, departure). */
export function buildIntervals(vessels: VesselRecord[]): BerthInterval[] {
  const out: BerthInterval[] = [];
  for (const v of vessels) {
    if (v.berthNo == null) continue;
    const startMs = v.actPortMs ?? v.etaMs;
    if (startMs == null) continue;
    const endMs = v.leaveMs ?? v.etdMs ?? startMs + DEFAULT_STAY_MS;
    out.push({ berthNo: v.berthNo, vessel: v, startMs, endMs: Math.max(endMs, startMs + 1) });
  }
  return out;
}

/** berthNo → vessel occupying it at time t (later interval wins on overlap). */
export function occupancyAt(intervals: BerthInterval[], tMs: number): Map<number, VesselRecord> {
  const map = new Map<number, VesselRecord>();
  for (const it of intervals) {
    if (tMs >= it.startMs && tMs < it.endMs) map.set(it.berthNo, it.vessel);
  }
  return map;
}

export function berthStatusAt(
  intervals: BerthInterval[], berthNo: number, tMs: number, incomingWindowMs: number,
): BerthStatus {
  let incoming = false;
  for (const it of intervals) {
    if (it.berthNo !== berthNo) continue;
    if (tMs >= it.startMs && tMs < it.endMs) return 'occupied';
    if (it.startMs > tMs && it.startMs <= tMs + incomingWindowMs) incoming = true;
  }
  return incoming ? 'incoming' : 'free';
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/port-occupancy.test.ts` → Expected: PASS.

- [ ] **Step 5: Run the full suite + commit**

Run: `npm test` → Expected: PASS (all engine + port modules green).
```bash
git add examples/kaohsiung-port/time/occupancy.ts test/port-occupancy.test.ts
git commit -m "$(printf 'feat(port): 24h temporal berth-occupancy model\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 12: Palette + geometry-to-points sampling

**Files:**
- Create: `examples/kaohsiung-port/palette.ts`
- Create: `examples/kaohsiung-port/scene/portPoints.ts`
- Test: `test/port-palette.test.ts`
- Test: `test/port-points.test.ts`

- [ ] **Step 1: Write the failing palette test**

`test/port-palette.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { shipCategoryIndex, statusIndex, valueFor, SHIP_CATEGORY_COLORS, SHIP_CATEGORIES } from '../examples/kaohsiung-port/palette';

describe('palette', () => {
  it('maps known ship types to their category index', () => {
    expect(shipCategoryIndex('全貨櫃船')).toBe(SHIP_CATEGORIES.indexOf('貨櫃'));
    expect(shipCategoryIndex('液化天然氣船')).toBe(SHIP_CATEGORIES.indexOf('LNG'));
  });
  it('maps unknown types to 其他 (last category)', () => {
    expect(shipCategoryIndex('飛碟')).toBe(SHIP_CATEGORIES.indexOf('其他'));
  });
  it('valueFor returns the texel center for NearestFilter', () => {
    expect(valueFor(0, 3)).toBeCloseTo(1 / 6);
    expect(valueFor(2, 3)).toBeCloseTo(5 / 6);
  });
  it('has one color per ship category', () => {
    expect(SHIP_CATEGORY_COLORS).toHaveLength(SHIP_CATEGORIES.length);
  });
  it('orders statuses occupied/free/incoming', () => {
    expect(statusIndex('occupied')).toBe(0);
    expect(statusIndex('incoming')).toBe(2);
  });
});
```

- [ ] **Step 2: Implement the palette**

`examples/kaohsiung-port/palette.ts`:
```ts
import type { RGB } from '../../src/core/types';

export const SHIP_CATEGORIES = ['貨櫃', '油品', '散雜', 'LNG', '工作', '軍艦', '客運', '其他'] as const;
export type ShipCategory = typeof SHIP_CATEGORIES[number];

const TYPE_TO_CATEGORY: Record<string, ShipCategory> = {
  '全貨櫃船': '貨櫃', '半貨櫃船': '貨櫃',
  '油輪': '油品', '油品船': '油品', '油化船': '油品',
  '液化氣體船': 'LNG', '液化天然氣船': 'LNG',
  '散裝船': '散雜', '雜貨船': '散雜', '小貨船': '散雜', '水泥專用船': '散雜', '駛上駛下貨船': '散雜',
  '客貨船': '客運', '工作船': '工作', '漁業巡護船': '工作', '軍用艦艇': '軍艦',
};

export const SHIP_CATEGORY_COLORS: RGB[] = [
  [90, 156, 255], [255, 174, 90], [202, 168, 106], [185, 138, 255],
  [138, 160, 170], [90, 230, 120], [90, 220, 230], [200, 200, 210],
];

export function shipCategoryIndex(shipType: string): number {
  const cat = TYPE_TO_CATEGORY[shipType] ?? '其他';
  return SHIP_CATEGORIES.indexOf(cat);
}

export const STATUS_CATEGORIES = ['occupied', 'free', 'incoming'] as const;
export const STATUS_COLORS: RGB[] = [[255, 110, 110], [90, 230, 160], [255, 209, 90]];
export function statusIndex(s: 'occupied' | 'free' | 'incoming'): number {
  return STATUS_CATEGORIES.indexOf(s);
}

export const BASE_COLORS: RGB[] = [[47, 110, 116], [127, 224, 232]]; // coastline, quay

/** Normalized value for category `index` of `n` (NearestFilter texel center). */
export function valueFor(index: number, n: number): number { return (index + 0.5) / n; }
```

- [ ] **Step 3: Run palette test** — `npx vitest run test/port-palette.test.ts` → PASS.

- [ ] **Step 4: Write the failing points test**

`test/port-points.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { samplePolyline, sampleShipFootprint, buildShipLayer } from '../examples/kaohsiung-port/scene/portPoints';
import { valueFor, shipCategoryIndex, SHIP_CATEGORY_COLORS } from '../examples/kaohsiung-port/palette';
import type { VesselRecord } from '../examples/kaohsiung-port/data/twport';

const idProj = { toWorld: (lat: number, lon: number) => ({ x: lon, z: lat }) };

describe('samplePolyline', () => {
  it('includes both endpoints and intermediate points by spacing', () => {
    const pts = samplePolyline([{ x: 0, z: 0 }, { x: 10, z: 0 }], 2);
    expect(pts[0]).toEqual({ x: 0, z: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 10, z: 0 });
    expect(pts.length).toBe(6); // 0,2,4,6,8,10
  });
});

describe('sampleShipFootprint', () => {
  it('fills a centered grid of (nl+1)*(nw+1) points', () => {
    const pts = sampleShipFootprint({ x: 0, z: 0 }, 10, 4, 0, 2); // nl=5, nw=2 → 6*3=18
    expect(pts.length).toBe(18);
    for (const p of pts) { expect(Math.abs(p.x)).toBeLessThanOrEqual(5.01); expect(Math.abs(p.z)).toBeLessThanOrEqual(2.01); }
  });
});

describe('buildShipLayer', () => {
  it('emits xyz triples valued by ship type', () => {
    const v: VesselRecord = { visaNo: '', nameZh: 'A', nameEn: '', shipType: '全貨櫃船', wharfName: '#50碼頭',
      berthNo: 50, status: '', etaMs: null, etdMs: null, actPortMs: 0, leaveMs: null, beforePort: '', nextPort: '',
      imo: '', callSign: '', source: 'berthing' };
    const batch = buildShipLayer([v], idProj as any, 1, 'type', 5);
    expect(batch.positions.length % 3).toBe(0);
    expect(batch.values.length).toBeGreaterThan(0);
    expect(batch.values[0]).toBeCloseTo(valueFor(shipCategoryIndex('全貨櫃船'), SHIP_CATEGORY_COLORS.length));
  });
});
```

- [ ] **Step 5: Implement `portPoints.ts`**

`examples/kaohsiung-port/scene/portPoints.ts`:
```ts
import type { World, Projection } from '../geo/projection';
import type { LatLon, Polyline } from '../data/osm';
import type { VesselRecord } from '../data/twport';
import { resolveBerthLatLon } from '../berths';
import { SHIP_CATEGORY_COLORS, BASE_COLORS, STATUS_COLORS, shipCategoryIndex, statusIndex, valueFor } from '../palette';

export interface PointBatch { positions: Float32Array; values: Float32Array; }

const Y_WATER = 0;
const Y_SHIP = 1.5;

export function samplePolyline(pts: World[], spacing: number): World[] {
  const out: World[] = [];
  if (pts.length === 0) return out;
  out.push(pts[0]);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.round(len / spacing));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

export function sampleShipFootprint(center: World, lengthU: number, widthU: number, headingRad: number, spacing: number): World[] {
  const out: World[] = [];
  const cos = Math.cos(headingRad), sin = Math.sin(headingRad);
  const nl = Math.max(1, Math.round(lengthU / spacing));
  const nw = Math.max(1, Math.round(widthU / spacing));
  for (let i = 0; i <= nl; i++) {
    for (let j = 0; j <= nw; j++) {
      const lx = (i / nl - 0.5) * lengthU;
      const lz = (j / nw - 0.5) * widthU;
      out.push({ x: center.x + lx * cos - lz * sin, z: center.z + lx * sin + lz * cos });
    }
  }
  return out;
}

const llToWorld = (proj: Projection, ll: LatLon): World => proj.toWorld(ll.lat, ll.lon);

export function buildBaseLayer(coastline: Polyline[], piers: Polyline[], proj: Projection, spacing = 1.5): PointBatch {
  const pos: number[] = []; const val: number[] = [];
  const push = (w: World[], catIdx: number) => {
    const v = valueFor(catIdx, BASE_COLORS.length);
    for (const p of w) { pos.push(p.x, Y_WATER, p.z); val.push(v); }
  };
  for (const line of coastline) push(samplePolyline(line.map((l) => llToWorld(proj, l)), spacing), 0);
  for (const line of piers) push(samplePolyline(line.map((l) => llToWorld(proj, l)), spacing), 1);
  return { positions: new Float32Array(pos), values: new Float32Array(val) };
}

// typical vessel size (m) per ship-category index (parallels SHIP_CATEGORY_COLORS order)
const TYPE_DIMS_M: Array<{ loa: number; beam: number }> = [
  { loa: 300, beam: 45 }, { loa: 250, beam: 44 }, { loa: 180, beam: 30 }, { loa: 290, beam: 49 },
  { loa: 40, beam: 12 }, { loa: 130, beam: 16 }, { loa: 200, beam: 32 }, { loa: 120, beam: 20 },
];

export interface ShipLayerResult extends PointBatch { centers: Array<{ vessel: VesselRecord; x: number; y: number; z: number }>; }

/** Dynamic ship layer for `occupied` vessels; `colorBy` = type palette or fixed 'occupied' status color. */
export function buildShipLayer(
  occupied: VesselRecord[], proj: Projection, scale: number, colorBy: 'type' | 'status', spacing = 1.2,
): ShipLayerResult {
  const pos: number[] = []; const val: number[] = [];
  const centers: ShipLayerResult['centers'] = [];
  const statusVal = valueFor(statusIndex('occupied'), STATUS_COLORS.length);
  for (const v of occupied) {
    const ll = resolveBerthLatLon(v);
    const c = proj.toWorld(ll.lat, ll.lon);
    const catIdx = shipCategoryIndex(v.shipType);
    const dim = TYPE_DIMS_M[catIdx];
    const pts = sampleShipFootprint(c, dim.loa * scale, dim.beam * scale, 0, spacing);
    const v01 = colorBy === 'type' ? valueFor(catIdx, SHIP_CATEGORY_COLORS.length) : statusVal;
    for (const p of pts) { pos.push(p.x, Y_SHIP, p.z); val.push(v01); }
    centers.push({ vessel: v, x: c.x, y: Y_SHIP, z: c.z });
  }
  return { positions: new Float32Array(pos), values: new Float32Array(val), centers };
}
```

- [ ] **Step 6: Run points test + full suite, then commit**

Run: `npx vitest run test/port-points.test.ts` → PASS. Then `npm test` → PASS.
```bash
git add examples/kaohsiung-port/palette.ts examples/kaohsiung-port/scene/portPoints.ts test/port-palette.test.ts test/port-points.test.ts
git commit -m "$(printf 'feat(port): palette + geometry-to-points sampling\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 13: Render the real port at "now" (base + ship layers)

Replaces the scaffold's test points with the real twin: base layer (OSM coastline + piers) and ship layer (vessels occupying berths at the snapshot's capture time), type-colored.

**Files:**
- Modify: `examples/kaohsiung-port/main.ts` (full replacement)

- [ ] **Step 1: Replace `main.ts`**

`examples/kaohsiung-port/main.ts`:
```ts
import { LidarEngine, PointCloud, buildCategoryLUT } from '../../src/index';
import { createProjection, KAOHSIUNG_ORIGIN, WORLD_SCALE } from './geo/projection';
import { buildBaseLayer, buildShipLayer, type ShipLayerResult } from './scene/portPoints';
import { buildIntervals, occupancyAt } from './time/occupancy';
import { BASE_COLORS, SHIP_CATEGORY_COLORS } from './palette';
import type { VesselRecord } from './data/twport';
import type { OsmGeometry } from './data/osm';
import osmData from './data/osm-khh.json';

interface Snapshot { capturedAtMs: number; berthing: VesselRecord[]; forecast: VesselRecord[]; }
const snaps = import.meta.glob('./data/snapshots/*.json', { eager: true, import: 'default' });
const snapshot = Object.values(snaps)[0] as Snapshot;
const osm = osmData as OsmGeometry;

const canvas = document.getElementById('view') as HTMLCanvasElement;
function fit() { canvas.style.width = '100vw'; canvas.style.height = '100vh'; }
fit();

const proj = createProjection(KAOHSIUNG_ORIGIN.lat, KAOHSIUNG_ORIGIN.lon, WORLD_SCALE);
const intervals = buildIntervals([...snapshot.berthing, ...snapshot.forecast]);
const nowMs = snapshot.capturedAtMs;

// Static base layer.
const base = buildBaseLayer(osm.coastline, osm.piers, proj);
const basePC = new PointCloud({ capacity: base.values.length + 16, ramp: buildCategoryLUT(BASE_COLORS),
  persistence: 'accumulate', colorMode: 'value', maxPointSize: 3.5 });
basePC.addPoints(base.positions, base.values);

// Dynamic ship layer.
const shipPC = new PointCloud({ capacity: 120_000, ramp: buildCategoryLUT(SHIP_CATEGORY_COLORS),
  persistence: 'accumulate', colorMode: 'value', maxPointSize: 4 });
let shipCenters: ShipLayerResult['centers'] = [];
function rebuildShips(tMs: number, colorBy: 'type' | 'status') {
  const occ = [...occupancyAt(intervals, tMs).values()];
  const batch = buildShipLayer(occ, proj, WORLD_SCALE, colorBy);
  shipCenters = batch.centers;
  shipPC.clear();
  shipPC.addPoints(batch.positions, batch.values);
}
rebuildShips(nowMs, 'type');

const engine = new LidarEngine({ canvas, autoScan: false, cameraMode: 'orbit',
  cameraPosition: [0, 110, 150], cameraTarget: [0, 0, 0], pointBudget: 100 });
engine.addLayer(basePC.points);
engine.addLayer(shipPC.points);
engine.start();

window.addEventListener('resize', () => { fit(); engine.resize(); });

// Expose for later tasks (overlay/time slider).
(window as any).__twin = { engine, rebuildShips, nowMs, intervals, get shipCenters() { return shipCenters; } };
```

- [ ] **Step 2: Verify the port renders**

Run: `npm run dev`, open `/examples/kaohsiung-port/index.html`, screenshot with the browser.
Expected: a recognizable Kaohsiung silhouette in teal coastline points, brighter quay lines, and clusters of colored ship points along the east shore; orbit/zoom work; no console errors.
- If the scene is off-frame or too small/large, adjust `cameraPosition` / `WORLD_SCALE` and re-screenshot until framed. Stop the server.

- [ ] **Step 3: Commit**

```bash
git add examples/kaohsiung-port/main.ts
git commit -m "$(printf 'feat(port): render real port base + ship layers at snapshot time\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 14: HTML overlay — legend, KPIs, ship detail, filters, view toggle

**Files:**
- Create: `examples/kaohsiung-port/ui/overlay.ts`
- Modify: `examples/kaohsiung-port/main.ts`
- Modify: `src/core/LidarEngine.ts` (add a camera accessor for screen picking)
- Test: `test/port-format.test.ts`

- [ ] **Step 1: Add a camera accessor to the engine (for world→screen picking)**

In `src/core/LidarEngine.ts` add a getter:
```ts
  /** The render camera (for app-side world→screen projection / picking). */
  get camera3D(): THREE.PerspectiveCamera { return this.camera; }
```
Run `npm test` → Expected: PASS (additive).

- [ ] **Step 2: Write a failing test for the pure formatting helper**

`test/port-format.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { fmtClock } from '../examples/kaohsiung-port/ui/overlay';

describe('fmtClock', () => {
  it('formats an epoch ms as Taipei MM/DD HH:mm', () => {
    // 2026-06-15 07:00 Taipei == 2026-06-14 23:00 UTC
    expect(fmtClock(Date.UTC(2026, 5, 14, 23, 0, 0))).toBe('06/15 07:00');
  });
});
```

- [ ] **Step 3: Implement `overlay.ts`**

`examples/kaohsiung-port/ui/overlay.ts`:
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
const rgb = (c: number[]) => `rgb(${c[0]},${c[1]},${c[2]})`;

export interface OverlayHandlers {
  onFilter(enabled: Set<string>): void;
  onView(mode: 'type' | 'status'): void;
}
export interface OverlayApi {
  setKpi(opts: { inPort: number; occupied: number; total: number; dateMs: number }): void;
  showVessel(v: VesselRecord): void;
  hideVessel(): void;
}

export function createOverlay(root: HTMLElement, handlers: OverlayHandlers): OverlayApi {
  root.innerHTML = '';
  const enabled = new Set<string>(SHIP_CATEGORIES);

  const kpi = document.createElement('div');
  kpi.className = 'panel';
  kpi.style.cssText = 'left:12px;top:12px;right:12px;padding:8px 12px;display:flex;gap:14px;align-items:center';
  root.appendChild(kpi);

  const legend = document.createElement('div');
  legend.className = 'panel';
  legend.style.cssText = 'left:12px;top:60px;width:160px;padding:10px';
  legend.innerHTML = '<div style="opacity:.6;text-transform:uppercase;font-size:10px;margin-bottom:6px">船型篩選</div>';
  SHIP_CATEGORIES.forEach((cat, i) => {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;margin:3px 0;cursor:pointer';
    row.innerHTML = `<input type="checkbox" checked>
      <span style="width:9px;height:9px;border-radius:50%;background:${rgb(SHIP_CATEGORY_COLORS[i])}"></span>${cat}`;
    const cb = row.querySelector('input')!;
    cb.addEventListener('change', () => {
      if (cb.checked) enabled.add(cat); else enabled.delete(cat);
      handlers.onFilter(new Set(enabled));
    });
    legend.appendChild(row);
  });
  const viewBtn = document.createElement('button');
  viewBtn.textContent = '檢視:船型 ↔ 狀態';
  viewBtn.style.cssText = 'margin-top:8px;width:100%;background:#0e1622;color:#9fe;border:1px solid #223247;border-radius:6px;padding:6px;cursor:pointer';
  let mode: 'type' | 'status' = 'type';
  viewBtn.addEventListener('click', () => { mode = mode === 'type' ? 'status' : 'type'; handlers.onView(mode); });
  legend.appendChild(viewBtn);
  root.appendChild(legend);

  const card = document.createElement('div');
  card.className = 'panel';
  card.style.cssText = 'right:12px;top:60px;width:200px;padding:10px;display:none';
  root.appendChild(card);

  return {
    setKpi({ inPort, occupied, total, dateMs }) {
      kpi.innerHTML = `<b style="color:#9fe">高雄港 · LiDAR 數位孿生</b>
        <span>在港船 <b>${inPort}</b></span>
        <span>泊位佔用 <b>${occupied}/${total}</b></span>
        <span style="margin-left:auto">${fmtClock(dateMs)}</span>`;
    },
    showVessel(v) {
      card.style.display = 'block';
      card.innerHTML = `<b style="color:#9fe">${v.nameZh} ${v.nameEn}</b>
        <div style="margin-top:6px">船型:${v.shipType}</div>
        <div>泊位:${v.wharfName}</div>
        <div>前一港:${v.beforePort}</div>
        <div>下一港:${v.nextPort}</div>
        <div>IMO:${v.imo || '—'}</div>`;
    },
    hideVessel() { card.style.display = 'none'; },
  };
}
```

- [ ] **Step 4: Run the format test** — `npx vitest run test/port-format.test.ts` → PASS.

- [ ] **Step 5: Wire the overlay into `main.ts`**

Append to `examples/kaohsiung-port/main.ts` (after the `engine.start();` / resize lines, replacing the temporary `(window as any).__twin` line):
```ts
import * as THREE from 'three';
import { createOverlay } from './ui/overlay';
import { MAX_BERTH, MIN_BERTH } from './berths';

const TOTAL_BERTHS = MAX_BERTH - MIN_BERTH + 1;
let colorBy: 'type' | 'status' = 'type';
let filter = new Set<string>();

const overlay = createOverlay(document.getElementById('overlay') as HTMLElement, {
  onFilter(enabled) { filter = enabled; refresh(currentMs); },
  onView(mode) { colorBy = mode; shipPC.setColorMode('value'); refresh(currentMs); },
});

let currentMs = nowMs;
function refresh(tMs: number) {
  currentMs = tMs;
  rebuildShips(tMs, colorBy, filter);
  overlay.setKpi({ inPort: shipCenters.length, occupied: shipCenters.length, total: TOTAL_BERTHS, dateMs: tMs });
}
refresh(nowMs);

// Click-to-pick nearest ship centroid (screen-space).
canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  let best: { v: VesselRecord; d: number } | null = null;
  for (const c of shipCenters) {
    const p = new THREE.Vector3(c.x, c.y, c.z).project(engine.camera3D);
    const sx = (p.x * 0.5 + 0.5) * rect.width, sy = (-p.y * 0.5 + 0.5) * rect.height;
    const d = Math.hypot(sx - mx, sy - my);
    if (p.z < 1 && (!best || d < best.d)) best = { v: c.vessel, d };
  }
  if (best && best.d < 28) overlay.showVessel(best.v); else overlay.hideVessel();
});
```

- [ ] **Step 6: Update `rebuildShips` to accept a filter**

In `main.ts`, change the `rebuildShips` definition to filter occupants by enabled ship category:
```ts
import { shipCategoryIndex, SHIP_CATEGORIES } from './palette';

function rebuildShips(tMs: number, mode: 'type' | 'status', enabled?: Set<string>) {
  let occ = [...occupancyAt(intervals, tMs).values()];
  if (enabled && enabled.size < SHIP_CATEGORIES.length) {
    occ = occ.filter((v) => enabled.has(SHIP_CATEGORIES[shipCategoryIndex(v.shipType)]));
  }
  const batch = buildShipLayer(occ, proj, WORLD_SCALE, mode);
  shipCenters = batch.centers;
  shipPC.clear();
  shipPC.addPoints(batch.positions, batch.values);
  shipPC.setRamp(mode === 'type' ? buildCategoryLUT(SHIP_CATEGORY_COLORS) : buildCategoryLUT(STATUS_COLORS));
}
```
Add the needed imports at the top of `main.ts`: `STATUS_COLORS` from `./palette`. Remove the now-unused standalone `rebuildShips(nowMs, 'type')` call from Task 13 (the `refresh()` call replaces it).

- [ ] **Step 7: Verify in the browser**

Run `npm run dev`, open the app, screenshot. Expected: KPI bar (top), legend with ship-type checkboxes + view toggle (left), clicking a ship cluster shows its detail card (right); unchecking a type removes those ships; the view toggle recolors ships red (status) vs by type. No console errors. Stop the server.

- [ ] **Step 8: Run the suite + commit**

Run `npm test` → PASS.
```bash
git add src/core/LidarEngine.ts examples/kaohsiung-port/ui/overlay.ts examples/kaohsiung-port/main.ts test/port-format.test.ts
git commit -m "$(printf 'feat(port): overlay legend/KPI/detail/filter + ship picking\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 15: 24-hour time slider + incoming markers

**Files:**
- Modify: `examples/kaohsiung-port/ui/overlay.ts` (add the slider)
- Modify: `examples/kaohsiung-port/main.ts` (wire scrub + play + incoming layer)

- [ ] **Step 1: Add a time slider to the overlay**

In `overlay.ts`, extend `OverlayHandlers` with `onScrub(tMs: number): void` and add to `OverlayApi`: `setTimeRange(opts: { minMs: number; maxMs: number; nowMs: number }): void` and `setClock(ms: number): void`. Inside `createOverlay`, before the `return`, add:
```ts
  const bar = document.createElement('div');
  bar.className = 'panel';
  bar.style.cssText = 'left:12px;right:12px;bottom:12px;padding:8px 12px;display:flex;gap:10px;align-items:center';
  const play = document.createElement('button');
  play.textContent = '▶';
  play.style.cssText = 'background:#0e1622;color:#9fe;border:1px solid #223247;border-radius:6px;padding:4px 9px;cursor:pointer';
  const slider = document.createElement('input');
  slider.type = 'range'; slider.style.flex = '1';
  const clock = document.createElement('span'); clock.style.cssText = 'min-width:92px;text-align:right;color:#9fe';
  bar.append(play, slider, clock);
  root.appendChild(bar);

  let playing = false; let timer = 0;
  slider.addEventListener('input', () => { stop(); handlers.onScrub(+slider.value); });
  function stop() { playing = false; play.textContent = '▶'; if (timer) cancelAnimationFrame(timer); }
  play.addEventListener('click', () => {
    playing = !playing; play.textContent = playing ? '⏸' : '▶';
    const step = () => {
      if (!playing) return;
      let v = +slider.value + (+slider.max - +slider.min) / 600; // ~10s sweep
      if (v > +slider.max) v = +slider.min;
      slider.value = String(v); handlers.onScrub(v); timer = requestAnimationFrame(step);
    };
    if (playing) timer = requestAnimationFrame(step);
  });
```
And implement the two new API methods in the returned object:
```ts
    setTimeRange({ minMs, maxMs, nowMs }) {
      slider.min = String(minMs); slider.max = String(maxMs); slider.value = String(nowMs);
    },
    setClock(ms) { clock.textContent = fmtClock(ms); },
```

- [ ] **Step 2: Wire the slider + incoming markers in `main.ts`**

Add an incoming-marker layer and the scrub handler. Add near the ship layer setup:
```ts
import { berthStatusAt } from './time/occupancy';
import { berthPositionLatLon, MIN_BERTH as MINB, MAX_BERTH as MAXB } from './berths';
import { STATUS_COLORS, statusIndex, valueFor } from './palette';
import { sampleShipFootprint } from './scene/portPoints';

const incPC = new PointCloud({ capacity: 40_000, ramp: buildCategoryLUT(STATUS_COLORS),
  persistence: 'accumulate', colorMode: 'value', maxPointSize: 4 });
engine.addLayer(incPC.points);
const INCOMING_WINDOW = 2 * 3600_000;

function rebuildIncoming(tMs: number) {
  const pos: number[] = []; const val: number[] = [];
  const v01 = valueFor(statusIndex('incoming'), STATUS_COLORS.length);
  for (let b = MINB; b <= MAXB; b++) {
    if (berthStatusAt(intervals, b, tMs, INCOMING_WINDOW) !== 'incoming') continue;
    const ll = berthPositionLatLon(b); const c = proj.toWorld(ll.lat, ll.lon);
    for (const p of sampleShipFootprint(c, 8 * WORLD_SCALE * 100, 8 * WORLD_SCALE * 100, 0, 1.2)) { pos.push(p.x, 0.8, p.z); val.push(v01); }
  }
  incPC.clear(); incPC.addPoints(new Float32Array(pos), new Float32Array(val));
}
```
Extend `refresh()` to also call `rebuildIncoming(tMs)` and `overlay.setClock(tMs)`. After `overlay` is created, set the range:
```ts
overlay.setTimeRange({ minMs: nowMs - 12 * 3600_000, maxMs: nowMs + 12 * 3600_000, nowMs });
```
And add `onScrub(tMs) { refresh(tMs); }` to the handlers object passed to `createOverlay`.

- [ ] **Step 3: Verify scrubbing in the browser**

Run `npm run dev`, open the app, screenshot at a few slider positions + press play. Expected: dragging the slider changes which ships occupy berths (ships appear/disappear), amber incoming markers show near berths with vessels arriving within 2h, the clock updates, and play sweeps time. No console errors. Stop the server.

- [ ] **Step 4: Run the suite + commit**

Run `npm test` → PASS.
```bash
git add examples/kaohsiung-port/ui/overlay.ts examples/kaohsiung-port/main.ts
git commit -m "$(printf 'feat(port): 24h time slider, scrub/play, incoming berth markers\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 16 (Phase 1 finish): backdrop toggle B (points) ↔ C (offline map plane)

**Files:**
- Modify: `examples/kaohsiung-port/ui/overlay.ts` (add a toggle button)
- Modify: `examples/kaohsiung-port/main.ts` (add a textured ground plane)
- Add (engineer-supplied): `examples/kaohsiung-port/assets/khh-map.png`

- [ ] **Step 1: Supply an offline map image**

Save a dimmed top-down map/satellite image of the Kaohsiung port bbox `(22.53,120.24)–(22.64,120.34)` as `examples/kaohsiung-port/assets/khh-map.png` (e.g., a screenshot from OpenStreetMap/satellite at that extent). Keep north up.

- [ ] **Step 2: Add a backdrop toggle handler + button**

In `overlay.ts` extend `OverlayHandlers` with `onBackdrop(on: boolean): void` and add a button (place it in the `legend` panel after `viewBtn`):
```ts
  const bgBtn = document.createElement('button');
  bgBtn.textContent = '🗺️ 真實底圖:關';
  bgBtn.style.cssText = 'margin-top:6px;width:100%;background:#0e1622;color:#9fe;border:1px solid #223247;border-radius:6px;padding:6px;cursor:pointer';
  let bgOn = false;
  bgBtn.addEventListener('click', () => { bgOn = !bgOn; bgBtn.textContent = `🗺️ 真實底圖:${bgOn ? '開' : '關'}`; handlers.onBackdrop(bgOn); });
  legend.appendChild(bgBtn);
```

- [ ] **Step 3: Add the ground-plane mesh in `main.ts`**

Compute the plane size from the bbox corners via the projection, load the texture, add it (hidden by default), and toggle visibility:
```ts
const sw = proj.toWorld(22.53, 120.24); const ne = proj.toWorld(22.64, 120.34);
const planeW = Math.abs(ne.x - sw.x); const planeH = Math.abs(ne.z - sw.z);
const tex = new THREE.TextureLoader().load('./assets/khh-map.png');
const plane = new THREE.Mesh(
  new THREE.PlaneGeometry(planeW, planeH),
  new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.55, depthWrite: false }),
);
plane.rotation.x = -Math.PI / 2;
plane.position.set((sw.x + ne.x) / 2, -0.5, (sw.z + ne.z) / 2);
plane.visible = false;
engine.addLayer(plane);
```
Add `onBackdrop(on) { plane.visible = on; }` to the handlers object.

- [ ] **Step 4: Verify both modes**

Run `npm run dev`, open the app, screenshot with backdrop off (coastline points only) and on (map plane beneath the points, rotating with the orbit). If the map is misaligned, nudge `plane.position`/size. Confirm a missing image only logs a quiet texture warning and does not crash (the toggle still works once supplied). Stop the server.

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/ui/overlay.ts examples/kaohsiung-port/main.ts examples/kaohsiung-port/assets/
git commit -m "$(printf 'feat(port): backdrop toggle — coastline points vs offline map plane\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 17 (Phase 2, optional): "glide-in" arrival animation

Eye-candy only; skip if time-constrained. When a vessel's interval starts within the visible window, animate its footprint from its nearest outer zone to its berth over a short duration instead of popping in.

**Files:**
- Modify: `examples/kaohsiung-port/main.ts`

- [ ] **Step 1:** In `rebuildShips`, for each occupant compute `arrivalProgress = clamp((tMs - intervalStart) / GLIDE_MS, 0, 1)` (look the interval up from `intervals`), and lerp the footprint center from `resolveBerthLatLon` of its outer zone to the berth position by `arrivalProgress`. Use `GLIDE_MS = 20 * 60_000`.
- [ ] **Step 2:** Verify in the browser that ships slide to berths near their arrival time; no console errors.
- [ ] **Step 3:** Commit: `feat(port): glide-in arrival animation (eye-candy)`.

---

## Self-Review (completed during planning)

**1. Spec coverage** — every spec section maps to a task:
- Decision 1 (always-on status color): Tasks 1, 3, 12. Decision 2 (real data): Tasks 7–10. Decision 3 (orbit): Task 4. Decision 4 (24h timeline): Tasks 11, 15. Decision 5 (engine + geo-real pipeline): Tasks 1–4 + 6–13. Decision 6 (B default / C toggle): Tasks 13, 16.
- Data pipeline §6: Tasks 7 (parse), 8 (frozen snapshot/CORS), 9 (OSM), 10 (berths), 11 (occupancy). Render/UI §7: Tasks 12–16. Error handling §8: Task 4 (empty scannable), Task 8 (snapshot fallback + BIG5), Task 16 (missing map degrades). Perf §9: two-layer design (Tasks 13–15), `maxPointSize` (Tasks 1, 4). Testing §10: pure-logic unit tests per module + browser smoke; regression rule (cave demo). Limitations §11: berth occupancy not AIS tracks (Tasks 11/15 model discrete intervals; glide-in is flagged eye-candy in Task 17).

**2. Placeholder scan** — every code step contains complete code; commands have expected output; no "TBD"/"handle edge cases" left abstract. The only engineer-supplied asset (offline map PNG, Task 16 Step 1) is explicitly called out, not a hidden gap.

**3. Type consistency** — shared types verified across tasks: `World`/`Projection` (Task 6) used by `portPoints`/`main` (12/13); `VesselRecord` (Task 7) used by `occupancy`/`portPoints`/`overlay` (11/12/14); `LatLon`/`Polyline`/`OsmGeometry` (Task 9) used by `berths`/`portPoints`/`main` (10/12/13); `BerthInterval` + `occupancyAt`/`berthStatusAt`/`buildIntervals` (Task 11) used in `main` (13/15); `PointCloud.addPoints`/`setColorMode`/`valueArray` (Tasks 1–2) used by every layer; `buildCategoryLUT` (Task 3) used by all layers; `engine.addLayer`/`autoScan`/`cameraMode`/`camera3D` (Tasks 4, 14) used in `main`. `rebuildShips` signature settles at `(tMs, mode, enabled?)` in Task 14 and is used consistently in Task 15.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-14-kaohsiung-port-lidar-twin.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
