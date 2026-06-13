import * as THREE from 'three';
import type { Ray } from '../core/types';

/**
 * Sample `n` rays inside a cone of half-angle `halfAngle` around `aimDir`.
 * Offsets are distributed uniformly over the cone's base disk.
 */
export function coneRays(
  origin: THREE.Vector3,
  aimDir: THREE.Vector3,
  refUp: THREE.Vector3,
  halfAngle: number,
  n: number,
  rng: () => number,
): Ray[] {
  const axis = aimDir.clone().normalize();
  const tangent = new THREE.Vector3().crossVectors(axis, refUp);
  if (tangent.lengthSq() < 1e-6) tangent.crossVectors(axis, new THREE.Vector3(1, 0, 0));
  tangent.normalize();
  const bitangent = new THREE.Vector3().crossVectors(axis, tangent).normalize();

  const rays: Ray[] = [];
  for (let i = 0; i < n; i++) {
    const az = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * halfAngle;
    const direction = axis
      .clone()
      .addScaledVector(tangent, Math.cos(az) * r)
      .addScaledVector(bitangent, Math.sin(az) * r)
      .normalize();
    rays.push({ origin: origin.clone(), direction });
  }
  return rays;
}
