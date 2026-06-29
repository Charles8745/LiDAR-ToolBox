import { describe, it, expect } from 'vitest';
import {
  buildPierSegs, nearestPierTangent, collectLandPoints, waterSideSign, craneBoomHeading,
} from '../examples/kaohsiung-port/scene/orient';
import type { OsmGeometry } from '../examples/kaohsiung-port/data/osm';

const idProj = { toWorld: (lat: number, lon: number) => ({ x: lon, z: lat }) } as any;

describe('buildPierSegs', () => {
  it('flattens polylines into world segments', () => {
    const segs = buildPierSegs([[{ lat: 0, lon: 0 }, { lat: 0, lon: 10 }]], idProj);
    expect(segs).toEqual([{ ax: 0, az: 0, bx: 10, bz: 0 }]); // x=lon, z=lat
  });
  it('emits one seg per consecutive vertex pair', () => {
    const segs = buildPierSegs([[{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 0, lon: 2 }]], idProj);
    expect(segs.length).toBe(2);
  });
});

describe('nearestPierTangent', () => {
  const segs = [{ ax: 0, az: 0, bx: 10, bz: 0 }]; // horizontal pier along +x
  it('returns tangent heading 0 and perpendicular distance', () => {
    const r = nearestPierTangent(5, 3, segs);
    expect(r.headingRad).toBeCloseTo(0, 6);
    expect(r.distU).toBeCloseTo(3, 6);
  });
});

describe('collectLandPoints', () => {
  it('gathers coastline+piers+tanks+breakwater vertices (not cranes/anchorages)', () => {
    const osm: OsmGeometry = {
      coastline: [[{ lat: 0, lon: 0 }]],
      piers: [[{ lat: 1, lon: 1 }]],
      breakwater: [[{ lat: 2, lon: 2 }]],
      tanks: [[{ lat: 3, lon: 3 }]],
      cranes: [{ lat: 9, lon: 9 }],
      anchorages: [[{ lat: 8, lon: 8 }]],
    };
    const pts = collectLandPoints(osm, idProj);
    expect(pts.length).toBe(4);
  });
});

describe('waterSideSign', () => {
  // pier tangent 0 → perpendiculars are +z (heading +π/2) and -z (heading -π/2).
  it('returns the sign pointing AWAY from the land cluster (fewer features)', () => {
    const land = [{ x: 0, z: 5 }]; // land on +z side
    const sign = waterSideSign({ x: 0, z: 0 }, 0, land, { stepU: 5, probeR: 2 });
    expect(sign).toBe(-1); // water = -z → heading 0 + (-1)*π/2
  });
  it('ties resolve to +1 (leave to manual override)', () => {
    const sign = waterSideSign({ x: 0, z: 0 }, 0, [], { stepU: 5, probeR: 2 });
    expect(sign).toBe(1);
  });
});

describe('craneBoomHeading', () => {
  const segs = [{ ax: -10, az: 0, bx: 10, bz: 0 }]; // tangent 0
  const land = [{ x: 0, z: 5 }];                      // land on +z
  it('combines pier tangent with water side', () => {
    const h = craneBoomHeading({ x: 0, z: 0 }, segs, land, { stepU: 5, probeR: 2 });
    expect(h).toBeCloseTo(-Math.PI / 2, 6); // boom toward water (-z)
  });
  it('honours an explicit override sign', () => {
    const h = craneBoomHeading({ x: 0, z: 0 }, segs, land, { stepU: 5, probeR: 2 }, 1);
    expect(h).toBeCloseTo(Math.PI / 2, 6);
  });
});
