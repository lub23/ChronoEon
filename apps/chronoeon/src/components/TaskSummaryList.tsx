import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { MotionPresence, createMotionPortal as createPortal } from "./MotionPresence";
import { format, parseISO } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";
import {
  formatEntryTime,
  resolveEntryColors,
  titleFor,
  type ChronoEonSettings,
  type Entry,
  type EntryStatus,
  type Locale,
} from "@chronoeon/domain";
import { t, type MessageKey } from "../i18n";
import { FadeText } from "./FadeText";
import { CHIP_ICON_SIZE, RepeatGlyph, TaskStatusGlyph } from "./ItemGlyph";
import { registerModalDismiss } from "./modalLayer";

interface TaskSummaryListProps {
  entries: Entry[];
  locale: Locale;
  settings: ChronoEonSettings;
  emptyLabel: string;
  onToggle: (id: string, entry?: Entry) => void;
  onStatus?: (entry: Entry, status: EntryStatus) => void;
  onOpen: (entry: Entry) => void;
  className?: string;
}

export const TASK_STATUSES: Array<{ value: EntryStatus; key: MessageKey }> = [
  { value: "open", key: "statusOpen" },
  { value: "in-progress", key: "statusInProgress" },
  { value: "done", key: "statusDone" },
  { value: "cancelled", key: "statusCancelled" },
];

const recurrenceLabels: Record<string, MessageKey> = {
  daily: "recurrenceDaily",
  weekly: "recurrenceWeekly",
  monthly: "recurrenceMonthly",
  yearly: "recurrenceYearly",
};

interface StatusMenuState {
  entry: Entry;
  status: EntryStatus;
  left: number;
  top: number;
}

function summaryTime(entry: Entry, locale: Locale): string {
  const date = format(parseISO(entry.date), locale === "zh" ? "M月d日" : "MMM d", {
    locale: locale === "zh" ? zhCN : enUS,
  });
  return `${date} · ${formatEntryTime(entry, locale)}`;
}

/** One shared task row for List/Insights: time, status control, title, colour. */
export function TaskSummaryList({
  entries,
  locale,
  settings,
  emptyLabel,
  onToggle,
  onStatus,
  onOpen,
  className = "",
}: TaskSummaryListProps) {
  const [statusMenu, setStatusMenu] = useState<StatusMenuState | null>(null);
  if (entries.length === 0) return <p className="task-summary-empty">{emptyLabel}</p>;
  const grouped = new Map<string, { entry: Entry; count: number }>();
  for (const entry of entries) {
    const key = entry.recurrenceSourceId ?? entry.id.split("::recurrence::", 1)[0];
    const current = grouped.get(key);
    if (current) current.count += 1;
    else grouped.set(key, { entry, count: 1 });
  }
  return (
    <>
      <ul className={`task-summary-list${className ? ` ${className}` : ""}`}>
        {[...grouped.values()].map(({ entry, count }) => (
          <TaskSummaryRow
            key={`${entry.id}:${entry.date}`}
            entry={entry}
            count={count}
            locale={locale}
            settings={settings}
            onToggle={onToggle}
            onStatus={onStatus}
            onOpen={onOpen}
            onOpenStatusMenu={(target, rect) => setStatusMenu({
              entry: target,
              status: target.status ?? "open",
              left: rect.left,
              top: rect.bottom + 4,
            })}
          />
        ))}
      </ul>
      {statusMenu && onStatus && (
        <TaskStatusMenu
          state={{ status: statusMenu.status, left: statusMenu.left, top: statusMenu.top }}
          locale={locale}
          onClose={() => setStatusMenu(null)}
          onSelect={(status) => {
            const entry = statusMenu.entry;
            setStatusMenu(null);
            onStatus(entry, status);
          }}
        />
      )}
    </>
  );
}

