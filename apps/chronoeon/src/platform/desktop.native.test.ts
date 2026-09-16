// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ maximized: false, min: vi.fn(), toggle: vi.fn(), restored: { x: 120, y: 80, width: 1240, height: 800 }, bounds: { x: 120, y: 80, width: 1240, height: 800 } }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ isMaximized: async () => native.maximized,
  setMinSize: native.min, toggleMaximize: native.toggle }) }));
beforeEach(() => {
  vi.clearAllMocks(); window.__TAURI_INTERNALS__ = {};
  native.maximized = false; native.bounds = { x: 120, y: 80, width: 1240, height: 800 };
  native.min.mockImplementation(async () => { native.maximized = false; }); // Tao's set_inner_size side effect.
  native.toggle.mockImplementation(async () => {
    if (native.maximized) { native.bounds = { ...native.restored }; native.maximized = false; }
    else { native.restored = { ...native.bounds }; native.bounds = { x: 0, y: 0, width: 1920, height: 1080 }; native.maximized = true; }
  });
});
describe("native maximize and titlebar minimum size", () => {
  it("does not undo the first maximize on ResizeObserver, and retains restored bounds", async () => {
    const { setDesktopMinimumWidth, performDesktopWindowAction } = await import("./desktop");
    await setDesktopMinimumWidth(366.3);
    const before = { ...native.bounds };
    await expect(performDesktopWindowAction("toggle-maximize")).resolves.toBe(true);
    await Promise.all([setDesktopMinimumWidth(366.3), setDesktopMinimumWidth(366.7)]);
    expect(native.min).toHaveBeenCalledTimes(1); expect(native.maximized).toBe(true);
    await expect(performDesktopWindowAction("toggle-maximize")).resolves.toBe(false);
    expect(native.bounds).toEqual(before); expect(native.min).toHaveBeenCalledTimes(1);
  });
  it("defers changed constraints until restore, without calling setSize or setPosition", async () => {
    const { setDesktopMinimumWidth, performDesktopWindowAction } = await import("./desktop");
    await setDesktopMinimumWidth(360); await performDesktopWindowAction("toggle-maximize");
    await setDesktopMinimumWidth(450); expect(native.min).toHaveBeenCalledTimes(1);
    expect(native.maximized).toBe(true);
    await performDesktopWindowAction("toggle-maximize");
    expect(native.min).toHaveBeenCalledTimes(2);
    expect(native.min).toHaveBeenLastCalledWith(expect.objectContaining({ width: 450, height: 540 }));
    expect(native.bounds).toEqual({ x: 120, y: 80, width: 1240, height: 800 });
  });
  it("coalesces concurrent identical minimum requests before the native resize returns", async () => {
    const { setDesktopMinimumWidth } = await import("./desktop");
    await Promise.all([setDesktopMinimumWidth(400), setDesktopMinimumWidth(400), setDesktopMinimumWidth(400)]);
    expect(native.min).toHaveBeenCalledTimes(1);
  });
});
