import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_AI_PROVIDER_PREFERENCES,
  clearLocalAIKey,
  clearRemoteAIKey,
  normalizeAIBaseUrl,
  normalizeAIProviderPreferences,
  saveLocalAIKey,
  saveRemoteAIKey,
  requestAICompletion,
  warmUpAIProvider,
} from "./provider";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("OpenAI-compatible provider adapter", () => {
  it("keeps secrets out of normalized persistent preferences", () => {
    const value = normalizeAIProviderPreferences({
      enabled: true,
      remote: { baseUrl: "https://example.test/v1", model: "model", apiKey: "secret" },
    });
    expect(value.remote).not.toHaveProperty("apiKey");
    expect(value.remote.baseUrl).toBe("https://example.test/v1");
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
      { ...DEFAULT_AI_PROVIDER_PREFERENCES.remote, baseUrl: "https://example.test/v1", model: "m" },
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
      { ...DEFAULT_AI_PROVIDER_PREFERENCES.local, baseUrl: "http://166.111.240.129:8080/v1", model: "Qwen3.8-27B" },
      [{ role: "user", content: "test" }],
    );
    expect(result.content).toBe("Visible answer");
    expect(result.reasoningContent).toBe("Hidden reasoning");
  });

  it("sends the configured local key with Bearer Authorization", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem: () => undefined } });
    await saveLocalAIKey("local-secret");
    const result = await requestAICompletion(
      { ...DEFAULT_AI_PROVIDER_PREFERENCES.local, baseUrl: "http://127.0.0.1:8080/v1", model: "local-model" },
      [{ role: "user", content: "test" }],
    );
    expect(result.content).toBe("ok");
    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get("Authorization")).toBe("Bearer local-secret");
    await requestAICompletion(
      { ...DEFAULT_AI_PROVIDER_PREFERENCES.remote, baseUrl: "https://example.test/v1", model: "remote-model" },
      [{ role: "user", content: "test" }],
    );
    const remoteHeaders = new Headers(fetchMock.mock.calls[1][1].headers);
    expect(remoteHeaders.get("Authorization")).toBeNull();
    await clearLocalAIKey();
    await saveRemoteAIKey("remote-secret");
    await requestAICompletion(
      { ...DEFAULT_AI_PROVIDER_PREFERENCES.remote, baseUrl: "https://example.test/v1", model: "remote-model" },
      [{ role: "user", content: "test" }],
    );
    const remoteKeyHeaders = new Headers(fetchMock.mock.calls[2][1].headers);
    expect(remoteKeyHeaders.get("X-Api-Key")).toBe("remote-secret");
    expect(remoteKeyHeaders.get("Authorization")).toBeNull();
    await clearRemoteAIKey();
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
      { ...DEFAULT_AI_PROVIDER_PREFERENCES.local, baseUrl: "http://127.0.0.1:8080/v1", model: "local-model" },
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
  const provider = { ...DEFAULT_AI_PROVIDER_PREFERENCES.remote, baseUrl: "https://example.test/v1", model: "test-model" };
  const messages = [{ role: "user" as const, content: "synthetic test" }];
  const answer = { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "answer" } }] }) };

  it("enables the approved remote endpoint while preserving explicit saved choices", () => {
    const defaults = normalizeAIProviderPreferences({});
    expect(defaults).toMatchObject({ enabled: true, remote: { baseUrl: "http://183.173.65.181:8080/v1", model: "Qwen3.8-27B", timeoutMs: 90_000 } });
    expect(normalizeAIProviderPreferences({ enabled: false, remote: { baseUrl: "", model: "" } })).toMatchObject({ enabled: false, remote: { baseUrl: "", model: "" } });
  });

  it("lets the assistant think by default but disables thinking for capture", async () => {
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
  const result = await requestAICompletion({ ...DEFAULT_AI_PROVIDER_PREFERENCES.remote, baseUrl: "https://example.test/v1" }, [{ role: "user", content: "test" }]);
  expect(result.content).toBe("Recovered"); expect(fetchMock).toHaveBeenCalledTimes(2);
});
