/// <reference types="vite/client" />
import * as THREE from 'three';
import { LidarEngine, PointCloud, buildCategoryLUT } from '../../src/index';
import { createProjection, KAOHSIUNG_ORIGIN, WORLD_SCALE } from './geo/projection';
import { sampleShipFootprint, TYPE_DIMS_M } from './scene/portPoints';
import { buildLayers, type LayerConfig } from './scene/layers';
import { SHIP_CATEGORY_COLORS, STATUS_COLORS, SHIP_CATEGORIES, statusIndex, valueFor } from './palette';
import { createOverlay } from './ui/overlay';
import type { VesselRecord } from './data/twport';
import type { AisTrack, AisTracksFile } from './data/ais';
import { positionAt, trailPointsAt, vesselsInPortAt, incomingAt } from './time/ais-replay';
import { joinTwport, categoryForTrack } from './data/join';
import type { OsmGeometry } from './data/osm';
import osmData from './data/osm-khh.json';
import basemapMeta from './data/basemap-khh.json';
import basemapUrl from './data/basemap-khh.jpg';

interface Snapshot { capturedAtMs: number; berthing: VesselRecord[]; forecast: VesselRecord[]; }
const snaps = import.meta.glob('./data/snapshots/*.json', { eager: true, import: 'default' });
const snapshot = Object.values(snaps)[0] as Snapshot | undefined;
if (!snapshot) throw new Error('No snapshot found in ./data/snapshots/ — run `npm run port:fetch`');
const osm = osmData as OsmGeometry;

const trackFiles = import.meta.glob('./data/ais-tracks/khh-*.json', { eager: true, import: 'default' });
const tracksFile = Object.entries(trackFiles).sort(([a], [b]) => a.localeCompare(b)).pop()?.[1] as AisTracksFile | undefined;
if (!tracksFile) throw new Error('No AIS tracks in ./data/ais-tracks/ — run `npm run port:ais:record` then `npm run port:ais:export`');
const tracks: AisTrack[] = tracksFile.ships;
const allVessels: VesselRecord[] = [...snapshot.berthing, ...snapshot.forecast];

const canvas = document.getElementById('view') as HTMLCanvasElement;
function fit() { canvas.style.width = '100vw'; canvas.style.height = '100vh'; }
fit();

const proj = createProjection(KAOHSIUNG_ORIGIN.lat, KAOHSIUNG_ORIGIN.lon, WORLD_SCALE);
const fromMs = tracksFile.meta.fromMs;
const toMs = tracksFile.meta.toMs;
// 開場定在「在港船數最多」的時刻:錄製窗頭尾因 AIS 更新節奏較稀疏(各船軌跡起訖不齊),
// 從 fromMs 開場只會看到 ~1 艘。掃描挑出最滿的時刻當預設視角(時間軸範圍仍為完整 from→to)。
let nowMs = fromMs;
for (let i = 0, best = -1; i <= 60; i++) {
  const tt = fromMs + ((toMs - fromMs) * i) / 60;
  const n = vesselsInPortAt(tracks, tt);
  if (n > best) { best = n; nowMs = tt; }
}
const TRAIL_MS = 15 * 60_000; // 拖尾窗 15 分鐘
const INCOMING_WINDOW = 30 * 60_000; // 進港前瞻 30 分鐘

// 進港標記的顏色與閃爍頻率 —— 直接改這兩個值。
const INCOMING_COLOR: [number, number, number] = [205, 38, 38]; // RGB 0–255(紅 — 警示,bloom 最強)
const INCOMING_PULSE_HZ = 0.8; // 每秒閃幾次(0 = 不閃)

