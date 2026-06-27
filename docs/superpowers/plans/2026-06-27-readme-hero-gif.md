# README Hero GIF Re-record Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (INLINE) to implement this plan. **Subagent-driven is NOT suitable** — Task 2 is interactive controller work driving a live browser via chrome-devtools (a fresh subagent has no browser session). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace `docs/assets/kaohsiung-warroom.gif` with a cinematic three-beat wide→close camera move over the 3D point-cloud port (pure scene, no HUD/labels, slow AIS drift, fade-to-black loop).

**Architecture:** A pure `framePlan` (smootherstep + Catmull-Rom through 3 real scouted camera keyframes + per-frame AIS time + fade ramps) drives a per-frame capture of the live app (camera + AIS time set, synchronous render, screenshot), then a Node script (`sharp` resize + per-frame fade + `gifenc` palette encode) assembles the GIF. All tooling is one-off under a temp `_gifgen/` dir, removed after; the only committed change is the GIF. Engine `src/` and example code are untouched.

**Tech Stack:** Node ESM scripts, `sharp` (existing dep), `gifenc` (installed `--no-save`, no package.json change), chrome-devtools MCP for capture, the app's `window.__twin` handles.

## Global Constraints

- **Engine `src/` and example code: ZERO changes.** Pure asset update — only `docs/assets/kaohsiung-warroom.gif` is committed.
- **package.json stays pristine:** install gifenc with `npm install gifenc --no-save` (does not touch package.json). All scripts/frames live under a temp `_gifgen/` dir, deleted in cleanup.
- **Output:** overwrite `docs/assets/kaohsiung-warroom.gif`; README line 9 link unchanged; line 18 "Operate it" caption still valid (no edit).
- **Pure scene:** hide the HUD (`#overlay`) and the 3D berth labels (`__twin.labels.group.visible=false`) before capture.
- **Motion:** 3 keyframes K0/K1/K2 (below), Catmull-Rom interpolation parameterized by `smootherstep(i/(N-1))` (slow→fast→slow); AIS time advances from `__twin.nowMs` by `dtMs=(toMs−fromMs)/4800` per frame (app's slowest rate); fade-to-black over the first/last 3 frames.
- **Camera keyframes (world units):** K0 `pos[2,205,270] target[-2,0,60]` · K1 `pos[10,92,152] target[-2,1,44]` · K2 `pos[13,5.5,47] target[-2.4,1.6,24]`.
- **Output spec:** ~1000×500, **N=45** frames, delay 67ms (~15fps, ~3s), gifenc ≤128 colors, target file **≤4MB** (if over: drop colors→64, then N→36, then W→900).

---

### Task 1: Pure frame-plan generator

**Files:**
- Create: `_gifgen/framePlan.mjs` (temp tooling)

**Interfaces:**
- Consumes: nothing.
- Produces: `export const K` (3 keyframes), `export function framePlan(N, nowMs, dtMs)` → `Array<{i:number, pos:[x,y,z], target:[x,y,z], tMs:number, fade:number}>`.

- [ ] **Step 1: Write the generator with an inline self-test**

```js
// _gifgen/framePlan.mjs — pure camera frame plan (no deps). Run directly to self-test.
export const K = [
  { pos: [2, 205, 270],  target: [-2, 0, 60] },    // K0 wide establishing
  { pos: [10, 92, 152],  target: [-2, 1, 44] },     // K1 banking descent
  { pos: [13, 5.5, 47],  target: [-2.4, 1.6, 24] }, // K2 close money-shot
];

const smootherstep = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * x * (x * (x * 6 - 15) + 10));

// Catmull-Rom through 3 points at global u in [0,1], with mirrored phantom endpoints for tangents.
function cr3(P0, P1, P2, u) {
  const Pm1 = P0.map((v, i) => 2 * v - P1[i]);
  const P3 = P2.map((v, i) => 2 * v - P1[i]);
  let p0, p1, p2, p3, t;
  if (u < 0.5) { p0 = Pm1; p1 = P0; p2 = P1; p3 = P2; t = u / 0.5; }
  else { p0 = P0; p1 = P1; p2 = P2; p3 = P3; t = (u - 0.5) / 0.5; }
  const t2 = t * t, t3 = t2 * t;
  return p1.map((_, i) =>
    0.5 * ((2 * p1[i]) + (-p0[i] + p2[i]) * t
      + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2
      + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3));
}

export function framePlan(N, nowMs, dtMs) {
  const fadeN = 3;
  const out = [];
  for (let i = 0; i < N; i++) {
    const u = smootherstep(i / (N - 1));
    const pos = cr3(K[0].pos, K[1].pos, K[2].pos, u);
    const target = cr3(K[0].target, K[1].target, K[2].target, u);
    const fade = Math.min(Math.min(1, i / fadeN), Math.min(1, (N - 1 - i) / fadeN));
    out.push({
      i,
      pos: pos.map((v) => +v.toFixed(3)),
      target: target.map((v) => +v.toFixed(3)),
      tMs: Math.round(nowMs + i * dtMs),
      fade: +fade.toFixed(3),
    });
  }
  return out;
}

// --- self-test (runs only when executed directly) ---
if (import.meta.url === `file://${process.argv[1]}`) {
  const N = 45, now = 1000, dt = 18150;
  const p = framePlan(N, now, dt);
  const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
  const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } };
  assert(p.length === N, 'length');
  assert(close(p[0].pos, K[0].pos) && close(p[0].target, K[0].target), 'i=0 → K0');
  assert(close(p[22].pos, K[1].pos) && close(p[22].target, K[1].target), 'mid → K1'); // 22/44=0.5
  assert(close(p[N - 1].pos, K[2].pos) && close(p[N - 1].target, K[2].target), 'last → K2');
  assert(p[0].fade === 0 && p[N - 1].fade === 0 && p[22].fade === 1, 'fade ramps');
  assert(p[0].tMs === 1000 && p[1].tMs === 1000 + dt, 'tMs steps');
  console.log('framePlan OK —', N, 'frames\n first:', p[0], '\n mid:', p[22], '\n last:', p[N - 1]);
}
```

- [ ] **Step 2: Run the self-test**

Run: `cd /Users/charles88/Desktop/LiDAR && node _gifgen/framePlan.mjs`
Expected: `framePlan OK — 45 frames` then first/mid/last printed; first.pos≈[2,205,270], mid.pos≈[10,92,152], last.pos≈[13,5.5,47]. Non-zero exit = a keyframe/fade bug.

(No git commit — `_gifgen/` is temp tooling, removed in Task 4. The only commit is the GIF.)

---

### Task 2: Capture the frames from the live app (interactive, controller-driven)

**Files:**
- Create: `_gifgen/frames/frame_000.png … frame_044.png` (temp)

**Interfaces:**
- Consumes: `framePlan` (Task 1) — the executor reads the plan to get each frame's `pos/target/tMs`.
- Produces: 45 full-viewport PNG screenshots of the pure scene.

> **This task is run by the controller via chrome-devtools, not a subagent.** It needs the live browser session.

- [ ] **Step 1: Start the app and open it**

Run: `cd /Users/charles88/Desktop/LiDAR && npm run dev` (background), then open `http://localhost:5173/examples/kaohsiung-port/index.html` in chrome-devtools and wait for `window.__twin`.

