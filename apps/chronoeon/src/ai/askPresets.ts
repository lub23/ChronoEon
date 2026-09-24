import { t, type MessageKey } from "../i18n";
import type { Locale } from "../domain/entry";
import { addIsoDays, isIsoDate, type EntryKind, type StatsRange } from "@chronoeon/domain";
import type { AdvisorTool } from "./advisorAgent";

/**
 * Canned analyses for Ask. Every preset names the published method it borrows —
 * GTD weekly review, time-blocking, the Eisenhower matrix, 50/30/20,
 * fixed-vs-variable cost review, sleep regularity, the Harvard Healthy Eating
 * Plate, a CBT thought record, PERMA — and asks the model to show the numbers
 * before it interprets them, so the answer is checkable instead of generic.
 */
export interface AskPreset {
  id: AskPresetId;
  group: "schedule" | "money" | "wellbeing";
  label: string;
  hint: string;
  prompt: string;
}

export type AskPresetId =
  | "weeklyReview" | "focusTime" | "triage"
  | "balance502030" | "recurringCost" | "spendingDrift"
  | "sleepRhythm" | "dietPattern" | "thoughtRecord" | "permaReview";

export interface AskPresetToolPlan {
  id: AskPresetId;
  calls: Array<{ tool: AdvisorTool; arguments: Record<string, unknown> }>;
}

const presetIds: Array<{ id: AskPresetId; group: AskPreset["group"]; title: MessageKey; hint: MessageKey; prompt: MessageKey }> = [
  { id: "weeklyReview", group: "schedule", title: "askPresetWeeklyReviewTitle", hint: "askPresetWeeklyReviewHint", prompt: "askPresetWeeklyReviewPrompt" },
  { id: "focusTime", group: "schedule", title: "askPresetFocusTimeTitle", hint: "askPresetFocusTimeHint", prompt: "askPresetFocusTimePrompt" },
  { id: "triage", group: "schedule", title: "askPresetTriageTitle", hint: "askPresetTriageHint", prompt: "askPresetTriagePrompt" },
  { id: "balance502030", group: "money", title: "askPresetBalanceTitle", hint: "askPresetBalanceHint", prompt: "askPresetBalancePrompt" },
  { id: "recurringCost", group: "money", title: "askPresetRecurringTitle", hint: "askPresetRecurringHint", prompt: "askPresetRecurringPrompt" },
  { id: "spendingDrift", group: "money", title: "askPresetSpendingDriftTitle", hint: "askPresetSpendingDriftHint", prompt: "askPresetSpendingDriftPrompt" },
  { id: "sleepRhythm", group: "wellbeing", title: "askPresetSleepTitle", hint: "askPresetSleepHint", prompt: "askPresetSleepPrompt" },
  { id: "dietPattern", group: "wellbeing", title: "askPresetDietTitle", hint: "askPresetDietHint", prompt: "askPresetDietPrompt" },
  { id: "thoughtRecord", group: "wellbeing", title: "askPresetThoughtRecordTitle", hint: "askPresetThoughtRecordHint", prompt: "askPresetThoughtRecordPrompt" },
  { id: "permaReview", group: "wellbeing", title: "askPresetPermaTitle", hint: "askPresetPermaHint", prompt: "askPresetPermaPrompt" },
];

export function askPresets(locale: Locale): AskPreset[] {
  return presetIds.map(({ id, group, title, hint, prompt }) => ({
    id,
    group,
    label: t(title, locale),
    hint: t(hint, locale),
    prompt: t(prompt, locale),
  }));
}

function lastDays(today: string, days: number): StatsRange {
  return { start: addIsoDays(today, -(days - 1)), end: today };
}

/** Fixed methods get a deterministic retrieval plan; open questions still let
 *  the model select tools. This keeps preset answers stable across models. */
export function askPresetToolPlan(text: string, locale: Locale, today: string): AskPresetToolPlan | null {
  const preset = askPresets(locale).find((candidate) => text.includes(candidate.prompt));
  if (!preset || !isIsoDate(today)) return null;

  const search = (range: StatsRange, kinds?: EntryKind[], query?: string) => ({
    tool: "search_entries" as AdvisorTool,
    arguments: {
      ...(query ? { query } : {}),
      start_date: range.start,
      end_date: range.end,
      ...(kinds ? { kinds } : {}),
    },
  });
  const spending = (range: StatsRange) => ({
    tool: "spending_summary" as AdvisorTool,
    arguments: { start_date: range.start, end_date: range.end },
  });

  const plans: Record<AskPresetId, AskPresetToolPlan["calls"]> = {
    weeklyReview: [search(lastDays(today, 7)), { tool: "overdue_tasks", arguments: {} }, { tool: "upcoming_tasks", arguments: {} }],
    focusTime: [search(lastDays(today, 14), ["event"])],
    triage: [{ tool: "overdue_tasks", arguments: {} }, { tool: "upcoming_tasks", arguments: {} }],
    balance502030: [spending(lastDays(today, 30))],
    recurringCost: [spending(lastDays(today, 60)), search(lastDays(today, 60), ["bill"])],
    spendingDrift: [
      spending(lastDays(today, 30)),
      spending({ start: addIsoDays(today, -59), end: addIsoDays(today, -30) }),
    ],
    sleepRhythm: [search(lastDays(today, 14), ["event"], "sleep bedtime wake 睡觉 入睡 起床 睡眠 熬夜")],
    dietPattern: [search(lastDays(today, 14), ["event"], "breakfast lunch dinner snack supper 早餐 午餐 晚餐 下午茶 夜宵")],
    thoughtRecord: [search(lastDays(today, 30), ["idea"])],
    permaReview: [search(lastDays(today, 14))],
  };

  return { id: preset.id, calls: plans[preset.id] };
}
