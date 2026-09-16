import { describe, expect, it } from "vitest";
import { previewVaultMigration } from "../seed/previewVaultMigration";
import { seedVaultToStore } from "../seed/seed";
import { openMemoryStore } from "./helpers";

const documents = [
  {
    path: "Diary/2026/07/2026-07-06.md",
    content: `# 2026-07-06

## Entries
- [ ] #task Legacy task [allDay:: true] [category:: work] [priority:: highest] [vendor:: sample]
- #event Stable [id:: 00000000-0000-4000-8000-00000000dead] [begin:: 2026-07-06 05:00] [category:: learning] [images:: Diary/attachments/a.png]
- #bill Lunch [begin:: 2026-07-06 12:10] [amount:: -18.3] [category:: 饮食/正餐] [urgency:: lowest]`,
  },
];

const options = {
  documents,
  vaultRoot: "Diary",
  attachmentsRoot: "C:/data/attachments",
};

describe("vault migration preview", () => {
  it("shows the exact ids, narrowing and unknown-field notes the seeder will apply", async () => {
    const preview = await previewVaultMigration(options);
    expect(preview.entries).toHaveLength(3);
    expect(preview.counts).toEqual({ task: 1, event: 1, bill: 1, idea: 0 });

    const legacy = preview.entries.find((item) => item.entry.title === "Legacy task")!;
    expect(legacy.sourceId).toMatch(/^legacy-/);
    expect(legacy.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(legacy.notes.map((note) => note.kind)).toEqual(["new-id", "priority-narrowed", "unknown-fields"]);
    expect(legacy.notes.find((note) => note.kind === "priority-narrowed")?.detail).toBe("highest → high");
    expect(legacy.notes.find((note) => note.kind === "unknown-fields")?.detail).toBe("vendor");
    expect(legacy.entry.priority).toBe("high");

    const stable = preview.entries.find((item) => item.entry.title === "Stable")!;
    expect(stable.id).toBe("00000000-0000-4000-8000-00000000dead");
    expect(stable.notes).toEqual([]);
    expect(stable.attachments).toHaveLength(1);
    expect(stable.attachments[0].source).toBe("Diary/attachments/a.png");
    expect(stable.attachments[0].destination).toMatch(/^C:\/data\/attachments\/[0-9a-f-]+\.png$/);

    const bill = preview.entries.find((item) => item.entry.title === "Lunch")!;
    expect(bill.notes.map((note) => note.kind)).toEqual(["new-id", "urgency-narrowed"]);
    expect(bill.entry.urgency).toBe("low");
  });

  it("keeps distinct ids for same-title entries that differ in amount/note, and for byte-identical duplicates", async () => {
    const collisionVault = [
      {
        path: "Diary/2026/07/2026-07-06.md",
        content: `# 2026-07-06

## Entries
- #bill 交通 [begin:: 2026-07-06 00:00] [amount:: -19] [category:: 交通]
- #bill 交通 [begin:: 2026-07-06 00:00] [amount:: -26.7] [category:: 交通]
- #bill 交通 [begin:: 2026-07-06 00:00] [amount:: -19] [category:: 交通]
- #bill 交通 [begin:: 2026-07-06 00:00] [amount:: -19] [category:: 交通]`,
      },
    ];
    const first = await previewVaultMigration({ documents: collisionVault, vaultRoot: "Diary", attachmentsRoot: "C:/data/attachments" });
    const ids = first.entries.map((item) => item.id);
    expect(new Set(ids).size).toBe(4);

    const second = await previewVaultMigration({ documents: collisionVault, vaultRoot: "Diary", attachmentsRoot: "C:/data/attachments" });
    expect(second.entries.map((item) => item.id)).toEqual(ids);
  });

  it("is deterministic across runs and matches exactly what the seeder persists", async () => {
    const first = await previewVaultMigration(options);
    const second = await previewVaultMigration(options);
    expect(first.entries.map((item) => item.id)).toEqual(second.entries.map((item) => item.id));
    expect(first.entries.flatMap((item) => item.attachments.map((attachment) => attachment.destination)))
      .toEqual(second.entries.flatMap((item) => item.attachments.map((attachment) => attachment.destination)));

    const { backend, store } = await openMemoryStore();
    const copied: string[] = [];
    await seedVaultToStore(store, {
      ...options,
      attachmentCopier: {
        async copy(source, destination) {
          copied.push(destination);
          return source === "Diary/attachments/a.png" ? 42 : null;
        },
      },
      mode: "merge",
    });
    const attachmentRows = await backend.select<{ local_path: string }>("SELECT source_path AS local_path FROM attachment_ingest_queue");
    expect(attachmentRows.map((row) => row.local_path).sort()).toEqual(copied.sort());
    expect(copied.sort()).toEqual(
      first.entries.flatMap((item) => item.attachments.map((attachment) => attachment.destination)).sort(),
    );
  });
});
