import {
  addIsoDays,
  compareIsoDates,
  formatClockMinutes,
  isIsoDate,
  parseClockMinutes,
} from "./calendar";
import type {
  EntryDraft,
  EntryKind,
  Locale,
  Recurrence,
  Reminder,
} from "./entry";
import { narrowEntryPriority } from "./entry";
import {
  categoryOptionsForKind,
  defaultCategoryForKind,
  type ChronoEonSettings,
} from "./settings";

export type AIProviderKind = "openai-compatible" | "local-openai-compatible";

/** Non-secret provider settings. API keys deliberately do not belong here. */
export interface AIProviderConfig {
  kind: AIProviderKind;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  maxTokens?: number;
  temperature?: number;
}

export interface AIChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: AIToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface AIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface AIToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AIValidationIssue {
  field: keyof EntryDraft | "response";
  severity: "error" | "warning";
  code:
    | "missing-title"
    | "invalid-kind"
    | "invalid-date"
    | "invalid-time"
    | "missing-start"
    | "invalid-end"
    | "unknown-category"
    | "invalid-amount"
    | "empty-response";
}

export interface AIStructuredCandidate {
  sourceIndex: number;
  draft: EntryDraft;
  issues: AIValidationIssue[];
}

export interface AIStructuredResult {
  candidates: AIStructuredCandidate[];
  responseIssues: AIValidationIssue[];
}

export interface SmartCapturePrompt {
  messages: AIChatMessage[];
  responseSchema: Record<string, unknown>;
}

