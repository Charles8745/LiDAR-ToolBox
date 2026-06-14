import { describe, it, expect } from 'vitest';
import { fmtClock } from '../examples/kaohsiung-port/ui/overlay';

describe('fmtClock', () => {
  it('formats an epoch ms as Taipei MM/DD HH:mm', () => {
    // 2026-06-15 07:00 Taipei == 2026-06-14 23:00 UTC
    expect(fmtClock(Date.UTC(2026, 5, 14, 23, 0, 0))).toBe('06/15 07:00');
  });
});
