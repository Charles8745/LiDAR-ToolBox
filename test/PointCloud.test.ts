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

describe('PointCloud value/color mode', () => {
  it('defaults to distance color mode (uColorMode = 0)', () => {
    const pc = new PointCloud({ capacity: 4, ramp, persistence: 'accumulate' });
    expect((pc as any)['material'].uniforms.uColorMode.value).toBe(0);
  });

  it('constructor colorMode "value" sets uColorMode = 1', () => {
    const pc = new PointCloud({ capacity: 4, ramp, persistence: 'accumulate', colorMode: 'value' });
    expect((pc as any)['material'].uniforms.uColorMode.value).toBe(1);
  });

  it('setColorMode toggles the uniform', () => {
    const pc = new PointCloud({ capacity: 4, ramp, persistence: 'accumulate' });
    pc.setColorMode('value');
    expect((pc as any)['material'].uniforms.uColorMode.value).toBe(1);
    pc.setColorMode('distance');
    expect((pc as any)['material'].uniforms.uColorMode.value).toBe(0);
  });

  it('exposes a valueArray sized to capacity and an aValue attribute', () => {
    const pc = new PointCloud({ capacity: 4, ramp, persistence: 'accumulate' });
    expect(pc.valueArray.length).toBe(4);
    expect(pc.points.geometry.getAttribute('aValue')).toBeDefined();
  });

  it('defaults to size attenuation on (uSizeAttenuation = 1)', () => {
    const pc = new PointCloud({ capacity: 4, ramp, persistence: 'accumulate' });
    expect((pc as any)['material'].uniforms.uSizeAttenuation.value).toBe(1);
  });
  it('sizeAttenuation:false sets uSizeAttenuation = 0', () => {
    const pc = new PointCloud({ capacity: 4, ramp, persistence: 'accumulate', sizeAttenuation: false });
    expect((pc as any)['material'].uniforms.uSizeAttenuation.value).toBe(0);
  });
  it('explicit sizeAttenuation:true sets uSizeAttenuation = 1', () => {
    const pc = new PointCloud({ capacity: 4, ramp, persistence: 'accumulate', sizeAttenuation: true });
    expect((pc as any)['material'].uniforms.uSizeAttenuation.value).toBe(1);
  });
});

describe('PointCloud.addPoints', () => {
  it('writes positions and values into the buffers', () => {
    const pc = new PointCloud({ capacity: 4, ramp, persistence: 'accumulate', colorMode: 'value' });
    pc.addPoints(new Float32Array([1, 2, 3, 4, 5, 6]), new Float32Array([0.25, 0.75]));
    expect(pc.count).toBe(2);
    expect([pc.positionArray[0], pc.positionArray[1], pc.positionArray[2]]).toEqual([1, 2, 3]);
    expect([pc.positionArray[3], pc.positionArray[4], pc.positionArray[5]]).toEqual([4, 5, 6]);
    expect(pc.valueArray[0]).toBeCloseTo(0.25);
    expect(pc.valueArray[1]).toBeCloseTo(0.75);
  });

  it('clear then addPoints rebuilds from slot 0 (supports per-frame layer rebuild)', () => {
    const pc = new PointCloud({ capacity: 8, ramp, persistence: 'accumulate', colorMode: 'value' });
    pc.addPoints(new Float32Array([9, 9, 9]), new Float32Array([0.5]));
    pc.clear();
    pc.addPoints(new Float32Array([1, 1, 1, 2, 2, 2]), new Float32Array([0.1, 0.2]));
    expect(pc.count).toBe(2);
    expect([pc.positionArray[0], pc.positionArray[1], pc.positionArray[2]]).toEqual([1, 1, 1]);
  });

  it('flags the written ranges for GPU upload', () => {
    const pc = new PointCloud({ capacity: 4, ramp, persistence: 'accumulate', colorMode: 'value' });
    pc.addPoints(new Float32Array([1, 2, 3, 4, 5, 6]), new Float32Array([0.25, 0.75]));
    const valAttr = pc.points.geometry.getAttribute('aValue') as THREE.BufferAttribute;
    expect(valAttr.updateRanges).toEqual([{ start: 0, count: 2 }]);
  });

  it('ignores an empty batch', () => {
    const pc = new PointCloud({ capacity: 4, ramp, persistence: 'accumulate', colorMode: 'value' });
    pc.addPoints(new Float32Array([]), new Float32Array([]));
    expect(pc.count).toBe(0);
  });
});

describe('PointCloud fog flag', () => {
  it('enables three built-in fog on the material (inert until scene.fog is set)', () => {
    const pc = new PointCloud({ capacity: 2, ramp, persistence: 'accumulate' });
    expect((pc.points.material as THREE.ShaderMaterial).fog).toBe(true);
  });
});
