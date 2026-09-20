import { useEffect, useRef, useState } from "react";
import { createMotionPortal as createPortal } from "./MotionPresence";
import type { Locale } from "../domain/entry";
import { t } from "../i18n";
import { Icon } from "./Icon";
import { useModalDismiss } from "./modalLayer";

interface QuickNoteDialogProps {
  locale: Locale;
  onParse: (text: string) => void;
  onManualAdd: (text: string) => void;
  onClose: () => void;
}

export function QuickNoteDialog({ locale, onParse, onManualAdd, onClose }: QuickNoteDialogProps) {
  const [text, setText] = useState("");
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [notice, setNotice] = useState("");

  useModalDismiss((event) => { event.preventDefault(); onClose(); });
  useEffect(() => { areaRef.current?.focus({ preventScroll: true }); }, []);
  function submit() {
    const value = text.trim();
    if (!value) { setNotice(t("quickNoteEmpty", locale)); return; }
    onParse(value);
  }
  return createPortal(<div className="quick-note-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="quick-note" role="dialog" aria-modal="true" aria-label={t("quickNote", locale)}>
      <header className="quick-note-head"><strong>{t("quickNote", locale)}</strong>
        <button type="button" className="icon-button" onClick={onClose} aria-label={t("close", locale)}><Icon name="close" size={16} /></button>
      </header>
      <textarea ref={areaRef} className="quick-note-input" value={text} rows={4}
        aria-label={t("quickNote", locale)} placeholder={t("quickNotePlaceholder", locale)} onChange={event => { setText(event.target.value); setNotice(""); }}
        onKeyDown={event => { if (!event.nativeEvent.isComposing && event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit(); } }} />
      <div className="quick-note-feedback">
        <p className={notice ? "quick-note-notice is-visible" : "quick-note-notice"} role="status" aria-live="polite">{notice}</p>
      </div>
      <footer className="quick-note-actions">
        <div className="quick-note-submit">
        <button type="button" className="secondary-button quick-note-manual" onClick={() => onManualAdd(text.trim())}>{t("quickNoteManualAdd", locale)}</button>
        <button type="button" className="primary-action" onClick={submit}>{t("quickNoteParse", locale)}</button>
        </div>
      </footer>
    </section>
  </div>, document.body);
}
