import { describe, it, expect } from 'vitest';
import { parseAisFeature, parseAisTime } from '../examples/kaohsiung-port/data/ais';

const feature = (props: Record<string, unknown>, coords: [number, number] = [120.30, 22.60]) => ({
  type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: props,
});

describe('parseAisTime', () => {
  it('parses UTC+8 "YYYY-MM-DD HH:mm:ss" to epoch ms', () => {
    // 2026-02-18 08:00:00 (Taipei) === 2026-02-18 00:00:00 UTC
    expect(parseAisTime('2026-02-18 08:00:00')).toBe(Date.UTC(2026, 1, 18, 0, 0, 0));
  });
  it('parses epoch-second numbers', () => {
    expect(parseAisTime(1771300800)).toBe(1771300800 * 1000);
  });
  it('returns null on garbage', () => {
    expect(parseAisTime('not-a-date')).toBeNull();
    expect(parseAisTime('')).toBeNull();
  });
});

describe('parseAisFeature', () => {
  it('reads lon/lat from geometry and core fields from properties', () => {
    const p = parseAisFeature(feature({
      MMSI: '416000123', SHIPNAME: 'EVER GIVEN', TYPE: 70, SOG: 12.3, COG: 181.2,
      HEADING: 180, IMO: '9811000', CALLSIGN: 'BMXX', LASTTIME: '2026-02-18 08:00:00',
    }));
    expect(p).not.toBeNull();
    expect(p!.mmsi).toBe('416000123');
    expect(p!.lat).toBeCloseTo(22.60);
    expect(p!.lon).toBeCloseTo(120.30);
    expect(p!.aisType).toBe(70);
    expect(p!.sogKn).toBeCloseTo(12.3);
    expect(p!.headingDeg).toBe(180);
    expect(p!.imo).toBe('9811000');
    expect(p!.recordedAtMs).toBe(Date.UTC(2026, 1, 18, 0, 0, 0));
  });
  it('tolerates missing optional fields with safe defaults', () => {
    const p = parseAisFeature(feature({ MMSI: '999' }));
    expect(p!.sogKn).toBe(0);
    expect(p!.cogDeg).toBe(-1);
    expect(p!.headingDeg).toBe(-1);
    expect(p!.aisType).toBe(0);
    expect(p!.name).toBe('');
  });
  it('returns null when MMSI or coordinates are absent', () => {
    expect(parseAisFeature(feature({ SHIPNAME: 'x' }, undefined as any))).toBeNull();
    expect(parseAisFeature({ type: 'Feature', geometry: null, properties: { MMSI: '1' } } as any)).toBeNull();
  });
});

import { inKaohsiungBBox, KHH_BBOX } from '../examples/kaohsiung-port/data/ais';

describe('KHH bbox', () => {
  it('accepts a point inside the port', () => {
    expect(inKaohsiungBBox(22.60, 120.30)).toBe(true);
  });
  it('rejects points outside', () => {
    expect(inKaohsiungBBox(25.04, 121.51)).toBe(false); // 台北
    expect(inKaohsiungBBox(22.60, 120.10)).toBe(false); // 偏西
  });
  it('treats on-edge points as inside (inclusive boundaries)', () => {
    expect(inKaohsiungBBox(22.50, 120.24)).toBe(true); // SW corner
  });
  it('KHH_BBOX matches spec defaults', () => {
    expect(KHH_BBOX).toEqual({ s: 22.50, n: 22.66, w: 120.24, e: 120.40 });
  });
});

import { aggregateTracks } from '../examples/kaohsiung-port/data/ais';
import type { AisPing } from '../examples/kaohsiung-port/data/ais';

const ping = (p: Partial<AisPing>): AisPing => ({
  mmsi: '1', lat: 22.6, lon: 120.3, sogKn: 0, cogDeg: -1, headingDeg: -1, aisType: 0,
  name: '', imo: '', callSign: '', recordedAtMs: 0, ...p,
});

describe('aggregateTracks', () => {
  it('groups pings by mmsi into time-sorted paths', () => {
    const tracks = aggregateTracks([
      ping({ mmsi: 'A', lat: 22.61, lon: 120.31, recordedAtMs: 2000, headingDeg: 90 }),
      ping({ mmsi: 'A', lat: 22.60, lon: 120.30, recordedAtMs: 1000, headingDeg: 80 }),
      ping({ mmsi: 'B', lat: 22.55, lon: 120.33, recordedAtMs: 1500 }),
    ]);
    expect(tracks).toHaveLength(2);
    const a = tracks.find((t) => t.mmsi === 'A')!;
    expect(a.path.map((p) => p[2])).toEqual([1000, 2000]); // 升序
    expect(a.path[0]).toEqual([22.60, 120.30, 1000, 80]);
  });
  it('dedupes points sharing the same recordedAtMs (keeps first seen)', () => {
    const tracks = aggregateTracks([
      ping({ mmsi: 'A', lat: 22.60, lon: 120.30, recordedAtMs: 1000 }),
      ping({ mmsi: 'A', lat: 22.61, lon: 120.31, recordedAtMs: 1000 }),
    ]);
    expect(tracks[0].path).toHaveLength(1);
    expect(tracks[0].path[0]).toEqual([22.60, 120.30, 1000, -1]);
  });
  it('carries latest non-empty identity/dims onto the track', () => {
    const [t] = aggregateTracks([
      ping({ mmsi: 'A', recordedAtMs: 1000, name: '', imo: '' }),
      ping({ mmsi: 'A', recordedAtMs: 2000, name: 'EVER', imo: '9811000', aisType: 70, loaM: 300, beamM: 45 }),
    ]);
    expect(t.name).toBe('EVER');
    expect(t.imo).toBe('9811000');
    expect(t.aisType).toBe(70);
    expect(t.loaM).toBe(300);
  });
});

