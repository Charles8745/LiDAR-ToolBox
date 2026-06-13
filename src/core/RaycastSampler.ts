import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import type { Ray, Hit } from './types';

// Patch Three.js to use BVH-accelerated raycasting.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

/** Casts rays against a set of meshes using three-mesh-bvh and returns nearest hits. */
export class RaycastSampler {
  private raycaster = new THREE.Raycaster();
  private objects: THREE.Object3D[];

  constructor(objects: THREE.Object3D[]) {
    this.objects = objects;
    // three-mesh-bvh: only return the closest hit per mesh.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.raycaster as any).firstHitOnly = true;
    for (const obj of objects) {
      obj.updateMatrixWorld(true);
      obj.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          // LiDAR rays should hit any face regardless of winding order.
          // Force DoubleSide so the BVH-backed raycast never culls backfaces.
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const mat of materials) {
            mat.side = THREE.DoubleSide;
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (mesh.geometry as any).computeBoundsTree();
        }
      });
    }
  }

  /** Cast every ray; return one nearest Hit per ray that strikes geometry. */
  sample(rays: Ray[]): Hit[] {
    const hits: Hit[] = [];
    for (const ray of rays) {
      this.raycaster.set(ray.origin, ray.direction);
      const intersections = this.raycaster.intersectObjects(this.objects, true);
      if (intersections.length > 0) {
        const nearest = intersections[0];
        hits.push({ point: nearest.point.clone(), distance: nearest.distance });
      }
    }
    return hits;
  }

  dispose(): void {
    for (const obj of this.objects) {
      obj.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (mesh.geometry as any).disposeBoundsTree?.();
        }
      });
    }
  }
}
