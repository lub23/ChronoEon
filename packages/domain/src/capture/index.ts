import type { EntryDraft, EntryKind, Locale } from "../entry";
import { billDirectionForCategory, categoryOptionsForKind, type ChronoEonSettings } from "../settings";
import { extractNote } from "./note";
import { inferCategory } from "./category";
import { inferLocation } from "./location";

export { inferCategory } from "./category";
export { inferLocation } from "./location";
import { extractKind } from "./kind";
import { extractMoney } from "./money";
import { extractPlace } from "./place";
import { captureTitle, type CaptureSpan, type CaptureText } from "./text";
import { extractTime } from "./time";
import { CaptureDecisionIndex, type CaptureFieldDecisions } from "./decision";

export { CaptureDecisionIndex, type CaptureFieldDecisions } from "./decision";

export interface CaptureHistoryItem {
  id?: string;
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
}

/** Sentence/comma/semicolon separators split quick notes into draft items.
    Dots and commas inside decimal or grouped numbers stay with the number. */
export function splitCaptureItems(input: string): string[] {
  const items: string[] = [];
  let start = 0;
  const commit = (end: number) => {
    const item = input.slice(start, end).trim().replace(/^[,，.。;；]+|[,，.。;；]+$/g, "");
    if (item) items.push(item);
    start = end + 1;
  };
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character !== "." && character !== "," && character !== "，" && character !== "。" && character !== ";" && character !== "；") continue;
    const previous = input[index - 1] ?? "";
    const next = input[index + 1] ?? "";
    if ((character === "." || character === ",") && /\d/.test(previous) && /\d/.test(next)) continue;
    commit(index);
  }
  if (start < input.length) commit(input.length);
  return items;
}

/** Pure, local-first extraction. History is used locally and never sent to a provider. */
export function parseCapture(input: string, { now, locale, settings, history = [], decisionIndex }: CaptureOptions): CaptureResult {
  const text: CaptureText = { input, spans: [] };
  const provisionalTitle = captureTitle(text);
  const provisionalIndex = decisionIndex ?? new CaptureDecisionIndex(history);
  const provisionalDecisions = provisionalIndex.decide(provisionalTitle);
  const time = extractTime(text, now, provisionalDecisions.defaultDuration);
  const money = extractMoney(text, settings);
  const location = extractPlace(text, history);
  const note = extractNote(text);
  const kind = extractKind(text, money.amount !== undefined, provisionalDecisions.kind.selected);
  const title = captureTitle(text) || (locale === "zh" ? "未命名条目" : "Untitled entry");
  const availableCategories = kind === "bill"
    ? new Set<string>()
    : new Set(categoryOptionsForKind(kind, settings, settings.defaultCalendarID)
      .map((option) => option.value));
  if (kind === "bill") {
    for (const category of settings.bill.categories.filter((candidate) => billDirectionForCategory(candidate.name, settings) === "expense")) {
      for (const child of category.sub) availableCategories.add(`${category.name}/${child}`);
    }
  }
  const decisions = provisionalIndex.decide(title, { kind, availableCategories });
  const learned = decisions.category.selected;
  const category = learned
    ? { value: learned, confidence: Math.max(0.8, decisions.category.options.find((option) => option.value === learned)?.match ?? 0.8) }
    : inferCategory(title, input, kind, settings, history, now, money.amount);
  return {
    draft: {
      kind,
      title,
      ...time,
      calendar: settings.defaultCalendarID,
      category: category.value,
      location: location ?? decisions.location.selected,
      note: note ?? decisions.note.selected,
      ...money,
    },
    spans: text.spans.sort((a, b) => a.start - b.start).map(({ kind, text }) => ({ kind, text })),
    confidence: { category: category.confidence },
    decisions,
  };
}
