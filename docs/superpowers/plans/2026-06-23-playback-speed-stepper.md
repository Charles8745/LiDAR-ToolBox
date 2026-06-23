# Playback Speed Stepper + Toolbox Component Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 1–10 playback-speed stepper to the Kaohsiung war-room timeline (today's feel = 80% = step 8, default step 5), re-vendor the latest UI-ToolBox liquid-glass, swap three native controls for glass components, and delete one unused toggle plus a dead-code playback loop.

**Architecture:** All changes live in the `examples/kaohsiung-port/` example layer — the engine (`src/`) is untouched. Playback speed is a pure function (`time/playback.ts`) consumed by the existing `requestAnimationFrame` loop in `ui/overlay.ts`. Glass components come from re-vendoring `ui/liquid-glass.{css,js}` from `~/Desktop/UI-ToolBox/`; dynamically-created glass elements are wired with the public `LiquidGlass.behaviors.*` API.

**Tech Stack:** TypeScript, Vite, Three.js (unaffected), node:test (unit tests), vendored zero-dependency liquid-glass CSS/JS kit, Phosphor SVG icons.

## Global Constraints

- Engine `src/` is NOT modified — example-layer only.
- Today's per-frame advance `(max-min)/600` is defined as step 8 (80%). Speed formula: `advancePerFrame(rangeMs, step) = rangeMs * step / 4800`.
- Stepper: integer 1–10, step 1, default value 5, no percentage readout.
- Stepper sits in the bottom timeline bar, to the LEFT of the ▶ play button.
- `npx tsc --noEmit` must stay at 0 errors; `npm run build` must succeed; existing tests stay green.
- Re-vendoring must NOT visually change existing panels — verify before adding new components.
- `reviveGlass()` in `overlay.ts` is NOT touched by re-vendoring (it lives in overlay.ts, not liquid-glass.js).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `examples/kaohsiung-port/time/playback.ts` | `advancePerFrame` pure speed function | Create |
| `test/port-playback.test.ts` | unit test for `advancePerFrame` | Create |
| `examples/kaohsiung-port/ui/liquid-glass.css` | vendored glass kit styles | Overwrite (re-vendor) |
| `examples/kaohsiung-port/ui/liquid-glass.js` | vendored glass kit behaviors | Overwrite (re-vendor) |
| `examples/kaohsiung-port/index.html` | shell; add Phosphor symbol sprite | Modify |
| `examples/kaohsiung-port/ui/overlay.ts` | add stepper, swap slider/check/switch, delete view toggle, speed wiring | Modify |
| `examples/kaohsiung-port/main.ts` | drop `onView`/`colorBy`, remove dead `play()/pause()` | Modify |

---

## Task 1: `advancePerFrame` pure function + test

**Files:**
- Create: `examples/kaohsiung-port/time/playback.ts`
- Test: `test/port-playback.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `advancePerFrame(rangeMs: number, step: number): number` — milliseconds to advance the scrubber per animation frame. `rangeMs` = `maxMs - minMs`; `step` = stepper value 1–10. Returns `rangeMs * step / 4800`.

- [ ] **Step 1: Write the failing test**

Create `test/port-playback.test.ts` (this repo uses **vitest**):

```ts
import { describe, it, expect } from 'vitest';
import { advancePerFrame } from '../examples/kaohsiung-port/time/playback';

const RANGE = 86_400_000; // 24h in ms

