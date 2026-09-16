import type { EngineResult, SyncEngine, SyncStore, SyncRunOptions } from "@chronoeon/storage";

/** Git/WebDAV have no client push channel; online peers discover a peer's
 * publication by checking the remote index on the same one-minute cadence. */
export const REMOTE_POLL_MS = 60_000;

/** SQLite owns durability; timers are only wake-up hints. Debounce and retries
 * are independent so continuous typing cannot cancel an older failed upload. */
export class SyncScheduler {
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private remoteTimer: ReturnType<typeof setInterval> | undefined;
  private snapshotTimer: ReturnType<typeof setTimeout> | undefined;
  private rebuildRequested = false;
  private rebuilding = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private unsubscribe: (() => void) | undefined;
  private disposed = false;
  private running: Promise<void> | null = null;
  private lastEdit = Date.now();
  constructor(private readonly engine: Pick<SyncEngine, "run">, private readonly store: Pick<SyncStore, "subscribe" | "status" | "flush">,
    private readonly report: (result: EngineResult | Error | null, busy: boolean) => void,
    private readonly online: () => boolean = () => navigator.onLine !== false) {}
  start(): void {
    if (this.disposed || this.unsubscribe) return;
    this.unsubscribe = this.store.subscribe(() => { this.lastEdit = Date.now(); this.debounce(); });
    this.remoteTimer = setInterval(() => { void this.poll(); }, REMOTE_POLL_MS);
    void this.store.status().then((status) => {
      if (status.failures && status.nextAttempt > Date.now()) this.retry(status.nextAttempt);
      else return this.trigger();
    }).catch((error) => this.recover(error));
  }
  private debounce(): void {
    clearTimeout(this.debounceTimer);
    if (!this.disposed) this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined; void this.trigger();
    }, Math.max(0, this.lastEdit + 60_000 - Date.now()));
  }
  private retry(timestamp: number): void {
    clearTimeout(this.retryTimer);
    if (!this.disposed) this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined; void this.trigger();
    }, Math.max(1000, Math.min(15 * 60_000, timestamp - Date.now())));
  }

  private async poll(): Promise<void> {
    if (this.disposed || !this.online()) return;
    // A pending local debounce already owns the next run; don't shorten its
    // quiet period or clear it. Its eventual trigger also fetches the remote.
    if (this.debounceTimer) return;
    try {
      const status = await this.store.status();
      // Durable backoff remains authoritative after network failures; a poll
      // must not bypass it. The retry timer resumes peer discovery.
      if (!status.failures || status.nextAttempt <= Date.now()) await this.trigger();
    } catch (error) {
      this.recover(error);
    }
  }

  private recover(error: unknown): void {
    if (this.disposed) return;
    this.report(error instanceof Error ? error : new Error(String(error)), false);
    this.retry(Date.now() + 60_000);
  }
  trigger(options: SyncRunOptions = {}): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (options.rebuildSnapshot && !this.rebuilding) this.rebuildRequested = true;
    if (this.running) return this.running;
    clearTimeout(this.snapshotTimer); this.snapshotTimer = undefined;
    clearTimeout(this.retryTimer); this.retryTimer = undefined;
    clearTimeout(this.debounceTimer); this.debounceTimer = undefined;
    this.running = (async () => {
      do {
        this.rebuilding = this.rebuildRequested;
        this.rebuildRequested = false;
        await this.run(this.rebuilding);
      } while (this.rebuildRequested && !this.disposed);
    })().catch((error) => this.recover(error)).finally(() => { this.running = null; this.rebuilding = false; this.rebuildRequested = false; });
    return this.running;
  }
  private async run(rebuildSnapshot: boolean): Promise<void> {
    await this.store.flush();
    if (this.disposed) return;
    if (!this.online()) { this.report(new Error("SYNC_OFFLINE"), false); return; }
    this.report(null, true);
    try {
      const result = await this.engine.run({ rebuildSnapshot });
      if (!this.disposed) this.report(result, false);
    } catch (error) {
      if (!this.disposed) this.report(error instanceof Error ? error : new Error(String(error)), false);
    }
    if (this.disposed) return;
    const status = await this.store.status();
    if (status.failures) this.retry(status.nextAttempt);
    else {
      if (status.pending && !this.debounceTimer) this.debounce();
      if (status.nextSnapshotAt) {
        clearTimeout(this.snapshotTimer);
        this.snapshotTimer = setTimeout(() => { this.snapshotTimer = undefined; void this.trigger(); }, Math.max(1000, Date.parse(status.nextSnapshotAt) - Date.now()));
      }
    }
  }
  dispose(): void {
    this.disposed = true; this.unsubscribe?.(); clearTimeout(this.debounceTimer); clearInterval(this.remoteTimer);
    clearTimeout(this.retryTimer); clearTimeout(this.snapshotTimer);
  }
}
