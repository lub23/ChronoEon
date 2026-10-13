import type { AIChatMessage, AIProviderConfig, AIToolCall, AIToolDefinition } from "@chronoeon/domain";
import { readAIStream } from "./streaming";
import { isTauri } from "../platform/desktop";

/** How a quick note is turned into drafts. */
export type CaptureParseMode = "offline";

export type AIProviderPreset = "compatible" | "openai" | "deepseek" | "gemini" | "groq" | "ollama" | "local";
export interface AIProviderProfile extends AIProviderConfig { id: string; name: string; preset: AIProviderPreset; }
export interface AIAskPreferences { thinking: boolean; mode: "ai"; }

/** 随心记 is always the on-device parser. */
export interface AICapturePreferences {
  mode: CaptureParseMode;
}

export interface AIProviderPreferences {
  enabled: boolean;
  providers: AIProviderProfile[];
  activeProviderId: string | null;
  ask: AIAskPreferences;
  capture: AICapturePreferences;
}

export interface AICompletionResult {
  content: string;
  toolCalls?: AIToolCall[];
  reasoningContent?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  schemaFallback?: boolean;
}

export interface AIModelInfo {
  id: string;
}

export interface AICompletionOptions {
  tools?: AIToolDefinition[];
  toolChoice?: "auto" | "none";
  stream?: boolean;
  disableReasoning?: boolean;
  maxTokens?: number;
  credentials?: AIProviderCredentials;
}

export const AI_PROVIDER_STORAGE_KEY = "chronoeon.ai.providers";
export const DEFAULT_AI_PROVIDER: AIProviderConfig = {
  kind: "openai-compatible",
  baseUrl: "",
  model: "",
  timeoutMs: 90_000,
  maxTokens: 4096,
  temperature: 0.1,
};
export const DEFAULT_AI_PROVIDER_PREFERENCES: AIProviderPreferences = {
  enabled: true,
  providers: [],
  activeProviderId: null,
  ask: { thinking: false, mode: "ai" },
  capture: { mode: "offline" },
};

export interface AICustomHeader {
  name: string;
  value: string;
}
export interface AIProviderCredentials { apiKey: string; headers: AICustomHeader[]; }
export const AI_PROVIDER_PRESETS: Record<AIProviderPreset, { name: string; baseUrl: string; kind: AIProviderConfig["kind"] }> = {
  compatible: { name: "OpenAI Compatible", baseUrl: "", kind: "openai-compatible" },
  openai: { name: "OpenAI", baseUrl: "https://api.openai.com/v1", kind: "openai-compatible" },
  deepseek: { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", kind: "openai-compatible" },
  gemini: { name: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", kind: "openai-compatible" },
  groq: { name: "Groq", baseUrl: "https://api.groq.com/openai/v1", kind: "openai-compatible" },
  ollama: { name: "Ollama", baseUrl: "http://localhost:11434/v1", kind: "local-openai-compatible" },
  local: { name: "Local", baseUrl: "http://127.0.0.1:8080/v1", kind: "local-openai-compatible" },
};

// Browser builds have no OS keychain. Keys may be used for the current page,
// but are deliberately held only in module memory: never localStorage, exports,
// logs, URLs, or tracked source.
const browserCredentials = new Map<string, AIProviderCredentials>();

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback;
}

export function normalizeAIBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("AI endpoint is empty");
  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("AI endpoint must use HTTP or HTTPS");
  if (url.username || url.password) throw new Error("AI endpoint must not contain credentials");
  return trimmed;
}

function normalizeProvider(value: unknown, fallback: AIProviderConfig): AIProviderConfig {
  const input = value && typeof value === "object" ? value as Partial<AIProviderConfig> : {};
  return {
    id: typeof input.id === "string" ? input.id : undefined,
    kind: input.kind === "local-openai-compatible" ? input.kind : fallback.kind,
    baseUrl: typeof input.baseUrl === "string" ? input.baseUrl.trim() : fallback.baseUrl,
    model: typeof input.model === "string" ? input.model.trim() : fallback.model,
    timeoutMs: boundedNumber(input.timeoutMs, fallback.timeoutMs ?? 45_000, 2_000, 180_000),
    // Advice is the app's longest reply by far, so the ceiling stays generous:
    // the request cap is a guard rail, not a length target.
    maxTokens: boundedNumber(input.maxTokens, fallback.maxTokens ?? 4096, 128, 32_768),
    temperature: boundedNumber(input.temperature, fallback.temperature ?? 0.1, 0, 2),
  };
}

