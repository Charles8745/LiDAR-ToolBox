/// <reference types="vite/client" />
import * as THREE from 'three';
import { LidarEngine, PointCloud, buildCategoryLUT } from '../../src/index';
import { createProjection, KAOHSIUNG_ORIGIN, WORLD_SCALE } from './geo/projection';
import { sampleShipFootprint, TYPE_DIMS_M } from './scene/portPoints';
import { loadShipModel, placeModelPoints } from './scene/shipModels';
import { buildLayers, type LayerConfig } from './scene/layers';
import { SHIP_CATEGORY_COLORS, STATUS_COLORS, SHIP_CATEGORIES, statusIndex, valueFor, type ShipCategory } from './palette';
import { createOverlay } from './ui/overlay';
import type { VesselRecord } from './data/twport';
import type { AisTrack, AisTracksFile } from './data/ais';
import { positionAt, vesselsInPortAt } from './time/ais-replay';
import { joinTwport, categoryForTrack } from './data/join';
import { buildIntervals, buildIncomingList } from './time/occupancy';
import type { OsmGeometry } from './data/osm';
import osmData from './data/osm-khh.json';
import basemapMeta from './data/basemap-khh.json';
import basemapUrl from './data/basemap-khh.jpg';
import { buildLabelLayer } from './scene/textLabels';
import { DEFAULT_BANDS } from './scene/portZones';
import { buildPierSegs, nearestPierTangent } from './scene/orient';
import { shortBerthLabel, type BerthMarker } from './data/berthGeometry';
import berthsData from './data/berths-khh.json';
import labelFontUrl from './data/fonts/zones-subset.woff?url';

interface Snapshot { capturedAtMs: number; berthing: VesselRecord[]; forecast: VesselRecord[]; }
const snaps = import.meta.glob('./data/snapshots/*.json', { eager: true, import: 'default' });
const snapshot = Object.entries(snaps).sort(([a], [b]) => a.localeCompare(b)).pop()?.[1] as Snapshot | undefined;
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
// 世界單位尺寸的縮放係數(相對原始 0.01 基準)。要整體拉大/縮小尺度,只改 WORLD_SCALE 一個值即可。
const S = WORLD_SCALE / 0.01;
const fromMs = tracksFile.meta.fromMs;
const toMs = tracksFile.meta.toMs;
// 開場定在「在港船數最多」的時刻:錄製窗頭尾因 AIS 更新節奏較稀疏(各船軌跡起訖不齊),
// 從 fromMs 開場只會看到 ~1 艘。掃描挑出最滿的時刻當預設視角(時間軸範圍仍為完整 from→to)。
let nowMs = fromMs, peakInPort = 0;
for (let i = 0; i <= 60; i++) {
  const tt = fromMs + ((toMs - fromMs) * i) / 60;
  const n = vesselsInPortAt(tracks, tt);
  if (n > peakInPort) { peakInPort = n; nowMs = tt; }
}
peakInPort = Math.max(peakInPort, 1);

// 進港預報 = TWPort forecast(真實 ETA / 船席 / 船名)。以快照自身 capturedAtMs 為基準,
// 與 AIS 回放時鐘解耦(AIS 是過去的位置回放,TWPort 是官方未來進港預報)。
const forecastIntervals = buildIntervals(snapshot.forecast);
const incomingRefMs = snapshot.capturedAtMs;
const INCOMING_WINDOW = 6 * 3600_000; // 預報前瞻 6 小時

// 預建碼頭線段(世界座標),供靠泊船朝向對齊用(L2:此 feed 無 heading,靜止船朝向不可靠)。
const pierSegs = buildPierSegs(osm.piers, proj);

