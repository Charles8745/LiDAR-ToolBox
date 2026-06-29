import type { World } from '../geo/projection';
import { toTemplate, placeModelPoints, type ShipModelTemplate } from './shipModels';
import { craneBoomHeading, type Seg, type CraneOrientOpts } from './orient';

// Baked landmark templates keyed by modelKey. Empty until Task 5 wires the carved JSON:
//   import craneJson from '../data/ship-models/起重機.json';
//   const RAW = { crane: craneJson };
const RAW: Record<string, { points: number[] }> = {};

const cache = new Map<string, ShipModelTemplate>();
export function loadLandmarkModel(key: string): ShipModelTemplate | null {
  const raw = RAW[key];
  if (!raw) return null;
  let t = cache.get(key);
  if (!t) { t = toTemplate(raw); cache.set(key, t); }
  return t;
}

/** Place one unit template at each center: uniform-scale by scaleU, rotate boom (+x) to the
 *  pier-perpendicular-toward-water heading, lift by baseY. Returns a flat xyz array. */
export function buildModelInstances(
  tpl: ShipModelTemplate, centers: World[], segs: Seg[], land: World[],
  opts: CraneOrientOpts, scaleU: number, baseY: number,
  overrides?: Record<number, 1 | -1>,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < centers.length; i++) {
    const c = centers[i];
    const h = craneBoomHeading(c, segs, land, opts, overrides?.[i]);
    // values are regenerated as a constant 0.5 fill by buildLayers (single-colour layer) → pass 0.5.
    const b = placeModelPoints(tpl, c, h, scaleU, baseY, 0.5);
    for (let j = 0; j < b.positions.length; j++) out.push(b.positions[j]);
  }
  return out;
}
