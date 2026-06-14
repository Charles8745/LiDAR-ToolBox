import { describe, it, expect } from 'vitest';
import { berthPositionLatLon, resolveBerthLatLon, sampleAlong, MIN_BERTH, MAX_BERTH } from '../examples/kaohsiung-port/berths';

describe('sampleAlong', () => {
  const line = [{ lat: 0, lon: 0 }, { lat: 0, lon: 10 }];
  it('returns endpoints at frac 0 and 1', () => {
    expect(sampleAlong(line, 0)).toEqual({ lat: 0, lon: 0 });
    expect(sampleAlong(line, 1)).toEqual({ lat: 0, lon: 10 });
  });
  it('interpolates the midpoint at frac 0.5', () => {
    const m = sampleAlong(line, 0.5);
    expect(m.lon).toBeCloseTo(5);
  });
  it('returns the lone point for a single-point line', () => {
    expect(sampleAlong([{ lat: 3, lon: 4 }], 0.7)).toEqual({ lat: 3, lon: 4 });
  });
});

describe('berthPositionLatLon', () => {
  it('maps the first/last berths to the ends of the berth line', () => {
    const first = berthPositionLatLon(MIN_BERTH);
    const last = berthPositionLatLon(MAX_BERTH);
    expect(first.lat).toBeGreaterThan(last.lat); // berths run north → south
  });
  it('is monotonic in latitude as berth number grows', () => {
    expect(berthPositionLatLon(20).lat).toBeGreaterThan(berthPositionLatLon(100).lat);
  });
});

describe('resolveBerthLatLon', () => {
  it('returns a stable outer-zone position for null berthNo', () => {
    const a = resolveBerthLatLon({ berthNo: null, wharfName: '二港口港外' } as any);
    const b = resolveBerthLatLon({ berthNo: null, wharfName: '二港口港外' } as any);
    expect(a).toEqual(b);
  });
  it('delegates a numbered berth to berthPositionLatLon', () => {
    expect(resolveBerthLatLon({ berthNo: 50, wharfName: '#50碼頭' } as any)).toEqual(berthPositionLatLon(50));
  });
});
