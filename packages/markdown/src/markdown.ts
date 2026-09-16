import {
  DEFAULT_CHRONOEON_SETTINGS,
  createDeterministicEntryId,
  isStableEntryId,
  narrowEntryPriority,
  resolveEntryColor,
  type ChronoEonSettings,
  type Entry,
  type EntryKind,
  type EntryPriority,
  type EntryStatus,
  type Recurrence,
  type Reminder
} from "@chronoeon/domain";

export interface MarkdownDocument {
  path: string;
  content: string;
}

export interface MarkdownParseOptions {
  settings?: ChronoEonSettings;
  calendarId?: string;
}

export interface MarkdownSerializeOptions {
  /** Return the exact source line. This is explicit so edited entries cannot be silently discarded. */
  preserveSource?: boolean;
  includeId?: boolean;
}

export interface StableIdMigrationPreview {
  path: string;
  lineNumber: number;
  kind: EntryKind;
  title: string;
  previousId?: string;
  proposedId: string;
  reason: "missing" | "invalid";
  before: string;
  after: string;
}

/**
 * Markdown V2 keeps the searchable V1 entry line and stores long-form body
 * content in a quoted block. The HTML comments are inert in normal Markdown
 * renderers, while the `> ` prefix keeps body lines from being mistaken for
 * another V1 list entry.
 *
 * <!-- chronoeon:entry -->
 * - #idea ... [id:: uuid]
 * <!-- chronoeon:body -->
 * > A paragraph
>
> A second paragraph
 * <!-- /chronoeon:body -->
 * <!-- /chronoeon:entry -->
 */
export interface MarkdownV2Block {
  entry: Entry;
  raw: string;
  lineNumber: number;
}

interface MetadataToken {
  key: string;
  value: string;
  raw: string;
}

const ENTRY_LINE = /^\s*[-*]\s+(?:\[([ xX\-\/\\])\]\s+)?#(task|event|bill|idea|blink)\b/i;
const V2_ENTRY_START = /^\s*<!--\s*chronoeon:entry\s*-->\s*$/i;
const V2_ENTRY_END = /^\s*<!--\s*\/chronoeon:entry\s*-->\s*$/i;
const V2_BODY_START = /^\s*<!--\s*chronoeon:body\s*-->\s*$/i;
const V2_BODY_END = /^\s*<!--\s*\/chronoeon:body\s*-->\s*$/i;
const HEADING_DATE = /^#{1,6}\s+(\d{4}-\d{2}-\d{2})\b/;
const DATE_VALUE = /(\d{4}-\d{2}-\d{2})/;
const TIME_VALUE = /(?:^|[ T])(\d{1,2}):([0-5]\d)(?::[0-5]\d)?(?:$|\s)/;
const METADATA = /\[([A-Za-z][A-Za-z0-9_-]*)\s*:{1,2}\s*([^\]]*)\]/g;

const MODELED_FIELDS = new Set([
  "id", "begin", "end", "date", "allday", "created", "done", "cancelled", "status",
  "calendar", "category", "priority", "urgency", "location", "description", "recurring",
  "recurringend", "recurrenceexceptions", "recurrencemoves", "reminder", "amount", "currency", "payment", "tags", "images"
]);

function parseMetadata(line: string): { fields: Record<string, string>; tokens: MetadataToken[] } {
  const fields: Record<string, string> = {};
  const tokens: MetadataToken[] = [];
  for (const match of line.matchAll(METADATA)) {
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    fields[key] = value;
    tokens.push({ key, value, raw: match[0] });
  }
  return { fields, tokens };
}

function dateFromPath(path: string): string | undefined {
  return path.match(/(?:^|\/)(\d{4}-\d{2}-\d{2})(?:\.md|\/|$)/)?.[1];
}

function datePart(value?: string): string | undefined {
  return value?.match(DATE_VALUE)?.[1];
}

