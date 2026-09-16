import type { Entry, Locale } from "./entry";
import { formatCalendarItemTimeRange } from "./formatting";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK_TIME = /^(\d{1,2}):(\d{2})$/;
const MAX_DATE_RANGE = 20_000;

export type CrossDayClassification = "single-day" | "cross-day-short" | "cross-day-long";

export interface EntryDaySegment {
  entry: Entry;
  date: string;
  startMinutes: number;
  endMinutes: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export interface OverlapPlacement extends EntryDaySegment {
  column: number;
  columnCount: number;
  /** Stable collision-group id used by renderers for bounded overflow UI. */
  groupId: number;
}

export interface CalendarDateTimeSegment {
  date: string;
  startMinutes: number;
  endMinutes: number;
}

export interface TimedOverlapInput {
  id: string;
  startMinutes: number;
  endMinutes: number;
  minimumMinutes?: number;
  status?: Entry["status"] | "todo" | "inprogress";
  priority?: Entry["priority"];
  urgency?: Entry["urgency"];
}

export interface TimedOverlapPlacement {
  id: string;
  column: number;
  columnCount: number;
  groupId: number;
}

export const TIMED_ITEM_MIN_PX = 21;
export const TIMED_ITEM_MIN_MINUTES = 20;
export const BILL_ITEM_MIN_PX = 22;
export const BILL_ITEM_MIN_MINUTES = 15;

export function timedItemMinHeightPx(isBill: boolean, pixelsPerMinute: number): number {
  return isBill
    ? Math.max(BILL_ITEM_MIN_PX, BILL_ITEM_MIN_MINUTES * pixelsPerMinute)
    : Math.max(TIMED_ITEM_MIN_PX, TIMED_ITEM_MIN_MINUTES * pixelsPerMinute);
}

export function timedItemFootprintMinutes(isBill: boolean, pixelsPerMinute?: number): number {
  if (!pixelsPerMinute || pixelsPerMinute <= 0) {
    return isBill ? BILL_ITEM_MIN_MINUTES : TIMED_ITEM_MIN_MINUTES;
  }
  return timedItemMinHeightPx(isBill, pixelsPerMinute) / pixelsPerMinute;
}

function parseIsoDate(value: string): Date | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date
    : null;
}

