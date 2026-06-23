/**
 * Milliseconds to advance the timeline scrubber per animation frame.
 *
 * Today's fixed sweep advanced `(max-min)/600` per frame; that is defined as
 * step 8 (80%). The stepper exposes 1–10 (10%–100%), so speed scales as
 * `step/8` relative to today: step 10 → 1.25x, step 1 → 0.125x.
 *
 * @param rangeMs full timeline span (maxMs - minMs)
 * @param step    stepper value, integer 1–10
 */
export function advancePerFrame(rangeMs: number, step: number): number {
  return (rangeMs * step) / 4800;
}
