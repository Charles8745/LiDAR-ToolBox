import type { Emitter, EmitContext, Ray } from '../core/types';
import { coneRays } from './cone';

export interface AutoSweepOptions {
  halfAngle?: number;
  raysPerFrame?: number;
  speedX?: number;  // Lissajous frequency for horizontal sweep
  speedY?: number;  // Lissajous frequency for vertical sweep
  spread?: number;  // how far the aim swings off forward
}

/** Hands-free cone whose aim follows a Lissajous path over time (for demos/idle). */
export function autoSweep(opts: AutoSweepOptions = {}): Emitter {
  const halfAngle = opts.halfAngle ?? 0.1;
  const raysPerFrame = opts.raysPerFrame ?? 400;
  const speedX = opts.speedX ?? 0.7;
  const speedY = opts.speedY ?? 0.43;
  const spread = opts.spread ?? 0.5;

  return {
    emit(ctx: EmitContext): Ray[] {
      const sx = Math.sin(ctx.time * speedX) * spread;
      const sy = Math.sin(ctx.time * speedY) * spread;
      const aimDir = ctx.forward
        .clone()
        .addScaledVector(ctx.right, sx)
        .addScaledVector(ctx.up, sy)
        .normalize();
      return coneRays(ctx.origin, aimDir, ctx.up, halfAngle, raysPerFrame, ctx.rng);
    },
  };
}
