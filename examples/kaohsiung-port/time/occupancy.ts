import type { VesselRecord } from '../data/twport';

export interface BerthInterval { berthNo: number; vessel: VesselRecord; startMs: number; endMs: number; }
export type BerthStatus = 'occupied' | 'incoming' | 'free';

const DEFAULT_STAY_MS = 12 * 3600_000;

/** One occupancy interval per berthed vessel: [arrival, departure). */
export function buildIntervals(vessels: VesselRecord[]): BerthInterval[] {
  const out: BerthInterval[] = [];
  for (const v of vessels) {
    const berthNo = v.berthNo;
    if (berthNo == null) continue;
    const startMs = v.actPortMs ?? v.etaMs;
    if (startMs == null) continue;
    const endMs = v.leaveMs ?? v.etdMs ?? startMs + DEFAULT_STAY_MS;
    out.push({ berthNo, vessel: v, startMs, endMs: Math.max(endMs, startMs + 1) });
  }
  return out;
}

/** berthNo → vessel occupying it at time t (later interval wins on overlap). */
export function occupancyAt(intervals: BerthInterval[], tMs: number): Map<number, VesselRecord> {
  const map = new Map<number, VesselRecord>();
  for (const it of intervals) {
    if (tMs >= it.startMs && tMs < it.endMs) map.set(it.berthNo, it.vessel);
  }
  return map;
}

export function berthStatusAt(
  intervals: BerthInterval[], berthNo: number, tMs: number, incomingWindowMs: number,
): BerthStatus {
  let incoming = false;
  for (const it of intervals) {
    if (it.berthNo !== berthNo) continue;
    if (tMs >= it.startMs && tMs < it.endMs) return 'occupied';
    if (it.startMs > tMs && it.startMs <= tMs + incomingWindowMs) incoming = true;
  }
  return incoming ? 'incoming' : 'free';
}
