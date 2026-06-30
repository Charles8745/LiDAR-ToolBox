import { describe, it, expect } from 'vitest';
import {
  buildPierSegs, nearestPierTangent, collectLandPoints, waterSideSign, craneBoomHeading,
  craneRowTangent, boundaryBoomHeading, principalAxis, craneRowAxis, waterwardPerp,
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

describe('craneRowTangent', () => {
  it('returns the along-row direction for a horizontal crane row', () => {
    const c = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }, { x: 3, z: 0 }];
    const h = craneRowTangent(1, c, 2);
    expect(Math.abs(Math.sin(h))).toBeCloseTo(0, 1); // tangent along x
    expect(Math.abs(Math.cos(h))).toBeCloseTo(1, 1);
  });
  it('returns the along-row direction for a vertical crane row', () => {
    const c = [{ x: 0, z: 0 }, { x: 0, z: 1 }, { x: 0, z: 2 }, { x: 0, z: 3 }];
    const h = craneRowTangent(1, c, 2);
    expect(Math.abs(Math.cos(h))).toBeCloseTo(0, 1); // tangent along z
    expect(Math.abs(Math.sin(h))).toBeCloseTo(1, 1);
  });
  it('uses only the k nearest, so a far perpendicular outlier does not skew the tangent', () => {
    const c = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }, { x: 1, z: 50 }];
    const h = craneRowTangent(1, c, 2); // nearest 2 to #1 are the in-row neighbours
    expect(Math.abs(Math.sin(h))).toBeCloseTo(0, 1); // still along x
  });
});

describe('principalAxis', () => {
  it('collinear points → axis along the line + high linearity ratio', () => {
    const r = principalAxis([{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }, { x: 3, z: 0 }]);
    expect(Math.abs(Math.sin(r.angle))).toBeCloseTo(0, 6); // along x
    expect(r.ratio).toBeGreaterThan(100);                  // very linear
  });
  it('isotropic blob → ratio near 1', () => {
    const r = principalAxis([{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 1 }, { x: 1, z: 1 }]);
    expect(r.ratio).toBeLessThan(2);
  });
  it('angle agrees with the legacy principalAxisAngle helper', () => {
    const pts = [{ x: 0, z: 0 }, { x: 2, z: 1 }, { x: 4, z: 2 }];
    expect(principalAxis(pts).angle).toBeCloseTo(Math.atan2(1, 2), 6);
  });
});

describe('craneRowAxis', () => {
  it('horizontal crane row → angle along x and high ratio', () => {
    const c = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }, { x: 3, z: 0 }];
    const r = craneRowAxis(1, c, 2);
    expect(Math.abs(Math.sin(r.angle))).toBeCloseTo(0, 1);
    expect(r.ratio).toBeGreaterThan(100);
  });
  it('blob cluster → low ratio (signals the row is unreliable → caller falls back to boundary)', () => {
    const c = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 1 }, { x: 1, z: 1 }];
    const r = craneRowAxis(0, c, 3);
    expect(r.ratio).toBeLessThan(3);
  });
});

describe('waterwardPerp', () => {
  // horizontal coast (z=0); the two perpendiculars are +z (+π/2) and -z (-π/2).
  const horiz = [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 4, z: 0 }, { x: 6, z: 0 }];
  it('brightness ray decides: darker side = water', () => {
    const water = (_x: number, z: number) => (z > 0 ? 0 : 255); // +z dark = water
    const h = waterwardPerp({ x: 3, z: -1 }, 0, horiz, water, { probes: [1, 2, 3], rayMargin: 6 });
    expect(h).toBeCloseTo(Math.PI / 2, 6); // toward +z water
  });
  it('ambiguous brightness → geometry: water = side away from the boundary the crane sits behind', () => {
    const flat = () => 100;
    const h = waterwardPerp({ x: 3, z: 2 }, 0, horiz, flat, { probes: [1, 2, 3], rayMargin: 6 });
    expect(h).toBeCloseTo(-Math.PI / 2, 6); // crane on +z (land) side → boom toward -z water
  });
  it('respects the given tangent (vertical coast → boom along ±x)', () => {
    const vert = [{ x: 0, z: 0 }, { x: 0, z: 2 }, { x: 0, z: 4 }, { x: 0, z: 6 }];
    const water = (x: number, _z: number) => (x < 0 ? 0 : 255); // -x dark = water
    const h = waterwardPerp({ x: 1, z: 3 }, Math.PI / 2, vert, water, { probes: [1, 2, 3], rayMargin: 6 });
    expect(Math.cos(h)).toBeCloseTo(-1, 6); // toward -x
    expect(Math.sin(h)).toBeCloseTo(0, 6);
  });
});