function formatUtcDate(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

export function isIsoDate(value: string): boolean {
  return parseIsoDate(value) !== null;
}

export function compareIsoDates(left: string, right: string): number {
  if (!isIsoDate(left) || !isIsoDate(right)) throw new Error("Expected valid ISO calendar dates");
  return left.localeCompare(right);
}

export function addIsoDays(value: string, amount: number): string {
  const date = parseIsoDate(value);
  if (!date || !Number.isInteger(amount)) throw new Error("Expected a valid ISO date and whole-day offset");
  date.setUTCDate(date.getUTCDate() + amount);
  return formatUtcDate(date);
}

export function differenceInIsoDays(later: string, earlier: string): number {
  const laterDate = parseIsoDate(later);
  const earlierDate = parseIsoDate(earlier);
  if (!laterDate || !earlierDate) throw new Error("Expected valid ISO calendar dates");
  return Math.round((laterDate.getTime() - earlierDate.getTime()) / 86_400_000);
}

export function isoDateRange(start: string, end: string, limit = MAX_DATE_RANGE): string[] {
  if (compareIsoDates(start, end) > 0) return [];
  const length = differenceInIsoDays(end, start) + 1;
  if (length > limit) throw new Error(`Date range exceeds ${limit} days`);
  return Array.from({ length }, (_, index) => addIsoDays(start, index));
}

export function parseClockMinutes(value?: string): number | null {
  if (!value) return null;
  const match = CLOCK_TIME.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59
    ? hours * 60 + minutes
    : null;
}

export function formatClockMinutes(value: number): string {
  if (!Number.isFinite(value)) throw new Error("Expected a finite minute value");
  const bounded = Math.min(24 * 60, Math.max(0, Math.round(value)));
  if (bounded === 24 * 60) return "24:00";
  return `${String(Math.floor(bounded / 60)).padStart(2, "0")}:${String(bounded % 60).padStart(2, "0")}`;
}

/**
 * Return the inclusive civil end date used by all calendar projections. An
 * overnight range may be stored as `date 23:00` ? `01:00` without an explicit
 * end date; infer the next civil date once, centrally.
 */
export function effectiveEntryEndDate(entry: Pick<Entry, "date" | "start" | "end" | "endDate">): string {
  if (entry.endDate && isIsoDate(entry.endDate) && compareIsoDates(entry.endDate, entry.date) >= 0) return entry.endDate;
  const start = parseClockMinutes(entry.start);
  const end = parseClockMinutes(entry.end);
  if (start !== null && end !== null && end < start) return addIsoDays(entry.date, 1);
  return entry.date;
}

/** True when the item's full range has ended by `nowMinutes` on `todayKey`. */
export function isEntryPast(
  entry: Pick<Entry, "date" | "start" | "end" | "endDate" | "allDay">,
  todayKey: string,
  nowMinutes: number,
): boolean {
  const endDate = effectiveEntryEndDate(entry);
  if (compareIsoDates(endDate, todayKey) < 0) return true;
  if (compareIsoDates(endDate, todayKey) > 0) return false;
  if (entry.allDay || !entry.start) return false;
  const startMinutes = parseClockMinutes(entry.start) ?? 0;
  const endMinutes = parseClockMinutes(entry.end) ?? startMinutes + 30;
  return endMinutes <= nowMinutes;
}

export function recurrenceOccursOnDate(entry: Entry, date: string): boolean {
  if (!entry.recurrence || entry.recurrence === "none") return date === entry.date;
  if (compareIsoDates(date, entry.date) < 0) return false;
  if (entry.recurringEnd && isIsoDate(entry.recurringEnd) && compareIsoDates(date, entry.recurringEnd) > 0) return false;

  const anchor = parseIsoDate(entry.date);
  const target = parseIsoDate(date);
  if (!anchor || !target) return false;
  if (entry.recurrence === "daily") return true;
  if (entry.recurrence === "weekly") {
    const weekdays = entry.recurringDays?.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
    return new Set(weekdays?.length ? weekdays : [anchor.getUTCDay()]).has(target.getUTCDay());
  }
  if (entry.recurrence === "monthly") return target.getUTCDate() === anchor.getUTCDate();
  return target.getUTCMonth() === anchor.getUTCMonth() && target.getUTCDate() === anchor.getUTCDate();
}

function scheduledEntryOccursOnDate(entry: Entry, date: string): boolean {
  if (!entry.recurrence || entry.recurrence === "none") {
    const endDate = effectiveEntryEndDate(entry);
    return compareIsoDates(date, entry.date) >= 0 && compareIsoDates(date, endDate) <= 0;
  }
  if (compareIsoDates(date, entry.date) < 0) return false;
  if (entry.recurringEnd && isIsoDate(entry.recurringEnd) && compareIsoDates(date, entry.recurringEnd) > 0) return false;

  const anchor = parseIsoDate(entry.date);
  const target = parseIsoDate(date);
  if (!anchor || !target) return false;
  if (entry.recurrence === "daily") return true;
  if (entry.recurrence === "weekly") {
    const weekdays = entry.recurringDays?.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
    return new Set(weekdays?.length ? weekdays : [anchor.getUTCDay()]).has(target.getUTCDay());
  }
  if (entry.recurrence === "monthly") return target.getUTCDate() === anchor.getUTCDate();
  return target.getUTCMonth() === anchor.getUTCMonth() && target.getUTCDate() === anchor.getUTCDate();
}

function parseCalendarStamp(value?: string): { date: string; time?: string } | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):([0-5]\d)(?::[0-5]\d)?)?$/.exec(value.trim());
  if (!match || !isIsoDate(match[1])) return null;
  return {
    date: match[1],
    time: match[2] === undefined ? undefined : `${match[2].padStart(2, "0")}:${match[3]}`
  };
}

