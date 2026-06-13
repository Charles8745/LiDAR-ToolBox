import { buildRampTexture } from './lut';
import { rainbowDepthStops, thermalStops, monoNeonStops } from './presets';

export const ramps = {
  rainbowDepth: buildRampTexture(rainbowDepthStops),
  thermal: buildRampTexture(thermalStops),
  monoNeon: buildRampTexture(monoNeonStops),
};

export { sampleGradient } from './gradient';
export type { ColorStop } from './gradient';
export { buildRampTexture, buildRampTextureFromFn } from './lut';
