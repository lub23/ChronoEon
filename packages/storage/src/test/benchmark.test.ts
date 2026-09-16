import { describe, expect, it } from "vitest";
import { createEntryId, type Entry } from "@chronoeon/domain";
import { seedVaultToStore } from "../seed/seed";
import { openMemoryStore } from "./helpers";

const ENTRY_COUNT = 50_000;
const RANGE_QUERY_BUDGET_MS = 200;

function isoDay(dayIndex: number): string {
  const date = new Date(Date.UTC(2026, 0, 1 + dayIndex));
  return date.toISOString().slice(0, 10);
}

function generateDocuments(): Array<{ path: string; content: string }> {
  const documents: Array<{ path: string; content: string }> = [];
  let dayIndex = 0;
  for (let month = 0; month < 24; month += 1) {
    for (let week = 0; week < 4; week += 1) {
      const lines: string[] = [`# Week block ${month}-${week}`, "", "## Entries"];
      for (let entry = 0; entry < Math.ceil(ENTRY_COUNT / (24 * 4)); entry += 1) {
        dayIndex += 1;
        const day = isoDay(dayIndex % 700);
        lines.push(`- #task Task ${dayIndex} [begin:: ${day} 09:00] [end:: ${day} 09:30] [category:: work] [tags:: bulk]`);
      }
      documents.push({ path: `Diary/2026/week-${month}-${week}.md`, content: lines.join("\n") });
    }
  }
  return documents;
}

/** A 50,000-entry benchmark corpus. */
function generateEntries(): Entry[] {
  const entries: Entry[] = [];
  for (let index = 0; index < ENTRY_COUNT; index += 1) {
    entries.push({
      id: createEntryId(),
      kind: "task",
      title: `Task ${index}`,
      date: isoDay(index % 700),
      start: "09:00",
      end: "09:30",
      category: "work",
      calendar: "default",
      color: "#77787b",
      tags: ["bulk"],
      createdAt: new Date().toISOString(),
    });
  }
  return entries;
}

describe("benchmark", () => {
  it(`seeds ${ENTRY_COUNT} entries and range-queries a month within ${RANGE_QUERY_BUDGET_MS}ms`, async () => {
    // Parse+insert path (same shape as a real vault seed).
    const { store } = await openMemoryStore();
    const seedStarted = performance.now();
    const documents = generateDocuments();
    const copier = { async copy(): Promise<number | null> { return null; } };
    const result = await seedVaultToStore(store, {
      documents, vaultRoot: "Diary", attachmentsRoot: "C:/data/attachments", attachmentCopier: copier,
    });
    const seedElapsedMs = performance.now() - seedStarted;
    // eslint-disable-next-line no-console
    console.log(`[benchmark] seed ${result.importedEntries} entries in ${seedElapsedMs.toFixed(0)}ms`);

    const rangeStarted = performance.now();
    const month = await store.list({ from: "2026-06-01", to: "2026-06-30" });
    const rangeElapsedMs = performance.now() - rangeStarted;
    // eslint-disable-next-line no-console
    console.log(`[benchmark] month range query returned ${month.length} rows in ${rangeElapsedMs.toFixed(1)}ms`);
    expect(month.length).toBeGreaterThan(0);
    expect(rangeElapsedMs).toBeLessThanOrEqual(RANGE_QUERY_BUDGET_MS);

    const searchStarted = performance.now();
    const search = await store.list({ search: "Task 1234" });
    const searchElapsedMs = performance.now() - searchStarted;
    // eslint-disable-next-line no-console
    console.log(`[benchmark] search returned ${search.length} rows in ${searchElapsedMs.toFixed(1)}ms`);

    // Direct bulk-insert fast path on a second store (no Markdown parsing).
    const { store: directStore } = await openMemoryStore();
    const directStarted = performance.now();
    await directStore.bulkSeed({
      entries: generateEntries(),
      attachments: [],
      meta: { importId: `benchmark-direct-${Date.now()}`, importedAt: new Date().toISOString() },
    });
    const directElapsedMs = performance.now() - directStarted;
    // eslint-disable-next-line no-console
    console.log(`[benchmark] direct bulkSeed ${ENTRY_COUNT} entries in ${directElapsedMs.toFixed(0)}ms`);
  }, 120_000);
});
