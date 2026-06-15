import * as THREE from 'three';
import { RingBuffer } from './RingBuffer';
import type { Hit, Persistence } from './types';
import vertexShader from '../shaders/points.vert.glsl?raw';
import fragmentShader from '../shaders/points.frag.glsl?raw';

export interface PointCloudOptions {
  capacity: number;
  ramp: THREE.Texture;
  persistence: Persistence;
  maxDistance?: number;
  pointSize?: number;
  fadeDuration?: number;
  colorMode?: 'distance' | 'value';
  maxPointSize?: number;
  sizeAttenuation?: boolean;
}

/** GPU point store: a single THREE.Points backed by a FIFO ring buffer of preallocated attributes. */
export class PointCloud {
  readonly points: THREE.Points;
  readonly positionArray: Float32Array;
  readonly distanceArray: Float32Array;
  readonly birthArray: Float32Array;
  readonly valueArray: Float32Array;

  private ring: RingBuffer;
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;
  private posAttr: THREE.BufferAttribute;
  private distAttr: THREE.BufferAttribute;
  private birthAttr: THREE.BufferAttribute;
  private valueAttr: THREE.BufferAttribute;

  constructor(opts: PointCloudOptions) {
    this.ring = new RingBuffer(opts.capacity);
    this.positionArray = new Float32Array(opts.capacity * 3);
    this.distanceArray = new Float32Array(opts.capacity);
    this.birthArray = new Float32Array(opts.capacity);
    this.valueArray = new Float32Array(opts.capacity);

    this.geometry = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positionArray, 3);
    this.distAttr = new THREE.BufferAttribute(this.distanceArray, 1);
    this.birthAttr = new THREE.BufferAttribute(this.birthArray, 1);
    this.valueAttr = new THREE.BufferAttribute(this.valueArray, 1);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.distAttr.setUsage(THREE.DynamicDrawUsage);
    this.birthAttr.setUsage(THREE.DynamicDrawUsage);
    this.valueAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('aDistance', this.distAttr);
    this.geometry.setAttribute('aBirth', this.birthAttr);
    this.geometry.setAttribute('aValue', this.valueAttr);
    this.geometry.setDrawRange(0, 0);
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        // fog_* uniforms the built-in fog chunks read; a raw ShaderMaterial does not
        // get these automatically, so merge them in (cloned to avoid cross-instance sharing).
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uRamp: { value: opts.ramp },
        uTime: { value: 0 },
        uMaxDistance: { value: opts.maxDistance ?? 30 },
        uPointSize: { value: opts.pointSize ?? 2 },
        uFade: { value: opts.persistence === 'fade' ? 1 : 0 },
        uFadeDuration: { value: opts.fadeDuration ?? 6 },
        uColorMode: { value: opts.colorMode === 'value' ? 1 : 0 },
        uMaxPointSize: { value: Math.max(opts.maxPointSize ?? 5, opts.pointSize ?? 2, 1) },
        uSizeAttenuation: { value: opts.sizeAttenuation === false ? 0 : 1 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: true,
      blending: THREE.NormalBlending,
      fog: true,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  get count(): number {
    return this.ring.count;
  }

  /** Append hits, advancing the FIFO ring and flagging the touched buffer ranges for upload. */
  addHits(hits: Hit[], time: number): void {
    if (hits.length === 0) return;
    const segments = this.ring.reserve(hits.length);
    let hi = 0;
    for (const seg of segments) {
      for (let i = 0; i < seg.length; i++) {
        const slot = seg.start + i;
        const h = hits[hi++];
        this.positionArray[slot * 3 + 0] = h.point.x;
        this.positionArray[slot * 3 + 1] = h.point.y;
        this.positionArray[slot * 3 + 2] = h.point.z;
        this.distanceArray[slot] = h.distance;
        this.birthArray[slot] = time;
      }
      this.posAttr.addUpdateRange(seg.start * 3, seg.length * 3);
      this.distAttr.addUpdateRange(seg.start, seg.length);
      this.birthAttr.addUpdateRange(seg.start, seg.length);
    }
    this.posAttr.needsUpdate = true;
    this.distAttr.needsUpdate = true;
    this.birthAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, this.ring.count);
  }

  /**
   * Append a precomputed batch of points directly (no raycast).
   * `positions` is a flat xyz array (length = 3 × n); `values` is the
   * per-point normalized value in [0,1] used by the 'value' color mode.
   */
  addPoints(positions: ArrayLike<number>, values: ArrayLike<number>, time = 0): void {
    const n = values.length;
    if (n === 0) return;
    const segments = this.ring.reserve(n);
    let vi = 0;
    for (const seg of segments) {
      for (let i = 0; i < seg.length; i++) {
        const slot = seg.start + i;
        this.positionArray[slot * 3 + 0] = positions[vi * 3 + 0];
        this.positionArray[slot * 3 + 1] = positions[vi * 3 + 1];
        this.positionArray[slot * 3 + 2] = positions[vi * 3 + 2];
        this.valueArray[slot] = values[vi];
        this.distanceArray[slot] = 0;
        this.birthArray[slot] = time;
        vi++;
      }
      this.posAttr.addUpdateRange(seg.start * 3, seg.length * 3);
      this.valueAttr.addUpdateRange(seg.start, seg.length);
      this.distAttr.addUpdateRange(seg.start, seg.length);
      this.birthAttr.addUpdateRange(seg.start, seg.length);
    }
    this.posAttr.needsUpdate = true;
    this.valueAttr.needsUpdate = true;
    this.distAttr.needsUpdate = true;
    this.birthAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, this.ring.count);
  }

  /** Advance the time uniform (drives fade mode). */
  update(time: number): void {
    this.material.uniforms.uTime.value = time;
  }

  setRamp(texture: THREE.Texture): void {
    this.material.uniforms.uRamp.value = texture;
  }

  setColorMode(mode: 'distance' | 'value'): void {
    this.material.uniforms.uColorMode.value = mode === 'value' ? 1 : 0;
  }

  setPersistence(persistence: Persistence): void {
    this.material.uniforms.uFade.value = persistence === 'fade' ? 1 : 0;
  }

  clear(): void {
    this.ring.clear();
    this.geometry.setDrawRange(0, 0);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
