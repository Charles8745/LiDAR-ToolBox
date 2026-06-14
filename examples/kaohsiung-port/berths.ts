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
      const t = lens[i] === 0 ? 0 : Math.min(1, target / lens[i]);
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
