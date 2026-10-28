import type { EngineResult } from "@chronoeon/storage";
/** Connection settings are device-local; never part of a synchronized entity. */
export interface SyncConfig {
  webdavUrl: string;
  webdavUsername: string;
  webdavPassword: string;
}
export const DEFAULT_SYNC_CONFIG: SyncConfig = { webdavUrl: "", webdavUsername: "", webdavPassword: "" };
export function syncConfigured(config: SyncConfig): boolean { return Boolean(config.webdavUrl.trim()); }
export type SyncResult = EngineResult | { ok: false; code: string; message: string };
export interface StorageUsage { syncDatabaseBytes: number | null; databaseBytes: number }
/** Human sizes for the storage panel: bytes are never shown raw. */
export function formatBytes(bytes: number, locale: "en" | "zh"): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = Math.max(0, bytes); let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  const digits = unit === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 })} ${units[unit]}`;
}
