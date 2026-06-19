import * as THREE from 'three';
import { Text } from 'troika-three-text';
import type { Projection } from '../geo/projection';
import type { BerthMarker } from '../data/berthGeometry';
import { tierOpacity, berthDeclutterVisible, type PortZone, type LodBands } from './portZones';

export interface LabelLayerOpts {
  proj: Projection;
  bands: LodBands;
  nearRadius: number;                       // berth declutter threshold (world units)
  yLift: number;                            // height above y=0 to clear ground Points
  fontUrl: string;                          // CJK subset .woff (also covers digits + #)
  color: number;
  outlineColor: number;
  sceneCenter: { x: number; z: number };    // global LOD distance reference
  fontSizes: { district: number; terminal: number; berth: number };
}

type Tier = 'district' | 'terminal' | 'berth';
interface LabelEntry { text: Text; tier: Tier; x: number; z: number }

export function buildLabelLayer(zones: PortZone[], berths: BerthMarker[], opts: LabelLayerOpts) {
  const group = new THREE.Group();
  const entries: LabelEntry[] = [];
  const tierShown: Record<Tier, boolean> = { district: true, terminal: true, berth: true };

  function add(str: string, lat: number, lon: number, tier: Tier): void {
    const w = opts.proj.toWorld(lat, lon);
    const t = new Text();
    t.text = str;
    t.font = opts.fontUrl;
    t.fontSize = opts.fontSizes[tier];
    t.color = opts.color;
    t.outlineColor = opts.outlineColor;
    t.outlineWidth = '6%';
    t.anchorX = 'center';
    t.anchorY = 'middle';
    t.fillOpacity = 0;       // hidden until LOD raises it (and until SDF is ready)
    t.outlineOpacity = 0;
    t.position.set(w.x, opts.yLift, w.z);
    (t.material as THREE.Material).depthTest = true;
    t.sync();                // pre-warm SDF generation during load (avoids glyph pop-in)
    group.add(t);
    entries.push({ text: t, tier, x: w.x, z: w.z });
  }

  for (const z of zones) add(z.label, z.lat, z.lon, z.tier);
  for (const b of berths) add(b.code, b.lat, b.lon, 'berth');

  function update(camera: THREE.Camera): void {
    const dx = camera.position.x - opts.sceneCenter.x;
    const dz = camera.position.z - opts.sceneCenter.z;
    const camDist = Math.sqrt(dx * dx + camera.position.y * camera.position.y + dz * dz);
    for (const e of entries) {
      if (!tierShown[e.tier]) { e.text.visible = false; continue; }
      let op = tierOpacity(e.tier, camDist, opts.bands);
      if (e.tier === 'berth' && op > 0) {
        const ldx = camera.position.x - e.x, ldz = camera.position.z - e.z;
        const lDist = Math.sqrt(ldx * ldx + camera.position.y * camera.position.y + ldz * ldz);
        if (!berthDeclutterVisible(lDist, opts.nearRadius)) op = 0;
      }
      e.text.fillOpacity = op;
      e.text.outlineOpacity = op;
      e.text.visible = op > 0.01;
      if (e.text.visible) e.text.quaternion.copy(camera.quaternion); // billboard
    }
  }

  function setTierVisible(tier: Tier, on: boolean): void { tierShown[tier] = on; }
  function dispose(): void { for (const e of entries) e.text.dispose(); }

  return { group, update, setTierVisible, dispose };
}
