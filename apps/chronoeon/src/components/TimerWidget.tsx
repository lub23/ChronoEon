import { useEffect, useRef, useState } from "react";
import { registerModalDismiss } from "./modalLayer";
import { formatTimerDuration, inferCategory, type CaptureHistoryItem, type ChronoEonSettings, type Locale } from "@chronoeon/domain";
import { t } from "../i18n";
import type { LiveTimer } from "../hooks/useLiveTimer";
import type { ConfirmRequest } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { TimerRunning } from "./TimerRunning";
import { TimerCategorySelect, TimerStartForm, defaultTimerCategory } from "./TimerStartForm";

interface TimerWidgetProps {
  locale: Locale;
  settings: ChronoEonSettings;
  timer: LiveTimer;
  open: boolean;
  compact?: boolean;
  onConfirm?: (request: ConfirmRequest) => Promise<boolean>;
  onPin?: () => void;
  onNotice?: (message: string, tone?: "normal" | "warning") => void;
  onClose: () => void;
  /** Local entries teach the timer's category suggestion; kept on-device. */
  history?: readonly CaptureHistoryItem[];
}

/**
 * Live recording surface. It is deliberately usable in one keystroke: the title
 * field is focused on open and Enter starts the recording, so a thought about
 * "I should time this" never costs more than the thing being timed.
 */
export function TimerWidget({ locale, settings, timer, open, compact = false, onConfirm, onPin, onNotice, onClose, history = [] }: TimerWidgetProps) {
  const [category, setCategory] = useState(() => defaultTimerCategory(settings));
  const [title, setTitle] = useState("");
  const categoryTouchedRef = useRef(false);

  useEffect(() => { setCategory(defaultTimerCategory(settings)); }, [settings]);

  // A reopened timer starts blank; a prior draft must not quietly pick a category.
  useEffect(() => {
    if (open) return;
    setTitle("");
    categoryTouchedRef.current = false;
    setCategory(defaultTimerCategory(settings));
  }, [open, settings]);

  const changeCategory = (value: string) => {
    categoryTouchedRef.current = true;
    setCategory(value);
  };

  useEffect(() => {
    if (!open || categoryTouchedRef.current) return;
    const suggestionTitle = title.trim();
    if (!suggestionTitle) return;
    const suggestion = inferCategory(suggestionTitle, title, "event", settings, history, new Date());
    if (suggestion.confidence > 0 && suggestion.value !== category) setCategory(suggestion.value);
  }, [category, history, open, settings, title]);

  useEffect(() => {
    if (!open) return;
    return registerModalDismiss((event) => {
      event.preventDefault();
      onClose();
    });
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="timer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`timer-sheet${compact ? " timer-sheet--compact" : ""}`} role="dialog" aria-modal="true" aria-labelledby="timer-heading">
        <header className="timer-header">
          <div className="timer-header-main">
            <span className="eyebrow"><Icon name="timer" size={14} /> {t("timer", locale)}</span>
            <h2 id="timer-heading">{timer.active ? (timer.running ? t("timerRunning", locale) : t("timerPaused", locale)) : t("timerHeading", locale)}</h2>
          </div>
          {!timer.active && <TimerCategorySelect locale={locale} settings={settings} value={category} onChange={changeCategory} />}
          <button className="icon-button" type="button" onClick={onClose} aria-label={t("close", locale)}><Icon name="close" /></button>
        </header>

        {timer.recovered && (
          <p className="timer-recovered" role="status">
            <strong>{t("timerRecovered", locale)}</strong>
            <span>{t("timerRecoveredDetail", locale)}</span>
            <button type="button" className="link-button" onClick={timer.dismissRecovered}>{t("close", locale)}</button>
          </p>
        )}

        {timer.active
          ? <TimerRunning locale={locale} settings={settings} timer={timer} onConfirm={onConfirm} onFinished={onClose} onPin={onPin} onNotice={onNotice} />
          : <TimerStartForm disabled={!timer.ready} locale={locale} settings={settings} category={category} onCategoryChange={changeCategory} onTitleChange={setTitle} onStart={timer.start} onNotice={onNotice} />}
      </section>
    </div>
  );
}

interface TimerPillProps {
  locale: Locale;
  timer: LiveTimer;
  onOpen: () => void;
}

/**
 * Persistent status pill. Once a recording exists it stays reachable from every
 * view, which is what makes pausing from another screen possible at all.
 */
export function TimerPill({ locale, timer, onOpen }: TimerPillProps) {
  if (!timer.active) return null;
  return (
    <div className={`timer-pill${timer.running ? " is-running" : " is-paused"}`}>
      <button type="button" className="timer-pill-main" onClick={onOpen} title={t("timerOpen", locale)}>
        <Icon name="timer" size={15} />
        <span className="timer-pill-time">{formatTimerDuration(timer.elapsed)}</span>
        <span className="timer-pill-title">{timer.session?.title}</span>
      </button>
      <button
        type="button"
        className="icon-button timer-pill-toggle"
        onClick={() => (timer.running ? timer.pause() : timer.resume())}
        aria-label={t(timer.running ? "timerPause" : "timerResume", locale)}
        title={t(timer.running ? "timerPause" : "timerResume", locale)}
      >
        <Icon name={timer.running ? "pause" : "play"} size={14} />
      </button>
    </div>
  );
}
