import { describe, it, expect } from 'vitest';
import {
  unionKey,
  upsertVessels,
  buildUnionSnapshot,
  type VesselRecord,
} from '../examples/kaohsiung-port/data/twport';

function mk(p: Partial<VesselRecord>): VesselRecord {
  return {
    visaNo: '', nameZh: '', nameEn: '', shipType: '', wharfName: '', berthNo: null,
    status: '', etaMs: null, etdMs: null, actPortMs: null, leaveMs: null,
    beforePort: '', nextPort: '', imo: '', callSign: '', source: 'berthing', ...p,
  };
}

describe('unionKey', () => {
  it('prefers visaNo, then imo, callSign, nameEn, nameZh', () => {
    expect(unionKey(mk({ visaNo: 'V1', imo: '9', callSign: 'C', nameEn: 'E', nameZh: 'Z' }))).toBe('V1');
    expect(unionKey(mk({ imo: '9281346', callSign: 'C', nameEn: 'E' }))).toBe('9281346');
    expect(unionKey(mk({ callSign: 'VRWC7', nameEn: 'E' }))).toBe('VRWC7');
    expect(unionKey(mk({ nameEn: 'DONG FANG' }))).toBe('DONG FANG');
    expect(unionKey(mk({ nameZh: '東方廈門' }))).toBe('東方廈門');
  });
  it('trims whitespace and returns null when all keys are empty/blank', () => {
    expect(unionKey(mk({ visaNo: '  A1  ' }))).toBe('A1');
    expect(unionKey(mk({ visaNo: '   ', imo: '  ' }))).toBeNull();
    expect(unionKey(mk({}))).toBeNull();
  });
});

describe('upsertVessels', () => {
  it('de-duplicates by key (latest-wins) and skips unidentifiable records', () => {
    const m = new Map<string, VesselRecord>();
    upsertVessels(m, [mk({ visaNo: 'A1', nameZh: '舊' }), mk({ visaNo: 'A1', nameZh: '新' })]);
    upsertVessels(m, [mk({ /* no key */ shipType: '工作船' })]);
    expect(m.size).toBe(1);
    expect(m.get('A1')!.nameZh).toBe('新');
  });
  it('forecast-then-berthing order lets berthing overwrite the same key', () => {
    const m = new Map<string, VesselRecord>();
    const forecast = [mk({ visaNo: 'A1', source: 'forecast', berthNo: null })];
    const berthing = [mk({ visaNo: 'A1', source: 'berthing', berthNo: 108 })];
    upsertVessels(m, forecast);
    upsertVessels(m, berthing);
    expect(m.get('A1')!.source).toBe('berthing');
    expect(m.get('A1')!.berthNo).toBe(108);
  });
  it('merges a reloaded prior union with a new poll (restart resilience)', () => {
    const m = new Map<string, VesselRecord>();
    upsertVessels(m, [mk({ visaNo: 'OLD' })]);          // reloaded from existing snapshot
    upsertVessels(m, [mk({ visaNo: 'NEW' }), mk({ visaNo: 'OLD', nameZh: '更新' })]);
    expect(m.size).toBe(2);
    expect(m.get('OLD')!.nameZh).toBe('更新');
  });
});

describe('buildUnionSnapshot', () => {
  it('puts the full union into berthing and the last poll into forecast', () => {
    const m = new Map<string, VesselRecord>();
    upsertVessels(m, [mk({ visaNo: 'A1' }), mk({ visaNo: 'A2' })]);
    const lastForecast = [mk({ visaNo: 'F1', source: 'forecast' })];
    const snap = buildUnionSnapshot(m, lastForecast, 1750000000000);
    expect(snap.capturedAtMs).toBe(1750000000000);
    expect(snap.berthing.map((v) => v.visaNo).sort()).toEqual(['A1', 'A2']);
    expect(snap.forecast).toBe(lastForecast);
  });
});
