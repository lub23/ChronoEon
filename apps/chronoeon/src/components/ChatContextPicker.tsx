import type { Entry, EntryKind, Locale } from "../domain/entry";
import type { StatsRange } from "@chronoeon/domain";
import { toggleValue } from "../domain/entryFilter";
import { t } from "../i18n";
import { GlassDatePicker } from "./GlassDateTimePicker";
import { Icon } from "./Icon";

export type ChatContextRange = "all" | "7d" | "1m" | "custom";

interface ChatContextPickerProps {
  candidates: Entry[];
  query: string;
  kinds: EntryKind[];
  range: ChatContextRange;
  customRange: StatsRange;
  selectedIds: string[];
  locale: Locale;
  onQueryChange: (value: string) => void;
  onKindsChange: (kinds: EntryKind[]) => void;
  onRangeChange: (range: ChatContextRange) => void;
  onCustomRangeChange: (range: Partial<StatsRange>) => void;
  onToggle: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
}

const contextKinds: EntryKind[] = ["task", "event", "bill", "idea"];
const contextRanges: Array<{ key: ChatContextRange; label: "all" | "range7d" | "range1m" | "customDateRange" }> = [
  { key: "all", label: "all" },
  { key: "7d", label: "range7d" },
  { key: "1m", label: "range1m" },
  { key: "custom", label: "customDateRange" },
];

/** One explicit, inspectable answer to "what exactly will the model read?" */
export function ChatContextPicker({
  candidates,
  query,
  kinds,
  range,
  customRange,
  selectedIds,
  locale,
  onQueryChange,
  onKindsChange,
  onRangeChange,
  onCustomRangeChange,
  onToggle,
  onClear,
  onClose,
}: ChatContextPickerProps) {
  return (
    <section className="chat-context-panel" aria-label={t("aiChatContext", locale)}>
      <header>
        <div>
          <strong>{t("aiChatContext", locale)}</strong>
          <p>{selectedIds.length
            ? t("aiChatContextSelectedCount", locale).replace("{count}", String(selectedIds.length))
            : t("aiChatContextAuto", locale)}
          </p>
        </div>
        <div className="chat-context-actions">
          <button type="button" onClick={onClear} disabled={!selectedIds.length}>{t("aiChatContextClear", locale)}</button>
          <button type="button" onClick={onClose} aria-label={t("close", locale)} title={t("close", locale)}>
            <Icon name="close" size={12} />
          </button>
        </div>
      </header>
      <div className="chat-context-controls">
        <div className="chat-rail-search">
          <Icon name="search" size={13} />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t("search", locale)}
            aria-label={t("search", locale)}
          />
        </div>
        {/* Four kind checkboxes, all checked by default — the old select-all
            button and the All chip are the same default state, so both are
            gone. Ticking the final box normalizes back to [] (= everything);
            the last standing box cannot be unticked. */}
        <div className="chat-context-kinds" role="group" aria-label={t("kind", locale)}>
          {contextKinds.map((candidateKind) => {
            const checked = kinds.length === 0 || kinds.includes(candidateKind);
            const lastStanding = kinds.length === 1 && kinds[0] === candidateKind;
            return (
              <button
                key={candidateKind}
                type="button"
                role="checkbox"
                aria-checked={checked}
                disabled={lastStanding}
                className={checked ? "filter-check is-checked" : "filter-check"}
                onClick={() => {
                  if (lastStanding) return;
                  if (!checked) {
                    const next = toggleValue(kinds, candidateKind);
                    onKindsChange(next.length === contextKinds.length ? [] : next);
                    return;
                  }
                  onKindsChange(kinds.length === 0
                    ? contextKinds.filter((other) => other !== candidateKind)
                    : toggleValue(kinds, candidateKind));
                }}
              >
                <i aria-hidden="true"><Icon name="check" size={11} /></i>
                {t(candidateKind, locale)}
              </button>
            );
          })}
        </div>
      </div>
      <div className="chat-context-range" role="group" aria-label={t("filterDateRange", locale)}>
        <div className="chat-context-range-options">
          {contextRanges.map((item) => (
            <button
              key={item.key}
              type="button"
              className={range === item.key ? "is-active" : ""}
              aria-pressed={range === item.key}
              onClick={() => onRangeChange(item.key)}
            >
              {t(item.label, locale)}
            </button>
          ))}
        </div>
        {range === "custom" && (
          <div className="chat-context-dates">
            <GlassDatePicker
              value={customRange.start}
              max={customRange.end}
              ariaLabel={t("date", locale)}
              locale={locale}
              clearable={false}
              onChange={(value) => onCustomRangeChange({ start: value || customRange.start })}
            />
            <span aria-hidden="true">→</span>
            <GlassDatePicker
              value={customRange.end}
              min={customRange.start}
              ariaLabel={t("endDate", locale)}
              locale={locale}
              clearable={false}
              onChange={(value) => onCustomRangeChange({ end: value || customRange.end })}
            />
          </div>
        )}
      </div>
      <div className="chat-context-list">
        {candidates.map((entry) => (
          <label
            key={entry.id}
            className={selectedIds.includes(entry.id) ? "chat-context-item is-selected" : "chat-context-item"}
          >
            <input
              type="checkbox"
              checked={selectedIds.includes(entry.id)}
              onChange={() => onToggle(entry.id)}
              aria-label={entry.title}
            />
            <i style={{ background: entry.color }} aria-hidden="true" />
            <span>
              <strong>{entry.title}</strong>
              <small>
                {entry.date}
                {entry.start ? ` · ${entry.start}` : entry.allDay ? ` · ${t("allDay", locale)}` : ""}
              </small>
            </span>
          </label>
        ))}
        {!candidates.length && <p className="chat-empty">{t("aiChatContextNoMatches", locale)}</p>}
      </div>
    </section>
  );
}