import { cleanTracks } from '../examples/kaohsiung-port/data/ais';
import type { AisTrack } from '../examples/kaohsiung-port/data/ais';

const trk = (mmsi: string, path: [number, number, number, number][]): AisTrack =>
  ({ mmsi, imo: '', callSign: '', name: '', aisType: 0, path });

describe('cleanTracks', () => {
  it('keeps stationary vessels (sog≈0 berthed ships must survive)', () => {
    const t = trk('416000123', [[22.60, 120.30, 1000, 10], [22.60, 120.30, 60_000, 10]]);
    expect(cleanTracks([t])).toHaveLength(1);
    expect(cleanTracks([t])[0].path).toHaveLength(2);
  });
  it('drops a GPS spike point (implied speed > 40 kn)', () => {
    // 0.5° lat ≈ 55 km in 60 s ⇒ absurd speed ⇒ middle point dropped
    const t = trk('416000123', [[22.60, 120.30, 0, 10], [23.10, 120.30, 60_000, 10], [22.60, 120.31, 120_000, 10]]);
    const cleaned = cleanTracks([t]);
    expect(cleaned[0].path).toHaveLength(2);
    expect(cleaned[0].path.some((p) => p[0] === 23.10)).toBe(false);
  });
  it('drops a leading GPS spike (first point), keeping the good tail', () => {
    // path[0]→path[1] is absurd, but path[1]→path[2] is plausible ⇒ path[0] is the outlier
    const t = trk('416000123', [[25.0, 120.30, 0, 0], [22.60, 120.30, 60_000, 0], [22.601, 120.301, 120_000, 0]]);
    const cleaned = cleanTracks([t]);
    expect(cleaned[0].path).toHaveLength(2);
    expect(cleaned[0].path.some((p) => p[0] === 25.0)).toBe(false);
    expect(cleaned[0].path[0]).toEqual([22.60, 120.30, 60_000, 0]);
    expect(cleaned[0].path[1]).toEqual([22.601, 120.301, 120_000, 0]);
  });
  it('drops invalid/test MMSIs', () => {
    expect(cleanTracks([trk('111111111', [[22.6, 120.3, 0, 0]])])).toHaveLength(0);
    expect(cleanTracks([trk('', [[22.6, 120.3, 0, 0]])])).toHaveLength(0);
  });
  it('drops tracks left with no points', () => {
    expect(cleanTracks([trk('416000123', [])])).toHaveLength(0);
  });
});

import { mapAisTypeToCategory } from '../examples/kaohsiung-port/data/ais';

describe('mapAisTypeToCategory', () => {
  it('maps AIS ship-type codes to our coarse categories', () => {
    expect(mapAisTypeToCategory(85)).toBe('油品'); // tanker 80–89
    expect(mapAisTypeToCategory(74)).toBe('散雜'); // cargo 70–79
    expect(mapAisTypeToCategory(60)).toBe('客運'); // passenger 60–69
    expect(mapAisTypeToCategory(35)).toBe('軍艦'); // military
    expect(mapAisTypeToCategory(52)).toBe('工作'); // tug
    expect(mapAisTypeToCategory(30)).toBe('工作'); // fishing
    expect(mapAisTypeToCategory(0)).toBe('其他');
    expect(mapAisTypeToCategory(99)).toBe('其他');
  });
});

import { buildTracksFile } from '../examples/kaohsiung-port/data/ais';

describe('buildTracksFile', () => {
  it('aggregates+cleans pings into a tracks file with meta time range', () => {
    const pings: AisPing[] = [
      ping({ mmsi: '416000001', lat: 22.60, lon: 120.30, recordedAtMs: 1000 }),
      ping({ mmsi: '416000001', lat: 22.601, lon: 120.301, recordedAtMs: 61_000 }),
      ping({ mmsi: '416000002', lat: 22.55, lon: 120.33, recordedAtMs: 30_000 }),
    ];
    const file = buildTracksFile(pings);
    expect(file.ships).toHaveLength(2);
    expect(file.meta.count).toBe(2);
    expect(file.meta.fromMs).toBe(1000);
    expect(file.meta.toMs).toBe(61_000);
    expect(file.meta.bbox).toBeDefined();
  });
});

import { classifyAisTarget, isVessel } from '../examples/kaohsiung-port/data/ais';

const tgt = (mmsi: string, name: string, aisType = 0) => ({ mmsi, name, aisType });

