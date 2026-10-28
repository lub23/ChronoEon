import { expect, it } from "vitest";
import { LocalPreferences } from "../LocalPreferences";
import { SyncStore } from "../sync/SyncStore";
import { openMemoryStore } from "./helpers";
it("shares local settings in SQLite without publishing credentials or changing records", async () => {
 const { backend, store } = await openMemoryStore();
 try {
  const local = new LocalPreferences(backend);
  const before = await store.list();
  await local.set("chronoeon.preference.syncConfig", JSON.stringify({webdavPassword: "local-secret"}));
  expect(await new LocalPreferences(backend).readAll()).toEqual({"chronoeon.preference.syncConfig": '{"webdavPassword":"local-secret"}'});
  expect(await store.list()).toEqual(before);
  expect(await new SyncStore(backend).snapshot("test-device")).not.toContain("local-secret");
 } finally { await backend.close(); }
});
