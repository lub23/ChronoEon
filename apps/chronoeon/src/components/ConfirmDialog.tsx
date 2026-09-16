import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Locale } from "../domain/entry";
import { t, type MessageKey } from "../i18n";
import { Icon } from "./Icon";
import { registerModalDismiss } from "./modalLayer";

export interface ConfirmRequest {
  title: string;
  detail?: string;
  confirmLabel?: string;
  tone?: "normal" | "danger";
}

/**
 * In-app confirmation. `window.confirm` blocks the whole webview, cannot be
 * translated (its buttons follow the OS, not the interface language) and looks
 * foreign inside a frameless glass window — so ChronoEon asks for itself.
 */
export function useConfirmDialog(locale: Locale): {
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  dialog: ReactNode;
} {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  useEffect(() => () => { resolver.current?.(false); resolver.current = null; }, []);

  const confirm = useCallback((next: ConfirmRequest) => {
    // A second request while one is open resolves the first as declined so no
    // caller is left waiting on a promise that can never settle.
    resolver.current?.(false);
    setRequest(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setRequest(null);
  }, []);

  // The confirm must own Escape while open, even over a composer that has its
  // own Escape handler. It joins the shared modal bus last (newest wins), so
  // one Escape press settles exactly this dialog; the old behaviour let a
  // lower-level listener close the underlying dirty composer at the same
  // instant, losing the user's edits while this promise never settled.
  useEffect(() => {
    if (!request) return;
    return registerModalDismiss((event) => {
      event.preventDefault();
      event.stopPropagation();
      settle(false);
    });
  }, [request, settle]);

  const dialog = request ? (
    <div
      className="confirm-backdrop"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) settle(false); }}
    >
      <section className="confirm-sheet" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby={request.detail ? "confirm-detail" : undefined}>
        <span className={`confirm-mark${request.tone === "danger" ? " is-danger" : ""}`}>
          <Icon name={request.tone === "danger" ? "trash" : "sparkle"} size={19} />
        </span>
        <h2 id="confirm-title">{request.title}</h2>
        {request.detail && <p id="confirm-detail">{request.detail}</p>}
        <div className="confirm-actions">
          <button type="button" className="secondary-button" autoFocus onClick={() => settle(false)}>{t("cancel", locale)}</button>
          <button
            type="button"
            className={request.tone === "danger" ? "danger-button is-solid" : "primary-action"}
            onClick={() => settle(true)}
          >
            {request.confirmLabel ?? t("delete", locale)}
          </button>
        </div>
      </section>
    </div>
  ) : null;

  return { confirm, dialog };
}

/** Convenience wrapper for the common "delete this entry?" question. */
export function deleteRequest(locale: Locale, titleKey: MessageKey, detail?: string): ConfirmRequest {
  return { title: t(titleKey, locale), detail, confirmLabel: t("delete", locale), tone: "danger" };
}
