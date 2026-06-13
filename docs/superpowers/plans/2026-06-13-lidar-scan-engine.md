# LiDAR Scan Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable Three.js + TypeScript LiDAR point-cloud scanning engine (Scanner Sombre style) with swappable scannable/emitter/ramp slots, plus an interactive example demo.

**Architecture:** A fixed core pipeline — Emitter → RaycastSampler → PointCloud (GPU ring buffer) → Renderer — with three swappable slots (Scannable geometry, Scan Emitter, Color Ramp). Points are born from `three-mesh-bvh` raycasts against arbitrary meshes, accumulated into a preallocated GPU buffer (FIFO over a point budget), and colored on the GPU by sampling a distance→color LUT texture.

**Tech Stack:** TypeScript, Three.js, three-mesh-bvh, Vite (dev/build), Vitest (tests). Pure-logic modules (RingBuffer, ramps, emitters, RaycastSampler, PointCloud buffer writes) are developed test-first in a Node environment (no WebGL needed). Rendering/engine wiring is verified via the example demo + a lightweight export smoke test.

Spec: [docs/superpowers/specs/2026-06-13-lidar-scan-engine-design.md](../specs/2026-06-13-lidar-scan-engine-design.md)

---

## File Structure

```
lidar-engine/
  package.json          # deps + scripts (test/dev/build)
  tsconfig.json
  vite.config.ts        # build (lib mode) + vitest config (environment: node)
  src/
    index.ts            # public exports
    env.d.ts            # *.glsl?raw module declaration
    core/
      types.ts          # RGB, Ray, Hit, EmitContext, Emitter, Scannable, ColorRamp, Persistence
      RingBuffer.ts     # PURE: FIFO write-head over fixed capacity (TDD)
      RaycastSampler.ts # three-mesh-bvh raycasting wrapper (TDD, headless)
      PointCloud.ts     # GPU ring-buffer point store + ShaderMaterial (addHits TDD)
      LidarEngine.ts    # orchestrator: renderer + camera + raf loop + controls
    emitters/
      cone.ts           # PURE: coneRays() shared helper (TDD via cursorCone)
      cursorCone.ts     # PURE: cursor-aimed cone emitter (TDD)
      autoSweep.ts      # PURE: hands-free Lissajous sweep emitter
      pulseRing.ts      # PURE: expanding-ring emitter (TDD)
      index.ts
    scannables/
      procedural.ts     # example cave/corridor from real meshes
      gltf.ts           # load a glTF as a Scannable
      index.ts
    ramps/
      gradient.ts       # PURE: sampleGradient(), ColorStop (TDD)
      presets.ts        # rainbowDepthStops, thermalStops, monoNeonStops
      lut.ts            # buildRampTexture(), buildRampTextureFromFn()
      index.ts          # ramps.rainbowDepth/thermal/monoNeon (DataTextures)
    shaders/
      points.vert.glsl
      points.frag.glsl
  examples/
    basic/
      index.html
      main.ts           # wires engine + pointer input + auto-sweep + HUD
  test/
    RingBuffer.test.ts
    gradient.test.ts
    cursorCone.test.ts
    pulseRing.test.ts
    RaycastSampler.test.ts
    PointCloud.test.ts
    exports.test.ts     # smoke: public API is wired
```

---

## Task 0: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `src/env.d.ts`, `test/smoke.test.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "lidar-engine",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/lidar-engine.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "three": "^0.171.0",
    "three-mesh-bvh": "^0.8.3"
  },
  "devDependencies": {
    "@types/three": "^0.171.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "outDir": "dist"
  },
  "include": ["src", "examples", "test"]
}
```

- [ ] **Step 3: Create `vite.config.ts`** (library build + vitest node environment)

```ts
/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'LidarEngine',
      fileName: 'lidar-engine',
      formats: ['es'],
    },
    rollupOptions: { external: ['three', 'three-mesh-bvh'] },
  },
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 4: Create `src/env.d.ts`** (so `?raw` glsl imports type-check)

```ts
declare module '*.glsl?raw' {
  const src: string;
  export default src;
}
```

- [ ] **Step 5: Create `test/smoke.test.ts`** (confirms the toolchain runs)

```ts
import { describe, it, expect } from 'vitest';

describe('toolchain', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Install deps and run the smoke test**

Run: `npm install && npm test`
Expected: PASS — 1 passed (`test/smoke.test.ts`)

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json vite.config.ts src/env.d.ts test/smoke.test.ts package-lock.json
git commit -m "chore: scaffold lidar-engine (vite + vitest + ts)"
```

---

## Task 1: Core types

**Files:**
- Create: `src/core/types.ts`

- [ ] **Step 1: Write `src/core/types.ts`**

```ts
import * as THREE from 'three';

/** Color as [r, g, b], each channel 0..255. */
export type RGB = [number, number, number];

/** A single scan ray. `direction` is expected to be normalized. */
export interface Ray {
  origin: THREE.Vector3;
  direction: THREE.Vector3;
}

/** A ray's intersection with the scannable geometry. */
export interface Hit {
  point: THREE.Vector3;
  distance: number; // distance from ray origin
}

/** State handed to an emitter each frame. `rng` is injectable for determinism. */
export interface EmitContext {
  origin: THREE.Vector3;  // scanner (camera) position
  forward: THREE.Vector3; // camera forward (normalized)
  right: THREE.Vector3;   // camera right (normalized)
  up: THREE.Vector3;      // camera up (normalized)
  aim: THREE.Vector2;     // normalized cursor offset, components in [-1, 1]
  time: number;           // seconds since start
  dt: number;             // seconds since last frame
  rng: () => number;      // returns [0, 1); injectable for tests
}

/** A scan emitter produces a batch of rays per frame. */
export interface Emitter {
  emit(ctx: EmitContext): Ray[];
}

/** The geometry being scanned. Meshes must be raycastable (BVH built by the sampler). */
export interface Scannable {
  objects: THREE.Object3D[];
}

/** Distance→color mapping. Either a prebuilt LUT texture or a function over dist01∈[0,1] → RGB(0..255). */
export type ColorRamp = THREE.Texture | ((dist01: number) => RGB);

export type Persistence = 'accumulate' | 'fade';
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/core/types.ts
git commit -m "feat: core types (Ray, Hit, EmitContext, Emitter, Scannable, ColorRamp)"
```

---

## Task 2: RingBuffer (PURE / TDD)

FIFO write-head over a fixed capacity. Returns the 1–2 contiguous segments to write into (handles wraparound), advances the head, caps count at capacity.

