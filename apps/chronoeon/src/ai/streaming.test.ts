import { describe, it, expect, vi } from "vitest";
import { readAIStream } from "./streaming";
function response(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
    controller.close();
  } }), { headers: { "Content-Type": "text/event-stream" } });
}
describe("AI streaming completion", () => {
  it("finishes at DONE without waiting for a kept-open HTTP body, retaining trailing usage", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Done"},"finish_reason":"stop"}]}\n\n'));
        controller.enqueue(new TextEncoder().encode('data: {"choices":[],"usage":{"completion_tokens":1}}\n\ndata: [DONE]\n\n'));
        // Deliberately never close: the provider has finished, the connection has not.
      },
      cancel,
    });
    const result = await readAIStream(new Response(stream), () => {});
    expect(result.choices[0].message.content).toBe("Done");
    expect(result.usage.completion_tokens).toBe(1);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("assembles split UTF-8 and SSE frames, with reasoning and usage separate", async () => {
    const result = await readAIStream(response('data: {"model":"qwen","choices":[{"delta":{"reasoning_content":"思考"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"饮食分析"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":42}}\n\ndata: [DONE]\n\n'), () => {});
    expect(result.choices[0].message).toEqual({ content: "饮食分析", reasoning_content: "思考" });
    expect(result.usage.prompt_tokens).toBe(42);
  });
  it("rejects an interrupted answer instead of saving partial text", async () => {
    await expect(readAIStream(response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'), () => {})).rejects.toThrow("before completion");
  });
  it("identifies reasoning exhaustion so the adapter can request a visible answer", async () => {
    await expect(readAIStream(response('data: {"choices":[{"delta":{"reasoning_content":"thinking"},"finish_reason":"length"}]}\n\n'), () => {})).rejects.toThrow("reasoning only");
  });
  it("rejects a token-budget cutoff", async () => {
    await expect(readAIStream(response('data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}\n\n'), () => {})).rejects.toThrow("token budget");
  });
});

it("publishes readable progress before the response completes", async () => {
 let feed!: ReadableStreamDefaultController<Uint8Array>;
 const stream = new ReadableStream<Uint8Array>({start(controller){feed=controller;}});
 const onProgress = vi.fn();
 const result = readAIStream(new Response(stream),()=>{},onProgress);
 feed.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"第一段"}}]}\n\n'));
 await vi.waitFor(()=>expect(onProgress).toHaveBeenCalledWith({content:"第一段",reasoning:""}));
 feed.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"第二段"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));feed.close();
 expect((await result).choices[0].message.content).toBe("第一段第二段");
});

it("assembles streamed tool calls by index and announces their names early", async () => {
  const onProgress = vi.fn();
  const result = await readAIStream(response(
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"search_entries","arguments":"{\\"qu"}}]}}]}\n\n'
    + 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ery\\":\\"午饭\\"}"}},{"index":1,"id":"call_2","function":{"name":"overdue_tasks","arguments":"{}"}}]}}]}\n\n'
    + 'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n',
  ), () => {}, onProgress);
  expect(onProgress.mock.calls[0][0].toolCalls).toEqual([{ name: "search_entries", arguments: '{"qu' }]);
  expect(result.choices[0].message.tool_calls).toEqual([
    { id: "call_1", type: "function", function: { name: "search_entries", arguments: '{"query":"午饭"}' } },
    { id: "call_2", type: "function", function: { name: "overdue_tasks", arguments: "{}" } },
  ]);
  expect(result.choices[0].message.content).toBe("");
});
