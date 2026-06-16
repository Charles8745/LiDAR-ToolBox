/// <reference types="vite/client" />
import * as THREE from 'three';
import { LidarEngine, PointCloud, buildCategoryLUT } from '../../src/index';
import { createProjection, KAOHSIUNG_ORIGIN, WORLD_SCALE } from './geo/projection';
import { buildBaseLayer, buildShipLayer, sampleShipFootprint, type ShipLayerResult } from './scene/portPoints';
import { buildIntervals, occupancyAt, berthStatusAt, buildOccupancyTrend, buildIncomingList } from './time/occupancy';
import { BASE_COLORS, SHIP_CATEGORY_COLORS, STATUS_COLORS, SHIP_CATEGORIES, shipCategoryIndex, statusIndex, valueFor } from './palette';
import { MIN_BERTH, MAX_BERTH, berthPositionLatLon } from './berths';
import { createOverlay } from './ui/overlay';
import type { VesselRecord } from './data/twport';
import type { OsmGeometry } from './data/osm';
import osmData from './data/osm-khh.json';
import basemapMeta from './data/basemap-khh.json';
import basemapUrl from './data/basemap-khh.jpg';

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
const TOTAL_BERTHS = MAX_BERTH - MIN_BERTH + 1;
const HOUR = 3600_000;
const INCOMING_WINDOW = 2 * HOUR;

// 進港標記的顏色與閃爍頻率 —— 直接改這兩個值。
const INCOMING_COLOR: [number, number, number] = [205, 38, 38]; // RGB 0–255(目前琥珀)
const INCOMING_PULSE_HZ = 0.8; // 每秒閃幾次(0 = 不閃)

// Static base layer (coastline + piers), constant-size points.
const base = buildBaseLayer(osm.coastline, osm.piers, proj);
const basePC = new PointCloud({
  capacity: base.values.length + 16, ramp: buildCategoryLUT(BASE_COLORS),
  persistence: 'accumulate', colorMode: 'value', sizeAttenuation: false, pointSize: 2, maxPointSize: 3,
});
basePC.addPoints(base.positions, base.values);

// Dynamic ship layer (rebuilt on filter/scrub), constant-size points, fine footprint spacing.
const shipTypeLUT = buildCategoryLUT(SHIP_CATEGORY_COLORS);
const shipStatusLUT = buildCategoryLUT(STATUS_COLORS);
const shipPC = new PointCloud({
  capacity: 200_000, ramp: shipTypeLUT,
  persistence: 'accumulate', colorMode: 'value', sizeAttenuation: false, pointSize: 3, maxPointSize: 5,
});
let shipCenters: ShipLayerResult['centers'] = [];
function rebuildShips(tMs: number, mode: 'type' | 'status', enabled?: Set<string>) {
  let occ = [...occupancyAt(intervals, tMs).values()];
  if (enabled && enabled.size < SHIP_CATEGORIES.length) {
    occ = occ.filter((v) => enabled.has(SHIP_CATEGORIES[shipCategoryIndex(v.shipType)]));
  }
  const batch = buildShipLayer(occ, proj, WORLD_SCALE, mode, 0.15);
  shipCenters = batch.centers;
  shipPC.setRamp(mode === 'type' ? shipTypeLUT : shipStatusLUT);
  shipPC.clear();
  shipPC.addPoints(batch.positions, batch.values);
}

// Incoming-berth markers (amber): berths with a vessel arriving within INCOMING_WINDOW.
const incPC = new PointCloud({
  capacity: 40_000, ramp: buildCategoryLUT([INCOMING_COLOR]),
  persistence: 'accumulate', colorMode: 'value', sizeAttenuation: false, pointSize: 3, maxPointSize: 5,
  pulseHz: INCOMING_PULSE_HZ,
});
const INCOMING_VAL = valueFor(statusIndex('incoming'), STATUS_COLORS.length);
function rebuildIncoming(tMs: number) {
  const pos: number[] = []; const val: number[] = [];
  for (let b = MIN_BERTH; b <= MAX_BERTH; b++) {
    if (berthStatusAt(intervals, b, tMs, INCOMING_WINDOW) !== 'incoming') continue;
    const ll = berthPositionLatLon(b);
    const c = proj.toWorld(ll.lat, ll.lon);
    for (const p of sampleShipFootprint(c, 0.3, 0.3, 0, 0.08)) { pos.push(p.x, 0.8, p.z); val.push(INCOMING_VAL); }
  }
  incPC.clear();
  incPC.addPoints(new Float32Array(pos), new Float32Array(val));
}

rebuildShips(nowMs, 'type');