**Files:**
- Create: `src/core/RingBuffer.ts`
- Test: `test/RingBuffer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/RingBuffer.test.ts
import { describe, it, expect } from 'vitest';
import { RingBuffer } from '../src/core/RingBuffer';

describe('RingBuffer', () => {
  it('starts empty', () => {
    const rb = new RingBuffer(10);
    expect(rb.count).toBe(0);
    expect(rb.writeHead).toBe(0);
  });

  it('reserves a contiguous segment without wrapping', () => {
    const rb = new RingBuffer(10);
    expect(rb.reserve(3)).toEqual([{ start: 0, length: 3 }]);
    expect(rb.count).toBe(3);
    expect(rb.writeHead).toBe(3);
  });

  it('splits into two segments when wrapping and caps count', () => {
    const rb = new RingBuffer(10);
    rb.reserve(3); // head = 3
    expect(rb.reserve(8)).toEqual([
      { start: 3, length: 7 },
      { start: 0, length: 1 },
    ]);
    expect(rb.writeHead).toBe(1);
    expect(rb.count).toBe(10); // capped at capacity
  });

  it('fills the whole buffer when reserving >= capacity', () => {
    const rb = new RingBuffer(10);
    rb.reserve(4); // head = 4
    expect(rb.reserve(15)).toEqual([{ start: 0, length: 10 }]);
    expect(rb.writeHead).toBe(0);
    expect(rb.count).toBe(10);
  });

  it('reserve(0) is a no-op', () => {
    const rb = new RingBuffer(10);
    expect(rb.reserve(0)).toEqual([]);
    expect(rb.count).toBe(0);
  });

  it('clear resets head and count', () => {
    const rb = new RingBuffer(10);
    rb.reserve(5);
    rb.clear();
    expect(rb.count).toBe(0);
    expect(rb.writeHead).toBe(0);
  });

  it('throws on non-positive capacity', () => {
    expect(() => new RingBuffer(0)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/RingBuffer.test.ts`
Expected: FAIL — cannot find module `../src/core/RingBuffer`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/RingBuffer.ts
export interface WriteSegment {
  start: number;
  length: number;
}

/** FIFO write head over a fixed-capacity buffer. Oldest entries are overwritten when full. */
export class RingBuffer {
  readonly capacity: number;
  private head = 0;
  private _count = 0;

  constructor(capacity: number) {
    if (capacity <= 0) throw new Error('RingBuffer capacity must be > 0');
    this.capacity = capacity;
  }

  get count(): number {
    return this._count;
  }

  get writeHead(): number {
    return this.head;
  }

  /** Reserve slots for `n` new entries. Returns 1–2 contiguous segments (wraps around). */
  reserve(n: number): WriteSegment[] {
    if (n <= 0) return [];
    if (n >= this.capacity) {
      this.head = 0;
      this._count = this.capacity;
      return [{ start: 0, length: this.capacity }];
    }
    const segments: WriteSegment[] = [];
    const first = Math.min(n, this.capacity - this.head);
    segments.push({ start: this.head, length: first });
    if (first < n) {
      segments.push({ start: 0, length: n - first });
    }
    this.head = (this.head + n) % this.capacity;
    this._count = Math.min(this.capacity, this._count + n);
    return segments;
  }