describe('boundaryBoomHeading', () => {
  // Coast along the x-axis (z=0). Tangent always comes from the boundary PCA. The water SIDE combines two
  // signals: a clearly-inland crane (|offset| ≥ strongOffset) trusts geometry; a crane on/over the waterline
  // (small offset) trusts an open-water brightness ray; ambiguous brightness falls back to the geometry hint.
  const horiz = [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 4, z: 0 }, { x: 6, z: 0 }, { x: 8, z: 0 }, { x: 10, z: 0 }];
  it('clearly-inland crane → geometry decides, ignoring misleading brightness', () => {
    const lying = (_x: number, z: number) => (z < 0 ? 255 : 0); // falsely calls the water (-z) side bright
    const h = boundaryBoomHeading({ x: 5, z: 2 }, horiz, lying, { k: 4, strongOffset: 0.5 });
    expect(h).toBeCloseTo(-Math.PI / 2, 5); // offset 2 ≥ strong → geometry: inland +z → boom toward -z
  });
  it('mirrors for an inland crane on the other side', () => {
    const h = boundaryBoomHeading({ x: 5, z: -2 }, horiz, () => 0, { k: 4, strongOffset: 0.5 });
    expect(h).toBeCloseTo(Math.PI / 2, 5);
  });
  it('vertical coast, clearly inland → boom perpendicular across the edge', () => {
    const vert = [{ x: 0, z: 0 }, { x: 0, z: 2 }, { x: 0, z: 4 }, { x: 0, z: 6 }, { x: 0, z: 8 }];
    const h = boundaryBoomHeading({ x: 2, z: 4 }, vert, () => 0, { k: 4, strongOffset: 0.5 });
    expect(Math.cos(h)).toBeCloseTo(-1, 5); // boom toward -x
    expect(Math.sin(h)).toBeCloseTo(0, 5);
  });
  it('uses only the k nearest boundary points for the tangent', () => {
    const near = [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 4, z: 0 }, { x: 6, z: 0 }]; // horizontal shore at origin
    const far = [{ x: 20, z: 0 }, { x: 20, z: 2 }, { x: 20, z: 4 }, { x: 20, z: 6 }]; // vertical shore far in +x
    const h = boundaryBoomHeading({ x: 3, z: 1 }, [...near, ...far], () => 0, { k: 4, strongOffset: 0.5 });
    expect(Math.cos(h)).toBeCloseTo(0, 5);
    expect(h).toBeCloseTo(-Math.PI / 2, 5);
  });
  it('crane on the water side of the line → open-water ray overrides the weak geometry hint', () => {
    // signed +0.2 (barely +z) would geometrically aim -z, but the water IS on +z → the ray must win.
    const water = (_x: number, z: number) => (z > 0 ? 0 : 255);
    const h = boundaryBoomHeading({ x: 5, z: 0.2 }, horiz, water, { k: 4, strongOffset: 0.5 });
    expect(h).toBeCloseTo(Math.PI / 2, 5); // toward +z water
  });
  it('weak offset with ambiguous brightness → geometric hint as last resort', () => {
    const flat = () => 100;
    const h = boundaryBoomHeading({ x: 5, z: 0.2 }, horiz, flat, { k: 4, strongOffset: 0.5 });
    expect(h).toBeCloseTo(-Math.PI / 2, 5); // signed +0.2 → boom toward -z
  });
});
