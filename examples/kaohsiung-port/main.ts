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
const snapshot = Object.values(snaps)[0] as Snapshot;
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

const engine = new LidarEngine({
  canvas, autoScan: false, cameraMode: 'orbit',
  cameraPosition: [0, 110, 150], cameraTarget: [0, 0, 0], pointBudget: 100,
});
engine.addLayer(basePC.points);
engine.addLayer(shipPC.points);
engine.start();

window.addEventListener('resize', () => { fit(); engine.resize(); });

// Dev/verification handles (used by later overlay/time-slider tasks too).
(window as any).__twin = { engine, basePC, shipPC, rebuildShips, nowMs, intervals, get shipCenters() { return shipCenters; } };
