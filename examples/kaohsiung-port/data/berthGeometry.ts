/** One berth's static geometry, parsed from the official KHB GetMarker feed. */
export interface BerthMarker {
  code: string;   // official pier code (typically 4 digits, occasionally alphanumeric e.g. 126B)
  lat: number;    // midpoint of the two surveyed berth endpoints (WGS84)
  lon: number;
  angle: number;  // berth orientation in degrees (informational; from ANGLE)
  nameZh: string; // last-seen vessel name at the berth (informational; may be '')
}

interface RawVessel {
  PIER?: string;
  LAT1?: number | string | null; LONG1?: number | string | null;
  LAT2?: number | string | null; LONG2?: number | string | null;
  ANGLE?: number | string | null; SP_NAME?: string | null;
}

/**
 * Parse the (already JSON-decoded) GetMarker `d` object into distinct berth markers.
 * `v` is the occupied-vessel array; each entry carries its berth's surveyed endpoints.
 * Distinct by PIER (latest-wins); entries without a code or without endpoint 1 are skipped.
 */
export function parseGetMarker(raw: { v?: unknown[] }): BerthMarker[] {
  const map = new Map<string, BerthMarker>();
  for (const item of (raw.v ?? []) as RawVessel[]) {
    const code = String(item.PIER ?? '').trim();
    if (!code) continue;
    // Check that LAT1 and LONG1 are provided and finite before proceeding
    if (item.LAT1 == null || item.LONG1 == null) continue;
    const lat1 = Number(item.LAT1), lon1 = Number(item.LONG1);
    if (!Number.isFinite(lat1) || !Number.isFinite(lon1)) continue;
    let lat2 = Number(item.LAT2), lon2 = Number(item.LONG2);
    if (!Number.isFinite(lat2) || !Number.isFinite(lon2)) { lat2 = lat1; lon2 = lon1; }
    map.set(code, {
      code,
      lat: (lat1 + lat2) / 2,
      lon: (lon1 + lon2) / 2,
      angle: Number(item.ANGLE) || 0,
      nameZh: String(item.SP_NAME ?? '').trim(),
    });
  }
  return [...map.values()];
}

/** Union new markers into an existing map, latest-wins by `code`. */
export function upsertBerths(map: Map<string, BerthMarker>, markers: BerthMarker[]): void {
  for (const m of markers) map.set(m.code, m);
}

export interface Bbox { n: number; s: number; w: number; e: number }

/** Keep only markers whose lat/lon fall within the bbox (inclusive). */
export function filterToBbox(markers: BerthMarker[], bbox: Bbox): BerthMarker[] {
  return markers.filter(
    (m) => m.lat >= bbox.s && m.lat <= bbox.n && m.lon >= bbox.w && m.lon <= bbox.e,
  );
}

/**
 * Display form of a berth code: strip the leading "1" series prefix (and any leading
 * zeros) from the main 4-char 1xxx codes so labels read as the colloquial berth number
 * ("1066"→"66", "1201"→"201", "126B"→"26B", "1001"→"1"). Other series (0003, 4021, …)
 * are kept verbatim to avoid collisions (e.g. 1021→"21" vs 4021 kept as "4021").
 */
export function shortBerthLabel(code: string): string {
  if (code.length === 4 && code[0] === '1') {
    const r = code.slice(1).replace(/^0+/, '');
    return r === '' ? '0' : r;
  }
  return code;
}
