import { describe, it, expect } from 'vitest';
import { emitters, ramps, scannables } from '../src/index';

describe('public API', () => {
  it('exposes the three emitter factories', () => {
    expect(typeof emitters.cursorCone).toBe('function');
    expect(typeof emitters.autoSweep).toBe('function');
    expect(typeof emitters.pulseRing).toBe('function');
  });

  it('exposes the three ramp textures', () => {
    expect(ramps.rainbowDepth).toBeDefined();
    expect(ramps.thermal).toBeDefined();
    expect(ramps.monoNeon).toBeDefined();
  });

  it('builds a procedural scannable with objects', () => {
    const s = scannables.proceduralCave();
    expect(s.objects.length).toBeGreaterThan(0);
  });

  it('exposes PointCloud, buildCategoryLUT and buildRampTextureFromFn', async () => {
    const api = await import('../src/index');
    expect(typeof (api as any).PointCloud).toBe('function');
    expect(typeof (api as any).buildCategoryLUT).toBe('function');
    expect(typeof (api as any).buildRampTextureFromFn).toBe('function');
  });
});
