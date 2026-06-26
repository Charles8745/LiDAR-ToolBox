// test/port-view-carving.test.ts
import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';
import { sampleMask, unionMask, registerGrid, type GridDims } from '../examples/kaohsiung-port/scene/viewCarving';
import {
  extractSilhouette, robustExtent, cropToContent, mirrorX, flipY, rotate90, applyOrient, type Mask,
} from '../examples/kaohsiung-port/scene/viewCarving';

// RGBA buffer: uniform bg, with foreground rects painted in fg colors.
function makeRgba(w: number, h: number, bg: [number,number,number], rects: {x0:number;y0:number;x1:number;y1:number;color:[number,number,number]}[]): Uint8Array {
  const a = new Uint8Array(w*h*4);
  for (let i=0;i<w*h;i++){ a[i*4]=bg[0]; a[i*4+1]=bg[1]; a[i*4+2]=bg[2]; a[i*4+3]=255; }
  for (const r of rects) for (let y=r.y0;y<=r.y1;y++) for (let x=r.x0;x<=r.x1;x++){
    const i=(y*w+x)*4; a[i]=r.color[0]; a[i+1]=r.color[1]; a[i+2]=r.color[2];
  }
  return a;
}
const BG: [number,number,number] = [168,184,188];

describe('extractSilhouette', () => {
  it('marks foreground rect as 1 and background as 0', () => {
    const w=20,h=20;
    const rgba = makeRgba(w,h,BG,[{x0:5,y0:5,x1:14,y1:14,color:[200,60,40]}]);
    const m = extractSilhouette(rgba,w,h,40);
    expect(m.data[10*w+10]).toBe(1);
    expect(m.data[0]).toBe(0);
  });
  it('keeps an enclosed background-coloured hole filled (not reachable from border)', () => {
    const w=20,h=20;
    const rgba = makeRgba(w,h,BG,[{x0:4,y0:4,x1:15,y1:15,color:[200,60,40]}]);
    const i=(10*w+10)*4; rgba[i]=BG[0]; rgba[i+1]=BG[1]; rgba[i+2]=BG[2];
    const m = extractSilhouette(rgba,w,h,40);
    expect(m.data[10*w+10]).toBe(1);
  });
});

describe('robustExtent', () => {
  it('ignores a 1px-wide spike', () => {
    const w=30,h=30; const data=new Uint8Array(w*h);
    for (let y=10;y<=20;y++) for (let x=10;x<=20;x++) data[y*w+x]=1; // 11x11 block
    for (let y=0;y<10;y++) data[y*w+15]=1;                          // 1px spike up
    const e = robustExtent({data,w,h}, 0.1);
    expect(e.y0).toBe(10); expect(e.x0).toBe(10); expect(e.x1).toBe(20); expect(e.y1).toBe(20);
  });
});

describe('cropToContent', () => {
  it('crops to the robust block size', () => {
    const w=30,h=30; const data=new Uint8Array(w*h);
    for (let y=10;y<=20;y++) for (let x=5;x<=24;x++) data[y*w+x]=1; // 20w x 11h
    const c = cropToContent({data,w,h}, 0.1);
    expect(c.w).toBe(20); expect(c.h).toBe(11);
  });
});

describe('mirrorX / flipY', () => {
  it('mirrorX flips a non-square asymmetric mask', () => {
    const m: Mask = { data: new Uint8Array([1,0,0, 0,0,1]), w:3, h:2 };
    expect(Array.from(mirrorX(m).data)).toEqual([0,0,1, 1,0,0]);
  });
  it('flipY flips rows', () => {
    const m: Mask = { data: new Uint8Array([1,0,0, 0,0,1]), w:3, h:2 };
    expect(Array.from(flipY(m).data)).toEqual([0,0,1, 1,0,0]);
  });
});

describe('rotate90 / applyOrient', () => {
  it('rotate90 swaps dims and rotates clockwise', () => {
    // 3w x 2h, top-left set. CW 90° → 2w x 3h, top-right set.
    const m: Mask = { data: new Uint8Array([1,0,0, 0,0,0]), w:3, h:2 };
    const r = rotate90(m);
    expect(r.w).toBe(2); expect(r.h).toBe(3);
    expect(r.data[0*2+1]).toBe(1); // top-right
  });
  it('applyOrient composes rotate then flips', () => {
    const m: Mask = { data: new Uint8Array([1,0,0, 0,0,0]), w:3, h:2 };
    const out = applyOrient(m, { rotate: 0, flipX: true });
    expect(Array.from(out.data)).toEqual([0,0,1, 0,0,0]);
  });
});

export function solid(w: number, h: number): Mask { return { data: new Uint8Array(w*h).fill(1), w, h }; }

describe('sampleMask', () => {
  it('returns 1 inside, 0 out of [0,1)', () => {
    const m = solid(10,10);
    expect(sampleMask(m, 0.5, 0.5)).toBe(1);
    expect(sampleMask(m, -0.1, 0.5)).toBe(0);
    expect(sampleMask(m, 1.0, 0.5)).toBe(0);
  });
});

describe('unionMask', () => {
  it('ORs b (resampled) into a', () => {
    const a: Mask = { data: new Uint8Array(4*4), w:4, h:4 };
    const u = unionMask(a, solid(8,8));
    expect(u.w).toBe(4); expect(u.h).toBe(4);
    expect(Array.from(u.data).every((v) => v === 1)).toBe(true);
  });
});

describe('registerGrid', () => {
  it('anchors length to gridLong and derives beam/height from aspect ratios', () => {
    const d: GridDims = registerGrid(solid(200,50), solid(200,40), solid(32,40), 160);
    expect(d.nz).toBe(160); expect(d.ny).toBe(40); expect(d.nx).toBe(32);
  });
  it('warns when front aspect is inconsistent with side+top', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerGrid(solid(200,50), solid(200,40), solid(60,40), 160); // front 1.5 vs derived 0.8
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
  it('does not warn for consistent aspects', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerGrid(solid(200,50), solid(200,40), solid(32,40), 160); // front 0.8 == derived 0.8
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