function TaskSummaryRow({
  entry,
  count,
  locale,
  settings,
  onToggle,
  onStatus,
  onOpen,
  onOpenStatusMenu,
}: {
  entry: Entry;
  count: number;
  locale: Locale;
  settings: ChronoEonSettings;
  onToggle: (id: string, entry?: Entry) => void;
  onStatus?: (entry: Entry, status: EntryStatus) => void;
  onOpen: (entry: Entry) => void;
  onOpenStatusMenu: (entry: Entry, rect: DOMRect) => void;
}) {
  const colors = resolveEntryColors(entry, settings);
  const done = entry.status === "done";
  const repeated = count > 1 || Boolean(entry.recurrence && entry.recurrence !== "none");
  const recurrenceLabel = entry.recurrence && entry.recurrence !== "none"
    ? t(recurrenceLabels[entry.recurrence] ?? "recurrence", locale)
    : "";
  const repeatText = count > 1 ? String(count) : recurrenceLabel;
  const longPress = useRef<{ timer: number; startX: number; startY: number } | null>(null);
  const suppressClick = useRef(false);

  const clearLongPress = () => {
    if (longPress.current) window.clearTimeout(longPress.current.timer);
    longPress.current = null;
  };
  const beginLongPress = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!onStatus || event.pointerType !== "touch") return;
    const startX = event.clientX;
    const startY = event.clientY;
    const timer = window.setTimeout(() => {
      const current = longPress.current;
      if (!current) return;
      suppressClick.current = true;
      onOpenStatusMenu(entry, event.currentTarget.getBoundingClientRect());
    }, 460);
    longPress.current = { timer, startX, startY };
  };
  const moveLongPress = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = longPress.current;
    if (!current) return;
    if (Math.abs(event.clientX - current.startX) > 8 || Math.abs(event.clientY - current.startY) > 8) clearLongPress();
  };

  return (
    <li
      className={`task-summary-row${done ? " is-done" : ""}`}
      style={{ "--entry-color": colors.fill } as CSSProperties}
    >
      <button
        type="button"
        className="task-check task-summary-check"
        onClick={(event) => {
          if (suppressClick.current) {
            event.preventDefault();
            suppressClick.current = false;
            return;
          }
          onToggle(entry.id, entry);
        }}
        onPointerDown={beginLongPress}
        onPointerMove={moveLongPress}
        onPointerUp={clearLongPress}
        onPointerCancel={clearLongPress}
        onContextMenu={onStatus ? (event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpenStatusMenu(entry, event.currentTarget.getBoundingClientRect());
        } : undefined}
        aria-pressed={done}
        aria-haspopup={onStatus ? "menu" : undefined}
        aria-label={t(done ? "markOpen" : "markDone", locale)}
        title={t(done ? "markOpen" : "markDone", locale)}
      >
        <TaskStatusGlyph status={entry.status} size={CHIP_ICON_SIZE} />
      </button>
      <button type="button" className="task-summary-main" onClick={() => onOpen(entry)}>
        <span className="task-summary-time">{summaryTime(entry, locale)}</span>
        <FadeText className="task-summary-title">{titleFor(entry, locale)}</FadeText>
      </button>
      {repeated ? (
        <span className="task-summary-repeat" title={recurrenceLabel || t("recurrence", locale)}>
          <RepeatGlyph size={11} />
          {repeatText && <small>{repeatText}</small>}
        </span>
      ) : <span className="task-summary-repeat" aria-hidden="true" />}
      <i className="task-summary-dot" style={{ background: colors.fill }} aria-hidden="true" />
    </li>
  );
}

export function TaskStatusMenu({
  state,
  locale,
  onClose,
  onSelect,
}: {
  state: { status: EntryStatus; left: number; top: number };
  locale: Locale;
  onClose: () => void;
  onSelect: (status: EntryStatus) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: state.left, top: state.top });

  useLayoutEffect(() => {
    const node = menuRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const margin = 8;
    const preferredTop = state.top + rect.height > window.innerHeight
      ? state.top - rect.height - 8
      : state.top;
    setPosition({
      left: Math.max(margin, Math.min(state.left, window.innerWidth - rect.width - margin)),
      top: Math.max(margin, Math.min(preferredTop, window.innerHeight - rect.height - margin)),
    });
    node.focus();
  }, [state.left, state.top]);

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", dismiss, true);
    const unregister = registerModalDismiss((event) => {
      event.preventDefault();
      onClose();
    });
    return () => {
      window.removeEventListener("pointerdown", dismiss, true);
      unregister();
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className="task-status-menu panel"
      role="menu"
      tabIndex={-1}
      aria-label={t("statusLabel", locale)}
      style={{ left: position.left, top: position.top }}
    >
      {TASK_STATUSES.map((status) => (
        <button
          key={status.value}
          type="button"
          role="menuitemradio"
          aria-label={t(status.key, locale)}
          title={t(status.key, locale)}
          aria-checked={state.status === status.value}
          className={state.status === status.value ? "is-active" : ""}
          onClick={() => onSelect(status.value)}
        >
          <TaskStatusGlyph status={status.value} size={15} />
        </button>
      ))}
    </div>,
    document.body,
  );
}

interface TaskSummaryPopoverProps extends Omit<TaskSummaryListProps, "className"> {
  label: string;
  count: number;
  upcomingEntries?: Entry[];
  upcomingLabel?: string;
  upcomingEmptyLabel?: string;
  tone?: "completed" | "overdue";
}

/** Compact count trigger with an anchored, status-actionable task list. */
export function TaskSummaryPopover({
  label,
  count,
  entries,
  upcomingEntries = [],
  upcomingLabel,
  upcomingEmptyLabel,
  locale,
  settings,
  emptyLabel,
  onToggle,
  onStatus,
  onOpen,
  tone = "overdue",
}: TaskSummaryPopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", dismiss, true);
    const unregister = registerModalDismiss((event) => {
      event.preventDefault();
      setOpen(false);
    });
    return () => {
      window.removeEventListener("pointerdown", dismiss, true);
      unregister();
    };
  }, [open]);

  return (
    <div className="task-summary-popover" ref={rootRef}>
      <button
        type="button"
        className={`hero-stat hero-stat--button hero-stat--${tone}${count > 0 ? " has-items" : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
      >
        <strong>{count}</strong>
        <span>{label}</span>
      </button>
      <MotionPresence>{open && (
        <div className="task-summary-menu" role="dialog" aria-label={label}>
          <TaskSummaryList
            entries={entries}
            locale={locale}
            settings={settings}
            emptyLabel={emptyLabel}
            onToggle={onToggle}
            onStatus={onStatus}
            onOpen={(entry) => {
              setOpen(false);
              onOpen(entry);
            }}
          />
          {upcomingEntries.length > 0 && upcomingLabel && upcomingEmptyLabel && (
            <>
              <div className="task-summary-divider"><span>{upcomingLabel}</span></div>
              <TaskSummaryList
                entries={upcomingEntries}
                locale={locale}
                settings={settings}
                emptyLabel={upcomingEmptyLabel}
                onToggle={onToggle}
                onStatus={onStatus}
                onOpen={(entry) => {
                  setOpen(false);
                  onOpen(entry);
                }}
              />
            </>
          )}
        </div>
      )}</MotionPresence>
    </div>
  );
}
