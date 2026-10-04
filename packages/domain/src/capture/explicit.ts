import type { EntryDraft, EntryKind, Reminder } from "../entry";
import { consumeMatch, remainingText, type CaptureText } from "./text";

export interface CaptureIssue { field: string; value: string; code: "unknown" | "conflict" | "unsupported"; }
export interface ExplicitCapture {
  fields: Partial<EntryDraft>;
  category?: string;
  link?: string;
  issues: CaptureIssue[];
}
export const CAPTURE_COMMANDS = ["/task", "/event", "/bill", "/idea", "/asset"] as const;
const kinds: Record<string, EntryKind> = { task: "task", todo: "task", 待办: "task", 任务: "task", event: "event", 日程: "event", bill: "bill", expense: "bill", 账目: "bill", 记账: "bill", idea: "idea", 灵感: "idea" };

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
  const tokens = /(?<!\S)(@|#|%|&|!!?|status:|状态:)(?:"([^"\n]+)"|“([^”\n]+)”|([^\s,，;；]+))/giu;
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
    } else {
      const status = ({ open: "open", 待办: "open", "in-progress": "in-progress", 进行中: "in-progress", done: "done", 完成: "done", cancelled: "cancelled", 取消: "cancelled" } as const)[value as "open"];
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
  const reminders: Record<string, Reminder> = { "5": "5min", "15": "15min", "30": "30min", "60": "1hour", "120": "2hour", "720": "12hour", "1440": "1day", "10080": "1week" };
  const reminder = /提前\s*(\d+)\s*(分钟|小时|天|周)\s*提醒|\bremind(?:\s+me)?\s+(\d+)\s*(minutes?|mins?|hours?|days?|weeks?)\s*(?:before|early)?/i.exec(remainingText(text));
  if (reminder) {
    const unit = reminder[2] ?? reminder[4];
    const minutes = Number(reminder[1] ?? reminder[3]) * (/小时|hour/i.test(unit) ? 60 : /天|day/i.test(unit) ? 1440 : /周|week/i.test(unit) ? 10080 : 1);
    if (reminders[String(minutes)]) fields.reminder = reminders[String(minutes)];
    else issues.push({ field: "reminder", value: reminder[0], code: "unsupported" });
    consumeMatch(text, reminder, "field");
  }
  return fields;
}

export interface CaptureCompletion { value: string; label: string; }
export function completeCapture(input: string, values: { categories: CaptureCompletion[]; locations: string[]; tags: string[]; links?: CaptureCompletion[] }): CaptureCompletion[] {
  const token = /(?:^|\s)(\/|@|#|%|&)([^\s]*)$/.exec(input);
  if (!token) return [];
  const prefix = token[1];
  const query = token[2].toLocaleLowerCase();
  const choices = prefix === "/" ? CAPTURE_COMMANDS.map(value => ({ value: value.slice(1), label: value }))
    : prefix === "%" ? values.categories : prefix === "&" ? values.links ?? []
    : (prefix === "@" ? values.locations : values.tags).map(value => ({ value, label: value }));
  return choices.filter(choice => choice.label.toLocaleLowerCase().startsWith(query) || choice.value.toLocaleLowerCase().startsWith(query))
    .slice(0, 5).map(choice => ({ ...choice, value: prefix + (/\s/.test(choice.value) ? `"${choice.value}"` : choice.value) }));
}
