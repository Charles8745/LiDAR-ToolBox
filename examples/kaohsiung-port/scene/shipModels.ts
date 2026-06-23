import type { World } from '../geo/projection';
import type { ShipCategory } from '../palette';
import { SHIP_CATEGORIES } from '../palette';
import type { PointBatch } from './portPoints';
import containerJson from '../data/ship-models/貨櫃.json';
import oilJson from '../data/ship-models/油品.json';
import bulkJson from '../data/ship-models/散雜.json';
import lngJson from '../data/ship-models/LNG.json';
import tugJson from '../data/ship-models/工作.json';
import warshipJson from '../data/ship-models/軍艦.json';
import cruiseJson from '../data/ship-models/客運.json';

/** Unit-space model: long axis +x (length 1), x/z centered, min-y=0. Geometry only. */
export interface ShipModelTemplate { points: Float32Array }

export function toTemplate(raw: { points: number[] }): ShipModelTemplate {
  return { points: new Float32Array(raw.points) };
}

/**
 * Expand a unit template into world points for one ship: uniform-scale every axis by
 * `lengthU` (= the ship's LOA in world units), rotate the long axis (+x) to (cos h, sin h)
 * matching sampleShipFootprint, lift by baseY (template min-y=0 → rests on water).
 */
export function placeModelPoints(
  tpl: ShipModelTemplate, center: World, headingRad: number, lengthU: number, baseY: number, v01: number,
): PointBatch {
  const src = tpl.points;
  const n = src.length / 3;
  const positions = new Float32Array(n * 3);
  const values = new Float32Array(n);
  const cos = Math.cos(headingRad), sin = Math.sin(headingRad);
  for (let i = 0; i < n; i++) {
    const mx = src[i * 3] * lengthU;
    const my = src[i * 3 + 1] * lengthU;
    const mz = src[i * 3 + 2] * lengthU;
    positions[i * 3] = center.x + mx * cos - mz * sin;
    positions[i * 3 + 1] = baseY + my;
    positions[i * 3 + 2] = center.z + mx * sin + mz * cos;
    values[i] = v01;
  }
  return { positions, values };
}

// ── Registry ──────────────────────────────────────────────────────────────
// Baked templates keyed by category. To enable a model:
//   1. drop data/models/<name>.glb, run `npm run port:models`
//   2. import the JSON below and map the category to it.
// e.g.  import containerJson from '../data/ship-models/貨櫃.json';
const RAW: Partial<Record<ShipCategory, { points: number[] }>> = {
  貨櫃: containerJson,
  油品: oilJson,
  散雜: bulkJson,
  LNG: lngJson,
  工作: tugJson,
  軍艦: warshipJson,
  客運: cruiseJson,
  // 其他: 無模型 → 平面 footprint fallback
};

export const CATEGORY_MODEL_KEYS: Record<ShipCategory, string | null> = Object.fromEntries(
  SHIP_CATEGORIES.map((c) => [c, RAW[c] ? c : null]),
) as Record<ShipCategory, string | null>;

const cache = new Map<ShipCategory, ShipModelTemplate>();
export function loadShipModel(category: ShipCategory): ShipModelTemplate | null {
  const raw = RAW[category];
  if (!raw) return null;
  let t = cache.get(category);
  if (!t) { t = toTemplate(raw); cache.set(category, t); }
  return t;
}
