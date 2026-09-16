// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { closeTimerWindow, listenTimerCommands, listenTimerState, openTimerWindow } from "./timerWindow";
const state = vi.hoisted(() => ({ exists: false, created: vi.fn(), close: vi.fn(), ready: null as null | (() => void), listen: vi.fn(), emit: vi.fn() }));
vi.mock("./desktop", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ WebviewWindow: class {
  static async getByLabel() { return state.exists ? { close: state.close } : null; }
  constructor(label: string, options: unknown) { state.created(label, options); }
  async once(event: string, handler: () => void) { if (event === "tauri://created") state.ready = () => { state.exists = true; handler(); }; return vi.fn(); }
} }));
vi.mock("@tauri-apps/api/window", () => ({ currentMonitor: async () => ({ scaleFactor: 2, position: { x: 0, y: 0 }, size: { width: 2560, height: 1600 } }) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: state.listen, emit: state.emit }));
beforeEach(() => {
  state.exists = false; state.ready = null; state.created.mockReset(); state.close.mockReset().mockImplementation(async () => { state.exists = false; });
  state.listen.mockReset(); state.emit.mockReset().mockResolvedValue(undefined);
});
describe("native timer bridge races", () => {
  it("coalesces concurrent opens and closes only after creation has completed", async () => {
    const first = openTimerWindow("zh"), second = openTimerWindow("zh"), close = closeTimerWindow();
    await vi.waitFor(() => expect(state.ready).not.toBeNull());
    expect(state.created).toHaveBeenCalledTimes(1); expect(state.close).not.toHaveBeenCalled();
    state.ready!(); await Promise.all([first, second, close]);
    expect(state.created).toHaveBeenCalledTimes(1); expect(state.close).toHaveBeenCalledTimes(1); expect(state.exists).toBe(false);
    expect(state.created.mock.calls[0][1]).toMatchObject({ title: "时元 · 计时", x: 936, y: 608, alwaysOnTop: true });
  });
  it("unsubscribes a partially registered command bridge on error", async () => {
    const unlisten = vi.fn(); state.listen.mockResolvedValueOnce(unlisten).mockRejectedValueOnce(new Error("denied"));
    await expect(listenTimerCommands(vi.fn())).rejects.toThrow("denied");
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
  it("unsubscribes state if the initial handshake fails", async () => {
    const unlisten = vi.fn(); state.listen.mockResolvedValueOnce(unlisten); state.emit.mockRejectedValueOnce(new Error("closed"));
    await expect(listenTimerState(vi.fn())).rejects.toThrow("closed"); expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
