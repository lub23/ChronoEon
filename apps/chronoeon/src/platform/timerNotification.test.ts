// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTimerSession } from "@chronoeon/domain";
import { TIMER_NOTIFICATION_ID, timerNotificationFor, notifyTimer } from "./timerNotification";

const notices = vi.hoisted(() => ({ mobile: false, permission: vi.fn(), show: vi.fn(), dismiss: vi.fn() }));
vi.mock("../hooks/useTouchDevice", () => ({ isMobilePlatform: () => notices.mobile }));
vi.mock("./notifications", () => ({ requestNotificationPermission: notices.permission, showSystemNotification: notices.show, dismissSystemNotification: notices.dismiss }));
beforeEach(() => { notices.mobile = false; notices.permission.mockReset().mockResolvedValue("granted"); notices.show.mockReset().mockResolvedValue(true); notices.dismiss.mockReset().mockResolvedValue(undefined); });
const startedAt = new Date(2026, 8, 9, 9, 30, 0).getTime();
const session = createTimerSession({ title: "阅读", calendarId: "default", category: "study", location: "图书馆" }, startedAt);

describe("timerNotificationFor", () => {
  it("announces a start as an ongoing card with category, place and start time", () => {
    expect(timerNotificationFor("start", session, 0, "zh", "学习")).toEqual({
      id: TIMER_NOTIFICATION_ID,
      title: "计时中 · 阅读",
      body: "学习 · 图书馆 · 开始于 09:30",
      ongoing: true,
      autoCancel: false,
    });
  });

  it("reports elapsed time on pause and resume", () => {
    expect(timerNotificationFor("pause", session, 65_000, "zh", "学习")).toMatchObject({ title: "已暂停 · 阅读", body: "学习 · 图书馆 · 已计 1:05", ongoing: true });
    expect(timerNotificationFor("resume", session, 65_000, "en", "Study")).toMatchObject({ title: "Recording · 阅读", body: "Study · 图书馆 · Elapsed 1:05" });
  });

  it("closes with a dismissable summary and clears on cancel", () => {
    expect(timerNotificationFor("stop", session, 300_000, "zh", "学习")).toEqual({
      id: TIMER_NOTIFICATION_ID,
      title: "已记录 5:00 · 阅读",
      body: "学习 · 图书馆",
      ongoing: false,
      autoCancel: true,
    });
    expect(timerNotificationFor("cancel", session, 1, "zh", "学习")).toBeNull();
  });

  it("omits empty facts", () => {
    const bare = createTimerSession({ title: "x", calendarId: "default" }, startedAt);
    expect(timerNotificationFor("start", bare, 0, "en", "")?.body).toBe("started 09:30");
  });
});


describe("timer notification delivery", () => {
  it("does not resurrect an ongoing card after a late permission response", async () => {
    notices.mobile = true;
    let allow!: (value: string) => void;
    notices.permission.mockReturnValue(new Promise<string>((resolve) => { allow = resolve; }));
    const timer = createTimerSession({ title: "late", calendarId: "default" }, startedAt + 1);
    const start = notifyTimer("start", timer, 0, "zh", "");
    await Promise.resolve();
    const stop = notifyTimer("stop", timer, 1000, "zh", "");
    allow("granted"); await Promise.all([start, stop]);
    expect(notices.show).not.toHaveBeenCalled();
    expect(notices.dismiss).toHaveBeenCalledWith(TIMER_NOTIFICATION_ID);
  });
  it("clears on mobile stop without sending a new completion card", async () => {
    notices.mobile = true;
    const timer = createTimerSession({ title: "mobile", calendarId: "default" }, startedAt + 2);
    await notifyTimer("start", timer, 0, "en", "");
    notices.show.mockClear();
    await notifyTimer("stop", timer, 1000, "en", "");
    expect(notices.show).not.toHaveBeenCalled(); expect(notices.dismiss).toHaveBeenCalledTimes(1);
  });
  it("asks once per recording and still sends the desktop completion toast", async () => {
    const timer = createTimerSession({ title: "desktop", calendarId: "default" }, startedAt + 3);
    await notifyTimer("start", timer, 0, "en", "");
    await notifyTimer("start", timer, 0, "en", "");
    expect(notices.permission).toHaveBeenCalledTimes(1);
    await notifyTimer("stop", timer, 1000, "en", "");
    expect(notices.show).toHaveBeenLastCalledWith(expect.objectContaining({ ongoing: false }));
    await notifyTimer("start", { ...timer, id: "new-recording" }, 0, "en", "");
    expect(notices.permission).toHaveBeenCalledTimes(2);
  });
});
