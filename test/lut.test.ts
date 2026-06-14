import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildCategoryLUT } from '../src/ramps/lut';

describe('buildCategoryLUT', () => {
  it('builds a NearestFilter texture one texel wide per color', () => {
    const tex = buildCategoryLUT([[255, 0, 0], [0, 255, 0], [0, 0, 255]]);
    expect(tex.image.width).toBe(3);
    expect(tex.magFilter).toBe(THREE.NearestFilter);
    expect(tex.minFilter).toBe(THREE.NearestFilter);
  });

  it('writes the exact category colors into the texel data', () => {
    const tex = buildCategoryLUT([[10, 20, 30], [40, 50, 60]]);
    const d = tex.image.data as Uint8Array;
    expect([d[0], d[1], d[2], d[3]]).toEqual([10, 20, 30, 255]);
    expect([d[4], d[5], d[6], d[7]]).toEqual([40, 50, 60, 255]);
  });

  it('throws on an empty color list', () => {
    expect(() => buildCategoryLUT([])).toThrow();
  });
});