export function normalizeAIProviderPreferences(value: unknown): AIProviderPreferences {
  const input = value && typeof value === "object" ? value as Partial<AIProviderPreferences> : {};
  const ask = input.ask && typeof input.ask === "object" ? input.ask : undefined;
  const seen = new Set<string>();
  const providers = (Array.isArray(input.providers) ? input.providers : []).filter(profile => {
    if (!profile || typeof profile.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(profile.id) || seen.has(profile.id)) return false;
    seen.add(profile.id); return true;
  }).map(profile => ({
    ...normalizeProvider(profile, DEFAULT_AI_PROVIDER), id: profile.id,
    name: typeof profile.name === "string" ? profile.name.trim() : "",
    preset: Object.hasOwn(AI_PROVIDER_PRESETS, profile.preset) ? profile.preset : "compatible" as const,
  }));
  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : DEFAULT_AI_PROVIDER_PREFERENCES.enabled,
    providers,
    activeProviderId: providers.some(profile => profile.id === input.activeProviderId) ? input.activeProviderId! : null,
    ask: {
      mode: "ai",
      thinking: ask?.thinking === true,
    },
    capture: { mode: "offline" },
  };
}

export function readAIProviderPreferences(): AIProviderPreferences {
  try {
    const raw = window.localStorage.getItem(AI_PROVIDER_STORAGE_KEY);
    return raw ? normalizeAIProviderPreferences(JSON.parse(raw)) : structuredClone(DEFAULT_AI_PROVIDER_PREFERENCES);
  } catch {
    return structuredClone(DEFAULT_AI_PROVIDER_PREFERENCES);
  }
}

export function writeAIProviderPreferences(value: AIProviderPreferences): void {
  // `normalize` also drops accidental unknown fields such as apiKey.
  window.localStorage.setItem(AI_PROVIDER_STORAGE_KEY, JSON.stringify(normalizeAIProviderPreferences(value)));
}

export function activeAIProvider(preferences: AIProviderPreferences): AIProviderProfile | undefined {
  return preferences.providers.find(profile => profile.id === preferences.activeProviderId);
}

/** 随心问 can reach a model. */
export function askIsReady(preferences: AIProviderPreferences): boolean {
  const provider = activeAIProvider(preferences);
  return preferences.enabled && Boolean(provider?.baseUrl.trim() && provider.model.trim());
}

export async function readAIProviderCredentials(providerId: string): Promise<AIProviderCredentials> {
  if (!isTauri()) return structuredClone(browserCredentials.get(providerId) ?? { apiKey: "", headers: [] });
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AIProviderCredentials>("ai_provider_credentials", { providerId });
}

export async function saveAIProviderCredentials(providerId: string, credentials: AIProviderCredentials): Promise<void> {
  const normalized = { apiKey: credentials.apiKey.trim(), headers: normalizeAICustomHeaders(credentials.headers) };
  if (/[\r\n\0]/.test(normalized.apiKey)) throw new Error("Invalid API key");
  if (!isTauri()) { browserCredentials.set(providerId, normalized); return; }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("save_ai_provider_credentials", { providerId, credentials: normalized });
}

export async function deleteAIProviderCredentials(providerId: string): Promise<void> {
  browserCredentials.delete(providerId);
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("delete_ai_provider_credentials", { providerId });
}

