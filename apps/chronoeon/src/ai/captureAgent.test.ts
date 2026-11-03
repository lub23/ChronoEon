import { describe, expect, it, vi } from "vitest";
import { createDefaultSettings, type Entry } from "@chronoeon/domain";
import { captureExamples, parseAICapture } from "./captureAgent";
import { requestAICompletion } from "./provider";
vi.mock("./provider", () => ({ requestAICompletion: vi.fn() }));
const record = (title: string): Entry => ({ id: title, title, kind: "bill", category: "food", date: "2026-10-26", allDay: true, color: "#2877B5", createdAt: "2026-10-26T00:00:00Z", amount: -40 });
describe("AI capture", () => {
  it("bounds and deduplicates representative habits without copying financial facts", () => {
    const examples = captureExamples([record("coffee"), record("coffee"), ...Array.from({length: 30}, (_,i) => record(`meal ${i}`))], "coffee");
    // Ten query-matched examples are enough once the habit profile carries the
    // global picture; the first one is the closest match.
    expect(examples).toHaveLength(10); expect(examples[0].title).toBe("coffee");
    expect(examples[0]).not.toHaveProperty("amount"); expect(examples[0]).not.toHaveProperty("date");
  });
  it("tells the model what the user usually records and how to read 'now'", async () => {
    const settings = createDefaultSettings();
    vi.mocked(requestAICompletion).mockResolvedValue({ content: JSON.stringify({entries:[{ kind:"event",title:"午饭",date:"2026-10-26",allDay:false,start:"12:15",end:"12:30",endDate:null,category:"" }]}) });
    const lunch = (date: string): Entry => ({ id: date, title: "午饭", kind: "event", category: "food", location: "双清园", date, start: "12:00", end: "12:40", color: "#2877B5", createdAt: `${date}T04:00:00Z` });
    const entries = ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"].map(lunch);
    await parseAICapture({ provider: { id:"test",name:"Test",preset:"compatible",kind:"openai-compatible",baseUrl:"https://example.test/v1",model:"test" }, text:"现在到十二点半 午饭",images:[],entries,settings,locale:"zh",signal:new AbortController().signal });
    const system = String(vi.mocked(requestAICompletion).mock.calls.at(-1)![1][0].content);
    expect(system).toContain("午饭 → 事件/food · 12:00+40min · @双清园 (×6)");
    expect(system).toContain('"现在"/"now" means the current clock time');
    expect(system).toContain("Habits are defaults for fields the text leaves open");
  });
  it("sends image-only input and preliminary fields through the active provider with schema validation", async () => {
    const settings = createDefaultSettings();
    vi.mocked(requestAICompletion).mockResolvedValue({ content: JSON.stringify({entries:[{ kind:"bill",title:"Coffee",date:"2026-10-26",allDay:true,category:settings.calendars[0].billCategories[0].id,amount:-40,tags:["coffee","breakfast"] }]}) });
    const image = { type: "image_url" as const, image_url: { url: "data:image/png;base64,test" } };
    const result = await parseAICapture({ provider: { id:"test",name:"Test",preset:"compatible",kind:"openai-compatible",baseUrl:"https://example.test/v1",model:"test" }, text:"",images:[image],entries:[],settings,locale:"zh",signal:new AbortController().signal });
    expect(result.parsed.candidates[0].draft.title).toBe("Coffee");
    expect(result.parsed.candidates[0].draft.tags).toBeUndefined();
    const call = vi.mocked(requestAICompletion).mock.calls.at(-1)!;
    expect(call[1][1].content).toContainEqual(image); expect(call[2]).toHaveProperty("properties.entries");
    expect(call[4]).toMatchObject({ disableReasoning: true, stream: true, maxTokens: 4096 });
  });
  it("rejects empty model results so they cannot become an empty saved review", async () => {
    vi.mocked(requestAICompletion).mockResolvedValue({ content: '{"entries":[]}' });
    await expect(parseAICapture({ provider: { id:"test",name:"Test",preset:"compatible",kind:"openai-compatible",baseUrl:"https://example.test/v1",model:"test" }, text:"test",images:[],entries:[],settings:createDefaultSettings(),locale:"en",signal:new AbortController().signal })).rejects.toThrow("empty message");
  });
});