function recurrenceVisibleOnDate(entry: Entry, date: string): boolean {
  const plain: Entry = {
    ...entry,
    recurrence: "none",
    recurringDays: undefined,
    recurringEnd: undefined,
    recurrenceExceptions: undefined,
    recurrenceMoves: undefined,
    recurrenceSourceId: undefined,
    occurrenceDate: undefined
  };
  if (!plain.recurrence || plain.recurrence === "none") {
    return scheduledEntryOccursOnDate(plain, date);
  }
  const endDate = effectiveEntryEndDate(plain);
  const spanDays = differenceInIsoDays(endDate, plain.date);
  for (let offset = 0; offset <= spanDays; offset += 1) {
    if (scheduledEntryOccursOnDate(plain, addIsoDays(date, -offset))) return true;
  }
  return false;
}

function occurrenceCandidates(entry: Entry, date: string, spanDays: number): string[] {
  const candidates = new Set<string>();
  // A normal occurrence can begin at most `spanDays` days before the visible
  // date when the series contains a cross-day range.
  for (let offset = 0; offset <= spanDays; offset += 1) {
    candidates.add(addIsoDays(date, -offset));
  }
  // A moved occurrence may land arbitrarily far away, so its finite metadata
  // keys are also considered. This keeps the index bounded by user data.
  Object.keys(entry.recurrenceMoves ?? {}).forEach((candidate) => {
    if (isIsoDate(candidate)) candidates.add(candidate);
  });
  return [...candidates].filter((candidate) => scheduledEntryOccursOnDate(entry, candidate));
}

/** Materialize one recurring occurrence without changing the source record. */
export function projectEntryOccurrence(entry: Entry, occurrenceDate: string): Entry {
  const move = entry.recurrenceMoves?.[occurrenceDate];
  const exception = entry.recurrenceExceptions?.[occurrenceDate];
  const sourceEndDate = effectiveEntryEndDate(entry);
  const spanDays = differenceInIsoDays(sourceEndDate, entry.date);
  let projected: Entry = {
    ...entry,
    id: `${entry.id}::recurrence::${occurrenceDate}`,
    recurrenceSourceId: entry.id,
    occurrenceDate,
    date: occurrenceDate,
    endDate: spanDays > 0 ? addIsoDays(occurrenceDate, spanDays) : undefined
  };

  if (move) {
    const begin = parseCalendarStamp(move.begin);
    const end = parseCalendarStamp(move.end);
    if (begin) {
      projected = {
        ...projected,
        date: begin.date,
        start: begin.time,
        end: end?.time,
        endDate: end && end.date !== begin.date ? end.date : undefined,
        allDay: begin.time === undefined
      };
    }
  }

  if (exception && projected.kind === "task") {
    projected = {
      ...projected,
      status: exception.status,
      doneAt: exception.doneAt,
      cancelledAt: exception.cancelledAt
    };
  }
  return projected;
}

export function entryOccursOnDate(entry: Entry, date: string): boolean {
  if (!isIsoDate(entry.date) || !isIsoDate(date)) return false;
  const endDate = effectiveEntryEndDate(entry);
  const spanDays = differenceInIsoDays(endDate, entry.date);

  if (!entry.recurrence || entry.recurrence === "none") return scheduledEntryOccursOnDate(entry, date);
  return occurrenceCandidates(entry, date, spanDays).some((candidate) => {
    const projected = projectEntryOccurrence(entry, candidate);
    return recurrenceVisibleOnDate(projected, date);
  });
}

/** Materialize recurrence anchors as bounded civil dates (never persisted). */
export function recurrenceOccurrenceDates(
  entry: Entry,
  rangeStart: string,
  rangeEnd: string,
  limit = MAX_DATE_RANGE
): string[] {
  if (!isIsoDate(entry.date) || !isIsoDate(rangeStart) || !isIsoDate(rangeEnd)) return [];
  return isoDateRange(rangeStart, rangeEnd, limit).filter((date) => scheduledEntryOccursOnDate(entry, date));
}

export function entriesForDate(entries: Entry[], date: string): Entry[] {
  return entries.flatMap((entry) => {
    if (!entry.recurrence || entry.recurrence === "none") {
      return scheduledEntryOccursOnDate(entry, date) ? [entry] : [];
    }
    const endDate = effectiveEntryEndDate(entry);
    const spanDays = differenceInIsoDays(endDate, entry.date);
    return occurrenceCandidates(entry, date, spanDays)
      .map((candidate) => projectEntryOccurrence(entry, candidate))
      .filter((projected) => recurrenceVisibleOnDate(projected, date));
  });
}

