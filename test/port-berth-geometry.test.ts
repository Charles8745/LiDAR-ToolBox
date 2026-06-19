import { describe, it, expect } from 'vitest';
import { parseGetMarker, upsertBerths, filterToBbox, type BerthMarker, type Bbox } from '../examples/kaohsiung-port/data/berthGeometry';

// 取自實測 GetMarker 的精簡 fixture(d.v 數筆)。
const RAW = {
  v: [
    { PIER: '1001', LAT1: 22.61872, LONG1: 120.27507, LAT2: 22.61756, LONG2: 120.27938, ANGLE: 166, SP_NAME: '立揚' },
    { PIER: '1001', LAT1: 22.61872, LONG1: 120.27507, LAT2: 22.61756, LONG2: 120.27938, ANGLE: 166, SP_NAME: '後到的船' }, // 同碼頭 → latest-wins
    { PIER: '0003', LAT1: 22.61788, LONG1: 120.28504, LAT2: 22.61847, LONG2: 120.28378, ANGLE: 207, SP_NAME: '嶼戀' },
    { PIER: '   ', LAT1: 22.6, LONG1: 120.3, LAT2: 22.6, LONG2: 120.3, ANGLE: 0, SP_NAME: 'x' }, // 空 code → 跳過
    { PIER: '9999', LAT1: null, LONG1: null, LAT2: null, LONG2: null, ANGLE: 0, SP_NAME: 'y' }, // 無座標 → 跳過
  ],
};

describe('parseGetMarker', () => {
  it('returns distinct berths by PIER with midpoint coords, skipping invalid', () => {
    const out = parseGetMarker(RAW);
    expect(out.length).toBe(2);
    const b1 = out.find((b) => b.code === '1001')!;
    expect(b1.lat).toBeCloseTo((22.61872 + 22.61756) / 2, 5);
    expect(b1.lon).toBeCloseTo((120.27507 + 120.27938) / 2, 5);
    expect(b1.angle).toBe(166);
    expect(b1.nameZh).toBe('後到的船'); // latest-wins
  });
  it('handles empty/missing v', () => {
    expect(parseGetMarker({}).length).toBe(0);
    expect(parseGetMarker({ v: [] }).length).toBe(0);
  });
  it('falls back to endpoint 1 when endpoint 2 missing', () => {
    const out = parseGetMarker({ v: [{ PIER: '5', LAT1: 22.5, LONG1: 120.3 }] });
    expect(out[0].lat).toBeCloseTo(22.5, 6);
    expect(out[0].lon).toBeCloseTo(120.3, 6);
  });
});

describe('upsertBerths', () => {
  it('unions latest-wins by code', () => {
    const map = new Map<string, BerthMarker>();
    upsertBerths(map, [{ code: 'A', lat: 1, lon: 1, angle: 0, nameZh: 'old' }]);
    upsertBerths(map, [{ code: 'A', lat: 2, lon: 2, angle: 0, nameZh: 'new' }, { code: 'B', lat: 3, lon: 3, angle: 0, nameZh: '' }]);
    expect(map.size).toBe(2);
    expect(map.get('A')!.nameZh).toBe('new');
    expect(map.get('A')!.lat).toBe(2);
  });
});

const KHH_BBOX: Bbox = { n: 22.644432, s: 22.522706, w: 120.234375, e: 120.344238 };

describe('filterToBbox', () => {
  const inside: BerthMarker = { code: '1001', lat: 22.6187, lon: 120.2750, angle: 166, nameZh: '澎湖' };
  const outside: BerthMarker = { code: '9999', lat: 11.3, lon: 60.1, angle: 0, nameZh: 'bad' };

  it('keeps a marker inside the KHH bbox', () => {
    const result = filterToBbox([inside], KHH_BBOX);
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('1001');
  });

  it('drops a marker outside the KHH bbox (lat≈11.3, lon≈60.1 — Indian Ocean)', () => {
    const result = filterToBbox([outside], KHH_BBOX);
    expect(result).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    expect(filterToBbox([], KHH_BBOX)).toHaveLength(0);
  });

  it('filters mixed input correctly', () => {
    const result = filterToBbox([inside, outside], KHH_BBOX);
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('1001');
  });
});
