import {
  DEFAULT_CHRONOEON_SETTINGS,
  createDeterministicEntryId,
  isStableEntryId,
  narrowEntryPriority,
  normalizeChronoEonSettings,
  resolveEntryColor,
  type ChronoEonSettings,
  type Entry,
  type EntryKind,
  type EntryPriority,
  type EntryStatus,
  type Recurrence,
  type Reminder,
  type ThemeMode,
} from "@chronoeon/domain";

/**
 * Portable, deliberately boring CSV format used by the standalone app.
 *
 * The first columns are a stable CSV baseline; additional columns keep the
 * richer record fields round-trippable. Unknown columns are ignored on import.
 */
export const ENTRY_EXPORT_HEADERS = [
  "id", "modality", "title", "titleZh", "date", "begin", "end", "endDate", "allDay", "status", "done", "cancelled",
  "amount", "currency", "payment", "category", "color", "calendar", "priority", "urgency", "location", "description",
  "recurring", "recurringDays", "recurringEnd", "recurrenceExceptions", "recurrenceMoves", "reminder", "tags", "images", "created",
] as const;

export interface EntryImportPreview {
  total: number;
  byKind: Record<"task" | "event" | "bill" | "idea", number>;
  entries: Entry[];
  errors: string[];
}

export interface AppDisplayPreferences {
  theme?: ThemeMode;
  accentTheme?: "terracotta" | "jade" | "ocean" | "violet";
  dayPhotos?: boolean;
  lunar?: "auto" | "always" | "never";
  remindersEnabled?: boolean;
  captureShortcut?: string;
  captureShortcutEnabled?: boolean;
  miniShortcut?: string;
  miniShortcutEnabled?: boolean;
  lowEndMode?: boolean;
}

export interface SettingsExportEnvelope {
  format: "chronoeon-settings";
  version: 1;
  settings: ChronoEonSettings;
  preferences?: AppDisplayPreferences;
}

export interface ImportedSettingsBundle {
  settings: ChronoEonSettings;
  preferences: AppDisplayPreferences;
}

function csvEscape(value: unknown): string {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function csvValue(entry: Entry, header: string): string {
  switch (header) {
    case "id": return entry.id;
    case "modality": return entry.kind;
    case "title": return entry.title;
    case "titleZh": return entry.titleZh ?? "";
    case "date": return entry.date;
    case "begin": return entry.start ? `${entry.date} ${entry.start}` : entry.date;
    case "end": return entry.end ? `${entry.endDate ?? entry.date} ${entry.end}` : "";
    case "endDate": return entry.endDate ?? "";
    case "allDay": return entry.allDay ? "true" : "false";
    case "status": return entry.status ?? "";
    case "done": return entry.doneAt ?? "";
    case "cancelled": return entry.cancelledAt ?? "";
    case "amount": return entry.amount == null ? "" : String(entry.amount);
    case "currency": return entry.currency ?? "";
    case "payment": return entry.payment ?? "";
    case "category": return entry.category;
    case "color": return entry.color;
    case "calendar": return entry.calendar ?? "";
    case "priority": return entry.priority ?? "";
    case "urgency": return entry.urgency ?? "";
    case "location": return entry.location ?? "";
    case "description": return entry.note ?? "";
    case "recurring": return entry.recurrence && entry.recurrence !== "none" ? entry.recurrence : "none";
    case "recurringDays": return entry.recurringDays?.join(",") ?? "";
    case "recurringEnd": return entry.recurringEnd ?? "";
    case "recurrenceExceptions": return entry.recurrenceExceptions ? JSON.stringify(entry.recurrenceExceptions) : "";
    case "recurrenceMoves": return entry.recurrenceMoves ? JSON.stringify(entry.recurrenceMoves) : "";
    case "reminder": return entry.reminder ?? "none";
    case "tags": return entry.tags?.join(",") ?? "";
    case "images": return entry.images?.join(",") ?? "";
    case "created": return entry.createdAt;
    default: return "";
  }
}

function entryExportRow(entry: Entry): string[] {
  return ENTRY_EXPORT_HEADERS.map((header) => csvValue(entry, header));
}

export function exportEntriesCsv(entries: Entry[]): string {
  const rows = [ENTRY_EXPORT_HEADERS.join(",")];
  for (const entry of entries) {
    rows.push(entryExportRow(entry).map(csvEscape).join(","));
  }
  return `${rows.join("\n")}\n`;
}

/** Parse RFC-4180-ish CSV, including commas, quotes, and newlines in fields. */
export function parseCsvRows(input: string): string[][] {
  const source = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        value += character;
      }
      continue;
    }
    if (character === '"' && value.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(value.endsWith("\r") ? value.slice(0, -1) : value);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }
  if (quoted) throw new Error("CSV contains an unfinished quoted field");
  if (value.length > 0 || row.length > 0) {
    row.push(value.endsWith("\r") ? value.slice(0, -1) : value);
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  }
  return rows;
}

function normalizedHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]/g, "");
}

function makeHeaderMap(headers: string[]): Map<string, number> {
  return new Map(headers.map((header, index) => [normalizedHeader(header), index]));
}

function getValue(values: string[], headers: Map<string, number>, ...names: string[]): string {
  for (const name of names) {
    const index = headers.get(normalizedHeader(name));
    if (index !== undefined) return values[index]?.trim() ?? "";
  }
  return "";
}

function boolValue(value: string): boolean | undefined {
  if (!value) return undefined;
  if (["true", "1", "yes", "y", "done"].includes(value.toLowerCase())) return true;
  if (["false", "0", "no", "n", "open"].includes(value.toLowerCase())) return false;
  return undefined;
}

function dateFromValue(value: string): string | undefined {
  const match = /\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/.exec(value);
  if (!match) return undefined;
  const date = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ? undefined : date;
}

function timeFromValue(value: string): string | undefined {
  const match = /(?:^|[ T])([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?(?:$|\s)/.exec(value.trim());
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : undefined;
}

function listValue(value: string): string[] | undefined {
  if (!value) return undefined;
  let source = value;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) source = parsed.filter((item): item is string => typeof item === "string").join(",");
  } catch {
    // Comma-separated legacy values are expected.
  }
  const list = source.split(",").map((item) => item.trim()).filter(Boolean);
  return list.length ? [...new Set(list)] : undefined;
}

function jsonRecord<T extends Record<string, unknown>>(value: string): T | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as T : undefined;
  } catch {
    return undefined;
  }
}

function validKind(value: string, amount: string, sectionHint?: EntryKind): EntryKind {
  const normalized = value.toLowerCase();
  if (normalized === "task" || normalized === "event" || normalized === "bill" || normalized === "idea") return normalized;
  if (sectionHint) return sectionHint;
  return amount ? "bill" : "event";
}

function validRecurrence(value: string): Recurrence {
  return value === "daily" || value === "weekly" || value === "monthly" || value === "yearly" ? value : "none";
}

function validPriority(value: string): EntryPriority | undefined {
  // CSV import accepts the legacy six literals and narrows at the boundary.
  const legacy = ["lowest", "low", "normal", "medium", "high", "highest"];
  return legacy.includes(value) ? (narrowEntryPriority(value) ?? undefined) : undefined;
}

function validReminder(value: string): Reminder {
  const allowed: Reminder[] = ["none", "at-time", "5min", "15min", "30min", "1hour", "2hour", "12hour", "1day", "1week", "day-9am", "day-before-9am", "day-before-5pm", "week-before-9am"];
  return allowed.includes(value as Reminder) ? value as Reminder : "none";
}

function hasStatusMarker(value: string): boolean {
  if (!value) return false;
  return boolValue(value) ?? true; // A non-boolean value is normally a timestamp.
}

function validStatus(value: string, done: string, cancelled: string, kind: EntryKind): EntryStatus | undefined {
  if (kind !== "task") return undefined;
  if (value === "open" || value === "in-progress" || value === "done" || value === "cancelled") return value;
  if (hasStatusMarker(cancelled)) return "cancelled";
  if (hasStatusMarker(done)) return "done";
  return "open";
}

