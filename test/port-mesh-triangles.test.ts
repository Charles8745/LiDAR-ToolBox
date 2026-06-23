import { describe, it, expect } from 'vitest';
import { BoxGeometry, Mesh, MeshBasicMaterial, Group } from 'three';
import { collectTriangles } from '../examples/kaohsiung-port/scene/meshTriangles';

describe('collectTriangles', () => {
  it('expands a box mesh into 12 world-space triangles', () => {
    const mesh = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial());
    const tris = collectTriangles(mesh);
    expect(tris.length).toBe(12); // a box = 6 faces × 2
  });

  it('applies the mesh world transform (translation)', () => {
    const mesh = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial());
    mesh.position.set(100, 0, 0);
    const group = new Group();
    group.add(mesh);
    const tris = collectTriangles(group);
    // every vertex x should be shifted near +100 (box half-extent 1 → x in [99,101]).
    for (const t of tris) for (const v of [t.a, t.b, t.c]) {
      expect(v.x).toBeGreaterThan(98);
      expect(v.x).toBeLessThan(102);
    }
  });
});