function timePart(value?: string): string | undefined {
  const match = value?.match(TIME_VALUE);
  if (!match) return undefined;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function stableLegacyId(path: string, lineNumber: number, title: string): string {
  let hash = 2166136261;
  const value = `${path}:${lineNumber}:${title}`;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `legacy-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function normalizeStatus(checkbox: string | undefined, explicit: string | undefined): EntryStatus {
  const status = explicit?.toLowerCase().replace(/[_\s]/g, "-");
  if (status === "done" || checkbox?.toLowerCase() === "x") return "done";
  if (status === "cancelled" || status === "canceled" || checkbox === "-") return "cancelled";
  if (status === "inprogress" || status === "in-progress" || checkbox === "/" || checkbox === "\\") return "in-progress";
  return "open";
}

function listValue(value?: string): string[] | undefined {
  const values = value?.split(",").map((entry) => entry.trim()).filter(Boolean);
  return values?.length ? values : undefined;
}

function recurrenceValue(value?: string): { recurrence: Recurrence; days?: number[] } {
  const [rawKind, ...rawDays] = value?.split(",").map((entry) => entry.trim()) ?? [];
  const recurrence: Recurrence = rawKind === "daily" || rawKind === "weekly" || rawKind === "monthly" || rawKind === "yearly"
    ? rawKind
    : "none";
  const days = rawDays.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  return { recurrence, days: days.length ? days : undefined };
}

function recurrenceExceptionsValue(value?: string): Entry["recurrenceExceptions"] {
  if (!value) return undefined;
  const result: NonNullable<Entry["recurrenceExceptions"]> = {};
  for (const part of value.split("|")) {
    const match = /^(\d{4}-\d{2}-\d{2})=(todo|open|done|inprogress|in-progress|cancelled|canceled)(?:@(.+))?$/i.exec(part.trim());
    if (!match) continue;
    const rawStatus = match[2].toLowerCase();
    const status = rawStatus === "todo" ? "open"
      : rawStatus === "inprogress" ? "in-progress"
        : rawStatus === "canceled" ? "cancelled"
          : rawStatus as Entry["status"];
    if (!status) continue;
    const timestamp = match[3]?.replace("T", " ");
    result[match[1]] = {
      status,
      doneAt: status === "done" ? timestamp : undefined,
      cancelledAt: status === "cancelled" ? timestamp : undefined
    };
  }
  return Object.keys(result).length ? result : undefined;
}

function recurrenceMovesValue(value?: string): Entry["recurrenceMoves"] {
  if (!value) return undefined;
  const result: NonNullable<Entry["recurrenceMoves"]> = {};
  for (const part of value.split("|")) {
    const match = /^(\d{4}-\d{2}-\d{2})=([^~]+)(?:~(.*))?$/i.exec(part.trim());
    if (!match) continue;
    const begin = match[2].trim().replace("T", " ");
    const end = match[3]?.trim() ? match[3].trim().replace("T", " ") : undefined;
    if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}:\d{2})?$/.test(begin)) {
      result[match[1]] = { begin, end };
    }
  }
  return Object.keys(result).length ? result : undefined;
}

function booleanValue(value?: string): boolean | undefined {
  if (value?.toLowerCase() === "true") return true;
  if (value?.toLowerCase() === "false") return false;
  return undefined;
}

function priorityValue(value?: string): EntryPriority | undefined {
  // Legacy fine-grained literals remain valid inputs (Markdown is an import
  // format) but project to the narrowed enum via the single legal converter.
  const legacy: string[] = ["lowest", "low", "normal", "medium", "high", "highest"];
  if (!legacy.includes(value ?? "")) return undefined;
  return narrowEntryPriority(value as string) ?? undefined;
}

function reminderValue(value?: string): Reminder {
  const allowed: Reminder[] = [
    "none", "at-time", "5min", "15min", "30min", "1hour", "2hour", "12hour",
    "1day", "1week", "day-9am", "day-before-9am", "day-before-5pm", "week-before-9am"
  ];
  return allowed.includes(value as Reminder) ? value as Reminder : "none";
}

function cleanTitle(line: string, markerEnd: number): string {
  return line
    .slice(markerEnd)
    .replace(METADATA, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseEntryLine(
  line: string,
  path: string,
  lineNumber: number,
  headingDate: string | undefined,
  options: MarkdownParseOptions
): Entry | undefined {
  const marker = line.match(ENTRY_LINE);
  if (!marker || marker.index === undefined) return undefined;

  const rawKind = marker[2].toLowerCase();
  const kind: EntryKind = rawKind === "blink" ? "idea" : rawKind as EntryKind;
  const markerOffset = line.toLowerCase().indexOf(`#${rawKind}`, marker.index);
  const markerEnd = markerOffset + rawKind.length + 1;
  const title = cleanTitle(line, markerEnd);
  if (!title) return undefined;

  const { fields } = parseMetadata(line);
  const begin = fields.begin;
  const endValue = fields.end;
  const created = fields.created;
  const date = datePart(begin)
    ?? datePart(fields.date)
    ?? headingDate
    ?? dateFromPath(path)
    ?? datePart(created);
  if (!date) return undefined;

  const explicitAllDay = booleanValue(fields.allday);
  const beginTime = timePart(begin);
  const createdTime = kind === "idea" ? timePart(created) : undefined;
  const category = fields.category || "uncategorized";
  const calendar = fields.calendar || options.calendarId || "default";
  const amount = fields.amount === undefined ? undefined : Number(fields.amount);
  const recurrence = recurrenceValue(fields.recurring);
  const persistedId = Boolean(fields.id);
  const unknownFields = Object.fromEntries(Object.entries(fields).filter(([key]) => !MODELED_FIELDS.has(key)));
  const settings = options.settings ?? DEFAULT_CHRONOEON_SETTINGS;

  return {
    id: fields.id || stableLegacyId(path, lineNumber, title),
    kind,
    title,
    date,
    start: beginTime ?? createdTime,
    end: timePart(endValue),
    endDate: datePart(endValue),
    allDay: explicitAllDay ?? (kind === "idea" ? !(beginTime || createdTime) : (kind === "task" && !begin)),
    status: kind === "task" ? normalizeStatus(marker[1], fields.status) : undefined,
    doneAt: fields.done,
    cancelledAt: fields.cancelled,
    calendar,
    category,
    color: resolveEntryColor(category, kind, settings, calendar),
    note: fields.description,
    location: fields.location,
    tags: listValue(fields.tags),
    images: listValue(fields.images),
    priority: kind === "idea" ? undefined : priorityValue(fields.priority),
    urgency: kind === "idea" ? undefined : priorityValue(fields.urgency),
    recurrence: recurrence.recurrence,
    recurringDays: recurrence.days,
    recurringEnd: fields.recurringend,
    recurrenceExceptions: recurrenceExceptionsValue(fields.recurrenceexceptions),
    recurrenceMoves: recurrenceMovesValue(fields.recurrencemoves),
    reminder: reminderValue(fields.reminder),
    amount: amount !== undefined && Number.isFinite(amount) ? amount : undefined,
    currency: fields.currency || (kind === "bill" ? settings.bill.currency : undefined),
    payment: fields.payment,
    createdAt: created || `${date} 00:00`,
    source: "markdown",
    filePath: path,
    markdown: {
      path,
      lineNumber,
      raw: line,
      persistedId,
      fields,
      unknownFields: Object.keys(unknownFields).length ? unknownFields : undefined
    }
  };
}

function parseV2Block(
  lines: string[],
  startIndex: number,
  document: MarkdownDocument,
  headingDate: string | undefined,
  options: MarkdownParseOptions
): { block?: MarkdownV2Block; endIndex: number } {
  let endIndex = startIndex + 1;
  while (endIndex < lines.length && !V2_ENTRY_END.test(lines[endIndex])) endIndex += 1;
  if (endIndex >= lines.length) return { endIndex: startIndex };

  const content = lines.slice(startIndex + 1, endIndex);
  const entryIndex = content.findIndex((line) => ENTRY_LINE.test(line));
  if (entryIndex < 0) return { endIndex };
  const entry = parseEntryLine(content[entryIndex], document.path, startIndex + entryIndex + 2, headingDate, options);
  if (!entry) return { endIndex };

  const bodyStart = content.findIndex((line) => V2_BODY_START.test(line));
  let note: string | undefined;
  if (bodyStart >= 0) {
    const bodyEnd = content.findIndex((line, index) => index > bodyStart && V2_BODY_END.test(line));
    const bodyLines = content.slice(bodyStart + 1, bodyEnd >= 0 ? bodyEnd : content.length)
      .filter((line) => /^\s*>/.test(line))
      .map((line) => line.replace(/^\s*> ?/, ""));
    note = bodyLines.join("\n").trimEnd() || undefined;
  }

  const raw = lines.slice(startIndex, endIndex + 1).join("\n");
  return {
    endIndex,
    block: {
      entry: {
        ...entry,
        // A V2 block's long-form text is the single note field; it wins over a
        // one-line [description:: ...] already parsed from the entry line.
        ...(note ? { note } : {}),
        markdown: entry.markdown ? { ...entry.markdown, raw } : entry.markdown
      },
      raw,
      lineNumber: startIndex + 1
    }
  };
}

export function parseMarkdownV2Blocks(
  documents: MarkdownDocument[],
  options: MarkdownParseOptions = {}
): MarkdownV2Block[] {
  const blocks: MarkdownV2Block[] = [];
  for (const document of documents) {
    const lines = document.content.split(/\r?\n/);
    let headingDate: string | undefined;
    for (let index = 0; index < lines.length; index += 1) {
      const heading = lines[index].match(HEADING_DATE);
      if (heading) headingDate = heading[1];
      if (!V2_ENTRY_START.test(lines[index])) continue;
      const parsed = parseV2Block(lines, index, document, headingDate, options);
      if (parsed.block) blocks.push(parsed.block);
      if (parsed.endIndex > index) index = parsed.endIndex;
    }
  }
  return blocks;
}

export function parseMarkdownDocuments(
  documents: MarkdownDocument[],
  options: MarkdownParseOptions = {}
): Entry[] {
  const entries: Entry[] = [];

  for (const document of documents) {
    const lines = document.content.split(/\r?\n/);
    let headingDate: string | undefined;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const heading = line.match(HEADING_DATE);
      if (heading) headingDate = heading[1];
      if (V2_ENTRY_START.test(line)) {
        const parsed = parseV2Block(lines, index, document, headingDate, options);
        if (parsed.block) entries.push(parsed.block.entry);
        if (parsed.endIndex > index) index = parsed.endIndex;
        continue;
      }
      const entry = parseEntryLine(line, document.path, index + 1, headingDate, options);
      if (entry) entries.push(entry);
    }
  }

  return entries;
}