describe('classifyAisTarget / isVessel', () => {
  it('keeps a normal Taiwan vessel (MMSI 416, plain name)', () => {
    expect(classifyAisTarget(tgt('416005912', 'KMSC NO502', 52))).toEqual({ vessel: true, reason: '' });
    expect(isVessel(tgt('416005912', 'KMSC NO502', 52))).toBe(true);
  });
  it('keeps a foreign vessel (MMSI first digit 2-7)', () => {
    expect(isVessel(tgt('249123456', 'BOKA CENTRE', 52))).toBe(true);
  });
  it('drops AtoN navigation aids (MMSI 99x)', () => {
    expect(classifyAisTarget(tgt('994160462', 'BUOY4314601', 0))).toEqual({ vessel: false, reason: 'aton' });
  });
  it('drops handheld VHF (MMSI 8x, 9 digits)', () => {
    expect(classifyAisTarget(tgt('888160001', '', 0))).toEqual({ vessel: false, reason: 'handheld-sart' });
  });
  it('drops SART/MOB/EPIRB (MMSI 970/972/974)', () => {
    expect(classifyAisTarget(tgt('972123456', '', 0)).reason).toBe('handheld-sart');
  });
  it('drops SAR aircraft (MMSI 111x)', () => {
    expect(classifyAisTarget(tgt('111232001', '', 0)).reason).toBe('sar-aircraft');
  });
  it('drops anomalous MMSI (not a 9-digit 2-7 station)', () => {
    expect(classifyAisTarget(tgt('904160462', '', 0)).reason).toBe('anomalous-mmsi');
    expect(classifyAisTarget(tgt('12345678', 'NEWLINE', 0)).reason).toBe('anomalous-mmsi');
  });
  it('drops fishing-net markers by name (battery % suffix) even on a legit MMSI', () => {
    expect(classifyAisTarget(tgt('416005111', '5897-07-93%', 0)).reason).toBe('buoy-name');
    expect(classifyAisTarget(tgt('416005112', 'HSD-NET-60%', 0)).reason).toBe('buoy-name');
    expect(classifyAisTarget(tgt('416005113', 'LONGLINEBUOY-T00881%', 0)).reason).toBe('buoy-name');
  });
  it('drops garbled names only when AIS code is illegal (>99)', () => {
    expect(classifyAisTarget(tgt('590123456', 'H3OL7CL20L0SL<2,F3/\\\\', 200)).reason).toBe('garbled');
  });
  it('keeps a plain-named code-0 unknown vessel', () => {
    expect(isVessel(tgt('416123456', 'TRITON 8', 0))).toBe(true);
  });
  it('does not flag a normal name with a single punctuation as garbled', () => {
    expect(isVessel(tgt('416123456', 'DER JIN TSAIR NO3', 0))).toBe(true);
  });
});

describe('buildTracksFile non-vessel filtering', () => {
  it('drops non-vessel pings and records the count in meta', () => {
    const out = buildTracksFile([
      ping({ mmsi: '416005912', name: 'REAL SHIP', aisType: 70, lat: 22.60, lon: 120.30, recordedAtMs: 1000 }),   // keep
      ping({ mmsi: '994160462', name: 'BUOY4314601', aisType: 0, lat: 22.60, lon: 120.30, recordedAtMs: 1000 }),  // drop: aton
      ping({ mmsi: '416005111', name: '5897-07-93%', aisType: 0, lat: 22.60, lon: 120.30, recordedAtMs: 1000 }),  // drop: buoy-name
    ]);
    expect(out.ships.map((s) => s.mmsi)).toEqual(['416005912']);
    expect(out.meta.count).toBe(1);
    expect(out.meta.droppedNonVessel).toBe(2);
  });
});

import { refilterTracksFile } from '../examples/kaohsiung-port/data/ais';

const track = (mmsi: string, name: string, aisType: number) => ({
  mmsi, imo: '', callSign: '', name, aisType, path: [[22.6, 120.3, 1, -1]] as [number, number, number, number][],
});

describe('refilterTracksFile', () => {
  const dirty = {
    meta: { fromMs: 1, toMs: 2, count: 3, bbox: { s: 22.5, n: 22.66, w: 120.24, e: 120.4 }, droppedNonVessel: 0 },
    ships: [track('416005912', 'REAL', 70), track('994160462', 'BUOY1', 0), track('416005111', 'X-07-93%', 0)],
  };
  it('removes non-vessels and tallies reasons', () => {
    const { file, dropped } = refilterTracksFile(dirty);
    expect(file.ships).toHaveLength(1);
    expect(file.meta.count).toBe(1);
    expect(file.meta.droppedNonVessel).toBe(2);
    expect(dropped.aton).toBe(1);
    expect(dropped['buoy-name']).toBe(1);
  });
  it('is idempotent on already-clean data', () => {
    const { file } = refilterTracksFile(dirty);
    const { file: again, dropped } = refilterTracksFile(file);
    expect(again.ships).toHaveLength(1);
    expect(Object.values(dropped).reduce((a, b) => a + b, 0)).toBe(0);
  });
});