  clear(): void {
    this.head = 0;
    this._count = 0;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/RingBuffer.test.ts`
Expected: PASS — 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/RingBuffer.ts test/RingBuffer.test.ts
git commit -m "feat: RingBuffer FIFO write-head (TDD)"
```

---

## Task 3: Color ramps (PURE gradient / TDD + LUT builder)

**Files:**
- Create: `src/ramps/gradient.ts`, `src/ramps/presets.ts`, `src/ramps/lut.ts`, `src/ramps/index.ts`
- Test: `test/gradient.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/gradient.test.ts
import { describe, it, expect } from 'vitest';
import { sampleGradient, type ColorStop } from '../src/ramps/gradient';

const stops: ColorStop[] = [
  { t: 0.0, color: [0, 0, 0] },
  { t: 0.5, color: [100, 100, 100] },
  { t: 1.0, color: [200, 0, 0] },
];

describe('sampleGradient', () => {
  it('returns the first stop at t=0', () => {
    expect(sampleGradient(stops, 0)).toEqual([0, 0, 0]);
  });

  it('returns the last stop at t=1', () => {
    expect(sampleGradient(stops, 1)).toEqual([200, 0, 0]);
  });

  it('interpolates linearly at a midpoint', () => {
    expect(sampleGradient(stops, 0.25)).toEqual([50, 50, 50]);
  });

  it('clamps t below 0 to the first stop', () => {
    expect(sampleGradient(stops, -1)).toEqual([0, 0, 0]);
  });

  it('clamps t above 1 to the last stop', () => {
    expect(sampleGradient(stops, 2)).toEqual([200, 0, 0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/gradient.test.ts`
Expected: FAIL — cannot find module `../src/ramps/gradient`.

- [ ] **Step 3: Write `src/ramps/gradient.ts`**

```ts
import type { RGB } from '../core/types';

/** A color stop: position `t` in [0,1] and `color` as RGB 0..255. Stops must be sorted ascending by t. */
export interface ColorStop {
  t: number;
  color: RGB;
}

/** Linearly interpolate a sorted stop list at position `t` (clamped to [0,1]). */
export function sampleGradient(stops: ColorStop[], t: number): RGB {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (x >= a.t && x <= b.t) {
      const span = b.t - a.t || 1;
      const k = (x - a.t) / span;
      return [
        a.color[0] + (b.color[0] - a.color[0]) * k,
        a.color[1] + (b.color[1] - a.color[1]) * k,
        a.color[2] + (b.color[2] - a.color[2]) * k,
      ];
    }
  }
  return stops[stops.length - 1].color;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/gradient.test.ts`
Expected: PASS — 5 passed.

- [ ] **Step 5: Write `src/ramps/presets.ts`**

```ts
import type { ColorStop } from './gradient';

/** Scanner Sombre style: warm (near) → cool (far). */
export const rainbowDepthStops: ColorStop[] = [
  { t: 0.0, color: [255, 90, 60] },
  { t: 0.25, color: [255, 210, 60] },
  { t: 0.5, color: [92, 255, 155] },
  { t: 0.75, color: [60, 240, 255] },
  { t: 1.0, color: [123, 92, 255] },
];

/** Thermal: black → red → yellow → white. */
export const thermalStops: ColorStop[] = [
  { t: 0.0, color: [20, 0, 40] },
  { t: 0.4, color: [200, 30, 30] },
  { t: 0.7, color: [255, 180, 40] },
  { t: 1.0, color: [255, 255, 230] },
];

/** Mono neon: dim → bright cyan. */
export const monoNeonStops: ColorStop[] = [
  { t: 0.0, color: [10, 40, 50] },
  { t: 1.0, color: [120, 255, 240] },
];
```

- [ ] **Step 6: Write `src/ramps/lut.ts`** (builds DataTextures — no WebGL context needed to construct)

```ts
import * as THREE from 'three';
import { sampleGradient, type ColorStop } from './gradient';
import type { RGB } from '../core/types';

function makeTexture(data: Uint8Array, width: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Build a 1×width RGBA LUT texture from a gradient stop list. */
export function buildRampTexture(stops: ColorStop[], width = 256): THREE.DataTexture {
  const data = new Uint8Array(width * 4);
  for (let i = 0; i < width; i++) {
    const [r, g, b] = sampleGradient(stops, i / (width - 1));
    data[i * 4 + 0] = Math.round(r);
    data[i * 4 + 1] = Math.round(g);
    data[i * 4 + 2] = Math.round(b);
    data[i * 4 + 3] = 255;
  }
  return makeTexture(data, width);
}

/** Build a 1×width RGBA LUT texture by sampling a user function over [0,1]. */
export function buildRampTextureFromFn(fn: (dist01: number) => RGB, width = 256): THREE.DataTexture {
  const data = new Uint8Array(width * 4);
  for (let i = 0; i < width; i++) {
    const [r, g, b] = fn(i / (width - 1));
    data[i * 4 + 0] = Math.round(r);
    data[i * 4 + 1] = Math.round(g);
    data[i * 4 + 2] = Math.round(b);
    data[i * 4 + 3] = 255;
  }
  return makeTexture(data, width);
}
```

- [ ] **Step 7: Write `src/ramps/index.ts`**

```ts
import { buildRampTexture } from './lut';
import { rainbowDepthStops, thermalStops, monoNeonStops } from './presets';

export const ramps = {
  rainbowDepth: buildRampTexture(rainbowDepthStops),
  thermal: buildRampTexture(thermalStops),
  monoNeon: buildRampTexture(monoNeonStops),
};

export { sampleGradient } from './gradient';
export type { ColorStop } from './gradient';
export { buildRampTexture, buildRampTextureFromFn } from './lut';
```

- [ ] **Step 8: Run the full test suite**

Run: `npm test`
Expected: PASS — smoke + RingBuffer + gradient all green.

- [ ] **Step 9: Commit**

```bash
git add src/ramps test/gradient.test.ts
git commit -m "feat: color ramps (gradient sampler + LUT textures, TDD)"
```

---

## Task 4: Cone helper + cursorCone emitter (PURE / TDD)

**Files:**
- Create: `src/emitters/cone.ts`, `src/emitters/cursorCone.ts`
- Test: `test/cursorCone.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/cursorCone.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { cursorCone } from '../src/emitters/cursorCone';
import type { EmitContext } from '../src/core/types';

// Deterministic seeded RNG (mulberry32).
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ctx(overrides: Partial<EmitContext> = {}): EmitContext {
  return {
    origin: new THREE.Vector3(1, 2, 3),
    forward: new THREE.Vector3(0, 0, 1),
    right: new THREE.Vector3(1, 0, 0),
    up: new THREE.Vector3(0, 1, 0),
    aim: new THREE.Vector2(0, 0),
    time: 0,
    dt: 0.016,
    rng: rng(42),
    ...overrides,
  };
}

describe('cursorCone', () => {
  it('emits the requested number of rays', () => {
    const rays = cursorCone({ raysPerFrame: 50 }).emit(ctx());
    expect(rays.length).toBe(50);
  });

  it('keeps every ray within halfAngle of the aim direction (forward when aim=0)', () => {
    const halfAngle = 0.1;
    const rays = cursorCone({ raysPerFrame: 200, halfAngle }).emit(ctx());
    const fwd = new THREE.Vector3(0, 0, 1);
    for (const r of rays) {
      const angle = Math.acos(THREE.MathUtils.clamp(r.direction.dot(fwd), -1, 1));
      expect(angle).toBeLessThanOrEqual(halfAngle + 1e-6);
    }
  });

  it('produces normalized directions and copies the origin', () => {
    const rays = cursorCone({ raysPerFrame: 20 }).emit(ctx());
    for (const r of rays) {
      expect(r.direction.length()).toBeCloseTo(1, 5);
      expect(r.origin.equals(new THREE.Vector3(1, 2, 3))).toBe(true);
    }
  });

  it('shifts the aim when the cursor offset is non-zero', () => {
    const rays = cursorCone({ raysPerFrame: 100, halfAngle: 0.05, aimSpread: 0.6 })
      .emit(ctx({ aim: new THREE.Vector2(1, 0) }));
    const mean = new THREE.Vector3();
    for (const r of rays) mean.add(r.direction);
    mean.divideScalar(rays.length).normalize();
    // aim.x = 1 pushes the cone toward +right, so mean.x should be clearly positive
    expect(mean.x).toBeGreaterThan(0.3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cursorCone.test.ts`
Expected: FAIL — cannot find module `../src/emitters/cursorCone`.

- [ ] **Step 3: Write `src/emitters/cone.ts`**

```ts
import * as THREE from 'three';
import type { Ray } from '../core/types';

/**
 * Sample `n` rays inside a cone of half-angle `halfAngle` around `aimDir`.
 * Offsets are distributed uniformly over the cone's base disk.
 */
export function coneRays(
  origin: THREE.Vector3,
  aimDir: THREE.Vector3,
  refUp: THREE.Vector3,
  halfAngle: number,
  n: number,
  rng: () => number,
): Ray[] {
  const axis = aimDir.clone().normalize();
  const tangent = new THREE.Vector3().crossVectors(axis, refUp);
  if (tangent.lengthSq() < 1e-6) tangent.crossVectors(axis, new THREE.Vector3(1, 0, 0));
  tangent.normalize();
  const bitangent = new THREE.Vector3().crossVectors(axis, tangent).normalize();

  const rays: Ray[] = [];
  for (let i = 0; i < n; i++) {
    const az = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * halfAngle;
    const direction = axis
      .clone()
      .addScaledVector(tangent, Math.cos(az) * r)
      .addScaledVector(bitangent, Math.sin(az) * r)
      .normalize();
    rays.push({ origin: origin.clone(), direction });
  }
  return rays;
}
```

> Note: with a base offset of length `r ≤ halfAngle` added to a unit axis, the resulting angle is `atan(r) ≤ r ≤ halfAngle`, so the "within halfAngle" test holds.

- [ ] **Step 4: Write `src/emitters/cursorCone.ts`**

```ts
import * as THREE from 'three';
import type { Emitter, EmitContext, Ray } from '../core/types';
import { coneRays } from './cone';

export interface CursorConeOptions {
  halfAngle?: number;   // cone half-angle in radians
  raysPerFrame?: number;
  aimSpread?: number;   // how strongly the cursor offset rotates the aim
}

/** A cone of rays aimed where the cursor points (via ctx.aim). */
export function cursorCone(opts: CursorConeOptions = {}): Emitter {
  const halfAngle = opts.halfAngle ?? 0.1;
  const raysPerFrame = opts.raysPerFrame ?? 400;
  const aimSpread = opts.aimSpread ?? 0.6;

  return {
    emit(ctx: EmitContext): Ray[] {
      const aimDir = ctx.forward
        .clone()
        .addScaledVector(ctx.right, ctx.aim.x * aimSpread)
        .addScaledVector(ctx.up, ctx.aim.y * aimSpread)
        .normalize();
      return coneRays(ctx.origin, aimDir, ctx.up, halfAngle, raysPerFrame, ctx.rng);
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/cursorCone.test.ts`
Expected: PASS — 4 passed.

- [ ] **Step 6: Commit**

```bash
git add src/emitters/cone.ts src/emitters/cursorCone.ts test/cursorCone.test.ts
git commit -m "feat: cursorCone emitter + cone sampling helper (TDD)"
```

---

## Task 5: pulseRing + autoSweep emitters

**Files:**
- Create: `src/emitters/pulseRing.ts`, `src/emitters/autoSweep.ts`, `src/emitters/index.ts`
- Test: `test/pulseRing.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/pulseRing.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { pulseRing } from '../src/emitters/pulseRing';
import type { EmitContext } from '../src/core/types';

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ctx(time: number): EmitContext {
  return {
    origin: new THREE.Vector3(),
    forward: new THREE.Vector3(0, 0, 1),
    right: new THREE.Vector3(1, 0, 0),
    up: new THREE.Vector3(0, 1, 0),
    aim: new THREE.Vector2(0, 0),
    time,
    dt: 0.016,
    rng: rng(7),
  };
}

describe('pulseRing', () => {
  it('emits rays on a ring whose angle from forward matches the expanding radius', () => {
    const speed = 1.5;
    const maxAngle = 0.6;
    const thickness = 0.02;
    const time = 0.2;
    const expected = (time * speed) % maxAngle; // 0.3
    const rays = pulseRing({ speed, maxAngle, thickness, raysPerFrame: 300 }).emit(ctx(time));
    const fwd = new THREE.Vector3(0, 0, 1);
    for (const r of rays) {
      const angle = Math.acos(THREE.MathUtils.clamp(r.direction.dot(fwd), -1, 1));
      expect(Math.abs(angle - expected)).toBeLessThanOrEqual(thickness + 1e-6);
    }
  });

  it('spreads rays around the full azimuth (covers all four quadrants in x/y)', () => {
    const rays = pulseRing({ raysPerFrame: 400 }).emit(ctx(0.3));
    const quad = { px: false, nx: false, py: false, ny: false };
    for (const r of rays) {
      if (r.direction.x > 0.01) quad.px = true;
      if (r.direction.x < -0.01) quad.nx = true;
      if (r.direction.y > 0.01) quad.py = true;
      if (r.direction.y < -0.01) quad.ny = true;
    }
    expect(quad).toEqual({ px: true, nx: true, py: true, ny: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/pulseRing.test.ts`
Expected: FAIL — cannot find module `../src/emitters/pulseRing`.

- [ ] **Step 3: Write `src/emitters/pulseRing.ts`**

```ts
import * as THREE from 'three';
import type { Emitter, EmitContext, Ray } from '../core/types';

export interface PulseRingOptions {
  speed?: number;        // radians/sec the ring angle expands
  maxAngle?: number;     // ring resets to 0 after reaching this angle
  thickness?: number;    // angular thickness of the ring
  raysPerFrame?: number;
}

/** An expanding ring of rays sweeping outward from the forward axis (sonar-like). */
export function pulseRing(opts: PulseRingOptions = {}): Emitter {
  const speed = opts.speed ?? 1.5;
  const maxAngle = opts.maxAngle ?? 0.6;
  const thickness = opts.thickness ?? 0.02;
  const raysPerFrame = opts.raysPerFrame ?? 400;

  return {
    emit(ctx: EmitContext): Ray[] {
      const ringAngle = (ctx.time * speed) % maxAngle;
      const fwd = ctx.forward.clone().normalize();
      const tangent = new THREE.Vector3().crossVectors(fwd, ctx.up);
      if (tangent.lengthSq() < 1e-6) tangent.crossVectors(fwd, ctx.right);
      tangent.normalize();
      const bitangent = new THREE.Vector3().crossVectors(fwd, tangent).normalize();

      const rays: Ray[] = [];
      for (let i = 0; i < raysPerFrame; i++) {
        const az = ctx.rng() * Math.PI * 2;
        const ang = ringAngle + (ctx.rng() * 2 - 1) * thickness;
        const direction = fwd
          .clone()
          .multiplyScalar(Math.cos(ang))
          .addScaledVector(tangent, Math.sin(ang) * Math.cos(az))
          .addScaledVector(bitangent, Math.sin(ang) * Math.sin(az))
          .normalize();
        rays.push({ origin: ctx.origin.clone(), direction });
      }
      return rays;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/pulseRing.test.ts`
Expected: PASS — 2 passed.

- [ ] **Step 5: Write `src/emitters/autoSweep.ts`**

```ts
import type { Emitter, EmitContext, Ray } from '../core/types';
import { coneRays } from './cone';

export interface AutoSweepOptions {
  halfAngle?: number;
  raysPerFrame?: number;
  speedX?: number;  // Lissajous frequency for horizontal sweep
  speedY?: number;  // Lissajous frequency for vertical sweep
  spread?: number;  // how far the aim swings off forward
}

/** Hands-free cone whose aim follows a Lissajous path over time (for demos/idle). */
export function autoSweep(opts: AutoSweepOptions = {}): Emitter {
  const halfAngle = opts.halfAngle ?? 0.1;
  const raysPerFrame = opts.raysPerFrame ?? 400;
  const speedX = opts.speedX ?? 0.7;
  const speedY = opts.speedY ?? 0.43;
  const spread = opts.spread ?? 0.5;

  return {
    emit(ctx: EmitContext): Ray[] {
      const sx = Math.sin(ctx.time * speedX) * spread;
      const sy = Math.sin(ctx.time * speedY) * spread;
      const aimDir = ctx.forward
        .clone()
        .addScaledVector(ctx.right, sx)
        .addScaledVector(ctx.up, sy)
        .normalize();
      return coneRays(ctx.origin, aimDir, ctx.up, halfAngle, raysPerFrame, ctx.rng);
    },
  };
}
```

- [ ] **Step 6: Write `src/emitters/index.ts`**

```ts
export { cursorCone, type CursorConeOptions } from './cursorCone';
export { autoSweep, type AutoSweepOptions } from './autoSweep';
export { pulseRing, type PulseRingOptions } from './pulseRing';
export { coneRays } from './cone';

import { cursorCone } from './cursorCone';
import { autoSweep } from './autoSweep';
import { pulseRing } from './pulseRing';

export const emitters = { cursorCone, autoSweep, pulseRing };
```

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: PASS — all suites green.

- [ ] **Step 8: Commit**

```bash
git add src/emitters/pulseRing.ts src/emitters/autoSweep.ts src/emitters/index.ts test/pulseRing.test.ts
git commit -m "feat: pulseRing + autoSweep emitters and emitters index (TDD)"
```

---

## Task 6: RaycastSampler (TDD, headless)

**Files:**
- Create: `src/core/RaycastSampler.ts`
- Test: `test/RaycastSampler.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/RaycastSampler.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { RaycastSampler } from '../src/core/RaycastSampler';

function unitPlaneAtZ(z: number): THREE.Mesh {
  // 10x10 plane facing -Z, centered at (0,0,z)
  const geo = new THREE.PlaneGeometry(10, 10);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  mesh.position.set(0, 0, z);
  mesh.updateMatrixWorld(true);
  return mesh;
}

describe('RaycastSampler', () => {
  it('returns a hit with correct distance for a ray that strikes geometry', () => {
    const sampler = new RaycastSampler([unitPlaneAtZ(5)]);
    const hits = sampler.sample([
      { origin: new THREE.Vector3(0, 0, 0), direction: new THREE.Vector3(0, 0, 1) },
    ]);
    expect(hits.length).toBe(1);
    expect(hits[0].distance).toBeCloseTo(5, 4);
    expect(hits[0].point.z).toBeCloseTo(5, 4);
  });

  it('returns no hit for a ray that misses', () => {
    const sampler = new RaycastSampler([unitPlaneAtZ(5)]);
    const hits = sampler.sample([
      { origin: new THREE.Vector3(0, 0, 0), direction: new THREE.Vector3(0, 1, 0) },
    ]);
    expect(hits.length).toBe(0);
  });

  it('returns the nearest hit when rays could strike multiple surfaces', () => {
    const sampler = new RaycastSampler([unitPlaneAtZ(5), unitPlaneAtZ(8)]);
    const hits = sampler.sample([
      { origin: new THREE.Vector3(0, 0, 0), direction: new THREE.Vector3(0, 0, 1) },
    ]);
    expect(hits.length).toBe(1);
    expect(hits[0].distance).toBeCloseTo(5, 4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/RaycastSampler.test.ts`
Expected: FAIL — cannot find module `../src/core/RaycastSampler`.

- [ ] **Step 3: Write `src/core/RaycastSampler.ts`**

```ts
import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import type { Ray, Hit } from './types';

// Patch Three.js to use BVH-accelerated raycasting.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

/** Casts rays against a set of meshes using three-mesh-bvh and returns nearest hits. */
export class RaycastSampler {
  private raycaster = new THREE.Raycaster();
  private objects: THREE.Object3D[];

  constructor(objects: THREE.Object3D[]) {
    this.objects = objects;
    // three-mesh-bvh: only return the closest hit per mesh.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.raycaster as any).firstHitOnly = true;
    for (const obj of objects) {
      obj.updateMatrixWorld(true);
      obj.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (mesh.geometry as any).computeBoundsTree();
        }
      });
    }
  }

  /** Cast every ray; return one nearest Hit per ray that strikes geometry. */
  sample(rays: Ray[]): Hit[] {
    const hits: Hit[] = [];
    for (const ray of rays) {
      this.raycaster.set(ray.origin, ray.direction);
      const intersections = this.raycaster.intersectObjects(this.objects, true);
      if (intersections.length > 0) {
        const nearest = intersections[0];
        hits.push({ point: nearest.point.clone(), distance: nearest.distance });
      }
    }
    return hits;
  }

  dispose(): void {
    for (const obj of this.objects) {
      obj.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (mesh.geometry as any).disposeBoundsTree?.();
        }
      });
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/RaycastSampler.test.ts`
Expected: PASS — 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/RaycastSampler.ts test/RaycastSampler.test.ts
git commit -m "feat: RaycastSampler with three-mesh-bvh (TDD, headless)"
```

---

## Task 7: Shaders + PointCloud (addHits TDD)

**Files:**
- Create: `src/shaders/points.vert.glsl`, `src/shaders/points.frag.glsl`, `src/core/PointCloud.ts`
- Test: `test/PointCloud.test.ts`

- [ ] **Step 1: Write `src/shaders/points.vert.glsl`**

```glsl
attribute float aDistance;
attribute float aBirth;

uniform float uTime;
uniform float uMaxDistance;
uniform float uPointSize;

varying float vDist01;
varying float vAge;

void main() {
  vDist01 = clamp(aDistance / uMaxDistance, 0.0, 1.0);
  vAge = uTime - aBirth;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uPointSize * (300.0 / max(-mvPosition.z, 0.001));
  gl_Position = projectionMatrix * mvPosition;
}
```

- [ ] **Step 2: Write `src/shaders/points.frag.glsl`**

```glsl
uniform sampler2D uRamp;
uniform float uFade;          // 0 = accumulate, 1 = fade
uniform float uFadeDuration;  // seconds

varying float vDist01;
varying float vAge;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  float soft = smoothstep(0.5, 0.1, d);

  vec3 col = texture2D(uRamp, vec2(vDist01, 0.5)).rgb;
  float alpha = soft;
  if (uFade > 0.5) {
    alpha *= clamp(1.0 - vAge / uFadeDuration, 0.0, 1.0);
  }
  gl_FragColor = vec4(col, alpha);
}
```

- [ ] **Step 3: Write the failing test** (addHits buffer logic — no WebGL needed)

```ts
// test/PointCloud.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PointCloud } from '../src/core/PointCloud';

function hit(x: number, y: number, z: number, distance: number) {
  return { point: new THREE.Vector3(x, y, z), distance };
}

const ramp = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);

