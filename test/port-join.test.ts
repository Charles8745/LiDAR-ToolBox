import { describe, it, expect } from 'vitest';
import { joinTwport, categoryForTrack } from '../examples/kaohsiung-port/data/join';
import type { VesselRecord } from '../examples/kaohsiung-port/data/twport';
import type { AisTrack } from '../examples/kaohsiung-port/data/ais';

function rec(p: Partial<VesselRecord>): VesselRecord {
  return { visaNo: '', nameZh: '', nameEn: '', shipType: '', wharfName: '', berthNo: null, status: '',
    etaMs: null, etdMs: null, actPortMs: null, leaveMs: null, beforePort: '', nextPort: '', imo: '',
    callSign: '', source: 'berthing', ...p };
}
const trk = (p: Partial<AisTrack>): AisTrack =>
  ({ mmsi: 'A', imo: '', callSign: '', name: '', aisType: 0, path: [], ...p });

describe('joinTwport', () => {
  const vessels = [rec({ nameZh: '長榮', imo: '9811000', callSign: 'BMXX', shipType: '全貨櫃船' })];
  it('joins by IMO first', () => {
    expect(joinTwport(trk({ imo: '9811000' }), vessels)?.nameZh).toBe('長榮');
  });
  it('falls back to call sign', () => {
    expect(joinTwport(trk({ imo: '', callSign: 'BMXX' }), vessels)?.nameZh).toBe('長榮');
  });
  it('falls back to ship name', () => {
    expect(joinTwport(trk({ name: '長榮' }), vessels)?.nameZh).toBe('長榮');
  });
  it('returns null when nothing matches', () => {
    expect(joinTwport(trk({ imo: '0000' }), vessels)).toBeNull();
  });
});

describe('categoryForTrack', () => {
  const vessels = [rec({ imo: '9811000', shipType: '全貨櫃船' })];
  it('prefers TWPort ship type when joined', () => {
    expect(categoryForTrack(trk({ imo: '9811000', aisType: 80 }), vessels)).toBe('貨櫃');
  });
  it('falls back to AIS type code when no join', () => {
    expect(categoryForTrack(trk({ imo: '0000', aisType: 80 }), vessels)).toBe('油品');
  });
});
