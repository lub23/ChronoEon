import { isStableEntryId, type Entry } from "./entry";
import { billCategoriesForCalendar, paymentMethodsForCalendar, type BillPrimaryCategory, type ChronoEonSettings } from "./settings";

/** Local conversion format. Amounts are integer cents, never signed cash flows. */
export interface LedgerImportPayload {
  format: "chronoeon-ledger";
  version: 1;
  source: { sha256: string; sheet: string };
  currency: string;
  categories: Array<Pick<BillPrimaryCategory, "id" | "name" | "direction" | "sub">>;
  transactions: Array<{
    id: string;
    row: number;
    date: string;
    time?: string;
    title: string;
    categoryId: string;
    subcategory: string;
    amountCents: number;
    payment: string;
    note?: string;
    tags: string[];
  }>;
  summary: LedgerImportSummary;
}

export interface LedgerImportSummary {
  count: number;
  incomeCount: number;
  expenseCount: number;
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  firstDate: string;
  lastDate: string;
}

export interface PreparedLedgerReplacement {
  entries: Entry[];
  categories: BillPrimaryCategory[];
  summary: LedgerImportSummary;
}

function reject(code: string): never { throw new Error(`LEDGER_${code}`); }
function nonempty(value: unknown): value is string { return typeof value === "string" && Boolean(value.trim()); }
function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function paymentMethodId(settings: ChronoEonSettings, calendarId: string, value: string): string {
  const wanted = value.trim().toLocaleLowerCase();
  const method = paymentMethodsForCalendar(settings, calendarId).find((candidate) =>
    candidate.id.trim().toLocaleLowerCase() === wanted || candidate.name.trim().toLocaleLowerCase() === wanted);
  if (!method) reject("INVALID_PAYMENT_METHOD");
  return method.id;
}

/** Validate the entire replacement before any write; never silently skip a row.
 * Existing catalogs are preserved, including same-name built-in categories.
 * Entries reference the new parent's ID, not its potentially ambiguous name.
 */
export function prepareLedgerReplacement(
  settings: ChronoEonSettings,
  input: LedgerImportPayload,
  importedAt: string,
): PreparedLedgerReplacement {
  if (!input || input.format !== "chronoeon-ledger" || input.version !== 1
    || !input.source || !/^[a-f0-9]{64}$/.test(input.source.sha256) || !nonempty(input.source.sheet)
    || !/^[A-Z]{3}$/.test(input.currency) || !Array.isArray(input.categories) || !input.categories.length
    || !Array.isArray(input.transactions) || !input.transactions.length || !input.summary
    || Number.isNaN(Date.parse(importedAt))) reject("INVALID_PAYLOAD");

  const imported = new Map<string, BillPrimaryCategory>();
  const existingById = new Map(billCategoriesForCalendar(settings, settings.defaultCalendarID)
    .map((category) => [category.id, category] as const));
  const categories: BillPrimaryCategory[] = [];
  for (const category of input.categories) {
    if (!category || !/^ledger-[a-f0-9]{24}$/.test(category.id) || imported.has(category.id)
      || !nonempty(category.name) || category.name.includes("/")
      || !["income", "expense"].includes(category.direction)
      || !Array.isArray(category.sub) || !category.sub.length
      || category.sub.some((sub) => !nonempty(sub) || sub.includes("/"))
      || new Set(category.sub).size !== category.sub.length) reject("INVALID_CATEGORY");
    const existing = existingById.get(category.id);
    if (existing && (existing.name !== category.name || existing.direction !== category.direction
      || JSON.stringify(existing.sub) !== JSON.stringify(category.sub))) reject("CATEGORY_CONFLICT");
    const stored = existing ?? {
      id: category.id, name: category.name, direction: category.direction, sub: [...category.sub],
      color: categories.find((candidate) => candidate.name === category.name)?.color
        ?? (category.direction === "income" ? "#2f8f5b" : "#c0392b"),
    };
    imported.set(category.id, stored);
    categories.push(stored);
  }

  const summary: LedgerImportSummary = { count: 0, incomeCount: 0, expenseCount: 0,
    incomeCents: 0, expenseCents: 0, netCents: 0, firstDate: "", lastDate: "" };
  const ids = new Set<string>();
  const rows = new Set<number>();
  const entries = input.transactions.map((row): Entry => {
    const category = row && imported.get(row.categoryId);
    if (!row || !isStableEntryId(row.id) || ids.has(row.id) || !Number.isSafeInteger(row.row) || row.row < 2 || rows.has(row.row)
      || !validDate(row.date) || (row.time !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.time))
      || !nonempty(row.title) || !category || !category.sub.includes(row.subcategory)
      || !Number.isSafeInteger(row.amountCents) || row.amountCents <= 0
      || !nonempty(row.payment) || (row.note !== undefined && typeof row.note !== "string")
      || !Array.isArray(row.tags) || row.tags.some((tag) => !nonempty(tag))
      || new Set(row.tags).size !== row.tags.length) reject("INVALID_TRANSACTION");
    ids.add(row.id); rows.add(row.row);
    summary.count += 1;
    if (category.direction === "income") { summary.incomeCount += 1; summary.incomeCents += row.amountCents; }
    else { summary.expenseCount += 1; summary.expenseCents += row.amountCents; }
    if (!summary.firstDate || row.date < summary.firstDate) summary.firstDate = row.date;
    if (!summary.lastDate || row.date > summary.lastDate) summary.lastDate = row.date;
    return {
      id: row.id, kind: "bill", title: row.title, date: row.date, start: row.time,
      allDay: row.time === undefined, amount: row.amountCents / 100, currency: input.currency,
      category: `${category.id}/${row.subcategory}`, color: category.color,
      calendar: settings.defaultCalendarID, payment: paymentMethodId(settings, settings.defaultCalendarID, row.payment), note: row.note,
      tags: [...row.tags], createdAt: importedAt, recurrence: "none", reminder: "none", source: "local",
    };
  });
  summary.netCents = summary.incomeCents - summary.expenseCents;
  if (!Number.isSafeInteger(summary.incomeCents) || !Number.isSafeInteger(summary.expenseCents)
    || Object.keys(summary).some((key) => summary[key as keyof LedgerImportSummary] !== input.summary[key as keyof LedgerImportSummary])) reject("TOTAL_MISMATCH");
  return { entries, categories, summary };
}
