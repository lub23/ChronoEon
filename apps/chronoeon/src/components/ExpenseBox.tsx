import type { CSSProperties } from "react";
import {
  currencySymbol,
  expenseBorderPercent,
  expenseIntensityPercent,
  type ChronoEonSettings,
} from "@chronoeon/domain";
import type { Locale } from "../domain/entry";
import { t } from "../i18n";
import { ExpenseBadge } from "./ExpenseBadge";
import { Icon } from "./Icon";

export type ExpenseBoxVariant = "month" | "calendar" | "list" | "summary";

interface ExpenseBoxProps {
  /** Positive magnitude of expenses recorded on one civil day. */
  amount: number;
  settings: ChronoEonSettings;
  locale: Locale;
  variant: ExpenseBoxVariant;
  className?: string;
  exact?: boolean;
  style?: CSSProperties;
}

/**
 * A dedicated per-day spending surface, deliberately separate from bill chips.
 * Month, Day, Week and List all use this component so filtering entries never
 * makes the day's financial context disappear and the summary never becomes a
 * draggable/editable pseudo-entry.
 */
export function ExpenseBox({ amount, settings, locale, variant, className, exact = false, style }: ExpenseBoxProps) {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const symbol = currencySymbol(settings.bill.currency, settings);
  const classes = ["expense-box", `expense-box--${variant}`, className ?? ""].filter(Boolean).join(" ");
  return (
    <div
      className={classes}
      role="status"
      aria-label={`${t("spending", locale)}: ${symbol}${amount.toFixed(2)}`}
      title={`${t("spending", locale)}: ${symbol}${amount.toFixed(2)}`}
      style={{
        "--expense-intensity": `${expenseIntensityPercent(amount)}%`,
        "--expense-border-intensity": `${expenseBorderPercent(amount)}%`,
        ...style,
      } as CSSProperties}
    >
      {(variant === "list" || variant === "summary") && <span className="expense-box-icon" aria-hidden="true"><Icon name="wallet" size={variant === "list" ? 14 : 12} /></span>}
      <ExpenseBadge
        amount={amount}
        settings={settings}
        locale={locale}
        exact={exact || variant === "list" || variant === "summary"}
        currencyGlyph={variant === "month" || variant === "calendar"}
      />
    </div>
  );
}
