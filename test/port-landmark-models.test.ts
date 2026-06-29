import { describe, it, expect } from 'vitest';
import { toTemplate } from '../examples/kaohsiung-port/scene/shipModels';
import { loadLandmarkModel, buildModelInstances } from '../examples/kaohsiung-port/scene/landmarkModels';

describe('loadLandmarkModel', () => {
  it('returns null for an unregistered key', () => {
    // 'nope' is never wired by this plan → stable invariant across Task 2 (empty) and Task 5 (crane wired),
    // so no committed test has to be edited when RAW.crane goes live.
    expect(loadLandmarkModel('nope')).toBeNull();
  });
});

describe('buildModelInstances', () => {
  const tpl = toTemplate({ points: [0, 0, 0, 1, 0, 0] }); // 2 pts; #2 at +x unit (boom tip)
  const segs = [{ ax: -10, az: 0, bx: 10, bz: 0 }];        // tangent 0
  const land = [{ x: 0, z: 5 }];                            // land on +z → water = -z
  const opts = { stepU: 5, probeR: 2 };

  it('emits N × template points', () => {
    const out = buildModelInstances(tpl, [{ x: 0, z: 0 }], segs, land, opts, 2, 0);
    expect(out.length).toBe(1 * 2 * 3);
  });

  it('orients boom (+x) toward water and scales by scaleU', () => {
    const out = buildModelInstances(tpl, [{ x: 0, z: 0 }], segs, land, opts, 2, 0);
    // point #1 at template origin → center (0,0,0)
    expect(out[0]).toBeCloseTo(0, 5); expect(out[1]).toBeCloseTo(0, 5); expect(out[2]).toBeCloseTo(0, 5);
    // point #2: local (1,0,0)*2 = (2,0,0); heading -π/2 → (x,z)=(0,-2) → boom toward -z (water)
    expect(out[3]).toBeCloseTo(0, 5);
    expect(out[5]).toBeCloseTo(-2, 5);
  });

  it('honours per-index heading overrides', () => {
    const out = buildModelInstances(tpl, [{ x: 0, z: 0 }], segs, land, opts, 2, 0, { 0: 1 });
    // override +1 → heading +π/2 → boom tip at +z
    expect(out[5]).toBeCloseTo(2, 5);
  });

  it('uses a baked heading when provided (ignoring the land-density water-side)', () => {
    // baked heading 0 → boom (+x) along world +x, regardless of land on +z
    const out = buildModelInstances(tpl, [{ x: 0, z: 0 }], segs, land, opts, 2, 0, undefined, [0]);
    expect(out[3]).toBeCloseTo(2, 5); // boom tip at +x
    expect(out[5]).toBeCloseTo(0, 5);
  });

  it('lets a manual override outrank a baked heading', () => {
    // override +1 → +π/2 (boom +z) wins over the baked heading 0 (+x)
    const out = buildModelInstances(tpl, [{ x: 0, z: 0 }], segs, land, opts, 2, 0, { 0: 1 }, [0]);
    expect(out[5]).toBeCloseTo(2, 5);
  });
});
