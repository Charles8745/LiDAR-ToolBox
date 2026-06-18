import { describe, it, expect } from 'vitest';
import { lerpAngleDeg, positionAt, trailPointsAt } from '../examples/kaohsiung-port/time/ais-replay';
import type { AisTrack } from '../examples/kaohsiung-port/data/ais';

const track = (path: [number, number, number, number][]): AisTrack =>
  ({ mmsi: 'A', imo: '', callSign: '', name: '', aisType: 0, path });

describe('lerpAngleDeg', () => {
  it('takes the shortest arc across the 0/360 wrap', () => {
    expect(lerpAngleDeg(350, 10, 0.5)).toBeCloseTo(0);   // 不是 180
    expect(lerpAngleDeg(10, 350, 0.5)).toBeCloseTo(0);
    expect(lerpAngleDeg(0, 90, 0.5)).toBeCloseTo(45);
  });
});

describe('positionAt', () => {
  const t = track([[22.60, 120.30, 1000, 90], [22.62, 120.34, 3000, 90]]);
  it('interpolates lat/lon at a mid time', () => {
    const p = positionAt(t, 2000)!;
    expect(p.lat).toBeCloseTo(22.61);
    expect(p.lon).toBeCloseTo(120.32);
  });
  it('returns null outside the track time range', () => {
    expect(positionAt(t, 500)).toBeNull();
    expect(positionAt(t, 9999)).toBeNull();
  });
  it('uses AIS heading when path points carry it', () => {
    expect(positionAt(t, 2000)!.headingDeg).toBeCloseTo(90);
  });
  it('falls back to bearing between points when heading is absent (-1)', () => {
    const t2 = track([[22.60, 120.30, 0, -1], [22.70, 120.30, 1000, -1]]); // 正北
    const h = positionAt(t2, 500)!.headingDeg;
    expect(h).toBeCloseTo(0, 0); // 約 0° (北)
  });
  it('single-point track resolves only at that exact time', () => {
    const t3 = track([[22.6, 120.3, 1000, 45]]);
    expect(positionAt(t3, 1000)!.lat).toBeCloseTo(22.6);
    expect(positionAt(t3, 1001)).toBeNull();
  });
});

describe('trailPointsAt', () => {
  const t = track([
    [22.60, 120.30, 0, 90], [22.61, 120.31, 60_000, 90],
    [22.62, 120.32, 120_000, 90], [22.63, 120.33, 180_000, 90],
  ]);
  it('returns real path points within the trailing window, with age01', () => {
    const trail = trailPointsAt(t, 180_000, 120_000); // 最近 2 分鐘
    expect(trail.length).toBe(3); // t=60k,120k,180k
    // 最舊點 age01≈1,最新點 age01≈0
    expect(trail[0][2]).toBeCloseTo(1, 1);
    expect(trail[trail.length - 1][2]).toBeCloseTo(0, 1);
  });
  it('is empty for a stationary single-sample-in-window vessel beyond window', () => {
    expect(trailPointsAt(t, 0, 120_000).length).toBeLessThanOrEqual(1);
  });
});
