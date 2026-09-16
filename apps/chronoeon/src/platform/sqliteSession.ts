import { prepareAttachmentImports } from "../sync/client";
import { appLocalDataDir, join } from "@tauri-apps/api/path";
import type { Locale } from "@chronoeon/domain";
import {
  AiConversationStore,
  RUNTIME_PRAGMAS,
  SqliteEntryStore,
  TauriSqliteBackend,
  TimerStore,
  SyncStore,
  type PersistencePort,
  type StorageErrorCode,
} from "@chronoeon/storage";
import { t } from "../i18n";
import { isTauri } from "./desktop";

export interface SqliteStoreSession {
  store: SqliteEntryStore;
  timers: TimerStore;
  conversations: AiConversationStore;
  sync: SyncStore;
  dispose(): Promise<void>;
}

export interface SqliteStoreSessionOptions {
  /** Inject a backend for tests; production uses the Tauri plugin. */
  backend?: PersistencePort;
}

// StrictMode mounts App twice before either async boot resolves. Two sessions
// targeting the same Tauri SQL database would let the first cleanup close the
// pool under the second, so the production session is one app-lifetime boot.
let sharedSession: Promise<SqliteStoreSession> | null = null;

/**
 * Boot the SQLite store (migrate + integrity check). Unconditional on Tauri —
 * SQLite is the only data path; the browser demo has no store and returns
 * null. First-run seeding happens through the vault import dialog, not here.
 */
export async function createSqliteStoreSession(options: SqliteStoreSessionOptions = {}): Promise<SqliteStoreSession | null> {
  if (options.backend) {
    return createSession(options.backend);
  }
  if (!isTauri()) return null; // browser demo path
  sharedSession ??= (async () => {
    const dataDir = await appLocalDataDir();
    const dbPath = await join(dataDir, "chronoeon.db");
    const backend = await TauriSqliteBackend.open(dbPath, RUNTIME_PRAGMAS);
    return createSession(backend);
  })();
  return sharedSession;
}

/**
 * Close the app-lifetime SQLite session for shutdown/tests. Synchronization
 * never calls this: remote changes are applied through the live transaction queue.
 */
export async function disposeSqliteStoreSession(): Promise<void> {
  const previous = sharedSession;
  // Null first so a concurrent `createSqliteStoreSession` boots a fresh shared
  // session instead of resolving to the pool being torn down.
  sharedSession = null;
  if (previous) {
    try {
      await (await previous).dispose();
    } catch {
      // The pool may already be gone; a fresh boot is authoritative.
    }
  }
}

async function createSession(backend: PersistencePort): Promise<SqliteStoreSession> {
  const store = await SqliteEntryStore.create(backend);
  const sync = new SyncStore(backend);
  // Conversion is durable background work; a large old photo library must not
  // hold the usable local database or UI hostage during the first boot.
  if (isTauri()) void prepareAttachmentImports(sync).then(() => store.notifyRebuilt()).catch(() => store.notifyRebuilt());
  return {
    store,
    timers: new TimerStore(backend),
    conversations: new AiConversationStore(backend),
    sync,
    dispose: () => backend.close(),
  };
}

/** Map a boot-blocking storage error onto the bilingual dialog strings in i18n.ts. */
export function storageBootErrorMessage(code: StorageErrorCode, language: Locale): string | null {
  switch (code) {
    case "SchemaVersionUnsupported":
      return `${t("storageSchemaNewerTitle", language)} — ${t("storageSchemaNewerDetail", language)}`;
    case "CorruptionDetected":
      return `${t("storageCorruptionTitle", language)} — ${t("storageCorruptionDetail", language)}`;
    case "ImportSourceMismatch":
      return `${t("storageImportMismatchTitle", language)} — ${t("storageImportMismatchDetail", language)}`;
    default:
      return null;
  }
}
