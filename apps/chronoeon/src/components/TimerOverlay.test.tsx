// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTimerSession, pauseTimerSession } from "@chronoeon/domain";
import { TimerOverlay } from "./TimerOverlay";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("TimerOverlay", () => {
  it("renders the broadcast session and forwards commands", () => {
    const onCommand = vi.fn();
    const session = createTimerSession({ title: "阅读", calendarId: "default", category: "study", location: "图书馆" }, Date.now() - 65_000);
    act(() => { root.render(<TimerOverlay locale="zh" initialSession={session} onCommand={onCommand} />); });
    expect(host.querySelector(".timer-overlay-title")?.textContent).toBe("阅读");
    expect(host.querySelector(".timer-overlay-meta")?.textContent).toContain("图书馆");
    expect(host.querySelector(".timer-overlay-clock")?.textContent).toBe("1:05");
    expect(host.querySelector(".timer-overlay")?.classList.contains("is-running")).toBe(true);
    act(() => { host.querySelector<HTMLButtonElement>('[aria-label="暂停"]')!.click(); });
    act(() => { host.querySelector<HTMLButtonElement>('[aria-label="结束并保存"]')!.click(); });
    act(() => { host.querySelector<HTMLButtonElement>('.timer-overlay-close')!.click(); });
    expect(onCommand.mock.calls.map(([command]) => command)).toEqual(["pause", "stop", "hide"]);
  });

  it("offers resume while paused", () => {
    const started = Date.now() - 10_000;
    const session = pauseTimerSession(createTimerSession({ title: "x", calendarId: "default" }, started), started + 4_000);
    act(() => { root.render(<TimerOverlay locale="en" initialSession={session} />); });
    expect(host.querySelector('[aria-label="Resume"]')).not.toBeNull();
    expect(host.querySelector(".timer-overlay-clock")?.textContent).toBe("0:04");
  });
});
