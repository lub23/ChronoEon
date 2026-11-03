import { useState, type FormEvent } from "react";
import { monthlyBudgetProgress, paymentBalances, type ChronoEonSettings, type Entry, type Locale } from "@chronoeon/domain";
import { t } from "../i18n";
import { Icon } from "./Icon";

interface Props {
  /** Every entry, not the range-filtered slice: balances count bills after their anchor. */
  entries: Entry[];
  settings: ChronoEonSettings;
  locale: Locale;
  symbol: string;
  today: string;
  onSettingsChange?: (settings: ChronoEonSettings) => void;
}

function money(symbol: string, amount: number): string {
  const rounded = Math.abs(amount) >= 1000 ? Math.round(amount) : Math.round(amount * 100) / 100;
  return `${amount < 0 ? "−" : ""}${symbol}${Math.abs(rounded).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function dayLabel(iso: string, locale: Locale): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso.slice(0, 10) : date.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric" });
}

const RING_RADIUS = 46;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * The month's budget as a ring and what each payment method holds as tiles.
 * Both live in the shared calendar settings, so every device sees the same
 * numbers; a balance is the figure the user typed plus every bill recorded
 * after that moment.
 */
export function BudgetAccountsCard({ entries, settings, locale, symbol, today, onSettingsChange }: Props) {
  const calendarId = settings.defaultCalendarID;
  const progress = monthlyBudgetProgress(entries, settings, today, calendarId);
  const balances = paymentBalances(entries, settings, today, calendarId);
  const known = balances.filter((item) => item.balance !== undefined);
  const total = known.reduce((sum, item) => sum + (item.balance ?? 0), 0);
  const [budgetDraft, setBudgetDraft] = useState<string | null>(null);
  const [balanceDraft, setBalanceDraft] = useState<{ id: string; value: string } | null>(null);
  const editable = Boolean(onSettingsChange);

  const saveBudget = (event: FormEvent) => {
    event.preventDefault();
    if (!onSettingsChange || budgetDraft === null) return;
    const value = Number(budgetDraft.replace(/[^\d.]/g, ""));
    onSettingsChange({ ...settings, calendars: settings.calendars.map((calendar) => calendar.id === calendarId
      ? { ...calendar, budgetMonthly: Number.isFinite(value) && value > 0 ? value : undefined } : calendar) });
    setBudgetDraft(null);
  };
  const saveBalance = (event: FormEvent) => {
    event.preventDefault();
    if (!onSettingsChange || !balanceDraft) return;
    const trimmed = balanceDraft.value.trim();
    const value = Number(trimmed.replace(/[^\d.-]/g, ""));
    onSettingsChange({ ...settings, calendars: settings.calendars.map((calendar) => calendar.id === calendarId
      ? { ...calendar, paymentMethods: calendar.paymentMethods.map((method) => method.id === balanceDraft.id
        ? { ...method, balance: trimmed && Number.isFinite(value) ? { amount: value, at: new Date().toISOString() } : undefined }
        : method) }
      : calendar) });
    setBalanceDraft(null);
  };
  const ratio = progress ? progress.ratio : 0;
  const tone = ratio > 1 ? "is-over" : ratio > 0.8 ? "is-warn" : "";
  const percent = Math.round(Math.min(999, ratio * 100));
  const month = progress?.month ?? today.slice(0, 7);
  const monthLabel = locale === "zh" ? `${Number(month.slice(5, 7))}月` : new Date(`${month}-01T00:00:00`).toLocaleDateString("en-US", { month: "long" });

  return (
    <section className="stats-card panel budget-card" aria-label={t("budgetTitle", locale)}>
      <header className="stats-card-header">
        <h3><Icon name="coins" size={16} /> {t("budgetTitle", locale)}</h3>
        {known.length > 0 && <span className="stats-card-total budget-total" title={t("accountTotal", locale)}>{t("accountTotal", locale)} <b>{money(symbol, total)}</b></span>}
      </header>

      <div className="budget-grid">
        <div className={`budget-ring-block ${tone}`}>
          <div className="budget-ring" role={progress ? "progressbar" : undefined} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress ? Math.min(100, percent) : undefined} aria-label={t("budgetMonthly", locale)}>
            <svg viewBox="0 0 110 110" aria-hidden="true">
              <circle className="budget-ring-track" cx="55" cy="55" r={RING_RADIUS} />
              {progress && (
                <circle className="budget-ring-fill" cx="55" cy="55" r={RING_RADIUS}
                  style={{ strokeDasharray: `${RING_LENGTH}`, strokeDashoffset: `${RING_LENGTH * (1 - Math.min(1, ratio))}` }} />
              )}
            </svg>
            <div className="budget-ring-center">
              {progress
                ? <><strong>{percent}<small>%</small></strong><span>{monthLabel}</span></>
                : <Icon name="wallet" size={22} />}
            </div>
          </div>
          <div className="budget-copy">
            <small>{t("budgetMonthly", locale)} · {month}</small>
            {progress
              ? <strong>{money(symbol, progress.spent)} <span>/ {money(symbol, progress.budget)}</span></strong>
              : <em className="budget-empty">{t("budgetNone", locale)}</em>}
            {progress && (
              <p className="budget-meta">
                <span className={progress.remaining < 0 ? "is-over" : ""}>{progress.remaining >= 0
                  ? t("budgetRemaining", locale).replace("{amount}", money(symbol, progress.remaining))
                  : t("budgetOver", locale).replace("{amount}", money(symbol, -progress.remaining))}</span>
                <span>{t("budgetDaily", locale).replace("{amount}", money(symbol, progress.dailyAllowance)).replace("{days}", String(progress.daysLeft))}</span>
              </p>
            )}
            {editable && (budgetDraft === null
              ? <button type="button" className="secondary-button budget-edit" onClick={() => setBudgetDraft(progress ? String(progress.budget) : "")}><Icon name="edit" size={13} />{progress ? t("budgetEdit", locale) : t("budgetSet", locale)}</button>
              : <form className="budget-form" onSubmit={saveBudget}>
                  <input type="number" inputMode="decimal" min={0} step="any" value={budgetDraft} autoFocus aria-label={t("budgetMonthly", locale)}
                    placeholder="0" onChange={(event) => setBudgetDraft(event.target.value)} />
                  <button type="submit" className="primary-action">{t("save", locale)}</button>
                  <button type="button" className="secondary-button" onClick={() => setBudgetDraft(null)}>{t("cancel", locale)}</button>
                </form>)}
          </div>
        </div>

        <ul className="account-grid">
          {balances.map((item) => {
            const editing = balanceDraft?.id === item.method.id;
            return (
              <li key={item.method.id} className={`account-tile${item.balance === undefined ? " is-unset" : ""}${editing ? " is-editing" : ""}`}>
                <header>
                  <span className="account-name"><Icon name="wallet" size={13} />{item.method.name}</span>
                  {editable && !editing && <button type="button" className="icon-button subtle account-edit" title={t("accountUpdate", locale)} aria-label={`${t("accountUpdate", locale)} · ${item.method.name}`}
                    onClick={() => setBalanceDraft({ id: item.method.id, value: item.balance !== undefined ? String(Math.round(item.balance * 100) / 100) : "" })}><Icon name="edit" size={13} /></button>}
                </header>
                {editing ? (
                  <form className="budget-form" onSubmit={saveBalance}>
                    <input type="number" inputMode="decimal" step="any" value={balanceDraft.value} autoFocus aria-label={t("accountUpdate", locale)}
                      placeholder={item.balance !== undefined ? String(Math.round(item.balance * 100) / 100) : "0"}
                      onChange={(event) => setBalanceDraft({ id: item.method.id, value: event.target.value })} />
                    <button type="submit" className="primary-action">{t("save", locale)}</button>
                    <button type="button" className="secondary-button" onClick={() => setBalanceDraft(null)}>{t("cancel", locale)}</button>
                  </form>
                ) : (
                  <>
                    {item.balance !== undefined
                      ? <strong className={item.balance < 0 ? "is-expense" : ""}>{money(symbol, item.balance)}</strong>
                      : <em>{t("accountUnset", locale)}</em>}
                    <small>{item.anchor
                      ? `${t("accountUpdated", locale).replace("{date}", dayLabel(item.anchor.at, locale))}${item.count ? ` · ${t("accountMoved", locale).replace("{count}", String(item.count)).replace("{amount}", money(symbol, item.movement))}` : ""}`
                      : t("accountHint", locale)}</small>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <p className="settings-footnote budget-rule">{t("accountRule", locale)}</p>
    </section>
  );
}
