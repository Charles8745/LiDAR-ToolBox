import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { autoSweep } from '../src/emitters/autoSweep';
import type { EmitContext } from '../src/core/types';

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ctx(time: number): EmitContext {
  return {
    origin: new THREE.Vector3(),
    forward: new THREE.Vector3(0, 0, 1),
    right: new THREE.Vector3(1, 0, 0),
    up: new THREE.Vector3(0, 1, 0),
    aim: new THREE.Vector2(0, 0),
    time, dt: 0.016, rng: rng(11),
  };
}

describe('autoSweep', () => {
  it('emits the requested number of normalized rays within the cone', () => {
    const halfAngle = 0.1;
    const rays = autoSweep({ raysPerFrame: 80, halfAngle, spread: 0.5 }).emit(ctx(1.0));
    expect(rays.length).toBe(80);
    for (const r of rays) {
      expect(r.direction.length()).toBeCloseTo(1, 5);
    }
  });

  it('aims in different directions at different times (Lissajous motion)', () => {
    const mean = (time: number) => {
      const rays = autoSweep({ raysPerFrame: 100 }).emit(ctx(time));
      const m = new THREE.Vector3();
      for (const r of rays) m.add(r.direction);
      return m.divideScalar(rays.length).normalize();
    };
    const a = mean(0.2);
    const b = mean(3.5);
    expect(a.distanceTo(b)).toBeGreaterThan(0.05);
  });
});
