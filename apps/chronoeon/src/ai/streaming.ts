import { createParser } from "eventsource-parser";

/** Consume SSE completely before publishing an answer; never save a partial stream. */
export async function readAIStream(response: Response, progress: () => void): Promise<any> {
  if (!response.body) throw new Error("AI stream has no response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let content = "", reasoning = "", model: string | undefined, usage: unknown;
  let complete = false, bytes = 0, textBytes = 0;
  const encoder = new TextEncoder();
  const parser = createParser({
    onEvent(event) {
      if (event.data === "[DONE]") { complete = true; return; }
      const payload = JSON.parse(event.data);
      if (payload.error) throw new Error(`AI stream failed: ${String(payload.error.message ?? "provider error")}`);
      model = payload.model ?? model;
      usage = payload.usage ?? usage;
      const choice = payload.choices?.[0];
      const delta = choice?.delta;
      if (typeof delta?.content === "string") { content += delta.content; textBytes += encoder.encode(delta.content).byteLength; }
      if (typeof delta?.reasoning_content === "string") { reasoning += delta.reasoning_content; textBytes += encoder.encode(delta.reasoning_content).byteLength; }
      if (textBytes > 2 * 1024 * 1024) throw new Error("AI response exceeded the 2 MB safety limit");
      if (choice?.finish_reason === "length") throw new Error(!content && reasoning ? "AI endpoint returned an empty message (reasoning only)" : "AI response exceeded output token budget");
      if (choice?.finish_reason) complete = true;
    },
  });
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      progress();
      bytes += chunk.value.byteLength;
      if (bytes > 16 * 1024 * 1024) throw new Error("AI stream exceeded the 16 MB transport limit");
      parser.feed(decoder.decode(chunk.value, { stream: true }));
    }
    parser.feed(decoder.decode());
    if (!complete) throw new TypeError("AI stream ended before completion");
    return { model, usage, choices: [{ message: { content, reasoning_content: reasoning } }] };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