- [ ] **Step 2: Read the concrete frame plan (with real AIS values)**

In the page, get `nowMs`/`fromMs`/`toMs`, then compute the plan in Node so the numbers are exact:
```js
// in-page: read AIS window
(() => { const t = window.__twin; return { nowMs: t.nowMs, fromMs: t.fromMs, toMs: t.toMs }; })()
```
Then: `node -e "import('./_gifgen/framePlan.mjs').then(m=>console.log(JSON.stringify(m.framePlan(45, NOWMS, (TOMS-FROMMS)/4800))))"` (substitute the read values). Keep this plan JSON — it drives Steps 4 and the encode.

- [ ] **Step 3: Set up the scene for capture (one evaluate)**

```js
() => {
  const t = window.__twin, e = t.engine;
  e.pause(); cancelAnimationFrame(e.rafId);              // stop the RAF loop (manual render only)
  const ov = document.getElementById('overlay'); if (ov) ov.style.display = 'none'; // hide HUD
  if (t.labels?.group) t.labels.group.visible = false;  // hide 3D berth labels
  e.controls.minDistance = 0.2; e.controls.maxDistance = 4000;
  // capture helper: set camera + AIS time, render ONE frame synchronously
  window.__cap = (px, py, pz, tx, ty, tz, tMs) => {
    e.camera.position.set(px, py, pz);
    e.controls.target.set(tx, ty, tz);
    e.controls.update();
    t.refresh(tMs);
    (e.bloom ? e.bloom.render() : e.renderer.render(e.scene, e.camera));
    return true;
  };
  return { hud: ov ? 'hidden' : 'none', labels: t.labels ? 'hidden' : 'none' };
}
```

