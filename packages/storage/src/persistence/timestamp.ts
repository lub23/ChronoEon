/** A business revision must change even within the same millisecond or after
 * a wall-clock correction; cross-device causality still uses the sync clock. */
export function nextTimestamp(previous?: string | null, now = Date.now()): string {
  const before = previous ? Date.parse(previous) : NaN;
  return new Date(Math.max(now, Number.isFinite(before) ? before + 1 : now)).toISOString();
}
