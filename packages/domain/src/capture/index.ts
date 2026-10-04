import { extractExplicit, extractScheduleFields, type CaptureIssue } from "./explicit";
export { completeCapture, CAPTURE_COMMANDS, type CaptureIssue } from "./explicit";
import type { ItemDraft } from "../item";
import { defaultItemCategoryForCalendar } from "../settings";
import type { EntryDraft, EntryKind, Locale } from "../entry";
import { billCategoriesForCalendar, categoryOptionsForKind, type ChronoEonSettings } from "../settings";
import { extractNote } from "./note";
import { inferCategory } from "./category";
import { inferLocation, inferLocationCandidates } from "./location";

export { inferCategory } from "./category";
export { inferLocation, inferLocationCandidates } from "./location";
import { extractKind } from "./kind";
import { extractMoney } from "./money";
import { extractPlace } from "./place";
import { captureTitle, type CaptureSpan, type CaptureText } from "./text";
import { extractTime } from "./time";
import { CaptureDecisionIndex, type CaptureFieldDecisions } from "./decision";

export { CaptureDecisionIndex, type CaptureFieldDecisions } from "./decision";

export interface CaptureHistoryItem {
  id?: string;
  calendar?: string;
  kind: EntryKind;
  title: string;
  category: string;
  location?: string;
  note?: string;
  start?: string;
  end?: string;
  date: string;
}
export interface CaptureOptions {
  now: Date;
  locale: Locale;
  settings: ChronoEonSettings;
  history?: readonly CaptureHistoryItem[];
  decisionIndex?: CaptureDecisionIndex;
}
export interface CaptureResult {
  draft: EntryDraft;
  spans: CaptureSpan[];
  confidence: { category: number };
  decisions: CaptureFieldDecisions;
  issues: CaptureIssue[];
  link?: string;
  explicitFields: Array<keyof EntryDraft>;
}

/** Only periods, semicolons and newlines split notes; commas stay in the item.
    A period between digits belongs to the decimal number. */
export function splitCaptureItems(input: string): string[] {
  const items: string[] = [];
  let start = 0;
  const commit = (end: number) => {
    const item = input.slice(start, end).trim();
    if (item) items.push(item);
    start = end + 1;
  };
  let quote = "";
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"' || character === "“" || character === "”") {
      if (!quote) quote = character === "“" ? "”" : character;
      else if (character === quote) quote = "";
      continue;
    }
    if (quote) continue;
    if (character !== "." && character !== "。" && character !== ";" && character !== "；" && character !== "\n" && character !== "\r") continue;
    const previous = input[index - 1] ?? "";
    const next = input[index + 1] ?? "";
    if (character === "." && /\d/.test(previous) && /\d/.test(next)) continue;
    commit(index);
  }
  if (start < input.length) commit(input.length);
  return items;
}

