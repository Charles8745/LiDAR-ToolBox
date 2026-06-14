import { describe, it, expect } from 'vitest';
import { parseOsmWays } from '../examples/kaohsiung-port/data/osm';

const OVERPASS = {
  elements: [
    { type: 'way', tags: { natural: 'coastline' }, geometry: [{ lat: 22.6, lon: 120.27 }, { lat: 22.59, lon: 120.28 }] },
    { type: 'way', tags: { man_made: 'pier' }, geometry: [{ lat: 22.58, lon: 120.31 }, { lat: 22.575, lon: 120.31 }] },
    { type: 'node', tags: {}, lat: 22.6, lon: 120.3 },
  ],
};

describe('parseOsmWays', () => {
  const r = parseOsmWays(OVERPASS);
  it('classifies coastline and pier ways into polylines', () => {
    expect(r.coastline).toHaveLength(1);
    expect(r.piers).toHaveLength(1);
    expect(r.coastline[0]).toEqual([{ lat: 22.6, lon: 120.27 }, { lat: 22.59, lon: 120.28 }]);
  });
  it('ignores elements without geometry', () => {
    const all = r.coastline.length + r.piers.length;
    expect(all).toBe(2);
  });
});
