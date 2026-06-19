import { parseTwportXml, type VesselRecord } from './twport';

const BASE = 'https://tpnet.twport.com.tw/IFAWeb/Reports/OpenData/GetOpenData';

// Module-level decoder: fails fast on unsupported encoding instead of silently retrying.
const BIG5 = new TextDecoder('big5');

async function fetchType(type: number, source: 'berthing' | 'forecast'): Promise<VesselRecord[]> {
  const url = `${BASE}?port=KHH&type=${type}`;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`TWPort type=${type} HTTP ${res.status}`);
      const xml = BIG5.decode(await res.arrayBuffer());
      const records = parseTwportXml(xml, source);
      if (source === 'berthing' && records.length === 0) {
        throw new Error(`TWPort type=${type} returned no <SHIP> records (${xml.length} bytes) — likely a maintenance/error page`);
      }
      return records;
    } catch (e) {
      lastErr = e;
      if (attempt < 3) {
        console.warn(`attempt ${attempt} failed for type=${type}, retrying...`);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  }
  throw lastErr;
}

/** Fetch one TWPort snapshot (berthing=type1, forecast=type5). Throws after retries. No file IO. */
export async function fetchTwportSnapshot(): Promise<{ berthing: VesselRecord[]; forecast: VesselRecord[] }> {
  const berthing = await fetchType(1, 'berthing');
  const forecast = await fetchType(5, 'forecast');
  return { berthing, forecast };
}