/** Pure, local-first extraction. History is used locally and never sent to a provider. */
export function parseCapture(input: string, { now, locale, settings, history = [], decisionIndex }: CaptureOptions): CaptureResult {
  const text: CaptureText = { input, spans: [] };
  history = history.filter(item => !item.calendar || item.calendar === settings.defaultCalendarID);
  const explicit = extractExplicit(text);
  const schedule = extractScheduleFields(text, explicit.issues);
  const provisionalTitle = captureTitle(text);
  const provisionalIndex = decisionIndex ?? new CaptureDecisionIndex(history);
  const provisionalDecisions = provisionalIndex.decide(provisionalTitle, { calendar: settings.defaultCalendarID });
  const time = extractTime(text, now, provisionalDecisions.defaultDuration);
  const money = extractMoney(text, settings);
  const location = extractPlace(text, history);
  const note = extractNote(text);
  const inferredKind = extractKind(text, money.amount !== undefined, provisionalDecisions.kind.selected);
  const kind = explicit.fields.kind ?? inferredKind;
  if (kind !== "bill" && money.amount !== undefined) explicit.issues.push({ field: "amount", value: String(money.amount), code: "conflict" });
  const title = captureTitle(text) || (locale === "zh" ? "未命名条目" : "Untitled entry");
  const availableCategories = kind === "bill"
    ? new Set<string>()
    : new Set(categoryOptionsForKind(kind, settings, settings.defaultCalendarID)
      .map((option) => option.value));
  if (kind === "bill") {
    for (const category of billCategoriesForCalendar(settings, settings.defaultCalendarID).filter((candidate) => candidate.direction === ((money.amount ?? -1) > 0 ? "income" : "expense"))) {
      availableCategories.add(category.id);
      for (const child of category.sub) availableCategories.add(`${category.id}/${child}`);
    }
  }
  const decisions = provisionalIndex.decide(title, { kind, availableCategories, calendar: settings.defaultCalendarID });
  if (explicit.fields.kind || money.amount !== undefined || text.spans.some(span => span.kind === "cue")) decisions.kind.selected = kind;
  const learned = decisions.category.selected;
  const category = learned
    ? { value: learned, confidence: Math.max(0.8, decisions.category.options.find((option) => option.value === learned)?.match ?? 0.8) }
    : inferCategory(title, input, kind, settings, [], now, money.amount);
  const explicitFields = Object.keys(explicit.fields) as Array<keyof EntryDraft>;
  if (explicit.category) {
    const candidates = categoryOptionsForKind(kind, settings, settings.defaultCalendarID).filter(option => availableCategories.has(option.value)
      && (option.value === explicit.category || option.label.toLocaleLowerCase() === explicit.category!.toLocaleLowerCase()));
    if (candidates.length === 1) { category.value = candidates[0].value; category.confidence = 1; explicitFields.push("category"); }
    else explicit.issues.push({ field: "category", value: explicit.category, code: candidates.length ? "conflict" : "unknown" });
  }
  if (kind !== "task" && explicit.fields.status) {
    explicit.issues.push({ field: "status", value: explicit.fields.status, code: "conflict" });
    delete explicit.fields.status;
  }
  if (kind === "idea" && Object.keys(schedule).length) explicit.issues.push({ field: "recurrence", value: schedule.recurrence ?? schedule.reminder ?? "", code: "conflict" });
  if (schedule.recurrence === "weekly" && !schedule.recurringDays) schedule.recurringDays = [new Date(`${time.date}T12:00:00`).getDay()];
  return {
    draft: {
      kind,
      title,
      ...time,
      calendar: settings.defaultCalendarID,
      category: category.value,
      location: location ?? (settings.locationAutofill ? decisions.location.selected : undefined),
      note,
      ...(kind === "bill" ? money : {}),
      ...(kind !== "idea" ? schedule : {}),
      ...explicit.fields,
    },
    spans: text.spans.sort((a, b) => a.start - b.start).map(({ kind, text }) => ({ kind, text })),
    confidence: { category: category.confidence },
    decisions,
    issues: explicit.issues,
    link: explicit.link,
    explicitFields,
  };
}

export function isAssetCapture(input: string): boolean {
  return /^\s*\/(?:asset|物品)(?:\s|$)/i.test(input);
}

/** Asset captures hand off to the existing item editor; they never masquerade as entries. */
export function parseAssetCapture(input: string, options: CaptureOptions): { draft: Partial<ItemDraft>; link?: string; issues: CaptureIssue[] } {
  const source = input.replace(/^\s*\/(?:asset|物品)(?:\s|$)/i, "/bill ");
  const parsed = parseCapture(source, options);
  const categoryText: CaptureText = { input, spans: [] };
  const explicit = extractExplicit(categoryText);
  const calendar = options.settings.calendars.find(value => value.id === options.settings.defaultCalendarID);
  const category = explicit.category ? calendar?.itemCategories.filter(value => value.id === explicit.category || value.name.toLocaleLowerCase() === explicit.category!.toLocaleLowerCase()) : [];
  const issues = parsed.issues.filter(issue => issue.field !== "category");
  if (explicit.category && category?.length !== 1) issues.push({ field: "category", value: explicit.category, code: "unknown" });
  const gift = /(?:^|\s)(?:gift|礼物|赠送)(?:\s|$)/i.test(source);
  return {
    draft: { name: parsed.draft.title, calendarId: options.settings.defaultCalendarID,
      category: category?.[0]?.id ?? defaultItemCategoryForCalendar(options.settings), acquisition: gift ? "gift" : "purchase",
      acquiredOn: parsed.draft.date, acquiredAt: parsed.draft.start ?? "00:00", cost: Math.abs(parsed.draft.amount ?? 0),
      currency: parsed.draft.currency ?? options.settings.bill.currency, location: parsed.draft.location, payment: parsed.draft.payment, notes: parsed.draft.note },
    link: parsed.link, issues,
  };
}
