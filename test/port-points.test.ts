import { describe, it, expect } from 'vitest';
import { samplePolyline, sampleShipFootprint, buildShipLayer } from '../examples/kaohsiung-port/scene/portPoints';
import { valueFor, shipCategoryIndex, SHIP_CATEGORY_COLORS } from '../examples/kaohsiung-port/palette';
import type { VesselRecord } from '../examples/kaohsiung-port/data/twport';

const idProj = { toWorld: (lat: number, lon: number) => ({ x: lon, z: lat }) };

describe('samplePolyline', () => {
  it('includes both endpoints and intermediate points by spacing', () => {
    const pts = samplePolyline([{ x: 0, z: 0 }, { x: 10, z: 0 }], 2);
    expect(pts[0]).toEqual({ x: 0, z: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 10, z: 0 });
    expect(pts.length).toBe(6); // 0,2,4,6,8,10
  });
});

describe('sampleShipFootprint', () => {
  it('fills a centered grid of (nl+1)*(nw+1) points', () => {
    const pts = sampleShipFootprint({ x: 0, z: 0 }, 10, 4, 0, 2); // nl=5, nw=2 → 6*3=18
    expect(pts.length).toBe(18);
    for (const p of pts) { expect(Math.abs(p.x)).toBeLessThanOrEqual(5.01); expect(Math.abs(p.z)).toBeLessThanOrEqual(2.01); }
  });
});

describe('buildShipLayer', () => {
  it('emits xyz triples valued by ship type', () => {
    const v: VesselRecord = { visaNo: '', nameZh: 'A', nameEn: '', shipType: '全貨櫃船', wharfName: '#50碼頭',
      berthNo: 50, status: '', etaMs: null, etdMs: null, actPortMs: 0, leaveMs: null, beforePort: '', nextPort: '',
      imo: '', callSign: '', source: 'berthing' };
    const batch = buildShipLayer([v], idProj as any, 1, 'type', 5);
    expect(batch.positions.length % 3).toBe(0);
    expect(batch.values.length).toBeGreaterThan(0);
    expect(batch.values[0]).toBeCloseTo(valueFor(shipCategoryIndex('全貨櫃船'), SHIP_CATEGORY_COLORS.length));
  });
});
