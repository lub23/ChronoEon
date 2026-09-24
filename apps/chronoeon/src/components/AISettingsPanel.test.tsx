// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AI_PROVIDER_PREFERENCES, type AIProviderPreferences } from "../ai/provider";
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

function render(override: Partial<AIProviderPreferences> = {}) {
  const onSaveLocalHeaders = vi.fn(async (headers: Array<{ name: string; value: string }>) => headers);
  act(() => {
    root.render(
      <AISettingsPanel
        locale="zh"
        preferences={{
          ...DEFAULT_AI_PROVIDER_PREFERENCES,
          enabled: true,
          ...override,
        }}
        localKeyStored={false}
        remoteKeyStored={false}
        localHeaders={[]}
        onChange={() => undefined}
        onSaveLocalKey={vi.fn(async () => undefined)}
        onClearLocalKey={vi.fn(async () => undefined)}
        onSaveRemoteKey={vi.fn(async () => undefined)}
        onClearRemoteKey={vi.fn(async () => undefined)}
        onSaveLocalHeaders={onSaveLocalHeaders}
        onTest={vi.fn(async () => undefined)}
      />,
    );
  });
}

describe("AI provider credentials", () => {
  it("shows the remote key input", async () => {
    render();
    expect(host.querySelector<HTMLInputElement>("input[type='password']")?.placeholder).toBe("sk-...");
    expect(host.textContent).toContain("远程 API 密钥");
  });

  it("shows local auth and custom headers only for 随心问's local backend", async () => {
    const onSaveLocalKey = vi.fn(async () => undefined);
    const onSaveLocalHeaders = vi.fn(async (headers: Array<{ name: string; value: string }>) => headers);
    act(() => {
      root.render(
        <AISettingsPanel
          locale="zh"
          preferences={{ ...DEFAULT_AI_PROVIDER_PREFERENCES, enabled: true, ask: { ...DEFAULT_AI_PROVIDER_PREFERENCES.ask, backend: "local" } }}
          localKeyStored={false}
          remoteKeyStored={false}
          localHeaders={[]}
          onChange={() => undefined}
          onSaveLocalKey={onSaveLocalKey}
          onClearLocalKey={vi.fn(async () => undefined)}
          onSaveRemoteKey={vi.fn(async () => undefined)}
          onClearRemoteKey={vi.fn(async () => undefined)}
          onSaveLocalHeaders={onSaveLocalHeaders}
          onTest={vi.fn(async () => undefined)}
        />,
      );
    });

    expect(host.textContent).toContain("本地 API 密钥");
    expect(host.textContent).toContain("本地自定义请求头");
    const add = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("添加请求头"))!;
    await act(async () => { add.click(); });
    const inputs = [...host.querySelectorAll<HTMLInputElement>(".ai-header-row input")];
    expect(inputs).toHaveLength(2);
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setValue.call(inputs[0], "Authorization");
      inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
      setValue.call(inputs[1], "Bearer local-token");
      inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("保存请求头"))!;
    await act(async () => { save.click(); });
    expect(onSaveLocalHeaders).toHaveBeenCalledWith([{ name: "Authorization", value: "Bearer local-token" }]);
  });

  it("separates 随心问's endpoints from offline 随心记", async () => {
    const onChange = vi.fn();
    const defaults = DEFAULT_AI_PROVIDER_PREFERENCES;
    act(() => {
      root.render(
        <AISettingsPanel
          locale="zh"
          preferences={{ ...defaults, enabled: true }}
          localKeyStored={false}
          remoteKeyStored={false}
          localHeaders={[]}
          onChange={onChange}
          onSaveLocalKey={vi.fn(async () => undefined)}
          onClearLocalKey={vi.fn(async () => undefined)}
          onSaveRemoteKey={vi.fn(async () => undefined)}
          onClearRemoteKey={vi.fn(async () => undefined)}
          onSaveLocalHeaders={vi.fn(async (headers) => headers)}
          onTest={vi.fn(async () => undefined)}
        />,
      );
    });

    // The page is 智能; only 随心问 uses a model.
    expect(host.textContent).toContain("智能");
    expect(host.textContent).toContain("随心问");
    expect(host.textContent).toContain("随心记");

    const thinking = host.querySelector<HTMLInputElement>('input[aria-label="回答前先思考"]')!;
    act(() => { thinking.click(); });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ ask: expect.objectContaining({ thinking: true }) }));

    expect(host.textContent).toContain("离线解析");
    expect(host.textContent).toContain("只用本机规则和历史习惯");
    expect(host.textContent).not.toContain("大模型");
  });

  it("keeps one endpoint form and omits capture credentials", () => {
    render();
    // One endpoint form (随心问); Capture is on-device.
    expect(host.querySelectorAll(".ai-settings-card")).toHaveLength(3);
    expect([...host.querySelectorAll("input")].filter((input) => input.value.includes("/v1"))).toHaveLength(1);
  });
});