const ENTRY_KINDS = new Set<EntryKind>(["task", "event", "bill", "idea"]);
/** Legacy literals still accepted at the AI boundary; narrowed before storage. */
const LEGACY_PRIORITIES = new Set<string>(["lowest", "low", "normal", "medium", "high", "highest"]);
const RECURRENCES = new Set<Recurrence>(["none", "daily", "weekly", "monthly", "yearly"]);
const REMINDERS = new Set<Reminder>([
  "none", "at-time", "5min", "15min", "30min", "1hour", "2hour", "12hour", "1day", "1week",
  "day-9am", "day-before-9am", "day-before-5pm", "week-before-9am",
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function bool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1) return true;
  if (value === "false" || value === 0) return false;
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function stringArray(value: unknown): string[] | undefined {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,，]/)
      : [];
  const normalized = [...new Set(values.flatMap((item) => typeof item === "string" ? [item.trim().replace(/^#/, "")] : []).filter(Boolean))];
  return normalized.length ? normalized : undefined;
}

/** Remove common reasoning/code-fence wrappers without ever executing content. */
export function extractAIJson(raw: string): unknown {
  const withoutThinking = raw
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "")
    .replace(/<think(?:ing)?>[\s\S]*$/i, "")
    .trim();
  const cleaned = withoutThinking
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (!cleaned) return null;
  try {
    return JSON.parse(cleaned);
  } catch {
    const firstArray = cleaned.indexOf("[");
    const lastArray = cleaned.lastIndexOf("]");
    if (firstArray >= 0 && lastArray > firstArray) {
      try { return JSON.parse(cleaned.slice(firstArray, lastArray + 1)); } catch { /* try object */ }
    }
    const firstObject = cleaned.indexOf("{");
    const lastObject = cleaned.lastIndexOf("}");
    if (firstObject >= 0 && lastObject > firstObject) return JSON.parse(cleaned.slice(firstObject, lastObject + 1));
    throw new Error("AI response did not contain valid JSON");
  }
}

function normalizeKind(value: unknown): EntryKind | null {
  const candidate = text(value).toLowerCase()
    .replace("todo", "task")
    .replace("expense", "bill")
    .replace("note", "idea");
  return ENTRY_KINDS.has(candidate as EntryKind) ? candidate as EntryKind : null;
}

function normalizeCategory(raw: unknown, kind: EntryKind, settings: ChronoEonSettings, calendar: string): { value: string; known: boolean } {
  // Some providers echo the option line ("event: 工作") rather than the value.
  const candidate = text(raw).replace(/^(?:task|event|bill|idea)\s*[:：]\s*/i, "");
  const options = categoryOptionsForKind(kind, settings, calendar);
  const match = options.find((option) => option.value.toLocaleLowerCase() === candidate.toLocaleLowerCase()
    || option.label.toLocaleLowerCase() === candidate.toLocaleLowerCase());
  if (match) return { value: match.value, known: true };
  return { value: defaultCategoryForKind(kind, settings, calendar), known: !candidate };
}

function normalizeAIClock(value: unknown): string {
  const raw = text(value);
  if (!raw) return "";
  const clock = /(?:^|[^0-9])(\d{1,2}):([0-5]\d)(?:[^0-9]|$)/.exec(raw);
  const minutes = clock ? parseClockMinutes(`${clock[1]}:${clock[2]}`) : null;
  return minutes === null ? raw : formatClockMinutes(minutes);
}

function normalizeAIDate(value: unknown, fallbackDate: string): { date: string; invalid: boolean } {
  const raw = text(value);
  if (!raw) return { date: fallbackDate, invalid: false };
  const stamp = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):([0-5]\d)(?::[0-5]\d)?)?/.exec(raw);
  if (stamp) return { date: stamp[1], invalid: false };
  if (isIsoDate(raw)) return { date: raw, invalid: false };
  const relative = new Map<string, number>([
    ["昨天", -1], ["前天", -2], ["today", 0], ["今天", 0],
    ["tomorrow", 1], ["明天", 1], ["后天", 2], ["大后天", 3],
  ]);
  const offset = relative.get(raw.toLowerCase());
  if (offset !== undefined && isIsoDate(fallbackDate)) {
    return { date: addIsoDays(fallbackDate, offset), invalid: false };
  }
  return { date: raw, invalid: true };
}

function normalizeCandidate(
  source: unknown,
  sourceIndex: number,
  fallbackDate: string,
  settings: ChronoEonSettings,
): AIStructuredCandidate {
  const value = record(source);
  const issues: AIValidationIssue[] = [];
  const kind = normalizeKind(value.kind ?? value.modality ?? value.type);
  const safeKind = kind ?? "task";
  if (!kind) issues.push({ field: "kind", severity: "error", code: "invalid-kind" });

  const title = text(value.title ?? value.name).slice(0, 300);
  if (!title) issues.push({ field: "title", severity: "error", code: "missing-title" });

  const parsedDate = normalizeAIDate(value.date ?? value.begin, fallbackDate);
  let date = parsedDate.date;
  let start = normalizeAIClock(value.start ?? value.time ?? value.startTime);
  let end = text(value.end);
  let endDate = text(value.endDate ?? value.end_date);
  // Accept a full date/time stamp in addition to separate fields.
  const beginStamp = text(value.begin).match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?/);
  const endStamp = text(value.end).match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?/);
  if (beginStamp) {
    date = beginStamp[1];
    start = beginStamp[2] ?? start;
  }
  if (endStamp) {
    endDate = endStamp[1];
    end = endStamp[2] ?? "";
  }
  if (parsedDate.invalid || !isIsoDate(date)) {
    issues.push({ field: "date", severity: "error", code: "invalid-date" });
    date = fallbackDate;
  }
  if (start && parseClockMinutes(start) === null) {
    issues.push({ field: "start", severity: "error", code: "invalid-time" });
    start = "";
  } else if (start) start = formatClockMinutes(parseClockMinutes(start)!);
  if (end && parseClockMinutes(end) === null) {
    issues.push({ field: "end", severity: "error", code: "invalid-time" });
    end = "";
  } else if (end) end = formatClockMinutes(parseClockMinutes(end)!);
  if (endDate && !isIsoDate(endDate)) {
    // Small models sometimes answer a civil-end-date prompt with an end clock.
    const endTime = /(?:^|[^0-9])(\d{1,2}):([0-5]\d)(?:[^0-9]|$)/.exec(endDate);
    if (endTime && !end) {
      end = formatClockMinutes(parseClockMinutes(`${endTime[1]}:${endTime[2]}`)!);
      endDate = "";
    } else {
      issues.push({ field: "endDate", severity: "error", code: "invalid-end" });
      endDate = "";
    }
  } else if (endDate && compareIsoDates(endDate, date) < 0) {
    issues.push({ field: "endDate", severity: "error", code: "invalid-end" });
    endDate = "";
  }

  const allDay = bool(value.allDay ?? value.all_day) ?? !start;
  if (allDay) { start = ""; end = ""; }
  if (!allDay && !start) issues.push({ field: "start", severity: "error", code: "missing-start" });
  if (!allDay && start && end && !endDate && parseClockMinutes(end)! < parseClockMinutes(start)!) {
    endDate = addIsoDays(date, 1);
  }
  // Some small local models ignore the JSON field names and answer with a
  // duration. Derive the end rather than silently losing it.
  if (!allDay && start && !end) {
    const durationRaw = text(value.duration);
    const durationMatch = /(\d+(?:\.\d+)?)\s*(小时|hour|hr|分|分钟|min)/i.exec(durationRaw);
    if (durationMatch) {
      const amount = Number(durationMatch[1]);
      const minutes = /小时|hour|hr/i.test(durationMatch[2]) ? Math.round(amount * 60) : Math.round(amount);
      if (Number.isFinite(minutes) && minutes > 0) {
        const absoluteEnd = parseClockMinutes(start)! + minutes;
        end = formatClockMinutes(absoluteEnd % (24 * 60));
        if (absoluteEnd >= 24 * 60) endDate = addIsoDays(date, 1);
      }
    }
  }

  const calendar = text(value.calendar) || settings.defaultCalendarID;
  const category = normalizeCategory(value.category, safeKind, settings, calendar);
  if (!category.known) issues.push({ field: "category", severity: "warning", code: "unknown-category" });

  const amount = numberValue(value.amount);
  if (safeKind === "bill" && amount === undefined) issues.push({ field: "amount", severity: "error", code: "invalid-amount" });
  const recurrenceValue = text(value.recurrence ?? value.recurring) as Recurrence;
  const reminderValue = text(value.reminder) as Reminder;
  const priorityValue = text(value.priority);
  const urgencyValue = text(value.urgency);

  return {
    sourceIndex,
    issues,
    draft: {
      kind: safeKind,
      title,
      date,
      start: allDay ? undefined : start || undefined,
      end: allDay ? undefined : end || undefined,
      endDate: endDate && endDate !== date ? endDate : undefined,
      allDay,
      calendar,
      category: category.value,
      note: text(value.note ?? value.description) || undefined,
      amount: safeKind === "bill" ? amount : undefined,
      currency: safeKind === "bill" ? (text(value.currency) || settings.bill.currency).toUpperCase() : undefined,
      payment: safeKind === "bill" ? text(value.payment) || settings.bill.paymentMethods[0] : undefined,
      location: text(value.location) || undefined,
      tags: stringArray(value.tags),
      priority: LEGACY_PRIORITIES.has(priorityValue) ? (narrowEntryPriority(priorityValue) ?? undefined) : undefined,
      urgency: LEGACY_PRIORITIES.has(urgencyValue) ? (narrowEntryPriority(urgencyValue) ?? undefined) : undefined,
      recurrence: safeKind === "idea" ? "none" : RECURRENCES.has(recurrenceValue) ? recurrenceValue : "none",
      recurringDays: (Array.isArray(value.recurringDays) ? value.recurringDays : stringArray(value.recurringDays) ?? [])
        .map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
      recurringEnd: isIsoDate(text(value.recurringEnd)) ? text(value.recurringEnd) : undefined,
      reminder: safeKind === "idea" ? "none" : REMINDERS.has(reminderValue) ? reminderValue : "none",
    },
  };
}

