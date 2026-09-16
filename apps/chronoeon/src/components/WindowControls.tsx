import { useEffect, useState } from "react";
import type { Locale } from "../domain/entry";
import { observeDesktopMaximized, performDesktopWindowAction, startDesktopResize, type DesktopResizeDirection } from "../platform/desktop";
import { t } from "../i18n";
import { Icon } from "./Icon";

interface WindowControlsProps {
  locale: Locale;
  mini?: boolean;
}

export function WindowControls({ locale, mini = false }: WindowControlsProps) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let unlisten: () => void = () => undefined;
    let disposed = false;
    void observeDesktopMaximized((next) => { if (!disposed) setMaximized(next); })
      .then((cleanup) => {
        if (disposed) cleanup();
        else unlisten = cleanup;
      });
    return () => {
      disposed = true;
      unlisten();
    };
  }, []);

  return (
    <div className={mini ? "window-controls window-controls--mini" : "window-controls"} role="group" aria-label={t("windowControls", locale)}>
      <button type="button" onClick={() => { void performDesktopWindowAction("minimize"); }} aria-label={t("minimize", locale)} title={t("minimize", locale)}>
        <Icon name="minimize" size={14} />
      </button>
      {!mini && (
        <button
          type="button"
          onClick={() => { void performDesktopWindowAction("toggle-maximize").then(setMaximized); }}
          aria-label={t(maximized ? "restore" : "maximize", locale)}
          aria-pressed={maximized}
          title={t(maximized ? "restore" : "maximize", locale)}
        >
          <Icon name={maximized ? "restore" : "maximize"} size={13} />
        </button>
      )}
      <button className="window-close" type="button" onClick={() => { void performDesktopWindowAction("close"); }} aria-label={t("close", locale)} title={t("close", locale)}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

const resizeHandles: Array<{ direction: DesktopResizeDirection; className: string }> = [
  { direction: "North", className: "resize-handle--n" },
  { direction: "South", className: "resize-handle--s" },
  { direction: "East", className: "resize-handle--e" },
  { direction: "West", className: "resize-handle--w" },
  { direction: "NorthEast", className: "resize-handle--ne" },
  { direction: "NorthWest", className: "resize-handle--nw" },
  { direction: "SouthEast", className: "resize-handle--se" },
  { direction: "SouthWest", className: "resize-handle--sw" },
];

/** Invisible native resize affordances for the undecorated desktop window. */
export function WindowResizeHandles() {
  return (
    <div className="window-resize-handles" aria-hidden="true">
      {resizeHandles.map(({ direction, className }) => (
        <span key={direction} className={`resize-handle ${className}`} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); void startDesktopResize(direction); }} />
      ))}
    </div>
  );
}
