import { describe, it, expect } from 'vitest';
import { parseAisFeature, parseAisTime } from '../examples/kaohsiung-port/data/ais';

const feature = (props: Record<string, unknown>, coords: [number, number] = [120.30, 22.60]) => ({
  type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: props,
});

describe('parseAisTime', () => {
  it('parses UTC+8 "YYYY-MM-DD HH:mm:ss" to epoch ms', () => {
    // 2026-02-18 08:00:00 (Taipei) === 2026-02-18 00:00:00 UTC
    expect(parseAisTime('2026-02-18 08:00:00')).toBe(Date.UTC(2026, 1, 18, 0, 0, 0));
  });
  it('parses epoch-second numbers', () => {
    expect(parseAisTime(1771300800)).toBe(1771300800 * 1000);
  });
  it('returns null on garbage', () => {
    expect(parseAisTime('not-a-date')).toBeNull();
    expect(parseAisTime('')).toBeNull();
  });
});

describe('parseAisFeature', () => {
  it('reads lon/lat from geometry and core fields from properties', () => {
    const p = parseAisFeature(feature({
      MMSI: '416000123', SHIPNAME: 'EVER GIVEN', TYPE: 70, SOG: 12.3, COG: 181.2,
      HEADING: 180, IMO: '9811000', CALLSIGN: 'BMXX', LASTTIME: '2026-02-18 08:00:00',
    }));
    expect(p).not.toBeNull();
    expect(p!.mmsi).toBe('416000123');
    expect(p!.lat).toBeCloseTo(22.60);
    expect(p!.lon).toBeCloseTo(120.30);
    expect(p!.aisType).toBe(70);
    expect(p!.sogKn).toBeCloseTo(12.3);
    expect(p!.headingDeg).toBe(180);
    expect(p!.imo).toBe('9811000');
    expect(p!.recordedAtMs).toBe(Date.UTC(2026, 1, 18, 0, 0, 0));
  });
  it('tolerates missing optional fields with safe defaults', () => {
    const p = parseAisFeature(feature({ MMSI: '999' }));
    expect(p!.sogKn).toBe(0);
    expect(p!.cogDeg).toBe(-1);
    expect(p!.headingDeg).toBe(-1);
    expect(p!.aisType).toBe(0);
    expect(p!.name).toBe('');
  });
  it('returns null when MMSI or coordinates are absent', () => {
    expect(parseAisFeature(feature({ SHIPNAME: 'x' }, undefined as any))).toBeNull();
    expect(parseAisFeature({ type: 'Feature', geometry: null, properties: { MMSI: '1' } } as any)).toBeNull();
  });
});
