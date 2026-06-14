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
