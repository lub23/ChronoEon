import type { CSSProperties } from "react";
import { currencySymbol, expenseBorderPercent, expenseIntensityPercent, formatBillLabel, type ChronoEonSettings } from "@chronoeon/domain";
import type { Locale } from "../domain/entry";
import { t } from "../i18n";
import { CurrencyGlyph } from "./ItemGlyph";

interface ExpenseBadgeProps {
  /** Positive spending magnitude for the day. */
  amount: number;
  settings: ChronoEonSettings;
  locale: Locale;
  className?: string;
  /** Show the exact amount rather than the compact `1.2K` form. */
  exact?: boolean;
  /** Draw the currency in the same circular glyph slot as a normal item. */
  currencyGlyph?: boolean;
}

/**
 * The per-day spending summary shown in Month cells, the Day/Week all-day lane
 * and the List header. It is summary metadata, not an entry: it never opens a
 * composer and never participates in drag.
 *
 * Colour intensity scales logarithmically with the amount, so a ¥5 coffee and a
 * ¥5,000 rent both read at a glance without either disappearing or shouting.
 */
export function ExpenseBadge({ amount, settings, locale, className, exact = false, currencyGlyph = false }: ExpenseBadgeProps) {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const symbol = currencySymbol(settings.bill.currency, settings);
  return (
    <span
      className={className ? `expense-badge ${className}` : "expense-badge"}
      title={`${t("statsExpense", locale)}: ${symbol}${amount.toFixed(2)}`}
      style={{
        "--expense-intensity": `${expenseIntensityPercent(amount)}%`,
        "--expense-border-intensity": `${expenseBorderPercent(amount)}%`,
      } as CSSProperties}
    >
      {currencyGlyph && <CurrencyGlyph code={settings.bill.currency} size={14} />}
      {formatBillLabel(amount, currencyGlyph ? "" : symbol, !exact)}
    </span>
  );
}
