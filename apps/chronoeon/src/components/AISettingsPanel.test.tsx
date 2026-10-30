// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_AI_PROVIDER_PREFERENCES, readAIProviderCredentials, type AIProviderPreferences } from "../ai/provider";
import { AISettingsPanel } from "./AISettingsPanel";
import * as providerApi from "../ai/provider";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const provider = { id: "first", name: "First", preset: "compatible" as const, kind: "openai-compatible" as const, baseUrl: "https://example.test/v1", model: "model" };
function button(text: string) { return [...host.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent === text)!; }
function type(label: string, text: string) {
  const input = [...host.querySelectorAll("label")].find(value => value.querySelector("span")?.textContent?.replace(/ \*$/, "") === label)!.querySelector("input")!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

it("saves credentials separately and explains automatic image routing", async () => {
  let latest = DEFAULT_AI_PROVIDER_PREFERENCES;
  function Panel() {
    const [preferences, set] = useState(DEFAULT_AI_PROVIDER_PREFERENCES);
    return <AISettingsPanel locale="en" preferences={preferences} onChange={next => { latest = next; set(next); }} onTest={vi.fn()} />;
  }
  act(() => root.render(<Panel />));
  act(() => button("Add").click());
  type("Name", "Work"); type("API URL", "https://example.test/v1"); type("API key", "secret"); type("Model", "model");
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Add header"]')!.click());
  const input = host.querySelector<HTMLInputElement>('[aria-label="Header name"]')!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "X-Tenant"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  const value = host.querySelector<HTMLInputElement>('[aria-label="Header value"]')!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(value, "home"); value.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(latest.providers).toHaveLength(1);
  expect(latest.activeProviderId).toBeNull();
  expect(await readAIProviderCredentials(latest.providers[0].id)).toEqual({ apiKey: "secret", headers: [{ name: "X-Tenant", value: "home" }] });
  expect(JSON.stringify(latest)).not.toContain("secret");
  expect(host.textContent).not.toContain("Archived");
  const modes = [...host.querySelectorAll<HTMLButtonElement>(".ai-parsing-settings .settings-segmented button")];
  expect(modes).toHaveLength(0);
  expect(host.textContent).toContain("Text parses automatically on device");
});

it("selects fetched models from a dropdown instead of a separate list", async () => {
  vi.spyOn(providerApi, "fetchAIModels").mockResolvedValue([{ id: "first-model" }, { id: "second-model" }]);
  act(() => root.render(<AISettingsPanel locale="en" preferences={DEFAULT_AI_PROVIDER_PREFERENCES} onChange={vi.fn()} onTest={vi.fn()} />));
  act(() => button("Add").click());
  type("API URL", "https://example.test/v1");
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Load models"]')!.click());
  const select = host.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="Model"]')!;
  expect(select.textContent).toContain("first-model");
  act(() => select.click());
  const second = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === "second-model")!;
  act(() => second.click());
  expect(select.textContent).toContain("second-model");
  expect(host.querySelector(".ai-model-list")).toBeNull();
});

it("does not replace an active provider until its replacement passes the test", async () => {
  const onChange = vi.fn();
  const onTest = vi.fn().mockRejectedValueOnce(new Error("Connection failed")).mockResolvedValueOnce(undefined);
  const preferences: AIProviderPreferences = { ...DEFAULT_AI_PROVIDER_PREFERENCES, providers: [provider, { ...provider, id: "second", name: "Second" }], activeProviderId: "first" };
  act(() => root.render(<AISettingsPanel locale="en" preferences={preferences} onChange={onChange} onTest={onTest} />));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Activate Second"]')!.click());
  expect(onChange).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Connection failed");
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Activate Second"]')!.click());
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ activeProviderId: "second" }));
});

it("keeps credential text in a native masked field without clipboard buttons", () => {
 act(() => root.render(<AISettingsPanel locale="en" preferences={DEFAULT_AI_PROVIDER_PREFERENCES} onChange={vi.fn()} onTest={vi.fn()} />));
 act(() => button("Add").click());
 type("API key", "  debug-secret  ");
 const key = host.querySelector<HTMLInputElement>('[aria-label="API key"]')!;
 expect(key.value).toBe("  debug-secret  ");
 expect(key.type).toBe("password");
 expect(host.querySelector('[aria-label="Paste API key"]')).toBeNull();
 expect(localStorage.getItem("chronoeon.ai.providers") ?? "").not.toContain("debug-secret");
});

it("expands the editor directly inside the selected provider row and preserves common fields on type changes", async () => {
 const preferences = { ...DEFAULT_AI_PROVIDER_PREFERENCES, providers: [provider, { ...provider, id: "second", name: "Second" }] };
 act(() => root.render(<AISettingsPanel locale="en" preferences={preferences} onChange={vi.fn()} onTest={vi.fn()} />));
 await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Edit First"]')!.click());
 const rows = host.querySelectorAll(".ai-provider-list > li");
 expect(rows[0].querySelector("form")).not.toBeNull(); expect(rows[1].querySelector("form")).toBeNull();
 type("Name", "My service"); type("API key", "secret");
 act(() => host.querySelector<HTMLButtonElement>('[aria-label="Provider type"]')!.click());
 act(() => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(row => row.textContent === "DeepSeek")!.click());
 const values = [...host.querySelectorAll("input")].map(input => input.value);
 expect(values).toEqual(expect.arrayContaining(["My service", "https://example.test/v1", "model", "secret"]));
});

it("rejects blank required fields and incomplete headers without saving", async () => {
 const onChange = vi.fn();
 act(() => root.render(<AISettingsPanel locale="en" preferences={DEFAULT_AI_PROVIDER_PREFERENCES} onChange={onChange} onTest={vi.fn()} />));
 act(() => button("Add").click());
 const submit = async () => act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
 await submit(); expect(host.querySelector('[role="alert"]')?.textContent).toContain("Enter a name");
 type("Name", "Work"); type("API URL", "https://example.test/v1"); type("Model", "model");
 act(() => host.querySelector<HTMLButtonElement>('[aria-label="Add header"]')!.click());
 await submit(); expect(host.querySelector('[role="alert"]')?.textContent).toContain("header name"); expect(onChange).not.toHaveBeenCalled();
 expect(host.querySelector('datalist option[value="Authorization"]')).not.toBeNull();
});