describe('PointCloud.addHits', () => {
  it('writes hit positions, distances and birth time into the buffers', () => {
    const pc = new PointCloud({ capacity: 4, ramp, persistence: 'accumulate' });
    pc.addHits([hit(1, 2, 3, 0.5), hit(4, 5, 6, 1.5)], 10);
    expect(pc.count).toBe(2);
    const pos = pc.positionArray;
    expect([pos[0], pos[1], pos[2]]).toEqual([1, 2, 3]);
    expect([pos[3], pos[4], pos[5]]).toEqual([4, 5, 6]);
    expect(pc.distanceArray[0]).toBeCloseTo(0.5);
    expect(pc.birthArray[1]).toBeCloseTo(10);
  });

  it('wraps around and overwrites oldest slots when over capacity', () => {
    const pc = new PointCloud({ capacity: 4, ramp, persistence: 'accumulate' });
    pc.addHits([hit(0, 0, 0, 1), hit(0, 0, 0, 1), hit(0, 0, 0, 1)], 1); // slots 0,1,2 ; head=3
    pc.addHits([hit(7, 7, 7, 9), hit(8, 8, 8, 9), hit(9, 9, 9, 9)], 2); // slots 3,0,1 ; head=2
    expect(pc.count).toBe(4);
    const pos = pc.positionArray;
    expect([pos[9], pos[10], pos[11]]).toEqual([7, 7, 7]); // slot 3
    expect([pos[0], pos[1], pos[2]]).toEqual([8, 8, 8]);   // slot 0 (overwritten)
    expect([pos[3], pos[4], pos[5]]).toEqual([9, 9, 9]);   // slot 1 (overwritten)
  });

  it('clear resets the count', () => {
    const pc = new PointCloud({ capacity: 4, ramp, persistence: 'accumulate' });
    pc.addHits([hit(1, 1, 1, 1)], 1);
    pc.clear();
    expect(pc.count).toBe(0);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run test/PointCloud.test.ts`
Expected: FAIL — cannot find module `../src/core/PointCloud`.

- [ ] **Step 5: Write `src/core/PointCloud.ts`**

```ts
import * as THREE from 'three';
import { RingBuffer } from './RingBuffer';
import type { Hit, Persistence } from './types';
import vertexShader from '../shaders/points.vert.glsl?raw';
import fragmentShader from '../shaders/points.frag.glsl?raw';

export interface PointCloudOptions {
  capacity: number;
  ramp: THREE.Texture;
  persistence: Persistence;
  maxDistance?: number;
  pointSize?: number;
  fadeDuration?: number;
}

/** GPU point store: a single THREE.Points backed by a FIFO ring buffer of preallocated attributes. */
export class PointCloud {
  readonly points: THREE.Points;
  readonly positionArray: Float32Array;
  readonly distanceArray: Float32Array;
  readonly birthArray: Float32Array;

  private ring: RingBuffer;
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;
  private posAttr: THREE.BufferAttribute;
  private distAttr: THREE.BufferAttribute;
  private birthAttr: THREE.BufferAttribute;

  constructor(opts: PointCloudOptions) {
    this.ring = new RingBuffer(opts.capacity);
    this.positionArray = new Float32Array(opts.capacity * 3);
    this.distanceArray = new Float32Array(opts.capacity);
    this.birthArray = new Float32Array(opts.capacity);

    this.geometry = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positionArray, 3);
    this.distAttr = new THREE.BufferAttribute(this.distanceArray, 1);
    this.birthAttr = new THREE.BufferAttribute(this.birthArray, 1);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.distAttr.setUsage(THREE.DynamicDrawUsage);
    this.birthAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('aDistance', this.distAttr);
    this.geometry.setAttribute('aBirth', this.birthAttr);
    this.geometry.setDrawRange(0, 0);
    // Large bounding sphere so points are never frustum-culled away.
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uRamp: { value: opts.ramp },
        uTime: { value: 0 },
        uMaxDistance: { value: opts.maxDistance ?? 30 },
        uPointSize: { value: opts.pointSize ?? 2 },
        uFade: { value: opts.persistence === 'fade' ? 1 : 0 },
        uFadeDuration: { value: opts.fadeDuration ?? 6 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  get count(): number {
    return this.ring.count;
  }

  /** Append hits, advancing the FIFO ring and flagging the touched buffer ranges for upload. */
  addHits(hits: Hit[], time: number): void {
    if (hits.length === 0) return;
    const segments = this.ring.reserve(hits.length);
    let hi = 0;
    this.posAttr.clearUpdateRanges();
    this.distAttr.clearUpdateRanges();
    this.birthAttr.clearUpdateRanges();
    for (const seg of segments) {
      for (let i = 0; i < seg.length; i++) {
        const slot = seg.start + i;
        const h = hits[hi++];
        this.positionArray[slot * 3 + 0] = h.point.x;
        this.positionArray[slot * 3 + 1] = h.point.y;
        this.positionArray[slot * 3 + 2] = h.point.z;
        this.distanceArray[slot] = h.distance;
        this.birthArray[slot] = time;
      }
      this.posAttr.addUpdateRange(seg.start * 3, seg.length * 3);
      this.distAttr.addUpdateRange(seg.start, seg.length);
      this.birthAttr.addUpdateRange(seg.start, seg.length);
    }
    this.posAttr.needsUpdate = true;
    this.distAttr.needsUpdate = true;
    this.birthAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, this.ring.count);
  }

  /** Advance the time uniform (drives fade mode). */
  update(time: number): void {
    this.material.uniforms.uTime.value = time;
  }

  setRamp(texture: THREE.Texture): void {
    this.material.uniforms.uRamp.value = texture;
  }

  setPersistence(persistence: Persistence): void {
    this.material.uniforms.uFade.value = persistence === 'fade' ? 1 : 0;
  }

  clear(): void {
    this.ring.clear();
    this.geometry.setDrawRange(0, 0);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run test/PointCloud.test.ts`
Expected: PASS — 3 passed.

> If `clearUpdateRanges`/`addUpdateRange` are unavailable in the installed three version, replace the three `add/clearUpdateRange` lines with a single `attr.needsUpdate = true` per attribute (full re-upload). The tests do not depend on update ranges.

- [ ] **Step 7: Commit**

```bash
git add src/shaders src/core/PointCloud.ts test/PointCloud.test.ts
git commit -m "feat: PointCloud GPU ring buffer + point shaders (addHits TDD)"
```

---

## Task 8: Scannables (procedural cave + glTF loader)

**Files:**
- Create: `src/scannables/procedural.ts`, `src/scannables/gltf.ts`, `src/scannables/index.ts`

> Scannable meshes are used **only for raycasting** — they are never added to the rendered scene (the scene is black; only points are drawn). Material choice is irrelevant.

- [ ] **Step 1: Write `src/scannables/procedural.ts`**

```ts
import * as THREE from 'three';
import type { Scannable } from '../core/types';

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial());
  mesh.position.set(x, y, z);
  return mesh;
}

/** A procedural corridor (floor/ceiling/walls/back) with a few crates, built from real meshes. */
export function proceduralCave(): Scannable {
  const group = new THREE.Group();
  const len = 26;
  const halfW = 2.6;
  const halfH = 1.6;
  const midZ = len / 2;

  group.add(box(halfW * 2, 0.2, len, 0, -halfH, midZ)); // floor
  group.add(box(halfW * 2, 0.2, len, 0, halfH, midZ));  // ceiling
  group.add(box(0.2, halfH * 2, len, -halfW, 0, midZ)); // left wall
  group.add(box(0.2, halfH * 2, len, halfW, 0, midZ));  // right wall
  group.add(box(halfW * 2, halfH * 2, 0.2, 0, 0, len)); // back wall

  group.add(box(2.0, 1.4, 1.2, 0, -0.9, 6.6));   // crate
  group.add(box(1.2, 2.2, 1.0, -2.0, -0.5, 11.5)); // pillar
  group.add(box(1.3, 2.6, 1.2, 2.0, -0.3, 15.6));  // pillar
  group.add(box(1.6, 2.5, 1.0, 0, -0.35, 20.5));   // block

  group.updateMatrixWorld(true);
  return { objects: [group] };
}
```

- [ ] **Step 2: Write `src/scannables/gltf.ts`**

```ts
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Scannable } from '../core/types';

/** Load a glTF/glb file and expose its meshes as a Scannable. */
export async function loadGLTF(url: string): Promise<Scannable> {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  return { objects: [gltf.scene] };
}
```

- [ ] **Step 3: Write `src/scannables/index.ts`**

```ts
export { proceduralCave } from './procedural';
export { loadGLTF } from './gltf';

import { proceduralCave } from './procedural';
import { loadGLTF } from './gltf';

export const scannables = { proceduralCave, loadGLTF };
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/scannables
git commit -m "feat: scannables (procedural cave + glTF loader)"
```

---

## Task 9: LidarEngine orchestrator + public exports + smoke test

**Files:**
- Create: `src/core/LidarEngine.ts`, `src/index.ts`
- Test: `test/exports.test.ts`

- [ ] **Step 1: Write `src/core/LidarEngine.ts`**

```ts
import * as THREE from 'three';
import { RaycastSampler } from './RaycastSampler';
import { PointCloud } from './PointCloud';
import { buildRampTextureFromFn } from '../ramps/lut';
import type { Emitter, Scannable, ColorRamp, Persistence, EmitContext } from './types';

export interface LidarEngineOptions {
  canvas: HTMLCanvasElement;
  scannable: Scannable;
  emitter: Emitter;
  ramp?: ColorRamp;
  pointBudget?: number;
  persistence?: Persistence;
  maxDistance?: number;
  pointSize?: number;
  fadeDuration?: number;
}

function resolveRamp(ramp: ColorRamp | undefined): THREE.Texture {
  if (!ramp) {
    return buildRampTextureFromFn((t) => [255 * (1 - t) + 60 * t, 120 + 100 * t, 255 * t + 80]);
  }
  return typeof ramp === 'function' ? buildRampTextureFromFn(ramp) : ramp;
}

/** Orchestrates the scan loop: emitter → raycast → point cloud → render. */
export class LidarEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private sampler: RaycastSampler;
  private pointCloud: PointCloud;
  private emitter: Emitter;

  private aim = new THREE.Vector2(0, 0);
  private yaw = 0;
  private pitch = 0;
  private clock = new THREE.Clock();
  private time = 0;
  private running = false;
  private rafId = 0;

  // reused scratch vectors (avoid per-frame allocation)
  private fwd = new THREE.Vector3();
  private right = new THREE.Vector3();
  private upVec = new THREE.Vector3();

  constructor(opts: LidarEngineOptions) {
    this.renderer = new THREE.WebGLRenderer({ canvas: opts.canvas, antialias: true });
    this.renderer.setClearColor(0x05060a, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.resize();

    this.camera = new THREE.PerspectiveCamera(70, this.aspect(), 0.05, 500);
    this.camera.position.set(0, 0, 0);

    this.sampler = new RaycastSampler(opts.scannable.objects);
    this.pointCloud = new PointCloud({
      capacity: opts.pointBudget ?? 500_000,
      ramp: resolveRamp(opts.ramp),
      persistence: opts.persistence ?? 'accumulate',
      maxDistance: opts.maxDistance,
      pointSize: opts.pointSize,
      fadeDuration: opts.fadeDuration,
    });
    this.scene.add(this.pointCloud.points);
    this.emitter = opts.emitter;
    this.applyCameraRotation();
  }

  private aspect(): number {
    return this.renderer.domElement.clientWidth / Math.max(1, this.renderer.domElement.clientHeight);
  }

  resize(): void {
    const c = this.renderer.domElement;
    this.renderer.setSize(c.clientWidth, c.clientHeight, false);
    if (this.camera) {
      this.camera.aspect = this.aspect();
      this.camera.updateProjectionMatrix();
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.loop();
  }

  private loop = (): void => {
    if (!this.running) return;
    const dt = this.clock.getDelta();
    this.time += dt;

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
    this.pointCloud.update(this.time);

    this.renderer.render(this.scene, this.camera);
    this.rafId = requestAnimationFrame(this.loop);
  };

  /** Set the cursor aim from canvas-relative client coordinates. */
  aimAt(clientX: number, clientY: number): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.aim.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
  }

  /** Set the aim directly in normalized [-1,1] coordinates (used by demo auto-sweep). */
  setAim(x: number, y: number): void {
    this.aim.set(x, y);
  }

  /** Orbit the view by pixel deltas (drag). */
  look(dx: number, dy: number): void {
    this.yaw -= dx * 0.004;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.004, -1.2, 1.2);
    this.applyCameraRotation();
  }

  private applyCameraRotation(): void {
    const euler = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);
  }

  clear(): void {
    this.pointCloud.clear();
  }

  setRamp(ramp: ColorRamp): void {
    this.pointCloud.setRamp(resolveRamp(ramp));
  }

  setEmitter(emitter: Emitter): void {
    this.emitter = emitter;
  }

  setPersistence(persistence: Persistence): void {
    this.pointCloud.setPersistence(persistence);
  }

  pause(): void {
    this.running = false;
  }

  resume(): void {
    if (!this.running) this.start();
  }

  get pointCount(): number {
    return this.pointCloud.count;
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.sampler.dispose();
    this.pointCloud.dispose();
    this.renderer.dispose();
  }
}
```

- [ ] **Step 2: Write `src/index.ts`**

```ts
export { LidarEngine } from './core/LidarEngine';
export type { LidarEngineOptions } from './core/LidarEngine';
export { emitters } from './emitters';
export { ramps } from './ramps';
export { scannables } from './scannables';
export type {
  RGB,
  Ray,
  Hit,
  EmitContext,
  Emitter,
  Scannable,
  ColorRamp,
  Persistence,
} from './core/types';
```

- [ ] **Step 3: Write `test/exports.test.ts`** (smoke: public API is wired without touching WebGL)

```ts
import { describe, it, expect } from 'vitest';
import { emitters, ramps, scannables } from '../src/index';

describe('public API', () => {
  it('exposes the three emitter factories', () => {
    expect(typeof emitters.cursorCone).toBe('function');
    expect(typeof emitters.autoSweep).toBe('function');
    expect(typeof emitters.pulseRing).toBe('function');
  });

  it('exposes the three ramp textures', () => {
    expect(ramps.rainbowDepth).toBeDefined();
    expect(ramps.thermal).toBeDefined();
    expect(ramps.monoNeon).toBeDefined();
  });

  it('builds a procedural scannable with objects', () => {
    const s = scannables.proceduralCave();
    expect(s.objects.length).toBeGreaterThan(0);
  });
});
```

> Note: `test/exports.test.ts` imports `src/index.ts`, which imports `LidarEngine` (which imports three). That's fine in Node — the WebGLRenderer is only constructed when `new LidarEngine(...)` is called, which this test does not do.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS — all suites green (smoke, RingBuffer, gradient, cursorCone, pulseRing, RaycastSampler, PointCloud, exports).

- [ ] **Step 5: Commit**

```bash
git add src/core/LidarEngine.ts src/index.ts test/exports.test.ts
git commit -m "feat: LidarEngine orchestrator + public exports (+ smoke test)"
```

---

## Task 10: Example demo

**Files:**
- Create: `examples/basic/index.html`, `examples/basic/main.ts`

- [ ] **Step 1: Write `examples/basic/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>LiDAR Engine — Basic Example</title>
    <style>
      html, body { margin: 0; height: 100%; background: #05060a; overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; cursor: crosshair; }
      #view { display: block; width: 100vw; height: 100vh; }
      .hud { position: fixed; top: 0; left: 0; right: 0; padding: 12px 16px; pointer-events: none;
        color: #9ff0dd; text-shadow: 0 0 8px rgba(0,0,0,.9); }
      .hud h1 { margin: 0; font-size: 13px; }
      .hud p { margin: 4px 0 0; font-size: 11px; color: #5a7a78; }
      .panel { position: fixed; bottom: 14px; left: 16px; display: flex; gap: 8px; flex-wrap: wrap; }
      .panel button { pointer-events: auto; background: #0e1622; color: #9ff0dd;
        border: 1px solid #223247; border-radius: 8px; padding: 6px 10px; font-size: 12px; cursor: pointer; }
      .panel button:hover { border-color: #2f7d6b; }
      .stats { position: fixed; bottom: 14px; right: 16px; color: #6b8a88; font-size: 11px; text-align: right; }
    </style>
  </head>
  <body>
    <canvas id="view"></canvas>
    <div class="hud">
      <h1>LiDAR Engine — basic example</h1>
      <p>Move mouse = scan · Drag = look around · Space = clear</p>
    </div>
    <div class="panel">
      <button data-ramp="rainbowDepth">Rainbow</button>
      <button data-ramp="thermal">Thermal</button>
      <button data-ramp="monoNeon">Neon</button>
      <button data-emitter="cursorCone">Cone</button>
      <button data-emitter="pulseRing">Pulse</button>
      <button data-persistence="accumulate">Accumulate</button>
      <button data-persistence="fade">Fade</button>
      <button data-action="clear">Clear</button>
    </div>
    <div class="stats" id="stats">0 points</div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Write `examples/basic/main.ts`**

```ts
import { LidarEngine, emitters, ramps, scannables } from '../../src/index';

const canvas = document.getElementById('view') as HTMLCanvasElement;
// Size the canvas to the window (clientWidth/Height drive the renderer).
function fit() {
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
}
fit();

const engine = new LidarEngine({
  canvas,
  scannable: scannables.proceduralCave(),
  emitter: emitters.cursorCone({ halfAngle: 0.1, raysPerFrame: 400 }),
  ramp: ramps.rainbowDepth,
  pointBudget: 500_000,
  persistence: 'accumulate',
});
engine.start();

// Auto-sweep with a Lissajous aim until the user moves the mouse.
let userActive = false;
const startTime = performance.now();
function autoAim() {
  if (userActive) return;
  const t = (performance.now() - startTime) / 1000;
  engine.setAim(Math.sin(t * 0.7) * 0.6, Math.sin(t * 0.43) * 0.25);
  requestAnimationFrame(autoAim);
}
autoAim();

// Pointer: aim on move, drag to look.
let dragging = false;
let lastX = 0;
let lastY = 0;
canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
});
window.addEventListener('pointerup', () => { dragging = false; });
window.addEventListener('pointermove', (e) => {
  userActive = true;
  if (dragging) {
    engine.look(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX;
    lastY = e.clientY;
  } else {
    engine.aimAt(e.clientX, e.clientY);
  }
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') engine.clear();
});

window.addEventListener('resize', () => { fit(); engine.resize(); });

// HUD wiring.
document.querySelectorAll<HTMLButtonElement>('.panel button').forEach((btn) => {
  btn.addEventListener('click', () => {
    const r = btn.dataset.ramp as keyof typeof ramps | undefined;
    const em = btn.dataset.emitter;
    const p = btn.dataset.persistence as 'accumulate' | 'fade' | undefined;
    if (r) engine.setRamp(ramps[r]);
    if (em === 'cursorCone') engine.setEmitter(emitters.cursorCone({ halfAngle: 0.1, raysPerFrame: 400 }));
    if (em === 'pulseRing') engine.setEmitter(emitters.pulseRing({ raysPerFrame: 500 }));
    if (p) engine.setPersistence(p);
    if (btn.dataset.action === 'clear') engine.clear();
  });
});

// Stats readout.
const stats = document.getElementById('stats')!;
setInterval(() => {
  stats.textContent = `${engine.pointCount.toLocaleString()} points`;
}, 250);
```

- [ ] **Step 3: Run the dev server and verify visually**

Run: `npm run dev`
Then open the printed URL and navigate to `/examples/basic/index.html`.
Expected:
- A black screen that auto-sweeps, revealing a corridor + crates as a colored point cloud.
- Moving the mouse aims the scan; points accumulate.
- Dragging looks around; Space clears.
- The Rainbow/Thermal/Neon buttons recolor the existing cloud instantly (no rescan).
- Cone/Pulse switch the scan pattern; Accumulate/Fade toggle persistence; the point counter rises.

- [ ] **Step 4: Commit**

```bash
git add examples/basic/index.html examples/basic/main.ts
git commit -m "feat: basic interactive example demo with live slot switching"
```

---

## Task 11: README + final verification

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

````markdown
# lidar-engine

A reusable LiDAR-style point-cloud scanning engine for the web (Scanner Sombre style), built on Three.js + three-mesh-bvh.

## Install

```bash
npm install
```

## Develop the example

```bash
npm run dev
# open the printed URL, then go to /examples/basic/index.html
```

## Test

```bash
npm test
```

## Usage

```ts
import { LidarEngine, emitters, ramps, scannables } from 'lidar-engine';

const engine = new LidarEngine({
  canvas: document.querySelector('#view'),
  scannable: scannables.proceduralCave(), // swappable slot
  emitter: emitters.cursorCone({ halfAngle: 0.1, raysPerFrame: 400 }), // swappable slot
  ramp: ramps.rainbowDepth, // swappable slot
  pointBudget: 500_000,
  persistence: 'accumulate', // or 'fade'
});
engine.start();

engine.aimAt(clientX, clientY); // aim from cursor
engine.look(dx, dy);            // drag to look
engine.setRamp(ramps.thermal);  // live recolor
engine.setEmitter(emitters.pulseRing({ speed: 8 }));
engine.clear();
```

## Architecture

Fixed core pipeline — **Emitter → RaycastSampler → PointCloud → Renderer** — with three swappable
slots: **Scannable** (what is scanned), **Emitter** (how rays are cast), **ColorRamp** (distance→color).
Swap a slot to retarget the engine; the core is written once.

See `docs/superpowers/specs/2026-06-13-lidar-scan-engine-design.md`.
````

- [ ] **Step 2: Run the full test suite and type-check**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass; no type errors.

- [ ] **Step 3: Verify the production build**

Run: `npm run build`
Expected: `dist/lidar-engine.js` is produced with no errors (three/three-mesh-bvh externalized).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add README with usage and architecture"
```

---

## Self-Review (completed during plan authoring)

**1. Spec coverage**
- Three.js / TS / three-mesh-bvh / shader+LUT / accumulate+fade → Tasks 0, 6, 7, 9 ✓
- Core pipeline (Emitter→Raycaster→PointStore→Renderer) → Tasks 4–7, 9 ✓
- Swappable slots (Scannable / Emitter / ColorRamp) → Tasks 3, 4, 5, 8; live swap in 9–10 ✓
- Public API (aimAt/look/clear/setRamp/setEmitter/pointCount/dispose) → Task 9 ✓
- Per-frame data flow + GPU ring buffer + partial upload → Tasks 2, 7 ✓
- Example demo (procedural cave, cursor cone, auto-sweep, HUD live switching) → Task 10 ✓
- Testing strategy (RingBuffer, emitters, ramps, RaycastSampler, PointCloud unit; boot smoke; visual) → Tasks 2–7, 9, 10 ✓
- Performance budget (raysPerFrame≈400, 500k budget, single draw call, partial upload, scratch vectors) → Tasks 7, 9 ✓
- Error handling (empty/miss no-op; resize; dispose) → Tasks 6, 7, 9 ✓
- `fade` persistence (age attribute + time uniform) → Task 7 (shader + `aBirth`/`uTime`) ✓

**2. Placeholder scan:** No TBD/TODO/"add error handling"/"similar to Task N" — every code step is complete. ✓

**3. Type consistency:** `RingBuffer.reserve/count/writeHead/clear`, `WriteSegment{start,length}`, `sampleGradient(stops,t)`, `ColorStop{t,color}`, `coneRays(...)`, `Emitter.emit`, `Hit{point,distance}`, `RaycastSampler.sample`, `PointCloud.addHits/update/clear/setRamp/setPersistence/count/positionArray/distanceArray/birthArray`, `LidarEngine` method names — all consistent across tasks. Shader attribute/uniform names (`aDistance`, `aBirth`, `uTime`, `uMaxDistance`, `uPointSize`, `uRamp`, `uFade`, `uFadeDuration`) match `PointCloud`. ✓