/**
 * Project a range once and group its visible entries by civil date. This is the
 * shared fast path for statistics: expanding every day against every entry is
 * quadratic and becomes especially expensive with recurring or cross-day rows.
 */
export function entriesByDateRange(
  entries: Entry[],
  rangeStart: string,
  rangeEnd: string,
): Map<string, Entry[]> {
  if (!isIsoDate(rangeStart) || !isIsoDate(rangeEnd) || compareIsoDates(rangeEnd, rangeStart) < 0) {
    return new Map();
  }

  const grouped = new Map<string, Entry[]>(isoDateRange(rangeStart, rangeEnd).map((date) => [date, []]));
  const overlapStart = (left: string, right: string) => (compareIsoDates(left, right) > 0 ? left : right);
  const overlapEnd = (left: string, right: string) => (compareIsoDates(left, right) < 0 ? left : right);

  for (const entry of entries) {
    if (!isIsoDate(entry.date)) continue;
    const endDate = effectiveEntryEndDate(entry);
    if (compareIsoDates(endDate, rangeStart) < 0 || compareIsoDates(entry.date, rangeEnd) > 0) continue;

    if (!entry.recurrence || entry.recurrence === "none") {
      for (let date = overlapStart(entry.date, rangeStart); compareIsoDates(date, overlapEnd(endDate, rangeEnd)) <= 0; date = addIsoDays(date, 1)) {
        grouped.get(date)?.push(entry);
      }
      continue;
    }

    const spanDays = differenceInIsoDays(endDate, entry.date);
    const candidates = new Set(recurrenceOccurrenceDates(entry, addIsoDays(rangeStart, -spanDays), rangeEnd));
    for (const movedFrom of Object.keys(entry.recurrenceMoves ?? {})) {
      if (isIsoDate(movedFrom) && scheduledEntryOccursOnDate(entry, movedFrom)) candidates.add(movedFrom);
    }

    for (const occurrenceDate of candidates) {
      const projected = projectEntryOccurrence(entry, occurrenceDate);
      const projectedEnd = effectiveEntryEndDate(projected);
      if (compareIsoDates(projectedEnd, rangeStart) < 0 || compareIsoDates(projected.date, rangeEnd) > 0) continue;
      for (
        let date = overlapStart(projected.date, rangeStart);
        compareIsoDates(date, overlapEnd(projectedEnd, rangeEnd)) <= 0;
        date = addIsoDays(date, 1)
      ) {
        if (recurrenceVisibleOnDate(projected, date)) grouped.get(date)?.push(projected);
      }
    }
  }

  return grouped;
}

export function classifyCrossDayEntry(entry: Pick<Entry, "date" | "start" | "end" | "endDate">): CrossDayClassification {
  if (!isIsoDate(entry.date)) return "single-day";
  const endDate = entry.endDate && isIsoDate(entry.endDate) ? entry.endDate : entry.date;
  if (compareIsoDates(endDate, entry.date) < 0) return "single-day";
  const dayMinutes = differenceInIsoDays(endDate, entry.date) * 24 * 60;
  const start = parseClockMinutes(entry.start) ?? 0;
  const end = parseClockMinutes(entry.end) ?? 24 * 60;
  let duration = dayMinutes + end - start;
  if (duration < 0 && endDate === entry.date) duration += 24 * 60;
  if (duration <= 0) return "single-day";
  if (endDate === entry.date && end >= start) return "single-day";
  return duration <= 24 * 60 ? "cross-day-short" : "cross-day-long";
}

function dateTimeParts(value?: string): { date: string; minutes: number } | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/.exec(value.trim());
  if (!match || !isIsoDate(match[1])) return null;
  const hours = Number(match[2]);
  if (hours < 0 || hours > 23) return null;
  return { date: match[1], minutes: hours * 60 + Number(match[3]) };
}

