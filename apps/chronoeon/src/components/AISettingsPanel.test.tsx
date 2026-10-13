// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_AI_PROVIDER_PREFERENCES, readAIProviderCredentials, type AIProviderPreferences } from "../ai/provider";
import { AISettingsPanel } from "./AISettingsPanel";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const provider = { id: "first", name: "First", preset: "compatible" as const, kind: "openai-compatible" as const, baseUrl: "https://example.test/v1", model: "model" };
function button(text: string) { return [...host.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent === text)!; }
function type(label: string, text: string) {
  const input = [...host.querySelectorAll("label")].find(value => value.textContent === label)!.querySelector("input")!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

it("saves one provider with its key and headers, while capture stays offline", async () => {
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
  expect(modes.map(value => [value.textContent, value.disabled])).toEqual([["Offline", false], ["AI", true], ["Offline", true], ["AI", false]]);
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
