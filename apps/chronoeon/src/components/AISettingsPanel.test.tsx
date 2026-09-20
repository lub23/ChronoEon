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
        remoteKeyStored={false}
        onChange={() => undefined}
        onSaveLocalKey={vi.fn(async () => undefined)}
        onClearLocalKey={vi.fn(async () => undefined)}
        onSaveRemoteKey={vi.fn(async () => undefined)}
        onClearRemoteKey={vi.fn(async () => undefined)}
        onTest={vi.fn(async () => undefined)}
      />,
    );
  });
}

describe("AI provider credentials", () => {
  it("shows the provider-specific key input", async () => {
    render(false);
    expect(host.querySelector<HTMLInputElement>("input[type='password']")?.placeholder).toBe("X-Api-Key");
    expect(host.textContent).toContain("远程 API 密钥");

    render(true);
    const key = host.querySelector<HTMLInputElement>("input[type='password']")!;
    expect(key).not.toBeNull();
    expect(host.textContent).toContain("本地 API 密钥");
    expect(host.textContent).toContain("浏览器预览只在当前标签页内存中暂存本地密钥");
  });

  it("saves a drafted local key and clears the draft", async () => {
    const onSaveLocalKey = vi.fn(async () => undefined);
    act(() => {
      root.render(
        <AISettingsPanel
          locale="zh"
          preferences={{ ...DEFAULT_AI_PROVIDER_PREFERENCES, enabled: true, backend: "local" }}
          localKeyStored={false}
          remoteKeyStored={false}
          onChange={() => undefined}
          onSaveLocalKey={onSaveLocalKey}
          onClearLocalKey={vi.fn(async () => undefined)}
          onSaveRemoteKey={vi.fn(async () => undefined)}
          onClearRemoteKey={vi.fn(async () => undefined)}
          onTest={vi.fn(async () => undefined)}
        />,
      );
    });
    const key = host.querySelector<HTMLInputElement>("input[type='password']")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => { setValue.call(key, "local-secret"); key.dispatchEvent(new Event("input", { bubbles: true })); });
    const save = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("保存密钥"))!;
    await act(async () => { save.click(); });
    expect(onSaveLocalKey).toHaveBeenCalledWith("local-secret");
    expect(host.querySelector<HTMLInputElement>("input[type='password']")?.value).toBe("");
  });
});
