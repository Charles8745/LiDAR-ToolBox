import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { cursorCone } from '../src/emitters/cursorCone';
import type { EmitContext } from '../src/core/types';

// Deterministic seeded RNG (mulberry32).
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

function ctx(overrides: Partial<EmitContext> = {}): EmitContext {
  return {
    origin: new THREE.Vector3(1, 2, 3),
    forward: new THREE.Vector3(0, 0, 1),
    right: new THREE.Vector3(1, 0, 0),
    up: new THREE.Vector3(0, 1, 0),
    aim: new THREE.Vector2(0, 0),
    time: 0,
    dt: 0.016,
    rng: rng(42),
    ...overrides,
  };
}

describe('cursorCone', () => {
  it('emits the requested number of rays', () => {
    const rays = cursorCone({ raysPerFrame: 50 }).emit(ctx());
    expect(rays.length).toBe(50);
  });

  it('keeps every ray within halfAngle of the aim direction (forward when aim=0)', () => {
    const halfAngle = 0.1;
    const rays = cursorCone({ raysPerFrame: 200, halfAngle }).emit(ctx());
    const fwd = new THREE.Vector3(0, 0, 1);
    for (const r of rays) {
      const angle = Math.acos(THREE.MathUtils.clamp(r.direction.dot(fwd), -1, 1));
      expect(angle).toBeLessThanOrEqual(halfAngle + 1e-6);
    }
  });

  it('produces normalized directions and copies the origin', () => {
    const rays = cursorCone({ raysPerFrame: 20 }).emit(ctx());
    for (const r of rays) {
      expect(r.direction.length()).toBeCloseTo(1, 5);
      expect(r.origin.equals(new THREE.Vector3(1, 2, 3))).toBe(true);
    }
  });

  it('shifts the aim when the cursor offset is non-zero', () => {
    const rays = cursorCone({ raysPerFrame: 100, halfAngle: 0.05, aimSpread: 0.6 })
      .emit(ctx({ aim: new THREE.Vector2(1, 0) }));
    const mean = new THREE.Vector3();
    for (const r of rays) mean.add(r.direction);
    mean.divideScalar(rays.length).normalize();
    expect(mean.x).toBeGreaterThan(0.3);
  });
});
