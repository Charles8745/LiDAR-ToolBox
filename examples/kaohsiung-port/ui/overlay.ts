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
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ESC[c]);

export interface OverlayHandlers {
  onFilter(enabled: Set<string>): void;
  onView(mode: 'type' | 'status'): void;
  onScrub(tMs: number): void;
}
export interface OverlayApi {
  setKpi(opts: { inPort: number; occupied: number; total: number; dateMs: number }): void;
  showVessel(v: VesselRecord): void;
  hideVessel(): void;
  setTimeRange(opts: { minMs: number; maxMs: number; nowMs: number }): void;
  setClock(ms: number): void;
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

  // Bottom time slider (24h scrub + play).
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
  function stop() { playing = false; play.textContent = '▶'; if (timer) cancelAnimationFrame(timer); }
  slider.addEventListener('input', () => { stop(); handlers.onScrub(+slider.value); });
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

  return {
    setKpi({ inPort, occupied, total, dateMs }) {
      kpi.innerHTML = `<b style="color:#9fe">高雄港 · LiDAR 數位孿生</b>
        <span>在港船 <b>${inPort}</b></span>
        <span>泊位佔用 <b>${occupied}/${total}</b></span>
        <span style="margin-left:auto">${fmtClock(dateMs)}</span>`;
    },
    showVessel(v) {
      card.style.display = 'block';
      card.innerHTML = `<b style="color:#9fe">${esc(v.nameZh)} ${esc(v.nameEn)}</b>
        <div style="margin-top:6px">船型:${esc(v.shipType)}</div>
        <div>泊位:${esc(v.wharfName)}</div>
        <div>前一港:${esc(v.beforePort)}</div>
        <div>下一港:${esc(v.nextPort)}</div>
        <div>IMO:${esc(v.imo) || '—'}</div>`;
    },
    hideVessel() { card.style.display = 'none'; },
    setTimeRange({ minMs, maxMs, nowMs }) {
      slider.min = String(minMs); slider.max = String(maxMs); slider.value = String(nowMs);
    },
    setClock(ms) { clock.textContent = fmtClock(ms); },
  };
}
