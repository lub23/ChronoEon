import { describe, expect, it } from "vitest";
import { createDefaultSettings } from "@chronoeon/domain";
import { parseMarkdownDocuments, serializeEntry } from "@chronoeon/markdown";
import { exportEntriesCsv, exportSettingsJson, importSettingsBundleJson, importSettingsJson, parseCsvRows, parseEntriesCsv } from "./dataTransfer";

const entry = {
  id: "4b903092-c1a5-4f7f-8397-953ff69345d1",
  kind: "idea" as const,
  title: "A comma, a quote \" and a newline\nkept",
  titleZh: "一则灵感",
  date: "2026-07-26",
  allDay: true,
  category: "general",
  color: "#90d7ec",
  note: "Long-form thought\nwith two lines",
  tags: ["one", "two"],
  images: ["Diary/attachments/example.png"],
  recurrence: "none" as const,
  reminder: "none" as const,
  createdAt: "2026-07-26T08:00:00.000Z",
  source: "local" as const,
};

describe("entry and settings transfer", () => {
  it("parses quoted CSV fields including embedded newlines", () => {
    expect(parseCsvRows('title,description\n"Hello, world","line 1\nline 2"\n')).toEqual([
      ["title", "description"],
      ["Hello, world", "line 1\nline 2"],
    ]);
  });

  it("round-trips standalone entry fields and stable IDs", () => {
    const parsed = parseEntriesCsv(exportEntriesCsv([entry]));
    expect(parsed.errors).toEqual([]);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]).toMatchObject({
      id: entry.id,
      kind: "idea",
      title: entry.title,
      titleZh: entry.titleZh,
      color: entry.color,
      note: entry.note,
      tags: entry.tags,
      images: entry.images,
    });
  });

  it("rejects impossible dates and ignores comments without losing the active header", () => {
    const csv = [
      "modality,title,begin",
      "# exported by another calendar",
      "task,Impossible,2026-02-31",
      "task,Valid,2026-02-28",
    ].join("\n");
    const parsed = parseEntriesCsv(csv);
    expect(parsed.entries.map((value) => value.title)).toEqual(["Valid"]);
    expect(parsed.errors[0]).toContain("invalid date");
  });

  it("imports the stable two-section CSV format", () => {
    const csv = [
      "# ENTRIES",
      "modality,title,begin,end,allDay,done,cancelled,category,created",
      'task,"Legacy task","2026-07-27 09:30","2026-07-27 10:00",false,false,false,work,"2026-07-26 08:00"',
      "# BILLS",
      "title,begin,amount,currency,payment,category",
      'Lunch,2026-07-27,-28.5,CNY,Alipay,"饮食/正餐"',
    ].join("\n");
    const parsed = parseEntriesCsv(csv);
    expect(parsed.errors).toEqual([]);
    expect(parsed.byKind).toMatchObject({ task: 1, bill: 1 });
    expect(parsed.entries[0]).toMatchObject({ kind: "task", date: "2026-07-27", start: "09:30", status: "open" });
    expect(parsed.entries[1]).toMatchObject({ kind: "bill", amount: -28.5, currency: "CNY" });
    const markdown = `# 2026-07-27\n\n## Entries\n${serializeEntry(parsed.entries[0])}\n`;
    expect(parseMarkdownDocuments([{ path: "ChronoEon/2026-07-27.md", content: markdown }])[0]).toMatchObject({
      id: parsed.entries[0].id,
      kind: "task",
      title: "Legacy task",
    });
  });

  it("normalizes raw legacy settings and does not retain secret fields", () => {
    const imported = importSettingsJson(JSON.stringify({ format: "chronoeon-settings", version: 1, settings: {
      language: "zh",
      firstDay: 0,
      timeScale: 15,
      currency: "USD",
      paymentMethods: ["Cash", "Card"],
      remoteLLMApiKey: "must-not-survive",
    } }));
    expect(imported).toMatchObject({ language: "zh", firstDay: 0, timeScale: 15, bill: { currency: "USD", paymentMethods: ["Cash", "Card"] } });
    expect(JSON.stringify(imported)).not.toContain("must-not-survive");

    const exported = exportSettingsJson(createDefaultSettings(), { theme: "dark", dayPhotos: false });
    const envelope = JSON.parse(exported) as { format: string; settings: unknown };
    expect(envelope.format).toBe("chronoeon-settings");
    expect(importSettingsJson(JSON.stringify(envelope))).toMatchObject({ settingsVersion: 1 });
    expect(importSettingsBundleJson(exported).preferences).toEqual({ theme: "dark", dayPhotos: false });
  });
});


describe("strict settings envelopes", () => {
  it("does not import retired plugin/raw settings formats", () => {
    expect(() => importSettingsJson(JSON.stringify({ firstDay: 0, apiKey: "secret" }))).toThrow("Unsupported settings format");
  });
  it("does not export unknown preferences or credentials", () => {
    const json = exportSettingsJson(createDefaultSettings(), { theme: "dark", gitToken: "secret", apiKey: "secret", webdavPassword: "secret" } as never);
    expect(json).not.toContain("secret");
    expect(json).not.toContain("gitToken");
  });
});
