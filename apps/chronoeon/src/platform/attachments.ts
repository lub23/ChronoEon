import type { AttachmentMetadata } from "@chronoeon/storage";
import { isMobilePlatform } from "../hooks/useTouchDevice";
import { isImageAttachment, type ChronoEonSettings } from "@chronoeon/domain";
import { isTauri } from "./desktop";

/**
 * Attachments live fully locally: on Tauri the picked photo goes through the
 * `compress_photo` Rust command into `<AppLocalDataDir>/attachments` and the
 * entry stores only a portable content-hash reference. The browser demo keeps in-memory blob URLs
 * for the session only. Nothing is ever written into a vault.
 */

export interface AttachmentPick {
  /** Content-addressed reference (Tauri) or a session-only `blob:`/`data:` URL (demo). */
  reference: string;
  displayUrl: string;
  name: string;
  persisted: boolean;
}

export type CompressedPhoto = AttachmentMetadata;

const sessionUrls = new Map<string, string>();

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

/** Sync-portable reference; only the file name resolves on each device. */
function attachmentReference(sha256: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("Invalid compressed photo hash");
  return `attachments/${sha256}.webp`;
}

function pickImageFiles(multiple: boolean, capture = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    // `capture` asks the mobile WebView for the camera instead of the gallery.
    if (capture) input.setAttribute("capture", "environment");
    input.multiple = multiple && !capture;
    input.hidden = true;
    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", onFocus);
      input.remove();
      resolve(files);
    };
    let focusTimer: number | undefined;
    const onFocus = () => {
      focusTimer = window.setTimeout(() => finish([]), 500);
    };
    input.addEventListener("cancel", () => finish([]), { once: true });
    input.addEventListener("change", () => {
      if (focusTimer !== undefined) window.clearTimeout(focusTimer);
      finish([...(input.files ?? [])]);
    }, { once: true });
    document.body.appendChild(input);
    window.addEventListener("focus", onFocus);
    input.click();
  });
}

/** One native dialog, honouring the caller's single/multi choice. */
async function pickPhotoPaths(multiple: boolean): Promise<string[]> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    multiple,
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "heic", "heif"] }],
  });
  if (!selected) return [];
  return Array.isArray(selected) ? selected : [selected];
}

async function compressPickedPhoto(sourcePath: string, fileName: string): Promise<CompressedPhoto> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<CompressedPhoto>("compress_photo", {
    sourceLocalPath: sourcePath,
    fileNameHint: fileName,
  });
}

async function compressPickedFile(file: File): Promise<CompressedPhoto> {
  const { invoke } = await import("@tauri-apps/api/core");
  if (file.size > 32 * 1024 * 1024) throw new Error("PHOTO_INPUT_TOO_LARGE");
  const dataBase64 = arrayBufferToBase64(await file.arrayBuffer());
  return invoke<CompressedPhoto>("compress_photo_data", {
    dataBase64,
    fileNameHint: file.name,
  });
}

async function compressDemoFile(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const variants = [[1600, 0.72], [1280, 0.66], [800, 0.56]] as const;
  let lastBlob: Blob | null = null;
  for (const [edge, quality] of variants) {
    const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas unavailable");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob) lastBlob = blob;
    if (blob && (blob.size <= 360 * 1024 || edge === 800)) {
      bitmap.close();
      return blob;
    }
  }
  bitmap.close();
  if (!lastBlob) throw new Error("Photo encoding failed");
  return lastBlob;
}

export interface AttachmentContext {
  settings: ChronoEonSettings;
  entryDate: string;
  /** Mobile only: open the camera rather than the photo picker. */
  capture?: boolean;
}

/**
 * Offer an image picker and return references suitable for `entry.images`.
 * Decode failures are skipped instead of failing the whole batch.
 */
