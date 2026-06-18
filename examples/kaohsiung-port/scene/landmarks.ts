import type { World } from '../geo/projection';

/** Centroid + mean radius of a footprint polygon (world coords). */
export function footprintCentroidRadius(poly: World[]): { center: World; radius: number } {
  const n = poly.length;
  if (n === 0) return { center: { x: 0, z: 0 }, radius: 0 };
  let sx = 0, sz = 0;
  for (const p of poly) { sx += p.x; sz += p.z; }
  const center = { x: sx / n, z: sz / n };
  let sr = 0;
  for (const p of poly) sr += Math.hypot(p.x - center.x, p.z - center.z);
  return { center, radius: sr / n };
}

/** Vertical cylinder shell of points: `rings` levels from baseY to baseY+height, `perRing` points each. */
export function sampleCylinderShell(
  center: World, radius: number, baseY: number, height: number, rings: number, perRing: number,
): number[] {
  const out: number[] = [];
  const R = Math.max(radius, 1e-4);
  const levels = Math.max(2, rings);
  for (let r = 0; r < levels; r++) {
    const y = baseY + (height * r) / (levels - 1);
    for (let k = 0; k < perRing; k++) {
      const a = (k / perRing) * Math.PI * 2;
      out.push(center.x + R * Math.cos(a), y, center.z + R * Math.sin(a));
    }
  }
  return out;
}
