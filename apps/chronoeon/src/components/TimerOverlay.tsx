import { useEffect, useState } from "react";
import { formatTimerDuration, isTimerRunning, timerElapsedMs, type Locale, type TimerSession } from "@chronoeon/domain";
import { categoryLabel, t } from "../i18n";
import { listenTimerState, sendTimerCommand, type TimerCommand } from "../platform/timerWindow";
import { Icon } from "./Icon";

interface TimerOverlayProps {
  locale: Locale;
  /** Test seam: initial session without an event bridge. */
  initialSession?: TimerSession | null;
  onCommand?: (command: TimerCommand) => void;
}

/**
 * Body of the always-on-top timer window: one line of context, the clock, and
 * three controls. It owns no timer state; it renders whatever the main window
 * last broadcast and ticks locally between pushes.
 */
export function TimerOverlay({ locale, initialSession = null, onCommand }: TimerOverlayProps) {
  const [session, setSession] = useState<TimerSession | null>(initialSession);
  const [now, setNow] = useState(() => Date.now());
  const running = isTimerRunning(session);

  useEffect(() => {
    let disposed = false;
    let dispose: (() => void) | undefined;
    void listenTimerState((next) => { if (!disposed) { setSession(next); setNow(Date.now()); } }).then((unlisten) => {
      if (disposed) unlisten(); else dispose = unlisten;
    }).catch((error) => console.warn("Timer state listener failed", error));
    return () => { disposed = true; dispose?.(); };
  }, []);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const send = (command: TimerCommand) => {
    onCommand?.(command);
    void sendTimerCommand(command).catch((error) => console.warn("Timer command failed", error));
  };

  const elapsed = formatTimerDuration(timerElapsedMs(session, now));
  const category = session?.category ? categoryLabel(session.category, locale, session.category) : "";

  return (
    <div className={`timer-overlay${running ? " is-running" : ""}`} data-tauri-drag-region>
      <div className="timer-overlay-head" data-tauri-drag-region>
        <span className="timer-overlay-title" data-tauri-drag-region title={session?.title}>{session?.title ?? t("timer", locale)}</span>
        <button type="button" className="icon-button timer-overlay-close" onClick={() => send("hide")} aria-label={t("close", locale)} title={t("close", locale)}><Icon name="close" size={12} /></button>
      </div>
      <p className="timer-overlay-meta" data-tauri-drag-region>
        {category && <span>{category}</span>}
        {session?.location && <span><Icon name="map-pin" size={10} />{session.location}</span>}
      </p>
      <div className="timer-overlay-row">
        <output className="timer-overlay-clock" aria-live="polite">{elapsed}</output>
        <div className="timer-overlay-controls">
          {running
            ? <button type="button" className="icon-button" onClick={() => send("pause")} aria-label={t("timerPause", locale)} title={t("timerPause", locale)}><Icon name="pause" size={14} /></button>
            : <button type="button" className="icon-button" onClick={() => send("resume")} aria-label={t("timerResume", locale)} title={t("timerResume", locale)}><Icon name="play" size={14} /></button>}
          <button type="button" className="icon-button timer-overlay-stop" onClick={() => send("stop")} aria-label={t("timerFinish", locale)} title={t("timerFinish", locale)}><Icon name="stop" size={13} /></button>
        </div>
      </div>
    </div>
  );
}
