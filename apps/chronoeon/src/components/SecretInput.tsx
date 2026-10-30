import { useState } from "react";
import type { Locale } from "@chronoeon/domain";
import { t } from "../i18n";
import { Icon } from "./Icon";

/** Native text selection and paste work exactly as in the other form fields. */
export function SecretInput({ value, onChange, locale, ariaLabel, autoComplete = "off" }: {
  value: string; onChange: (value: string) => void; locale: Locale; ariaLabel: string; autoComplete?: string;
}) {
  const [visible, setVisible] = useState(false);
  return <div className="secret-field">
    <input type={visible ? "text" : "password"} value={value} aria-label={ariaLabel} autoComplete={autoComplete}
      autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={event => onChange(event.target.value)} />
    <button type="button" className="icon-button secret-visibility" aria-label={t(visible ? "hideSecret" : "showSecret", locale)}
      aria-pressed={visible} title={t(visible ? "hideSecret" : "showSecret", locale)} onClick={() => setVisible(!visible)}>
      <Icon name={visible ? "eye-off" : "eye"} size={16} />
    </button>
  </div>;
}
