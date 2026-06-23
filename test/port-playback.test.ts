import { describe, it, expect } from 'vitest';
import { advancePerFrame } from '../examples/kaohsiung-port/time/playback';

const RANGE = 86_400_000; // 24h in ms

describe('advancePerFrame', () => {
  it('step 8 reproduces today\'s speed (range/600)', () => {
    expect(advancePerFrame(RANGE, 8)).toBe(RANGE / 600);
  });

  it('step 10 is 1.25x today (range/480)', () => {
    expect(advancePerFrame(RANGE, 10)).toBe(RANGE / 480);
  });

  it('step 1 is the slowest (range/4800)', () => {
    expect(advancePerFrame(RANGE, 1)).toBe(RANGE / 4800);
  });

  it('step 5 is the default (range/960)', () => {
    expect(advancePerFrame(RANGE, 5)).toBe(RANGE / 960);
  });

  it('scales linearly with step', () => {
    expect(advancePerFrame(RANGE, 4)).toBe(advancePerFrame(RANGE, 2) * 2);
  });
});
