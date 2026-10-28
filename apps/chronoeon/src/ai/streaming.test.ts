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
