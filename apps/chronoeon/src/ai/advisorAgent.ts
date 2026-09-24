import {
  addIsoDays,
  aggregateBillStats,
  entriesInRange,
  entryDurationMinutes,
  extractAIJson,
  isIsoDate,
  outstandingTaskSections,
  type AIToolCall,
  type AIToolDefinition,
  type EntryKind,
  type EntryStatus,
  type StatsRange,
} from "@chronoeon/domain";
import type { Entry } from "../domain/entry";

export type AdvisorTool =
  | "search_entries"
  | "overdue_tasks"
  | "upcoming_tasks"
  | "spending_summary";

export interface AdvisorToolCall {
  tool: AdvisorTool;
  query?: string;
  range?: StatsRange;
  kinds?: EntryKind[];
  statuses?: EntryStatus[];
}

export interface AdvisorToolResult {
  call: AdvisorToolCall;
  entries: Entry[];
  notes: string[];
}

const MAX_RESULTS = 80;
const KINDS: EntryKind[] = ["task", "event", "bill", "idea"];
const STATUSES: EntryStatus[] = ["open", "in-progress", "done", "cancelled"];

const KINDS_SCHEMA = { type: "array", items: { enum: KINDS } } as const;
const STATUSES_SCHEMA = { type: "array", items: { enum: STATUSES } } as const;
const DATE_PROPERTIES = {
  start_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
  end_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
} as const;

const searchParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    query: { type: "string", description: "Optional text to find in titles, notes, locations, categories, tags or payment methods." },
    ...DATE_PROPERTIES,
    days: { type: "integer", minimum: 1, maximum: 365 },
    kinds: KINDS_SCHEMA,
    statuses: STATUSES_SCHEMA,
  },
} as const;

const spendingParameters = {
  type: "object",
  additionalProperties: false,
  required: ["start_date", "end_date"],
  properties: DATE_PROPERTIES,
} as const;

export const advisorTools: AIToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_entries",
      description: "Search local entries across user-visible text fields, optionally in a date range; leave query empty to read a range or filter.",
      parameters: searchParameters,
    },
  },
  {
    type: "function",
    function: {
      name: "overdue_tasks",
      description: "List unfinished tasks whose latest occurrence is overdue.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "upcoming_tasks",
      description: "List today's and future unfinished tasks, one occurrence per recurring series.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "spending_summary",
      description: "Aggregate bills, expenses, income and category totals in a date range.",
      parameters: spendingParameters,
    },
  },
];

function normalize(value: string): string {
  return value.toLocaleLowerCase();
}

function entryFields(entry: Entry): string[] {
  return [
    entry.title, entry.titleZh, entry.note, entry.location, entry.category, entry.payment,
    entry.kind, entry.status, entry.date, ...(entry.tags ?? []),
  ].map((value) => normalize(typeof value === "string" ? value : "")).filter(Boolean);
}

function enumValues<T extends string>(value: unknown, allowed: readonly T[]): T[] | undefined {
  const input = Array.isArray(value) ? value : typeof value === "string" && value ? value.split(/[,，|]/) : [];
  const names = input.flatMap((item) => typeof item === "string" ? [item.trim().toLowerCase()] : []);
  const result = allowed.filter((candidate) => names.includes(candidate) || names.includes(candidate.replace("in-progress", "in progress")));
  return result.length ? result : undefined;
}

function optionalDate(value: unknown): string | undefined {
  const candidate = typeof value === "string" ? value.slice(0, 10) : "";
  return isIsoDate(candidate) ? candidate : undefined;
}

function rangeFor(args: Record<string, unknown>, today: string): StatsRange | undefined {
  const start = optionalDate(args.start_date ?? args.startDate);
  const end = optionalDate(args.end_date ?? args.endDate);
  if (start && end) return start <= end ? { start, end } : { start: end, end: start };
  if (start) return { start, end: today };
  if (end) return { start: today, end };
  const days = Number(args.days);
  if (Number.isFinite(days)) return { start: addIsoDays(today, -Math.max(1, Math.min(365, Math.trunc(days))) + 1), end: today };
  return undefined;
}

function requiredRange(args: Record<string, unknown>): StatsRange | undefined {
  const start = optionalDate(args.start_date ?? args.startDate);
  const end = optionalDate(args.end_date ?? args.endDate);
  if (!start || !end) return undefined;
  return start <= end ? { start, end } : { start: end, end: start };
}

