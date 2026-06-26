import type { ShipCategory } from '../palette';

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

// Property keys CONFIRMED from the live MPB probe (2026-06-18) — real keys first, other common
// variants kept as tolerant fallbacks. NOTE: this feed provides COG but NO heading, and no
// LOA/beam — so headingDeg stays -1 (orientation falls back to point-to-point bearing, spec §4.3)
// and loaM/beamM stay undefined (renderer uses TYPE_DIMS_M by category). Record_Time is Taipei
// local "YYYY/MM/DD HH:mm:ss" (handled by parseAisTime).
const K = {
  mmsi: ['MMSI', 'mmsi', 'Mmsi'],
  name: ['ShipName', 'SHIPNAME', 'NAME', 'shipname', 'VESSEL_NAME', 'name'],
  type: ['Ship_and_Cargo_Type', 'TYPE', 'SHIPTYPE', 'shiptype', 'type', 'ship_type'],
  sog: ['SOG', 'sog', 'SPEED', 'speed'],
  cog: ['COG', 'cog', 'COURSE', 'course'],
  hdg: ['HEADING', 'HDG', 'heading', 'hdg'], // absent in MPB feed → headingDeg defaults to -1
  imo: ['IMO_Number', 'IMO', 'imo'],
  call: ['Call_Sign', 'CALLSIGN', 'CALL_SIGN', 'callsign'],
  time: ['Record_Time', 'LASTTIME', 'RECORD_TIME', 'UTC', 'lasttime', 'TIME', 'time', 'TIMESTAMP'],
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

export const KHH_BBOX: BBox = { s: 22.50, n: 22.66, w: 120.24, e: 120.40 };

export function inBBox(lat: number, lon: number, b: BBox): boolean {
  return lat >= b.s && lat <= b.n && lon >= b.w && lon <= b.e;
}
export function inKaohsiungBBox(lat: number, lon: number): boolean {
  return inBBox(lat, lon, KHH_BBOX);
}

/** Group pings by MMSI → AisTrack with time-sorted, same-time-deduped paths. */
export function aggregateTracks(pings: AisPing[]): AisTrack[] {
  const byMmsi = new Map<string, AisPing[]>();
  for (const p of pings) {
    const arr = byMmsi.get(p.mmsi);
    if (arr) arr.push(p); else byMmsi.set(p.mmsi, [p]);
  }
  const out: AisTrack[] = [];
  for (const [mmsi, arr] of byMmsi) {
    arr.sort((a, b) => a.recordedAtMs - b.recordedAtMs);
    const path: AisPathPoint[] = [];
    const seen = new Set<number>();
    for (const p of arr) {
      if (seen.has(p.recordedAtMs)) continue;
      seen.add(p.recordedAtMs);
      path.push([p.lat, p.lon, p.recordedAtMs, p.headingDeg]);
    }
    // identity/dims: 取最後一筆有值者 (依賴上方時間排序 / relies on the time-sort above)
    const id = { name: '', imo: '', callSign: '', aisType: 0, loaM: undefined as number | undefined, beamM: undefined as number | undefined };
    for (const p of arr) {
      if (p.name) id.name = p.name;
      if (p.imo) id.imo = p.imo;
      if (p.callSign) id.callSign = p.callSign;
      if (p.aisType) id.aisType = p.aisType;
      if (p.loaM) id.loaM = p.loaM;
      if (p.beamM) id.beamM = p.beamM;
    }
    out.push({ mmsi, ...id, path });
  }
  return out;
}

const INVALID_MMSI = new Set(['', '0', '111111111', '222222222', '999999999', '123456789']);
const MAX_KN = 40;

/** Haversine-ish metres between two lat/lon (small-distance approximation). */
function metresBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const mPerDegLat = 111_320;
  const mPerDegLon = mPerDegLat * Math.cos((aLat * Math.PI) / 180);
  const dx = (bLon - aLon) * mPerDegLon;
  const dy = (bLat - aLat) * mPerDegLat;
  return Math.hypot(dx, dy);
}

/** Implied speed (knots) between two path points; 0 if dt ≤ 0 (can't gate). */
function impliedKnots(a: AisPathPoint, b: AisPathPoint): number {
  const dtSec = (b[2] - a[2]) / 1000;
  if (dtSec <= 0) return 0;
  return (metresBetween(a[0], a[1], b[0], b[1]) / dtSec) * 1.94384;
}

