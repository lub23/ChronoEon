import { describe, expect, it } from "vitest";
import { createDefaultSettings } from "@chronoeon/domain";
import { parseMarkdownDocuments, parseMarkdownV2Blocks, previewStableIdMigration, serializeEntry, serializeEntryV2 } from "./markdown";

/** A ledger catalog with the legacy group this fixture writes. */
const billSettings = createDefaultSettings();
billSettings.bill.categories = [{ id: "food", name: "饮食", color: "#8f4b2e", direction: "expense", sub: ["正餐"] }];
billSettings.bill.defaultCategoryId = "food";
billSettings.bill.defaultSubCategoryId = "正餐";

const weeklyFixture = `# Week 30, 2026-07-20 (Mon) - 2026-07-26 (Sun)

## 2026-07-20
### Entries
- [ ] #task Prepare notes [allDay:: true] [created:: 2026-07-18 00:28] [category:: work]

## 2026-07-24
- #event Build prototype [begin:: 2026-07-24 05:00] [end:: 2026-07-25 07:00] [location:: Studio] [category:: learning] [images:: Diary/attachments/example.png]
- #bill Lunch [begin:: 2026-07-24 12:10] [amount:: -18.3] [payment:: Alipay] [description:: delivery] [category:: 饮食/正餐] [vendor:: sample]

## 2026-07-25
- [x] #task Test reminder [begin:: 2026-07-25 07:00] [end:: 2026-07-25 08:00] [done:: 2026-07-22 17:40] [reminder:: at-time] [priority:: highest] [category:: work]`;

