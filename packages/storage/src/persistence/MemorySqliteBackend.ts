import type { PersistencePort, SqlParam, SqlValue } from "./PersistencePort";

type WaSqliteModule = {
  ready?: Promise<unknown>;
};
type WaSqliteApi = {
  open_v2(name: string, flags?: number, vfs?: string): Promise<number>;
  close(db: number): Promise<unknown>;
  prepare_v2(db: number, sqlPointer: number): Promise<{ stmt: number; sql: number } | null>;
  bind_parameter_count(stmt: number): Promise<number>;
  bind(stmt: number, index: number, value: SqlParam): Promise<unknown>;
  step(stmt: number): Promise<number>;
  column_names(stmt: number): Promise<string[]>;
  column(stmt: number, index: number): Promise<SqlValue>;
  finalize(stmt: number): Promise<unknown>;
  str_new(db: number, sql?: string): number;
  str_value(str: number): number;
  str_finish(str: number): void;
  vfs_register(vfs: unknown, makeDefault: boolean): unknown;
};

const SQLITE_ROW = 100;

/**
 * In-memory SQLite backend for tests (wa-sqlite MemoryVFS, dev-dependency
 * only). Real SQLite semantics — including CHECK constraints, foreign keys
 * and the trigger triple — so the store under test behaves like production.
 *
 * Two wa-sqlite gotchas are handled here explicitly:
 * 1. The shared connection is serialized through an internal promise queue
 *    (React StrictMode boots run two `list()` calls in parallel; the async
 *    API is not re-entrant across concurrent statement walks).
 * 2. `execWithParams`/`run` are NOT used: their statement generator calls
 *    `finalize` without awaiting it, so the async build can reuse a
 *    statement pointer before it is released (SQLITE_MISUSE). This backend
 *    prepares/binds/steps/finalizes with proper awaits instead.
 */
export class MemorySqliteBackend implements PersistencePort {
  private transactionDepth = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private inChain = false;

  private constructor(private readonly db: number, private readonly sqlite3: WaSqliteApi) {}

  static async open(pragmas: string[]): Promise<MemorySqliteBackend> {
    // All three imports are dev-only paths; production bundles never touch them.
    // The SYNC wasm build is used deliberately: its API calls complete
    // synchronously (no Asyncify suspension points), so concurrent JS callers
    // can never interleave inside a C statement — the async build's statement
    // generators are not safe for that (SQLITE_MISUSE under React StrictMode).
    const factory = (await import("wa-sqlite/dist/wa-sqlite.mjs")).default as
      (config?: { wasmBinary?: Uint8Array }) => Promise<WaSqliteModule>;
    const SQLite = await import("wa-sqlite");
    const { MemoryVFS } = await import("wa-sqlite/src/examples/MemoryVFS.js");
    // Node (vitest) has no fetch for file:// wasm URLs — hand the factory the
    // wasm bytes directly instead of letting it locate them over the network.
    const { createRequire } = await import("node:module");
    const { readFileSync } = await import("node:fs");
    const require = createRequire(import.meta.url);
    const wasmBinary = readFileSync(require.resolve("wa-sqlite/dist/wa-sqlite.wasm"));
    const module = await factory({ wasmBinary });
    const sqlite3 = SQLite.Factory(module) as unknown as WaSqliteApi;
    await sqlite3.vfs_register(new MemoryVFS(), false);
    const db = await sqlite3.open_v2("chronoeon", SQLite.SQLITE_OPEN_CREATE | SQLite.SQLITE_OPEN_READWRITE, "memory");
    const backend = new MemorySqliteBackend(db, sqlite3);
    for (const pragma of pragmas) {
      await backend.execute(pragma);
    }
    return backend;
  }

  /** Serialize work on the shared connection; re-entrant inside the chain. */
  private run<T>(work: () => Promise<T>): Promise<T> {
    if (this.inChain) return work();
    const next = this.chain.then(async () => {
      this.inChain = true;
      try {
        return await work();
      } finally {
        this.inChain = false;
      }
    });
    this.chain = next.then(() => undefined, () => undefined);
    return next;
  }

  async execute(sql: string, params: SqlParam[] = []): Promise<void> {
    await this.run(() => this.executeBody(sql, params));
  }

  private async executeBody(sql: string, params: SqlParam[]): Promise<void> {
    const str = this.sqlite3.str_new(this.db, sql);
    try {
      let tail = this.sqlite3.str_value(str);
      while (true) {
        const prepared = await this.sqlite3.prepare_v2(this.db, tail);
        if (!prepared) break;
        try {
          if (params.length) {
            const count = await this.sqlite3.bind_parameter_count(prepared.stmt);
            for (let index = 1; index <= count; index += 1) {
              await this.sqlite3.bind(prepared.stmt, index, params[index - 1] ?? null);
            }
          }
          while (await this.sqlite3.step(prepared.stmt) === SQLITE_ROW) { /* drain */ }
        } finally {
          await this.sqlite3.finalize(prepared.stmt);
        }
        tail = prepared.sql;
      }
    } finally {
      this.sqlite3.str_finish(str);
    }
  }

  async select<T = Record<string, SqlValue>>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    return this.run(() => this.selectBody(sql, params));
  }

  private async selectBody<T>(sql: string, params: SqlParam[]): Promise<T[]> {
    const str = this.sqlite3.str_new(this.db, sql);
    try {
      const prepared = await this.sqlite3.prepare_v2(this.db, this.sqlite3.str_value(str));
      if (!prepared) return [];
      try {
        if (params.length) {
          const count = await this.sqlite3.bind_parameter_count(prepared.stmt);
          for (let index = 1; index <= count; index += 1) {
            await this.sqlite3.bind(prepared.stmt, index, params[index - 1] ?? null);
          }
        }
        const columns = await this.sqlite3.column_names(prepared.stmt);
        const rows: Record<string, SqlValue>[] = [];
        while (await this.sqlite3.step(prepared.stmt) === SQLITE_ROW) {
          const row: Record<string, SqlValue> = {};
          for (let index = 0; index < columns.length; index += 1) {
            row[columns[index]] = await this.sqlite3.column(prepared.stmt, index);
          }
          rows.push(row);
        }
        return rows as T[];
      } finally {
        await this.sqlite3.finalize(prepared.stmt);
      }
    } finally {
      this.sqlite3.str_finish(str);
    }
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    return this.run(async () => {
      if (this.transactionDepth === 0) {
        await this.rawExecute("BEGIN IMMEDIATE");
      }
      this.transactionDepth += 1;
      try {
        const result = await work();
        this.transactionDepth -= 1;
        if (this.transactionDepth === 0) await this.rawExecute("COMMIT");
        return result;
      } catch (error) {
        this.transactionDepth = 0;
        try { await this.rawExecute("ROLLBACK"); } catch { /* connection may be gone */ }
        throw error;
      }
    });
  }

  async close(): Promise<void> {
    await this.run(() => this.sqlite3.close(this.db));
  }

  /** Bypass the queue for transaction bookkeeping (we are already in the chain). */
  private async rawExecute(sql: string): Promise<void> {
    const str = this.sqlite3.str_new(this.db, sql);
    try {
      let tail = this.sqlite3.str_value(str);
      while (true) {
        const prepared = await this.sqlite3.prepare_v2(this.db, tail);
        if (!prepared) break;
        try {
          while (await this.sqlite3.step(prepared.stmt) === SQLITE_ROW) { /* drain */ }
        } finally {
          await this.sqlite3.finalize(prepared.stmt);
        }
        tail = prepared.sql;
      }
    } finally {
      this.sqlite3.str_finish(str);
    }
  }
}
