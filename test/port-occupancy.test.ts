import { describe, it, expect } from 'vitest';
import { buildIntervals, occupancyAt, berthStatusAt } from '../examples/kaohsiung-port/time/occupancy';
import type { VesselRecord } from '../examples/kaohsiung-port/data/twport';

function rec(p: Partial<VesselRecord>): VesselRecord {
  return { visaNo: '', nameZh: '', nameEn: '', shipType: '', wharfName: '', berthNo: null, status: '',
    etaMs: null, etdMs: null, actPortMs: null, leaveMs: null, beforePort: '', nextPort: '', imo: '',
    callSign: '', source: 'berthing', ...p };
}
const HOUR = 3600_000;

describe('occupancy', () => {
  const vessels = [
    rec({ nameZh: 'A', berthNo: 7, actPortMs: 0, leaveMs: 5 * HOUR }),
    rec({ nameZh: 'B', berthNo: 108, etaMs: 10 * HOUR, etdMs: 14 * HOUR, source: 'forecast' }),
  ];
  const intervals = buildIntervals(vessels);

  it('builds one interval per berthed vessel', () => {
    expect(intervals).toHaveLength(2);
    expect(intervals[0]).toMatchObject({ berthNo: 7, startMs: 0, endMs: 5 * HOUR });
  });

  it('occupancyAt returns the vessel occupying a berth at time t', () => {
    const at2h = occupancyAt(intervals, 2 * HOUR);
    expect(at2h.get(7)?.nameZh).toBe('A');
    expect(at2h.has(108)).toBe(false);
  });

  it('berthStatusAt: occupied / incoming / free', () => {
    expect(berthStatusAt(intervals, 7, 2 * HOUR, 2 * HOUR)).toBe('occupied');
    expect(berthStatusAt(intervals, 108, 9 * HOUR, 2 * HOUR)).toBe('incoming'); // arrives in 1h
    expect(berthStatusAt(intervals, 108, 2 * HOUR, 2 * HOUR)).toBe('free');     // arrival far off
  });
});
