import type { CaptureCompletion, Locale } from "@chronoeon/domain";
import { t } from "../i18n";

export interface CaptureSyntaxGroup { title: string; items: Array<{ insert: string; label: string }> }

/** The quick-syntax cheatsheet shared by the chat composer and the quick window. */
export function captureSyntaxGroups(locale: Locale): CaptureSyntaxGroup[] {
  const zh = locale === "zh";
  return [
    { title: t("captureSyntaxKinds", locale), items: [
      { insert: "/task ", label: t("task", locale) }, { insert: "/event ", label: t("event", locale) },
      { insert: "/bill ", label: t("bill", locale) }, { insert: "/idea ", label: t("idea", locale) },
      { insert: "/asset ", label: t("items", locale) },
    ] },
    { title: t("captureSyntaxFields", locale), items: [
      { insert: "@", label: t("location", locale) }, { insert: zh ? "@定位 " : "@pos ", label: t("captureLocateToken", locale) }, { insert: "#", label: t("tags", locale) },
      { insert: "%", label: t("category", locale) }, { insert: "&", label: t("captureSyntaxLink", locale) },
      { insert: zh ? "!高 " : "!high ", label: t("priority", locale) }, { insert: zh ? "!!高 " : "!!high ", label: t("urgency", locale) },
    ] },
    { title: t("captureSyntaxMarks", locale), items: [
      { insert: zh ? "^完成 " : "^done ", label: t("captureSyntaxStatus", locale) },
      { insert: zh ? "^进行中 " : "^doing ", label: t("statusInProgress", locale) },
      { insert: zh ? "*每周一 " : "*mon ", label: t("recurrence", locale) },
      { insert: zh ? "*每天 " : "*daily ", label: t("recurrenceDaily", locale) },
      { insert: "~15m ", label: t("reminder", locale) },
      { insert: "~1d ", label: zh ? "提前一天提醒" : "Remind a day before" },
    ] },
    { title: t("captureSyntaxTime", locale), items: [
      { insert: zh ? "现在到12:30 " : "now until 12:30 ", label: zh ? "从现在到某时刻" : "From now until" },
      { insert: zh ? "明天下午3点 " : "tomorrow 3pm ", label: zh ? "相对日期" : "Relative date" },
      { insert: zh ? "下周三 10:00-11:30 " : "next Wednesday 10:00-11:30 ", label: zh ? "时间范围" : "Time range" },
      { insert: zh ? "半小时 " : "30 minutes ", label: zh ? "时长" : "Duration" },
    ] },
    { title: t("captureSyntaxMoney", locale), items: [
      { insert: zh ? "午饭 ￥38.5 " : "Lunch $12.9 ", label: zh ? "货币符号 + 金额" : "Currency sign + amount" },
      { insert: zh ? "咖啡 28元 微信 " : "Coffee 4.5 cash ", label: zh ? "金额 + 支付方式" : "Amount + payment" },
      { insert: zh ? "工资 +12000 " : "Salary +3000 ", label: zh ? "收入用 +" : "Income with +" },
    ] },
  ];
}

/** Completion lists for the `^ * ~` tokens; values are what the parser accepts. */
export function captureTokenCompletions(locale: Locale): { statuses: CaptureCompletion[]; recurrences: CaptureCompletion[]; reminders: CaptureCompletion[] } {
  const zh = locale === "zh";
  return {
    statuses: [
      { value: zh ? "待办" : "todo", label: t("statusOpen", locale) },
      { value: zh ? "进行中" : "doing", label: t("statusInProgress", locale) },
      { value: zh ? "完成" : "done", label: t("statusDone", locale) },
      { value: zh ? "取消" : "cancel", label: t("statusCancelled", locale) },
    ],
    recurrences: [
      { value: zh ? "每天" : "daily", label: t("recurrenceDaily", locale) },
      { value: zh ? "每周" : "weekly", label: t("recurrenceWeekly", locale) },
      { value: zh ? "工作日" : "weekdays", label: zh ? "每个工作日" : "Weekdays" },
      { value: zh ? "每月" : "monthly", label: t("recurrenceMonthly", locale) },
      { value: zh ? "每年" : "yearly", label: t("recurrenceYearly", locale) },
    ],
    reminders: [
      { value: zh ? "准时" : "now", label: zh ? "准时提醒" : "At the time" },
      { value: "5m", label: zh ? "提前 5 分钟" : "5 minutes before" },
      { value: "15m", label: zh ? "提前 15 分钟" : "15 minutes before" },
      { value: "30m", label: zh ? "提前 30 分钟" : "30 minutes before" },
      { value: "1h", label: zh ? "提前 1 小时" : "1 hour before" },
      { value: "1d", label: zh ? "提前 1 天" : "1 day before" },
      { value: "1w", label: zh ? "提前 1 周" : "1 week before" },
    ],
  };
}

/** The regex fragment matching a token being typed at the caret. */
export const CAPTURE_COMPLETION_PATTERN = /(?:^|\s)[/@#%&^*~]([^\s]*)$/;
/** `@定位` / `@pos`: ask the device where we are instead of typing a place. */
export const CAPTURE_LOCATE_TOKEN = /^(?:定位|位置|pos|gps|here)$/i;
