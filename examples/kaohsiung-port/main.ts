import { LidarEngine, PointCloud, buildCategoryLUT } from '../../src/index';
import { createProjection, KAOHSIUNG_ORIGIN, WORLD_SCALE } from './geo/projection';
import { buildBaseLayer, buildShipLayer, type ShipLayerResult } from './scene/portPoints';
import { buildIntervals, occupancyAt } from './time/occupancy';
import { BASE_COLORS, SHIP_CATEGORY_COLORS } from './palette';
import type { VesselRecord } from './data/twport';
import type { OsmGeometry } from './data/osm';
import osmData from './data/osm-khh.json';

interface Snapshot { capturedAtMs: number; berthing: VesselRecord[]; forecast: VesselRecord[]; }
const snaps = import.meta.glob('./data/snapshots/*.json', { eager: true, import: 'default' });
const snapshot = Object.values(snaps)[0] as Snapshot | undefined;
if (!snapshot) throw new Error('No snapshot found in ./data/snapshots/ — run `npm run port:fetch`');
const osm = osmData as OsmGeometry;

const canvas = document.getElementById('view') as HTMLCanvasElement;
function fit() { canvas.style.width = '100vw'; canvas.style.height = '100vh'; }
fit();

const proj = createProjection(KAOHSIUNG_ORIGIN.lat, KAOHSIUNG_ORIGIN.lon, WORLD_SCALE);
const intervals = buildIntervals([...snapshot.berthing, ...snapshot.forecast]);
const nowMs = snapshot.capturedAtMs;

// Static base layer (coastline + piers), constant-size points.
const base = buildBaseLayer(osm.coastline, osm.piers, proj);
const basePC = new PointCloud({
  capacity: base.values.length + 16, ramp: buildCategoryLUT(BASE_COLORS),
  persistence: 'accumulate', colorMode: 'value', sizeAttenuation: false, pointSize: 2, maxPointSize: 3,
});
basePC.addPoints(base.positions, base.values);

// Dynamic ship layer (rebuilt on scrub later), constant-size points, fine footprint spacing.
const shipPC = new PointCloud({
  capacity: 200_000, ramp: buildCategoryLUT(SHIP_CATEGORY_COLORS),
  persistence: 'accumulate', colorMode: 'value', sizeAttenuation: false, pointSize: 3, maxPointSize: 5,
});
let shipCenters: ShipLayerResult['centers'] = [];
function rebuildShips(tMs: number, colorBy: 'type' | 'status') {
  const occ = [...occupancyAt(intervals, tMs).values()];
  const batch = buildShipLayer(occ, proj, WORLD_SCALE, colorBy, 0.15);
  shipCenters = batch.centers;
  shipPC.clear();
  shipPC.addPoints(batch.positions, batch.values);
}
rebuildShips(nowMs, 'type');

// Auto-frame the camera on the active berth area (the vessels) for a centered oblique view.
// (The OSM coastline extends far beyond the commercial port, so framing on the ships keeps the focus tight.)
function frameOf(points: Array<{ x: number; z: number }>) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const radius = Math.max(maxX - minX, maxZ - minZ) / 2 || 50;
  return { cx, cz, radius };
}
const { cx, cz, radius } = frameOf(shipCenters.length ? shipCenters : [{ x: 0, z: 0 }]);
const dist = radius * 1.7 + 30;

const engine = new LidarEngine({
  canvas, autoScan: false, cameraMode: 'orbit',
  cameraPosition: [cx, dist * 0.85, cz + dist * 0.75],
  cameraTarget: [cx, 0, cz],
  cameraFar: dist * 6,
  pointBudget: 100,
});
engine.addLayer(basePC.points);
engine.addLayer(shipPC.points);
engine.start();

window.addEventListener('resize', () => { fit(); engine.resize(); });

// Dev/verification handles (used by later overlay/time-slider tasks too).
(window as any).__twin = { engine, basePC, shipPC, rebuildShips, nowMs, intervals, get shipCenters() { return shipCenters; } };
