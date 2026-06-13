import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { pulseRing } from '../src/emitters/pulseRing';
import type { EmitContext } from '../src/core/types';

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
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
    time,
    dt: 0.016,
    rng: rng(7),
  };
}

describe('pulseRing', () => {
  it('emits rays on a ring whose angle from forward matches the expanding radius', () => {
    const speed = 1.5;
    const maxAngle = 0.6;
    const thickness = 0.02;
    const time = 0.2;
    const expected = (time * speed) % maxAngle; // 0.3
    const rays = pulseRing({ speed, maxAngle, thickness, raysPerFrame: 300 }).emit(ctx(time));
    const fwd = new THREE.Vector3(0, 0, 1);
    for (const r of rays) {
      const angle = Math.acos(THREE.MathUtils.clamp(r.direction.dot(fwd), -1, 1));
      expect(Math.abs(angle - expected)).toBeLessThanOrEqual(thickness + 1e-6);
    }
  });

  it('spreads rays around the full azimuth (covers all four quadrants in x/y)', () => {
    const rays = pulseRing({ raysPerFrame: 400 }).emit(ctx(0.3));
    const quad = { px: false, nx: false, py: false, ny: false };
    for (const r of rays) {
      if (r.direction.x > 0.01) quad.px = true;
      if (r.direction.x < -0.01) quad.nx = true;
      if (r.direction.y > 0.01) quad.py = true;
      if (r.direction.y < -0.01) quad.ny = true;
    }
    expect(quad).toEqual({ px: true, nx: true, py: true, ny: true });
  });
});
