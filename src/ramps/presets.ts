import type { ColorStop } from './gradient';

/** Scanner Sombre style: warm (near) → cool (far). */
export const rainbowDepthStops: ColorStop[] = [
  { t: 0.0, color: [255, 90, 60] },
  { t: 0.25, color: [255, 210, 60] },
  { t: 0.5, color: [92, 255, 155] },
  { t: 0.75, color: [60, 240, 255] },
  { t: 1.0, color: [123, 92, 255] },
];

/** Thermal: black → red → yellow → white. */
export const thermalStops: ColorStop[] = [
  { t: 0.0, color: [20, 0, 40] },
  { t: 0.4, color: [200, 30, 30] },
  { t: 0.7, color: [255, 180, 40] },
  { t: 1.0, color: [255, 255, 230] },
];

/** Mono neon: dim → bright cyan. */
export const monoNeonStops: ColorStop[] = [
  { t: 0.0, color: [10, 40, 50] },
  { t: 1.0, color: [120, 255, 240] },
];
