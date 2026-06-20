import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RaycastSampler } from './RaycastSampler';
import { PointCloud } from './PointCloud';
import { createSelectiveBloom, BLOOM_LAYER, type SelectiveBloom, type BloomOptions, type BloomGroup } from './postfx';
import { buildRampTextureFromFn } from '../ramps/lut';
import { runUpdaters, type UpdateFn } from './updaters';
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
  /** Orbit dolly clamps (world units). Prevents zooming onto the pivot (feels "stuck") or out to nothing. */
  cameraMinDistance?: number;
  cameraMaxDistance?: number;
  /** Enable arrow-key panning of the orbit camera (continuous, ground-plane; listens on window). */
  keyboardPan?: boolean;
  /** Ground-plane pan speed factor (fraction of target-distance per second; default 0.8). */
  keyPanSpeed?: number;
  autoScan?: boolean;
  fog?: { color?: number; near?: number; far?: number } | boolean;
  /** Single group on BLOOM_LAYER, or an array of independently-tuned groups (each with its own `layer`). */
  bloom?: BloomOptions | BloomGroup[] | boolean;
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
  private bloom: SelectiveBloom | null = null;
  private autoScan: boolean = true;
  private extraLayers: THREE.Object3D[] = [];
  private updaters: UpdateFn[] = [];

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

  // keyboard pan (continuous, ground-plane) — held arrow keys glide the orbit rig
  private panKeys = new Set<string>();
  private onPanKeyDown?: (e: KeyboardEvent) => void;
  private onPanKeyUp?: (e: KeyboardEvent) => void;
  private keyPanSpeed = 0.8;
  private panFwd = new THREE.Vector3();
  private panRight = new THREE.Vector3();
  private panDelta = new THREE.Vector3();
  private worldUp = new THREE.Vector3(0, 1, 0);

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
      if (opts.cameraMinDistance !== undefined) this.controls.minDistance = opts.cameraMinDistance;
      if (opts.cameraMaxDistance !== undefined) this.controls.maxDistance = opts.cameraMaxDistance;
      if (opts.keyboardPan) {
        this.keyPanSpeed = opts.keyPanSpeed ?? 0.8;
        const codes = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
        this.onPanKeyDown = (e: KeyboardEvent) => {
          if (codes.has(e.code)) { this.panKeys.add(e.code); e.preventDefault(); }
        };
        this.onPanKeyUp = (e: KeyboardEvent) => { this.panKeys.delete(e.code); };
        window.addEventListener('keydown', this.onPanKeyDown);
        window.addEventListener('keyup', this.onPanKeyUp);
      }
      this.controls.update();
    } else {
      this.camera.position.set(0, 0, 0);
      this.applyCameraRotation();
    }

    if (opts.fog) {
      const f = opts.fog === true ? {} : opts.fog;
      const fogColor = f.color ?? 0x0b0c0e;
      this.scene.fog = new THREE.Fog(fogColor, f.near ?? far * 0.4, f.far ?? far * 1.2);
      this.renderer.setClearColor(fogColor, 1);
    }
    if (opts.bloom) {
      const b = opts.bloom === true ? {} : opts.bloom;
      this.bloom = createSelectiveBloom(this.renderer, this.scene, this.camera, b);
    }
  }

  private aspect(): number {
    return this.renderer.domElement.clientWidth / Math.max(1, this.renderer.domElement.clientHeight);
  }

  resize(): void {
    const c = this.renderer.domElement;
    this.renderer.setSize(c.clientWidth, c.clientHeight, false);
    if (this.bloom) this.bloom.setSize(c.clientWidth, c.clientHeight);
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
    this.applyKeyboardPan(dt);
    this.controls?.update();
    this.tick(dt, this.time);

    if (this.bloom) this.bloom.render();
    else this.renderer.render(this.scene, this.camera);
    this.rafId = requestAnimationFrame(this.loop);
  };

  /** Glide the orbit rig along the ground plane for held arrow keys (forward/back + strafe; no vertical). */
  private applyKeyboardPan(dt: number): void {
    if (!this.controls || this.panKeys.size === 0) return;
    this.camera.getWorldDirection(this.panFwd);
    this.panFwd.y = 0;
    if (this.panFwd.lengthSq() < 1e-6) return; // looking straight down → no ground heading
    this.panFwd.normalize();
    this.panRight.crossVectors(this.panFwd, this.worldUp).normalize();
    const distToTarget = this.camera.position.distanceTo(this.controls.target);
    const step = this.keyPanSpeed * distToTarget * dt;
    this.panDelta.set(0, 0, 0);
    if (this.panKeys.has('ArrowUp')) this.panDelta.addScaledVector(this.panFwd, step);
    if (this.panKeys.has('ArrowDown')) this.panDelta.addScaledVector(this.panFwd, -step);
    if (this.panKeys.has('ArrowRight')) this.panDelta.addScaledVector(this.panRight, step);
    if (this.panKeys.has('ArrowLeft')) this.panDelta.addScaledVector(this.panRight, -step);
    this.camera.position.add(this.panDelta);
    this.controls.target.add(this.panDelta);
  }

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

  /**
   * Attach an app-owned object to the scene. `opts.bloom` makes it glow:
   * `true` → default BLOOM_LAYER; a number → that bloom group's layer (for multi-group bloom).
   */
  addLayer(obj: THREE.Object3D, opts?: { bloom?: boolean | number }): void {
    this.extraLayers.push(obj);
    if (opts?.bloom === true) obj.layers.enable(BLOOM_LAYER);
    else if (typeof opts?.bloom === 'number') obj.layers.enable(opts.bloom);
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

  /** Register a per-frame callback (dt seconds, absolute time). Runs once per rendered frame. */
  addUpdate(fn: UpdateFn): void { this.updaters.push(fn); }

  /** Run all registered updaters. Called by the render loop; exposed for headless testing. */
  tick(dt: number, time: number): void { runUpdaters(this.updaters, dt, time); }

  /** The render camera (for app-side world→screen projection / picking). */
  get camera3D(): THREE.PerspectiveCamera { return this.camera; }

  dispose(): void {
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.rafId);
    if (this.onPanKeyDown) window.removeEventListener('keydown', this.onPanKeyDown);
    if (this.onPanKeyUp) window.removeEventListener('keyup', this.onPanKeyUp);
    this.sampler.dispose();
    this.pointCloud.dispose();
    this.ownedRamp?.dispose();
    this.controls?.dispose();
    this.bloom?.dispose();
    for (const layer of this.extraLayers) {
      this.scene.remove(layer);
      const points = layer as THREE.Points;
      points.geometry?.dispose();
      const mat = points.material;
      if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((m) => m.dispose());
    }
    this.extraLayers.length = 0;
    this.updaters.length = 0;
    this.renderer.dispose();
  }
}