// Static layers (one independent PointCloud per category) — config-driven; tune via __twin.layers.
// Visual hierarchy: infrastructure is desaturated cool-grey + dim so it recedes; saturated colour
// is reserved for the live data (ships) and alerts (incoming). See palette note below.
const LAYERS: LayerConfig[] = [
  // Tier: structure (outline) — dim cool greys, barely-there glow (bloom group 3).
  { key: 'coastline',  label: '海岸線', source: 'coastline',  kind: 'line',     color: [72, 92, 108],   pointSize: 2, maxPointSize: 3, bloomGroup: 3, baseY: 0,    spacing: 0.8, brightness: 0.9 },
  { key: 'pier',       label: '碼頭',   source: 'piers',      kind: 'line',     color: [96, 118, 134],  pointSize: 2, maxPointSize: 3, bloomGroup: 3, baseY: 0,    spacing: 0.8 },
  { key: 'breakwater', label: '防波堤', source: 'breakwater', kind: 'line',     color: [60, 76, 90],    pointSize: 2, maxPointSize: 3, bloomGroup: 3, baseY: 0,    spacing: 0.8, brightness: 0.85 },
  // Tier: landmarks (3D) — neutral steel grey, distinguished by 3D shape not colour (blue is now
  // a ship colour). Low glow (bloom group 4). Anchorage is structure-tier (bloom group 3).
  { key: 'tank',       label: '儲槽',   source: 'tanks',      kind: 'cylinder', color: [118, 128, 142], pointSize: 2, maxPointSize: 4, bloomGroup: 4, baseY: 0,    height: 0.3, rings: 6, perRing: 32, brightness: 0.9 },
  { key: 'crane',      label: '起重機', source: 'cranes',     kind: 'gantry',   color: [138, 150, 166], pointSize: 2, maxPointSize: 4, bloomGroup: 4, baseY: 0,    legHeight: 0.6, baseW: 0.4, baseD: 0.4, boomLen: 0.5, spacing: 0.05 },
  { key: 'anchorage',  label: '錨地',   source: 'anchorages', kind: 'zone',     color: [78, 92, 108],   pointSize: 3, maxPointSize: 5, bloomGroup: 3, baseY: 0.05, radius: 1.0, ringCount: 48, spacing: 0.5, brightness: 0.7 },
];
const layerHandles = buildLayers(LAYERS, osm, proj);

// 動態 AIS 船層:真實位置 footprint + 點雲淡尾。
const shipTypeLUT = buildCategoryLUT(SHIP_CATEGORY_COLORS);
const shipPC = new PointCloud({
  capacity: 300_000, ramp: shipTypeLUT,
  persistence: 'accumulate', colorMode: 'value', sizeAttenuation: false, pointSize: 3, maxPointSize: 5,
});

// 進港標記層(沿用,改由 AIS incoming 餵)
const incPC = new PointCloud({
  capacity: 40_000, ramp: buildCategoryLUT([INCOMING_COLOR]),
  persistence: 'accumulate', colorMode: 'value', sizeAttenuation: false, pointSize: 3, maxPointSize: 5,
  pulseHz: INCOMING_PULSE_HZ,
});

interface AisCenter { track: AisTrack; vessel: VesselRecord | null; x: number; y: number; z: number; }
let shipCenters: AisCenter[] = [];

const SHIP_Y = 0.5;
function updateShips(tMs: number, mode: 'type' | 'status', enabled?: Set<string>) {
  const pos: number[] = []; const val: number[] = [];
  const centers: AisCenter[] = [];
  const statusVal = valueFor(statusIndex('occupied'), STATUS_COLORS.length);
  for (const t of tracks) {
    const rp = positionAt(t, tMs);
    if (!rp) continue;
    const cat = categoryForTrack(t, allVessels);
    if (enabled && !enabled.has(cat)) continue;
    const catIdx = SHIP_CATEGORIES.indexOf(cat);
    const c = proj.toWorld(rp.lat, rp.lon);
    const dim = TYPE_DIMS_M[cat];
    const loaU = (t.loaM ?? dim.loa) * WORLD_SCALE;
    const beamU = (t.beamM ?? dim.beam) * WORLD_SCALE;
    // heading(0=N,順時針)→ footprint headingRad,讓船長軸對齊 (sinθ,-cosθ)
    const theta = rp.headingDeg * Math.PI / 180;
    const h = Math.atan2(-Math.cos(theta), Math.sin(theta));
    const v01 = mode === 'type' ? valueFor(catIdx, SHIP_CATEGORY_COLORS.length) : statusVal;
    // 小船降取樣:大船細、小船粗
    const spacing = loaU > 1.5 ? 0.15 : 0.3;
    for (const p of sampleShipFootprint(c, loaU, beamU, h, spacing)) { pos.push(p.x, SHIP_Y, p.z); val.push(v01); }
    // 拖尾:稀疏真實點,沿尾端淡出(用較低的 value 當「暗」近似,或同色)
    for (const tp of trailPointsAt(t, tMs, TRAIL_MS)) {
      const w = proj.toWorld(tp[0], tp[1]);
      pos.push(w.x, SHIP_Y, w.z); val.push(v01 * (1 - tp[2] * 0.7));
    }
    centers.push({ track: t, vessel: joinTwport(t, allVessels), x: c.x, y: SHIP_Y, z: c.z });
  }
  shipCenters = centers;
  shipPC.setRamp(mode === 'type' ? shipTypeLUT : shipStatusLUT);
  shipPC.clear();
  shipPC.addPoints(new Float32Array(pos), new Float32Array(val));
}

