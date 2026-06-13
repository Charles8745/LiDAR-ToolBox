import * as THREE from 'three';
import type { Emitter, EmitContext, Ray } from '../core/types';

export interface PulseRingOptions {
  speed?: number;        // radians/sec the ring angle expands
  maxAngle?: number;     // ring resets to 0 after reaching this angle
  thickness?: number;    // angular thickness of the ring
  raysPerFrame?: number;
}

/** An expanding ring of rays sweeping outward from the forward axis (sonar-like). */
export function pulseRing(opts: PulseRingOptions = {}): Emitter {
  const speed = opts.speed ?? 1.5;
  const maxAngle = opts.maxAngle ?? 0.6;
  const thickness = opts.thickness ?? 0.02;
  const raysPerFrame = opts.raysPerFrame ?? 400;

  return {
    emit(ctx: EmitContext): Ray[] {
      const ringAngle = (ctx.time * speed) % maxAngle;
      const fwd = ctx.forward.clone().normalize();
      const tangent = new THREE.Vector3().crossVectors(fwd, ctx.up);
      if (tangent.lengthSq() < 1e-6) tangent.crossVectors(fwd, ctx.right);
      tangent.normalize();
      const bitangent = new THREE.Vector3().crossVectors(fwd, tangent).normalize();

      const rays: Ray[] = [];
      for (let i = 0; i < raysPerFrame; i++) {
        const az = ctx.rng() * Math.PI * 2;
        const ang = ringAngle + (ctx.rng() * 2 - 1) * thickness;
        const direction = fwd
          .clone()
          .multiplyScalar(Math.cos(ang))
          .addScaledVector(tangent, Math.sin(ang) * Math.cos(az))
          .addScaledVector(bitangent, Math.sin(ang) * Math.sin(az))
          .normalize();
        rays.push({ origin: ctx.origin.clone(), direction });
      }
      return rays;
    },
  };
}
