import * as THREE from 'three';

/** Color as [r, g, b], each channel 0..255. */
export type RGB = [number, number, number];

/** A single scan ray. `direction` is expected to be normalized. */
export interface Ray {
  origin: THREE.Vector3;
  direction: THREE.Vector3;
}

/** A ray's intersection with the scannable geometry. */
export interface Hit {
  point: THREE.Vector3;
  distance: number; // distance from ray origin
}

/** State handed to an emitter each frame. `rng` is injectable for determinism. */
export interface EmitContext {
  origin: THREE.Vector3;  // scanner (camera) position
  forward: THREE.Vector3; // camera forward (normalized)
  right: THREE.Vector3;   // camera right (normalized)
  up: THREE.Vector3;      // camera up (normalized)
  aim: THREE.Vector2;     // normalized cursor offset, components in [-1, 1]
  time: number;           // seconds since start
  dt: number;             // seconds since last frame
  rng: () => number;      // returns [0, 1); injectable for tests
}

/** A scan emitter produces a batch of rays per frame. */
export interface Emitter {
  emit(ctx: EmitContext): Ray[];
}

/** The geometry being scanned. Meshes must be raycastable (BVH built by the sampler). */
export interface Scannable {
  objects: THREE.Object3D[];
}

/** Distance→color mapping. Either a prebuilt LUT texture or a function over dist01∈[0,1] → RGB(0..255). */
export type ColorRamp = THREE.Texture | ((dist01: number) => RGB);

export type Persistence = 'accumulate' | 'fade';
