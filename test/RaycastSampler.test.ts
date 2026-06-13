import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { RaycastSampler } from '../src/core/RaycastSampler';

function unitPlaneAtZ(z: number): THREE.Mesh {
  // 10x10 plane facing -Z, centered at (0,0,z)
  const geo = new THREE.PlaneGeometry(10, 10);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  mesh.position.set(0, 0, z);
  mesh.updateMatrixWorld(true);
  return mesh;
}

describe('RaycastSampler', () => {
  it('returns a hit with correct distance for a ray that strikes geometry', () => {
    const sampler = new RaycastSampler([unitPlaneAtZ(5)]);
    const hits = sampler.sample([
      { origin: new THREE.Vector3(0, 0, 0), direction: new THREE.Vector3(0, 0, 1) },
    ]);
    expect(hits.length).toBe(1);
    expect(hits[0].distance).toBeCloseTo(5, 4);
    expect(hits[0].point.z).toBeCloseTo(5, 4);
  });

  it('returns no hit for a ray that misses', () => {
    const sampler = new RaycastSampler([unitPlaneAtZ(5)]);
    const hits = sampler.sample([
      { origin: new THREE.Vector3(0, 0, 0), direction: new THREE.Vector3(0, 1, 0) },
    ]);
    expect(hits.length).toBe(0);
  });

  it('returns the nearest hit when rays could strike multiple surfaces', () => {
    const sampler = new RaycastSampler([unitPlaneAtZ(5), unitPlaneAtZ(8)]);
    const hits = sampler.sample([
      { origin: new THREE.Vector3(0, 0, 0), direction: new THREE.Vector3(0, 0, 1) },
    ]);
    expect(hits.length).toBe(1);
    expect(hits[0].distance).toBeCloseTo(5, 4);
  });
});
