import type { World } from '../geo/projection';
import { toTemplate, placeModelPoints, type ShipModelTemplate } from './shipModels';
import { craneBoomHeading, type Seg, type CraneOrientOpts } from './orient';
import craneJson from '../data/ship-models/起重機.json';
import tankJson from '../data/ship-models/儲槽.json';
import craneOrient from '../data/crane-orient.json';

// Baked landmark templates keyed by modelKey (carved by `npm run port:scan-views`).
const RAW: Record<string, { points: number[] }> = { crane: craneJson, 儲槽: tankJson };
// Baked per-instance boom headings (water-side from the aerial basemap; `npm run port:crane-orient`),
// in the same order as the layer's source points. Authoritative orientation — see buildModelInstances.
const ORIENT: Record<string, number[]> = { crane: craneOrient.headings };

const cache = new Map<string, ShipModelTemplate>();
export function loadLandmarkModel(key: string): ShipModelTemplate | null {
  const raw = RAW[key];
  if (!raw) return null;
  let t = cache.get(key);
  if (!t) { t = toTemplate(raw); cache.set(key, t); }
  return t;
}

/** Baked boom headings for a landmark model, or null if none baked. */
export function loadLandmarkOrient(key: string): number[] | null {
  return ORIENT[key] ?? null;
}

/** Place one unit template at each center: uniform-scale by scaleU, rotate boom (+x) to its heading,
 *  lift by baseY. Returns a flat xyz array. Heading precedence per instance i:
 *   1. overrides[i] (manual escape hatch) → craneBoomHeading with that water-side sign;
 *   2. baked headings[i] (authoritative aerial-basemap water-side; see fetch-crane-orient.ts);
 *   3. craneBoomHeading auto (OSM land-density fallback — unreliable in narrow harbours). */
export function buildModelInstances(
  tpl: ShipModelTemplate, centers: World[], segs: Seg[], land: World[],
  opts: CraneOrientOpts, scaleU: number, baseY: number,
  overrides?: Record<number, 1 | -1>, headings?: number[],
): number[] {
  const out: number[] = [];
  for (let i = 0; i < centers.length; i++) {
    const c = centers[i];
    let h: number;
    if (overrides && overrides[i] !== undefined) h = craneBoomHeading(c, segs, land, opts, overrides[i]);
    else if (headings && Number.isFinite(headings[i])) h = headings[i];
    else h = craneBoomHeading(c, segs, land, opts);
    // values are regenerated as a constant 0.5 fill by buildLayers (single-colour layer) → pass 0.5.
    const b = placeModelPoints(tpl, c, h, scaleU, baseY, 0.5);
    for (let j = 0; j < b.positions.length; j++) out.push(b.positions[j]);
  }
  return out;
}

/** 模板點雲在水平面(x,z)的最大半徑;至少回 1 避免除零。用來把 unit 模板縮到真實 footprint 半徑。 */
export function templateHorizontalRadius(tpl: ShipModelTemplate): number {
  const p = tpl.points;
  let max = 0;
  for (let i = 0; i < p.length; i += 3) {
    const r = Math.hypot(p[i], p[i + 2]);
    if (r > max) max = r;
  }
  return max || 1;
}

/** 把 unit 模板放到每個 center,以 scales[i] 均勻縮放、不旋轉(heading 0,徑向對稱地物用)、貼 baseY。
 *  回傳 flat xyz。與 buildModelInstances 平行,但每座獨立縮放且免定向。 */
export function buildScaledInstances(
  tpl: ShipModelTemplate, centers: World[], scales: number[], baseY: number,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < centers.length; i++) {
    const b = placeModelPoints(tpl, centers[i], 0, scales[i], baseY, 0.5);
    for (let j = 0; j < b.positions.length; j++) out.push(b.positions[j]);
  }
  return out;
}
