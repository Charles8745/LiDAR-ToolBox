import { describe, it, expect } from 'vitest';
import { parseTwportXml, parseTaipeiDate, parseBerthNo } from '../examples/kaohsiung-port/data/twport';

const FIXTURE = `<?xml version="1.0"?><OPEN_DATA><DESCRIPTION>x</DESCRIPTION><SHIPS>
<SHIP><PORT>KHH</PORT><VISA_NO>A1</VISA_NO><STATUS>進港</STATUS>
  <VESSEL_CNAME>東方廈門</VESSEL_CNAME><VESSEL_ENAME>DONG FANG XIAMEN</VESSEL_ENAME>
  <WHARF_CODE>KHHX108X</WHARF_CODE><WHARF_NAME>#108碼頭</WHARF_NAME>
  <ETA_DT>6/15/2026 7:00:00 AM</ETA_DT><ETD_DT>6/15/2026 7:30:00 PM</ETD_DT>
  <SHIP_TYPE_NAME>全貨櫃船</SHIP_TYPE_NAME><BEFORE_PORT>TWTXG Taichung</BEFORE_PORT>
  <NEXT_PORT>CNFOC Fuzhou</NEXT_PORT><IMO>9281346</IMO><CALL_SIGN>VRWC7</CALL_SIGN></SHIP>
<SHIP><PORT>KHH</PORT><VISA_NO>A2</VISA_NO><STATUS>移泊</STATUS>
  <VESSEL_CNAME>大林8號</VESSEL_CNAME><VESSEL_ENAME></VESSEL_ENAME>
  <WHARF_CODE>KHHL005X</WHARF_CODE><WHARF_NAME>二港口港外(防波堤外)</WHARF_NAME>
  <SHIP_TYPE_NAME>工作船</SHIP_TYPE_NAME></SHIP>
</SHIPS></OPEN_DATA>`;

describe('parseTaipeiDate', () => {
  it('parses M/D/YYYY h:mm:ss AM/PM as Asia/Taipei (UTC+8)', () => {
    expect(parseTaipeiDate('6/15/2026 7:00:00 AM')).toBe(Date.UTC(2026, 5, 15, 7 - 8, 0, 0));
  });
  it('handles 12 PM / 12 AM and empty', () => {
    expect(parseTaipeiDate('1/1/2026 12:00:00 PM')).toBe(Date.UTC(2026, 0, 1, 12 - 8, 0, 0));
    expect(parseTaipeiDate('1/1/2026 12:00:00 AM')).toBe(Date.UTC(2026, 0, 1, 0 - 8, 0, 0));
    expect(parseTaipeiDate('')).toBeNull();
  });
});

describe('parseBerthNo', () => {
  it('reads the berth number from WHARF_NAME', () => {
    expect(parseBerthNo('#108碼頭', 'KHHX108X')).toBe(108);
  });
  it('falls back to WHARF_CODE digits', () => {
    expect(parseBerthNo('', 'KHHX022X')).toBe(22);
  });
  it('returns null for outer/anchorage berths', () => {
    expect(parseBerthNo('二港口港外(防波堤外)', 'KHHL005X')).toBeNull();
  });
});

describe('parseTwportXml', () => {
  const recs = parseTwportXml(FIXTURE, 'berthing');
  it('extracts one record per SHIP with normalized fields', () => {
    expect(recs).toHaveLength(2);
    expect(recs[0]).toMatchObject({
      nameZh: '東方廈門', nameEn: 'DONG FANG XIAMEN', shipType: '全貨櫃船',
      berthNo: 108, status: '進港', beforePort: 'TWTXG Taichung', nextPort: 'CNFOC Fuzhou',
      imo: '9281346', source: 'berthing',
    });
    expect(recs[0].etaMs).toBe(Date.UTC(2026, 5, 15, 7 - 8, 0, 0));
  });
  it('marks outer berths with berthNo null', () => {
    expect(recs[1].berthNo).toBeNull();
  });
});
