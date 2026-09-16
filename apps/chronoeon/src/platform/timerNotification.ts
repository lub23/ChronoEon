import { formatTimerDuration, type Locale, type TimerSession } from "@chronoeon/domain";
import { t } from "../i18n";
import { backgroundTimingSupported, syncBackgroundTimer } from "./background";
import { isMobilePlatform } from "../hooks/useTouchDevice";
import { dismissSystemNotification, requestNotificationPermission, showSystemNotification, type SystemNotification } from "./notifications";

/** One fixed id so every state change replaces the previous card. */
export const TIMER_NOTIFICATION_ID = 4711;

export type TimerNotificationEvent = "start" | "pause" | "resume" | "stop" | "cancel";

function clock(epochMs: number): string {
  const date = new Date(epochMs);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * Pure builder: what the OS card should say for one timer event. `null` means
 * the event only clears the card. Kept separate from delivery so it is testable
 * without a platform.
 */
export function timerNotificationFor(
  event: TimerNotificationEvent,
  session: TimerSession,
  elapsedMs: number,
  locale: Locale,
  categoryLabel: string,
): SystemNotification | null {
  const title = session.title.trim();
  const facts = [categoryLabel, session.location?.trim()].filter(Boolean) as string[];
  switch (event) {
    case "start":
      return {
        id: TIMER_NOTIFICATION_ID,
        title: t("timerNotifyRunning", locale).replace("{title}", title),
        body: [...facts, t("timerNotifyStartedAt", locale).replace("{time}", clock(session.createdAt))].join(" · "),
        ongoing: true,
        autoCancel: false,
      };
    case "pause":
      return {
        id: TIMER_NOTIFICATION_ID,
        title: t("timerNotifyPaused", locale).replace("{title}", title),
        body: [...facts, `${t("timerNotifyElapsed", locale)} ${formatTimerDuration(elapsedMs)}`].join(" · "),
        ongoing: true,
        autoCancel: false,
      };
    case "resume":
      return {
        id: TIMER_NOTIFICATION_ID,
        title: t("timerNotifyRunning", locale).replace("{title}", title),
        body: [...facts, `${t("timerNotifyElapsed", locale)} ${formatTimerDuration(elapsedMs)}`].join(" · "),
        ongoing: true,
        autoCancel: false,
      };
    case "stop":
      return {
        id: TIMER_NOTIFICATION_ID,
        title: t("timerNotifyDone", locale).replace("{duration}", formatTimerDuration(elapsedMs)).replace("{title}", title),
        body: facts.join(" · "),
        ongoing: false,
        autoCancel: true,
      };
    case "cancel":
      return null;
  }
}

let permissionFor: { sessionId: string; result: ReturnType<typeof requestNotificationPermission> } | null = null;
let delivery: Promise<void> = Promise.resolve();
let revision = 0;

/** Order native calls so a late permission dialog/start can never resurrect a
 * card after stop. Only explicit starts ask permission, once per session. */
export function notifyTimer(
  event: TimerNotificationEvent,
  session: TimerSession,
  elapsedMs: number,
  locale: Locale,
  categoryLabel: string,
): Promise<void> {
  if (backgroundTimingSupported()) {
    const version = ++revision;
    // The service owns the only ongoing card. Permission is still requested
    // only by an explicit start; a delayed grant cannot restart a stopped timer.
    if (event !== "start") return Promise.resolve();
    if (permissionFor?.sessionId !== session.id) permissionFor = { sessionId: session.id, result: requestNotificationPermission() };
    return permissionFor.result.then(async () => { if (version === revision) await syncBackgroundTimer(); });
  }
  const mobile = isMobilePlatform();
  if ((event === "pause" || event === "resume") && !mobile) return Promise.resolve();
  const version = ++revision;
  if (event === "start" && permissionFor?.sessionId !== session.id) {
    permissionFor = { sessionId: session.id, result: requestNotificationPermission() };
  }
  const permission = event === "start" ? permissionFor?.result : undefined;
  const next = delivery.then(async () => {
    if (version !== revision) return;
    if (permission && await permission !== "granted") return;
    if (version !== revision) return;
    if (event === "stop" || event === "cancel") {
      await dismissSystemNotification(TIMER_NOTIFICATION_ID);
      if (event === "cancel" || mobile) return;
    }
    const card = timerNotificationFor(event, session, elapsedMs, locale, categoryLabel);
    if (card) await showSystemNotification(card);
  });
  delivery = next.catch(() => undefined);
  return next;
}