function parseEntryRow(values: string[], headers: Map<string, number>, sectionHint: EntryKind | undefined, settings: ChronoEonSettings): { entry?: Entry; error?: string } {
  const title = getValue(values, headers, "title", "name");
  if (!title) return { error: "missing title" };
  const begin = getValue(values, headers, "begin", "start");
  const date = dateFromValue(getValue(values, headers, "date") || begin);
  if (!date) return { error: `invalid date for “${title}”` };

  const kind = validKind(getValue(values, headers, "modality", "kind", "type"), getValue(values, headers, "amount"), sectionHint);
  const endValue = getValue(values, headers, "end");
  const endDate = dateFromValue(getValue(values, headers, "endDate") || endValue);
  const allDayValue = boolValue(getValue(values, headers, "allDay"));
  const allDay = kind === "idea" ? true : (allDayValue ?? !timeFromValue(begin));
  const rawRecurrence = getValue(values, headers, "recurring", "recurrence");
  const recurrence = kind === "idea" ? "none" : validRecurrence(rawRecurrence);
  const rawId = getValue(values, headers, "id");
  const id = isStableEntryId(rawId) ? rawId : createDeterministicEntryId(`csv:${sectionHint ?? "auto"}:${values.join("\u001f")}`);
  const amountValue = getValue(values, headers, "amount");
  const amount = amountValue ? Number(amountValue) : undefined;
  const category = getValue(values, headers, "category") || (kind === "bill" ? settings.bill.categories[0]?.name ?? "消费" : settings.calendars[0]?.defaultCategoryId ?? "生活");
  const doneValue = getValue(values, headers, "done");
  const cancelledValue = getValue(values, headers, "cancelled");
  const status = validStatus(getValue(values, headers, "status"), doneValue, cancelledValue, kind);
  const createdValue = getValue(values, headers, "created");
  const createdAt = createdValue && !Number.isNaN(Date.parse(createdValue)) ? new Date(createdValue).toISOString() : new Date().toISOString();
  const recurringDays = listValue(getValue(values, headers, "recurringDays"))?.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  const importedColor = getValue(values, headers, "color");
  const color = /^#[0-9a-f]{3,8}$/i.test(importedColor)
    ? importedColor
    : resolveEntryColor(category, kind, settings, getValue(values, headers, "calendar") || settings.defaultCalendarID);
  const entry: Entry = {
    id,
    kind,
    title,
    titleZh: getValue(values, headers, "titleZh") || undefined,
    date,
    start: allDay ? undefined : (timeFromValue(getValue(values, headers, "start")) ?? timeFromValue(begin)),
    end: allDay ? undefined : timeFromValue(endValue),
    endDate: endDate && endDate > date ? endDate : undefined,
    allDay,
    status,
    doneAt: status === "done" && boolValue(doneValue) === undefined ? doneValue || undefined : undefined,
    cancelledAt: status === "cancelled" && boolValue(cancelledValue) === undefined ? cancelledValue || undefined : undefined,
    calendar: getValue(values, headers, "calendar") || settings.defaultCalendarID,
    category,
    color,
    note: getValue(values, headers, "description", "note") || undefined,
    location: kind === "idea" ? undefined : getValue(values, headers, "location") || undefined,
    tags: listValue(getValue(values, headers, "tags")),
    images: listValue(getValue(values, headers, "images")),
    priority: kind === "idea" ? undefined : validPriority(getValue(values, headers, "priority")),
    urgency: kind === "idea" ? undefined : validPriority(getValue(values, headers, "urgency")),
    recurrence,
    recurringDays: recurrence === "weekly" ? recurringDays : undefined,
    recurringEnd: recurrence !== "none" ? dateFromValue(getValue(values, headers, "recurringEnd")) : undefined,
    recurrenceExceptions: jsonRecord(getValue(values, headers, "recurrenceExceptions")),
    recurrenceMoves: jsonRecord(getValue(values, headers, "recurrenceMoves")),
    reminder: kind === "idea" ? "none" : validReminder(getValue(values, headers, "reminder")),
    amount: kind === "bill" && Number.isFinite(amount) ? amount : undefined,
    currency: kind === "bill" ? getValue(values, headers, "currency") || settings.bill.currency : undefined,
    payment: kind === "bill" ? getValue(values, headers, "payment") || undefined : undefined,
    createdAt,
    source: "local",
  };
  return { entry };
}

