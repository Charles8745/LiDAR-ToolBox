import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PointCloud } from '../src/core/PointCloud';

function asBufAttr(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  return attr as THREE.BufferAttribute;
}

function hit(x: number, y: number, z: number, distance: number) {
  return { point: new THREE.Vector3(x, y, z), distance };
}

const ramp = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);

describe('PointCloud.addHits', () => {
  it('writes hit positions, distances and birth time into the buffers', () => {
    const pc = new PointCloud({ capacity: 4, ramp, persistence: 'accumulate' });
    pc.addHits([hit(1, 2, 3, 0.5), hit(4, 5, 6, 1.5)], 10);
    expect(pc.count).toBe(2);
    const pos = pc.positionArray;
    expect([pos[0], pos[1], pos[2]]).toEqual([1, 2, 3]);
    expect([pos[3], pos[4], pos[5]]).toEqual([4, 5, 6]);
    expect(pc.distanceArray[0]).toBeCloseTo(0.5);
    expect(pc.birthArray[1]).toBeCloseTo(10);
  });

  it('wraps around and overwrites oldest slots when over capacity', () => {
    const pc = new PointCloud({ capacity: 4, ramp, persistence: 'accumulate' });
    pc.addHits([hit(0, 0, 0, 1), hit(0, 0, 0, 1), hit(0, 0, 0, 1)], 1); // slots 0,1,2 ; head=3
    pc.addHits([hit(7, 7, 7, 9), hit(8, 8, 8, 9), hit(9, 9, 9, 9)], 2); // slots 3,0,1 ; head=2
    expect(pc.count).toBe(4);
    const pos = pc.positionArray;
    expect([pos[9], pos[10], pos[11]]).toEqual([7, 7, 7]); // slot 3
    expect([pos[0], pos[1], pos[2]]).toEqual([8, 8, 8]);   // slot 0 (overwritten)
    expect([pos[3], pos[4], pos[5]]).toEqual([9, 9, 9]);   // slot 1 (overwritten)
  });

  it('clear resets the count', () => {
    const pc = new PointCloud({ capacity: 4, ramp, persistence: 'accumulate' });
    pc.addHits([hit(1, 1, 1, 1)], 1);
    pc.clear();
    expect(pc.count).toBe(0);
  });

  it('caps count at capacity when given more hits than capacity in one call', () => {
    const pc = new PointCloud({ capacity: 4, ramp, persistence: 'accumulate' });
    pc.addHits([hit(1,1,1,1), hit(2,2,2,2), hit(3,3,3,3), hit(4,4,4,4), hit(5,5,5,5), hit(6,6,6,6)], 1);
    expect(pc.count).toBe(4);
  });

  it('flags the written position range for GPU upload (single segment)', () => {
    const pc = new PointCloud({ capacity: 4, ramp, persistence: 'accumulate' });
    pc.addHits([hit(1, 2, 3, 0.5), hit(4, 5, 6, 1.5)], 10);
    const posAttr = asBufAttr(pc.points.geometry.getAttribute('position'));
    expect(posAttr.updateRanges).toEqual([{ start: 0, count: 6 }]);
  });

  it('flags two ranges when the write wraps around the ring', () => {
    const pc = new PointCloud({ capacity: 4, ramp, persistence: 'accumulate' });
    pc.addHits([hit(0, 0, 0, 1), hit(0, 0, 0, 1), hit(0, 0, 0, 1)], 1); // slots 0,1,2 ; head=3
    pc.addHits([hit(7, 7, 7, 9), hit(8, 8, 8, 9), hit(9, 9, 9, 9)], 2); // slots 3,0,1
    const posAttr = asBufAttr(pc.points.geometry.getAttribute('position'));
    // updateRanges accumulates across calls (three.js never auto-clears it):
    //   first addHits: start 0 count 9  (slots 0,1,2 × 3 components)
    //   second addHits wraps: slot 3 → start 9 count 3 ; slots 0,1 → start 0 count 6
    expect(posAttr.updateRanges).toEqual([
      { start: 0, count: 9 },
      { start: 9, count: 3 },
      { start: 0, count: 6 },
    ]);
  });
});
