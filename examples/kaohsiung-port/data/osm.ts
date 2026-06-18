export interface LatLon { lat: number; lon: number; }
export type Polyline = LatLon[];
export interface OsmGeometry {
  coastline: Polyline[];
  piers: Polyline[];
  breakwater: Polyline[];
  tanks: Polyline[];       // closed footprint polygons (man_made=storage_tank)
  cranes: LatLon[];        // man_made=crane nodes
  anchorages: Polyline[];  // seamark anchorage: way→outline, node→length-1 polyline
}

export interface OverpassEl { type: string; tags?: Record<string, string>; geometry?: LatLon[]; lat?: number; lon?: number; }
export interface OverpassDoc { elements: OverpassEl[]; }

/** Split Overpass `out geom` elements into typed geometry buckets. */
export function parseOsm(doc: OverpassDoc): OsmGeometry {
  const coastline: Polyline[] = [];
  const piers: Polyline[] = [];
  const breakwater: Polyline[] = [];
  const tanks: Polyline[] = [];
  const cranes: LatLon[] = [];
  const anchorages: Polyline[] = [];
  for (const el of doc.elements) {
    const t = el.tags ?? {};
    if (el.type === 'node') {
      if (el.lat === undefined || el.lon === undefined) continue;
      const ll = { lat: el.lat, lon: el.lon };
      if (t.man_made === 'crane') cranes.push(ll);
      else if (t['seamark:type'] === 'anchorage') anchorages.push([ll]);
      continue;
    }
    if (el.type === 'way' && el.geometry && el.geometry.length >= 2) {
      const line = el.geometry.map((g) => ({ lat: g.lat, lon: g.lon }));
      if (t.natural === 'coastline') coastline.push(line);
      else if (t.man_made === 'pier') piers.push(line);
      else if (t.man_made === 'breakwater') breakwater.push(line);
      else if (t.man_made === 'storage_tank') tanks.push(line);
      else if (t['seamark:type'] === 'anchorage') anchorages.push(line);
    }
  }
  return { coastline, piers, breakwater, tanks, cranes, anchorages };
}
