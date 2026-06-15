import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BLOOM_LAYER, hideNonBloomed, restoreHidden } from '../src/core/postfx';

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
