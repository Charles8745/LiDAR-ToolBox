import { Mesh, Vector3, type Object3D, type BufferGeometry } from 'three';
import type { Triangle } from './meshSampling';

/** Traverse all meshes under `root`, apply world matrices, return world-space triangles. */
export function collectTriangles(root: Object3D): Triangle[] {
  root.updateWorldMatrix(true, true);
  const out: Triangle[] = [];
  const va = new Vector3(), vb = new Vector3(), vc = new Vector3();
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!(mesh instanceof Mesh)) return;
    const geom = mesh.geometry as BufferGeometry;
    const pos = geom.getAttribute('position');
    if (!pos) return;
    const index = geom.getIndex();
    const triCount = index ? index.count / 3 : pos.count / 3;
    for (let t = 0; t < triCount; t++) {
      const i0 = index ? index.getX(t * 3) : t * 3;
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      va.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld);
      vb.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld);
      vc.fromBufferAttribute(pos, i2).applyMatrix4(mesh.matrixWorld);
      out.push({
        a: { x: va.x, y: va.y, z: va.z },
        b: { x: vb.x, y: vb.y, z: vb.z },
        c: { x: vc.x, y: vc.y, z: vc.z },
      });
    }
  });
  return out;
}
