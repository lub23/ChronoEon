import { invoke } from "@tauri-apps/api/core";
import type { AttachmentMetadata, Publication, RemoteFetch, SyncBackend, SyncStore } from "@chronoeon/storage";
import type { StorageUsage, SyncConfig } from "./types";

/** The native bridge transfers compressed immutable objects, not a database. */
export class NativeSyncBackend implements SyncBackend {
  readonly id: string;
  constructor(private readonly config: SyncConfig) {
    this.id = JSON.stringify([config.mode,(config.mode === "git" ? config.gitRemote : config.webdavUrl).trim().replace(/\/+$/, ""),config.mode === "webdav" ? config.webdavUsername : ""]);
  }
  fetch(known: Record<string, string>): Promise<RemoteFetch> {
    return invoke("sync_backend_fetch", { config: this.config, known });
  }
  publish(publication: Publication): Promise<{ conflict: boolean }> {
    return invoke("sync_backend_publish", { config: this.config, publication });
  }
}
/** Bytes the configured sync mirror, local photos and the database occupy on this device. */
export function fetchStorageUsage(config: SyncConfig): Promise<StorageUsage> {
  return invoke("sync_storage_usage", { config });
}
/** One-time import jobs preserve old local photos without ever sending their
 * raw bytes or original paths to a backend. Missing files remain marked missing. */
const preparations = new WeakMap<SyncStore, Promise<void>>();
export function prepareAttachmentImports(store: SyncStore): Promise<void> {
  let preparation = preparations.get(store);
  if (!preparation) {
    preparation = prepare(store).finally(() => preparations.delete(store));
    preparations.set(store, preparation);
  }
  return preparation;
}
async function prepare(store: SyncStore): Promise<void> {
  for (const item of await store.attachmentImports()) {
    try {
      const photo = await invoke<AttachmentMetadata>("compress_photo", { sourceLocalPath: item.source_path, fileNameHint: item.source_path });
      await store.completeAttachmentImport(item.attachment_id, photo);
    } catch {
      // The canonical attachment is already marked missing. Keep the durable
      // ingest job for a later retry rather than discarding the user's reference.
    }
  }
  const needed = await store.attachmentMetadataNeeded();
  if (needed.length) {
    const photos = await invoke<AttachmentMetadata[]>("inspect_attachments", { hashes: needed });
    await store.completeAttachmentMetadata(needed, photos);
  }
}