export function parseEntriesCsv(input: string, settings: ChronoEonSettings = DEFAULT_CHRONOEON_SETTINGS): EntryImportPreview {
  const rows = parseCsvRows(input);
  const entries: Entry[] = [];
  const errors: string[] = [];
  let headers: Map<string, number> | null = null;
  let sectionHint: EntryKind | undefined;

  rows.forEach((row, index) => {
    const first = row[0]?.trim() ?? "";
    if (/^#\s*bills?/i.test(first)) {
      sectionHint = "bill";
      headers = null;
      return;
    }
    if (/^#\s*entries?/i.test(first)) {
      sectionHint = undefined;
      headers = null;
      return;
    }
    if (first.startsWith("#")) return;
    if (!headers) {
      headers = makeHeaderMap(row);
      return;
    }
    if (row.every((value) => !value.trim())) return;
    const result = parseEntryRow(row, headers, sectionHint, settings);
    if (result.entry) entries.push(result.entry);
    else errors.push(`Row ${index + 1}: ${result.error ?? "could not import"}`);
  });

  // Never emit duplicate stable IDs: repository identity must remain unambiguous.
  const seen = new Set<string>();
  const uniqueEntries = entries.filter((entry) => {
    if (seen.has(entry.id)) {
      errors.push(`Duplicate entry “${entry.title}” was skipped`);
      return false;
    }
    seen.add(entry.id);
    return true;
  });
  return {
    total: uniqueEntries.length,
    byKind: {
      task: uniqueEntries.filter((entry) => entry.kind === "task").length,
      event: uniqueEntries.filter((entry) => entry.kind === "event").length,
      bill: uniqueEntries.filter((entry) => entry.kind === "bill").length,
      idea: uniqueEntries.filter((entry) => entry.kind === "idea").length,
    },
    entries: uniqueEntries,
    errors,
  };
}

/** Only allowlisted preferences/catalogs enter sync. Connection settings and
 * AI credentials are device-local and never appear in this payload. */
export function settingsSyncPayload(settings: ChronoEonSettings, preferences: AppDisplayPreferences = {}): Record<string, unknown> {
  const safe: AppDisplayPreferences = {};
  if (preferences.theme === "dark" || preferences.theme === "light") safe.theme = preferences.theme;
  if (["terracotta", "jade", "ocean", "violet"].includes(preferences.accentTheme ?? "")) safe.accentTheme = preferences.accentTheme;
  if (["auto", "always", "never"].includes(preferences.lunar ?? "")) safe.lunar = preferences.lunar;
  for (const key of ["dayPhotos", "remindersEnabled", "captureShortcutEnabled", "miniShortcutEnabled", "lowEndMode"] as const) {
    if (typeof preferences[key] === "boolean") safe[key] = preferences[key];
  }
  for (const key of ["captureShortcut", "miniShortcut"] as const) if (typeof preferences[key] === "string") safe[key] = preferences[key];
  return { format: "chronoeon-settings", version: 1, settings: normalizeChronoEonSettings(settings), preferences: safe };
}
export function exportSettingsJson(settings: ChronoEonSettings, preferences: AppDisplayPreferences = {}): string {
  return JSON.stringify(settingsSyncPayload(settings, preferences), null, 2) + "\n";
}
export function importSettingsBundleJson(input: string): ImportedSettingsBundle {
  const record = JSON.parse(input) as SettingsExportEnvelope;
  if (!record || record.format !== "chronoeon-settings" || record.version !== 1 || !record.settings || typeof record.settings !== "object") {
    throw new Error("Unsupported settings format");
  }
  const safe = settingsSyncPayload(record.settings, record.preferences) as unknown as SettingsExportEnvelope;
  return { settings: safe.settings, preferences: safe.preferences ?? {} };
}
export function importSettingsJson(input: string): ChronoEonSettings { return importSettingsBundleJson(input).settings; }