/** Revalidate a user-edited preview before it is allowed to reach storage. */
export function validateAIStructuredDraft(draft: EntryDraft): AIValidationIssue[] {
  const issues: AIValidationIssue[] = [];
  if (!draft.title.trim()) issues.push({ field: "title", severity: "error", code: "missing-title" });
  if (!ENTRY_KINDS.has(draft.kind)) issues.push({ field: "kind", severity: "error", code: "invalid-kind" });
  if (!isIsoDate(draft.date)) issues.push({ field: "date", severity: "error", code: "invalid-date" });
  if (!draft.allDay && !draft.start) issues.push({ field: "start", severity: "error", code: "missing-start" });
  if (!draft.allDay && draft.start && parseClockMinutes(draft.start) === null) issues.push({ field: "start", severity: "error", code: "invalid-time" });
  if (!draft.allDay && draft.end && parseClockMinutes(draft.end) === null) issues.push({ field: "end", severity: "error", code: "invalid-time" });
  if (draft.endDate && (!isIsoDate(draft.endDate) || (isIsoDate(draft.date) && compareIsoDates(draft.endDate, draft.date) < 0))) {
    issues.push({ field: "endDate", severity: "error", code: "invalid-end" });
  }
  if (!draft.allDay && draft.start && draft.end && (!draft.endDate || draft.endDate === draft.date)
    && parseClockMinutes(draft.start) !== null && parseClockMinutes(draft.end) !== null
    && parseClockMinutes(draft.end)! < parseClockMinutes(draft.start)!) {
    issues.push({ field: "end", severity: "error", code: "invalid-end" });
  }
  if (draft.kind === "bill" && (typeof draft.amount !== "number" || !Number.isFinite(draft.amount))) {
    issues.push({ field: "amount", severity: "error", code: "invalid-amount" });
  }
  return issues;
}

