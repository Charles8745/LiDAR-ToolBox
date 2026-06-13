import * as THREE from 'three';
import { sampleGradient, type ColorStop } from './gradient';
import type { RGB } from '../core/types';

function makeTexture(data: Uint8Array<ArrayBuffer>, width: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Build a 1×width RGBA LUT texture from a gradient stop list. */
export function buildRampTexture(stops: ColorStop[], width = 256): THREE.DataTexture {
  if (width < 2) throw new Error('ramp texture width must be >= 2');
  const data = new Uint8Array(new ArrayBuffer(width * 4));
  for (let i = 0; i < width; i++) {
    const [r, g, b] = sampleGradient(stops, i / (width - 1));
    data[i * 4 + 0] = Math.round(r);
    data[i * 4 + 1] = Math.round(g);
    data[i * 4 + 2] = Math.round(b);
    data[i * 4 + 3] = 255;
  }
  return makeTexture(data, width);
}

/** Build a 1×width RGBA LUT texture by sampling a user function over [0,1]. */
export function buildRampTextureFromFn(fn: (dist01: number) => RGB, width = 256): THREE.DataTexture {
  if (width < 2) throw new Error('ramp texture width must be >= 2');
  const data = new Uint8Array(new ArrayBuffer(width * 4));
  for (let i = 0; i < width; i++) {
    const [r, g, b] = fn(i / (width - 1));
    data[i * 4 + 0] = Math.round(r);
    data[i * 4 + 1] = Math.round(g);
    data[i * 4 + 2] = Math.round(b);
    data[i * 4 + 3] = 255;
  }
  return makeTexture(data, width);
}
