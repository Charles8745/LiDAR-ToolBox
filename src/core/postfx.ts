import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** Objects whose layers include BLOOM_LAYER glow; all others are hidden during the bloom pass. */
export const BLOOM_LAYER = 1;

export interface BloomOptions {
  strength?: number;
  radius?: number;
  threshold?: number;
}

/** Hide every mesh/points NOT on the bloom layer, recording them in `hidden` for restore. */
export function hideNonBloomed(scene: THREE.Object3D, bloomLayer: THREE.Layers, hidden: THREE.Object3D[]): void {
  scene.traverse((o) => {
    const r = o as THREE.Object3D & { isMesh?: boolean; isPoints?: boolean };
    if ((r.isMesh || r.isPoints) && o.visible && bloomLayer.test(o.layers) === false) {
      hidden.push(o);
      o.visible = false;
    }
  });
}

/** Re-show objects hidden by hideNonBloomed and empty the list. */
export function restoreHidden(hidden: THREE.Object3D[]): void {
  for (const o of hidden) o.visible = true;
  hidden.length = 0;
}

export interface SelectiveBloom {
  render(): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}

/** Two-pass selective bloom: bloom-layer objects glow; everything else is hidden during the bloom pass. */
export function createSelectiveBloom(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  opts: BloomOptions = {},
): SelectiveBloom {
  const size = renderer.getSize(new THREE.Vector2());
  const bloomLayer = new THREE.Layers();
  bloomLayer.set(BLOOM_LAYER);
  const hidden: THREE.Object3D[] = [];

  const renderPass = new RenderPass(scene, camera);
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(size.x, size.y),
    opts.strength ?? 0.9,
    opts.radius ?? 0.4,
    opts.threshold ?? 0.0,
  );

  const bloomComposer = new EffectComposer(renderer);
  bloomComposer.renderToScreen = false;
  bloomComposer.addPass(renderPass);
  bloomComposer.addPass(bloomPass);

  const mixPass = new ShaderPass(
    new THREE.ShaderMaterial({
      uniforms: {
        baseTexture: { value: null },
        bloomTexture: { value: bloomComposer.renderTarget2.texture },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform sampler2D baseTexture; uniform sampler2D bloomTexture; varying vec2 vUv; void main(){ gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv); }',
    }),
    'baseTexture',
  );
  mixPass.needsSwap = true;

  const finalComposer = new EffectComposer(renderer);
  finalComposer.addPass(renderPass);
  finalComposer.addPass(mixPass);
  finalComposer.addPass(new OutputPass());

  return {
    render() {
      hideNonBloomed(scene, bloomLayer, hidden);
      try {
        bloomComposer.render();
      } finally {
        restoreHidden(hidden);
      }
      finalComposer.render();
    },
    setSize(width, height) {
      bloomComposer.setSize(width, height);
      finalComposer.setSize(width, height);
    },
    dispose() {
      for (const p of bloomComposer.passes) (p as { dispose?: () => void }).dispose?.();
      for (const p of finalComposer.passes) (p as { dispose?: () => void }).dispose?.();
      bloomComposer.dispose();
      finalComposer.dispose();
    },
  };
}
