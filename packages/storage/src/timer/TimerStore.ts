import { runDatabaseOperation } from "../persistence/coordinator";
import type { TimerSession } from "@chronoeon/domain";
import type { PersistencePort } from "../persistence/PersistencePort";

const TIMER_SESSION_ID = "active";

/**
 * SQLite persistence for the live stopwatch. The domain `TimerSession` is
 * stored as one row (JSON payload); the app-layer recovery logic
 * (`recoverTimerSession`) is unchanged and runs against the payload after
 * load. A single source of truth — no localStorage or vault mirror.
 */
export class TimerStore {
  constructor(private readonly backend: PersistencePort) {}

  load(): Promise<TimerSession | null> { return runDatabaseOperation(this.backend, () => this.loadDirect()); }

  private async loadDirect(): Promise<TimerSession | null> {
    const rows = await this.backend.select<{ payload_json: string }>(
      "SELECT payload_json FROM timer_session WHERE id = ?", [TIMER_SESSION_ID],
    );
    if (!rows[0]) return null;
    try {
      const parsed = JSON.parse(rows[0].payload_json) as TimerSession;
      return parsed && Array.isArray(parsed.segments) ? parsed : null;
    } catch {
      return null;
    }
  }

  save(session: TimerSession | null): Promise<void> { return runDatabaseOperation(this.backend, () => this.saveDirect(session)); }

  private async saveDirect(session: TimerSession | null): Promise<void> {
    if (!session) {
      await this.backend.execute("DELETE FROM timer_session WHERE id = ?", [TIMER_SESSION_ID]);
      return;
    }
    await this.backend.execute(
      "INSERT INTO timer_session (id, payload_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at",
      [TIMER_SESSION_ID, JSON.stringify(session), new Date().toISOString()],
    );
  }

  updatedAt(): Promise<string | null> { return runDatabaseOperation(this.backend, () => this.updatedAtDirect()); }

  private async updatedAtDirect(): Promise<string | null> {
    const rows = await this.backend.select<{ updated_at: string }>(
      "SELECT updated_at FROM timer_session WHERE id = ?", [TIMER_SESSION_ID],
    );
    return rows[0]?.updated_at ?? null;
  }
}
