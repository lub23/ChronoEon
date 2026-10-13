// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AI_PROVIDER, requestAICompletion, warmUpAIProvider, saveAIProviderCredentials, readAIProviderCredentials } from "./provider";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../platform/desktop", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
beforeEach(() => { invoke.mockReset(); });
afterEach(() => vi.useRealTimers());
const provider = { ...DEFAULT_AI_PROVIDER, id: "saved-profile", model: "test-model", baseUrl: "https://example.test/v1" };
const messages = [{ role: "user" as const, content: "synthetic test" }];

describe("native AI completion bridge", () => {
  it("sends assistant requests without the no-thinking flag and retries one transport failure", async () => {
    invoke.mockRejectedValueOnce("AI request failed: connection refused").mockResolvedValueOnce({ content: "ok" });
    expect((await requestAICompletion(provider, messages)).content).toBe("ok");
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenLastCalledWith("ai_chat_completion", { request: expect.objectContaining({ disableReasoning: false, timeoutMs: 90_000 }) });
  });
  it("sends profile identity so credentials cannot cross providers", async () => {
    invoke.mockResolvedValue({ content: "ok" });
    await requestAICompletion(provider, messages);
    expect(invoke).toHaveBeenCalledWith("ai_chat_completion", { request: expect.objectContaining({ providerId: "saved-profile" }) });
  });
  it("persists keys and headers as one profile-scoped native credential", async () => {
    const credentials = { apiKey: "secret", headers: [{ name: "X-Tenant", value: "home" }] };
    invoke.mockResolvedValue(credentials);
    await saveAIProviderCredentials("first", credentials);
    expect(invoke).toHaveBeenCalledWith("save_ai_provider_credentials", { providerId: "first", credentials });
    expect(await readAIProviderCredentials("first")).toEqual(credentials);
  });
  it("settles cancellation immediately and ignores a late native error without retrying", async () => {
    let reject!: (error: unknown) => void;
    invoke.mockReturnValue(new Promise((_yes, no) => { reject = no; }));
    const controller = new AbortController();
    const request = requestAICompletion(provider, messages, undefined, controller.signal);
    const assertion = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    controller.abort(); await assertion;
    reject("AI request failed: timed out"); await Promise.resolve();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("bounds native models-only warm-up to eight seconds even if invoke never returns", async () => {
    vi.useFakeTimers(); invoke.mockReturnValue(new Promise(() => {}));
    const warmup = warmUpAIProvider(provider);
    await vi.advanceTimersByTimeAsync(8000);
    await expect(warmup).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("ai_list_models", { request: expect.objectContaining({ timeoutMs: 8000 }) });
  });
});

it("retries reasoning-only exhaustion once with thinking disabled", async () => {
  invoke.mockRejectedValueOnce("AI endpoint returned an empty message (reasoning only)").mockResolvedValueOnce({ content: "Diet analysis" });
  const result = await requestAICompletion(provider, messages, undefined, undefined, { disableReasoning: false });
  expect(result.content).toBe("Diet analysis");
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(invoke.mock.calls[1][1].request.disableReasoning).toBe(true);
});
