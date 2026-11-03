import type { EntryDraft, EntryKind, EntryStatus, Recurrence, Reminder } from "../entry";
import { consumeMatch, remainingText, type CaptureText } from "./text";
import { captureMatchPositions } from "./match";
export { captureMatchPositions } from "./match";

export interface CaptureIssue { field: string; value: string; code: "unknown" | "conflict" | "unsupported"; }
export interface ExplicitCapture {
  fields: Partial<EntryDraft>;
  category?: string;
  link?: string;
  issues: CaptureIssue[];
}
export const CAPTURE_COMMANDS = ["/task", "/event", "/bill", "/idea", "/asset"] as const;
/** Inline token prefixes: `/kind @place #tag %category &link !priority !!urgency ^status *repeat ~reminder`. */
export const CAPTURE_TOKEN_PREFIXES = ["/", "@", "#", "%", "&", "!", "^", "*", "~"] as const;
const kinds: Record<string, EntryKind> = { task: "task", todo: "task", 待办: "task", 任务: "task", event: "event", 日程: "event", bill: "bill", expense: "bill", 账目: "bill", 记账: "bill", idea: "idea", 灵感: "idea" };

const STATUS_WORDS: Record<string, EntryStatus> = {
  open: "open", todo: "open", 待办: "open", 未完成: "open", 未做: "open",
  "in-progress": "in-progress", doing: "in-progress", progress: "in-progress", wip: "in-progress", 进行中: "in-progress", 进行: "in-progress", 在做: "in-progress",
  done: "done", finished: "done", 完成: "done", 已完成: "done", 做完: "done",
  cancelled: "cancelled", canceled: "cancelled", cancel: "cancelled", 取消: "cancelled", 已取消: "cancelled",
};
const WEEKDAY_CHARS = "日一二三四五六";
const WEEKDAY_EN: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
/** Reminder lead times the data model supports, keyed by minutes. */
export const REMINDER_MINUTES: Record<string, Reminder> = { "0": "at-time", "5": "5min", "15": "15min", "30": "30min", "60": "1hour", "120": "2hour", "720": "12hour", "1440": "1day", "10080": "1week" };

export function parseStatusToken(value: string): EntryStatus | undefined {
  return STATUS_WORDS[value.trim().toLowerCase()];
}

/** `*每天 *每周一三 *周五 *mon *weekly *每月 *每年 *工作日` → recurrence (+ weekdays). */
export function parseRecurrenceToken(value: string): { recurrence: Recurrence; recurringDays?: number[] } | undefined {
  const text = value.trim().toLowerCase();
  if (!text) return undefined;
  if (/^(?:每天|每日|天天|天|日|daily|day|d|everyday)$/.test(text)) return { recurrence: "daily" };
  if (/^(?:每月|月|monthly|month|m)$/.test(text)) return { recurrence: "monthly" };
  if (/^(?:每年|年|yearly|annually|year|y)$/.test(text)) return { recurrence: "yearly" };
  if (/^(?:工作日|weekdays?|workdays?)$/.test(text)) return { recurrence: "weekly", recurringDays: [1, 2, 3, 4, 5] };
  const chinese = /^(?:每周|每星期|周|星期|礼拜|weekly|week|w)([日一二三四五六天1-7]*)$/.exec(text);
  if (chinese) {
    const days = [...new Set([...chinese[1]].map((char) => char === "天" ? 0 : /\d/.test(char) ? Number(char) % 7 : WEEKDAY_CHARS.indexOf(char)))].filter((day) => day >= 0).sort();
    return { recurrence: "weekly", ...(days.length ? { recurringDays: days } : {}) };
  }
  const english = /^(?:every)?(sun|mon|tue|wed|thu|fri|sat)[a-z]*$/.exec(text);
  if (english) return { recurrence: "weekly", recurringDays: [WEEKDAY_EN[english[1]]] };
  return undefined;
}

