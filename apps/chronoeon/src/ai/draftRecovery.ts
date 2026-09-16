import type { EntryDraft, EntryKind, Reminder, Recurrence } from "@chronoeon/domain";
import { narrowEntryPriority } from "@chronoeon/domain";

export interface SmartCaptureRecoveryState {
  raw: string;
  mode: "offline" | "ai";
  drafts: EntryDraft[];
  updatedAt: number;
}

export const SMART_CAPTURE_RECOVERY_KEY = "chronoeon.ai.smart-capture.v1";
const MAX_RAW_LENGTH = 20_000;
const MAX_DRAFTS = 20;
const KINDS = new Set<EntryKind>(["task", "event", "bill", "idea"]);
const RECURRENCES = new Set<Recurrence>(["none", "daily", "weekly", "monthly", "yearly"]);
const REMINDERS = new Set<Reminder>([
  "none", "at-time", "5min", "15min", "30min", "1hour", "2hour", "12hour", "1day", "1week",
  "day-9am", "day-before-9am", "day-before-5pm", "week-before-9am",
]);
/** Legacy literals still accepted from persisted drafts; narrowed before use. */
const PRIORITIES = new Set<string>(["lowest", "low", "normal", "medium", "high", "highest"]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, max = 500): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function stringList(value: unknown, max = 40): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = [...new Set(value.map((item) => text(item, 80)).filter((item): item is string => Boolean(item)))].slice(0, max);
  return result.length ? result : undefined;
}

function safeDraft(value: unknown): EntryDraft | null {
  const input = record(value);
  const kind = input.kind;
  if (typeof kind !== "string" || !KINDS.has(kind as EntryKind)) return null;
  const date = text(input.date, 10);
  const title = text(input.title, 300);
  const category = text(input.category, 160);
  if (!date || !title || !category) return null;
  const draft: EntryDraft = {
    kind: kind as EntryKind,
    title,
    date,
    start: text(input.start, 5),
    end: text(input.end, 5),
    endDate: text(input.endDate, 10),
    allDay: input.allDay === true,
    calendar: text(input.calendar, 100),
    category,
    note: text(input.note, 8_000),
    amount: typeof input.amount === "number" && Number.isFinite(input.amount) ? input.amount : undefined,
    currency: text(input.currency, 12),
    payment: text(input.payment, 80),
    location: text(input.location, 300),
    tags: stringList(input.tags),
    images: stringList(input.images, 20),
    priority: typeof input.priority === "string" && PRIORITIES.has(input.priority) ? (narrowEntryPriority(input.priority) ?? undefined) : undefined,
    urgency: typeof input.urgency === "string" && PRIORITIES.has(input.urgency) ? (narrowEntryPriority(input.urgency) ?? undefined) : undefined,
    recurrence: typeof input.recurrence === "string" && RECURRENCES.has(input.recurrence as Recurrence) ? input.recurrence as Recurrence : "none",
    recurringDays: Array.isArray(input.recurringDays) ? input.recurringDays.filter((day): day is number => typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6) : undefined,
    recurringEnd: text(input.recurringEnd, 10),
    reminder: typeof input.reminder === "string" && REMINDERS.has(input.reminder as Reminder) ? input.reminder as Reminder : "none",
  };
  if (draft.kind === "idea") {
    draft.allDay = true;
    draft.start = undefined;
    draft.end = undefined;
    draft.endDate = undefined;
    draft.recurrence = "none";
    draft.reminder = "none";
    draft.priority = undefined;
    draft.urgency = undefined;
  }
  return draft;
}

export function readSmartCaptureRecovery(now = Date.now()): SmartCaptureRecoveryState | null {
  try {
    const raw = window.localStorage.getItem(SMART_CAPTURE_RECOVERY_KEY);
    if (!raw) return null;
    const value = record(JSON.parse(raw));
    const input = text(value.raw, MAX_RAW_LENGTH);
    const updatedAt = typeof value.updatedAt === "number" ? value.updatedAt : 0;
    if (!input || !updatedAt || now - updatedAt > 7 * 24 * 60 * 60 * 1_000) return null;
    const drafts = Array.isArray(value.drafts)
      ? value.drafts.slice(0, MAX_DRAFTS).map(safeDraft).filter((draft): draft is EntryDraft => Boolean(draft))
      : [];
    return { raw: input, mode: value.mode === "ai" ? "ai" : "offline", drafts, updatedAt };
  } catch {
    return null;
  }
}

export function writeSmartCaptureRecovery(state: Omit<SmartCaptureRecoveryState, "updatedAt"> | SmartCaptureRecoveryState): void {
  try {
    const raw = text(state.raw, MAX_RAW_LENGTH);
    if (!raw) return;
    const drafts = state.drafts.slice(0, MAX_DRAFTS).map(safeDraft).filter((draft): draft is EntryDraft => Boolean(draft));
    window.localStorage.setItem(SMART_CAPTURE_RECOVERY_KEY, JSON.stringify({ raw, mode: state.mode, drafts, updatedAt: Date.now() }));
  } catch {
    // Storage may be disabled or full; the in-memory dialog remains usable.
  }
}

export function clearSmartCaptureRecovery(): void {
  try { window.localStorage.removeItem(SMART_CAPTURE_RECOVERY_KEY); } catch { /* private browsing */ }
}
