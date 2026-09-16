// @vitest-environment jsdom
import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEntryId, type Entry } from "@chronoeon/domain";
import { SqliteEntryStore } from "@chronoeon/storage";
import { MemorySqliteBackend } from "@chronoeon/storage/test";
import { useSqliteEntries } from "./useSqliteEntries";

let root: Root;
let host: HTMLDivElement;

function entry(title: string): Entry {
  return {
    id: createEntryId(),
    kind: "task",
    title,
    date: "2026-08-10",
    allDay: true,
    category: "work",
    calendar: "default",
    color: "#77787b",
    createdAt: new Date().toISOString(),
  };
}

function Probe({ store, onEntries }: { store: SqliteEntryStore | null; onEntries: (entries: Entry[], revisions: ReadonlyMap<string, string>) => void }) {
  const { entries, revisions } = useSqliteEntries(store);
  onEntries(entries, revisions);
  return <output>{entries.length}</output>;
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("sqlite-backed entry cache", () => {
  it("loads the store at boot and follows create/update/delete events", async () => {
    const backend = await MemorySqliteBackend.open([]);
    const store = await SqliteEntryStore.create(backend);
    const first = entry("Boot entry");
    await store.create(first);

    const snapshots: Array<{ entries: Entry[]; revisions: ReadonlyMap<string, string> }> = [];
    const capture = (entries: Entry[], revisions: ReadonlyMap<string, string>) => {
      snapshots.push({ entries, revisions });
    };
    await act(async () => {
      root.render(<StrictMode><Probe store={store} onEntries={capture} /></StrictMode>);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.textContent).toBe("1");

    // Create through the store → event drives the cache.
    const second = entry("Event entry");
    await act(async () => {
      await store.create(second);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.textContent).toBe("2");

    // Update flows through and records the fresh revision.
    await act(async () => {
      await store.update({ ...second, title: "Renamed" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const latest = snapshots[snapshots.length - 1];
    expect(latest.entries.find((value) => value.id === second.id)?.title).toBe("Renamed");
    expect(latest.revisions.get(second.id)).toBeTruthy();

    // Delete removes the row and its revision.
    await act(async () => {
      await store.delete(second.id);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.textContent).toBe("1");
    expect(snapshots[snapshots.length - 1].revisions.has(second.id)).toBe(false);

    await backend.close();
  });

  it("stays empty without a store (browser demo)", async () => {
    await act(async () => {
      root.render(<StrictMode><Probe store={null} onEntries={() => undefined} /></StrictMode>);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.textContent).toBe("0");
  });
});
