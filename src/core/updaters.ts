export type UpdateFn = (dt: number, time: number) => void;

/** Invoke each registered updater in order with the frame delta and absolute time. */
export function runUpdaters(updaters: readonly UpdateFn[], dt: number, time: number): void {
  for (const u of updaters) u(dt, time);
}
