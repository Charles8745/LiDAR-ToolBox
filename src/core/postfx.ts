import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** Default bloom layer: objects with this layer enabled glow under the (single-group) bloom. */
export const BLOOM_LAYER = 1;

export interface BloomOptions {
  strength?: number;
  radius?: number;
  threshold?: number;
}

/** One independently-tuned bloom group, keyed by a Three.js layer index. */
export interface BloomGroup extends BloomOptions {
  layer: number;
}

/**
 * Normalize the bloom option into a list of groups. A single `BloomOptions` becomes
 * one group on `BLOOM_LAYER`; an array is taken as-is (each entry defaulting its layer
 * to `BLOOM_LAYER` if omitted).
 */
export function normalizeBloomGroups(opts: BloomOptions | BloomGroup[]): BloomGroup[] {
  if (Array.isArray(opts)) {
    return opts.map((g) => ({ layer: g.layer ?? BLOOM_LAYER, strength: g.strength, radius: g.radius, threshold: g.threshold }));
  }
  return [{ layer: BLOOM_LAYER, ...opts }];
}

/** Hide every mesh/points NOT on the given bloom layer, recording them in `hidden` for restore. */
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

interface BloomChain {
  bloomLayer: THREE.Layers;
  composer: EffectComposer;
}

/**
 * Selective bloom with one or more independently-tuned groups. Each group renders only
 * its layer's objects on pure black through its own UnrealBloomPass; the final pass adds
 * every group's bloom on top of the full scene. A single `BloomOptions` = one group on
 * `BLOOM_LAYER` (backward compatible).
 */
export function createSelectiveBloom(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  opts: BloomOptions | BloomGroup[] = {},
): SelectiveBloom {
  const size = renderer.getSize(new THREE.Vector2());
  const groups = normalizeBloomGroups(opts);
  const hidden: THREE.Object3D[] = [];

  // One bloom chain per group. Each renders its layer's objects on PURE BLACK (so the
  // non-black clear color can't flood the frame through the high-pass).
  const chains: BloomChain[] = groups.map((g) => {
    const bloomLayer = new THREE.Layers();
    bloomLayer.set(g.layer);
    const renderPass = new RenderPass(scene, camera, undefined, new THREE.Color(0x000000), 1);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      g.strength ?? 0.9,
      g.radius ?? 0.4,
      g.threshold ?? 0.0,
    );
    const composer = new EffectComposer(renderer);
    composer.renderToScreen = false;
    composer.addPass(renderPass);
    composer.addPass(bloomPass);
    return { bloomLayer, composer };
  });

  // Mix shader: full scene + the sum of every group's bloom texture.
  const uniforms: Record<string, THREE.IUniform> = { baseTexture: { value: null } };
  chains.forEach((c, i) => { uniforms[`bloom${i}`] = { value: c.composer.renderTarget2.texture }; });
  const samplerDecls = chains.map((_, i) => `uniform sampler2D bloom${i};`).join(' ');
  const sumExpr = chains.map((_, i) => ` + texture2D(bloom${i}, vUv)`).join('');
  const mixPass = new ShaderPass(
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform sampler2D baseTexture; ${samplerDecls} varying vec2 vUv; void main(){ gl_FragColor = texture2D(baseTexture, vUv)${sumExpr}; }`,
    }),
    'baseTexture',
  );
  mixPass.needsSwap = true;

  const finalRenderPass = new RenderPass(scene, camera);
  const finalComposer = new EffectComposer(renderer);
  finalComposer.addPass(finalRenderPass);
  finalComposer.addPass(mixPass);
  finalComposer.addPass(new OutputPass());

  return {
    render() {
      for (const c of chains) {
        hideNonBloomed(scene, c.bloomLayer, hidden);
        try {
          c.composer.render();
        } finally {
          restoreHidden(hidden);
        }
      }
      finalComposer.render();
    },
    setSize(width, height) {
      for (const c of chains) c.composer.setSize(width, height);
      finalComposer.setSize(width, height);
    },
    dispose() {
      for (const c of chains) {
        for (const p of c.composer.passes) (p as { dispose?: () => void }).dispose?.();
        c.composer.dispose();
      }
      for (const p of finalComposer.passes) (p as { dispose?: () => void }).dispose?.();
      finalComposer.dispose();
    },
  };
}
