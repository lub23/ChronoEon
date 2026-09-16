import { useState } from "react";
import { attachmentLabel, type ChronoEonSettings, type Locale } from "@chronoeon/domain";
import { pickEntryAttachments, releaseAttachment } from "../platform/attachments";
import { isMobilePlatform } from "../hooks/useTouchDevice";
import { t } from "../i18n";
import { AttachmentThumb } from "./AttachmentThumb";
import { Icon } from "./Icon";
import { openImagePreview } from "./photoPreviewBus";

interface AttachmentFieldProps {
  locale: Locale;
  settings: ChronoEonSettings;
  entryDate: string;
  value: string[];
  disabled?: boolean;
  /** Offer a "take photo" action on phones (camera capture). */
  camera?: boolean;
  onChange: (next: string[]) => void;
  onNotice?: (message: string, tone?: "normal" | "warning") => void;
}

/**
 * Photo attachments for an entry. On Tauri the photo goes through the local
 * compress pipeline; the browser demo accepts a photo but keeps a session-only
 * blob and says so plainly.
 */
export function AttachmentField({
  locale,
  settings,
  entryDate,
  value,
  disabled = false,
  camera = false,
  onChange,
  onNotice
}: AttachmentFieldProps) {
  const [busy, setBusy] = useState(false);
  const showCamera = camera && isMobilePlatform();

  async function add(capture = false) {
    if (disabled || busy) return;
    setBusy(true);
    try {
      const { picked, skipped } = await pickEntryAttachments({ settings, entryDate, capture });
      if (skipped.length) onNotice?.(`${t("attachmentImportFailed", locale)} · ${skipped.join(", ")}`, "warning");
      if (picked.length) onChange([...value, ...picked.map((item) => item.reference)]);
    } catch (error) {
      console.warn("Could not attach photos", error);
      onNotice?.(t("attachmentSaveFailed", locale), "warning");
    } finally {
      setBusy(false);
    }
  }

  function remove(reference: string) {
    releaseAttachment(reference);
    onChange(value.filter((item) => item !== reference));
  }

  const sessionOnly = value.some((reference) => reference.startsWith("blob:"));

  return (
    <section className="attachment-field" aria-label={t("attachments", locale)}>
      <div className="attachment-head">
        <span className="field-label-text">{t("attachments", locale)}{value.length > 0 && <small> · {value.length} {t("attachmentsCount", locale)}</small>}</span>
        <div className="attachment-actions">
          {showCamera && (
            <button type="button" className="secondary-button attachment-add" onClick={() => void add(true)} disabled={disabled || busy}>
              <Icon name="camera" size={15} />{t("takePhoto", locale)}
            </button>
          )}
          <button type="button" className="secondary-button attachment-add" onClick={() => void add()} disabled={disabled || busy}>
            <Icon name="image" size={15} />{busy ? t("importExportBusy", locale) : t("addAttachment", locale)}
          </button>
        </div>
      </div>
      <p className="field-hint">{sessionOnly ? t("attachmentSessionOnly", locale) : t("attachmentHint", locale)}</p>
      {value.length > 0 && (
        <>
          <ul className="attachment-grid">
            {value.map((reference, position) => (
              <li key={reference}>
                <button
                  type="button"
                  className="attachment-open"
                  onClick={() => openImagePreview(value, position)}
                  aria-label={`${t("photoPreview", locale)} · ${attachmentLabel(reference)}`}
                  title={t("photoPreview", locale)}
                >
                  <AttachmentThumb locale={locale} reference={reference} />
                </button>
                <button
                  type="button"
                  className="attachment-remove"
                  onClick={() => remove(reference)}
                  aria-label={`${t("removeAttachment", locale)} · ${attachmentLabel(reference)}`}
                  title={t("removeAttachment", locale)}
                  disabled={disabled}
                >
                  <Icon name="close" size={13} />
                </button>
              </li>
            ))}
          </ul>
          <p className="field-hint field-hint--quiet">{t("attachmentKeepsFile", locale)}</p>
        </>
      )}
    </section>
  );
}
