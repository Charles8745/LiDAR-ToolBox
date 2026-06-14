import { describe, it, expect } from 'vitest';
import { createProjection, KAOHSIUNG_ORIGIN } from '../examples/kaohsiung-port/geo/projection';

describe('createProjection', () => {
  const proj = createProjection(KAOHSIUNG_ORIGIN.lat, KAOHSIUNG_ORIGIN.lon, 0.01);

  it('maps the origin to (0,0)', () => {
    const w = proj.toWorld(KAOHSIUNG_ORIGIN.lat, KAOHSIUNG_ORIGIN.lon);
    expect(w.x).toBeCloseTo(0); expect(w.z).toBeCloseTo(0);
  });

  it('places north as -z and east as +x', () => {
    const north = proj.toWorld(KAOHSIUNG_ORIGIN.lat + 0.01, KAOHSIUNG_ORIGIN.lon);
    const east = proj.toWorld(KAOHSIUNG_ORIGIN.lat, KAOHSIUNG_ORIGIN.lon + 0.01);
    expect(north.z).toBeLessThan(0);
    expect(east.x).toBeGreaterThan(0);
  });

  it('applies scale (1 deg lat ≈ 1113.2 units at scale 0.01)', () => {
    const p = proj.toWorld(KAOHSIUNG_ORIGIN.lat + 1, KAOHSIUNG_ORIGIN.lon);
    expect(Math.abs(p.z)).toBeCloseTo(111320 * 0.01, 0);
  });
});
