import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildLayers, buildLayerPoints, type LayerConfig } from '../examples/kaohsiung-port/scene/layers';
import type { OsmGeometry } from '../examples/kaohsiung-port/data/osm';
import { sampleGantry } from '../examples/kaohsiung-port/scene/landmarks';

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
  const modelCfg: LayerConfig = {
    key: 'crane', label: 'K', source: 'cranes', kind: 'model', color: [70, 80, 90],
    pointSize: 2, maxPointSize: 4, bloomGroup: 4, baseY: 0,
    modelKey: 'crane', scaleU: 1, orientStepU: 1.5, orientProbeR: 1.5,
    legHeight: 0.6, baseW: 0.4, baseD: 0.4, boomLen: 0.5, spacing: 0.1,
  };
  it('falls back to a gantry wireframe when no template is registered', () => {
    const pts = buildLayerPoints(modelCfg, OSM, idProj as any);
    const expected = sampleGantry(
      { x: 5, z: 5 }, 0, { legHeight: 0.6, baseW: 0.4, baseD: 0.4, boomLen: 0.5, spacing: 0.1 },
    ); // OSM.cranes = [{lat:5,lon:5}] → idProj → {x:5,z:5}
    expect(pts.length).toBe(expected.length);
    expect(pts.length).toBeGreaterThan(0);
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
