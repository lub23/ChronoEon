import type { ChronoEonSettings, Entry, Locale } from "@chronoeon/domain";
import type { AgendaFilter } from "../domain/agendaTimeline";
import type { LunarPreference } from "../domain/lunar";
import { ListView } from "./ListView";

interface AgendaViewProps {
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

/** Agenda is the product-facing name of the week-grouped List view. */
export function AgendaView({
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
}: AgendaViewProps) {
  return (
    <ListView
      entries={entries}
      selectedDate={selectedDate}
      locale={locale}
      settings={settings}
      filter={filter}
      search={search}
      lunar={lunar}
      onSelectDate={onSelectDate}
      onToggle={onToggle}
      onEdit={onEdit}
      onNew={onNew}
      onEntryMenu={onEntryMenu}
    />
  );
}