function sourceWithStableId(source: string, id: string, replaceExisting: boolean): string {
  const idField = /\[id\s*:{1,2}\s*[^\]]*\]/i;
  if (replaceExisting && idField.test(source)) return source.replace(idField, `[id:: ${id}]`);

  const firstField = source.match(/\[[A-Za-z][A-Za-z0-9_-]*\s*:{1,2}\s*[^\]]*\]/);
  if (!firstField || firstField.index === undefined) return `${source.trimEnd()} [id:: ${id}]`;
  const before = source.slice(0, firstField.index).trimEnd();
  const after = source.slice(firstField.index).trimStart();
  return `${before} [id:: ${id}] ${after}`;
}

/** Build a deterministic, read-only stable-ID migration preview. */
export function previewStableIdMigration(
  documents: MarkdownDocument[],
  options: MarkdownParseOptions = {}
): StableIdMigrationPreview[] {
  return parseMarkdownDocuments(documents, options).flatMap((entry) => {
    const source = entry.markdown;
    if (!source || (source.persistedId && isStableEntryId(entry.id))) return [];
    const proposedId = createDeterministicEntryId(`${source.path}:${source.lineNumber}:${source.raw}`);
    return [{
      path: source.path,
      lineNumber: source.lineNumber,
      kind: entry.kind,
      title: entry.title,
      previousId: source.persistedId ? entry.id : undefined,
      proposedId,
      reason: source.persistedId ? "invalid" as const : "missing" as const,
      before: source.raw,
      after: sourceWithStableId(source.raw, proposedId, source.persistedId)
    }];
  });
}

