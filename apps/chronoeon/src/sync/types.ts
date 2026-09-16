import type { EngineResult } from "@chronoeon/storage";
export type SyncMode = "git" | "webdav";
/** Connection settings are device-local; never part of a synchronized entity. */
export interface SyncConfig {
  mode: SyncMode;
  gitRemote: string;
  gitToken: string;
  webdavUrl: string;
  webdavUsername: string;
  webdavPassword: string;
}
export const DEFAULT_SYNC_CONFIG: SyncConfig = { mode: "git", gitRemote: "", gitToken: "", webdavUrl: "", webdavUsername: "", webdavPassword: "" };
export function syncConfigured(config: SyncConfig): boolean { return Boolean((config.mode === "git" ? config.gitRemote : config.webdavUrl).trim()); }
export type SyncResult = EngineResult | { ok: false; code: string; message: string };
