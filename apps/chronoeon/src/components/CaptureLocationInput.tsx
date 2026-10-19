import { useMemo, useRef } from "react";
import type { CaptureHistoryItem } from "@chronoeon/domain";
import type { Locale } from "../domain/entry";
import { t } from "../i18n";
import { Icon } from "./Icon";
import { FieldSuggestions, locationFieldCandidates } from "./FieldSuggestions";

export function CaptureLocationInput({ value, history, date, locale, locating, onChange, onLocate }: {
  value?: string; history: CaptureHistoryItem[]; date: string; locale: Locale; locating: boolean;
  onChange: (value: string | undefined) => void; onLocate: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const suggestions = useMemo(() => locationFieldCandidates("", value, history, date), [history, value, date]);
  return (
    <span className="capture-review-location-wrap">
      <input className="capture-review-location" ref={inputRef} value={value ?? ""} placeholder={t("locationPlaceholder", locale)}
        aria-label={t("location", locale)} onChange={event => onChange(event.target.value || undefined)} />
      {Boolean(value) && <button type="button" className="capture-review-location-clear" onClick={() => onChange(undefined)}
        aria-label={t("clearLocation", locale)} title={t("clearLocation", locale)}><Icon name="close" size={11} /></button>}
      <button type="button" className="capture-review-location-pin" onClick={onLocate} disabled={locating}
        aria-label={t("useDeviceLocation", locale)} title={t("useDeviceLocation", locale)}><Icon name="map-pin" size={12} /></button>
      <FieldSuggestions inputRef={inputRef} locale={locale} suggestions={suggestions} onSelect={onChange} />
    </span>
  );
}