/** Classify full calendar stamps without using timezone-sensitive Date parsing. */
export function classifyCrossDayDateTimes(begin?: string, end?: string): CrossDayClassification {
  const start = dateTimeParts(begin);
  const finish = dateTimeParts(end);
  if (!start || !finish) return "single-day";
  // Full date-time records with a reversed time on the same civil date are
  // malformed point-like ranges. Canonical crossing-midnight records carry
  // the next date.
  if (start.date === finish.date && finish.minutes >= start.minutes) return "single-day";
  return classifyCrossDayEntry({
    date: start.date,
    start: formatClockMinutes(start.minutes),
    end: formatClockMinutes(finish.minutes),
    endDate: finish.date
  });
}

/** Split a civil date-time range into visible per-day time-grid segments. */
export function splitCrossDayDateTimeRange(begin: string, end: string): CalendarDateTimeSegment[] {
  const start = dateTimeParts(begin);
  const finish = dateTimeParts(end);
  if (!start || !finish || compareIsoDates(finish.date, start.date) < 0) return [];

  let endDate = finish.date;
  if (endDate === start.date && finish.minutes < start.minutes) endDate = addIsoDays(endDate, 1);
  const dates = isoDateRange(start.date, endDate);
  return dates.flatMap((date) => {
    const startMinutes = date === start.date ? start.minutes : 0;
    const endMinutes = date === endDate ? finish.minutes : 24 * 60;
    return endMinutes > startMinutes ? [{ date, startMinutes, endMinutes }] : [];
  });
}

export function entrySegmentForDate(entry: Entry, date: string): EntryDaySegment | null {
  const visibleEntry = entry.recurrenceSourceId
    ? entry
    : (entry.recurrence && entry.recurrence !== "none" ? entriesForDate([entry], date)[0] : entry);
  if (!visibleEntry || !recurrenceVisibleOnDate(visibleEntry, date)) return null;
  const occurrenceStart = visibleEntry.date;
  const occurrenceEnd = effectiveEntryEndDate(visibleEntry);
  const continuesBefore = compareIsoDates(date, occurrenceStart) > 0;
  const continuesAfter = compareIsoDates(date, occurrenceEnd) < 0;
  const startMinutes = continuesBefore ? 0 : (parseClockMinutes(visibleEntry.start) ?? 0);
  let endMinutes = continuesAfter
    ? 24 * 60
    : (parseClockMinutes(visibleEntry.end) ?? (visibleEntry.allDay ? 24 * 60 : startMinutes + 30));
  if (endMinutes <= startMinutes) endMinutes = Math.min(24 * 60, startMinutes + 30);

  return { entry: visibleEntry, date, startMinutes, endMinutes, continuesBefore, continuesAfter };
}

const PRIORITY_RANK: Record<string, number> = {
  high: 0,
  normal: 1,
  low: 2
};

const STATUS_RANK: Record<string, number> = {
  "in-progress": 0,
  inprogress: 0,
  open: 1,
  todo: 1,
  done: 2,
  cancelled: 3
};

/**
 * Generic semantic overlap packing used by both desktop projections and the
 * Calendar renderers. Minimum footprints reserve the same visual
 * height that renderers apply to very short items.
 */
