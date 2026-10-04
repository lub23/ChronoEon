/** Remote snapshot cadence; independent of local recovery retention. */
export const SNAPSHOT_INTERVAL_MS = 7 * 24 * 60 * 60_000;
export function nextSnapshotAt(createdAt: string | null): string | null {
  return createdAt === null ? null : new Date(Date.parse(createdAt) + SNAPSHOT_INTERVAL_MS).toISOString();
}