// Auto-frame the camera on the active berth area (the vessels) for a centered oblique view.
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
  pointBudget: 1, // engine's internal scan cloud is unused (autoScan:false); minimal allocation
  bloom: [
    { layer: 1, strength: 0.3, radius: 0.1, threshold: 0.1 },  // 群組1=船:收斂光暈
    { layer: 2, strength: 1.1, radius: 0.5, threshold: 0.0 },  // 群組2=進港標記:更亮、更外擴
    { layer: 3, strength: 0.05, radius: 0.1, threshold: 0.0}
  ],
  fog: { color: 0x0b0c0e, near: dist * 0.1, far: dist * 5.0 },
});
engine.addLayer(basePC.points, { bloom: 3});   // 輪廓點
engine.addLayer(shipPC.points, { bloom: 1 });  // 船 → bloom 群組 1
engine.addLayer(incPC.points, { bloom: 2 });   // 進港標記 → bloom 群組 2

// C backdrop: real NLSC aerial orthophoto (baked offline, see data/fetch-basemap.ts),
// tinted at runtime via material color-multiply for the dark situation-room look.
function buildBasemapPlane(): THREE.Mesh {
  const b = basemapMeta.bounds;
  const sw = proj.toWorld(b.s, b.w), ne = proj.toWorld(b.n, b.e);
  const pw = Math.abs(ne.x - sw.x), ph = Math.abs(ne.z - sw.z);
  const mat = new THREE.MeshBasicMaterial({ color: 0x2a2e33, transparent: true, opacity:1, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((sw.x + ne.x) / 2, -0.5, (sw.z + ne.z) / 2);
  mesh.visible = true; // default ON — the aerial base is the new centerpiece
  new THREE.TextureLoader().load(
    basemapUrl,
    (tex) => { tex.colorSpace = THREE.SRGBColorSpace; mat.map = tex; mat.needsUpdate = true; },
    undefined,
    () => { mesh.visible = false; console.warn('[basemap] texture load failed; hiding plane'); },
  );
  return mesh;
}
const mapPlane = buildBasemapPlane();
engine.addLayer(mapPlane);
engine.start();
window.addEventListener('resize', () => { fit(); engine.resize(); });

// Overlay (legend / KPI / detail / filter / view toggle / time slider).
let colorBy: 'type' | 'status' = 'type';
let filter = new Set<string>(SHIP_CATEGORIES);
let currentMs = nowMs;
const overlay = createOverlay(document.getElementById('overlay') as HTMLElement, {
  onFilter(enabled) { filter = enabled; refresh(currentMs); },
  onView(mode) { colorBy = mode; refresh(currentMs); },
  onScrub(tMs) { refresh(tMs); },
  onBackdrop(on) { mapPlane.visible = on; },
});
function refresh(tMs: number) {
  currentMs = tMs;
  rebuildShips(tMs, colorBy, filter);
  rebuildIncoming(tMs);
  const inPort = occupancyAt(intervals, tMs).size;
  overlay.setKpi({ inPort, occupied: inPort, total: TOTAL_BERTHS, dateMs: tMs });
  overlay.setIncoming(
    buildIncomingList(intervals, tMs, INCOMING_WINDOW).map((a) => ({
      berthNo: a.berthNo, name: a.vessel.nameZh || a.vessel.nameEn || '—', etaMs: a.etaMs,
    })),
  );
  overlay.setClock(tMs);
}
overlay.setTimeRange({ minMs: nowMs - 12 * HOUR, maxMs: nowMs + 12 * HOUR, nowMs });
overlay.setTrend(buildOccupancyTrend(intervals, nowMs - 12 * HOUR, nowMs + 12 * HOUR, 24));
refresh(nowMs);

// Click-to-pick the nearest ship centroid (screen-space).
canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  let best: { v: VesselRecord; d: number } | null = null;
  for (const c of shipCenters) {
    const p = new THREE.Vector3(c.x, c.y, c.z).project(engine.camera3D);
    const sx = (p.x * 0.5 + 0.5) * rect.width, sy = (-p.y * 0.5 + 0.5) * rect.height;
    const d = Math.hypot(sx - mx, sy - my);
    if (p.z < 1 && (!best || d < best.d)) best = { v: c.vessel, d };
  }
  if (best && best.d < 28) overlay.showVessel(best.v); else overlay.hideVessel();
});

// Dev/verification handles.
(window as any).__twin = {
  engine, basePC, shipPC, incPC, mapPlane, rebuildShips, rebuildIncoming, refresh, nowMs, intervals,
  get shipCenters() { return shipCenters; },
  setBasemapTint: (hex: number) => { (mapPlane.material as THREE.MeshBasicMaterial).color.setHex(hex); },
};
