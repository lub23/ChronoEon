import { createParser } from "eventsource-parser";
import type { AIToolCall } from "@chronoeon/domain";

export interface AIStreamProgress {
  content: string;
  reasoning: string;
  /** Function calls as they arrive; names show up before their arguments finish. */
  toolCalls?: Array<{ name: string; arguments: string }>;
}

/** Publish transient previews; only return a completed answer for persistence. */
export async function readAIStream(response: Response, progress: () => void, onProgress?: (value: AIStreamProgress) => void): Promise<any> {
  if (!response.body) throw new Error("AI stream has no response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let content = "", reasoning = "", model: string | undefined, usage: unknown;
  let complete = false, done = false, bytes = 0, textBytes = 0;
  const toolCalls: AIToolCall[] = [];
  const encoder = new TextEncoder();
  const snapshot = (): AIStreamProgress => toolCalls.length
    ? { content, reasoning, toolCalls: toolCalls.map((call) => ({ name: call.function.name, arguments: call.function.arguments })) }
    : { content, reasoning };
  const parser = createParser({
    onEvent(event) {
      if (done) return;
      if (event.data === "[DONE]") { complete = true; done = true; return; }
      const payload = JSON.parse(event.data);
      if (payload.error) throw new Error(`AI stream failed: ${String(payload.error.message ?? "provider error")}`);
      model = payload.model ?? model;
      usage = payload.usage ?? usage;
      const choice = payload.choices?.[0];
      const delta = choice?.delta;
      if (typeof delta?.content === "string") { content += delta.content; textBytes += encoder.encode(delta.content).byteLength; }
      if (typeof delta?.reasoning_content === "string") { reasoning += delta.reasoning_content; textBytes += encoder.encode(delta.reasoning_content).byteLength; }
      // Tool calls stream as fragments keyed by index: the id and name arrive
      // first, the JSON arguments follow in pieces.
      if (Array.isArray(delta?.tool_calls)) {
        for (const fragment of delta.tool_calls) {
          const index = typeof fragment?.index === "number" ? fragment.index : toolCalls.length;
          while (toolCalls.length <= index) toolCalls.push({ id: "", type: "function", function: { name: "", arguments: "" } });
          const call = toolCalls[index];
          if (typeof fragment?.id === "string" && fragment.id) call.id = fragment.id;
          if (typeof fragment?.function?.name === "string" && fragment.function.name) call.function.name = fragment.function.name;
          if (typeof fragment?.function?.arguments === "string") {
            call.function.arguments += fragment.function.arguments;
            textBytes += encoder.encode(fragment.function.arguments).byteLength;
          }
        }
      }
      if (textBytes > 2 * 1024 * 1024) throw new Error("AI response exceeded the 2 MB safety limit");
      onProgress?.(snapshot());
      if (choice?.finish_reason === "length") throw new Error(!content && reasoning ? "AI endpoint returned an empty message (reasoning only)" : "AI response exceeded output token budget");
      if (choice?.finish_reason) complete = true;
    },
  });
  try {
    while (!done) {
      const chunk = await reader.read();
      if (chunk.done) break;
      progress();
      bytes += chunk.value.byteLength;
      if (bytes > 16 * 1024 * 1024) throw new Error("AI stream exceeded the 16 MB transport limit");
      parser.feed(decoder.decode(chunk.value, { stream: true }));
    }
    parser.feed(decoder.decode());
    if (!complete) throw new TypeError("AI stream ended before completion");
    const message: Record<string, unknown> = { content, reasoning_content: reasoning };
    if (toolCalls.length) message.tool_calls = toolCalls;
    return { model, usage, choices: [{ message }] };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
