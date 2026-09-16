
/**
 * Attachment paths are always stored **relative to the connected vault root**
 * so a vault stays portable across machines, operating systems and sync tools.
 * Everything in this module is deliberately platform-neutral string work: the
 * host adapter is responsible for turning a safe relative path into real IO.
 */

export const ATTACHMENT_FOLDER = "ChronoEon/attachments";

/** Image extensions ChronoEon is willing to render inline. */
export const SUPPORTED_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg"];

const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export interface AttachmentPathIssue {
  path: string;
  reason: "absolute" | "escapes-vault" | "empty" | "unsupported" | "invalid";
}

/**
 * Reject anything that could escape the vault: absolute paths, Windows drive
 * letters, UNC shares, `..` segments, `file:`/`http:` URLs and control
 * characters. Returns the normalized relative path, or an issue describing why
 * it was refused.
 */
export function normalizeAttachmentPath(value: string): { path: string } | { issue: AttachmentPathIssue } {
  const raw = (value ?? "").trim();
  if (!raw) return { issue: { path: raw, reason: "empty" } };
  if (CONTROL_CHARACTERS.test(raw)) return { issue: { path: raw, reason: "invalid" } };
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return { issue: { path: raw, reason: "absolute" } };
  if (raw.startsWith("/") || raw.startsWith("\\") || WINDOWS_DRIVE.test(raw)) {
    return { issue: { path: raw, reason: "absolute" } };
  }

  const segments = raw.replace(/\\/g, "/").split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.some((segment) => segment === "..")) return { issue: { path: raw, reason: "escapes-vault" } };
  if (segments.length === 0) return { issue: { path: raw, reason: "empty" } };

  return { path: segments.join("/") };
}

export function isSafeAttachmentPath(value: string): boolean {
  return "path" in normalizeAttachmentPath(value);
}

export function attachmentExtension(path: string): string {
  const name = path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLocaleLowerCase() : "";
}

export function isImageAttachment(path: string): boolean {
  return SUPPORTED_IMAGE_EXTENSIONS.includes(attachmentExtension(path));
}

/** Join a vault root with a validated relative path, refusing unsafe input. */
export function resolveAttachmentPath(vaultRoot: string, relativePath: string): string | null {
  const normalized = normalizeAttachmentPath(relativePath);
  if (!("path" in normalized)) return null;
  const root = vaultRoot.replace(/[\\/]+$/, "");
  return root ? `${root}/${normalized.path}` : normalized.path;
}

/**
 * Keep only attachment references that are safe to store. Unsafe values are
 * reported instead of silently dropped so the UI can explain the refusal.
 */
export function partitionAttachments(paths: string[]): { safe: string[]; rejected: AttachmentPathIssue[] } {
  const safe: string[] = [];
  const rejected: AttachmentPathIssue[] = [];
  for (const value of paths) {
    const normalized = normalizeAttachmentPath(value);
    if ("path" in normalized) {
      if (!safe.includes(normalized.path)) safe.push(normalized.path);
    } else {
      rejected.push(normalized.issue);
    }
  }
  return { safe, rejected };
}

/** Short label for an attachment chip: the file name without its folders. */
export function attachmentLabel(path: string): string {
  return path.split("/").pop() || path;
}
