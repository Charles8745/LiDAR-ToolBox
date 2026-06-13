import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Scannable } from '../core/types';

/** Load a glTF/glb file and expose its meshes as a Scannable. */
export async function loadGLTF(url: string): Promise<Scannable> {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  return { objects: [gltf.scene] };
}