const INCOMING_VAL = valueFor(statusIndex('incoming'), STATUS_COLORS.length);
function updateIncoming(tMs: number) {
  const pos: number[] = []; const val: number[] = [];
  for (const t of incomingAt(tracks, tMs, INCOMING_WINDOW)) {
    const rp = positionAt(t, tMs);
    if (!rp) continue;
    const c = proj.toWorld(rp.lat, rp.lon);
    for (const p of sampleShipFootprint(c, 0.3, 0.3, 0, 0.08)) { pos.push(p.x, 1.5, p.z); val.push(INCOMING_VAL); }
  }
  incPC.clear();
  incPC.addPoints(new Float32Array(pos), new Float32Array(val));
}

const shipStatusLUT = buildCategoryLUT(STATUS_COLORS);
updateShips(nowMs, 'type');

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
  // Glow follows the visual hierarchy: incoming(alert) > ships(data) > landmarks > structure.
  bloom: [
    { layer: 1, strength: 0.5,  radius: 0.12, threshold: 0.05 }, // 群組1=船(資料,主角)
    { layer: 2, strength: 1.1,  radius: 0.5,  threshold: 0.0 },  // 群組2=進港(警示,最亮)
    { layer: 3, strength: 0.05, radius: 0.1,  threshold: 0.0 },  // 群組3=結構(海岸線/碼頭/防波堤,幾乎不發光)
    { layer: 4, strength: 0.18, radius: 0.25, threshold: 0.0 },  // 群組4=地標(儲槽/起重機/錨地,微光退背景)
  ],
  fog: { color: 0x0b0c0e, near: dist * 0.1, far: dist * 5.0 },
});
for (const h of layerHandles) engine.addLayer(h.pc.points, { bloom: h.config.bloomGroup });
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
  mesh.position.set((sw.x + ne.x) / 2, 0, (sw.z + ne.z) / 2);
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
  updateShips(tMs, colorBy, filter);
  updateIncoming(tMs);
  const inPort = vesselsInPortAt(tracks, tMs);
  overlay.setKpi({ inPort, occupied: inPort, total: 80, dateMs: tMs });
  overlay.setIncoming(
    incomingAt(tracks, tMs, INCOMING_WINDOW).slice(0, 6).map((t) => {
      const v = joinTwport(t, allVessels);
      return { berthNo: v?.berthNo ?? 0, name: v?.nameZh || v?.nameEn || t.name || t.mmsi, etaMs: tMs };
    }),
  );
  overlay.setClock(tMs);
}

// 趨勢:在港船數沿時間軸取樣 24 點
function buildAisTrend(steps: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) out.push(vesselsInPortAt(tracks, fromMs + ((toMs - fromMs) * i) / steps));
  return out;
}
overlay.setTimeRange({ minMs: fromMs, maxMs: toMs, nowMs });
overlay.setTrend(buildAisTrend(24));
refresh(nowMs);

// 自走回放:每 ~80ms 推進(由 __twin.play()/pause() 控制;預設停)。
let playTimer = 0;
function play() {
  if (playTimer) return;
  playTimer = window.setInterval(() => {
    let t = currentMs + (toMs - fromMs) / 600; // 約 50s 掃完全程
    if (t > toMs) t = fromMs;
    refresh(t);
  }, 80);
}
function pause() { if (playTimer) { clearInterval(playTimer); playTimer = 0; } }

// Click-to-pick the nearest ship centroid (screen-space).
canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  let best: { c: AisCenter; d: number } | null = null;
  for (const c of shipCenters) {
    const p = new THREE.Vector3(c.x, c.y, c.z).project(engine.camera3D);
    const sx = (p.x * 0.5 + 0.5) * rect.width, sy = (-p.y * 0.5 + 0.5) * rect.height;
    const d = Math.hypot(sx - mx, sy - my);
    if (p.z < 1 && (!best || d < best.d)) best = { c, d };
  }
  if (best && best.d < 28) {
    const c = best.c;
    overlay.showVessel(c.vessel ?? {
      visaNo: '', nameZh: c.track.name, nameEn: '', shipType: `AIS type ${c.track.aisType}`,
      wharfName: '—', berthNo: null, status: '', etaMs: null, etdMs: null, actPortMs: null,
      leaveMs: null, beforePort: '', nextPort: '', imo: c.track.imo, callSign: c.track.callSign,
      source: 'berthing',
    });
  } else overlay.hideVessel();
});

// Dev/verification handles.
(window as any).__twin = {
  engine, shipPC, incPC, mapPlane, updateShips, updateIncoming, refresh, play, pause,
  fromMs, toMs, nowMs, tracks,
  layers: Object.fromEntries(layerHandles.map((h) => [h.key, h])),
  get shipCenters() { return shipCenters; },
  setBasemapTint: (hex: number) => { (mapPlane.material as THREE.MeshBasicMaterial).color.setHex(hex); },
};