export function layoutTimedOverlaps(inputs: TimedOverlapInput[]): TimedOverlapPlacement[] {
  if (!inputs.length) return [];
  const normalized = inputs.map((input, index) => ({
    ...input,
    index,
    visualEnd: Math.max(input.endMinutes, input.startMinutes + Math.max(0, input.minimumMinutes ?? 0))
  }));
  const parent = normalized.map((_, index) => index);
  const find = (index: number): number => {
    if (parent[index] !== index) parent[index] = find(parent[index]);
    return parent[index];
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };

  for (let left = 0; left < normalized.length; left += 1) {
    for (let right = left + 1; right < normalized.length; right += 1) {
      if (normalized[left].startMinutes < normalized[right].visualEnd
        && normalized[left].visualEnd > normalized[right].startMinutes) union(left, right);
    }
  }

  const groups = new Map<number, typeof normalized>();
  normalized.forEach((input) => {
    const root = find(input.index);
    const group = groups.get(root) ?? [];
    group.push(input);
    groups.set(root, group);
  });

  const placements: TimedOverlapPlacement[] = [];
  for (const [groupId, group] of groups) {
    group.sort((left, right) => {
      const status = (STATUS_RANK[left.status ?? "open"] ?? 1) - (STATUS_RANK[right.status ?? "open"] ?? 1);
      if (status) return status;
      const priority = (PRIORITY_RANK[left.priority ?? "normal"] ?? 1) - (PRIORITY_RANK[right.priority ?? "normal"] ?? 1);
      if (priority) return priority;
      const urgency = (PRIORITY_RANK[left.urgency ?? "normal"] ?? 1) - (PRIORITY_RANK[right.urgency ?? "normal"] ?? 1);
      if (urgency) return urgency;
      return left.startMinutes - right.startMinutes
        || (right.endMinutes - right.startMinutes) - (left.endMinutes - left.startMinutes)
        || left.index - right.index;
    });
    const laneEnds: number[] = [];
    const staged: Array<{ id: string; column: number }> = [];
    for (const input of group) {
      let column = laneEnds.findIndex((end) => end <= input.startMinutes);
      if (column < 0) {
        column = laneEnds.length;
        laneEnds.push(input.visualEnd);
      } else {
        laneEnds[column] = input.visualEnd;
      }
      staged.push({ id: input.id, column });
    }
    staged.forEach((placement) => placements.push({
      ...placement,
      columnCount: laneEnds.length,
      groupId
    }));
  }
  return placements;
}

/**
 * Assign the smallest available overlap column and the maximum column count
 * for each collision group. Touching ranges (end === next start) do not collide.
 */
export function layoutOverlappingEntries(entries: Entry[], date: string, pixelsPerMinute?: number): OverlapPlacement[] {
  const segments = entries
    .map((entry) => entrySegmentForDate(entry, date))
    .filter((segment): segment is EntryDaySegment => Boolean(segment))
    .sort((left, right) => left.startMinutes - right.startMinutes || left.endMinutes - right.endMinutes || left.entry.id.localeCompare(right.entry.id));
  if (!segments.length) return [];

  // The renderer gives point-like bills and very short entries a minimum pixel
  // height. Packing must reserve that same visual footprint or two blocks that
  // do not overlap in civil minutes can still paint on top of one another.
  const packed = layoutTimedOverlaps(segments.map((segment, index) => {
    const footprint = timedItemFootprintMinutes(segment.entry.kind === "bill", pixelsPerMinute);
    const visualEnd = Math.min(segment.endMinutes, 24 * 60);
    // A chip clamped against midnight paints upward from its nominal start.
    // Reserve that painted start, not the clock start, so two visually
    // touching end-of-day blocks still receive separate columns.
    const paintedStart = visualEnd + footprint > 24 * 60
      ? Math.min(segment.startMinutes, Math.max(0, 24 * 60 - footprint))
      : segment.startMinutes;
    return {
      id: `${segment.entry.id}:${segment.date}:${index}`,
      startMinutes: paintedStart,
      endMinutes: segment.endMinutes,
      minimumMinutes: footprint,
      status: segment.entry.status,
      priority: segment.entry.priority,
      urgency: segment.entry.urgency,
    };
  }));
  const placementById = new Map(packed.map((placement) => [placement.id, placement]));

  return segments.map((segment, index) => {
    const id = `${segment.entry.id}:${segment.date}:${index}`;
    const placement = placementById.get(id);
    return {
      ...segment,
      column: placement?.column ?? 0,
      columnCount: placement?.columnCount ?? 1,
      groupId: placement?.groupId ?? index,
    };
  });
}


export type CalendarDragEdge = "move" | "resize-start" | "resize-end";

export interface CalendarDragDelta {
  /** Whole civil days moved horizontally. */
  days?: number;
  /** Minutes moved vertically; callers should snap this to their grid. */
  minutes?: number;
  edge?: CalendarDragEdge;
}

export interface CalendarSchedulePatch {
  date: string;
  start?: string;
  end?: string;
  endDate?: string;
  allDay?: boolean;
}

function floorDayMinutes(value: number): { days: number; minutes: number } {
  const days = Math.floor(value / (24 * 60));
  return { days, minutes: value - days * 24 * 60 };
}

