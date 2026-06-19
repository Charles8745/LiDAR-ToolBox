export interface World { x: number; z: number; }
export interface Projection { toWorld(lat: number, lon: number): World; }

const M_PER_DEG_LAT = 111320;

/** Local equirectangular projection around an origin. North = -z, East = +x. */
export function createProjection(originLat: number, originLon: number, scale = 0.01): Projection {
  const mPerLon = M_PER_DEG_LAT * Math.cos((originLat * Math.PI) / 180);
  return {
    toWorld(lat: number, lon: number): World {
      return {
        x: (lon - originLon) * mPerLon * scale,
        z: -(lat - originLat) * M_PER_DEG_LAT * scale,
      };
    },
  };
}

export const KAOHSIUNG_ORIGIN = { lat: 22.59, lon: 120.30 };
export const WORLD_SCALE = 0.025; // 1 world unit = 40 m(F1 後:整體尺度放大,場景更開)
