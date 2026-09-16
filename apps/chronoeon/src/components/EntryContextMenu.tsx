import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Entry, EntryStatus, Locale } from "@chronoeon/domain";
import { t, type MessageKey } from "../i18n";
import { Icon, type IconName } from "./Icon";
import { TaskStatusGlyph } from "./ItemGlyph";

export interface EntryMenuTarget {
  entry: Entry;
  x: number;
  y: number;
}

interface EntryContextMenuProps {
  locale: Locale;
  target: EntryMenuTarget;
  onClose: () => void;
  onEdit: (entry: Entry) => void;
  onStatus: (entry: Entry, status: EntryStatus) => void;
  onDuplicate: (entry: Entry) => void;
  onMoveByDays: (entry: Entry, days: number) => void;
  onOpenDay: (entry: Entry) => void;
  onCopyText: (entry: Entry) => void;
  onDelete: (entry: Entry) => void;
}

const statuses: Array<{ value: EntryStatus; key: MessageKey }> = [
  { value: "open", key: "statusOpen" },
  { value: "in-progress", key: "statusInProgress" },
  { value: "done", key: "statusDone" },
  { value: "cancelled", key: "statusCancelled" }
];

/**
 * Pointer and keyboard reachable entry actions. The plugin exposed these only
 * through a right-click menu, which is unusable on touch; here the same menu is
 * also opened by the row's "more" button and by the context-menu key, and it is
 * flipped inside the viewport so it never opens off-screen on a small window.
 */
export function EntryContextMenu({
  locale,
  target,
  onClose,
  onEdit,
  onStatus,
  onDuplicate,
  onMoveByDays,
  onOpenDay,
  onCopyText,
  onDelete
}: EntryContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: target.x, top: target.y });

  useLayoutEffect(() => {
    const node = menuRef.current;
    if (!node) return;
    const { width, height } = node.getBoundingClientRect();
    const margin = 8;
    const left = Math.max(margin, Math.min(target.x, window.innerWidth - width - margin));
    const top = target.y + height + margin > window.innerHeight
      ? Math.max(margin, target.y - height)
      : target.y;
    setPosition({ left, top });
    node.focus();
  }, [target.x, target.y]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    function onPointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const entry = target.entry;
  const run = (action: () => void) => () => {
    action();
    onClose();
  };

  function item(key: MessageKey, icon: IconName, action: () => void, tone?: "danger") {
    return (
      <button type="button" role="menuitem" className={tone ? `context-item is-${tone}` : "context-item"} onClick={run(action)}>
        <Icon name={icon} size={15} />{t(key, locale)}
      </button>
    );
  }

  return (
    <div
      ref={menuRef}
      className="context-menu panel"
      role="menu"
      tabIndex={-1}
      aria-label={t("entryActions", locale)}
      style={{ left: position.left, top: position.top }}
    >
      <p className="context-title" title={entry.title}>{entry.title}</p>
      {item("edit", "edit", () => onEdit(entry))}
      {entry.kind === "task" && (
        <div className="context-group" role="group" aria-label={t("statusLabel", locale)}>
          <span className="context-group-label">{t("statusLabel", locale)}</span>
          <div className="context-status-row">
            {statuses.map((status) => (
              <button
                key={status.value}
                type="button"
                role="menuitemradio"
                aria-checked={(entry.status ?? "open") === status.value}
                className={(entry.status ?? "open") === status.value ? "is-active" : ""}
                aria-label={t(status.key, locale)}
                title={t(status.key, locale)}
                onClick={run(() => onStatus(entry, status.value))}
              >
                <TaskStatusGlyph status={status.value} size={15} />
              </button>
            ))}
          </div>
        </div>
      )}
      {item("moveToToday", "calendar", () => onMoveByDays(entry, 0))}
      {item("moveToTomorrow", "arrow-right", () => onMoveByDays(entry, 1))}
      {item("openDay", "day", () => onOpenDay(entry))}
      {item("duplicate", "copy", () => onDuplicate(entry))}
      {item("copyText", "book", () => onCopyText(entry))}
      <div className="context-divider" />
      {item("delete", "trash", () => onDelete(entry), "danger")}
    </div>
  );
}
