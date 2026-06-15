export interface TileXY { x: number; y: number; }
export interface LonLat { lon: number; lat: number; }

export const TILE_SIZE = 256;

/** Fractional Web-Mercator tile coords for a lon/lat at zoom z. */
export function lonLatToTileFloat(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

/** Integer tile index containing a lon/lat at zoom z. */
export function lonLatToTile(lon: number, lat: number, z: number): TileXY {
  const f = lonLatToTileFloat(lon, lat, z);
  return { x: Math.floor(f.x), y: Math.floor(f.y) };
}

/** Lon/lat of the NW (top-left) corner of integer tile (x,y) at zoom z. */
export function tileToLonLat(x: number, y: number, z: number): LonLat {
  const n = 2 ** z;
  const lon = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return { lon, lat };
}

export interface Bbox { s: number; w: number; n: number; e: number; }
export interface TileRange { xMin: number; xMax: number; yMin: number; yMax: number; }
export interface CompositeInfo {
  bounds: { n: number; s: number; e: number; w: number };
  sizePx: { w: number; h: number };
}

/** Inclusive tile-index range covering the bbox at zoom z. */
export function tileRangeForBbox(bbox: Bbox, z: number): TileRange {
  const nw = lonLatToTile(bbox.w, bbox.n, z); // west+north → smallest x, smallest y
  const se = lonLatToTile(bbox.e, bbox.s, z); // east+south → largest x, largest y
  return { xMin: nw.x, xMax: se.x, yMin: nw.y, yMax: se.y };
}

/** Geographic bounds + pixel size of the composite covering a tile range. */
export function compositeBounds(range: TileRange, z: number): CompositeInfo {
  const nw = tileToLonLat(range.xMin, range.yMin, z);          // NW corner of first tile
  const se = tileToLonLat(range.xMax + 1, range.yMax + 1, z);  // NW corner of tile past the last
  return {
    bounds: { n: nw.lat, w: nw.lon, s: se.lat, e: se.lon },
    sizePx: {
      w: (range.xMax - range.xMin + 1) * TILE_SIZE,
      h: (range.yMax - range.yMin + 1) * TILE_SIZE,
    },
  };
}
