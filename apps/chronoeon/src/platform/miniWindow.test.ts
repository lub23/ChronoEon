// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { clampGeometryToMonitor, readMiniGeometry, rememberMiniGeometry } from "./miniWindow";

beforeEach(() => {
  window.localStorage.clear();
});

describe("mini window geometry memory", () => {
  it("round-trips a geometry for the current screen", async () => {
    await rememberMiniGeometry({ x: 40, y: 60, width: 420, height: 680 });
    await expect(readMiniGeometry()).resolves.toEqual({ x: 40, y: 60, width: 420, height: 680 });
  });

  it("keeps a fully-visible geometry unchanged", () => {
    const monitor = { x: 0, y: 0, width: 1920, height: 1080 };
    const geometry = { x: 100, y: 80, width: 420, height: 680 };
    expect(clampGeometryToMonitor(geometry, monitor)).toEqual(geometry);
  });

  it("pulls an off-screen window back onto its monitor", () => {
    const monitor = { x: 1920, y: 0, width: 1920, height: 1080 };
    expect(clampGeometryToMonitor({ x: 5000, y: -400, width: 420, height: 680 }, monitor))
      .toEqual({ x: 1920 + 1920 - 420, y: 0, width: 420, height: 680 });
  });

  it("shrinks a remembered window larger than the desktop", () => {
    const monitor = { x: 0, y: 0, width: 1366, height: 768 };
    expect(clampGeometryToMonitor({ x: 0, y: 0, width: 2000, height: 1200 }, monitor))
      .toEqual({ x: 0, y: 0, width: 1366, height: 768 });
  });
});
