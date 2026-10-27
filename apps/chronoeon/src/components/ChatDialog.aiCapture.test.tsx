// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDefaultSettings } from "@chronoeon/domain";
import { ChatDialog } from "./ChatDialog";
import { createMemoryConversationStore } from "../ai/memoryConversationStore";
import { DEFAULT_AI_PROVIDER_PREFERENCES, requestAICompletion } from "../ai/provider";
const photo = "attachments/" + "a".repeat(64) + ".webp";
vi.mock("../platform/attachments", () => ({
  attachmentModelImage: vi.fn(async () => "data:image/png;base64,test"), releaseAttachment: vi.fn(), storeAttachmentFile: vi.fn(),
  pickEntryAttachments: vi.fn(async () => ({ picked: [{ reference: photo, name: "test.png", thumb: "data:image/png;base64,test", displayUrl: "data:image/png;base64,test" }], skipped: [] })),
}));
vi.mock("../ai/provider", async importOriginal => ({ ...await importOriginal<object>(), requestAICompletion: vi.fn() }));
let host: HTMLDivElement, root: Root;
const settings = createDefaultSettings();
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.mocked(requestAICompletion).mockReset().mockResolvedValue({ content: JSON.stringify({entries:[{kind:"bill",title:"Coffee",date:"2026-10-26",allDay:true,category:settings.calendars[0].billCategories.find(c => c.direction === "expense")!.id,amount:-40,payment:"微信支付",note:"Receipt"}]}) });
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
async function render() {
  const save = vi.fn(async () => true);
  act(() => root.render(<ChatDialog locale="zh" entries={[]} settings={settings} conversations={createMemoryConversationStore()} aiPreferences={{...DEFAULT_AI_PROVIDER_PREFERENCES,providers:[{id:"test",name:"Test",preset:"compatible",kind:"openai-compatible",baseUrl:"https://example.test/v1",model:"test"}],activeProviderId:"test"}} onOpenEntry={vi.fn()} onConfirmCapture={save} onOpenManualCapture={vi.fn()} onOpenSettings={vi.fn()} onClose={vi.fn()} />));
  await flush(); return save;
}
it("sends an image without text to AI, keeps the image, and requires confirmation", async () => {
  const save = await render();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="添加图片"]')!.click()); await flush();
  expect(host.querySelector<HTMLButtonElement>(".chat-send")!.disabled).toBe(false);
  await act(async () => host.querySelector<HTMLButtonElement>(".chat-send")!.click()); await flush();
  expect(requestAICompletion).toHaveBeenCalledOnce();
  expect(vi.mocked(requestAICompletion).mock.calls[0][1][1].content).toContainEqual({type:"image_url",image_url:{url:"data:image/png;base64,test"}});
  expect(host.textContent).toContain("Coffee"); expect(save).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLButtonElement>(".capture-review-confirm")!.click());
  expect(save).toHaveBeenCalledWith([expect.objectContaining({title:"Coffee",amount:-40,images:[photo]})]);
});
it("keeps text parsing local and sends the original plus preliminary drafts only on AI refinement", async () => {
  const save = await render(); const input = host.querySelector<HTMLTextAreaElement>("textarea")!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(input,"午饭 -32"); input.dispatchEvent(new Event("input",{bubbles:true})); });
  await act(async () => host.querySelector<HTMLButtonElement>(".chat-send")!.click()); await flush();
  expect(requestAICompletion).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLButtonElement>(".capture-ai-optimize")!.click()); await flush();
  expect(requestAICompletion).toHaveBeenCalledOnce();
  const messages = vi.mocked(requestAICompletion).mock.calls[0][1];
  expect(messages[0].content).toContain("Preliminary drafts to correct");
  expect(JSON.stringify(messages[1].content)).toContain("午饭 -32"); expect(save).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLInputElement>('[aria-label="标题"]')!.value).toBe("Coffee");
});