/** `~15m ~30分 ~1h ~1小时 ~1d ~1天 ~1w ~准时` → reminder lead; leads outside the model are reported. */
export function parseReminderToken(value: string): { reminder?: Reminder; unsupported?: boolean } {
  const text = value.trim().toLowerCase();
  if (/^(?:0|准时|按时|now|ontime|on-time|at)$/.test(text)) return { reminder: "at-time" };
  const match = /^(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes|分|分钟|h|hr|hrs|hour|hours|小时|时|d|day|days|天|日|w|wk|week|weeks|周|星期)?$/.exec(text);
  if (!match) return {};
  const unit = match[2] ?? "";
  const factor = /^(?:h|hr|hrs|hour|hours|小时|时)$/.test(unit) ? 60 : /^(?:d|day|days|天|日)$/.test(unit) ? 1440 : /^(?:w|wk|week|weeks|周|星期)$/.test(unit) ? 10080 : 1;
  const reminder = REMINDER_MINUTES[String(Math.round(Number(match[1]) * factor))];
  return reminder ? { reminder } : { unsupported: true };
}

/** Quoted values allow spaces without turning ordinary prose into commands. */
export function extractExplicit(text: CaptureText): ExplicitCapture {
  const result: ExplicitCapture = { fields: {}, issues: [] };
  const seen = new Map<string, string>();
  const assign = (field: string, value: string, apply: () => void) => {
    if (seen.has(field) && seen.get(field) !== value) result.issues.push({ field, value, code: "conflict" });
    else { seen.set(field, value); apply(); }
  };
  const command = /^\s*\/(\S+)\s*/u.exec(remainingText(text));
  if (command && kinds[command[1].toLowerCase()]) {
    result.fields.kind = kinds[command[1].toLowerCase()];
    consumeMatch(text, command, "cue");
  }
  const tokens = /(?<!\S)(@|#|%|&|!!?|\^|\*|~|status:|状态:)(?:"([^"\n]+)"|“([^”\n]+)”|([^\s,，;；]+))/giu;
  for (const match of remainingText(text).matchAll(tokens)) {
    const prefix = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4];
    const level = /^(?:high|高|重要|紧急|1)$/i.test(value) ? "high" : /^(?:low|低|2)$/i.test(value) ? "low" : undefined;
    if (prefix === "@") assign("location", value, () => { result.fields.location = value; });
    else if (prefix === "#") result.fields.tags = [...new Set([...(result.fields.tags ?? []), value])];
    else if (prefix === "%") assign("category", value, () => { result.category = value; });
    else if (prefix === "&") assign("link", value, () => { result.link = value; });
    else if (prefix === "!" || prefix === "!!") {
      const field = prefix === "!" ? "priority" : "urgency";
      if (!level) { result.issues.push({ field, value, code: "unknown" }); continue; }
      assign(field, value, () => { result.fields[field] = level; });
    } else if (prefix === "*") {
      const parsed = parseRecurrenceToken(value);
      if (!parsed) { result.issues.push({ field: "recurrence", value, code: "unknown" }); continue; }
      assign("recurrence", value, () => {
        result.fields.recurrence = parsed.recurrence;
        if (parsed.recurringDays) result.fields.recurringDays = parsed.recurringDays;
      });
    } else if (prefix === "~") {
      const parsed = parseReminderToken(value);
      if (!parsed.reminder && !parsed.unsupported) { result.issues.push({ field: "reminder", value, code: "unknown" }); continue; }
      if (parsed.unsupported) result.issues.push({ field: "reminder", value, code: "unsupported" });
      else assign("reminder", value, () => { result.fields.reminder = parsed.reminder; });
    } else {
      const status = parseStatusToken(value);
      if (!status) { result.issues.push({ field: "status", value, code: "unknown" }); continue; }
      assign("status", value, () => { result.fields.status = status; });
    }
    consumeMatch(text, match, prefix === "@" ? "place" : "field");
  }
  return result;
}

