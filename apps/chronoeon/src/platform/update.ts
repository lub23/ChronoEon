import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./desktop";

export interface AppUpdate {
  version: string;
  /** Empty when this platform has no installable asset in the release. */
  url: string;
  size: number;
  name: string;
  pageUrl: string;
}

/** Release lookup, download and installer hand-off all live in Rust. */
export async function checkForAppUpdate(current: string): Promise<AppUpdate | null> {
  if (!isTauri()) return null;
  return await invoke<AppUpdate | null>("app_update_check", { current });
}

export async function downloadAppUpdate(update: AppUpdate): Promise<string> {
  return await invoke<string>("app_update_download", { url: update.url, name: update.name });
}

export async function installAppUpdate(path: string): Promise<void> {
  await invoke("app_update_install", { path });
}

export async function openUpdatePage(url: string): Promise<void> {
  await invoke("app_update_open_page", { url });
}
