export { cursorCone, type CursorConeOptions } from './cursorCone';
export { autoSweep, type AutoSweepOptions } from './autoSweep';
export { pulseRing, type PulseRingOptions } from './pulseRing';
export { coneRays } from './cone';

import { cursorCone } from './cursorCone';
import { autoSweep } from './autoSweep';
import { pulseRing } from './pulseRing';

export const emitters = { cursorCone, autoSweep, pulseRing };