export async function pickEntryAttachments(
  context: AttachmentContext,
  multiple = true,
): Promise<{ picked: AttachmentPick[]; skipped: string[] }> {
  const picked: AttachmentPick[] = [];
  const skipped: string[] = [];

  if (isTauri() && isMobilePlatform()) {
    // Mobile scoped storage is easiest to enter through the WebView picker;
    // the Rust pipeline still owns compression and local persistence.
    const files = await pickImageFiles(multiple, context.capture === true);
    for (const file of files) {
      try {
        const compressed = await compressPickedFile(file);
        const displayUrl = await resolveAttachmentUrl(attachmentReference(compressed.sha256)) ?? "";
        picked.push({ reference: attachmentReference(compressed.sha256), displayUrl, name: file.name, persisted: true });
      } catch (error) {
        console.warn("Could not store photo", error);
        skipped.push(file.name);
      }
    }
    return { picked, skipped };
  }

  if (isTauri()) {
    // Native path picker → Rust compress pipeline → local attachment path.
    const paths = await pickPhotoPaths(multiple);
    for (const path of paths) {
      const name = path.split(/[\\/]/).pop() ?? "photo";
      try {
        const compressed = await compressPickedPhoto(path, name);
        const displayUrl = await resolveAttachmentUrl(attachmentReference(compressed.sha256)) ?? "";
        picked.push({ reference: attachmentReference(compressed.sha256), displayUrl, name, persisted: true });
      } catch (error) {
        console.warn("Could not store photo", error);
        skipped.push(name);
      }
    }
    return { picked, skipped };
  }

  // Browser demo: session-only blobs.
  const files = await pickImageFiles(multiple, context.capture === true);
  for (const file of files) {
    try {
      const buffer = await compressDemoFile(file);
      const displayUrl = URL.createObjectURL(buffer);
      sessionUrls.set(displayUrl, displayUrl);
      picked.push({ reference: displayUrl, displayUrl, name: file.name, persisted: false });
    } catch (error) {
      console.warn("Could not compress photo", error);
      skipped.push(file.name);
    }
  }
  return { picked, skipped };
}

/**
 * Store one in-memory image — a pasted screenshot or a dropped file — through
 * the same compression and content-addressed storage as the picker.
 */
export async function storeAttachmentFile(file: File): Promise<AttachmentPick | null> {
  try {
    if (isTauri()) {
      const compressed = await compressPickedFile(file);
      const reference = attachmentReference(compressed.sha256);
      const displayUrl = await resolveAttachmentUrl(reference) ?? "";
      return { reference, displayUrl, name: file.name || "photo", persisted: true };
    }
    const buffer = await compressDemoFile(file);
    const displayUrl = URL.createObjectURL(buffer);
    sessionUrls.set(displayUrl, displayUrl);
    return { reference: displayUrl, displayUrl, name: file.name || "photo", persisted: false };
  } catch (error) {
    console.warn("Could not store the pasted photo", error);
    return null;
  }
}

/**
 * Resolve a stored reference to something an `<img>` can display. Session-only
 * blob URLs pass straight through; local attachment paths are read through the
 * validated native command.
 */
export async function resolveAttachmentUrl(reference: string): Promise<string | null> {
  if (!reference) return null;
  if (reference.startsWith("blob:") || reference.startsWith("data:")) return reference;
  const cached = sessionUrls.get(reference);
  if (cached) return cached;
  if (!isTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const sha256 = /^attachments\/([0-9a-f]{64})\.webp$/.exec(reference)?.[1];
    if (!sha256) return null;
    const dataUrl = await invoke<string>("read_attachment_local", { sha256 });
    sessionUrls.set(reference, dataUrl);
    return dataUrl;
  } catch (error) {
    console.warn("Could not read attachment", reference, error);
    return null;
  }
}

/**
 * Forget an attachment reference. Local files are intentionally kept on disk:
 * removing a reference from an entry must never delete user data.
 */
export function releaseAttachment(reference: string): void {
  const url = sessionUrls.get(reference);
  if (url && url.startsWith("blob:") && url === reference) URL.revokeObjectURL(url);
  sessionUrls.delete(reference);
}

/**
 * Inline data URL for a picked photo, for providers that accept images in the
 * request body. Local files go through the same validated native read as
 * display; the browser demo converts its session blob in memory.
 */
export async function attachmentDataUrl(reference: string): Promise<string | null> {
  const url = await resolveAttachmentUrl(reference);
  if (!url) return null;
  if (url.startsWith("data:")) return url;
  if (!url.startsWith("blob:")) return null;
  try {
    const blob = await (await fetch(url)).blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.warn("Could not read attachment data", error);
    return null;
  }
}

/** Long edge of the copy that is sent to a model; enough to read a receipt. */
const MODEL_IMAGE_MAX_EDGE = 1280;
const MODEL_IMAGE_QUALITY = 0.78;

/**
 * Downscaled copy of a stored photo for the model payload. The stored original
 * is never modified, so the entry keeps its full-quality photo.
 */
export async function attachmentModelImage(reference: string): Promise<string | null> {
  const raw = await attachmentDataUrl(reference);
  if (!raw) return null;
  try {
    const bitmap = await createImageBitmap(await (await fetch(raw)).blob());
    const scale = Math.min(1, MODEL_IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return raw;
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL("image/jpeg", MODEL_IMAGE_QUALITY);
  } catch (error) {
    // Older WebViews can fail to decode; sending the stored copy is still valid.
    console.warn("Could not downscale the photo for the model", error);
    return raw;
  }
}

export function isDisplayableAttachment(reference: string): boolean {
  if (reference.startsWith("blob:") || reference.startsWith("data:")) return true;
  return isImageAttachment(reference);
}
