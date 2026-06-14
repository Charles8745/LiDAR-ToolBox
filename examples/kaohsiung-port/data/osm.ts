export interface LatLon { lat: number; lon: number; }
export type Polyline = LatLon[];
export interface OsmGeometry { coastline: Polyline[]; piers: Polyline[]; }

export interface OverpassEl { type: string; tags?: Record<string, string>; geometry?: LatLon[]; lat?: number; lon?: number; }
export interface OverpassDoc { elements: OverpassEl[]; }

/** Split Overpass `out geom` ways into coastline vs pier polylines. */
export function parseOsmWays(doc: OverpassDoc): OsmGeometry {
  const coastline: Polyline[] = [];
  const piers: Polyline[] = [];
  for (const el of doc.elements) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const line = el.geometry.map((g) => ({ lat: g.lat, lon: g.lon }));
    if (el.tags?.natural === 'coastline') coastline.push(line);
    else if (el.tags?.man_made === 'pier') piers.push(line);
  }
  return { coastline, piers };
}
