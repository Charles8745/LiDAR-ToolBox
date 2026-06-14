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
