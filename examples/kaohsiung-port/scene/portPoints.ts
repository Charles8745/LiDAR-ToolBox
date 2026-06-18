import type { World, Projection } from '../geo/projection';
import type { VesselRecord } from '../data/twport';
import { resolveBerthLatLon } from '../berths';
import { SHIP_CATEGORY_COLORS, STATUS_COLORS, SHIP_CATEGORIES, shipCategoryIndex, statusIndex, valueFor } from '../palette';
import type { ShipCategory } from '../palette';

export interface PointBatch { positions: Float32Array; values: Float32Array; }

const Y_SHIP = 0.5;

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

// Keyed by ShipCategory so a category reorder/addition is caught at compile time.
const TYPE_DIMS_M = {
  '貨櫃': { loa: 300, beam: 45 },
  '油品': { loa: 250, beam: 44 },
  '散雜': { loa: 180, beam: 30 },
  'LNG': { loa: 290, beam: 49 },
  '工作': { loa: 40, beam: 12 },
  '軍艦': { loa: 130, beam: 16 },
  '客運': { loa: 200, beam: 32 },
  '其他': { loa: 120, beam: 20 },
} satisfies Record<ShipCategory, { loa: number; beam: number }>;

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
    const dim = TYPE_DIMS_M[SHIP_CATEGORIES[catIdx]];
    const pts = sampleShipFootprint(c, dim.loa * scale, dim.beam * scale, 0, spacing);
    const v01 = colorBy === 'type' ? valueFor(catIdx, SHIP_CATEGORY_COLORS.length) : statusVal;
    for (const p of pts) { pos.push(p.x, Y_SHIP, p.z); val.push(v01); }
    centers.push({ vessel: v, x: c.x, y: Y_SHIP, z: c.z });
  }
  return { positions: new Float32Array(pos), values: new Float32Array(val), centers };
}
