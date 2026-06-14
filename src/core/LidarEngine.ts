import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RaycastSampler } from './RaycastSampler';
import { PointCloud } from './PointCloud';
import { buildRampTextureFromFn } from '../ramps/lut';
import type { Emitter, Scannable, ColorRamp, Persistence, EmitContext } from './types';

export interface LidarEngineOptions {
  canvas: HTMLCanvasElement;
  scannable?: Scannable;
  emitter?: Emitter;
  ramp?: ColorRamp;
  pointBudget?: number;
  persistence?: Persistence;
  maxDistance?: number;
  pointSize?: number;
  maxPointSize?: number;
  fadeDuration?: number;
  colorMode?: 'distance' | 'value';
  sizeAttenuation?: boolean;
  cameraMode?: 'lookAround' | 'orbit';
  cameraPosition?: [number, number, number];
  cameraTarget?: [number, number, number];
  cameraFar?: number;
  autoScan?: boolean;
}

function resolveRamp(ramp: ColorRamp | undefined): THREE.Texture {
  if (!ramp) {
    return buildRampTextureFromFn((t) => [255 * (1 - t) + 60 * t, 120 + 100 * t, 255 * t + 80]);
  }
  return typeof ramp === 'function' ? buildRampTextureFromFn(ramp) : ramp;
}

/** Orchestrates the scan loop: emitter → raycast → point cloud → render. */
export class LidarEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private sampler: RaycastSampler;
  private pointCloud: PointCloud;
  private emitter: Emitter;

  private controls: OrbitControls | null = null;
  private autoScan: boolean = true;
  private extraLayers: THREE.Object3D[] = [];

  private aim = new THREE.Vector2(0, 0);
  private yaw = 0;
  private pitch = 0;
  private clock = new THREE.Clock();
  private time = 0;
  private running = false;
  private rafId = 0;
  private ownedRamp: THREE.Texture | null = null;
  private disposed = false;

  // reused scratch vectors (avoid per-frame allocation)
  private fwd = new THREE.Vector3();
  private right = new THREE.Vector3();
  private upVec = new THREE.Vector3();

  constructor(opts: LidarEngineOptions) {
    this.renderer = new THREE.WebGLRenderer({ canvas: opts.canvas, antialias: true });
    this.renderer.setClearColor(0x05060a, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.resize();

    const far = opts.cameraFar ?? 500;
    this.camera = new THREE.PerspectiveCamera(70, this.aspect(), 0.05, far);
    this.autoScan = opts.autoScan ?? true;

    this.sampler = new RaycastSampler(opts.scannable?.objects ?? []);
    const rampTex = resolveRamp(opts.ramp);
    this.ownedRamp = opts.ramp === undefined || typeof opts.ramp === 'function' ? rampTex : null;
    this.pointCloud = new PointCloud({
      capacity: opts.pointBudget ?? 500_000,
      ramp: rampTex,
      persistence: opts.persistence ?? 'accumulate',
      maxDistance: opts.maxDistance,
      pointSize: opts.pointSize,
      maxPointSize: opts.maxPointSize,
      fadeDuration: opts.fadeDuration,
      colorMode: opts.colorMode,
      sizeAttenuation: opts.sizeAttenuation,
    });
    this.scene.add(this.pointCloud.points);
    this.emitter = opts.emitter ?? { emit: () => [] };

    if (opts.cameraMode === 'orbit') {
      this.camera.position.set(...(opts.cameraPosition ?? ([0, 120, 160] as [number, number, number])));
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.target.set(...(opts.cameraTarget ?? ([0, 0, 0] as [number, number, number])));
      this.controls.enableDamping = true;
      this.controls.update();
    } else {
      this.camera.position.set(0, 0, 0);
      this.applyCameraRotation();
    }
  }

  private aspect(): number {
    return this.renderer.domElement.clientWidth / Math.max(1, this.renderer.domElement.clientHeight);
  }

  resize(): void {
    const c = this.renderer.domElement;
    this.renderer.setSize(c.clientWidth, c.clientHeight, false);
    if (this.camera) {
      this.camera.aspect = this.aspect();
      this.camera.updateProjectionMatrix();
    }
  }

  start(): void {
    if (this.disposed) return;
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.loop();
  }

  private loop = (): void => {
    if (!this.running) return;
    const dt = this.clock.getDelta();
    this.time += dt;

    if (this.autoScan) {
      this.camera.getWorldDirection(this.fwd);
      this.right.crossVectors(this.fwd, this.camera.up).normalize();
      this.upVec.crossVectors(this.right, this.fwd).normalize();

      const ctx: EmitContext = {
        origin: this.camera.position,
        forward: this.fwd,
        right: this.right,
        up: this.upVec,
        aim: this.aim,
        time: this.time,
        dt,
        rng: Math.random,
      };
      const rays = this.emitter.emit(ctx);
      const hits = this.sampler.sample(rays);
      this.pointCloud.addHits(hits, this.time);
    }
    this.pointCloud.update(this.time);
    for (const layer of this.extraLayers) {
      const mat = (layer as THREE.Points).material as THREE.ShaderMaterial | undefined;
      if (mat && mat.uniforms && mat.uniforms.uTime) mat.uniforms.uTime.value = this.time;
    }
    this.controls?.update();

    this.renderer.render(this.scene, this.camera);
    this.rafId = requestAnimationFrame(this.loop);
  };

  /** Set the cursor aim from canvas-relative client coordinates. */
  aimAt(clientX: number, clientY: number): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.aim.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
  }

  /** Set the aim directly in normalized [-1,1] coordinates (used by demo auto-sweep). */
  setAim(x: number, y: number): void {
    this.aim.set(x, y);
  }

  /** Orbit the view by pixel deltas (drag). */
  look(dx: number, dy: number): void {
    this.yaw -= dx * 0.004;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.004, -1.2, 1.2);
    this.applyCameraRotation();
  }

  private applyCameraRotation(): void {
    const euler = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);
  }

  clear(): void {
    this.pointCloud.clear();
  }

  setRamp(ramp: ColorRamp): void {
    const tex = resolveRamp(ramp);
    if (this.ownedRamp && this.ownedRamp !== tex) this.ownedRamp.dispose();
    this.ownedRamp = typeof ramp === 'function' ? tex : null;
    this.pointCloud.setRamp(tex);
  }

  setEmitter(emitter: Emitter): void {
    this.emitter = emitter;
  }

  setPersistence(persistence: Persistence): void {
    this.pointCloud.setPersistence(persistence);
  }

  /** Attach an app-owned object (e.g. another PointCloud's `.points`) to the scene. */
  addLayer(obj: THREE.Object3D): void {
    this.extraLayers.push(obj);
    this.scene.add(obj);
  }

  pause(): void {
    this.running = false;
  }

  resume(): void {
    if (!this.running) this.start();
  }

  get pointCount(): number {
    return this.pointCloud.count;
  }

  /** The render camera (for app-side world→screen projection / picking). */
  get camera3D(): THREE.PerspectiveCamera { return this.camera; }

  dispose(): void {
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.sampler.dispose();
    this.pointCloud.dispose();
    this.ownedRamp?.dispose();
    this.controls?.dispose();
    for (const layer of this.extraLayers) {
      this.scene.remove(layer);
      const points = layer as THREE.Points;
      points.geometry?.dispose();
      const mat = points.material;
      if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((m) => m.dispose());
    }
    this.extraLayers.length = 0;
    this.renderer.dispose();
  }
}