// Per-track 預算快取(類別 / TWPort join / 是否靠泊 / 碼頭朝向)—— 這些都是靜態的,
// 不該每幀重算(M1)。靠泊判定:整段軌跡淨位移 < 100m(1 世界單位)。
interface TrackMeta { category: ShipCategory; vessel: VesselRecord | null; pierAligned: boolean; pierH: number; }
const trackMeta = new Map<string, TrackMeta>();
const STATIONARY_U = 100 * WORLD_SCALE;  // 淨位移 < 100m 視為靠泊(隨尺度調整)
const PIER_SNAP_MAX = 300 * WORLD_SCALE; // 靠泊船離最近碼頭 < 300m 才對齊朝向;更遠(錨地)維持航向、不亂指
for (const t of tracks) {
  const category = categoryForTrack(t, allVessels);
  const vessel = joinTwport(t, allVessels);
  const p0 = t.path[0], pl = t.path[t.path.length - 1];
  const a = proj.toWorld(p0[0], p0[1]), b = proj.toWorld(pl[0], pl[1]);
  const stationary = Math.hypot(b.x - a.x, b.z - a.z) < STATIONARY_U;
  const np = nearestPierTangent(a.x, a.z, pierSegs);
  const pierAligned = stationary && np.distU < PIER_SNAP_MAX; // 靠泊且貼近碼頭才對齊;否則(錨地/移動)用航向
  trackMeta.set(t.mmsi, { category, vessel, pierAligned, pierH: np.headingRad });
}

// Static layers (one independent PointCloud per category) — config-driven; tune via __twin.layers.
// Visual hierarchy: infrastructure is desaturated cool-grey + dim so it recedes; saturated colour
// is reserved for the live data (ships). See palette note below.
const LAYERS: LayerConfig[] = [
  // Tier: structure (outline) — dim cool greys, barely-there glow (bloom group 3).
  { key: 'coastline',  label: '海岸線', source: 'coastline',  kind: 'line',     color: [72, 92, 108],   pointSize: 2, maxPointSize: 3, bloomGroup: 3, baseY: 0,       spacing: 0.8 * S, brightness: 0.9 },
  { key: 'pier',       label: '碼頭',   source: 'piers',      kind: 'line',     color: [96, 118, 134],  pointSize: 2, maxPointSize: 3, bloomGroup: 3, baseY: 0,       spacing: 0.8 * S },
  { key: 'breakwater', label: '防波堤', source: 'breakwater', kind: 'line',     color: [60, 76, 90],    pointSize: 2, maxPointSize: 3, bloomGroup: 3, baseY: 0,       spacing: 0.8 * S, brightness: 0.85 },
  // Tier: landmarks (3D) — neutral steel grey, distinguished by 3D shape not colour (blue is now
  // a ship colour). Low glow (bloom group 4). Anchorage is structure-tier (bloom group 3).
  // 世界單位尺寸 × S(=WORLD_SCALE/0.01)自動等比;pointSize/rings/perRing/ringCount 不變(像素/計數)。
  { key: 'tank',       label: '儲槽',   source: 'tanks',      kind: 'model',    color: [118, 128, 142], pointSize: 2, maxPointSize: 4, bloomGroup: 4, baseY: 0,       modelKey: '儲槽', scaleByFootprint: true, height: 0.3 * S, rings: 6, perRing: 32, brightness: 0.9 },
  // 起重機圖層已隱藏(使用者要求場景不顯示起重機)。模型程式碼/資料/烘焙工具(landmarkModels、orient、
  // crane-orient.json、起重機.json、port:crane-orient)皆保留;要復原把下一行取消註解即可。
  // { key: 'crane',      label: '起重機', source: 'cranes',     kind: 'model',    color: [138, 150, 166], pointSize: 2, maxPointSize: 4, bloomGroup: 4, baseY: 0,       modelKey: 'crane', scaleU: 1.0 * S, orientStepU: 1.5 * S, orientProbeR: 1.5 * S, legHeight: 0.6 * S, baseW: 0.4 * S, baseD: 0.4 * S, boomLen: 0.5 * S, spacing: 0.05 * S },
  { key: 'anchorage',  label: '錨地',   source: 'anchorages', kind: 'zone',     color: [78, 92, 108],   pointSize: 3, maxPointSize: 5, bloomGroup: 3, baseY: 0.05 * S, radius: 1.0 * S, ringCount: 48, spacing: 0.5 * S, brightness: 0.7 },
];
const layerHandles = buildLayers(LAYERS, osm, proj);

