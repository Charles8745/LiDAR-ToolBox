import type { AisTrack } from '../data/ais';
import { inKaohsiungBBox } from '../data/ais';

export interface ResolvedPos { lat: number; lon: number; headingDeg: number; }

/** Shortest-arc angular interpolation in degrees, result in [0,360). */
export function lerpAngleDeg(a: number, b: number, t: number): number {
  let d = ((b - a + 540) % 360) - 180; // [-180,180)
  return ((a + d * t) % 360 + 360) % 360;
}

/** Bearing from point A→B in degrees (0=N, clockwise), using local equirectangular. */
function bearingDeg(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const mPerDegLon = Math.cos((aLat * Math.PI) / 180);
  const east = (bLon - aLon) * mPerDegLon;
  const north = bLat - aLat;
  return (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
}

/** Interpolated position+heading at time tMs, or null if tMs is outside the track. */
export function positionAt(track: AisTrack, tMs: number): ResolvedPos | null {
  const p = track.path;
  if (p.length === 0) return null;
  if (p.length === 1) return tMs === p[0][2] ? { lat: p[0][0], lon: p[0][1], headingDeg: p[0][3] < 0 ? 0 : p[0][3] } : null;
  if (tMs < p[0][2] || tMs > p[p.length - 1][2]) return null;
  // 找夾住 t 的兩點
  let i = 0;
  while (i < p.length - 1 && p[i + 1][2] < tMs) i++;
  const a = p[i], b = p[i + 1] ?? a;
  const span = b[2] - a[2];
  const f = span > 0 ? (tMs - a[2]) / span : 0;
  const lat = a[0] + (b[0] - a[0]) * f;
  const lon = a[1] + (b[1] - a[1]) * f;
  // heading 優先序:兩端皆有 AIS heading → 最短弧插值;否則用 A→B 方位角。
  let headingDeg: number;
  if (a[3] >= 0 && b[3] >= 0) headingDeg = lerpAngleDeg(a[3], b[3], f);
  else if (a[3] >= 0) headingDeg = a[3];
  else if (b[3] >= 0) headingDeg = b[3];
  else headingDeg = bearingDeg(a[0], a[1], b[0], b[1]);
  return { lat, lon, headingDeg };
}

/** Real path points in [tMs-windowMs, tMs], each as [lat, lon, age01] (0=newest,1=oldest). */
export function trailPointsAt(track: AisTrack, tMs: number, windowMs: number): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (const p of track.path) {
    if (p[2] > tMs || p[2] < tMs - windowMs) continue;
    const age01 = windowMs > 0 ? (tMs - p[2]) / windowMs : 0;
    out.push([p[0], p[1], age01]);
  }
  return out;
}

/** Count tracks whose interpolated position at tMs is inside the KHH bbox. */
export function vesselsInPortAt(tracks: AisTrack[], tMs: number): number {
  let n = 0;
  for (const t of tracks) {
    const p = positionAt(t, tMs);
    if (p && inKaohsiungBBox(p.lat, p.lon)) n++;
  }
  return n;
}

/** Tracks that are outside the bbox at tMs but enter it within (tMs, tMs+windowMs]. */
export function incomingAt(tracks: AisTrack[], tMs: number, windowMs: number): AisTrack[] {
  const out: AisTrack[] = [];
  for (const t of tracks) {
    const now = positionAt(t, tMs);
    if (now && inKaohsiungBBox(now.lat, now.lon)) continue; // 已在港
    // 掃描窗內的真實 path 點,看是否進入 bbox
    const entered = t.path.some((p) => p[2] > tMs && p[2] <= tMs + windowMs && inKaohsiungBBox(p[0], p[1]));
    if (entered) out.push(t);
  }
  return out;
}
