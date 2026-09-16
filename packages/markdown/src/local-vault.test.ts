import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMarkdownDocuments, type MarkdownDocument } from "./markdown";

const fixtureRoot = process.env.CHRONOEON_MARKDOWN_FIXTURE_ROOT;
const describeLocal = fixtureRoot ? describe : describe.skip;

async function markdownDocuments(root: string, directory = root): Promise<MarkdownDocument[]> {
  const documents: MarkdownDocument[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) documents.push(...await markdownDocuments(root, path));
    if (item.isFile() && item.name.toLowerCase().endsWith(".md")) {
      documents.push({ path: relative(root, path).replaceAll("\\", "/"), content: await readFile(path, "utf8") });
    }
  }
  return documents;
}

describeLocal("local weekly Diary compatibility", () => {
  it("parses the supplied 2026 fixture without copying it into the repository", async () => {
    if (!fixtureRoot) return;
    const entries = parseMarkdownDocuments(await markdownDocuments(fixtureRoot));
    const counts = Object.fromEntries(["task", "event", "bill", "idea"].map((kind) => [kind, entries.filter((entry) => entry.kind === kind).length]));
    const imageReferences = entries.flatMap((entry) => entry.images ?? []);
    const crossDayCount = entries.filter((entry) => entry.endDate && entry.endDate !== entry.date).length;
    console.info("local Diary entry counts", counts, { imageReferences: imageReferences.length, crossDayCount });
    expect(counts.bill).toBeGreaterThan(300);
    expect(counts.event).toBeGreaterThan(50);
    expect(counts.task).toBeGreaterThan(20);
    expect(entries.some((entry) => entry.kind === "bill" && Boolean(entry.payment))).toBe(true);
    expect(entries.some((entry) => entry.endDate && entry.endDate !== entry.date)).toBe(true);
  });
});
