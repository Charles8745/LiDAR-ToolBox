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

interface P3 { x: number; y: number; z: number; }
function linePts(a: P3, b: P3, spacing: number, out: number[]): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const steps = Math.max(1, Math.round(len / spacing));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    out.push(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
  }
}

/** Stylized container-gantry skeleton of points at `center`, base on baseY, boom along +x. */
export function sampleGantry(
  center: World, baseY: number,
  opts: { legHeight: number; baseW: number; baseD: number; boomLen: number; spacing: number },
): number[] {
  const { legHeight, baseW, baseD, boomLen, spacing } = opts;
  const hw = baseW / 2, hd = baseD / 2;
  const top = baseY + legHeight;
  const out: number[] = [];
  const corners = [
    { x: center.x - hw, z: center.z - hd },
    { x: center.x + hw, z: center.z - hd },
    { x: center.x + hw, z: center.z + hd },
    { x: center.x - hw, z: center.z + hd },
  ];
  for (const c of corners) linePts({ x: c.x, y: baseY, z: c.z }, { x: c.x, y: top, z: c.z }, spacing, out); // 4 legs
  for (let i = 0; i < 4; i++) {                                                                              // top frame
    const a = corners[i], b = corners[(i + 1) % 4];
    linePts({ x: a.x, y: top, z: a.z }, { x: b.x, y: top, z: b.z }, spacing, out);
  }
  linePts({ x: center.x - hw, y: top, z: center.z }, { x: center.x + hw + boomLen, y: top, z: center.z }, spacing, out); // boom +x
  return out;
}