export function normalizeAICustomHeaders(value: unknown): AICustomHeader[] {
  const items = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const headers: AICustomHeader[] = [];
  for (const item of items.slice(0, 10)) {
    const record = item && typeof item === "object" ? item as Partial<AICustomHeader> : {};
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const headerValue = typeof record.value === "string" ? record.value.trim() : "";
    if (!name || !headerValue || !/^[\w!#$%&'*+.^`|~-]+$/.test(name) || name.length > 128) continue;
    if (headerValue.length > 2048 || /[\r\n\0]/.test(headerValue)) continue;
    if (/^(?:host|content-length|connection)$/i.test(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    headers.push({ name, value: headerValue });
  }
  return headers;
}

function browserHeaders(provider: AIProviderConfig, credentials?: AIProviderCredentials): Headers {
  const secret = credentials ?? (provider.id ? browserCredentials.get(provider.id) : undefined);
  const headers = new Headers({ Accept: "application/json" });
  if (secret?.apiKey) headers.set("Authorization", `Bearer ${secret.apiKey}`);
  for (const header of secret?.headers ?? []) headers.set(header.name, header.value);
  return headers;
}

function completionContent(payload: unknown): string {
  const value = payload && typeof payload === "object" ? payload as any : {};
  const content = value.choices?.[0]?.message?.content ?? value.choices?.[0]?.text;
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part: unknown) => typeof (part as any)?.text === "string" ? (part as any).text : "").join("")
      : "";
  return text.trim();
}

function completionReasoning(payload: unknown): string | undefined {
  const value = payload && typeof payload === "object" ? payload as any : {};
  const reasoning = value.choices?.[0]?.message?.reasoning_content;
  return typeof reasoning === "string" && reasoning.trim() ? reasoning.trim() : undefined;
}

async function browserCompletion(
  provider: AIProviderConfig,
  messages: AIChatMessage[],
  responseSchema?: Record<string, unknown>,
  signal?: AbortSignal,
  options?: AICompletionOptions,
): Promise<AICompletionResult> {
  const endpoint = `${normalizeAIBaseUrl(provider.baseUrl)}/chat/completions`;
  const body: Record<string, unknown> = {
    model: provider.model.trim(),
    messages,
    stream: options?.stream ?? false,
    temperature: provider.temperature ?? 0.1,
    max_tokens: options?.maxTokens ?? provider.maxTokens ?? 1600,
  };
  if (options?.stream) body.stream_options = { include_usage: true };
  if (responseSchema) body.response_format = { type: "json_schema", json_schema: { name: "chronoeon_entries", strict: true, schema: responseSchema } };
  if (options?.tools?.length) {
    body.tools = options.tools;
    body.tool_choice = options.toolChoice ?? "auto";
  }
  if (options?.disableReasoning) {
    body.chat_template_kwargs = { enable_thinking: false };
  }
  // Browser fetch has no portable request timeout in older WebViews. Use one
  // controller for both the caller's cancellation and the provider timeout so
  // a remote model can never leave the capture dialog spinning forever.
  const requestController = new AbortController();
  const abortFromCaller = () => requestController.abort();
  if (signal) {
    if (signal.aborted) requestController.abort();
    else signal.addEventListener("abort", abortFromCaller, { once: true });
  }
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  const progress = () => {
    globalThis.clearTimeout(timeout);
    timeout = globalThis.setTimeout(() => requestController.abort(), provider.timeoutMs ?? 90_000);
  };
  progress();
  const headers = browserHeaders(provider, options?.credentials);
  headers.set("Content-Type", "application/json");
  if (options?.stream) headers.set("Accept", "text/event-stream");
  const send = (requestBody: Record<string, unknown>) => fetch(endpoint, {
    method: "POST",
    signal: requestController.signal,
    headers,
    body: JSON.stringify(requestBody),
  });
  try {
    let schemaFallback = false;
    let response = await send(body);
    if (responseSchema && [400, 404, 415, 422].includes(response.status)) {
      schemaFallback = true;
      const fallback = { ...body };
      delete fallback.response_format;
      response = await send(fallback);
    }
    const payload = response.ok && response.headers?.get("Content-Type")?.includes("text/event-stream")
      ? await readAIStream(response, progress)
      : await response.json().catch((error: unknown) => {
      // A timeout/network failure can arrive after headers while reading JSON.
      // Preserve it for the bounded retry instead of reporting an empty answer.
      if (requestController.signal.aborted || error instanceof TypeError) throw error;
      return {};
    }) as any;
    if (!response.ok) throw new Error(`AI endpoint returned ${response.status}: ${String(payload?.error?.message ?? response.statusText).slice(0, 400)}`);
    const reasoningContent = completionReasoning(payload);
    let content = completionContent(payload);

    const rawToolCalls = payload.choices?.[0]?.message?.tool_calls;
    const toolCalls = Array.isArray(rawToolCalls) ? rawToolCalls as AIToolCall[] : undefined;
    if (!content && !toolCalls?.length) throw new Error(reasoningContent ? "AI endpoint returned an empty message (reasoning only)" : "AI endpoint returned an empty message");
    return {
      content,
      toolCalls,
      reasoningContent,
      model: typeof payload.model === "string" ? payload.model : undefined,
      promptTokens: payload.usage?.prompt_tokens,
      completionTokens: payload.usage?.completion_tokens,
      schemaFallback,
    };
  } finally {
    globalThis.clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

/** Native invokes cannot cancel the HTTP job, but cancellation must settle the UI
 * immediately and must never deliver an obsolete reply or start another attempt. */
function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException("Request cancelled", "AbortError"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
function transientFailure(reason: unknown): boolean {
  if (reason instanceof TypeError || (reason instanceof Error && ["AbortError", "TimeoutError"].includes(reason.name))) return true;
  const message = reason instanceof Error ? reason.message : String(reason);
  return /^AI request failed:|AI endpoint returned 5(?:02|03|04)|timed?\s*out|timeout|network|connection|fetch failed/i.test(message);
}
export async function requestAICompletion(
  provider: AIProviderConfig,
  messages: AIChatMessage[],
  responseSchema?: Record<string, unknown>,
  signal?: AbortSignal,
  options?: AICompletionOptions,
): Promise<AICompletionResult> {
  normalizeAIBaseUrl(provider.baseUrl);
  if (!provider.model.trim()) throw new Error("AI model is empty");
  let completionOptions = options;
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
    try {
      if (!isTauri()) return await browserCompletion(provider, messages, responseSchema, signal, completionOptions);
      const { invoke } = await import("@tauri-apps/api/core");
      if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
      return await withAbort(invoke<AICompletionResult>("ai_chat_completion", {
        request: {
          baseUrl: provider.baseUrl, model: provider.model, messages, responseSchema,
          temperature: provider.temperature, maxTokens: completionOptions?.maxTokens ?? provider.maxTokens, timeoutMs: provider.timeoutMs,
          providerId: provider.id,
          credentials: completionOptions?.credentials,
          tools: completionOptions?.tools, toolChoice: completionOptions?.toolChoice ?? "auto",
          disableReasoning: completionOptions?.disableReasoning ?? false,
          stream: completionOptions?.stream ?? false,
        },
      }), signal);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!signal?.aborted && attempt < 1 && /empty message.*reasoning only/.test(message) && !completionOptions?.disableReasoning) {
        completionOptions = { ...completionOptions, disableReasoning: true };
        continue;
      }
      if (signal?.aborted || attempt >= 1 || !transientFailure(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

/** Probe the compatible endpoint's model catalog without a completion request. */
export async function fetchAIModels(provider: AIProviderConfig, signal?: AbortSignal, credentials?: AIProviderCredentials): Promise<AIModelInfo[]> {
  const endpoint = `${normalizeAIBaseUrl(provider.baseUrl)}/models`;
  if (!isTauri()) {
    const headers = browserHeaders(provider, credentials);
    const response = await fetch(endpoint, {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(provider.timeoutMs ?? 15_000)]) : AbortSignal.timeout(provider.timeoutMs ?? 15_000),
      headers,
    });
    const payload = await response.json().catch(() => ({})) as any;
    if (!response.ok) throw new Error(`AI endpoint returned ${response.status}: ${String(payload?.error?.message ?? response.statusText).slice(0, 400)}`);
    return parseAIModels(payload);
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return withAbort(invoke<AIModelInfo[]>("ai_list_models", {
    request: {
      baseUrl: provider.baseUrl,
      providerId: provider.id,
      credentials,
      timeoutMs: provider.timeoutMs,
    },
  }), signal);
}

function parseAIModels(payload: unknown): AIModelInfo[] {
  const value = payload && typeof payload === "object" ? payload as any : {};
  const items = Array.isArray(value.data) ? value.data : Array.isArray(value.models) ? value.models : [];
  return items.map((item: any) => ({
    id: typeof item === "string" ? item : typeof item?.id === "string" ? item.id : typeof item?.name === "string" ? item.name : "",
  })).filter((model: AIModelInfo) => model.id.trim().length > 0);
}

/** Wake sleeping endpoints without sending any capture/history content. */
const warmups = new Map<string, Promise<void>>();
export function warmUpAIProvider(provider: AIProviderConfig): Promise<void> {
  const key = `${provider.id ?? ""}:${provider.baseUrl}`;
  const pending = warmups.get(key);
  if (pending) return pending;
  const request = (async () => {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), 8_000);
    try { await fetchAIModels({ ...provider, timeoutMs: 8_000 }, controller.signal); }
    catch { /* Warm-up is best-effort; the offline preview stays available. */ }
    finally { globalThis.clearTimeout(timeout); }
  })();
  warmups.set(key, request);
  void request.finally(() => warmups.delete(key));
  return request;
}
