import { describe, it, expect } from 'vitest';
import { parseOsm, type OverpassDoc } from '../examples/kaohsiung-port/data/osm';

const OVERPASS: OverpassDoc = {
  elements: [
    { type: 'way', tags: { natural: 'coastline' }, geometry: [{ lat: 22.6, lon: 120.27 }, { lat: 22.59, lon: 120.28 }] },
    { type: 'way', tags: { man_made: 'pier' }, geometry: [{ lat: 22.58, lon: 120.31 }, { lat: 22.575, lon: 120.31 }] },
    { type: 'way', tags: { man_made: 'breakwater' }, geometry: [{ lat: 22.55, lon: 120.30 }, { lat: 22.55, lon: 120.31 }] },
    { type: 'way', tags: { man_made: 'storage_tank' }, geometry: [
      { lat: 22.56, lon: 120.30 }, { lat: 22.56, lon: 120.301 }, { lat: 22.561, lon: 120.301 }, { lat: 22.56, lon: 120.30 } ] },
    { type: 'node', tags: { man_made: 'crane' }, lat: 22.57, lon: 120.31 },
    { type: 'node', tags: { 'seamark:type': 'anchorage' }, lat: 22.62, lon: 120.26 },
    { type: 'way', tags: { 'seamark:type': 'anchorage' }, geometry: [{ lat: 22.63, lon: 120.25 }, { lat: 22.63, lon: 120.26 }] },
    { type: 'node', tags: {}, lat: 22.6, lon: 120.3 }, // untagged node → ignored
  ],
};

describe('parseOsm', () => {
  const r = parseOsm(OVERPASS);
  it('classifies coastline / pier ways into polylines', () => {
    expect(r.coastline).toHaveLength(1);
    expect(r.piers).toHaveLength(1);
    expect(r.coastline[0]).toEqual([{ lat: 22.6, lon: 120.27 }, { lat: 22.59, lon: 120.28 }]);
  });
  it('extracts breakwater ways and storage_tank footprints', () => {
    expect(r.breakwater).toHaveLength(1);
    expect(r.tanks).toHaveLength(1);
    expect(r.tanks[0].length).toBe(4);
  });
  it('extracts crane nodes as points', () => {
    expect(r.cranes).toEqual([{ lat: 22.57, lon: 120.31 }]);
  });
  it('extracts anchorage nodes (length-1 polyline) and areas', () => {
    expect(r.anchorages).toHaveLength(2);
    const lens = r.anchorages.map((a) => a.length).sort();
    expect(lens).toEqual([1, 2]); // one node (1), one area (2)
  });
  it('ignores untagged nodes and short ways', () => {
    const r2 = parseOsm({ elements: [
      { type: 'way', tags: { natural: 'coastline' }, geometry: [{ lat: 22.6, lon: 120.27 }] },
      { type: 'node', tags: {}, lat: 1, lon: 1 },
    ] });
    expect(r2.coastline).toHaveLength(0);
    expect(r2.cranes).toHaveLength(0);
  });
});
