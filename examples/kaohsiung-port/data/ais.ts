export interface BBox { s: number; n: number; w: number; e: number; }

export interface AisPing {
  mmsi: string;
  lat: number; lon: number;
  sogKn: number; cogDeg: number; headingDeg: number;
  aisType: number;
  name: string; imo: string; callSign: string;
  loaM?: number; beamM?: number;
  recordedAtMs: number;
}

export type AisPathPoint = [number, number, number, number]; // [lat, lon, tMs, hdgDeg]

export interface AisTrack {
  mmsi: string; imo: string; callSign: string; name: string;
  aisType: number; loaM?: number; beamM?: number;
  path: AisPathPoint[];
}

export interface AisTracksFile {
  meta: { fromMs: number; toMs: number; count: number; bbox: BBox };
  ships: AisTrack[];
}

const TAIPEI_OFFSET_H = 8;

/** Parse AIS report time → epoch ms. Accepts epoch sec/ms numbers or "YYYY-MM-DD HH:mm:ss" (UTC+8). */
export function parseAisTime(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw > 1e12 ? raw : raw * 1000; // >1e12 已是 ms
  }
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) { const n = Number(s); return Number.isFinite(n) && n > 0 ? (n > 1e12 ? n : n * 1000) : null; }
  const [, y, mo, d, hh, mi, se] = m;
  return Date.UTC(+y, +mo - 1, +d, +hh - TAIPEI_OFFSET_H, +mi, +(se ?? 0));
}

// Candidate property keys (confirmed/extended from Task 0 probe). Tolerant of name variants.
const K = {
  mmsi: ['MMSI', 'mmsi', 'Mmsi'],
  name: ['SHIPNAME', 'NAME', 'shipname', 'VESSEL_NAME', 'name'],
  type: ['TYPE', 'SHIPTYPE', 'shiptype', 'type', 'ship_type'],
  sog: ['SOG', 'sog', 'SPEED', 'speed'],
  cog: ['COG', 'cog', 'COURSE', 'course'],
  hdg: ['HEADING', 'HDG', 'heading', 'hdg'],
  imo: ['IMO', 'imo'],
  call: ['CALLSIGN', 'CALL_SIGN', 'callsign'],
  time: ['LASTTIME', 'RECORD_TIME', 'UTC', 'lasttime', 'TIME', 'time', 'TIMESTAMP'],
  loa: ['LENGTH', 'LOA', 'length'],
  beam: ['WIDTH', 'BEAM', 'width'],
} as const;

function pick(props: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const k of keys) if (props[k] != null && props[k] !== '') return props[k];
  return undefined;
}
const num = (v: unknown, dflt: number): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : dflt;
};
const str = (v: unknown): string => (v == null ? '' : String(v).trim());

/** Parse one GeoJSON feature → AisPing, or null if MMSI/coords are missing. */
export function parseAisFeature(feature: unknown): AisPing | null {
  const f = feature as { geometry?: { coordinates?: [number, number] }; properties?: Record<string, unknown> };
  const coords = f?.geometry?.coordinates;
  const props = f?.properties;
  if (!props || !Array.isArray(coords) || coords.length < 2) return null;
  const mmsi = str(pick(props, K.mmsi));
  if (!mmsi) return null;
  const [lon, lat] = coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const loa = num(pick(props, K.loa), -1);
  const beam = num(pick(props, K.beam), -1);
  return {
    mmsi, lat, lon,
    sogKn: num(pick(props, K.sog), 0),
    cogDeg: num(pick(props, K.cog), -1),
    headingDeg: num(pick(props, K.hdg), -1),
    aisType: num(pick(props, K.type), 0),
    name: str(pick(props, K.name)),
    imo: str(pick(props, K.imo)),
    callSign: str(pick(props, K.call)),
    loaM: loa > 0 ? loa : undefined,
    beamM: beam > 0 ? beam : undefined,
    recordedAtMs: parseAisTime(pick(props, K.time)) ?? 0,
  };
}
