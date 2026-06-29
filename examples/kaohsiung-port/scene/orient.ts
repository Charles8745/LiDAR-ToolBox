// examples/kaohsiung-port/scene/orient.ts
import type { Projection, World } from '../geo/projection';
import type { OsmGeometry, Polyline, LatLon } from '../data/osm';

export interface Seg { ax: number; az: number; bx: number; bz: number; }
export interface CraneOrientOpts { stepU: number; probeR: number; }

const toWorld = (proj: Projection, ll: LatLon): World => proj.toWorld(ll.lat, ll.lon);

/** Flatten OSM pier polylines into world-space line segments. */
export function buildPierSegs(piers: Polyline[], proj: Projection): Seg[] {
  const segs: Seg[] = [];
  for (const poly of piers) {
    const w = poly.map((ll) => toWorld(proj, ll));
    for (let i = 0; i < w.length - 1; i++) segs.push({ ax: w[i].x, az: w[i].z, bx: w[i + 1].x, bz: w[i + 1].z });
  }
  return segs;
}

/** Nearest pier segment: tangent heading (atan2(dz,dx)) and perpendicular distance (world units). */
export function nearestPierTangent(x: number, z: number, segs: Seg[]): { headingRad: number; distU: number } {
  let bestD = Infinity, h = 0;
  for (const s of segs) {
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    const len2 = dx * dx + dz * dz || 1e-9;
    const tt = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / len2));
    const px = s.ax + dx * tt, pz = s.az + dz * tt;
    const d = (x - px) ** 2 + (z - pz) ** 2;
    if (d < bestD) { bestD = d; h = Math.atan2(dz, dx); }
  }
  return { headingRad: h, distU: Math.sqrt(bestD) };
}

/** World-space vertices of the "land" features (coastline + piers + tanks + breakwater). */
export function collectLandPoints(osm: OsmGeometry, proj: Projection): World[] {
  const out: World[] = [];
  const add = (polys: Polyline[]): void => { for (const poly of polys) for (const ll of poly) out.push(toWorld(proj, ll)); };
  add(osm.coastline); add(osm.piers); add(osm.breakwater); add(osm.tanks);
  return out;
}

/** Of the two pier-perpendiculars, the one whose δ-endpoint has FEWER nearby land features = water.
 *  Tie → +1 (caller may force via override). */
export function waterSideSign(center: World, tangentRad: number, land: World[], opts: CraneOrientOpts): 1 | -1 {
  const r2 = opts.probeR * opts.probeR;
  const count = (s: 1 | -1): number => {
    const h = tangentRad + s * (Math.PI / 2);
    const ex = center.x + Math.cos(h) * opts.stepU;
    const ez = center.z + Math.sin(h) * opts.stepU;
    let c = 0;
    for (const p of land) if ((p.x - ex) ** 2 + (p.z - ez) ** 2 <= r2) c++;
    return c;
  };
  const cPlus = count(1), cMinus = count(-1);
  if (cPlus === cMinus) return 1;
  return cPlus < cMinus ? 1 : -1;
}

/** Boom heading = nearest-pier tangent ± 90° toward water (or an explicit override sign). */
export function craneBoomHeading(
  center: World, segs: Seg[], land: World[], opts: CraneOrientOpts, override?: 1 | -1,
): number {
  const { headingRad: tangent } = nearestPierTangent(center.x, center.z, segs);
  const sign = override ?? waterSideSign(center, tangent, land, opts);
  return tangent + sign * (Math.PI / 2);
}