function scheduleFromAbsolute(baseDate: string, startAbsolute: number, endAbsolute?: number): CalendarSchedulePatch {
  const start = floorDayMinutes(startAbsolute);
  const date = addIsoDays(baseDate, start.days);
  if (endAbsolute === undefined) {
    return { date, start: formatClockMinutes(start.minutes) };
  }
  const end = floorDayMinutes(endAbsolute);
  const endDate = addIsoDays(baseDate, end.days);
  return {
    date,
    start: formatClockMinutes(start.minutes),
    end: formatClockMinutes(end.minutes),
    endDate: endDate !== date ? endDate : undefined,
    allDay: false,
  };
}

/**
 * Apply a snapped calendar drag without going through timezone-sensitive Date
 * arithmetic. The same projection is used by the standalone Day/Week view
 * across every view.
 */
export function applyCalendarDrag(entry: Pick<Entry, "date" | "start" | "end" | "endDate" | "allDay">, delta: CalendarDragDelta): CalendarSchedulePatch {
  if (!isIsoDate(entry.date)) throw new Error("A valid ISO entry date is required");
  const days = Math.trunc(delta.days ?? 0);
  const minutes = Math.trunc(delta.minutes ?? 0);
  const edge = delta.edge ?? "move";

  const sourceEndDate = effectiveEntryEndDate(entry);
  const sourceSpan = differenceInIsoDays(sourceEndDate, entry.date);

  if (entry.allDay || !entry.start) {
    if (edge === "resize-start") {
      const nextDate = addIsoDays(entry.date, days);
      const bounded = compareIsoDates(nextDate, sourceEndDate) > 0 ? sourceEndDate : nextDate;
      return { date: bounded, endDate: bounded !== sourceEndDate ? sourceEndDate : undefined, allDay: true };
    }
    if (edge === "resize-end") {
      const nextDate = addIsoDays(sourceEndDate, days);
      const bounded = compareIsoDates(nextDate, entry.date) < 0 ? entry.date : nextDate;
      return { date: entry.date, endDate: bounded !== entry.date ? bounded : undefined, allDay: true };
    }
    const nextDate = addIsoDays(entry.date, days);
    return {
      date: nextDate,
      endDate: sourceSpan ? addIsoDays(sourceEndDate, days) : undefined,
      allDay: true,
    };
  }

  const startMinutes = parseClockMinutes(entry.start) ?? 0;
  const parsedEnd = parseClockMinutes(entry.end);
  const endMinutes = parsedEnd ?? startMinutes + 30;
  const inferredOvernightDays = sourceSpan === 0 && parsedEnd !== null && parsedEnd < startMinutes ? 1 : 0;
  const endAbsolute = Math.max(sourceSpan, inferredOvernightDays) * 24 * 60 + endMinutes;
  const deltaAbsolute = days * 24 * 60 + minutes;

  if (edge === "resize-start") {
    // scheduleFromAbsolute owns negative absolute times, so a start edge can
    // cross midnight into an earlier civil day without wrapping the clock.
    const nextStart = Math.min(startMinutes + deltaAbsolute, endAbsolute - 15);
    return scheduleFromAbsolute(entry.date, nextStart, endAbsolute);
  }
  if (edge === "resize-end") {
    const nextEnd = Math.max(endAbsolute + deltaAbsolute, startMinutes + 15);
    return scheduleFromAbsolute(entry.date, startMinutes, nextEnd);
  }

  const nextStart = startMinutes + deltaAbsolute;
  const duration = Math.max(15, endAbsolute - startMinutes);
  const patch = scheduleFromAbsolute(entry.date, nextStart, parsedEnd === null ? undefined : nextStart + duration);
  return {
    ...patch,
    endDate: parsedEnd === null ? undefined : patch.endDate,
    allDay: false,
  };
}

/** Number of civil dates touched by a timed entry's half-open range. */
export function occupiedEntryDaySpan(entry: Pick<Entry, "date" | "start" | "end" | "endDate">): number {
  if (!isIsoDate(entry.date)) return 1;
  let last = effectiveEntryEndDate(entry);
  // Midnight is the exclusive bottom edge of the previous day, not a second
  // occupied date. This preserves all-day conversion behavior.
  if (last !== entry.date && parseClockMinutes(entry.end) === 0) last = addIsoDays(last, -1);
  return Math.max(1, differenceInIsoDays(last, entry.date) + 1);
}

