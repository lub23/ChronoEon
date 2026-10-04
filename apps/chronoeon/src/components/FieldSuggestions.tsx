import { useEffect, useRef, useState } from "react";
import { inferLocationCandidates, type CaptureHistoryItem } from "@chronoeon/domain";
import type { Locale } from "../domain/entry";
import { t } from "../i18n";

/** Match the typed place first, then preserve title-derived history relevance. */
export function locationFieldCandidates(
  title: string, query: string | undefined, history: readonly CaptureHistoryItem[], date: string,
) {
  const ranked = new Map<string, number>();
  const add = (value: string, score: number) => ranked.set(value, Math.max(ranked.get(value) ?? 0, score));
  for (const candidate of inferLocationCandidates(title, history, date)) add(candidate.value, candidate.score + 3);
  const typed = query?.trim().toLocaleLowerCase();
  for (const value of new Set(history.map(item => item.location).filter(Boolean) as string[])) {
    if (typed && !value.toLocaleLowerCase().includes(typed)) continue;
    add(value, typed && value.toLocaleLowerCase().startsWith(typed) ? 3 : 2);
  }
  return [...ranked].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5).map(([value]) => ({ value }));
}

interface Props {
  inputRef: { current: HTMLInputElement | HTMLTextAreaElement | null };
  locale: Locale;
  suggestions: Array<{ value: string }>;
  onSelect: (value: string) => void;
}

/** Keyboard candidates for a free-entry field, anchored below the input caret line. */
export function FieldSuggestions({ inputRef, locale, suggestions, onSelect }: Props) {
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  activeRef.current = active;
  const signature = suggestions.map(suggestion => suggestion.value).join("\0");
  const visible = suggestions.length > 0 && Boolean(inputRef.current);

  useEffect(() => {
    setActive(0);
    const input = inputRef.current;
    if (!visible || !input) return;
    const choose = (value: string) => {
      onSelect(value);
      input.focus();
    };
    const onKeyDown = (event: Event) => {
      if (!(event instanceof KeyboardEvent)) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setActive(current => (current + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length);
      } else if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        choose(suggestions[activeRef.current]?.value ?? suggestions[0]!.value);
      } else if (event.key === "Escape") {
        event.stopPropagation();
      }
    };
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !input.closest(".field-suggestion-anchor")?.contains(event.target)) input.blur();
    };
    input.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", dismiss, true);
    return () => {
      input.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", dismiss, true);
    };
  }, [inputRef, onSelect, signature, suggestions, visible]);

  if (!visible) return null;
  return (
    <div className="field-suggestion-anchor">
      <div className="field-suggestion-menu" role="listbox" aria-label={t("location", locale)}>
        {suggestions.map((suggestion, index) => (
          <button key={suggestion.value} type="button" role="option" aria-selected={index === active}
            className={index === active ? "is-active" : ""} onPointerDown={event => event.preventDefault()}
            onClick={() => onSelect(suggestion.value)}>
            {suggestion.value}
          </button>
        ))}
      </div>
    </div>
  );
}
