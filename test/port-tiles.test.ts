import { describe, it, expect } from 'vitest';
import { lonLatToTile, tileToLonLat, tileRangeForBbox, compositeBounds, TILE_SIZE } from '../examples/kaohsiung-port/geo/tiles';

describe('tileToLonLat', () => {
  it('maps tile (0,0) at z0 to the Web-Mercator NW corner (-180, ~85.0511)', () => {
    const c = tileToLonLat(0, 0, 0);
    expect(c.lon).toBeCloseTo(-180, 6);
    expect(c.lat).toBeCloseTo(85.0511, 3);
  });
});

describe('lonLatToTile', () => {
  it('floors to the containing tile (z=1 quadrants)', () => {
    expect(lonLatToTile(-90, 45, 1)).toEqual({ x: 0, y: 0 }); // NW
    expect(lonLatToTile(90, -45, 1)).toEqual({ x: 1, y: 1 });  // SE
  });

  it('round-trips: the containing tile brackets the point (NW≤pt<SE)', () => {
    const pts = [
      { lon: 120.30, lat: 22.59 },
      { lon: 120.24, lat: 22.64 },
      { lon: 120.34, lat: 22.53 },
    ];
    for (const z of [12, 15, 16]) {
      for (const p of pts) {
        const t = lonLatToTile(p.lon, p.lat, z);
        const nw = tileToLonLat(t.x, t.y, z);
        const se = tileToLonLat(t.x + 1, t.y + 1, z);
        expect(nw.lon).toBeLessThanOrEqual(p.lon);
        expect(se.lon).toBeGreaterThan(p.lon);
        expect(nw.lat).toBeGreaterThanOrEqual(p.lat);
        expect(se.lat).toBeLessThan(p.lat);
      }
    }
  });
});

const BBOX = { s: 22.53, w: 120.24, n: 22.64, e: 120.34 };

describe('tileRangeForBbox', () => {
  it('orders the range (xMin≤xMax, yMin≤yMax)', () => {
    const r = tileRangeForBbox(BBOX, 15);
    expect(r.xMin).toBeLessThanOrEqual(r.xMax);
    expect(r.yMin).toBeLessThanOrEqual(r.yMax);
  });

  it('covers all four bbox corners at z15', () => {
    const z = 15;
    const r = tileRangeForBbox(BBOX, z);
    const corners = [
      { lon: BBOX.w, lat: BBOX.n }, { lon: BBOX.e, lat: BBOX.n },
      { lon: BBOX.w, lat: BBOX.s }, { lon: BBOX.e, lat: BBOX.s },
    ];
    for (const c of corners) {
      const t = lonLatToTile(c.lon, c.lat, z);
      expect(t.x).toBeGreaterThanOrEqual(r.xMin);
      expect(t.x).toBeLessThanOrEqual(r.xMax);
      expect(t.y).toBeGreaterThanOrEqual(r.yMin);
      expect(t.y).toBeLessThanOrEqual(r.yMax);
    }
  });
});

describe('compositeBounds', () => {
  it('fully contains the bbox and sizes pixels by tile count', () => {
    const z = 15;
    const r = tileRangeForBbox(BBOX, z);
    const c = compositeBounds(r, z);
    expect(c.bounds.w).toBeLessThanOrEqual(BBOX.w);
    expect(c.bounds.e).toBeGreaterThanOrEqual(BBOX.e);
    expect(c.bounds.n).toBeGreaterThanOrEqual(BBOX.n);
    expect(c.bounds.s).toBeLessThanOrEqual(BBOX.s);
    expect(c.sizePx.w).toBe((r.xMax - r.xMin + 1) * TILE_SIZE);
    expect(c.sizePx.h).toBe((r.yMax - r.yMin + 1) * TILE_SIZE);
  });
});
