import { describe, expect, it } from "vitest";
import { seedVaultToStore } from "../seed/seed";
import { openMemoryStore } from "./helpers";

const documents = [
  {
    path: "Diary/2026/07/2026-07-06.md",
    content: `# 2026-07-06

## Entries
- #event With photos [begin:: 2026-07-06 08:00] [category:: life] [images:: Diary/attachments/a.png, Diary/attachments/b.jpg]
- #event Dangling [begin:: 2026-07-06 09:00] [category:: life] [images:: Diary/attachments/gone.png]`,
  },
];

describe("seed", () => {
  it("copies existing vault images into local slots and marks missing ones", async () => {
    const { backend, store } = await openMemoryStore();
    const copies: Array<{ source: string; destination: string }> = [];
    const copier = {
      async copy(source: string, destination: string): Promise<number | null> {
        if (source === "Diary/attachments/gone.png") return null;
        copies.push({ source, destination });
        return 42;
      },
    };
    const result = await seedVaultToStore(store, {
      documents, vaultRoot: "Diary", attachmentsRoot: "C:/data/attachments", attachmentCopier: copier,
    });
    expect(result.importedEntries).toBe(2);
    expect(result.attachmentRows).toBe(3);
    expect(result.missingAttachments).toBe(1);

    const rows = await backend.select<{ local_path: string; bytes: number; file_missing: number }>(
      "SELECT q.source_path AS local_path, a.bytes, a.file_missing FROM attachments a JOIN attachment_ingest_queue q ON q.attachment_id=a.id ORDER BY a.sort, a.id"
    );
    expect(rows).toHaveLength(3);
    expect(rows.filter((row) => row.file_missing === 1)).toHaveLength(3);
    expect(rows.filter((row) => row.bytes === 42)).toHaveLength(2);
    for (const row of rows) {
      expect(row.local_path).toMatch(/^C:\/data\/attachments\/[0-9a-f-]+\.[a-z0-9]{1,8}$/);
    }
    expect(copies).toHaveLength(2);

    // The stored entry exposes its local attachment paths via images.
    const stored = await store.list();
    const withPhotos = stored.find((entry) => entry.title === "With photos");
    expect(withPhotos?.images).toHaveLength(2);
    expect(withPhotos?.images?.[0]).toMatch(/^attachments\/missing-/);
  });

  it("a copier that throws is treated as missing, not fatal", async () => {
    const { store } = await openMemoryStore();
    const copier = {
      async copy(): Promise<number | null> {
        throw new Error("io failure");
      },
    };
    const result = await seedVaultToStore(store, {
      documents, vaultRoot: "Diary", attachmentsRoot: "C:/data/attachments", attachmentCopier: copier,
    });
    expect(result.missingAttachments).toBe(3);
    expect(result.importedEntries).toBe(2);
  });

  it("mints stable ids for legacy-derived entries without touching the vault", async () => {
    const { store } = await openMemoryStore();
    const copier = { async copy(): Promise<number | null> { return null; } };
    await seedVaultToStore(store, { documents, vaultRoot: "Diary", attachmentsRoot: "C:/data/attachments", attachmentCopier: copier });
    const stored = await store.list();
    for (const entry of stored) {
      expect(entry.id).not.toMatch(/^legacy-/);
      expect(entry.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    }
    // The source documents themselves are untouched (the importer never rewrites them).
    expect(documents[0].content).toContain("[images:: Diary/attachments/a.png");
  });

  it("keeps a persisted stable id when the Markdown already carries one", async () => {
    const { store } = await openMemoryStore();
    const withId = [
      {
        path: "Diary/2026/07/2026-07-06.md",
        content: `# 2026-07-06

## Entries
- #event Stable [id:: 00000000-0000-4000-8000-00000000dead] [begin:: 2026-07-06 08:00] [category:: life]`,
      },
    ];
    const copier = { async copy(): Promise<number | null> { return null; } };
    await seedVaultToStore(store, { documents: withId, vaultRoot: "Diary", attachmentsRoot: "C:/data/attachments", attachmentCopier: copier });
    const stored = await store.list();
    expect(stored[0].id).toBe("00000000-0000-4000-8000-00000000dead");
  });

  it("merge mode upserts existing ids and adds new ones, ignoring the mismatch guard", async () => {
    const { backend, store } = await openMemoryStore();
    const copier = { async copy(): Promise<number | null> { return null; } };
    const firstVault = [{
      path: "Diary/a.md",
      content: `# 2026-07-06

## Entries
- #event Stable [id:: 00000000-0000-4000-8000-00000000dead] [begin:: 2026-07-06 08:00] [category:: life]`,
    }];
    await seedVaultToStore(store, { documents: firstVault, vaultRoot: "VaultA", attachmentsRoot: "C:/data/attachments", attachmentCopier: copier });

    // A different vault, same stable id with changed fields + one new entry.
    const secondVault = [{
      path: "Diary/b.md",
      content: `# 2026-07-06

## Entries
- #event Renamed [id:: 00000000-0000-4000-8000-00000000dead] [begin:: 2026-07-06 09:30] [category:: work]
- #task Extra [begin:: 2026-07-06 10:00] [category:: life]`,
    }];
    const result = await seedVaultToStore(store, {
      documents: secondVault, vaultRoot: "VaultB", attachmentsRoot: "C:/data/attachments", attachmentCopier: copier, mode: "merge",
    });
    expect(result.skipped).toBe(false);
    expect(result.importedEntries).toBe(2);

    const stored = await store.list();
    expect(stored).toHaveLength(2);
    const renamed = stored.find((entry) => entry.id === "00000000-0000-4000-8000-00000000dead");
    expect(renamed).toMatchObject({ title: "Renamed", start: "09:30", category: "work" });
    expect(stored.find((entry) => entry.title === "Extra")).toBeTruthy();

    // The import fingerprint now records VaultB.
    expect((await store.getSeedMeta()).importId).toBe(result.importId);

    // Re-merging the same vault again still imports (merge has no skip guard)
    // and replaces tags/attachments without duplicating child rows.
    const again = await seedVaultToStore(store, {
      documents: secondVault, vaultRoot: "VaultB", attachmentsRoot: "C:/data/attachments", attachmentCopier: copier, mode: "merge",
    });
    expect(again.skipped).toBe(false);
    expect(await store.list()).toHaveLength(2);
    const tags = await backend.select("SELECT * FROM entry_tags");
    expect(tags).toHaveLength(0);
  });

  it("initial mode still refuses a different vault after the first seed", async () => {
    const { store } = await openMemoryStore();
    const copier = { async copy(): Promise<number | null> { return null; } };
    await seedVaultToStore(store, { documents, vaultRoot: "VaultA", attachmentsRoot: "C:/data/attachments", attachmentCopier: copier });
    await expect(seedVaultToStore(store, {
      documents, vaultRoot: "VaultB", attachmentsRoot: "C:/data/attachments", attachmentCopier: copier,
    })).rejects.toMatchObject({ code: "ImportSourceMismatch" });
  });
});
