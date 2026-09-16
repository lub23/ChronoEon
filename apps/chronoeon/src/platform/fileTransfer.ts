import { isTauri } from "./desktop";

export interface TextDocument {
  name: string;
  content: string;
}

export interface TextFileFilter {
  name: string;
  extensions: string[];
}

const MAX_IMPORT_BYTES = 20_000_000;

function browserPickText(accept: string): Promise<TextDocument | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.hidden = true;
    let settled = false;
    let focusTimer: number | undefined;
    const cleanup = () => {
      if (focusTimer !== undefined) window.clearTimeout(focusTimer);
      window.removeEventListener("focus", handleWindowFocus);
      input.remove();
    };
    const finish = (document: TextDocument | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(document);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const handleWindowFocus = () => {
      // Safari/WebKit versions without the input `cancel` event still return
      // focus to the app when the picker closes.
      focusTimer = window.setTimeout(() => finish(null), 500);
    };
    input.addEventListener("cancel", () => finish(null), { once: true });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        finish(null);
        return;
      }
      if (file.size > MAX_IMPORT_BYTES) {
        fail(new Error("Selected file is larger than 20 MB"));
        return;
      }
      void file.text().then((content) => finish({ name: file.name, content }), fail);
    }, { once: true });
    document.body.appendChild(input);
    window.addEventListener("focus", handleWindowFocus);
    input.click();
  });
}

export async function pickTextDocument(filters: TextFileFilter[], browserAccept: string): Promise<TextDocument | null> {
  if (!isTauri()) return browserPickText(browserAccept);
  const [{ open }, { invoke }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/api/core"),
  ]);
  const selected = await open({ directory: false, multiple: false, filters });
  if (!selected || Array.isArray(selected)) return null;
  const revision = await invoke<{ content: string }>("read_text_file", { path: selected });
  if (new Blob([revision.content]).size > MAX_IMPORT_BYTES) throw new Error("Selected file is larger than 20 MB");
  const name = selected.replaceAll("\\", "/").split("/").pop() || selected;
  return { name, content: revision.content };
}

function browserDownload(content: string, suggestedName: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = suggestedName;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function saveTextDocument(
  content: string,
  suggestedName: string,
  filters: TextFileFilter[],
  mime = "text/plain;charset=utf-8",
): Promise<boolean> {
  if (!isTauri()) {
    browserDownload(content, suggestedName, mime);
    return true;
  }
  const [{ save }, { invoke }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/api/core"),
  ]);
  const selected = await save({ defaultPath: suggestedName, filters });
  if (!selected) return false;
  await invoke("write_text_atomic", { path: selected, content, options: {} });
  return true;
}
