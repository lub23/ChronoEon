import { useMemo } from "react";
import { formatTimerDuration, type ChronoEonSettings, type Locale } from "@chronoeon/domain";
import { categoryLabel, t } from "../i18n";
import type { LiveTimer } from "../hooks/useLiveTimer";
import type { ConfirmRequest } from "./ConfirmDialog";
import { AttachmentField } from "./AttachmentField";
import { Icon } from "./Icon";
import { timerCategoryOptions } from "./TimerStartForm";

interface TimerRunningProps {
  locale: Locale;
  settings: ChronoEonSettings;
  timer: LiveTimer;
  onConfirm?: (request: ConfirmRequest) => Promise<boolean>;
  /** Called after the recording is finished so a dialog host can close. */
  onFinished?: () => void;
  /** Desktop only: re-open the always-on-top timer window. */
  onPin?: () => void;
  onNotice?: (message: string, tone?: "normal" | "warning") => void;
}

/**
 * The running-clock surface shared by the dialog and the mini window: title,
 * category/location line, big readout, controls, and a collapsible details
 * block so notes and photos can still be added while the clock runs.
 */
export function TimerRunning({ locale, settings, timer, onConfirm, onFinished, onPin, onNotice }: TimerRunningProps) {
  const session = timer.session;
  const options = useMemo(() => timerCategoryOptions(settings, locale), [locale, settings]);
  const category = options.find((option) => option.value === session?.category);
  const today = useMemo(() => {
    const now = new Date(session?.createdAt ?? Date.now());
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }, [session?.createdAt]);

  function discard() {
    const request: ConfirmRequest = {
      title: t("timerDiscardConfirm", locale),
      detail: session?.title,
      confirmLabel: t("timerDiscard", locale),
      tone: "danger",
    };
    if (!onConfirm) {
      timer.cancel();
      return;
    }
    void onConfirm(request).then((accepted) => { if (accepted) timer.cancel(); });
  }

  async function finish() {
    try { await timer.stop(); onFinished?.(); }
    catch { onNotice?.(t("timerSaveFailed", locale), "warning"); }
  }

  if (!session) return null;

  return (
    <>
      <p className="timer-title" title={session.title}>{session.title}</p>
      <p className="timer-meta">
        {category && <span className="timer-meta-category"><i style={{ background: category.color }} aria-hidden="true" />{category.label}</span>}
        {!category && session.category && <span className="timer-meta-category">{categoryLabel(session.category, locale)}</span>}
        {session.location && <span className="timer-meta-location"><Icon name="map-pin" size={11} />{session.location}</span>}
      </p>
      <output className={`timer-readout${timer.running ? " is-running" : ""}`} aria-live="polite" aria-atomic="true">{formatTimerDuration(timer.elapsed)}</output>
      <div className="timer-controls">
        {timer.running
          ? <button type="button" className="secondary-button" disabled={timer.finishing} onClick={timer.pause}><Icon name="pause" size={16} />{t("timerPause", locale)}</button>
          : <button type="button" className="secondary-button" disabled={timer.finishing} onClick={timer.resume}><Icon name="play" size={16} />{t("timerResume", locale)}</button>}
        <button type="button" className="primary-action" disabled={timer.finishing} onClick={() => void finish()}>
          <Icon name="stop" size={15} />{t(timer.finishing ? "saving" : "timerFinish", locale)}
        </button>
      </div>
      <details className="timer-details">
        <summary>{t("timerDetails", locale)}</summary>
        <label className="field-label"><span>{t("location", locale)}</span>
          <input value={session.location ?? ""} onChange={(event) => timer.update({ location: event.target.value })} placeholder={t("locationPlaceholder", locale)} />
        </label>
        <label className="field-label"><span>{t("note", locale)}</span>
          <textarea rows={2} value={session.note ?? ""} onChange={(event) => timer.update({ note: event.target.value })} placeholder={t("notePlaceholder", locale)} />
        </label>
        <AttachmentField locale={locale} settings={settings} entryDate={today} value={session.images ?? []} camera onChange={(images) => timer.update({ images })} onNotice={onNotice} />
      </details>
      <div className="timer-secondary">
        {onPin && <button type="button" className="link-button" onClick={onPin}><Icon name="pin" size={12} />{t("timerPin", locale)}</button>}
        <button type="button" className="danger-button timer-discard" disabled={timer.finishing} onClick={discard}><Icon name="trash" size={15} />{t("timerDiscard", locale)}</button>
      </div>
    </>
  );
}