// 動態 AIS 船層:真實 AIS 位置畫 footprint(無拖尾;朝向見 updateShips)。
const shipTypeLUT = buildCategoryLUT(SHIP_CATEGORY_COLORS);
const shipStatusLUT = buildCategoryLUT(STATUS_COLORS);
const shipPC = new PointCloud({
  // 8 類中 7 類有 3D 模型(每艘 ~1.4–5.5k 點),尖峰在港 354 艘 → 實測每幀 ~980k 點。
  // updateShips 每幀重建整層;容量自 300k 拉到 1.5M(~1.5× 餘裕)。多船型加密 → 用
  // __twin.shipPC.points.geometry.drawRange.count 量測尖峰、回頭調 cellFrac 或此容量。
  capacity: 1_500_000, ramp: shipTypeLUT,
  // 亮度旋鈕(船太亮調這裡):pointSize=點大小(2.5,原 3;小=重疊少、過曝少)、下方 setBrightness
  // =點核心亮度、再下方 bloom 群組1 strength(發光暈,最大來源)。
  persistence: 'accumulate', colorMode: 'value', sizeAttenuation: false, pointSize: 2.5, maxPointSize: 5,
});
shipPC.setBrightness(0.65); // 點核心亮度(1=原始)。配合 bloom 群組1 strength 控制船整體亮度。

interface AisCenter { track: AisTrack; vessel: VesselRecord | null; x: number; y: number; z: number; }
let shipCenters: AisCenter[] = [];

// 船 footprint 畫成真實 LOA 的此比例 → 相鄰泊位的船之間留白、不糊成一團(去重疊)。直接改這個值。
const SHIP_FOOTPRINT = 0.6;
const SHIP_Y = 0.01 * S;
function updateShips(tMs: number, mode: 'type' | 'status', enabled?: Set<string>) {
  const pos: number[] = []; const val: number[] = [];
  const centers: AisCenter[] = [];
  const statusVal = valueFor(statusIndex('occupied'), STATUS_COLORS.length);
  for (const t of tracks) {
    const rp = positionAt(t, tMs);
    if (!rp) continue;
    const meta = trackMeta.get(t.mmsi)!;
    if (enabled && !enabled.has(meta.category)) continue;
    const catIdx = SHIP_CATEGORIES.indexOf(meta.category);
    const c = proj.toWorld(rp.lat, rp.lon);
    const dim = TYPE_DIMS_M[meta.category];
    const loaU = (t.loaM ?? dim.loa) * WORLD_SCALE * SHIP_FOOTPRINT;
    const beamU = (t.beamM ?? dim.beam) * WORLD_SCALE * SHIP_FOOTPRINT;
    // 朝向:靠泊船對齊最近碼頭線(L2);移動船用 AIS heading/COG 近似(此 feed 無 heading →
    // positionAt 回傳點間方位角)。heading(0=N,順時針)→ footprint headingRad,長軸對齊 (sinθ,-cosθ)。
    let h: number;
    if (meta.pierAligned) h = meta.pierH;
    else { const theta = rp.headingDeg * Math.PI / 180; h = Math.atan2(-Math.cos(theta), Math.sin(theta)); }
    const v01 = mode === 'type' ? valueFor(catIdx, SHIP_CATEGORY_COLORS.length) : statusVal;
    const spacing = loaU > 1.5 * S ? 0.15 * S : 0.3 * S; // 小船降取樣(隨尺度等比)
    const tpl = loadShipModel(meta.category);
    if (tpl) {
      const batch = placeModelPoints(tpl, c, h, loaU, SHIP_Y, v01);
      for (let k = 0; k < batch.positions.length; k += 3) {
        pos.push(batch.positions[k], batch.positions[k + 1], batch.positions[k + 2]);
        val.push(batch.values[k / 3]);
      }
    } else {
      for (const p of sampleShipFootprint(c, loaU, beamU, h, spacing)) { pos.push(p.x, SHIP_Y, p.z); val.push(v01); }
    }
    centers.push({ track: t, vessel: meta.vessel, x: c.x, y: SHIP_Y, z: c.z });
  }
  shipCenters = centers;
  shipPC.setRamp(mode === 'type' ? shipTypeLUT : shipStatusLUT);
  shipPC.clear();
  shipPC.addPoints(new Float32Array(pos), new Float32Array(val));
}

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
const dist = radius * 1.0 + 15; // 不等比跟拉 → 放大後的世界填滿更多畫面(否則等比抵消)

