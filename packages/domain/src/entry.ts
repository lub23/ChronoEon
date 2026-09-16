export type EntryKind = "task" | "event" | "bill" | "idea";
export type EntryStatus = "open" | "in-progress" | "done" | "cancelled";
/** Narrowed to three levels on 2026-08-10; "normal" is represented by undefined. */
export type EntryPriority = "low" | "high";
export type Recurrence = "none" | "daily" | "weekly" | "monthly" | "yearly";

/**
 * The only legal converter from legacy fine-grained priority literals
 * (`lowest` / `normal` / `medium` / `highest`) to the narrowed enum.
 * `null` means "normal" (undefined in the domain shape).
 */
export function narrowEntryPriority(value: string | null | undefined): "low" | "high" | null {
  if (value === "low" || value === "lowest") return "low";
  if (value === "high" || value === "highest") return "high";
  return null;
}

/** A status override for one materialized recurring occurrence. */
export interface RecurrenceException {
  status: EntryStatus;
  doneAt?: string;
  cancelledAt?: string;
}

/** A time/date override keyed by the original occurrence date. */
export interface RecurrenceMove {
  begin: string;
  end?: string;
}
export type Reminder =
  | "none"
  | "at-time"
  | "5min"
  | "15min"
  | "30min"
  | "1hour"
  | "2hour"
  | "12hour"
  | "1day"
  | "1week"
  | "day-9am"
  | "day-before-9am"
  | "day-before-5pm"
  | "week-before-9am";

export type Locale = "en" | "zh";
export const APP_VIEWS = ["agenda", "month", "week", "day", "ideas", "insights", "review"] as const;
export type AppView = typeof APP_VIEWS[number];

export function isAppView(value: unknown): value is AppView {
  return APP_VIEWS.includes(value as AppView);
}

export type ThemeMode = "light" | "dark";
export type EntrySourceKind = "demo" | "local" | "markdown";

export interface MarkdownEntrySource {
  path: string;
  /** One-based line number, suitable for diagnostics only (never identity). */
  lineNumber: number;
  /** Exact V1 source line. Kept so a read-only round trip never rewrites user Markdown. */
  raw: string;
  /** True only when the source contained an explicit `[id:: ...]` field. */
  persistedId: boolean;
  /** Parsed Dataview fields, normalized to lower-case keys. */
  fields: Record<string, string>;
  /** Fields not yet modeled by ChronoEon. */
  unknownFields?: Record<string, string>;
}

export interface Entry {
  id: string;
  kind: EntryKind;
  title: string;
  titleZh?: string;

  /** Calendar projection used by Agenda/Month. Ideas use their creation date. */
  date: string;
  start?: string;
  end?: string;
  /** Preserves cross-day V1 records whose end date differs from `date`. */
  endDate?: string;
  allDay?: boolean;

  status?: EntryStatus;
  doneAt?: string;
  cancelledAt?: string;

  calendar?: string;
  category: string;
  color: string;
  note?: string;
  location?: string;
  tags?: string[];
  images?: string[];

  priority?: EntryPriority;
  urgency?: EntryPriority;
  recurrence?: Recurrence;
  recurringDays?: number[];
  recurringEnd?: string;
  /** Per-occurrence task status overrides; persisted as recurrenceExceptions metadata. */
  recurrenceExceptions?: Record<string, RecurrenceException>;
  /** Per-occurrence date/time overrides; keyed by the original occurrence date. */
  recurrenceMoves?: Record<string, RecurrenceMove>;
  /** Non-persisted metadata set on a projected recurring occurrence. */
  recurrenceSourceId?: string;
  /** Original scheduled occurrence date for a projected recurring occurrence. */
  occurrenceDate?: string;
  reminder?: Reminder;

  amount?: number;
  currency?: string;
  payment?: string;

  createdAt: string;
  source?: EntrySourceKind;
  filePath?: string;
  markdown?: MarkdownEntrySource;
}

export interface EntryDraft {
  kind: EntryKind;
  title: string;
  date: string;
  status?: EntryStatus;
  start?: string;
  end?: string;
  endDate?: string;
  allDay?: boolean;
  calendar?: string;
  category: string;
  color?: string;
  note?: string;
  amount?: number;
  currency?: string;
  payment?: string;
  location?: string;
  tags?: string[];
  images?: string[];
  priority?: EntryPriority;
  urgency?: EntryPriority;
  recurrence?: Recurrence;
  recurringDays?: number[];
  recurringEnd?: string;
  reminder?: Reminder;
}