/** Convert provider JSON into safe drafts; unknown fields and IDs are dropped. */
export function normalizeAIStructuredResult(
  input: unknown,
  fallbackDate: string,
  settings: ChronoEonSettings,
): AIStructuredResult {
  const envelope = record(input);
  const rawEntries = Array.isArray(input) ? input : Array.isArray(envelope.entries) ? envelope.entries : Object.keys(envelope).length ? [envelope] : [];
  if (!rawEntries.length) {
    return { candidates: [], responseIssues: [{ field: "response", severity: "error", code: "empty-response" }] };
  }
  return {
    candidates: rawEntries.slice(0, 20).map((value, index) => normalizeCandidate(value, index, fallbackDate, settings)),
    responseIssues: [],
  };
}

const ENTRY_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["entries"],
  properties: {
    entries: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "title", "date", "allDay", "start", "end", "endDate", "category"],
        properties: {
          kind: { enum: ["task", "event", "bill", "idea"] },
          title: { type: "string" },
          date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          start: { type: ["string", "null"] },
          end: { type: ["string", "null"] },
          endDate: { type: ["string", "null"] },
          allDay: { type: "boolean" },
          category: { type: "string" },
          amount: { type: ["number", "null"] },
          currency: { type: ["string", "null"] },
          payment: { type: ["string", "null"] },
          location: { type: ["string", "null"] },
          note: { type: ["string", "null"] },
          tags: { type: "array", items: { type: "string" } },
          priority: { type: ["string", "null"], enum: ["low", "normal", "high", null] },
          urgency: { type: ["string", "null"], enum: ["low", "normal", "high", null] },
          recurrence: { type: ["string", "null"] },
          reminder: { type: ["string", "null"] },
        },
      },
    },
  },
} as const;

const WEEKDAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;
const WEEKDAY_NAMES_ZH = ["日", "一", "二", "三", "四", "五", "六"] as const;

/** Remove date arithmetic from the model: give it the exact civil dates. */
function relativeDateHints(currentDateTime: string): string {
  const today = currentDateTime.slice(0, 10);
  if (!isIsoDate(today)) return "";
  const weekday = new Date(`${today}T00:00:00`).getDay();
  const hints = [`Today/今天: ${today}`, `Tomorrow/明天: ${addIsoDays(today, 1)}`];
  for (let weekdayIndex = 0; weekdayIndex < WEEKDAY_NAMES.length; weekdayIndex += 1) {
    const offset = ((weekdayIndex - weekday + 7) % 7) || 7;
    hints.push(`next ${WEEKDAY_NAMES[weekdayIndex]}/下周${WEEKDAY_NAMES_ZH[weekdayIndex]}: ${addIsoDays(today, offset)}`);
  }
  return `Relative date hints: ${hints.join("; ")}.`;
}

export function buildSmartCapturePrompt(
  input: string,
  currentDateTime: string,
  locale: Locale,
  settings: ChronoEonSettings,
): SmartCapturePrompt {
  const categorySummary = (["task", "event", "idea", "bill"] as EntryKind[])
    .map((kind) => `${kind}: ${categoryOptionsForKind(kind, settings).map((item) => item.value).join(", ")}`)
    .join("\n");
  const language = locale === "zh" ? "Simplified Chinese" : "English";
  const exampleDate = currentDateTime.slice(0, 10);
  const dateHints = relativeDateHints(currentDateTime);
  return {
    responseSchema: ENTRY_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    messages: [
      {
        role: "system",
        content: `You convert natural language into ChronoEon calendar drafts. Current local date/time: ${currentDateTime}. Interpret relative dates from it. Preserve multiple requested items as separate entries. Output JSON only, matching the supplied schema. UI language: ${language}. Use 24-hour HH:mm and civil YYYY-MM-DD values. Ideas use an exact HH:MM time when one is known. Never invent an ID, file path, API key, or prose outside JSON.\nUse exactly these fields: kind, title, date, allDay, start, end, endDate, category, amount. Never use type, modality, time, duration, begin, or end_date. Timed entries set allDay to false, start to HH:mm, end to HH:mm, and endDate to null unless the range crosses midnight; all-day entries set start, end, and endDate to null. Never put a clock time in endDate. Bills include amount as a signed number: negative for expenses and positive for income.\n${dateHints} Copy the exact hint date for the matching relative expression; never substitute another weekday.\nExample: {"entries":[{"kind":"bill","title":"Lunch","date":"${exampleDate}","allDay":false,"start":"12:00","end":"12:30","endDate":null,"category":"生活","amount":-36}]}\nAllowed categories:\n${categorySummary}`,
      },
      { role: "user", content: input },
    ],
  };
}