- [ ] **Step 4: Capture loop (45 iterations — for each frame `f` in the plan)**

For each frame, two calls:
1. evaluate_script: `() => window.__cap(<f.pos[0]>, <f.pos[1]>, <f.pos[2]>, <f.target[0]>, <f.target[1]>, <f.target[2]>, <f.tMs>)`
2. take_screenshot with `format:"png"`, `filePath:"/Users/charles88/Desktop/LiDAR/_gifgen/frames/frame_0NN.png"` (zero-pad NN to 3 digits: 000…044).

(Fade is applied later at encode time from `plan[i].fade` — capture full-brightness frames.)

- [ ] **Step 5: Verify the frames**

Run: `ls /Users/charles88/Desktop/LiDAR/_gifgen/frames/ | wc -l` → expect `45`. Spot-check `frame_000.png` (wide) and `frame_044.png` (close) are non-blank and HUD-free:
`sips -g pixelWidth -g pixelHeight _gifgen/frames/frame_000.png` (non-zero dims; open or screenshot-compare to confirm the scene rendered, no panels). If a frame is blank → the sync render didn't present; re-run that frame's Step-4 pair.

---

### Task 3: Encode the GIF (sharp resize + fade + gifenc)

**Files:**
- Create: `_gifgen/encode.mjs` (temp)
- Modify (output): `docs/assets/kaohsiung-warroom.gif`

**Interfaces:**
- Consumes: `_gifgen/frames/*.png` (Task 2), `framePlan` (Task 1, for `.fade`).
- Produces: the GIF at `docs/assets/kaohsiung-warroom.gif`.

- [ ] **Step 1: Install gifenc without touching package.json**

Run: `cd /Users/charles88/Desktop/LiDAR && npm install gifenc --no-save 2>&1 | tail -2`
Expected: installs `gifenc` into node_modules; `git status package.json` shows NO change.

- [ ] **Step 2: Write the encoder**

```js
// _gifgen/encode.mjs — frames → GIF. Run: node _gifgen/encode.mjs
import { readdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { framePlan } from './framePlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAMES_DIR = join(HERE, 'frames');
const OUT = join(HERE, '..', 'docs', 'assets', 'kaohsiung-warroom.gif');
const W = 1000, H = 500, DELAY = 67, N = 45, COLORS = 128;

const plan = framePlan(N, 0, 0); // only .fade is needed here (time-independent)
const files = (await readdir(FRAMES_DIR)).filter((f) => /^frame_\d+\.png$/.test(f)).sort();
if (files.length !== N) throw new Error(`expected ${N} frames, found ${files.length}`);

const gif = GIFEncoder();
for (let i = 0; i < N; i++) {
  const fade = plan[i].fade;
  let img = sharp(join(FRAMES_DIR, files[i])).resize(W, H, { fit: 'cover' });
  if (fade < 1) img = img.linear(fade, 0); // RGB *= fade → toward black
  const { data } = await img.removeAlpha().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgba = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const palette = quantize(rgba, COLORS);
  const index = applyPalette(rgba, palette);
  gif.writeFrame(index, W, H, { palette, delay: DELAY });
}
gif.finish();
await writeFile(OUT, gif.bytes());
console.log('wrote', OUT, (gif.bytes().length / 1048576).toFixed(2), 'MB');
```

- [ ] **Step 3: Encode and check size**