function cleanValue(value: string): string {
  return value.replace(/[\r\n\[\]]+/g, " ").trim();
}

function field(key: string, value: string | number | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  return `[${key}:: ${cleanValue(String(value))}]`;
}

function checkboxFor(status?: EntryStatus): string {
  if (status === "done") return "x";
  if (status === "cancelled") return "-";
  if (status === "in-progress") return "/";
  return " ";
}

function recurrenceExceptionsField(entry: Entry): string | undefined {
  const exceptions = entry.recurrenceExceptions;
  if (!exceptions || !Object.keys(exceptions).length) return undefined;
  const value = Object.entries(exceptions)
    .filter(([date, exception]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && exception?.status)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, exception]) => {
      const status = exception.status === "open" ? "todo" : exception.status === "in-progress" ? "inprogress" : exception.status;
      const timestamp = exception.status === "done" ? exception.doneAt : exception.status === "cancelled" ? exception.cancelledAt : undefined;
      return `${date}=${status}${timestamp ? `@${timestamp.replace(" ", "T")}` : ""}`;
    })
    .join("|");
  return value ? field("recurrenceExceptions", value) : undefined;
}

function recurrenceMovesField(entry: Entry): string | undefined {
  const moves = entry.recurrenceMoves;
  if (!moves || !Object.keys(moves).length) return undefined;
  const value = Object.entries(moves)
    .filter(([date, move]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && move?.begin)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, move]) => `${date}=${move.begin.replace(" ", "T")}${move.end ? `~${move.end.replace(" ", "T")}` : ""}`)
    .join("|");
  return value ? field("recurrenceMoves", value) : undefined;
}

