import type { Entry } from "./entry";
import { isoDateRange } from "./calendar";
import { signedBillAmount, type ChronoEonSettings, type PaymentBalanceAnchor, type PaymentMethodConfig } from "./settings";
import { entriesInRange, type StatsRange } from "./stats";

export interface PaymentBalance {
  method: PaymentMethodConfig;
  anchor?: PaymentBalanceAnchor;
  /** Anchor plus every bill recorded after it; absent until a balance is set. */
  balance?: number;
  /** Signed sum of the bills that moved the anchor. */
  movement: number;
  count: number;
}

const calendarOf = (entry: Entry, settings: ChronoEonSettings) => entry.calendar ?? settings.defaultCalendarID;

/**
 * A bill counts against a balance when it happened after the manual update:
 * any later day, or the same day but recorded after the update moment. Future
 * dated bills wait until their day arrives.
 */
function movesAnchor(entry: Entry, anchor: PaymentBalanceAnchor, today: string): boolean {
  const anchorDate = anchor.at.slice(0, 10);
  if (entry.date > today) return false;
  if (entry.date > anchorDate) return true;
  return entry.date === anchorDate && entry.createdAt > anchor.at;
}

export function paymentBalances(entries: readonly Entry[], settings: ChronoEonSettings, today: string, calendarId = settings.defaultCalendarID): PaymentBalance[] {
  const calendar = settings.calendars.find((candidate) => candidate.id === calendarId) ?? settings.calendars[0];
  if (!calendar) return [];
  const bills = (entries as Entry[]).filter((entry) => entry.kind === "bill" && calendarOf(entry, settings) === calendar.id);
  return calendar.paymentMethods.map((method) => {
    const anchor = method.balance;
    if (!anchor) return { method, movement: 0, count: 0 };
    const range: StatsRange = { start: anchor.at.slice(0, 10), end: today };
    const moved = entriesInRange(bills, range).filter((entry) => entry.payment === method.id && movesAnchor(entry, anchor, today));
    const movement = moved.reduce((sum, entry) => sum + (signedBillAmount(entry.amount, entry.category, settings, entry.calendar) ?? 0), 0);
    return { method, anchor, balance: anchor.amount + movement, movement, count: moved.length };
  });
}

export interface BudgetProgress {
  /** `YYYY-MM` of the month being measured. */
  month: string;
  budget: number;
  spent: number;
  remaining: number;
  /** spent / budget, unclamped so the view can show an overrun. */
  ratio: number;
  daysLeft: number;
  /** What is left per remaining day, never negative. */
  dailyAllowance: number;
}

export function monthRange(today: string): StatsRange {
  const [year, month] = today.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return { start: `${today.slice(0, 7)}-01`, end: `${today.slice(0, 7)}-${String(lastDay).padStart(2, "0")}` };
}

/** This month's expenses against the calendar's monthly budget; null without a budget. */
export function monthlyBudgetProgress(entries: readonly Entry[], settings: ChronoEonSettings, today: string, calendarId = settings.defaultCalendarID): BudgetProgress | null {
  const calendar = settings.calendars.find((candidate) => candidate.id === calendarId) ?? settings.calendars[0];
  if (!calendar?.budgetMonthly) return null;
  const range = monthRange(today);
  const bills = (entries as Entry[]).filter((entry) => entry.kind === "bill" && calendarOf(entry, settings) === calendar.id);
  const spent = entriesInRange(bills, range).reduce((sum, entry) => {
    const amount = signedBillAmount(entry.amount, entry.category, settings, entry.calendar);
    return amount !== undefined && amount < 0 ? sum - amount : sum;
  }, 0);
  const remaining = calendar.budgetMonthly - spent;
  const daysLeft = Math.max(1, isoDateRange(today, range.end).length);
  return { month: today.slice(0, 7), budget: calendar.budgetMonthly, spent, remaining, ratio: spent / calendar.budgetMonthly, daysLeft, dailyAllowance: Math.max(0, remaining) / daysLeft };
}
