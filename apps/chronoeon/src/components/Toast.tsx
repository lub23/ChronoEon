import type { Locale } from "../domain/entry";
import { t } from "../i18n";
import { Icon } from "./Icon";

export interface ToastState {
  message: string;
  tone?: "normal" | "warning";
  /** Optional follow-up, e.g. undoing a delete. */
  action?: { label: string; run: () => void };
}

export function Toast({ toast, locale, onDismiss }: { toast: ToastState; locale: Locale; onDismiss: () => void }) {
  return (
    <div className={`toast toast--${toast.tone ?? "normal"}`} role="status" aria-live={toast.tone === "warning" ? "assertive" : "polite"}>
      <span className="toast-mark"><Icon name={toast.tone === "warning" ? "close" : "check"} size={15} /></span>
      <span className="toast-message">{toast.message}</span>
      {toast.action && (
        <button type="button" className="toast-action" onClick={() => { toast.action?.run(); onDismiss(); }}>{toast.action.label}</button>
      )}
      <button type="button" className="toast-close" onClick={onDismiss} aria-label={t("close", locale)} title={t("close", locale)}>
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}