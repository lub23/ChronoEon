// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AI_PROVIDER_PREFERENCES } from "../ai/provider";
import { AISettingsPanel } from "./AISettingsPanel";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

function render(local: boolean) {
  act(() => {
    root.render(
      <AISettingsPanel
        locale="zh"
        preferences={{ ...DEFAULT_AI_PROVIDER_PREFERENCES, enabled: true, backend: local ? "local" : "remote" }}
        localKeyStored={false}
        onChange={() => undefined}
        onSaveKey={vi.fn(async () => undefined)}
        onClearKey={vi.fn(async () => undefined)}
        onTest={vi.fn(async () => undefined)}
      />,
    );
  });
}

describe("AI provider credentials", () => {
  it("shows the local key input only for the local provider", async () => {
    render(false);
    expect(host.querySelector("input[type='password']")).toBeNull();

    render(true);
    const key = host.querySelector<HTMLInputElement>("input[type='password']")!;
    expect(key).not.toBeNull();
    expect(host.textContent).toContain("本地 API 密钥");
    expect(host.textContent).toContain("浏览器预览只在当前标签页内存中暂存本地密钥");
  });

  it("saves a drafted local key and clears the draft", async () => {
    const onSaveKey = vi.fn(async () => undefined);
    act(() => {
      root.render(
        <AISettingsPanel
          locale="zh"
          preferences={{ ...DEFAULT_AI_PROVIDER_PREFERENCES, enabled: true, backend: "local" }}
          localKeyStored={false}
          onChange={() => undefined}
          onSaveKey={onSaveKey}
          onClearKey={vi.fn(async () => undefined)}
          onTest={vi.fn(async () => undefined)}
        />,
      );
    });
    const key = host.querySelector<HTMLInputElement>("input[type='password']")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => { setValue.call(key, "local-secret"); key.dispatchEvent(new Event("input", { bubbles: true })); });
    const save = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("保存密钥"))!;
    await act(async () => { save.click(); });
    expect(onSaveKey).toHaveBeenCalledWith("local-secret");
    expect(host.querySelector<HTMLInputElement>("input[type='password']")?.value).toBe("");
  });
});
