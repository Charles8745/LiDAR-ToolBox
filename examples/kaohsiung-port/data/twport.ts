export interface VesselRecord {
  visaNo: string;
  nameZh: string;
  nameEn: string;
  shipType: string;
  wharfName: string;
  berthNo: number | null;
  status: string;
  etaMs: number | null;
  etdMs: number | null;
  actPortMs: number | null;
  leaveMs: number | null;
  beforePort: string;
  nextPort: string;
  imo: string;
  callSign: string;
  source: 'berthing' | 'forecast';
}

const TAIPEI_OFFSET_H = 8;

/** Parse `M/D/YYYY h:mm:ss AM/PM` (Asia/Taipei, fixed UTC+8) → epoch ms, or null. */
export function parseTaipeiDate(s: string): number | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  const [, mo, d, y, hh, mi, se, ap] = m;
  let h = parseInt(hh, 10) % 12;
  if (/PM/i.test(ap)) h += 12;
  return Date.UTC(+y, +mo - 1, +d, h - TAIPEI_OFFSET_H, +mi, +se);
}

/** Berth number from WHARF_NAME (`#108碼頭`) or WHARF_CODE (`KHHX108X`); null = outer/anchorage. */
export function parseBerthNo(wharfName: string, wharfCode: string): number | null {
  const byName = wharfName.match(/#?(\d+)\s*碼頭/);
  if (byName) return parseInt(byName[1], 10);
  const byCode = wharfCode.match(/^KHHX0*(\d+)X$/);
  if (byCode) return parseInt(byCode[1], 10);
  return null;
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : '';
}

export function parseTwportXml(xml: string, source: 'berthing' | 'forecast'): VesselRecord[] {
  const out: VesselRecord[] = [];
  for (const m of xml.matchAll(/<SHIP>([\s\S]*?)<\/SHIP>/g)) {
    const b = m[1];
    const wharfName = tag(b, 'WHARF_NAME');
    const wharfCode = tag(b, 'WHARF_CODE');
    out.push({
      visaNo: tag(b, 'VISA_NO'),
      nameZh: tag(b, 'VESSEL_CNAME'),
      nameEn: tag(b, 'VESSEL_ENAME'),
      shipType: tag(b, 'SHIP_TYPE_NAME'),
      wharfName,
      berthNo: parseBerthNo(wharfName, wharfCode),
      status: tag(b, 'STATUS'),
      etaMs: parseTaipeiDate(tag(b, 'ETA_DT')),
      etdMs: parseTaipeiDate(tag(b, 'ETD_DT')),
      actPortMs: parseTaipeiDate(tag(b, 'ACT_PORT_DT')),
      leaveMs: parseTaipeiDate(tag(b, 'LEAVE_DT')),
      beforePort: tag(b, 'BEFORE_PORT'),
      nextPort: tag(b, 'NEXT_PORT'),
      imo: tag(b, 'IMO'),
      callSign: tag(b, 'CALL_SIGN'),
      source,
    });
  }
  return out;
}