const engine = new LidarEngine({
  canvas, autoScan: false, cameraMode: 'orbit',
  cameraPosition: [cx, dist * 0.85, cz + dist * 0.75],
  cameraTarget: [cx, 0, cz],
  cameraFar: dist * 6,
  cameraMinDistance: 10,        // 別 dolly 到 pivot 上(會卡住、難轉);留 ~400m 仍可貼近看碼頭碼
  cameraMaxDistance: dist * 3,  // 別縮太遠變一點
  keyboardPan: true,            // ↑↓←→ 沿地面前後左右;空白=上升、左Ctrl=下降;左Shift=加速
  keyPanSpeed: 0.2,             // 速度因子(每秒移動 ≈ 0.2×當前縮放距離)
  keyPanBoost: 3,              // 按住左 Shift 時 ×3
  pointBudget: 1, // engine's internal scan cloud is unused (autoScan:false); minimal allocation
  // Glow follows the visual hierarchy: ships(data) > landmarks > structure.
  bloom: [
    { layer: 1, strength: 0.38, radius: 0.12, threshold: 0.05 }, // 群組1=船(資料,主角;strength=發光暈,船太亮↓此值)
    { layer: 3, strength: 0.05, radius: 0.1,  threshold: 0.0 },  // 群組3=結構(海岸線/碼頭/防波堤,幾乎不發光)
    { layer: 4, strength: 0.18, radius: 0.25, threshold: 0.0 },  // 群組4=地標(儲槽/起重機/錨地,微光退背景)
  ],
  fog: { color: 0x0b0c0e, near: dist * 0.1, far: dist * 5.0 },
});
for (const h of layerHandles) engine.addLayer(h.pc.points, { bloom: h.config.bloomGroup });
engine.addLayer(shipPC.points, { bloom: 1 });  // 船 → bloom 群組 1

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

// F3: berth-number labels — real official berth coords (troika SDF), berth tier only.
// Display the colloquial berth number (strip the 1xxx series prefix).
const berths = (berthsData as { berths: BerthMarker[] }).berths.map(
  (b) => ({ ...b, code: shortBerthLabel(b.code) }),
);
const sceneCenter = proj.toWorld(KAOHSIUNG_ORIGIN.lat, KAOHSIUNG_ORIGIN.lon); // {x:0,z:0}
// Only the individual berth numbers (zone-name tiers dropped per UX). Berth tier is
// always full opacity; visibility is purely a per-label proximity reveal (nearRadius) —
// zoom toward an area and its berth numbers fade in, far areas stay clean.
const labels = buildLabelLayer([], berths, {
  proj,
  bands: { ...DEFAULT_BANDS, berth: [0, 0, 1e9, 1e9] },
  nearRadius: 28 * S,           // berths show within ~2.8km of the camera (proximity reveal; tune to taste)
  yLift: 1.0 * S,               // clear of y=0 structure (ships sit at 0.5*S)
  fontUrl: labelFontUrl,
  color: 0xcbd5df,              // war-room silver
  outlineColor: 0x0b0c0e,       // dark ink outline for legibility
  sceneCenter: { x: sceneCenter.x, z: sceneCenter.z },
  fontSizes: { district: 1.7 * S, terminal: 1.2 * S, berth: 0.6 * S },
});
engine.addLayer(labels.group);  // NOT in any bloom group → labels don't glow
engine.addUpdate(() => labels.update(engine.camera3D));

