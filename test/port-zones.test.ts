import { describe, it, expect } from 'vitest';
import {
  PORT_ZONES, DEFAULT_BANDS, tierOpacity, berthDeclutterVisible, type LodBands,
} from '../examples/kaohsiung-port/scene/portZones';

const BBOX = { n: 22.644432, s: 22.522706, w: 120.234375, e: 120.344238 };

describe('PORT_ZONES', () => {
  it('has 13 zones (4 district + 9 terminal) with unique labels in bbox', () => {
    expect(PORT_ZONES.length).toBe(13);
    expect(PORT_ZONES.filter((z) => z.tier === 'district').length).toBe(4);
    expect(PORT_ZONES.filter((z) => z.tier === 'terminal').length).toBe(9);
    const labels = new Set(PORT_ZONES.map((z) => z.label));
    expect(labels.size).toBe(13);
    for (const z of PORT_ZONES) {
      expect(z.label.length).toBeGreaterThan(0);
      expect(z.lat).toBeGreaterThanOrEqual(BBOX.s);
      expect(z.lat).toBeLessThanOrEqual(BBOX.n);
      expect(z.lon).toBeGreaterThanOrEqual(BBOX.w);
      expect(z.lon).toBeLessThanOrEqual(BBOX.e);
    }
  });
});

describe('tierOpacity', () => {
  it('is 0 outside the band and ramps within fade edges', () => {
    const b: LodBands = { district: [100, 150, 1e9, 1e9], terminal: [40, 70, 170, 220], berth: [0, 0, 55, 90] };
    expect(tierOpacity('terminal', 30, b)).toBe(0);        // before fadeInStart
    expect(tierOpacity('terminal', 55, b)).toBeCloseTo(0.5, 1); // mid fade-in (40→70)
    expect(tierOpacity('terminal', 120, b)).toBe(1);       // full plateau
    expect(tierOpacity('terminal', 195, b)).toBeCloseTo(0.5, 1); // mid fade-out (170→220)
    expect(tierOpacity('terminal', 240, b)).toBe(0);       // after fadeOutEnd
  });
  it('berth tier is full near 0 and gone past its fade-out', () => {
    expect(tierOpacity('berth', 10, DEFAULT_BANDS)).toBe(1);
    expect(tierOpacity('berth', 1000, DEFAULT_BANDS)).toBe(0);
  });
  it('DEFAULT_BANDS leave no dead zone: some tier > 0 at every distance', () => {
    for (let d = 0; d <= 400; d += 5) {
      const total = tierOpacity('district', d, DEFAULT_BANDS)
        + tierOpacity('terminal', d, DEFAULT_BANDS)
        + tierOpacity('berth', d, DEFAULT_BANDS);
      expect(total).toBeGreaterThan(0);
    }
  });
});

describe('berthDeclutterVisible', () => {
  it('hides labels farther than nearRadius from the camera', () => {
    expect(berthDeclutterVisible(30, 60)).toBe(true);
    expect(berthDeclutterVisible(90, 60)).toBe(false);
  });
});
