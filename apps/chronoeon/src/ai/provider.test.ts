import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_AI_PROVIDER, DEFAULT_AI_PROVIDER_PREFERENCES,
  deleteAIProviderCredentials, readAIProviderCredentials,
  normalizeAICustomHeaders,
  normalizeAIBaseUrl,
  normalizeAIProviderPreferences,
  saveAIProviderCredentials,
  requestAICompletion,
  warmUpAIProvider,
} from "./provider";
const testProvider = { ...DEFAULT_AI_PROVIDER, id: "remote", model: "test-model" };
const testLocalProvider = { ...DEFAULT_AI_PROVIDER, id: "local", kind: "local-openai-compatible" as const, model: "test-model" };

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("OpenAI-compatible provider adapter", () => {
  it("keeps secrets out of normalized persistent preferences", () => {
    const value = normalizeAIProviderPreferences({
      enabled: true,
      providers: [{ id: "first", name: "First", preset: "compatible", baseUrl: "https://example.test/v1", model: "model", apiKey: "secret", headers: [{ name: "X-Key", value: "secret" }] }],
      activeProviderId: "first",
    });
    expect(value.providers[0]).not.toHaveProperty("apiKey");
    expect(value.providers[0]).not.toHaveProperty("headers");
    expect(value.providers[0].baseUrl).toBe("https://example.test/v1");
    // 随心记 answers with JSON only, so it never inherits 随心问's thinking flag.
    expect(value.ask.thinking).toBe(false);
    expect(value.capture).toEqual({ mode: "offline" });
  });

  it("rejects embedded credentials and non-http endpoints", () => {
    expect(() => normalizeAIBaseUrl("file:///tmp/model")).toThrow();
    expect(() => normalizeAIBaseUrl("https://user:secret@example.test/v1")).toThrow();
  });

  it("falls back when a compatible endpoint does not support json_schema", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { message: "unsupported" } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"entries":[]}' } }] }) });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem: () => undefined } });
    const result = await requestAICompletion(
      { ...testProvider, baseUrl: "https://example.test/v1", model: "m" },
      [{ role: "user", content: "test" }],
      { type: "object" },
    );
    expect(result.schemaFallback).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty("response_format");
  });

  it("keeps Qwen reasoning separate from the user-facing answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "Visible answer", reasoning_content: "Hidden reasoning" } }],
      }),
    }));
    vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem: () => undefined } });
    const result = await requestAICompletion(
      { ...testProvider, baseUrl: "https://example.test/v1", model: "Qwen3.8-27B" },
      [{ role: "user", content: "test" }],
    );
    expect(result.content).toBe("Visible answer");
    expect(result.reasoningContent).toBe("Hidden reasoning");
  });

  it("sends configured keys with Bearer Authorization", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem: () => undefined } });
    const result = await requestAICompletion(
      { ...testProvider, baseUrl: "https://example.test/v1", model: "remote-model" },
      [{ role: "user", content: "test" }],
    );
    expect(result.content).toBe("ok");
    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get("Authorization")).toBeNull();
    await requestAICompletion(
      { ...testProvider, baseUrl: "https://example.test/v1", model: "remote-model" },
      [{ role: "user", content: "test" }],
    );
    const remoteHeaders = new Headers(fetchMock.mock.calls[1][1].headers);
    await saveAIProviderCredentials("remote", { apiKey: "remote-secret", headers: [] });
    await requestAICompletion(
      { ...testProvider, baseUrl: "https://example.test/v1", model: "remote-model" },
      [{ role: "user", content: "test" }],
    );
    const remoteKeyHeaders = new Headers(fetchMock.mock.calls[2][1].headers);
    expect(remoteKeyHeaders.get("X-Api-Key")).toBeNull();
    expect(remoteKeyHeaders.get("Authorization")).toBe("Bearer remote-secret");
    await saveAIProviderCredentials("local", { apiKey: "local-secret", headers: [] });
    await requestAICompletion(
      { ...testLocalProvider, baseUrl: "http://127.0.0.1:8080/v1", model: "local-model" },
      [{ role: "user", content: "test" }],
    );
    const localKeyHeaders = new Headers(fetchMock.mock.calls[3][1].headers);
    expect(localKeyHeaders.get("Authorization")).toBe("Bearer local-secret");
    await saveAIProviderCredentials("local", { apiKey: "local-secret", headers: [{ name: "X-Tenant", value: "home" }] });
    await requestAICompletion(
      { ...testLocalProvider, baseUrl: "http://127.0.0.1:8080/v1", model: "local-model" },
      [{ role: "user", content: "test" }],
    );
    const localHeaderHeaders = new Headers(fetchMock.mock.calls[4][1].headers);
    expect(localHeaderHeaders.get("X-Tenant")).toBe("home");
    expect((await readAIProviderCredentials("remote")).headers).toEqual([]);
    await deleteAIProviderCredentials("local");
    await deleteAIProviderCredentials("remote");
  });

  it("sends model-selected tools and preserves an empty tool-call message", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: "",
            tool_calls: [{ id: "call-1", type: "function", function: { name: "search_entries", arguments: "{}" } }],
          },
        }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem: () => undefined } });
    const tools = [{
      type: "function" as const,
      function: { name: "search_entries", description: "Search", parameters: { type: "object" } },
    }];
    const result = await requestAICompletion(
      { ...testProvider, baseUrl: "https://example.test/v1", model: "remote-model" },
      [{ role: "user", content: "test" }],
      undefined,
      undefined,
      { tools },
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tools).toEqual(tools);
    expect(body.tool_choice).toBe("auto");
    expect(result.toolCalls?.[0]).toMatchObject({ id: "call-1", function: { name: "search_entries" } });
  });
});