function parseArguments(raw: string): Record<string, unknown> | null {
  try {
    const value = extractAIJson(raw || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return null;
  }
}

function searchEntries(entries: readonly Entry[], call: AdvisorToolCall): Entry[] {
  const pool = [...entries];
  const scoped = call.range ? entriesInRange(pool, call.range) : pool;
  const terms = (call.query ?? "").split(/[\s,，、/|]+/).map(normalize).filter(Boolean);
  const kinds = new Set(call.kinds ?? []);
  const statuses = new Set(call.statuses ?? []);
  const matches = scoped.filter((entry) => {
    if (kinds.size && !kinds.has(entry.kind)) return false;
    if (statuses.size && !statuses.has(entry.status ?? "open")) return false;
    if (!terms.length) return true;
    const fields = entryFields(entry);
    return terms.some((term) => fields.some((field) => field.includes(term)));
  });
  return matches
    .sort((left, right) => right.date.localeCompare(left.date) || (right.createdAt ?? "").localeCompare(left.createdAt ?? ""))
    .slice(0, MAX_RESULTS);
}

function countedValues<T extends string>(entries: readonly Entry[], valueOf: (entry: Entry) => T): string {
  const counts = new Map<T, number>();
  for (const entry of entries) {
    const value = valueOf(entry);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].map(([value, count]) => `${value}=${count}`).join(",");
}

function countedDates(entries: readonly Entry[]): string | undefined {
  const dates = new Map<string, number>();
  for (const entry of entries) dates.set(entry.date, (dates.get(entry.date) ?? 0) + 1);
  if (dates.size > 31) return undefined;
  return [...dates.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, count]) => `${date}=${count}`)
    .join(",");
}

function runCall(entries: readonly Entry[], call: AdvisorToolCall, today: string): AdvisorToolResult {
  const pool = [...entries];
  if (call.tool === "overdue_tasks" || call.tool === "upcoming_tasks") {
    const { overdue, upcoming } = outstandingTaskSections(pool, today);
    const matches = call.tool === "overdue_tasks" ? overdue : upcoming;
    return { call, entries: matches.slice(0, MAX_RESULTS), notes: [`count=${matches.length}`] };
  }
  if (call.tool === "spending_summary") {
    const range = call.range!;
    const stats = aggregateBillStats(pool, range);
    const categories = stats.categories
      .map((category) => `${category.name}:${category.total.toFixed(2)}x${category.count}`)
      .join(",");
    return {
      call: { ...call, range },
      entries: stats.entries.slice(0, MAX_RESULTS),
      notes: [
        `count=${stats.count}`,
        `expense=${stats.expense.toFixed(2)}`,
        `income=${stats.income.toFixed(2)}`,
        `balance=${stats.balance.toFixed(2)}`,
        `daily_average_expense=${stats.dailyAverageExpense.toFixed(2)}`,
        `categories=${categories}`,
      ],
    };
  }
  const matches = searchEntries(pool, call);
  const terms = (call.query ?? "").split(/[\s,，、/|]+/).filter(Boolean);
  const termCounts = terms
    .slice(0, 20)
    .map((term) => `${term}=${matches.filter((entry) => entryFields(entry).some((field) => field.includes(normalize(term)))).length}`)
    .join(",");
  const dateCounts = countedDates(matches);
  return {
    call,
    entries: matches,
    notes: [
      `count=${matches.length}`,
      `kinds=${countedValues(matches, (entry) => entry.kind)}`,
      `statuses=${countedValues(matches, (entry) => entry.status ?? "open")}`,
      ...(termCounts ? [`terms=${termCounts}`] : []),
      ...(dateCounts ? [`dates=${dateCounts}`] : []),
    ],
  };
}

function invalidResult(tool: AdvisorTool, message: string): AdvisorToolResult {
  return { call: { tool }, entries: [], notes: [message] };
}

/** Execute one model-selected function against local entries. Read-only. */
export function executeAdvisorToolCall(raw: AIToolCall, entries: readonly Entry[], today: string): AdvisorToolResult {
  const tool = raw.function.name as AdvisorTool;
  if (!advisorTools.some((definition) => definition.function.name === tool)) return invalidResult(tool, "unknown tool");
  const args = parseArguments(raw.function.arguments);
  if (!args) return invalidResult(tool, "invalid JSON arguments");

  if (tool === "search_entries") {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    const range = rangeFor(args, today);
    const kinds = enumValues(args.kinds, KINDS);
    const statuses = enumValues(args.statuses, STATUSES);
    if (!query && !range && !kinds?.length && !statuses?.length) {
      return invalidResult(tool, "a query, date range, days, kinds or statuses is required");
    }
    return runCall(entries, { tool, query, range, kinds, statuses }, today);
  }

  if (tool === "spending_summary") {
    const range = requiredRange(args);
    if (!range) return invalidResult(tool, "start_date and end_date are required");
    return runCall(entries, { tool, range }, today);
  }

  return runCall(entries, { tool }, today);
}

/** The tool message stays compact but gives the model every analyzed field. */
export function advisorToolResultForModel(result: AdvisorToolResult): string {
  const shown = result.entries.slice(0, 60);
  return JSON.stringify({
    tool: result.call.tool,
    query: result.call.query,
    range: result.call.range,
    notes: result.entries.length > shown.length
      ? [...result.notes, `showing ${shown.length} of ${result.entries.length}`]
      : result.notes,
    entries: shown.map((entry) => ({
      id: entry.id,
      date: entry.date,
      start: entry.allDay ? "all-day" : entry.start ?? "anytime",
      end: entry.end,
      duration_minutes: entryDurationMinutes(entry) || undefined,
      kind: entry.kind,
      status: entry.status,
      title: entry.title,
      titleZh: entry.titleZh,
      category: entry.category,
      location: entry.location,
      note: entry.note?.replace(/\s+/g, " ").slice(0, 500),
      tags: entry.tags,
      amount: entry.amount,
      currency: entry.currency,
      payment: entry.payment,
    })),
  });
}
