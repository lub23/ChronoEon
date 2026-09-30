import { describe, expect, it } from "vitest";
import { createDefaultSettings } from "./settings";
import { prepareLedgerReplacement, type LedgerImportPayload } from "./ledgerImport";

const at = "2026-09-29T00:00:00.000Z";
const parentId = "ledger-" + "a".repeat(24);
function payload(): LedgerImportPayload {
  return {
    format: "chronoeon-ledger", version: 1, source: { sha256: "f".repeat(64), sheet: "Transactions" }, currency: "CNY",
    categories: [{ id: parentId, name: "Income", direction: "income", sub: ["Salary"] }],
    transactions: [{ id: "10000000-0000-4000-8000-000000000001", row: 2, date: "2026-09-01", time: "12:34",
      title: "Imported bill", categoryId: parentId, subcategory: "Salary", amountCents: 12345, payment: "Cash", tags: ["one tag"], note: "Line one\nLine two" }],
    summary: { count: 1, incomeCount: 1, expenseCount: 0, incomeCents: 12345, expenseCents: 0, netCents: 12345, firstDate: "2026-09-01", lastDate: "2026-09-01" },
  };
}

describe("ledger replacement preparation", () => {
  it("replaces the ledger catalog, maps payment labels to IDs and preserves fields", () => {
    const settings = createDefaultSettings();
    const original = structuredClone(settings);
    const result = prepareLedgerReplacement(settings, payload(), at);
    expect(settings).toEqual(original);
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0]).toMatchObject({ id: parentId, name: "Income", sub: ["Salary"] });
    expect(result.entries[0]).toMatchObject({ kind: "bill", category: `${parentId}/Salary`, amount: 123.45,
      start: "12:34", allDay: false, currency: "CNY", payment: "cash", tags: ["one tag"], note: "Line one\nLine two" });
  });

  it("keeps expense amounts positive and does not duplicate a repeated import catalog", () => {
    const input = payload();
    input.categories[0].direction = "expense";
    input.summary = { ...input.summary, incomeCount: 0, expenseCount: 1, incomeCents: 0, expenseCents: 12345, netCents: -12345 };
    const settings = createDefaultSettings();
    const first = prepareLedgerReplacement(settings, input, at);
    const second = prepareLedgerReplacement({
      ...settings,
      calendars: settings.calendars.map((calendar, index) => index === 0 ? { ...calendar, billCategories: first.categories } : calendar),
    }, input, at);
    expect(second.categories).toEqual(first.categories);
    expect(second.entries[0].amount).toBe(123.45);
  });

  it.each([
    ["tampered total", (input: LedgerImportPayload) => { input.summary.incomeCents += 1; }],
    ["unknown subcategory", (input: LedgerImportPayload) => { input.transactions[0].subcategory = "Missing"; }],
    ["negative amount", (input: LedgerImportPayload) => { input.transactions[0].amountCents = -12345; }],
    ["fractional cents", (input: LedgerImportPayload) => { input.transactions[0].amountCents = 123.45; }],
    ["duplicate ID", (input: LedgerImportPayload) => { input.transactions.push({ ...input.transactions[0], row: 3 }); }],
    ["duplicate source row", (input: LedgerImportPayload) => { input.transactions.push({ ...input.transactions[0], id: "20000000-0000-4000-8000-000000000001" }); }],
    ["invalid date", (input: LedgerImportPayload) => { input.transactions[0].date = "2026-02-30"; }],
    ["invalid time", (input: LedgerImportPayload) => { input.transactions[0].time = "25:00"; }],
    ["built-in category ID", (input: LedgerImportPayload) => { input.categories[0].id = "income"; }],
    ["unknown payment method", (input: LedgerImportPayload) => { input.transactions[0].payment = "Not offered"; }],
    ["empty replacement", (input: LedgerImportPayload) => { input.transactions = []; }],
  ] as const)("rejects %s without silently losing data", (_name, mutate) => {
    const input = payload(); mutate(input);
    expect(() => prepareLedgerReplacement(createDefaultSettings(), input, at)).toThrow(/^LEDGER_/);
  });

  it("refuses to change a pre-existing category with the same stable ID", () => {
    const settings = createDefaultSettings();
    settings.calendars[0].billCategories.push({ id: parentId, name: "Previous", direction: "income", sub: ["Salary"], color: "#000000" });
    expect(() => prepareLedgerReplacement(settings, payload(), at)).toThrow("LEDGER_CATEGORY_CONFLICT");
  });
});
