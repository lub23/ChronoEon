import { registerModalDismiss } from "./modalLayer";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Locale } from "../domain/entry";
import { t } from "../i18n";

export function parseTags(text: string): string[] {
  return [...new Set(text.split(/[,，]/).map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean))];
}

/** Keep the unfinished token intact; normalizing on every key loses commas. */
export function TagInput({ value = [], available, onChange, locale }: {
  value?: string[]; available: string[]; onChange: (tags: string[] | undefined) => void; locale: Locale;
}) {
  const [text, setText] = useState(value.join(", "));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const emitted = useRef(value.join("\0"));
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    const key = value.join("\0");
    if (key !== emitted.current) { setText(value.join(", ")); emitted.current = key; }
  }, [value]);
  const suggestions = useMemo(() => {
    const parts = text.split(/[,，]/);
    const query = (parts.pop() ?? "").trim().replace(/^#/, "").toLocaleLowerCase();
    const selected = new Set(parseTags(parts.join(",")).map((tag) => tag.toLocaleLowerCase()));
    return [...new Set(available)].filter((tag) => !selected.has(tag.toLocaleLowerCase())
      && tag.toLocaleLowerCase().includes(query)).sort((a, b) => a.localeCompare(b)).slice(0, 8);
  }, [available, text]);
  function change(next: string) {
    setText(next);
    const tags = parseTags(next);
    emitted.current = tags.join("\0");
    onChange(tags.length ? tags : undefined);
    setActive(0);
  }
  function choose(tag: string) {
    const parts = text.split(/[,，]/); parts.pop();
    change([...parseTags(parts.join(",")), tag].join(", ") + ", ");
    setOpen(false);
    input.current?.focus();
  }
  const expanded = open && suggestions.length > 0;
  useEffect(() => expanded ? registerModalDismiss((event) => { event.preventDefault(); setOpen(false); }) : undefined, [expanded]);
  return <div className="tag-input">
    <input ref={input} role="combobox" aria-label={t("tags", locale)} aria-autocomplete="list"
      aria-expanded={expanded} aria-controls={expanded ? id : undefined}
      aria-activedescendant={expanded ? `${id}-${active}` : undefined} autoComplete="off"
      value={text} placeholder={t("tagsPlaceholder", locale)}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
      onChange={(event) => { change(event.target.value); setOpen(true); }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (expanded && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
          event.preventDefault(); setActive((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length);
        } else if (expanded && event.key === "Enter") {
          event.preventDefault(); event.stopPropagation(); choose(suggestions[active]);
        } else if (expanded && event.key === "Escape") {
          event.preventDefault(); event.stopPropagation(); setOpen(false);
        }
      }} />
    {expanded && <div id={id} className="tag-suggestions" role="listbox" aria-label={t("existingTags", locale)}>
      {suggestions.map((tag, index) => <button type="button" role="option" id={`${id}-${index}`} key={tag}
        aria-selected={index === active} onPointerDown={(event) => event.preventDefault()}
        onClick={() => choose(tag)}>#{tag}</button>)}
    </div>}
  </div>;
}
