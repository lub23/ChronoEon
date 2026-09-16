// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ android: vi.fn(() => true), invoke: vi.fn() }));
vi.mock("./desktop", () => ({ isAndroidTauri: native.android, isTauri: () => true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
import { readCurrentPlace, requestCoordinates } from "./location";
beforeEach(() => { vi.clearAllMocks(); native.android.mockReturnValue(true); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("native device location", () => {
  it("uses native street/POI geocoding and never inserts raw coordinates", async () => {
    native.invoke.mockResolvedValueOnce({ latitude: 39.99, longitude: 116.32 }).mockResolvedValueOnce({ province: "北京市", city: "北京市", locality: "海淀区", country: "中国", address: "北京市海淀区清华园 1 号" });
    expect((await readCurrentPlace("zh"))?.label).toBe("北京市海淀区清华园 1 号");
    expect(native.invoke).toHaveBeenLastCalledWith("device_reverse_geocode", { latitude: 39.99, longitude: 116.32, language: "zh" });
    native.invoke.mockResolvedValueOnce({ latitude: 39.99, longitude: 116.32 }).mockRejectedValueOnce(new Error("geocoder-unavailable"));
    expect(await readCurrentPlace("zh")).toBeNull();
  });
  it("uses the bounded native command, never Android WebView geolocation", async () => {
    const browser = vi.fn(); vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: browser } });
    native.invoke.mockResolvedValue({ latitude: 31.2, longitude: 121.5 });
    expect(await requestCoordinates(12000)).toEqual({ latitude: 31.2, longitude: 121.5 });
    expect(native.invoke).toHaveBeenCalledWith("device_location", { timeoutMs: 12000 });
    expect(browser).not.toHaveBeenCalled();
  });
  it.each(["location-permission-denied", "location-disabled", "location-timeout"])("treats %s as a normal result", async (error) => {
    native.invoke.mockRejectedValue(new Error(error));
    expect(await requestCoordinates()).toBeNull();
  });
  it("rejects invalid coordinates", async () => {
    native.invoke.mockResolvedValue({ latitude: NaN, longitude: 181 });
    expect(await requestCoordinates()).toBeNull();
  });
  it("catches synchronous browser permission errors", async () => {
    native.android.mockReturnValue(false);
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: () => { throw new Error("SecurityError"); } } });
    expect(await requestCoordinates()).toBeNull();
  });
});
