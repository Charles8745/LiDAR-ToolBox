import type { Emitter, EmitContext, Ray } from '../core/types';
import { coneRays } from './cone';

export interface CursorConeOptions {
  halfAngle?: number;   // cone half-angle in radians
  raysPerFrame?: number;
  aimSpread?: number;   // how strongly the cursor offset rotates the aim
}

/** A cone of rays aimed where the cursor points (via ctx.aim). */
export function cursorCone(opts: CursorConeOptions = {}): Emitter {
  const halfAngle = opts.halfAngle ?? 0.1;
  const raysPerFrame = opts.raysPerFrame ?? 400;
  const aimSpread = opts.aimSpread ?? 0.6;

  return {
    emit(ctx: EmitContext): Ray[] {
      const aimDir = ctx.forward
        .clone()
        .addScaledVector(ctx.right, ctx.aim.x * aimSpread)
        .addScaledVector(ctx.up, ctx.aim.y * aimSpread)
        .normalize();
      return coneRays(ctx.origin, aimDir, ctx.up, halfAngle, raysPerFrame, ctx.rng);
    },
  };
}