describe('advancePerFrame', () => {
  it('step 8 reproduces today\'s speed (range/600)', () => {
    expect(advancePerFrame(RANGE, 8)).toBe(RANGE / 600);
  });

  it('step 10 is 1.25x today (range/480)', () => {
    expect(advancePerFrame(RANGE, 10)).toBe(RANGE / 480);
  });

  it('step 1 is the slowest (range/4800)', () => {
    expect(advancePerFrame(RANGE, 1)).toBe(RANGE / 4800);
  });

  it('step 5 is the default (range/960)', () => {
    expect(advancePerFrame(RANGE, 5)).toBe(RANGE / 960);
  });

  it('scales linearly with step', () => {
    expect(advancePerFrame(RANGE, 4)).toBe(advancePerFrame(RANGE, 2) * 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/port-playback.test.ts`
Expected: FAIL — cannot resolve `../examples/kaohsiung-port/time/playback` / `advancePerFrame` is not a function.

- [ ] **Step 3: Write minimal implementation**

Create `examples/kaohsiung-port/time/playback.ts`:

```ts
/**
 * Milliseconds to advance the timeline scrubber per animation frame.
 *
 * Today's fixed sweep advanced `(max-min)/600` per frame; that is defined as
 * step 8 (80%). The stepper exposes 1–10 (10%–100%), so speed scales as
 * `step/8` relative to today: step 10 → 1.25x, step 1 → 0.125x.
 *
 * @param rangeMs full timeline span (maxMs - minMs)
 * @param step    stepper value, integer 1–10
 */
export function advancePerFrame(rangeMs: number, step: number): number {
  return (rangeMs * step) / 4800;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/port-playback.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the full suite to confirm nothing broke**

Run: `npm test`
Expected: all green (was 177 + 5 new).

- [ ] **Step 6: Commit**

```bash
git add examples/kaohsiung-port/time/playback.ts test/port-playback.test.ts
git commit -m "feat(port): advancePerFrame speed function (step 8 = today, 1-10 scale)"
```

---

## Task 2: Re-vendor liquid-glass + Phosphor symbols (no-regression checkpoint)

This task brings in the new kit and the icon sprite WITHOUT yet using any new component, so the only acceptance criterion is "existing UI looks and works exactly as before." Re-vendoring and the sprite are folded together because the sprite is dead weight until the kit needs it and the kit's new CSS is the thing being regression-checked.

**Files:**
- Modify (overwrite): `examples/kaohsiung-port/ui/liquid-glass.css`
- Modify (overwrite): `examples/kaohsiung-port/ui/liquid-glass.js`
- Modify: `examples/kaohsiung-port/index.html`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `window.LiquidGlass.behaviors.slider(input: Element)`, `window.LiquidGlass.behaviors.switchTension(label: Element)`, global delegated stepper handler (`initSteppers`), and SVG symbols `#ph-minus`, `#ph-plus`, `#ph-check` available to later tasks.

- [ ] **Step 1: Copy the two vendored files from UI-ToolBox**

Run:
```bash
cp ~/Desktop/UI-ToolBox/liquid-glass.css examples/kaohsiung-port/ui/liquid-glass.css
cp ~/Desktop/UI-ToolBox/liquid-glass.js  examples/kaohsiung-port/ui/liquid-glass.js
```

- [ ] **Step 2: Add the Phosphor symbol sprite to index.html**

In `examples/kaohsiung-port/index.html`, insert an inline hidden SVG sprite as the first child of `<body>` (immediately after the `<body>` line, before `<canvas id="view">`):

```html
    <svg width="0" height="0" style="position:absolute" aria-hidden="true">
      <symbol id="ph-minus" viewBox="0 0 256 256"><path d="M224,128a8,8,0,0,1-8,8H40a8,8,0,0,1,0-16H216A8,8,0,0,1,224,128Z"/></symbol>
      <symbol id="ph-plus" viewBox="0 0 256 256"><path d="M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z"/></symbol>
      <symbol id="ph-check" viewBox="0 0 256 256"><path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z"/></symbol>
    </svg>
```

- [ ] **Step 3: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: 0 type errors, build succeeds.

- [ ] **Step 4: Visual no-regression check**

Run `npm run dev`, open `http://localhost:5173/examples/kaohsiung-port/index.html` in the browser, and confirm every EXISTING panel is unchanged vs before:
- Top navbar (title / LIVE / clock), left KPI gauge ring + 範圍內 AIS 船數 stat + spark, left 船型篩選 card, 檢視 + 底圖 buttons, right 在港船舶趨勢 line chart, right 即將進港 list, bottom timeline (▶ + range slider + clock).
- Liquid-glass refraction still composites on all panels (the `reviveGlass` hack still runs from overlay.ts).
- Console has no errors (favicon 404 is expected/ignored).

If any panel's appearance shifted (new kit CSS changed a shared class like `lg-btn`/`lg-card`/`lg-stat`/`lg-gauge`/`lg-chart`), note the specific class and adjust `ui/theme.css` overrides to restore the prior look before committing. Do NOT proceed to Task 3 until existing UI matches the pre-change state.

- [ ] **Step 5: Commit**

```bash
git add examples/kaohsiung-port/ui/liquid-glass.css examples/kaohsiung-port/ui/liquid-glass.js examples/kaohsiung-port/index.html
git commit -m "chore(port): re-vendor liquid-glass kit + add Phosphor minus/plus/check sprite"
```

---

## Task 3: Speed stepper in timeline, wired to the playback loop

**Files:**
- Modify: `examples/kaohsiung-port/ui/overlay.ts` (import + timeline block lines ~164-189)

**Interfaces:**
- Consumes: `advancePerFrame` from Task 1; `#ph-minus`/`#ph-plus` symbols + global stepper delegation from Task 2.
- Produces: nothing for later tasks (self-contained UI behavior).

- [ ] **Step 1: Import the speed function**

At the top of `examples/kaohsiung-port/ui/overlay.ts`, after the existing imports (after line 2), add:

```ts
import { advancePerFrame } from '../time/playback';
```

- [ ] **Step 2: Add the stepper element and read its value**

In the `// BOTTOM timeline` block, replace the element-creation + append lines. Find:

```ts
  const play = document.createElement('button');
  play.className = 'lg lg-btn lg-btn--icon'; play.setAttribute('data-lg', '');
  
  play.textContent = '▶';
  const slider = document.createElement('input');
  slider.type = 'range'; slider.style.flex = '1';
  const tclock = document.createElement('span');
  tclock.style.cssText = 'min-width:96px;text-align:right;font-variant-numeric:tabular-nums';
  timeline.append(play, slider, tclock);
```

Replace with (adds the stepper before `play`, tracks `speedStep`, and orders it left of ▶):

```ts
  // Speed stepper (1-10; today's feel = 8 = 80%; default 5). Sits left of ▶.
  let speedStep = 5;
  const speed = document.createElement('div');
  speed.className = 'lg lg-stepper'; speed.setAttribute('data-lg', '');
  speed.innerHTML = `
    <button type="button" class="lg-stepper__btn" data-lg-step="-1" aria-label="減速"><svg viewBox="0 0 256 256"><use href="#ph-minus"/></svg></button>
    <input class="lg-stepper__input" type="number" min="1" max="10" step="1" value="5" aria-label="播放速度">
    <button type="button" class="lg-stepper__btn" data-lg-step="1" aria-label="加速"><svg viewBox="0 0 256 256"><use href="#ph-plus"/></svg></button>`;
  const speedInput = speed.querySelector('.lg-stepper__input') as HTMLInputElement;
  speedInput.addEventListener('input', () => {
    const n = parseInt(speedInput.value, 10);
    if (Number.isFinite(n)) speedStep = Math.min(10, Math.max(1, n));
  });

  const play = document.createElement('button');
  play.className = 'lg lg-btn lg-btn--icon'; play.setAttribute('data-lg', '');
  play.textContent = '▶';
  const slider = document.createElement('input');
  slider.type = 'range'; slider.style.flex = '1';
  const tclock = document.createElement('span');
  tclock.style.cssText = 'min-width:96px;text-align:right;font-variant-numeric:tabular-nums';
  timeline.append(speed, play, slider, tclock);
```

- [ ] **Step 3: Use `advancePerFrame` + `speedStep` in the playback loop**

In the same file, find the play `stepFn`:

```ts
    const stepFn = () => {
      if (!playing) return;
      let v = +slider.value + (+slider.max - +slider.min) / 600; // ~10s sweep across the range
      if (v > +slider.max) v = +slider.min;
      slider.value = String(v); handlers.onScrub(v); timer = requestAnimationFrame(stepFn);
    };
```

Replace with (reads live `speedStep` each frame):

```ts
    const stepFn = () => {
      if (!playing) return;
      let v = +slider.value + advancePerFrame(+slider.max - +slider.min, speedStep);
      if (v > +slider.max) v = +slider.min;
      slider.value = String(v); handlers.onScrub(v); timer = requestAnimationFrame(stepFn);
    };
```

- [ ] **Step 4: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: 0 errors, build succeeds.

- [ ] **Step 5: Visual verification**

Run `npm run dev`, open the page:
- The stepper appears left of ▶ in the bottom bar, showing `5` with −/+ glass buttons.
- −/+ change the number; it clamps at 1 and 10 (can't go past).
- Press ▶: at step 5 the sweep is noticeably slower than step 8; bump to 10 mid-play and the scrub visibly speeds up without restarting; drop to 1 and it crawls.
- Console clean (favicon 404 ignored).

- [ ] **Step 6: Commit**

```bash
git add examples/kaohsiung-port/ui/overlay.ts
git commit -m "feat(port): playback speed stepper (1-10) wired to RAF loop"
```

---

## Task 4: Swap timeline range input → `.lg-slider`

**Files:**
- Modify: `examples/kaohsiung-port/ui/overlay.ts` (Window type decl line 19; timeline slider creation; programmatic value sites)

**Interfaces:**
- Consumes: `LiquidGlass.behaviors.slider` from Task 2.
- Produces: nothing for later tasks.

- [ ] **Step 1: Extend the LiquidGlass type declaration**

In `examples/kaohsiung-port/ui/overlay.ts`, replace line 19:

```ts
    LiquidGlass?: { init?: (c?: unknown) => void; attach?: (el: Element) => void; refresh?: () => void; supported?: boolean };
```

with:

```ts
    LiquidGlass?: {
      init?: (c?: unknown) => void;
      attach?: (el: Element) => void;
      refresh?: () => void;
      supported?: boolean;
      behaviors?: { slider?: (el: Element) => void; switchTension?: (el: Element) => void };
    };
```

- [ ] **Step 2: Wrap the range input in a `.lg-slider` glass container + add a fill painter**

In the `// BOTTOM timeline` block, replace the slider creation (from Task 3's result):

```ts
  const slider = document.createElement('input');
  slider.type = 'range'; slider.style.flex = '1';
```

with:

```ts
  const sliderWrap = document.createElement('div');
  sliderWrap.className = 'lg lg-slider'; sliderWrap.setAttribute('data-lg', '');
  sliderWrap.style.cssText = 'flex:1;height:auto;padding:0 10px';
  const slider = document.createElement('input');
  slider.className = 'lg-slider__input'; slider.type = 'range';
  sliderWrap.appendChild(slider);
  // Glass fill (--lg-fill) only repaints on 'input'; playback sets value
  // programmatically (dispatching 'input' would trigger stopPlay), so repaint manually.
  const paintFill = () => {
    const mn = +slider.min, mx = +slider.max;
    const p = mx > mn ? ((+slider.value - mn) / (mx - mn)) * 100 : 0;
    slider.style.setProperty('--lg-fill', p + '%');
  };
  window.LiquidGlass?.behaviors?.slider?.(slider);
```

- [ ] **Step 3: Append the wrapper instead of the bare input**

In the `timeline.append(...)` line from Task 3, replace `slider` with `sliderWrap`:

```ts
  timeline.append(speed, play, sliderWrap, tclock);
```

- [ ] **Step 4: Repaint the fill on programmatic value changes**

In `stepFn`, after `slider.value = String(v);` add `paintFill();`:

```ts
      slider.value = String(v); paintFill(); handlers.onScrub(v); timer = requestAnimationFrame(stepFn);
```

Then find `setTimeRange` (it sets `slider.value`):

```ts
    setTimeRange({ minMs, maxMs, nowMs }) {
      slider.min = String(minMs); slider.max = String(maxMs); slider.value = String(nowMs);
```

and add `paintFill();` immediately after that `slider.value` assignment (keep the rest of the method body):

```ts
    setTimeRange({ minMs, maxMs, nowMs }) {
      slider.min = String(minMs); slider.max = String(maxMs); slider.value = String(nowMs); paintFill();
```

- [ ] **Step 5: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: 0 errors, build succeeds.

- [ ] **Step 6: Visual verification**

Run `npm run dev`:
- The timeline scrubber is now a glass slider with a coloured fill up to the thumb.
- Dragging scrubs the scene as before and pauses playback; the fill tracks the thumb.
- During playback the fill advances smoothly with the thumb.
- Console clean.

- [ ] **Step 7: Commit**

```bash
git add examples/kaohsiung-port/ui/overlay.ts
git commit -m "feat(port): timeline scrubber uses .lg-slider with live fill"
```

---

## Task 5: Swap ship-type filter checkboxes → `.lg-check`

**Files:**
- Modify: `examples/kaohsiung-port/ui/overlay.ts` (filter row markup lines ~121-132)

**Interfaces:**
- Consumes: `#ph-check` symbol from Task 2.
- Produces: nothing for later tasks.

- [ ] **Step 1: Convert each filter row to `.lg-check`, preserving the colour dot**

In `examples/kaohsiung-port/ui/overlay.ts`, find:

```ts
  SHIP_CATEGORIES.forEach((cat, i) => {
    const rowEl = document.createElement('label');
    rowEl.style.cssText = 'display:flex;align-items:center;gap:6px;margin:3px 0;cursor:pointer;font-size:12px';
    rowEl.innerHTML = `<input type="checkbox" checked>
      <span style="width:9px;height:9px;border-radius:50%;background:${rgb(SHIP_CATEGORY_COLORS[i])}"></span>${esc(cat)}`;
    const cb = rowEl.querySelector('input') as HTMLInputElement;
    cb.addEventListener('change', () => {
      if (cb.checked) enabled.add(cat); else enabled.delete(cat);
      handlers.onFilter(new Set(enabled));
    });
    filter.appendChild(rowEl);
  });
```

Replace with:

```ts
  SHIP_CATEGORIES.forEach((cat, i) => {
    const rowEl = document.createElement('label');
    rowEl.className = 'lg-check';
    rowEl.style.cssText = 'margin:3px 0;font-size:12px';
    rowEl.innerHTML = `<input type="checkbox" checked>
      <span class="lg-check__box"><svg class="lg-check__mark" viewBox="0 0 256 256"><use href="#ph-check"/></svg></span>
      <span class="lg-check__label"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;vertical-align:middle;margin-right:5px;background:${rgb(SHIP_CATEGORY_COLORS[i])}"></span>${esc(cat)}</span>`;
    const cb = rowEl.querySelector('input') as HTMLInputElement;
    cb.addEventListener('change', () => {
      if (cb.checked) enabled.add(cat); else enabled.delete(cat);
      handlers.onFilter(new Set(enabled));
    });
    filter.appendChild(rowEl);
  });
```

- [ ] **Step 2: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: 0 errors, build succeeds.

- [ ] **Step 3: Visual verification**

Run `npm run dev`:
- Each 船型篩選 row is now a glass checkbox with a check mark when ticked, the category colour dot still present before the label.
- Unticking a row removes that category's ships; re-ticking restores them (unchanged behavior).
- Console clean.

- [ ] **Step 4: Commit**

```bash
git add examples/kaohsiung-port/ui/overlay.ts
git commit -m "feat(port): ship-type filter rows use .lg-check (colour dot kept)"
```

---

## Task 6: Backdrop toggle → `.lg-switch`; delete the view (船型↔狀態) toggle

This task removes the `onView` interface member, so the overlay change and the `main.ts` change must land together to keep `tsc` green.

**Files:**
- Modify: `examples/kaohsiung-port/ui/overlay.ts` (toggle block lines ~133-146; `OverlayHandlers` interface line 25)
- Modify: `examples/kaohsiung-port/main.ts` (handlers object lines ~251-259; `updateShips` call line 262)

**Interfaces:**
- Consumes: `LiquidGlass.behaviors.switchTension` from Task 2.
- Produces: `OverlayHandlers` no longer has `onView`. `main.ts` no longer passes `onView`. Ships always render with `'type'` colouring in the UI (status path remains reachable only via `__twin.updateShips(t, 'status')`).

- [ ] **Step 1: Replace the view + backdrop buttons with a single `.lg-switch` for backdrop**

In `examples/kaohsiung-port/ui/overlay.ts`, find the whole block:

```ts
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
  bgBtn.textContent = '底圖:開';
  bgBtn.style.cssText = 'margin-top:6px;width:100%';
  bgBtn.addEventListener('click', () => { bgOn = !bgOn; bgBtn.textContent = `底圖:${bgOn ? '開' : '關'}`; handlers.onBackdrop(bgOn); });
  filter.appendChild(bgBtn);
```

Replace with:

```ts
  const bgSwitch = document.createElement('label');
  bgSwitch.className = 'lg-switch';
  bgSwitch.style.cssText = 'margin-top:8px;font-size:12px';
  bgSwitch.innerHTML = `<input type="checkbox" checked>
    <span class="lg-switch__track"><span class="lg-switch__thumb"></span></span>底圖`;
  const bgInput = bgSwitch.querySelector('input') as HTMLInputElement;
  bgInput.addEventListener('change', () => handlers.onBackdrop(bgInput.checked));
  filter.appendChild(bgSwitch);
  window.LiquidGlass?.behaviors?.switchTension?.(bgSwitch);
```

- [ ] **Step 2: Drop `onView` from the handlers interface**

In the same file, find the `OverlayHandlers` interface and delete the `onView` line:

```ts
export interface OverlayHandlers {
  onFilter(enabled: Set<string>): void;
  onView(mode: 'type' | 'status'): void;
  onScrub(tMs: number): void;
  onBackdrop(on: boolean): void;
}
```

becomes:

```ts
export interface OverlayHandlers {
  onFilter(enabled: Set<string>): void;
  onScrub(tMs: number): void;
  onBackdrop(on: boolean): void;
}
```

- [ ] **Step 3: Remove `onView`/`colorBy` from main.ts and hardcode type colouring**

In `examples/kaohsiung-port/main.ts`, find:

```ts
// Overlay (legend / KPI / detail / filter / view toggle / time slider).
let colorBy: 'type' | 'status' = 'type';
let filter = new Set<string>(SHIP_CATEGORIES);
let currentMs = nowMs;
const overlay = createOverlay(document.getElementById('overlay') as HTMLElement, {
  onFilter(enabled) { filter = enabled; refresh(currentMs); },
  onView(mode) { colorBy = mode; refresh(currentMs); },
  onScrub(tMs) { refresh(tMs); },
  onBackdrop(on) { mapPlane.visible = on; },
});
function refresh(tMs: number) {
  currentMs = tMs;
  updateShips(tMs, colorBy, filter);
```

Replace with:

```ts
// Overlay (legend / KPI / detail / filter / backdrop switch / time slider).
let filter = new Set<string>(SHIP_CATEGORIES);
let currentMs = nowMs;
const overlay = createOverlay(document.getElementById('overlay') as HTMLElement, {
  onFilter(enabled) { filter = enabled; refresh(currentMs); },
  onScrub(tMs) { refresh(tMs); },
  onBackdrop(on) { mapPlane.visible = on; },
});
function refresh(tMs: number) {
  currentMs = tMs;
  updateShips(tMs, 'type', filter);
```

- [ ] **Step 4: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: 0 errors (no unused `colorBy`, no missing `onView`), build succeeds.

- [ ] **Step 5: Visual verification**

Run `npm run dev`:
- The 檢視:船型↔狀態 button is gone.
- 底圖 is now a glass switch; toggling it hides/shows the basemap as before.
- Ships are coloured by type (unchanged default).
- Console clean.

- [ ] **Step 6: Commit**

```bash
git add examples/kaohsiung-port/ui/overlay.ts examples/kaohsiung-port/main.ts
git commit -m "feat(port): backdrop .lg-switch; remove view-toggle button + onView"
```

---

## Task 7: Remove dead `play()/pause()` from main.ts

**Files:**
- Modify: `examples/kaohsiung-port/main.ts` (dead playback block lines ~285-295; `__twin` object line ~321)

**Interfaces:**
- Consumes: nothing.
- Produces: `__twin` no longer exposes `play`/`pause` (the overlay RAF loop is the only playback path).

- [ ] **Step 1: Delete the dead self-running playback block**

In `examples/kaohsiung-port/main.ts`, find and delete:

```ts
// 自走回放:每 ~80ms 推進(由 __twin.play()/pause() 控制;預設停)。
let playTimer = 0;
function play() {
  if (playTimer) return;
  playTimer = window.setInterval(() => {
    let t = currentMs + (toMs - fromMs) / 600; // 約 50s 掃完全程
    if (t > toMs) t = fromMs;
    refresh(t);
  }, 80);
}
function pause() { if (playTimer) { clearInterval(playTimer); playTimer = 0; } }
```

- [ ] **Step 2: Drop `play, pause` from the `__twin` handle**

In the same file, find:

```ts
  engine, shipPC, mapPlane, updateShips, refresh, play, pause,
  fromMs, toMs, nowMs, peakInPort, tracks, trackMeta,
```

Replace with:

```ts
  engine, shipPC, mapPlane, updateShips, refresh,
  fromMs, toMs, nowMs, peakInPort, tracks, trackMeta,
```

- [ ] **Step 3: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: 0 errors (no unused `play`/`pause`/`playTimer`), build succeeds.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 5: Final visual verification**

Run `npm run dev` and confirm the whole feature end-to-end:
- Stepper left of ▶ (default 5), clamps 1–10, speed changes live during playback.
- Glass slider scrub + fill; glass filter checkboxes with colour dots; glass backdrop switch.
- View-toggle button gone; `window.__twin.play` is `undefined` in the console.
- Console clean (favicon 404 ignored).

- [ ] **Step 6: Commit**

```bash
git add examples/kaohsiung-port/main.ts
git commit -m "chore(port): remove dead __twin play()/pause() self-run loop"
```

---

## Notes for the implementer

- **Test runner:** this repo uses **vitest** (`npm test` → `vitest run`). Single-file runs use `npx vitest run <path>`; import with `{ describe, it, expect } from 'vitest'` and no file extension on relative imports.
- **`reviveGlass` covers new glass elements:** the stepper and `.lg-slider` carry `data-lg`, so the existing `reviveGlass()` loop in `overlay.ts` (fired at 400/900/1800/3500 ms) attaches refraction to them automatically — no extra wiring for glass. Only the *behaviors* (slider fill, switch spring) need the explicit `LiquidGlass.behaviors.*` calls already in the tasks; the stepper −/+ uses the kit's document-level delegation and needs none.
- **`.lg-check` / `.lg-switch` are NOT `.lg` elements** (bare `<label>`), so they take no `data-lg` and no glass attach — pure CSS plus, for the switch, the spring behavior.
- If Task 2's visual check surfaces a regression from the new kit CSS, fix it via `ui/theme.css` overrides (do not hand-edit the vendored files — they must stay a clean copy of UI-ToolBox).
```
