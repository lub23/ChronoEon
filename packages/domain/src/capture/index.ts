import type { EntryDraft, EntryKind, Locale } from "../entry";
import type { ChronoEonSettings } from "../settings";
import { inferCategory } from "./category";
import { inferLocation } from "./location";

export { inferCategory } from "./category";
export { inferLocation } from "./location";
import { extractKind } from "./kind";
import { extractMoney } from "./money";
import { extractPlace } from "./place";
import { captureTitle, type CaptureSpan, type CaptureText } from "./text";
import { extractTime } from "./time";

export interface CaptureHistoryItem { kind: EntryKind; title: string; category: string; location?: string; date: string; }
export interface CaptureOptions { now: Date; locale: Locale; settings: ChronoEonSettings; history?: readonly CaptureHistoryItem[]; }
export interface CaptureResult { draft: EntryDraft; spans: CaptureSpan[]; confidence: { category: number }; }

/** Pure, local-first extraction. History is used locally and never sent to a provider. */
export function parseCapture(input: string, { now, locale, settings, history = [] }: CaptureOptions): CaptureResult {
  const text: CaptureText = { input, spans: [] };
  const time = extractTime(text, now);
  const money = extractMoney(text, settings);
  const kind = extractKind(text, money.amount !== undefined);
  const location = extractPlace(text, history);
  const title = captureTitle(text) || (locale === "zh" ? "未命名条目" : "Untitled entry");
  const category = inferCategory(title, input, kind, settings, history, now, money.amount);
  return {
    draft: { kind, title, ...time, calendar: settings.defaultCalendarID, category: category.value, location, ...money },
    spans: text.spans.sort((a, b) => a.start - b.start).map(({ kind, text }) => ({ kind, text })),
    confidence: { category: category.confidence },
  };
}