describe("shared Markdown V1 bridge", () => {
  it("reads task/event/bill records from weekly headings", () => {
    const entries = parseMarkdownDocuments([{ path: "Diary/2026/07/2026-W30.md", content: weeklyFixture }], { settings: billSettings });
    expect(entries).toHaveLength(4);
    expect(entries[0]).toMatchObject({
      kind: "task",
      date: "2026-07-20",
      allDay: true,
      status: "open",
      category: "work"
    });
    expect(entries[1]).toMatchObject({
      kind: "event",
      date: "2026-07-24",
      start: "05:00",
      end: "07:00",
      endDate: "2026-07-25",
      images: ["Diary/attachments/example.png"]
    });
    expect(entries[2]).toMatchObject({
      kind: "bill",
      amount: -18.3,
      currency: "CNY",
      payment: "Alipay",
      category: "饮食/正餐",
      color: "#8f4b2e"
    });
    expect(entries[3]).toMatchObject({ status: "done", reminder: "at-time", priority: "high" });
  });

  it("does not rewrite a parsed legacy line during an explicit preserve round trip", () => {
    const source = "- #event Review [begin: 2026-07-25 14:00] [custom:: keep me]";
    const [entry] = parseMarkdownDocuments([{ path: "2026-07-25.md", content: source }]);
    expect(entry.id).toMatch(/^legacy-/);
    expect(entry.markdown?.persistedId).toBe(false);
    expect(serializeEntry(entry, { preserveSource: true })).toBe(source);
  });

  it("previews stable IDs without changing the original V1 formatting", () => {
    const source = "- #event Review [begin: 2026-07-25 14:00] [custom:: keep me]";
    const [preview] = previewStableIdMigration([{ path: "2026-07-25.md", content: source }]);
    expect(preview.before).toBe(source);
    expect(preview.reason).toBe("missing");
    expect(preview.after).toBe(`- #event Review [id:: ${preview.proposedId}] [begin: 2026-07-25 14:00] [custom:: keep me]`);
    expect(previewStableIdMigration([{ path: "2026-07-25.md", content: source }])[0].proposedId).toBe(preview.proposedId);
  });

  it("serializes a stable ID and reparses canonical fields", () => {
    const [legacy] = parseMarkdownDocuments([{ path: "2026-07-25.md", content: "- #bill Coffee [begin:: 2026-07-25 09:10] [amount:: -25] [payment:: WeChat] [category:: 饮食/饮品]" }]);
    const canonical = serializeEntry({ ...legacy, id: "018f47a2-6f89-7cc4-bf69-7f1703db0123", markdown: undefined });
    expect(canonical).toContain("#bill Coffee [id:: 018f47a2-6f89-7cc4-bf69-7f1703db0123]");
    const [roundTripped] = parseMarkdownDocuments([{ path: "2026-07-25.md", content: canonical }]);
    expect(roundTripped).toMatchObject({ amount: -25, payment: "WeChat", category: "饮食/饮品" });
    expect(roundTripped.markdown?.persistedId).toBe(true);
  });

  it("round-trips recurring occurrence exceptions and moves in the legacy-compatible fields", () => {
    const source = "- [ ] #task Daily review [id:: 018f47a2-6f89-4cc4-bf69-7f1703db0123] [begin:: 2026-07-20 09:00] [recurring:: daily] [recurrenceExceptions:: 2026-07-21=done@2026-07-21T18:00] [recurrenceMoves:: 2026-07-22=2026-07-23T14:00~2026-07-23T15:00]";
    const [entry] = parseMarkdownDocuments([{ path: "2026-07-20.md", content: source }]);
    expect(entry.recurrenceExceptions?.["2026-07-21"]).toEqual({
      status: "done",
      doneAt: "2026-07-21 18:00",
      cancelledAt: undefined,
    });
    expect(entry.recurrenceMoves?.["2026-07-22"]).toEqual({
      begin: "2026-07-23 14:00",
      end: "2026-07-23 15:00",
    });
    const canonical = serializeEntry({ ...entry, markdown: undefined });
    expect(canonical).toContain("[recurrenceExceptions:: 2026-07-21=done@2026-07-21T18:00]");
    expect(canonical).toContain("[recurrenceMoves:: 2026-07-22=2026-07-23T14:00~2026-07-23T15:00]");
  });

  it("accepts #blink as a read alias and writes #idea", () => {
    const [idea] = parseMarkdownDocuments([{ path: "Ideas.md", content: "- #blink Calm review [created:: 2026-07-25 20:30]" }]);
    expect(idea).toMatchObject({ kind: "idea", date: "2026-07-25", start: "20:30", allDay: false });
    const canonical = serializeEntry({ ...idea, markdown: undefined });
    expect(canonical).toContain("#idea Calm review");
    expect(canonical).toContain("[begin:: 2026-07-25 20:30]");
  });

  it("drops priority metadata for ideas", () => {
    const [idea] = parseMarkdownDocuments([{
      path: "Ideas.md",
      content: "- #idea Quiet review [created:: 2026-07-25 20:30] [priority:: high] [urgency:: low]",
    }]);
    expect(idea).toMatchObject({ kind: "idea", priority: undefined, urgency: undefined });
    const canonical = serializeEntry({ ...idea, markdown: undefined });
    expect(canonical).not.toContain("[priority::");
    expect(canonical).not.toContain("[urgency::");
  });

  it("round-trips Markdown V2 long-form idea notes without re-parsing body list items", () => {
    const source = serializeEntryV2({
      id: "018f47a2-6f89-7cc4-bf69-7f1703db0123",
      kind: "idea",
      title: "A longer thought",
      date: "2026-07-25",
      allDay: true,
      category: "personal",
      color: "#708b7b",
      note: "First paragraph.\n\n- #task This stays body text.",
      createdAt: "2026-07-25T20:30:00.000Z"
    });
    const documents = [{ path: "Ideas/2026-07-25.md", content: source }];
    const entries = parseMarkdownDocuments(documents);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "idea", title: "A longer thought", note: "First paragraph.\n\n- #task This stays body text." });
    expect(parseMarkdownV2Blocks(documents)).toHaveLength(1);
    expect(serializeEntry(entries[0], { preserveSource: true })).toBe(source);
  });
});
