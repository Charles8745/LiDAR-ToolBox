import * as THREE from 'three';
import type { Scannable } from '../core/types';

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial());
  mesh.position.set(x, y, z);
  return mesh;
}

/** A procedural corridor (floor/ceiling/walls/back) with a few crates, built from real meshes. */
export function proceduralCave(): Scannable {
  const group = new THREE.Group();
  const len = 26;
  const halfW = 2.6;
  const halfH = 1.6;
  // The corridor extends along -Z so it sits in front of the engine's
  // default camera (Three.js cameras look down their local -Z axis).
  const midZ = -len / 2;

  group.add(box(halfW * 2, 0.2, len, 0, -halfH, midZ)); // floor
  group.add(box(halfW * 2, 0.2, len, 0, halfH, midZ));  // ceiling
  group.add(box(0.2, halfH * 2, len, -halfW, 0, midZ)); // left wall
  group.add(box(0.2, halfH * 2, len, halfW, 0, midZ));  // right wall
  group.add(box(halfW * 2, halfH * 2, 0.2, 0, 0, -len)); // back wall

  group.add(box(2.0, 1.4, 1.2, 0, -0.9, -6.6));   // crate
  group.add(box(1.2, 2.2, 1.0, -2.0, -0.5, -11.5)); // pillar
  group.add(box(1.3, 2.6, 1.2, 2.0, -0.3, -15.6));  // pillar
  group.add(box(1.6, 2.5, 1.0, 0, -0.35, -20.5));   // block

  group.updateMatrixWorld(true);
  return { objects: [group] };
}