fetch(labelFontUrl, { method: 'HEAD' }).then((r) => {
  if (!r.ok) { labels.group.visible = false; console.warn('[labels] font load failed; hiding labels'); }
}).catch(() => { labels.group.visible = false; console.warn('[labels] font fetch error; hiding labels'); });

engine.start();
window.addEventListener('resize', () => { fit(); engine.resize(); });

// Overlay (legend / KPI / detail / filter / backdrop switch / time slider).
let filter = new Set<string>(SHIP_CATEGORIES);
let currentMs = nowMs;
const overlay = createOverlay(document.getElementById('overlay') as HTMLElement, {
  onFilter(enabled) { filter = enabled; refresh(currentMs); },
  onScrub(tMs) { refresh(tMs); },
  onBackdrop(on) { mapPlane.visible = on; },
});
function refresh(tMs: number) {
  currentMs = tMs;
  updateShips(tMs, 'type', filter);
  const inPort = vesselsInPortAt(tracks, tMs);
  overlay.setKpi({ inPort, total: peakInPort });
  overlay.setClock(tMs);
}

// 趨勢:在港船數沿時間軸取樣 24 點(AIS)。
function buildAisTrend(steps: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) out.push(vesselsInPortAt(tracks, fromMs + ((toMs - fromMs) * i) / steps));
  return out;
}
overlay.setTimeRange({ minMs: fromMs, maxMs: toMs, nowMs });
overlay.setTrend(buildAisTrend(24));
// 進港清單 = TWPort 官方預報(真實 ETA),於快照基準時刻計算一次,不隨 AIS scrubber 變動。
overlay.setIncoming(
  buildIncomingList(forecastIntervals, incomingRefMs, INCOMING_WINDOW).map((a) => ({
    berthNo: a.berthNo, name: a.vessel.nameZh || a.vessel.nameEn || '—', etaMs: a.etaMs,
  })),
  incomingRefMs,
);
refresh(nowMs);

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
      visaNo: '', nameZh: c.track.name, nameEn: '', shipType: trackMeta.get(c.track.mmsi)?.category ?? '—',
      wharfName: '—', berthNo: null, status: '', etaMs: null, etdMs: null, actPortMs: null,
      leaveMs: null, beforePort: '', nextPort: '', imo: c.track.imo, callSign: c.track.callSign,
      source: 'berthing',
    });
  } else overlay.hideVessel();
});

// Dev tool: trace the land/water boundary by clicking along the coast. Each click raycasts onto the
// basemap plane (y=0) → world (x,z), drops a red marker, and appends to the list. Drives the authoritative
// land-sea-boundary.json that data/fetch-crane-orient.ts uses for crane boom orientation.
// Usage in console: __twin.trace.start() → click the coast → __twin.trace.dump() → paste the JSON.
const traceRay = new THREE.Raycaster();
const trace = { on: false, pts: [] as { x: number; z: number }[], group: new THREE.Group() };
engine.addLayer(trace.group);
canvas.addEventListener('click', (e) => {
  if (!trace.on) return;
  e.stopImmediatePropagation();                       // suppress ship-pick while tracing
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1,
  );
  traceRay.setFromCamera(ndc, engine.camera3D);
  const hit = traceRay.intersectObject(mapPlane, false)[0];
  if (!hit) return;
  const x = +hit.point.x.toFixed(3), z = +hit.point.z.toFixed(3);
  trace.pts.push({ x, z });
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff3344 }));
  m.position.set(x, 0.6, z);
  trace.group.add(m);
  console.log(`[trace] +pt ${trace.pts.length}: (${x}, ${z})`);
}, true);                                              // capture phase → runs before ship-pick

