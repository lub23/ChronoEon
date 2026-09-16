import {
  DEFAULT_CHRONOEON_SETTINGS,
  addIsoDays,
  differenceInIsoDays,
  isIsoDate,
  normalizeRecurringDays,
  resolveEntryColor,
  type ChronoEonSettings,
  type Entry,
  type EntryDraft,
  type EntryStatus,
} from "./entry";

export type RecurrenceEditScope = "series" | "occurrence";

/** Convert a materialized UI entry back to the editable draft shape. */
export function entryToDraft(entry: Entry): EntryDraft {
  return {
    kind: entry.kind,
    title: entry.title,
    date: entry.date,
    status: entry.kind === "task" ? entry.status ?? "open" : undefined,
    start: entry.start,
    end: entry.end,
    endDate: entry.endDate,
    allDay: entry.allDay,
    calendar: entry.calendar,
    category: entry.category,
    note: entry.note,
    amount: entry.amount,
    currency: entry.currency,
    payment: entry.payment,
    location: entry.location,
    tags: entry.tags,
    images: entry.images,
    priority: entry.kind === "idea" ? undefined : entry.priority,
    urgency: entry.kind === "idea" ? undefined : entry.urgency,
    recurrence: entry.recurrence ?? "none",
    recurringDays: entry.recurringDays,
    recurringEnd: entry.recurringEnd,
    reminder: entry.reminder ?? "none",
  };
}

export interface EntryEditContext {
  scope: RecurrenceEditScope;
  occurrenceDate?: string;
}

export function sourceEntryId(entry: Pick<Entry, "id" | "recurrenceSourceId">): string {
  return entry.recurrenceSourceId ?? entry.id.split("::recurrence::", 1)[0];
}

function normalizeEndDate(date: string, endDate?: string): string | undefined {
  return endDate && isIsoDate(endDate) && endDate > date ? endDate : undefined;
}

function shiftStamp(value: string | undefined, days: number): string | undefined {
  if (!value || !days) return value;
  const match = /^(\d{4}-\d{2}-\d{2})(.*)$/.exec(value);
  if (!match || !isIsoDate(match[1])) return value;
  return `${addIsoDays(match[1], days)}${match[2]}`;
}

function shiftedRecurrenceMetadata(entry: Entry, nextDate: string, recurrenceChanged: boolean) {
  if (recurrenceChanged || !entry.recurrence || entry.recurrence === "none" || !isIsoDate(entry.date) || !isIsoDate(nextDate)) {
    return { recurrenceExceptions: undefined, recurrenceMoves: undefined };
  }
  const offset = differenceInIsoDays(nextDate, entry.date);
  if (!offset) {
    return {
      recurrenceExceptions: entry.recurrenceExceptions,
      recurrenceMoves: entry.recurrenceMoves,
    };
  }
  const recurrenceExceptions = entry.recurrenceExceptions
    ? Object.fromEntries(Object.entries(entry.recurrenceExceptions).map(([date, exception]) => [
        isIsoDate(date) ? addIsoDays(date, offset) : date,
        exception,
      ]))
    : undefined;
  const recurrenceMoves = entry.recurrenceMoves
    ? Object.fromEntries(Object.entries(entry.recurrenceMoves).map(([date, move]) => [
        isIsoDate(date) ? addIsoDays(date, offset) : date,
        {
          begin: shiftStamp(move.begin, offset) ?? move.begin,
          end: shiftStamp(move.end, offset),
        },
      ]))
    : undefined;
  return { recurrenceExceptions, recurrenceMoves };
}

