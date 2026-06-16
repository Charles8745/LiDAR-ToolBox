import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BLOOM_LAYER, hideNonBloomed, restoreHidden, normalizeBloomGroups, type BloomGroup } from '../src/core/postfx';

function pts(): THREE.Points {
  return new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial());
}

describe('selective bloom visibility helpers', () => {
  it('hides non-bloom objects and leaves bloom-layer objects visible', () => {
    const scene = new THREE.Scene();
    const glow = pts(); glow.layers.enable(BLOOM_LAYER);
    const dim = pts();
    scene.add(glow, dim);

    const bloomLayer = new THREE.Layers(); bloomLayer.set(BLOOM_LAYER);
    const hidden: THREE.Object3D[] = [];
    hideNonBloomed(scene, bloomLayer, hidden);

    expect(glow.visible).toBe(true);
    expect(dim.visible).toBe(false);
    expect(hidden).toContain(dim);
    expect(hidden).not.toContain(glow);
  });

  it('restoreHidden re-shows everything and empties the list', () => {
    const dim = pts(); dim.visible = false;
    const hidden: THREE.Object3D[] = [dim];
    restoreHidden(hidden);
    expect(dim.visible).toBe(true);
    expect(hidden).toHaveLength(0);
  });
});

describe('normalizeBloomGroups', () => {
  it('wraps a single BloomOptions into one group on BLOOM_LAYER', () => {
    const groups = normalizeBloomGroups({ strength: 0.6, threshold: 0.2 });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ layer: BLOOM_LAYER, strength: 0.6, threshold: 0.2 });
  });

  it('passes an array of groups through, defaulting a missing layer to BLOOM_LAYER', () => {
    const groups = normalizeBloomGroups([
      { layer: 1, strength: 0.5 },
      { layer: 2, strength: 1.1, radius: 0.5 },
      { strength: 0.3 } as BloomGroup,
    ]);
    expect(groups.map((g) => g.layer)).toEqual([1, 2, BLOOM_LAYER]);
    expect(groups[1]).toMatchObject({ layer: 2, strength: 1.1, radius: 0.5 });
  });
});
