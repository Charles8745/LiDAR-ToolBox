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

/** In-port vessel count sampled at steps+1 evenly spaced times across [t0,t1]. */
export function buildOccupancyTrend(intervals: BerthInterval[], t0: number, t1: number, steps: number): number[] {
  if (steps < 1) return [occupancyAt(intervals, t0).size];
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((t1 - t0) * i) / steps;
    out.push(occupancyAt(intervals, t).size);
  }
  return out;
}

export interface IncomingArrival { berthNo: number; vessel: VesselRecord; etaMs: number; }

/** Vessels arriving within (tMs, tMs+windowMs], soonest first. */
export function buildIncomingList(intervals: BerthInterval[], tMs: number, windowMs: number): IncomingArrival[] {
  const out: IncomingArrival[] = [];
  for (const it of intervals) {
    if (it.startMs > tMs && it.startMs <= tMs + windowMs) {
      out.push({ berthNo: it.berthNo, vessel: it.vessel, etaMs: it.startMs });
    }
  }
  out.sort((a, b) => a.etaMs - b.etaMs);
  return out;
}
