import { describe, expect, it } from "vitest";
import { performDesktopWindowAction, startDesktopResize } from "./desktop";

describe("desktop platform bridge", () => {
  it("keeps native-only frameless window actions inert in browser tests", async () => {
    await expect(performDesktopWindowAction("minimize")).resolves.toBe(false);
    await expect(performDesktopWindowAction("toggle-maximize")).resolves.toBe(false);
    await expect(startDesktopResize("SouthEast")).resolves.toBeUndefined();
  });
});