/** Pull a timed block into the all-day lane while retaining its occupied dates. */
export function convertCalendarEntryToAllDay(
  entry: Pick<Entry, "date" | "start" | "end" | "endDate">,
  sourceSegmentDate: string,
  targetDate: string,
): CalendarSchedulePatch {
  if (!isIsoDate(entry.date) || !isIsoDate(sourceSegmentDate) || !isIsoDate(targetDate)) {
    throw new Error("Valid ISO dates are required for an all-day conversion");
  }
  const movedStart = addIsoDays(entry.date, differenceInIsoDays(targetDate, sourceSegmentDate));
  const span = occupiedEntryDaySpan(entry);
  return {
    date: movedStart,
    endDate: span > 1 ? addIsoDays(movedStart, span - 1) : undefined,
    start: undefined,
    end: undefined,
    allDay: true,
  };
}

/** Pull an all-day/long-range item into a short, snapped time-grid block. */
export function convertCalendarEntryToTimed(
  targetDate: string,
  targetStartMinutes: number,
  durationMinutes = 30,
): CalendarSchedulePatch {
  if (!isIsoDate(targetDate)) throw new Error("A valid ISO target date is required");
  const duration = Math.max(15, Math.round(durationMinutes));
  const latestStart = Math.max(0, 24 * 60 - duration);
  const start = Math.max(0, Math.min(latestStart, Math.round(targetStartMinutes)));
  return scheduleFromAbsolute(targetDate, start, start + duration);
}

export function formatEntryTime(entry: Pick<Entry, "start" | "end" | "allDay" | "endDate" | "date">, locale: Locale): string {
  if (entry.allDay) return locale === "zh" ? "全天" : "All day";
  if (!entry.start) return locale === "zh" ? "随时" : "Anytime";
  return formatCalendarItemTimeRange({
    begin: `${entry.date} ${entry.start}`,
    end: entry.end ? `${entry.endDate ?? entry.date} ${entry.end}` : undefined,
  }, locale);
}

/** Local civil-week helpers shared across projections. */
function startOfLocalIsoWeek(value: Date): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return date;
}

function localIsoWeekYear(value: Date): number {
  const thursday = new Date(value);
  thursday.setDate(thursday.getDate() + (4 - (thursday.getDay() || 7)));
  return thursday.getFullYear();
}

function localIsoWeekNumber(value: Date): number {
  const weekStart = startOfLocalIsoWeek(value);
  const weekYear = localIsoWeekYear(weekStart);
  const firstThursday = new Date(weekYear, 0, 4);
  const firstWeekStart = startOfLocalIsoWeek(firstThursday);
  return Math.floor((weekStart.getTime() - firstWeekStart.getTime()) / 604_800_000) + 1;
}

function localDateParts(value: Date): { year: string; month: string; date: string } {
  return {
    year: String(value.getFullYear()).padStart(4, "0"),
    month: String(value.getMonth() + 1).padStart(2, "0"),
    date: String(value.getDate()).padStart(2, "0")
  };
}

export function getWeeklyFilePath(folder: string, value: Date): string {
  const weekStart = startOfLocalIsoWeek(value);
  const weekYear = localIsoWeekYear(weekStart);
  const weekNumber = String(localIsoWeekNumber(weekStart)).padStart(2, "0");
  const parts = localDateParts(weekStart);
  const month = weekYear !== weekStart.getFullYear() ? "01" : parts.month;
  return `${folder}/${weekYear}/${month}/${weekYear}-W${weekNumber}.md`;
}

export function getDailyFilePath(folder: string, value: Date): string {
  const parts = localDateParts(value);
  return `${folder}/${parts.year}/${parts.month}/${parts.year}-${parts.month}-${parts.date}.md`;
}

export function getWeekStart(value: Date): Date {
  return startOfLocalIsoWeek(value);
}

export function getDatesInWeek(value: Date): Date[] {
  const start = startOfLocalIsoWeek(value);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}
