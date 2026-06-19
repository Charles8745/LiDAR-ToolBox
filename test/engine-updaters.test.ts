import { describe, it, expect } from 'vitest';
import { runUpdaters, type UpdateFn } from '../src/core/updaters';

describe('runUpdaters', () => {
  it('invokes each updater in registration order with (dt, time)', () => {
    const calls: Array<[string, number, number]> = [];
    const a: UpdateFn = (dt, t) => calls.push(['a', dt, t]);
    const b: UpdateFn = (dt, t) => calls.push(['b', dt, t]);
    runUpdaters([a, b], 0.016, 1.5);
    expect(calls).toEqual([['a', 0.016, 1.5], ['b', 0.016, 1.5]]);
  });
  it('does nothing for an empty list', () => {
    expect(() => runUpdaters([], 0.016, 0)).not.toThrow();
  });
});