Run: `cd /Users/charles88/Desktop/LiDAR && node _gifgen/encode.mjs`
Expected: `wrote …/kaohsiung-warroom.gif X.XX MB`.
Then: `sips -g pixelWidth -g pixelHeight docs/assets/kaohsiung-warroom.gif` → 1000×500.
If size > 4MB: edit `encode.mjs` `COLORS` 128→64 and re-run; still over → `N`→36 (also update Task-2 capture to 36 frames) or `W`→900; re-run until ≤4MB.

---

### Task 4: Visual verify, cleanup, commit

**Files:**
- Modify: `docs/assets/kaohsiung-warroom.gif` (the only committed change)
- Delete: `_gifgen/` (temp)

- [ ] **Step 1: Visual verification**

Open `docs/assets/kaohsiung-warroom.gif` (Read tool renders it, or open in browser). Confirm: continuous wide→descent→close move; **no HUD panels, no berth-number labels**; ships drift subtly; fades to black and loops cleanly; reads as a cinematic LiDAR port hero. If the move is wrong (jerky / wrong framing), fix the keyframe(s) in `_gifgen/framePlan.mjs` and re-run Tasks 2–3.

- [ ] **Step 2: Confirm nothing leaked**

Run: `cd /Users/charles88/Desktop/LiDAR && git status --porcelain`
Expected: ONLY `docs/assets/kaohsiung-warroom.gif` modified. `git diff --stat package.json` → empty (gifenc was `--no-save`). `git status src/` and example dirs → no changes.

- [ ] **Step 3: Cleanup temp tooling**

Run: `cd /Users/charles88/Desktop/LiDAR && rm -rf _gifgen && npm ls gifenc 2>/dev/null | grep -q gifenc && npm rm gifenc --no-save 2>/dev/null; echo cleaned`
(node_modules is git-ignored, so an un-removed gifenc wouldn't affect the commit, but remove it for tidiness.) Re-run `git status --porcelain` → still only the GIF.

- [ ] **Step 4: Stop the dev server + commit**

Run: `pkill -f vite 2>/dev/null; cd /Users/charles88/Desktop/LiDAR`
```bash
git add docs/assets/kaohsiung-warroom.gif
git commit -m "docs: re-record README hero GIF (cinematic 3-beat, 3D ships)"
```

---

## Self-Review

**Spec coverage:**
- Money-shot = busiest varied cluster (-2.4,22) → K2 keyframe (Task 1 `K`, Task 2 capture) ✓
- No HUD + no berth labels → Task 2 Step 3 (hide `#overlay` + `__twin.labels.group`) ✓
- AIS slowest drift from peak → `dtMs=(toMs−fromMs)/4800`, `tMs=nowMs+i*dtMs` (Task 1 `framePlan`, Task 2 Step 2) ✓
- Three-beat continuous eased dolly → smootherstep + Catmull-Rom (Task 1) ✓
- Fade-to-black loop → `fade` ramps (Task 1) applied via `sharp.linear` (Task 3) ✓
- Output ~1000×500 / 45f / 15fps / ≤128 colors / ≤4MB → Task 3 constants + size-reduction ladder ✓
- One-off pipeline, package.json clean, engine src/ untouched, overwrite same GIF, README unchanged → Global Constraints + Task 4 ✓

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". Capture loop (Task 2 Step 4) is a concrete 2-call-per-frame procedure with exact filePath padding. The `<f.pos[0]>…` placeholders are values read from the printed plan JSON (Step 2), not unspecified logic.

**Type consistency:** `framePlan(N, nowMs, dtMs)` signature identical in Task 1, Task 2 Step 2, Task 3. Frame object shape `{i,pos,target,tMs,fade}` consumed consistently (capture uses pos/target/tMs; encode uses fade). `K` keyframes match the spec's K0/K1/K2 verbatim. Engine calls (`engine.pause`, `engine.rafId`, `engine.bloom.render`, `engine.renderer.domElement`, `__twin.labels.group`, `__twin.refresh`) verified against `src/core/LidarEngine.ts` + `ui/overlay.ts` (#overlay) + dev-guide §5.

**Execution note:** This is INLINE controller work (Task 2 drives the live browser). Not subagent-suitable.
