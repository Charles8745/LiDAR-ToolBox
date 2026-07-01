import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildLayers, buildLayerPoints, type LayerConfig } from '../examples/kaohsiung-port/scene/layers';
import type { OsmGeometry } from '../examples/kaohsiung-port/data/osm';
import { sampleGantry } from '../examples/kaohsiung-port/scene/landmarks';
import { loadLandmarkModel } from '../examples/kaohsiung-port/scene/landmarkModels';

const idProj = { toWorld: (lat: number, lon: number) => ({ x: lon, z: lat }) };

const OSM: OsmGeometry = {
  coastline: [[{ lat: 0, lon: 0 }, { lat: 0, lon: 10 }]],
  piers: [],
  breakwater: [],
  tanks: [[{ lat: 0, lon: 0 }, { lat: 0, lon: 2 }, { lat: 2, lon: 2 }, { lat: 2, lon: 0 }]],
  cranes: [{ lat: 5, lon: 5 }],
  anchorages: [[{ lat: 9, lon: 9 }]],
};

const CFG: LayerConfig[] = [
  { key: 'coastline', label: 'C', source: 'coastline', kind: 'line', color: [10, 20, 30], pointSize: 2, maxPointSize: 3, bloomGroup: 3, baseY: 0, spacing: 1 },
  { key: 'tank', label: 'T', source: 'tanks', kind: 'cylinder', color: [40, 50, 60], pointSize: 2, maxPointSize: 4, bloomGroup: 4, baseY: 0, height: 0.3, rings: 4, perRing: 8 },
  { key: 'crane', label: 'K', source: 'cranes', kind: 'gantry', color: [70, 80, 90], pointSize: 2, maxPointSize: 4, bloomGroup: 4, baseY: 0 },
  { key: 'anchorage', label: 'A', source: 'anchorages', kind: 'zone', color: [1, 2, 3], pointSize: 3, maxPointSize: 5, bloomGroup: 4, baseY: 0.05, radius: 1, ringCount: 12 },
];

describe('buildLayerPoints', () => {
  it('samples a line layer into xyz at baseY', () => {
    const pts = buildLayerPoints(CFG[0], OSM, idProj as any);
    expect(pts.length % 3).toBe(0);
    expect(pts.length).toBeGreaterThan(0);
    for (let i = 1; i < pts.length; i += 3) expect(pts[i]).toBe(0); // y == baseY
  });
  it('returns empty for a missing/empty source', () => {
    const pts = buildLayerPoints({ ...CFG[0], source: 'breakwater' }, OSM, idProj as any);
    expect(pts).toEqual([]);
  });
});

describe("buildLayerPoints kind:'model'", () => {
  const baseModelCfg: LayerConfig = {
    key: 'crane', label: 'K', source: 'cranes', kind: 'model', color: [70, 80, 90],
    pointSize: 2, maxPointSize: 4, bloomGroup: 4, baseY: 0,
    scaleU: 1, orientStepU: 1.5, orientProbeR: 1.5,
    legHeight: 0.6, baseW: 0.4, baseD: 0.4, boomLen: 0.5, spacing: 0.1,
  };
  it('falls back to a gantry wireframe when no template is registered', () => {
    // '__none__' is never registered → exercises the fallback regardless of which models are baked in.
    const pts = buildLayerPoints({ ...baseModelCfg, modelKey: '__none__' }, OSM, idProj as any);
    const expected = sampleGantry(
      { x: 5, z: 5 }, 0, { legHeight: 0.6, baseW: 0.4, baseD: 0.4, boomLen: 0.5, spacing: 0.1 },
    ); // OSM.cranes = [{lat:5,lon:5}] → idProj → {x:5,z:5}
    expect(pts.length).toBe(expected.length);
    expect(pts.length).toBeGreaterThan(0);
    expect(pts.length % 3).toBe(0);
  });
  it('instances the carved template (N × template points) when one is registered', () => {
    const tpl = loadLandmarkModel('crane'); // baked crane is wired in landmarkModels RAW
    expect(tpl).not.toBeNull();
    const pts = buildLayerPoints({ ...baseModelCfg, modelKey: 'crane' }, OSM, idProj as any);
    // OSM.cranes has 1 node → exactly one template instance (no fragile hard-coded count)
    expect(pts.length).toBe(tpl!.points.length);
    expect(pts.length % 3).toBe(0);
  });
});

describe('buildLayers', () => {
  const handles = buildLayers(CFG, OSM, idProj as any);
  it('builds one handle per config with a non-empty point cloud', () => {
    expect(handles.map((h) => h.key)).toEqual(['coastline', 'tank', 'crane', 'anchorage']);
    for (const h of handles) expect(h.pc.count).toBeGreaterThan(0);
  });
  it('setVisible toggles points.visible', () => {
    const h = handles[0];
    h.setVisible(false);
    expect(h.pc.points.visible).toBe(false);
    h.setVisible(true);
    expect(h.pc.points.visible).toBe(true);
  });
  it('setColor swaps the ramp texture to the new RGB', () => {
    const h = handles[3];
    h.setColor([200, 100, 50]);
    const tex = (h.pc.points.material as THREE.ShaderMaterial).uniforms.uRamp.value as THREE.DataTexture;
    const d = tex.image.data as Uint8Array;
    expect([d[0], d[1], d[2]]).toEqual([200, 100, 50]);
  });
  it('setSize / setBrightness / setPulseHz drive the uniforms', () => {
    const h = handles[1];
    h.setSize(9); h.setBrightness(1.7);
    const u = (h.pc.points.material as THREE.ShaderMaterial).uniforms;
    expect(u.uPointSize.value).toBe(9);
    expect(u.uBrightness.value).toBeCloseTo(1.7);
    h.setPulseHz(2);
    expect(u.uPulseHz.value).toBe(2);
  });
});

describe('buildLayerPoints kind:model scaleByFootprint(儲槽)', () => {
  const idProj = { toWorld: (lat: number, lon: number) => ({ x: lon, z: lat }) } as any;
  const square = (cx: number, cz: number, r: number) => [
    { lat: cz - r, lon: cx - r }, { lat: cz - r, lon: cx + r },
    { lat: cz + r, lon: cx + r }, { lat: cz + r, lon: cx - r }, { lat: cz - r, lon: cx - r },
  ];
  const osm = { coastline: [], piers: [], breakwater: [], tanks: [square(0, 0, 1), square(50, 50, 2)], cranes: [], anchorages: [] } as any;
  const cfg = {
    key: 'tank', label: '儲槽', source: 'tanks', kind: 'model', modelKey: '儲槽', scaleByFootprint: true,
    color: [1, 1, 1], pointSize: 2, maxPointSize: 4, bloomGroup: 4, baseY: 0,
  } as any;
  it('每座 footprint 產生一份縮放後的模板點雲(非空、xyz 對齊)', () => {
    const pts = buildLayerPoints(cfg, osm, idProj);
    expect(pts.length).toBeGreaterThan(0);
    expect(pts.length % 3).toBe(0);
    // 每座輸出 = 模板全部點(Float32Array 長度);2 座 → 2 × 模板點數
    const tplLen = loadLandmarkModel('儲槽')!.points.length;
    expect(pts.length).toBe(2 * tplLen);
    expect(pts.every(Number.isFinite)).toBe(true); // gate: NaN path (Polyline[] miscast) would fail here
  });
});