function recurringField(entry: Entry): string | undefined {
  if (!entry.recurrence || entry.recurrence === "none") return undefined;
  const suffix = entry.recurrence === "weekly" && entry.recurringDays?.length
    ? `,${entry.recurringDays.join(",")}`
    : "";
  return field("recurring", `${entry.recurrence}${suffix}`);
}

export function serializeEntryV2(entry: Entry): string {
  const baseLine = serializeEntry({ ...entry, note: undefined }, { includeId: true });
  // V2 carries an explicit civil date even for ideas, whose V1 line otherwise
  // derives its date from the file path or created timestamp.
  const line = `${baseLine} [date:: ${cleanValue(entry.date)}]`;
  const body = entry.note;
  const bodyBlock = body
    ? `\n<!-- chronoeon:body -->\n${body.split(/\r?\n/).map((linePart) => linePart ? `> ${linePart}` : ">" ).join("\n")}\n<!-- /chronoeon:body -->`
    : "";
  return `<!-- chronoeon:entry -->\n${line}${bodyBlock}\n<!-- /chronoeon:entry -->`;
}

export function serializeEntry(entry: Entry, options: MarkdownSerializeOptions = {}): string {
  if (options.preserveSource && entry.markdown?.raw) return entry.markdown.raw;

  const prefix = entry.kind === "task"
    ? `- [${checkboxFor(entry.status)}] #task`
    : `- #${entry.kind}`;
  const begin = entry.start ? `${entry.date} ${entry.start}` : entry.date;
  const endDate = entry.endDate || entry.date;
  const end = entry.end ? `${endDate} ${entry.end}` : entry.endDate;
  const fields: Array<string | undefined> = [];

  if (options.includeId !== false) fields.push(field("id", entry.id));
  if (entry.kind !== "idea") {
    if (entry.allDay) fields.push(field("allDay", "true"));
    fields.push(field("begin", begin));
    fields.push(field("end", end));
  } else {
    if (entry.start) fields.push(field("begin", begin));
    if (entry.end || entry.endDate) fields.push(field("end", end));
  }

  if (entry.kind === "task") {
    if (entry.status === "done") fields.push(field("done", entry.doneAt));
    if (entry.status === "cancelled") fields.push(field("cancelled", entry.cancelledAt));
  }
  if (entry.kind === "bill") {
    fields.push(field("amount", entry.amount));
    fields.push(field("currency", entry.currency));
    fields.push(field("payment", entry.payment));
  }

  fields.push(field("location", entry.location));
  fields.push(recurringField(entry));
  fields.push(field("recurringEnd", entry.recurringEnd));
  fields.push(recurrenceExceptionsField(entry));
  fields.push(recurrenceMovesField(entry));
  if (entry.reminder && entry.reminder !== "none") fields.push(field("reminder", entry.reminder));
  fields.push(field("description", entry.note));
  if (entry.kind !== "idea" && entry.priority) fields.push(field("priority", entry.priority));
  if (entry.kind !== "idea" && entry.urgency) fields.push(field("urgency", entry.urgency));
  fields.push(field("created", entry.createdAt.slice(0, 16).replace("T", " ")));
  if (entry.calendar && entry.calendar !== "default") fields.push(field("calendar", entry.calendar));
  if (entry.category && entry.category !== "uncategorized" && entry.category !== "default") fields.push(field("category", entry.category));
  fields.push(field("images", entry.images?.join(",")));
  fields.push(field("tags", entry.tags?.join(",")));

  for (const [key, value] of Object.entries(entry.markdown?.unknownFields ?? {})) {
    fields.push(field(key, value));
  }

  return `${prefix} ${cleanValue(entry.title)}${fields.some(Boolean) ? ` ${fields.filter(Boolean).join(" ")}` : ""}`;
}
