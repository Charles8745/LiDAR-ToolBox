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