/** Compatibility colors used when no imported calendar settings are available. */
export const CATEGORY_COLORS: Record<string, string> = {
  general: "#90d7ec",
  life: "#f47920",
  work: "#77787b",
  personal: "#708b7b",
  wellbeing: "#c69245",
  finance: "#8a7daa",
  learning: "#577e9d",
  uncategorized: "#8b8b83",
  生活: "#90d7ec",
  学习: "#45b97c",
  工作: "#f47920",
  杂事: "#74787c"
};

export function titleFor(entry: Entry, locale: Locale): string {
  return locale === "zh" && entry.titleZh ? entry.titleZh : entry.title;
}

function fillRandomBytes(bytes: Uint8Array): void {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
    return;
  }
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

/** Generate an RFC 4122 UUIDv4 without taking a runtime dependency. */
export function createEntryId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();

  const bytes = new Uint8Array(16);
  fillRandomBytes(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return formatUuid(bytes);
}

/**
 * Create a deterministic UUID-shaped migration ID. It is not a cryptographic
 * UUIDv5, but its stable hash makes a preview repeatable without adding a
 * hashing dependency to the shared domain package.
 */
export function createDeterministicEntryId(seed: string): string {
  const bytes = new Uint8Array(16);
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= index * 374761393;
    hash = Math.imul(hash, 16777619);
    bytes[index] = (hash >>> ((index % 4) * 8)) & 0xff;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return formatUuid(bytes);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i;

export function isStableEntryId(value: string): boolean {
  return UUID_PATTERN.test(value) || ULID_PATTERN.test(value);
}

export function normalizeRecurringDays(days?: number[]): number[] | undefined {
  const normalized = [...new Set((days ?? []).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    .sort((left, right) => left - right);
  return normalized.length ? normalized : undefined;
}

export function draftToEntry(
  draft: EntryDraft,
  source: EntrySourceKind = "local",
  resolvedColor?: string
): Entry {
  const createdAt = new Date().toISOString();
  return {
    id: createEntryId(),
    kind: draft.kind,
    title: draft.title.trim(),
    date: draft.date,
    start: draft.allDay ? undefined : draft.start,
    end: draft.allDay ? undefined : draft.end,
    endDate: draft.endDate && draft.endDate > draft.date ? draft.endDate : undefined,
    allDay: Boolean(draft.allDay),
    status: draft.kind === "task" ? draft.status ?? "open" : undefined,
    doneAt: draft.kind === "task" && draft.status === "done" ? createdAt : undefined,
    cancelledAt: draft.kind === "task" && draft.status === "cancelled" ? createdAt : undefined,
    calendar: draft.calendar ?? "default",
    category: draft.category,
    color: resolvedColor ?? draft.color ?? CATEGORY_COLORS[draft.category] ?? CATEGORY_COLORS.uncategorized,
    note: draft.note?.trim() || undefined,
    // The category's cash-flow direction is authoritative; storage stores a
    // positive magnitude so changing a category's direction never stale-signs
    // existing rows.
    amount: draft.kind === "bill" && draft.amount != null ? Math.abs(draft.amount) : undefined,
    currency: draft.kind === "bill" ? draft.currency ?? "CNY" : undefined,
    payment: draft.kind === "bill" ? draft.payment : undefined,
    location: draft.location?.trim() || undefined,
    tags: draft.tags?.filter(Boolean),
    images: draft.images?.filter(Boolean),
    priority: draft.priority,
    urgency: draft.urgency,
    recurrence: draft.kind === "idea" ? "none" : (draft.recurrence ?? "none"),
    recurringDays: draft.kind !== "idea" && draft.recurrence === "weekly" ? normalizeRecurringDays(draft.recurringDays) : undefined,
    recurringEnd: draft.kind !== "idea" && draft.recurrence && draft.recurrence !== "none" ? draft.recurringEnd : undefined,
    reminder: draft.kind === "idea" ? "none" : (draft.reminder ?? "none"),
    createdAt,
    source
  };
}
