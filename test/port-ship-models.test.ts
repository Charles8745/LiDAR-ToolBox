import { describe, it, expect } from 'vitest';
import { toTemplate, placeModelPoints, loadShipModel } from '../examples/kaohsiung-port/scene/shipModels';

describe('toTemplate', () => {
  it('wraps raw points into a Float32Array template', () => {
    const t = toTemplate({ points: [0, 0, 0, 0.5, 0.2, 0.1] });
    expect(t.points).toBeInstanceOf(Float32Array);
    expect(t.points.length).toBe(6);
  });
});

describe('placeModelPoints', () => {
  const tpl = toTemplate({ points: [0, 0, 0, 0.5, 1, 0.25] }); // two unit-space points

  it('uniform-scales by lengthU and lifts by baseY (heading 0)', () => {
    const b = placeModelPoints(tpl, { x: 10, z: 20 }, 0, 4, 0.5, 0.3);
    // point #1 at origin → (cx, baseY, cz)
    expect(b.positions[0]).toBeCloseTo(10, 5);
    expect(b.positions[1]).toBeCloseTo(0.5, 5);
    expect(b.positions[2]).toBeCloseTo(20, 5);
    // point #2: mx=0.5,my=1,mz=0.25 ; L=4 → x=10+2, y=0.5+4, z=20+1
    expect(b.positions[3]).toBeCloseTo(12, 5);
    expect(b.positions[4]).toBeCloseTo(4.5, 5);
    expect(b.positions[5]).toBeCloseTo(21, 5);
  });

  it('rotates long axis (+x) to (cos h, sin h) — heading 90°', () => {
    const h = Math.PI / 2; // cos0, sin1
    const b = placeModelPoints(tpl, { x: 0, z: 0 }, h, 4, 0, 0.3);
    // point #2 local (mx=0.5,mz=0.25)*L=4 → (2, ,1); rotate: worldX = 2*cos - 1*sin = -1; worldZ = 2*sin + 1*cos = 2
    expect(b.positions[3]).toBeCloseTo(-1, 5);
    expect(b.positions[5]).toBeCloseTo(2, 5);
  });

  it('fills every value with v01', () => {
    const b = placeModelPoints(tpl, { x: 0, z: 0 }, 0, 4, 0, 0.42);
    expect(b.values[0]).toBeCloseTo(0.42, 5);
    expect(b.values[1]).toBeCloseTo(0.42, 5);
  });
});

describe('loadShipModel', () => {
  it('returns a template for a category with a baked model (貨櫃)', () => {
    const t = loadShipModel('貨櫃');
    expect(t).not.toBeNull();
    expect(t!.points).toBeInstanceOf(Float32Array);
    expect(t!.points.length).toBeGreaterThan(0);
  });

  it('returns the same cached instance on repeat calls', () => {
    expect(loadShipModel('貨櫃')).toBe(loadShipModel('貨櫃'));
  });

  it('returns null for categories with no baked model', () => {
    expect(loadShipModel('其他')).toBeNull();
  });
});