// Dev tool: drop bright magenta pillars + index labels above chosen cranes (default = the boom-orientation
// suspects) and frame the camera on them — to eyeball each boom's direction in 3D against the real water.
// Usage in console: __twin.markCranes()  ·  __twin.markCranes(3,13,14,52)  ·  __twin.clearMarks()
const markGroup = new THREE.Group();
engine.addLayer(markGroup);
const craneList = osm.cranes as { lat: number; lon: number }[];
function numberSprite(n: number): THREE.Sprite {
  const cv = document.createElement('canvas'); cv.width = cv.height = 96;
  const g = cv.getContext('2d')!;
  g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, 0, 96, 96);
  g.fillStyle = '#ff5cff'; g.font = 'bold 60px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(n), 48, 52);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false }));
  sp.scale.set(3, 3, 1);
  return sp;
}
function markCranes(...idx: number[]): void {
  const ids = idx.length ? idx : [3, 13, 14, 52];
  while (markGroup.children.length) markGroup.remove(markGroup.children[0]);
  const box = new THREE.Box3();
  for (const i of ids) {
    const w = proj.toWorld(craneList[i].lat, craneList[i].lon);
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xff5cff, depthTest: false }),
    );
    pillar.position.set(w.x, 6, w.z);
    markGroup.add(pillar);
    const sp = numberSprite(i); sp.position.set(w.x, 13, w.z); markGroup.add(sp);
    box.expandByPoint(new THREE.Vector3(w.x, 0, w.z));
  }
  const center = box.getCenter(new THREE.Vector3());
  const span = Math.max(10, box.getSize(new THREE.Vector3()).length());
  const ctrl = (engine as unknown as { controls?: { target?: THREE.Vector3 } }).controls;
  if (ctrl?.target) ctrl.target.copy(center);
  engine.camera3D.position.set(center.x + span, span, center.z + span);
  engine.camera3D.lookAt(center);
  console.log(`[mark] cranes ${ids.join(',')} — magenta pillars; orbit to inspect each boom vs the water`);
}
function clearMarks(): void { while (markGroup.children.length) markGroup.remove(markGroup.children[0]); }

// Dev tool: float a small index number above EVERY crane so the numbers read directly in any camera view
// (no north-up correlation needed). __twin.labelCranes()  ·  __twin.labelCranes(false) to hide.
const labelGroup = new THREE.Group();
engine.addLayer(labelGroup);
function labelCranes(show = true): void {
  while (labelGroup.children.length) labelGroup.remove(labelGroup.children[0]);
  if (!show) { console.log('[label] cranes hidden'); return; }
  craneList.forEach((ll, i) => {
    const w = proj.toWorld(ll.lat, ll.lon);
    const sp = numberSprite(i); sp.scale.set(2, 2, 1); sp.position.set(w.x, 9, w.z);
    labelGroup.add(sp);
  });
  console.log(`[label] ${craneList.length} crane indices shown`);
}

// Dev/verification handles.
(window as any).__twin = {
  engine, shipPC, mapPlane, updateShips, refresh,
  fromMs, toMs, nowMs, peakInPort, tracks, trackMeta,
  layers: Object.fromEntries(layerHandles.map((h) => [h.key, h])),
  labels,
  get shipCenters() { return shipCenters; },
  setBasemapTint: (hex: number) => { (mapPlane.material as THREE.MeshBasicMaterial).color.setHex(hex); },
  markCranes, clearMarks, labelCranes,
  trace: {
    start() { trace.on = true; console.log('[trace] ON — click along the coast; then __twin.trace.dump(). .undo() / .clear() / .stop()'); },
    stop() { trace.on = false; console.log(`[trace] OFF (${trace.pts.length} pts)`); },
    undo() { trace.pts.pop(); const c = trace.group.children.pop(); if (c) trace.group.remove(c); console.log(`[trace] ${trace.pts.length} pts`); },
    clear() { trace.pts.length = 0; while (trace.group.children.length) trace.group.remove(trace.group.children[0]); console.log('[trace] cleared'); },
    dump() { const s = JSON.stringify({ points: trace.pts }); console.log(s); return s; },
  },
};