describe("capture provider defaults and wake-up", () => {
  const provider = { ...testProvider, baseUrl: "https://example.test/v1", model: "test-model" };
  const messages = [{ role: "user" as const, content: "synthetic test" }];
  const answer = { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "answer" } }] }) };

  it("starts without an endpoint and activates only an existing saved profile", () => {
    const defaults = normalizeAIProviderPreferences({});
    expect(defaults).toEqual(DEFAULT_AI_PROVIDER_PREFERENCES);
    expect(normalizeAIProviderPreferences({ activeProviderId: "missing" }).activeProviderId).toBeNull();
    const split = normalizeAIProviderPreferences({
      providers: [{ id: "first", name: "First", preset: "compatible", baseUrl: "https://ask.test/v1", model: "ask-model" }],
      activeProviderId: "first",
      capture: { mode: "offline" },
    });
    expect(split.providers[0].model).toBe("ask-model");
    expect(split.activeProviderId).toBe("first");
    expect(split.capture).toEqual({ mode: "offline" });
  });

  it("keeps thinking off unless the caller asks for it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(answer);
    vi.stubGlobal("fetch", fetchMock);
    await requestAICompletion(provider, messages);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.chat_template_kwargs).toBeUndefined();
    await requestAICompletion(provider, messages, undefined, undefined, { disableReasoning: true });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it("retries a transient network failure once, without retrying HTTP rejection", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(answer);
    vi.stubGlobal("fetch", fetchMock);
    expect((await requestAICompletion(provider, messages)).content).toBe("answer");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockReset().mockResolvedValueOnce({ ok: false, status: 504, json: async () => ({}) }).mockResolvedValueOnce(answer);
    expect((await requestAICompletion(provider, messages)).content).toBe("answer");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockReset().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    await expect(requestAICompletion(provider, messages)).rejects.toThrow("401");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops after two connection failures", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestAICompletion(provider, messages)).rejects.toThrow("fetch failed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a timeout but never retries explicit cancellation", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementationOnce((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("timed out", "AbortError")), { once: true });
    })).mockResolvedValueOnce(answer);
    vi.stubGlobal("fetch", fetchMock);
    const result = requestAICompletion({ ...provider, timeoutMs: 2000 }, messages);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await result).content).toBe("answer");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const controller = new AbortController(); controller.abort();
    await expect(requestAICompletion(provider, messages, undefined, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("deduplicates in-flight warm-ups, requests only models and swallows an 8s timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("timed out", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const first = warmUpAIProvider(provider);
    expect(warmUpAIProvider(provider)).toBe(first);
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.test/v1/models");
    await vi.advanceTimersByTimeAsync(8000);
    await expect(first).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});


it("retries a connection failure while reading the response body", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new TypeError("network disconnected"); } })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "Recovered" } }] }) });
  vi.stubGlobal("fetch", fetchMock);
  const result = await requestAICompletion({ ...testProvider, baseUrl: "https://example.test/v1" }, [{ role: "user", content: "test" }]);
  expect(result.content).toBe("Recovered"); expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("never publishes hidden reasoning as a final answer or tool content", async () => {
  const call = { id: "one", type: "function", function: { name: "search_entries", arguments: "{}" } };
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "", reasoning_content: "Let me think 中文", tool_calls: [call] } }] }) });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", {});
  const result = await requestAICompletion({ ...testProvider, baseUrl: "https://example.test/v1" }, [{ role: "user", content: "test" }]);
  expect(result.content).toBe("");
  expect(result.toolCalls).toEqual([call]);
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "", reasoning_content: "Hidden only" } }] }) });
  await expect(requestAICompletion({ ...testProvider, baseUrl: "https://example.test/v1" }, [{ role: "user", content: "test" }])).rejects.toThrow("empty message");
});