/** Remove invalid MMSIs and GPS-spike points (>40 kn implied); keep stationary vessels. */
export function cleanTracks(tracks: AisTrack[]): AisTrack[] {
  const out: AisTrack[] = [];
  for (const t of tracks) {
    if (INVALID_MMSI.has(t.mmsi) || !/^\d{6,9}$/.test(t.mmsi)) continue;
    const src = t.path;
    const path: AisPathPoint[] = [];
    // Leading-spike disambiguation: the forward gate below drops the *current* point,
    // so a spiky path[0] would survive and (wrongly) drop the legitimate path[1].
    // If path[0]→path[1] is implausible but path[1]→path[2] is plausible, path[0] is the
    // outlier ⇒ drop it and seed the reference at path[1].
    let startIdx = 0;
    if (src.length >= 2 && impliedKnots(src[0], src[1]) > MAX_KN) {
      if (src.length >= 3 && impliedKnots(src[1], src[2]) <= MAX_KN) {
        startIdx = 1; // path[0] is the outlier → skip it
      }
    }
    for (let i = startIdx; i < src.length; i++) {
      const pt = src[i];
      const prev = path[path.length - 1];
      if (prev && impliedKnots(prev, pt) > MAX_KN) continue; // 跳點:丟此點,保留 prev
      path.push(pt);
    }
    if (path.length > 0) out.push({ ...t, path });
  }
  return out;
}

export type NonVesselReason =
  | 'aton' | 'handheld-sart' | 'sar-aircraft' | 'anomalous-mmsi' | 'buoy-name' | 'garbled';

// Fishing-net AIS markers / buoys: name contains BUOY, or ends with a battery
// percentage like "-93%" / "--49%". (Bare "NET" intentionally NOT matched — the
// %-suffix already catches Taiwan net markers, and "NET" would false-hit names
// like PLANET; verified zero difference on real data 2026-06-19.)
const BUOY_NAME = /BUOY|--?\d{1,2}%/i;

/** Classify an AIS target as a real vessel or non-vessel noise (buoy / handheld /
 *  corrupt). Rules from ITU-R M.585 (MMSI prefixes) + M.1371 (type codes) + the
 *  Taiwan fishing-net-marker naming convention. See spec 2026-06-26. */
export function classifyAisTarget(
  t: Pick<AisTrack, 'mmsi' | 'name' | 'aisType'>,
): { vessel: boolean; reason: NonVesselReason | '' } {
  const m = String(t.mmsi ?? '').trim();
  const name = String(t.name ?? '').trim();
  // MMSI-based (highest confidence, ITU-R M.585)
  if (/^99\d{7}$/.test(m)) return { vessel: false, reason: 'aton' };
  if (/^8\d{8}$/.test(m) || /^97[024]\d{6}$/.test(m)) return { vessel: false, reason: 'handheld-sart' };
  if (/^111\d{6}$/.test(m)) return { vessel: false, reason: 'sar-aircraft' };
  if (!/^[2-7]\d{8}$/.test(m)) return { vessel: false, reason: 'anomalous-mmsi' };
  // Name-based (Taiwan net markers on otherwise-legit MMSIs)
  if (BUOY_NAME.test(name)) return { vessel: false, reason: 'buoy-name' };
  // Corrupt transmission: illegal AIS type code (>99) AND a garbled name.
  if (t.aisType > 99) {
    const junk = (name.match(/[^A-Za-z0-9 .\-一-鿿]/g) || []).length;
    if (junk >= 2) return { vessel: false, reason: 'garbled' };
  }
  return { vessel: true, reason: '' };
}

export function isVessel(t: Pick<AisTrack, 'mmsi' | 'name' | 'aisType'>): boolean {
  return classifyAisTarget(t).vessel;
}

/** AIS ship-type code (0–99) → coarse category. AIS can't split container/bulk/LNG;
 *  callers should prefer TWPort SHIP_TYPE_NAME when a join exists (see data/join.ts). */
export function mapAisTypeToCategory(code: number): ShipCategory {
  if (code >= 80 && code <= 89) return '油品';
  if (code >= 70 && code <= 79) return '散雜';
  if (code >= 60 && code <= 69) return '客運';
  if (code === 35) return '軍艦';
  if ((code >= 30 && code <= 32) || (code >= 50 && code <= 59)) return '工作';
  return '其他';
}

/** Pings → cleaned, aggregated tracks file with meta. */
export function buildTracksFile(pings: AisPing[]): AisTracksFile {
  const ships = cleanTracks(aggregateTracks(pings));
  let fromMs = Infinity, toMs = -Infinity;
  for (const s of ships) for (const p of s.path) {
    if (p[2] < fromMs) fromMs = p[2];
    if (p[2] > toMs) toMs = p[2];
  }
  if (!Number.isFinite(fromMs)) { fromMs = 0; toMs = 0; }
  return { meta: { fromMs, toMs, count: ships.length, bbox: KHH_BBOX }, ships };
}
