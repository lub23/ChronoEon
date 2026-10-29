import { useState } from "react";
import type { Locale } from "@chronoeon/domain";
import { isTauri } from "../platform/desktop";
import { t } from "../i18n";
import { Icon } from "./Icon";

/** Editable credentials remain selectable; clipboard access uses the native bridge. */
export function SecretInput({ value, onChange, locale, ariaLabel, autoComplete = "off" }: {
  value: string; onChange: (value: string) => void; locale: Locale; ariaLabel: string; autoComplete?: string;
}) {
  const [visible, setVisible] = useState(true);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function clipboard(copy: boolean) {
    if (busy) return;
    setBusy(true); setNotice("");
    try {
      const api = isTauri() ? await import("@tauri-apps/plugin-clipboard-manager") : navigator.clipboard;
      if (copy) { await api.writeText(value); setNotice(t("copiedText", locale)); }
      else { const text = await api.readText(); if (text !== null) onChange(text); }
    } catch { setNotice(t("clipboardUnavailable", locale)); }
    finally { setBusy(false); }
  }
  return <div className="secret-field">
    <div className="secret-input-controls">
      <input type={visible ? "text" : "password"} value={value} aria-label={ariaLabel} autoComplete={autoComplete}
        autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={event => onChange(event.target.value)} />
      <button type="button" className="icon-button" disabled={busy || !value} aria-label={`${t("copy", locale)} ${ariaLabel}`} title={t("copy", locale)} onClick={() => void clipboard(true)}><Icon name="copy" size={15} /></button>
      <button type="button" className="icon-button" disabled={busy} aria-label={`${t("paste", locale)} ${ariaLabel}`} title={t("paste", locale)} onClick={() => void clipboard(false)}><Icon name="clipboard" size={15} /></button>
      <button type="button" className="secret-visibility" aria-label={t(visible ? "hideSecret" : "showSecret", locale)} aria-pressed={visible} onClick={() => setVisible(!visible)}>{t(visible ? "hideSecret" : "showSecret", locale)}</button>
    </div>
    {notice && <small role="status">{notice}</small>}
  </div>;
}
