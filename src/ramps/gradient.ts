import type { RGB } from '../core/types';

/** A color stop: position `t` in [0,1] and `color` as RGB 0..255. Stops must be sorted ascending by t. */
export interface ColorStop {
  t: number;
  color: RGB;
}

/** Linearly interpolate a sorted stop list at position `t` (clamped to [0,1]). */
export function sampleGradient(stops: ColorStop[], t: number): RGB {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (x >= a.t && x <= b.t) {
      const span = b.t - a.t || 1;
      const k = (x - a.t) / span;
      return [
        a.color[0] + (b.color[0] - a.color[0]) * k,
        a.color[1] + (b.color[1] - a.color[1]) * k,
        a.color[2] + (b.color[2] - a.color[2]) * k,
      ];
    }
  }
  return stops[stops.length - 1].color;
}
