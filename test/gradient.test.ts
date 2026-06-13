import { describe, it, expect } from 'vitest';
import { sampleGradient, type ColorStop } from '../src/ramps/gradient';

const stops: ColorStop[] = [
  { t: 0.0, color: [0, 0, 0] },
  { t: 0.5, color: [100, 100, 100] },
  { t: 1.0, color: [200, 0, 0] },
];

describe('sampleGradient', () => {
  it('returns the first stop at t=0', () => {
    expect(sampleGradient(stops, 0)).toEqual([0, 0, 0]);
  });

  it('returns the last stop at t=1', () => {
    expect(sampleGradient(stops, 1)).toEqual([200, 0, 0]);
  });

  it('interpolates linearly at a midpoint', () => {
    expect(sampleGradient(stops, 0.25)).toEqual([50, 50, 50]);
  });

  it('clamps t below 0 to the first stop', () => {
    expect(sampleGradient(stops, -1)).toEqual([0, 0, 0]);
  });

  it('clamps t above 1 to the last stop', () => {
    expect(sampleGradient(stops, 2)).toEqual([200, 0, 0]);
  });
});
