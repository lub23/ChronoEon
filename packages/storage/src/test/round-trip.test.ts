import { describe, expect, it } from "vitest";
import type { Entry } from "@chronoeon/domain";
import { parseMarkdownDocuments } from "@chronoeon/markdown";
import { seedVaultToStore } from "../seed/seed";
import { openMemoryStore } from "./helpers";

const vaultRoot = "Diary";

// Three months, three weeks and two bill-heavy files, mirroring the parser's
// fixture shape; one line carries the legacy fine-grained priority literal.
const documents = [
  {
    path: "Diary/2026/07/2026-07-06.md",
    content: `# 2026-07-06

## Entries
- [ ] #task Prepare notes [allDay:: true] [created:: 2026-07-05 08:00] [category:: work] [priority:: highest]
- #event Build prototype [begin:: 2026-07-06 05:00] [end:: 2026-07-07 07:00] [location:: Studio] [category:: learning] [images:: Diary/attachments/example.png] [tags:: dev, focus]
- #bill Lunch [begin:: 2026-07-06 12:10] [amount:: -18.3] [payment:: Alipay] [description:: delivery] [category:: 饮食/正餐]
- #bill Train [begin:: 2026-07-06 08:00] [amount:: -4.5] [category:: 出行/交通]`,
  },
  {
    path: "Diary/2026/07/2026-07-13.md",
    content: `# 2026-07-13

## Entries
- [ ] #task Weekly review [recurring:: weekly] [recurringDays:: 1] [recurringEnd:: 2026-12-31] [category:: work]
- [ ] #task Skipped occurrence [recurring:: weekly] [recurringExceptions:: 2026-07-20=done~2026-07-20 09:00] [category:: work]`,
  },
  {
    path: "Diary/2026/08/2026-08-03.md",
    content: `# 2026-08-03

## Entries
- #idea Vacation notes [created:: 2026-08-03 09:00] [category:: life]
- [x] #task Done early [done:: 2026-08-02 18:00] [category:: work]`,
  },
];

/** Compare the persisted entry with the parsed source, field by field.
 *  `id` differs for legacy-derived entries (the seed mints a fresh UUID and
 *  never writes back), and `images` map onto local attachment rows instead.
 *  Keys carrying `undefined` are stripped from both sides — the parser and the
 *  store differ in which optional keys they materialize. */
function definedFields(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined));
}

function assertRoundTripped(read: Entry, source: Entry): void {
  const { markdown: _markdown, filePath: _filePath, source: _source, images: _images, id: _id, ...expected } = source;
  const { images: _readImages, id: _readId, ...actual } = read;
  expect(definedFields(actual as unknown as Record<string, unknown>)).toEqual(definedFields(expected as unknown as Record<string, unknown>));
}

describe("round-trip", () => {
  it("parses fixtures, seeds SQLite and reads equal fields back", async () => {
    const { backend, store } = await openMemoryStore();
    const copier = {
      copies: [] as Array<{ source: string; destination: string }>,
      async copy(source: string, destination: string): Promise<number | null> {
        if (source === "Diary/attachments/example.png") {
          this.copies.push({ source, destination });
          return 1234;
        }
        return null;
      },
    };
    const result = await seedVaultToStore(store, {
      documents,
      vaultRoot,
      attachmentsRoot: "C:/data/attachments",
      attachmentCopier: copier,
    });
    expect(result.skipped).toBe(false);
    expect(result.importedEntries).toBe(8);
    expect(result.attachmentRows).toBe(1);
    expect(result.missingAttachments).toBe(0);

    const parsed = parseMarkdownDocuments(documents);
    expect(parsed).toHaveLength(8);
    const stored = await store.list();

    for (const source of parsed) {
      const read = stored.find((entry) => entry.title === source.title && entry.date === source.date);
      expect(read, `missing stored entry for ${source.title}`).toBeTruthy();
      assertRoundTripped(read!, source);
    }

    // The narrowed priority projection: legacy `highest` became `high`.
    const priorityRow = parsed.find((entry) => entry.title === "Prepare notes");
    expect(priorityRow?.priority).toBe("high");

    // The import source is kept only in the ingest queue until normalized.
    const attachmentRows = await backend.select<{ local_path: string; bytes: number; file_missing: number }>(
      "SELECT q.source_path AS local_path, a.bytes, a.file_missing FROM attachments a JOIN attachment_ingest_queue q ON q.attachment_id=a.id"
    );
    expect(attachmentRows).toHaveLength(1);
    expect(attachmentRows[0].local_path).toMatch(/^C:\/data\/attachments\/[0-9a-f-]+\.png$/);
    expect(attachmentRows[0].bytes).toBe(1234);
    expect(attachmentRows[0].file_missing).toBe(1);
    expect(copier.copies).toHaveLength(1);
    expect(copier.copies[0].source).toBe("Diary/attachments/example.png");
  });

  it("re-seeding the same vault is a no-op", async () => {
    const { store } = await openMemoryStore();
    const copier = { async copy(): Promise<number | null> { return null; } };
    const first = await seedVaultToStore(store, { documents, vaultRoot, attachmentsRoot: "C:/data/attachments", attachmentCopier: copier });
    expect(first.skipped).toBe(false);
    const second = await seedVaultToStore(store, { documents, vaultRoot, attachmentsRoot: "C:/data/attachments", attachmentCopier: copier });
    expect(second.skipped).toBe(true);
    expect((await store.list()).length).toBe(8);
  });

  it("refuses a different vault after the first seed", async () => {
    const { store } = await openMemoryStore();
    const copier = { async copy(): Promise<number | null> { return null; } };
    await seedVaultToStore(store, { documents, vaultRoot, attachmentsRoot: "C:/data/attachments", attachmentCopier: copier });
    const changed = documents.map((document, index) => index === 0
      ? { ...document, content: `${document.content}\n- #task Extra [category:: work]` }
      : document);
    await expect(seedVaultToStore(store, {
      documents: changed, vaultRoot, attachmentsRoot: "C:/data/attachments", attachmentCopier: copier,
    })).rejects.toMatchObject({ code: "ImportSourceMismatch" });
  });
});
