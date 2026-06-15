import { describe, it, expect } from 'vitest';
import { lonLatToTile, tileToLonLat } from '../examples/kaohsiung-port/geo/tiles';

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
