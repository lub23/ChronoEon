import { useState } from "react";
import type { SyncStore } from "@chronoeon/storage";
import type { Locale } from "../domain/entry";
import { t } from "../i18n";
import { pruneUnreferencedAttachments } from "../platform/attachments";
import { formatBytes } from "../sync/types";
import { useConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";

const MINIMUM_AGE_MS = 24 * 60 * 60 * 1000;

export function AttachmentMaintenance({ locale, journal, onChanged }: {
  locale: Locale;
  journal: SyncStore;
  onChanged?: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const { confirm, dialog } = useConfirmDialog(locale);

  const clean = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const preview = await journal.maintainAttachments(hashes => pruneUnreferencedAttachments(hashes, MINIMUM_AGE_MS, false));
      if (!preview.files) {
        setMessage({ ok: true, text: t("attachmentCleanupNone", locale) });
        return;
      }
      const approved = await confirm({
        title: t("attachmentCleanupConfirmTitle", locale),
        detail: `${preview.files} ${t("attachmentCleanupFiles", locale)} · ${formatBytes(preview.bytes, locale)}`,
        confirmLabel: t("attachmentCleanupAction", locale),
        tone: "danger",
      });
      if (!approved) return;
      const removed = await journal.maintainAttachments(hashes => pruneUnreferencedAttachments(hashes, MINIMUM_AGE_MS, true));
      setMessage({
        ok: true,
        text: `${t("attachmentCleanupDone", locale)} ${removed.files} ${t("attachmentCleanupFiles", locale)} · ${formatBytes(removed.bytes, locale)}`,
      });
      await onChanged?.();
    } catch {
      setMessage({ ok: false, text: t("attachmentCleanupFailed", locale) });
    } finally {
      setBusy(false);
    }
  };

  return <div className="settings-card settings-data-card">
    <div className="settings-data-block">
      <div className="settings-option-copy">
        <strong>{t("attachmentCleanupTitle", locale)}</strong>
        <small>{t("attachmentCleanupDetail", locale)}</small>
      </div>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void clean()}>
        <Icon name="trash" size={15} />{busy ? t("attachmentCleanupChecking", locale) : t("attachmentCleanupAction", locale)}
      </button>
    </div>
    {message && <p role={message.ok ? "status" : "alert"} className={`settings-footnote ${message.ok ? "is-success" : "is-error"}`}>{message.text}</p>}
    {dialog}
  </div>;
}