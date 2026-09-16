import { useCallback, useMemo, useState } from "react";
import { addDays, differenceInCalendarDays, format, max, min } from "date-fns";
import type { ChronoEonSettings, Entry, Locale } from "@chronoeon/domain";
import { timelineDayKeys, type AgendaFilter } from "../domain/agendaTimeline";
import type { LunarPreference } from "../domain/lunar";
import { t } from "../i18n";
import { AgendaTimeline } from "./AgendaTimeline";

interface ListViewProps {
  entries: Entry[];
  selectedDate: Date;
  locale: Locale;
  settings: ChronoEonSettings;
  filter: AgendaFilter;
  search: string;
  lunar?: LunarPreference;
  onSelectDate?: (date: Date) => void;
  onToggle: (id: string, entry?: Entry) => void;
  onEdit: (entry: Entry) => void;
  onNew: (date?: string) => void;
  onEntryMenu?: (entry: Entry, event: React.MouseEvent) => void;
}

const PAGE_DAYS = 14;
const INITIAL_BEFORE_DAYS = 28;
const INITIAL_AFTER_DAYS = 56;
const FIRST_ITEM_INDEX = 100_000;

/**
 * The List view is the shared Day timeline with an open date range. Only the
 * virtual window is loaded: scrolling to either end grows that end by a page.
 */
export function ListView({
  entries,
  selectedDate,
  locale,
  settings,
  filter,
  search,
  lunar = "auto",
  onSelectDate,
  onToggle,
  onEdit,
  onNew,
  onEntryMenu,
}: ListViewProps) {
  const selectedKey = format(selectedDate, "yyyy-MM-dd");
  const [startOffset, setStartOffset] = useState(-INITIAL_BEFORE_DAYS);
  const [endOffset, setEndOffset] = useState(INITIAL_AFTER_DAYS);

  const dayKeys = useMemo(() => {
    // Keep today loaded even when the selection jumps far away, so the
    // floating return affordance can always target a real virtual item.
    const today = new Date();
    const start = min([addDays(selectedDate, startOffset), addDays(today, -7)]);
    const end = max([addDays(selectedDate, endOffset), addDays(today, 7)]);
    return timelineDayKeys(start, differenceInCalendarDays(end, start) + 1);
  }, [endOffset, selectedDate, startOffset]);

  const loadBefore = useCallback(() => {
    setStartOffset((offset) => offset - PAGE_DAYS);
  }, []);
  const loadAfter = useCallback(() => {
    setEndOffset((offset) => offset + PAGE_DAYS);
  }, []);

  return (
    <section className="list-view panel" aria-label={t("agenda", locale)}>
      <AgendaTimeline
        entries={entries}
        dayKeys={dayKeys}
        selectedKey={selectedKey}
        mode="week"
        locale={locale}
        settings={settings}
        filter={filter}
        search={search}
        lunar={lunar}
        firstItemIndex={FIRST_ITEM_INDEX + (startOffset - -INITIAL_BEFORE_DAYS)}
        onFirstItemReached={loadBefore}
        onLastItemReached={loadAfter}
        onSelectDate={onSelectDate}
        onToggle={onToggle}
        onEdit={onEdit}
        onNew={onNew}
        onEntryMenu={onEntryMenu}
      />
    </section>
  );
}
