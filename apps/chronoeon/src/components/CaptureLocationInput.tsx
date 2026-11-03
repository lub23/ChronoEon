import { useMemo } from "react";
import type { CaptureHistoryItem, GeoPlace, GeoPoint, Locale } from "@chronoeon/domain";
import { LocationField } from "./LocationField";
import { locationFieldCandidates } from "./FieldSuggestions";

export function CaptureLocationInput({ value, history, date, locale, places, onPlaceLocated, onChange }: {
  value?: string; history: CaptureHistoryItem[]; date: string; locale: Locale; places?: GeoPlace[];
  onChange: (value: string | undefined) => void; onPlaceLocated?: (address: string, point: GeoPoint) => void;
}) {
  const suggestions = useMemo(() => locationFieldCandidates("", value, history, date), [history, value, date]);
  return <span className="capture-review-location-wrap"><LocationField value={value} locale={locale} suggestions={suggestions} places={places} onPlaceLocated={onPlaceLocated} onChange={onChange} /></span>;
}
