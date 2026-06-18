import type { VesselRecord } from './twport';
import type { AisTrack } from './ais';
import { mapAisTypeToCategory } from './ais';
import { SHIP_CATEGORIES, shipCategoryIndex } from '../palette';
import type { ShipCategory } from '../palette';

/** Match an AIS track to a TWPort record: IMO → call sign → ship name. Null if none. */
export function joinTwport(track: AisTrack, vessels: VesselRecord[]): VesselRecord | null {
  if (track.imo) { const m = vessels.find((v) => v.imo && v.imo === track.imo); if (m) return m; }
  if (track.callSign) { const m = vessels.find((v) => v.callSign && v.callSign === track.callSign); if (m) return m; }
  const n = track.name.trim().toUpperCase();
  if (n) {
    const nameZh = track.name.trim();
    const m = vessels.find(
      (v) => (v.nameEn.trim() && v.nameEn.trim().toUpperCase() === n) || (v.nameZh.trim() && v.nameZh.trim() === nameZh),
    );
    if (m) return m;
  }
  return null;
}

/** Category for a track: prefer joined TWPort ship type, else AIS type code. */
export function categoryForTrack(track: AisTrack, vessels: VesselRecord[]): ShipCategory {
  const v = joinTwport(track, vessels);
  if (v && v.shipType) return SHIP_CATEGORIES[shipCategoryIndex(v.shipType)] as ShipCategory;
  return mapAisTypeToCategory(track.aisType);
}
