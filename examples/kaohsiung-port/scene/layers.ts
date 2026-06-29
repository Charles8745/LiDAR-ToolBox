import { PointCloud, buildCategoryLUT } from '../../../src/index';
import type { RGB } from '../../../src/core/types';
import type { Projection, World } from '../geo/projection';
import type { OsmGeometry, Polyline, LatLon } from '../data/osm';
import { samplePolyline } from './portPoints';
import { footprintCentroidRadius, sampleCylinderShell, sampleGantry, sampleZoneRing } from './landmarks';
import { loadLandmarkModel, buildModelInstances } from './landmarkModels';
import { buildPierSegs, collectLandPoints } from './orient';

export type LayerKind = 'line' | 'cylinder' | 'gantry' | 'zone' | 'model';

/**
 * One layer's full configuration. `kind` and `source` must be paired correctly
 * (the builder casts `osm[source]` per `kind`):
 *   - kind 'line'     → source of Polyline[] (coastline | piers | breakwater)
 *   - kind 'cylinder' → source of Polyline[] closed footprints (tanks)
 *   - kind 'gantry'   → source of LatLon[]   points (cranes)
 *   - kind 'zone'     → source of Polyline[] (anchorages: node = length-1 polyline)
 * A mismatched pairing yields a garbled/empty layer, not a type error.
 * `bloomGroup` is not used here; the consumer (main.ts) reads `handle.config.bloomGroup`
 * to assign the Three.js bloom layer when calling `engine.addLayer`.
 */
export interface LayerConfig {
  key: string;
  label: string;
  source: keyof OsmGeometry;
  kind: LayerKind;
  color: RGB;
  pointSize: number;
  maxPointSize: number;
  brightness?: number;   // default 1
  pulseHz?: number;      // default 0
  bloomGroup: number;
  baseY: number;
  visible?: boolean;     // default true
  spacing?: number;      // line / zone-area sampling
  // cylinder
  height?: number; rings?: number; perRing?: number;
  // gantry
  legHeight?: number; baseW?: number; baseD?: number; boomLen?: number;
  // zone (node)
  radius?: number; ringCount?: number;
  // model (carved landmark template instanced at each `source` point)
  modelKey?: string; scaleU?: number; orientStepU?: number; orientProbeR?: number;
  headingOverrides?: Record<number, 1 | -1>;
}

export interface LayerHandle {
  key: string;
  config: Readonly<LayerConfig>;
  pc: PointCloud;
  setVisible(on: boolean): void;
  setColor(rgb: RGB): void;
  setBrightness(b: number): void;
  setSize(px: number): void;
  setPulseHz(hz: number): void;
}

const toWorld = (proj: Projection, ll: LatLon): World => proj.toWorld(ll.lat, ll.lon);

/** Generate the flat xyz point array for one layer config from its OSM source. */
export function buildLayerPoints(cfg: LayerConfig, osm: OsmGeometry, proj: Projection): number[] {
  const raw = (osm[cfg.source] ?? []) as unknown[];
  const out: number[] = [];
  if (cfg.kind === 'line') {
    const spacing = cfg.spacing ?? 0.8;
    for (const line of raw as Polyline[]) {
      for (const p of samplePolyline(line.map((l) => toWorld(proj, l)), spacing)) out.push(p.x, cfg.baseY, p.z);
    }
  } else if (cfg.kind === 'cylinder') {
    for (const poly of raw as Polyline[]) {
      const { center, radius } = footprintCentroidRadius(poly.map((l) => toWorld(proj, l)));
      out.push(...sampleCylinderShell(center, radius, cfg.baseY, cfg.height ?? 0.3, cfg.rings ?? 6, cfg.perRing ?? 32));
    }
  } else if (cfg.kind === 'gantry') {
    for (const pt of raw as LatLon[]) {
      out.push(...sampleGantry(toWorld(proj, pt), cfg.baseY, {
        legHeight: cfg.legHeight ?? 0.6, baseW: cfg.baseW ?? 0.4,
        baseD: cfg.baseD ?? 0.4, boomLen: cfg.boomLen ?? 0.5, spacing: cfg.spacing ?? 0.05,
      }));
    }
  } else if (cfg.kind === 'model') {
    const cranePts = raw as LatLon[];
    const tpl = cfg.modelKey ? loadLandmarkModel(cfg.modelKey) : null;
    if (!tpl) { // no baked template → fall back to procedural gantry wireframe
      for (const pt of cranePts) {
        out.push(...sampleGantry(toWorld(proj, pt), cfg.baseY, {
          legHeight: cfg.legHeight ?? 0.6, baseW: cfg.baseW ?? 0.4,
          baseD: cfg.baseD ?? 0.4, boomLen: cfg.boomLen ?? 0.5, spacing: cfg.spacing ?? 0.05,
        }));
      }
      return out;
    }
    const segs = buildPierSegs((osm.piers ?? []) as Polyline[], proj);
    const land = collectLandPoints(osm, proj);
    const centers = cranePts.map((ll) => toWorld(proj, ll));
    const opts = { stepU: cfg.orientStepU ?? 1.5, probeR: cfg.orientProbeR ?? 1.5 };
    // Return directly — do NOT `out.push(...bigArray)`: ~70×1200×3 numbers spread as args overflows
    // the JS call-arg limit (RangeError). The model branch is exclusive, so `out` is still empty here.
    return buildModelInstances(tpl, centers, segs, land, opts, cfg.scaleU ?? 1, cfg.baseY, cfg.headingOverrides);
  } else { // zone
    for (const poly of raw as Polyline[]) {
      if (poly.length === 1) {
        out.push(...sampleZoneRing(toWorld(proj, poly[0]), cfg.radius ?? 1.0, cfg.baseY, cfg.ringCount ?? 48));
      } else {
        for (const p of samplePolyline(poly.map((l) => toWorld(proj, l)), cfg.spacing ?? 0.5)) out.push(p.x, cfg.baseY, p.z);
      }
    }
  }
  return out;
}

/** Build one single-color PointCloud per config and return controllable handles. */
export function buildLayers(configs: LayerConfig[], osm: OsmGeometry, proj: Projection): LayerHandle[] {
  return configs.map((cfg) => {
    const positions = new Float32Array(buildLayerPoints(cfg, osm, proj));
    const values = new Float32Array(positions.length / 3).fill(0.5);
    const pc = new PointCloud({
      capacity: positions.length / 3 + 16,
      ramp: buildCategoryLUT([cfg.color]),
      persistence: 'accumulate',
      colorMode: 'value',
      sizeAttenuation: false,
      pointSize: cfg.pointSize,
      maxPointSize: cfg.maxPointSize,
      pulseHz: cfg.pulseHz ?? 0,
    });
    pc.addPoints(positions, values);
    pc.setBrightness(cfg.brightness ?? 1);
    pc.points.visible = cfg.visible !== false;
    return {
      key: cfg.key,
      config: cfg,
      pc,
      setVisible: (on: boolean) => { pc.points.visible = on; },
      setColor: (rgb: RGB) => { pc.setRamp(buildCategoryLUT([rgb])); },
      setBrightness: (b: number) => { pc.setBrightness(b); },
      setSize: (px: number) => { pc.setPointSize(px); },
      setPulseHz: (hz: number) => { pc.setPulseHz(hz); },
    };
  });
}
