import { describe, it, expect } from 'vitest';
import { buildIntervals, buildOccupancyTrend, buildIncomingList } from '../examples/kaohsiung-port/time/occupancy';
import type { VesselRecord } from '../examples/kaohsiung-port/data/twport';

function rec(p: Partial<VesselRecord>): VesselRecord {
  return { visaNo: '', nameZh: '', nameEn: '', shipType: '', wharfName: '', berthNo: null, status: '',
    etaMs: null, etdMs: null, actPortMs: null, leaveMs: null, beforePort: '', nextPort: '', imo: '',
    callSign: '', source: 'berthing', ...p };
}
const HOUR = 3600_000;

describe('buildOccupancyTrend', () => {
  const intervals = buildIntervals([
    rec({ berthNo: 1, actPortMs: 0, leaveMs: 4 * HOUR }),
    rec({ berthNo: 2, actPortMs: 2 * HOUR, leaveMs: 6 * HOUR }),
  ]);
  it('samples steps+1 in-port counts across [t0,t1]', () => {
    const trend = buildOccupancyTrend(intervals, 0, 6 * HOUR, 6);
    expect(trend).toHaveLength(7);
    expect(trend[0]).toBe(1);          // t=0 → berth 1
    expect(trend[3]).toBe(2);          // t=3h → berths 1 & 2
    expect(trend[6]).toBe(0);          // t=6h → both gone (end exclusive)
  });
  it('returns a single sample when steps < 1', () => {
    expect(buildOccupancyTrend(intervals, 0, 6 * HOUR, 0)).toEqual([1]);
  });
});

describe('buildIncomingList', () => {
  const intervals = buildIntervals([
    rec({ nameZh: '早', berthNo: 5, etaMs: 1 * HOUR, source: 'forecast' }),
    rec({ nameZh: '晚', berthNo: 6, etaMs: 3 * HOUR, source: 'forecast' }),
    rec({ nameZh: '過遠', berthNo: 7, etaMs: 9 * HOUR, source: 'forecast' }),
  ]);
  it('lists arrivals within the window, soonest first', () => {
    const list = buildIncomingList(intervals, 0, 4 * HOUR);
    expect(list.map((a) => a.vessel.nameZh)).toEqual(['早', '晚']);
    expect(list[0].etaMs).toBe(1 * HOUR);
    expect(list[0].berthNo).toBe(5);
  });
});
