import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { classifyView, decodeMask, VIEW_BAKE_CONFIG } from '../examples/kaohsiung-port/data/scan-views';

describe('classifyView', () => {
  it('maps filename keywords to view kinds (specific before generic)', () => {
    expect(classifyView('front.png')).toBe('front');
    expect(classifyView('bow_01.jpg')).toBe('front');
    expect(classifyView('stern.png')).toBe('stern');
    expect(classifyView('aft.png')).toBe('stern');
    expect(classifyView('side.png')).toBe('side');
    expect(classifyView('port.png')).toBe('side');
    expect(classifyView('starboard.png')).toBe('side2');
    expect(classifyView('side2.png')).toBe('side2');
    expect(classifyView('top.png')).toBe('top');
    expect(classifyView('deck.png')).toBe('top');
    expect(classifyView('bottom.png')).toBe('bottom');
    expect(classifyView('hull.png')).toBe('bottom');
    expect(classifyView('readme.txt')).toBe(null);
  });
});

describe('decodeMask', () => {
  it('decodes a PNG and extracts the foreground silhouette', async () => {
    const w=20,h=20; const raw=Buffer.alloc(w*h*3);
    for (let i=0;i<w*h;i++){ raw[i*3]=168; raw[i*3+1]=184; raw[i*3+2]=188; } // bg
    for (let y=5;y<=14;y++) for (let x=5;x<=14;x++){ const i=(y*w+x)*3; raw[i]=200; raw[i+1]=60; raw[i+2]=40; }
    const png = await sharp(raw, { raw:{ width:w, height:h, channels:3 } }).png().toBuffer();
    const m = await decodeMask(png, 40);
    expect(m.w).toBe(20); expect(m.h).toBe(20);
    expect(m.data[10*20+10]).toBe(1);
    expect(m.data[0]).toBe(0);
  });
});

describe('VIEW_BAKE_CONFIG', () => {
  it('crane uses full-height front mask (no ship anti-tower carve)', () => {
    expect(VIEW_BAKE_CONFIG['起重機']?.frontMaskMaxHeightFrac).toBe(1.0);
  });
  it('crane sets a density knob within budget', () => {
    expect(VIEW_BAKE_CONFIG['起重機']?.cellFrac).toBeGreaterThan(0);
  });
});
