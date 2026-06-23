import { SHIP_CATEGORIES, SHIP_CATEGORY_COLORS } from '../palette';
import type { VesselRecord } from '../data/twport';
import { advancePerFrame } from '../time/playback';

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
    LiquidGlass?: {
      init?: (c?: unknown) => void;
      attach?: (el: Element) => void;
      refresh?: () => void;
      supported?: boolean;
      behaviors?: { slider?: (el: Element) => void; switchTension?: (el: Element) => void };
    };
  }
}

export interface OverlayHandlers {
  onFilter(enabled: Set<string>): void;
  onScrub(tMs: number): void;
  onBackdrop(on: boolean): void;
}
export interface IncomingItem { berthNo: number; name: string; etaMs: number; }
export interface OverlayApi {
  setKpi(opts: { inPort: number; total: number }): void;
  showVessel(v: VesselRecord): void;
  hideVessel(): void;
  setTimeRange(opts: { minMs: number; maxMs: number; nowMs: number }): void;
  setClock(ms: number): void;
  setTrend(points: number[]): void;
  setIncoming(items: IncomingItem[], asOfMs?: number): void;
}

export function createOverlay(root: HTMLElement, handlers: OverlayHandlers): OverlayApi {
  root.innerHTML = '';
  const enabled = new Set<string>(SHIP_CATEGORIES);

  // Staggered entrance applied to the four layout regions (not per-card, to avoid
  // transform/scroll interaction inside the rails).
  let stagger = 0;
  const rise = <T extends HTMLElement>(el: T): T => {
    el.style.animationDelay = `${stagger.toFixed(2)}s`;
    el.classList.add('fade-rise');
    stagger += 0.08;
    return el;
  };

  // A fixed top/bottom glass bar.
  const bar = (cls: string, css: string): HTMLDivElement => {
    const el = document.createElement('div');
    el.className = cls;
    el.setAttribute('data-lg', '');
    el.style.cssText = css;
    root.appendChild(rise(el));
    return el;
  };

  // A side rail: a flex column that auto-stacks its cards (no hardcoded offsets, so cards
  // can never overlap). pointer-events:none lets clicks fall through the gaps to the canvas
  // (ship picking); each card re-enables pointer-events. The rail sizes to its content (no
  // fixed height, no overflow scroll) — an `overflow != visible` ancestor is one thing that
  // can disturb descendant backdrop-filter compositing, so we keep it `visible`.
  const makeRail = (side: 'left' | 'right'): HTMLDivElement => {
    const r = document.createElement('div');
    r.className = 'lg-rail';
    r.style.cssText = `${side}:14px;top:70px;width:200px;display:flex;flex-direction:column;`
      + 'gap:12px;pointer-events:none';
    root.appendChild(rise(r));
    return r;
  };
  const leftRail = makeRail('left');
  const rightRail = makeRail('right');

  // A glass card inside a rail: full rail width, clickable.
  const card = (cls: string, parent: HTMLElement): HTMLDivElement => {
    const el = document.createElement('div');
    el.className = cls;
    el.setAttribute('data-lg', '');
    el.style.cssText = 'width:100%;pointer-events:auto;flex:0 0 auto';
    parent.appendChild(el);
    return el;
  };

  // TOP navbar
  const nav = bar('lg lg-navbar', 'left:14px;right:14px;top:14px;height:44px;display:flex;align-items:center;gap:10px;padding:0 16px');
  nav.innerHTML = `<span class="lg-navbar__brand" style="font-weight:700">高雄港 IOC</span>
    <span style="color:var(--ink-dim);font-size:12px">· LiDAR 戰情室</span>
    <span class="lg-navbar__spacer" style="flex:1"></span>
    <span style="display:inline-flex;align-items:center;gap:6px;color:var(--signal-ok);font-size:12px">
      <span style="width:7px;height:7px;border-radius:50%;background:var(--signal-ok);box-shadow:0 0 8px var(--signal-ok)"></span>LIVE</span>`;
  const clock = document.createElement('span');
  clock.style.cssText = 'margin-left:14px;font-variant-numeric:tabular-nums;min-width:96px;text-align:right';
  nav.appendChild(clock);

  // LEFT: occupancy gauge
  const gauge = card('lg lg-gauge', leftRail);
  gauge.setAttribute('data-lg-profile', 'circle');
  gauge.setAttribute('data-lg-value', '0');
  gauge.setAttribute('data-lg-unit', '%');
  gauge.setAttribute('data-lg-label', '在港 / 峰值');
  gauge.style.width = '135px';
  gauge.style.alignSelf = 'center';

  // LEFT: in-port stat (+spark)
  const stat = card('lg lg-stat', leftRail);
  stat.innerHTML = `<span class="lg-stat__label">範圍內 AIS 船數</span>
    <div class="lg-stat__row"><span class="lg-stat__value" data-lg-value="0"></span></div>
    <svg class="lg-stat__spark" data-lg-spark="0,0"></svg>`;
  const statValue = stat.querySelector('.lg-stat__value') as HTMLElement;
  const statSpark = stat.querySelector('.lg-stat__spark') as SVGElement;

  // LEFT: ship-type filter + view/backdrop toggles
  const filter = card('lg lg-card', leftRail);
  filter.innerHTML = '<div style="opacity:.6;text-transform:uppercase;font-size:10px;margin-bottom:6px">船型篩選</div>';
  SHIP_CATEGORIES.forEach((cat, i) => {
    const rowEl = document.createElement('label');
    rowEl.className = 'lg-check';
    rowEl.style.cssText = 'display:flex;margin:3px 0;font-size:12px';
    rowEl.innerHTML = `<input type="checkbox" checked>
      <span class="lg-check__box"><svg class="lg-check__mark" viewBox="0 0 256 256"><use href="#ph-check"/></svg></span>
      <span class="lg-check__label"><span style="display:inline-block;width:11px;height:11px;border-radius:50%;vertical-align:middle;margin-right:7px;background:${rgb(SHIP_CATEGORY_COLORS[i])};box-shadow:0 0 6px ${rgb(SHIP_CATEGORY_COLORS[i])}66"></span>${esc(cat)}</span>`;
    const cb = rowEl.querySelector('input') as HTMLInputElement;
    cb.addEventListener('change', () => {
      if (cb.checked) enabled.add(cat); else enabled.delete(cat);
      handlers.onFilter(new Set(enabled));
    });
    filter.appendChild(rowEl);
  });
  const bgSwitch = document.createElement('label');
  bgSwitch.className = 'lg-switch';
  bgSwitch.style.cssText = 'margin-top:8px;font-size:12px';
  bgSwitch.innerHTML = `<input type="checkbox" checked>
    <span class="lg-switch__track"><span class="lg-switch__thumb"></span></span>底圖`;
  const bgInput = bgSwitch.querySelector('input') as HTMLInputElement;
  bgInput.addEventListener('change', () => handlers.onBackdrop(bgInput.checked));
  filter.appendChild(bgSwitch);
  window.LiquidGlass?.behaviors?.switchTension?.(bgSwitch);

  // RIGHT: 24h trend chart
  const chart = card('lg lg-chart', rightRail);
  chart.innerHTML = `<div class="lg-chart__head"><h4 class="lg-chart__title">在港船舶趨勢</h4></div>
    <svg class="lg-chart__svg" data-lg-chart="line" data-lg-points="0,0"></svg>`;
  const chartSvg = chart.querySelector('.lg-chart__svg') as SVGElement;

  // RIGHT: incoming list
  const incoming = card('lg lg-card', rightRail);
  incoming.innerHTML = '<div data-inc-head style="opacity:.6;text-transform:uppercase;font-size:10px;margin-bottom:6px">即將進港(港務預報)</div><div data-rows></div>';
  const incHead = incoming.querySelector('[data-inc-head]') as HTMLElement;
  const incRows = incoming.querySelector('[data-rows]') as HTMLElement;

  // RIGHT: detail card (hidden until a ship is picked; stacks below the incoming list)
  const detail = card('lg lg-card', rightRail);
  detail.style.display = 'none';

  // BOTTOM timeline
  const timeline = bar('lg', 'left:14px;right:14px;bottom:14px;height:46px;display:flex;gap:12px;align-items:center;padding:0 14px;border-radius:14px');
  // Speed stepper (1-10; today's feel = 8 = 80%; default 5). Sits left of ▶.
  // Keep this default in sync with the input's value="5" attribute below.
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
  const tclock = document.createElement('span');
  tclock.style.cssText = 'min-width:96px;text-align:right;font-variant-numeric:tabular-nums';
  timeline.append(speed, play, sliderWrap, tclock);

  let playing = false; let timer = 0;
  function stopPlay() { playing = false; play.textContent = '▶'; if (timer) cancelAnimationFrame(timer); }
  slider.addEventListener('input', () => { stopPlay(); handlers.onScrub(+slider.value); });
  play.addEventListener('click', () => {
    if (timer) cancelAnimationFrame(timer);
    playing = !playing; play.textContent = playing ? '⏸' : '▶';
    const stepFn = () => {
      if (!playing) return;
      let v = +slider.value + advancePerFrame(+slider.max - +slider.min, speedStep);
      if (v > +slider.max) v = +slider.min;
      slider.value = String(v); paintFill(); handlers.onScrub(v); timer = requestAnimationFrame(stepFn);
    };
    if (playing) timer = requestAnimationFrame(stepFn);
  });

  // Force the live-glass refraction to composite.
  //
  // Root cause: the kit feeds each filter's <feImage> a canvas→PNG data-URI displacement
  // map that Chromium decodes ASYNCHRONOUSLY; the panel's `backdrop-filter` effect node is
  // rasterized at first paint BEFORE that decode lands and is never rebuilt — so panels show
  // only the flat .lg tint (no refraction) until a real stylesheet change forces a
  // document-wide recalc (which is exactly why saving theme.css "revived" it: Vite swaps the
  // <link>, changing the active-stylesheet set). JS inline / CSS-var nudges are a
  // single-element fast-path recalc and don't help.
  //
  // The reliable revival (user-verified) is, across two frames: tear down each panel's
  // backdrop-filter (drop the stale node) → restore it AND clone+cache-bust+swap a
  // same-origin <link rel=stylesheet> (an active-stylesheet-set change, like Vite's CSS
  // HMR). Crucial: it must run AFTER the feImage PNGs have decoded — doing it a couple of
  // frames after build (pre-decode) silently misses, which is why the earlier attempt failed.
  const reviveGlass = (): void => {
    const panels = Array.from(root.querySelectorAll<HTMLElement>('[data-lg]'));
    if (!panels.length) return;
    const saved = panels.map((el) => ({
      el, bf: el.style.backdropFilter, wbf: el.style.getPropertyValue('-webkit-backdrop-filter'),
    }));
    // frame 1: drop the stale (un-composited) backdrop-filter effect node
    saved.forEach((s) => {
      if (s.bf || s.wbf) {
        s.el.style.backdropFilter = 'none';
        s.el.style.setProperty('-webkit-backdrop-filter', 'none');
      }
    });
    requestAnimationFrame(() => {
      // frame 2: restore the inline filters …
      saved.forEach((s) => {
        if (s.bf) s.el.style.backdropFilter = s.bf;
        if (s.wbf) s.el.style.setProperty('-webkit-backdrop-filter', s.wbf);
      });
      // … then force a document-wide recalc via an active-stylesheet-set change.
      const link = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
        .reverse()
        .find((e) => { try { return new URL(e.href).origin === location.origin; } catch { return false; } });
      if (!link) return;
      const base = link.href.split('?')[0];
      const clone = link.cloneNode() as HTMLLinkElement;
      clone.href = `${base}${base.includes('?') ? '&' : '?'}lgrc=${Date.now()}`;
      const dropOld = () => link.remove();
      clone.addEventListener('load', dropOld, { once: true });
      clone.addEventListener('error', dropOld, { once: true });
      link.after(clone);
    });
  };
  // Manual re-fire hook (debug / if you tweak panels live).
  (window as Window & { __reviveGlass?: () => void }).__reviveGlass = reviveGlass;

  // Attach, wait for the feImage displacement maps to actually decode, then revive.
  requestAnimationFrame(() => {
    const lg = window.LiquidGlass;
    if (!lg) return;
    lg.init?.();
    const panels = Array.from(root.querySelectorAll<HTMLElement>('[data-lg]'));
    panels.forEach((el) => lg.attach?.(el));
    if (!panels.length || lg.supported === false) return; // frosted fallback → no SVG filter
    // The filter's feImage decode + first backdrop composite settle asynchronously, and the
    // exact moment varies by machine — too early and the recalc misses (decoding a *copy* of
    // the data-URI resolves long before the filter's own copy is ready). So fire reviveGlass
    // a few times across the first few seconds to reliably catch the post-settle window.
    // (Each extra pass is a ~1-frame no-op once refraction is already up.)
    [400, 900, 1800, 3500].forEach((ms) => window.setTimeout(reviveGlass, ms));
  });

  return {
    setKpi({ inPort, total }) {                        // stat = 實際船數;gauge = 佔當日峰值 %
      statValue.setAttribute('data-lg-value', String(inPort));
      const pct = total > 0 ? Math.min(100, Math.round((inPort / total) * 100)) : 0;
      gauge.setAttribute('data-lg-value', String(pct));
    },
    showVessel(v) {
      detail.style.display = 'block';
      detail.innerHTML = `<b>${esc(v.nameZh)} ${esc(v.nameEn)}</b>
        <div style="margin-top:6px;font-size:12px">船型:${esc(v.shipType)}</div>
        <div style="font-size:12px">泊位:${esc(v.wharfName)}</div>
        <div style="font-size:12px">前一港:${esc(v.beforePort)}</div>
        <div style="font-size:12px">下一港:${esc(v.nextPort)}</div>
        <div style="font-size:12px">IMO:${esc(v.imo) || '—'}</div>`;
    },
    hideVessel() { detail.style.display = 'none'; },
    setTimeRange({ minMs, maxMs, nowMs }) {
      slider.min = String(minMs); slider.max = String(maxMs); slider.value = String(nowMs); paintFill();
    },
    setClock(ms) { clock.textContent = fmtClock(ms); tclock.textContent = fmtClock(ms); },
    setTrend(points) {
      const pts = points.length ? points : [0, 0];
      chartSvg.setAttribute('data-lg-points', pts.join(','));
      statSpark.setAttribute('data-lg-spark', pts.slice(-12).join(','));
    },
    setIncoming(items, asOfMs) {
      if (asOfMs != null) incHead.textContent = `即將進港 · 港務預報基準 ${fmtClock(asOfMs)}`;
      if (!items.length) { incRows.innerHTML = '<div style="opacity:.5;font-size:12px">— 無 —</div>'; return; }
      incRows.innerHTML = items.slice(0, 6).map((it) => `
        <div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;border-bottom:1px solid rgba(120,140,160,.12)">
          <span>#${it.berthNo} ${esc(it.name)}</span><span style="color:var(--signal-warn)">${hm(it.etaMs)}</span></div>`).join('');
    },
  };
}
