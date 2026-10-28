import { describe, expect, it, vi } from "vitest";
import { createDefaultSettings, type Entry } from "@chronoeon/domain";
import { captureExamples, parseAICapture } from "./captureAgent";
import { requestAICompletion } from "./provider";
vi.mock("./provider", () => ({ requestAICompletion: vi.fn() }));
const record = (title: string): Entry => ({ id: title, title, kind: "bill", category: "food", date: "2026-10-26", allDay: true, color: "#2877B5", createdAt: "2026-10-26T00:00:00Z", amount: -40 });
describe("AI capture", () => {
  it("bounds and deduplicates representative habits without copying financial facts", () => {
    const examples = captureExamples([record("coffee"), record("coffee"), ...Array.from({length: 30}, (_,i) => record(`meal ${i}`))], "coffee");
    expect(examples).toHaveLength(16); expect(examples[0].title).toBe("coffee");
    expect(examples[0]).not.toHaveProperty("amount"); expect(examples[0]).not.toHaveProperty("date");
  });
  it("sends image-only input and preliminary fields through the active provider with schema validation", async () => {
    const settings = createDefaultSettings();
    vi.mocked(requestAICompletion).mockResolvedValue({ content: JSON.stringify({entries:[{ kind:"bill",title:"Coffee",date:"2026-10-26",allDay:true,category:settings.calendars[0].billCategories[0].id,amount:-40,tags:["coffee","breakfast"] }]}) });
    const image = { type: "image_url" as const, image_url: { url: "data:image/png;base64,test" } };
    const result = await parseAICapture({ provider: { id:"test",name:"Test",preset:"compatible",kind:"openai-compatible",baseUrl:"https://example.test/v1",model:"test" }, text:"",images:[image],entries:[],settings,locale:"zh",signal:new AbortController().signal });
    expect(result.parsed.candidates[0].draft.title).toBe("Coffee");
    expect(result.parsed.candidates[0].draft.tags).toEqual(["coffee"]);
    const call = vi.mocked(requestAICompletion).mock.calls.at(-1)!;
    expect(call[1][1].content).toContainEqual(image); expect(call[2]).toHaveProperty("properties.entries");
    expect(call[4]).toMatchObject({ disableReasoning: true, stream: true, maxTokens: 4096 });
  });
  it("rejects empty model results so they cannot become an empty saved review", async () => {
    vi.mocked(requestAICompletion).mockResolvedValue({ content: '{"entries":[]}' });
    await expect(parseAICapture({ provider: { id:"test",name:"Test",preset:"compatible",kind:"openai-compatible",baseUrl:"https://example.test/v1",model:"test" }, text:"test",images:[],entries:[],settings:createDefaultSettings(),locale:"en",signal:new AbortController().signal })).rejects.toThrow("empty message");
  });
});