/** Consume recurrence/reminder before dates and durations to avoid stealing their numbers. */
export function extractScheduleFields(text: CaptureText, issues: CaptureIssue[] = []): Partial<EntryDraft> {
  const fields: Partial<EntryDraft> = {};
  const recurrence = /每(?:天|日|周|星期|月|年)|\b(?:every day|daily|every week|weekly|every month|monthly|every year|yearly|weekdays|every(?=\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)))\b/gi.exec(remainingText(text));
  if (recurrence) {
    fields.recurrence = /天|日|day|daily/i.test(recurrence[0]) && !/weekdays/i.test(recurrence[0]) ? "daily"
      : /月|month/i.test(recurrence[0]) ? "monthly" : /年|year/i.test(recurrence[0]) ? "yearly" : "weekly";
    if (/weekdays/i.test(recurrence[0])) fields.recurringDays = [1, 2, 3, 4, 5];
    if (/每周|每星期/.test(recurrence[0])) {
      const suffix = /^[一二三四五六日天](?:[、,，和及][一二三四五六日天])*/.exec(text.input.slice(recurrence.index + recurrence[0].length));
      if (suffix) {
        fields.recurringDays = [...new Set([...suffix[0]].filter(char => "一二三四五六日天".includes(char)).map(char => char === "日" || char === "天" ? 0 : "一二三四五六".indexOf(char) + 1))];
        recurrence[0] += suffix[0];
      }
    }
    consumeMatch(text, recurrence, "field");
  }
  const reminder = /提前\s*(\d+)\s*(分钟|小时|天|周)\s*提醒|\bremind(?:\s+me)?\s+(\d+)\s*(minutes?|mins?|hours?|days?|weeks?)\s*(?:before|early)?/i.exec(remainingText(text));
  if (reminder) {
    const unit = reminder[2] ?? reminder[4];
    const minutes = Number(reminder[1] ?? reminder[3]) * (/小时|hour/i.test(unit) ? 60 : /天|day/i.test(unit) ? 1440 : /周|week/i.test(unit) ? 10080 : 1);
    if (REMINDER_MINUTES[String(minutes)]) fields.reminder = REMINDER_MINUTES[String(minutes)];
    else issues.push({ field: "reminder", value: reminder[0], code: "unsupported" });
    consumeMatch(text, reminder, "field");
  }
  return fields;
}

export interface CaptureCompletion { value: string; label: string; }
export interface CaptureCompletionValues {
  categories: CaptureCompletion[];
  locations: string[];
  tags: string[];
  links?: CaptureCompletion[];
  statuses?: CaptureCompletion[];
  recurrences?: CaptureCompletion[];
  reminders?: CaptureCompletion[];
}
export function completeCapture(input: string, values: CaptureCompletionValues): CaptureCompletion[] {
  const token = /(?:^|\s)(\/|@|#|%|&|\^|\*|~)([^\s]*)$/.exec(input);
  if (!token) return [];
  const prefix = token[1];
  const query = token[2].toLocaleLowerCase();
  const choices = prefix === "/" ? CAPTURE_COMMANDS.map(value => ({ value: value.slice(1), label: value }))
    : prefix === "%" ? values.categories : prefix === "&" ? values.links ?? []
    : prefix === "^" ? values.statuses ?? [] : prefix === "*" ? values.recurrences ?? [] : prefix === "~" ? values.reminders ?? []
    : (prefix === "@" ? values.locations : values.tags).map(value => ({ value, label: value }));
  return choices.filter(choice => prefix === "/" ? choice.value.toLocaleLowerCase().startsWith(query)
    : captureMatchPositions(choice.label, query) !== null || captureMatchPositions(choice.value, query) !== null)
    .map(choice => ({ ...choice, value: prefix + (/\s/.test(choice.value) ? `"${choice.value}"` : choice.value) }));
}