/** Build an edited source entry without mutating the UI cache before persistence succeeds. */
export function entryWithDraft(
  entry: Entry,
  draft: EntryDraft,
  settings: ChronoEonSettings = DEFAULT_CHRONOEON_SETTINGS,
): Entry {
  // Keep the original id: an entry is addressed by its id in both stores, and
  // `SqliteEntryStore.update` / the demo `replace` only match a row when the id
  // is unchanged. Reassigning the id here (the old `ensureStableEntryId`) made
  // every drag of a built-in / imported item write to a non-existent id and
  // silently spring back. Ids are minted once, at creation.
  const kind = draft.kind;
  const status = kind === "task" ? draft.status ?? "open" : undefined;
  const allDay = Boolean(draft.allDay);
  const recurrence = kind === "idea" ? "none" : (draft.recurrence ?? "none");
  const recurrenceChanged = recurrence !== (entry.recurrence ?? "none");
  const recurrenceMetadata = recurrence === "none"
    ? { recurrenceExceptions: undefined, recurrenceMoves: undefined }
    : shiftedRecurrenceMetadata(entry, draft.date, recurrenceChanged);
  const dateOffset = isIsoDate(entry.date) && isIsoDate(draft.date)
    ? differenceInIsoDays(draft.date, entry.date)
    : 0;
  const recurringEnd = recurrence !== "none" && draft.recurringEnd && draft.recurringEnd >= draft.date
    ? (dateOffset && entry.recurringEnd === draft.recurringEnd ? addIsoDays(draft.recurringEnd, dateOffset) : draft.recurringEnd)
    : undefined;

  return {
    ...entry,
    ...draft,
    kind,
    title: draft.title.trim(),
    date: draft.date,
    start: allDay ? undefined : draft.start || undefined,
    end: allDay ? undefined : draft.end || undefined,
    endDate: normalizeEndDate(draft.date, draft.endDate),
    allDay,
    status,
    doneAt: status === "done" ? entry.doneAt ?? new Date().toISOString() : undefined,
    cancelledAt: status === "cancelled" ? entry.cancelledAt ?? new Date().toISOString() : undefined,
    calendar: draft.calendar ?? entry.calendar ?? settings.defaultCalendarID,
    category: draft.category,
    color: resolveEntryColor(draft.category, kind, settings, draft.calendar),
    note: draft.note?.trim() || undefined,
    amount: kind === "bill" ? draft.amount : undefined,
    currency: kind === "bill" ? draft.currency ?? settings.bill.currency : undefined,
    payment: kind === "bill" ? draft.payment : undefined,
    location: kind === "idea" ? undefined : draft.location?.trim() || undefined,
    tags: draft.tags?.filter(Boolean),
    images: draft.images?.filter(Boolean),
    priority: kind === "idea" ? undefined : draft.priority,
    urgency: kind === "idea" ? undefined : draft.urgency,
    recurrence,
    recurringDays: recurrence === "weekly" ? normalizeRecurringDays(draft.recurringDays) : undefined,
    recurringEnd,
    ...recurrenceMetadata,
    recurrenceSourceId: undefined,
    occurrenceDate: undefined,
    reminder: kind === "idea" ? "none" : (draft.reminder ?? "none"),
  };
}

/** Store a date/time move for one occurrence while retaining one canonical series line. */
export function entryWithOccurrenceMove(
  source: Entry,
  occurrenceDate: string,
  draft: Pick<EntryDraft, "date" | "start" | "end" | "endDate" | "allDay">,
): Entry {
  if (!source.recurrence || source.recurrence === "none" || !isIsoDate(occurrenceDate) || !isIsoDate(draft.date)) {
    throw new Error("A valid recurring occurrence is required");
  }
  const allDay = Boolean(draft.allDay);
  const begin = !allDay && draft.start ? `${draft.date} ${draft.start}` : draft.date;
  const sourceEndDate = source.endDate && isIsoDate(source.endDate) && source.endDate > source.date ? source.endDate : undefined;
  const preservedEndDate = sourceEndDate && isIsoDate(source.date)
    ? addIsoDays(draft.date, differenceInIsoDays(sourceEndDate, source.date))
    : undefined;
  const endDate = normalizeEndDate(draft.date, draft.endDate) ?? preservedEndDate ?? draft.date;
  const end = !allDay && draft.end ? `${endDate} ${draft.end}` : undefined;
  return {
    ...source,
    recurrenceMoves: {
      ...(source.recurrenceMoves ?? {}),
      [occurrenceDate]: { begin, end },
    },
  };
}

/** Toggle one recurring task occurrence without completing every future task. */
export function entryWithOccurrenceStatus(
  source: Entry,
  occurrenceDate: string,
  status: EntryStatus,
  changedAt = new Date().toISOString(),
): Entry {
  if (source.kind !== "task" || !source.recurrence || source.recurrence === "none" || !isIsoDate(occurrenceDate)) {
    return { ...source, status };
  }
  const exceptions = { ...(source.recurrenceExceptions ?? {}) };
  const sourceStatus = source.status ?? "open";
  if (status === sourceStatus) {
    delete exceptions[occurrenceDate];
  } else {
    exceptions[occurrenceDate] = {
      status,
      doneAt: status === "done" ? changedAt : undefined,
      cancelledAt: status === "cancelled" ? changedAt : undefined,
    };
  }
  return {
    ...source,
    recurrenceExceptions: Object.keys(exceptions).length ? exceptions : undefined,
  };
}
