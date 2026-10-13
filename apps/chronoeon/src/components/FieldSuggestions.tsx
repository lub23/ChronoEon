import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { captureMatchPositions, inferLocationCandidates, type CaptureHistoryItem } from "@chronoeon/domain";
import type { Locale } from "../domain/entry";
import { t } from "../i18n";
import { useModalDismiss } from "./modalLayer";

export function locationFieldCandidates(title: string, query: string | undefined, history: readonly CaptureHistoryItem[], date: string) {
  const titleScores = new Map(inferLocationCandidates(title, history, date, history.length).map(value => [value.value, value.score]));
  const ranked = new Map<string, number>();
  const typed = query?.trim().toLocaleLowerCase() ?? "";
  const recent = [...history].filter(item => item.location).sort((a, b) => b.date.localeCompare(a.date))[0]?.location;
  for (const item of history) {
    const value = item.location?.trim();
    if (!value || captureMatchPositions(value, typed) === null) continue;
    const match = !typed ? 0 : value.toLocaleLowerCase().startsWith(typed) ? 8 : value.toLocaleLowerCase().includes(typed) ? 6 : 4;
    const days = Math.abs(Date.parse(date) - Date.parse(item.date)) / 86_400_000;
    const score = match + (titleScores.get(value) ?? 0) * 3 + (value === recent ? 1 : 0) + (Number.isFinite(days) ? 1 / (1 + days) : 0);
    ranked.set(value, Math.max(ranked.get(value) ?? 0, score));
  }
  return [...ranked].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value]) => ({ value }));
}

interface Props {
  inputRef: { current: HTMLInputElement | HTMLTextAreaElement | null };
  locale: Locale;
  label?: string;
  suggestions: Array<{ value: string; label?: string }>;
  onSelect: (value: string) => void;
  query?: string;
  caret?: boolean;
}

function Highlight({ text, query }: { text: string; query: string }) {
  const positions = new Set(captureMatchPositions(text, query) ?? []);
  return <>{text.split("").map((character, index) => positions.has(index) ? <mark key={index}>{character}</mark> : character)}</>;
}

/** Portaled outside scroll containers; uses the same usable viewport as the app. */
export function FieldSuggestions({ inputRef, locale, label, suggestions, onSelect, query, caret = false }: Props) {
  const id = useId();
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 220, maxHeight: 172 });
  const menu = useRef<HTMLDivElement>(null);
  const pointerInMenu = useRef(false);
  const selectedValue = useRef<string | null>(null);
  const current = useRef({ active, suggestions, onSelect });
  current.current = { active, suggestions, onSelect };
  const signature = suggestions.map(suggestion => suggestion.value).join("\0");
  const typed = query ?? inputRef.current?.value ?? "";
  const visible = focused && !dismissed && suggestions.length > 0 && Boolean(inputRef.current);

  useEffect(() => { setActive(0); if (typed !== selectedValue.current) setDismissed(false); }, [signature, typed]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const focus = () => { setFocused(true); setDismissed(false); };
    const blur = () => { if (!pointerInMenu.current) setFocused(false); };
    setFocused(document.activeElement === input);
    input.addEventListener("focus", focus);
    input.addEventListener("blur", blur);
    return () => { input.removeEventListener("focus", focus); input.removeEventListener("blur", blur); };
  }, [inputRef]);

  useModalDismiss(event => { event.preventDefault(); event.stopPropagation(); setDismissed(true); }, visible);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!visible || !input) return;
    const place = () => {
      const rect = input.getBoundingClientRect();
      const viewport = window.visualViewport;
      const leftEdge = (viewport?.offsetLeft ?? 0) + 8;
      const topEdge = (viewport?.offsetTop ?? 0) + 8;
      const rightEdge = leftEdge + (viewport?.width ?? window.innerWidth) - 16;
      const bottomEdge = topEdge + (viewport?.height ?? window.innerHeight) - 16;
      const width = Math.max(0, Math.min(caret ? 280 : Math.max(220, rect.width), rightEdge - leftEdge));
      let top = rect.top, bottom = rect.bottom, left = rect.left;
      if (caret && input instanceof HTMLTextAreaElement) {
        // A styled mirror measures wrapped lines and proportional fonts exactly.
        const mirror = document.createElement("div");
        const style = getComputedStyle(input);
        for (const property of ["font", "line-height", "padding", "border", "box-sizing", "letter-spacing", "word-spacing", "tab-size"]) mirror.style.setProperty(property, style.getPropertyValue(property));
        Object.assign(mirror.style, { position: "fixed", visibility: "hidden", width: `${rect.width}px`, whiteSpace: "pre-wrap", overflowWrap: "break-word" });
        mirror.textContent = input.value.slice(0, input.selectionStart);
        const marker = document.createElement("span");
        marker.textContent = input.value.slice(input.selectionStart) || ".";
        mirror.append(marker);
        document.body.append(mirror);
        const lineHeight = parseFloat(style.lineHeight) || 20;
        top = Math.max(rect.top, Math.min(rect.bottom - lineHeight, rect.top + marker.offsetTop - input.scrollTop));
        bottom = top + lineHeight;
        left = rect.left + marker.offsetLeft - input.scrollLeft;
        mirror.remove();
      }
      top = Math.min(bottomEdge, Math.max(topEdge, top));
      bottom = Math.min(bottomEdge, Math.max(topEdge, bottom));
      const below = Math.max(0, bottomEdge - bottom - 4);
      const above = Math.max(0, top - topEdge - 4);
      const desired = Math.min(172, suggestions.length * 32 + 12);
      const useBelow = below >= desired || below >= above;
      const maxHeight = Math.min(desired, useBelow ? below : above);
      setPosition({ left: Math.max(leftEdge, Math.min(left, rightEdge - width)),
        top: Math.max(topEdge, useBelow ? bottom + 4 : top - 4 - maxHeight), width, maxHeight });
    };
    place();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(input);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("selectionchange", place);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("selectionchange", place);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [visible, signature, typed, caret, inputRef]);

  const choose = (value: string) => {
    selectedValue.current = value;
    current.current.onSelect(value);
    pointerInMenu.current = false;
    inputRef.current?.focus({ preventScroll: true });
    setDismissed(true);
  };
  useEffect(() => {
    const input = inputRef.current;
    if (!visible || !input) return;
    input.setAttribute("aria-controls", id);
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-autocomplete", "list");
    const onKeyDown = (event: Event) => {
      if (!(event instanceof KeyboardEvent)) return;
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault(); event.stopPropagation();
        setActive(index => (index + (event.key === "ArrowDown" ? 1 : -1) + current.current.suggestions.length) % current.current.suggestions.length);
      } else if (event.key === "Enter") {
        event.preventDefault(); event.stopPropagation();
        choose(current.current.suggestions[current.current.active]?.value ?? current.current.suggestions[0].value);
      }
    };
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (input === target || menu.current?.contains(target)) return;
      pointerInMenu.current = false; setDismissed(true);
    };
    input.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", dismiss, true);
    return () => {
      input.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", dismiss, true);
      for (const attribute of ["aria-controls", "aria-expanded", "aria-autocomplete", "aria-activedescendant"]) input.removeAttribute(attribute);
    };
  }, [inputRef, visible, id]);

  useEffect(() => {
    if (!visible) return;
    inputRef.current?.setAttribute("aria-activedescendant", `${id}-${active}`);
    menu.current?.querySelector<HTMLElement>(`[aria-selected="true"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, visible, id, inputRef]);

  if (!visible) return null;
  return createPortal(
    <div ref={menu} className="field-suggestion-anchor" style={position}
      onPointerDown={() => { pointerInMenu.current = true; }}
      onPointerUp={() => { pointerInMenu.current = false; inputRef.current?.focus({ preventScroll: true }); }}
      onPointerCancel={() => { pointerInMenu.current = false; }}>
      <div id={id} className="field-suggestion-menu" role="listbox" aria-label={label ?? t("location", locale)} style={{ maxHeight: position.maxHeight }}>
        {suggestions.map((suggestion, index) => (
          <button key={suggestion.value} id={`${id}-${index}`} type="button" role="option" aria-selected={index === active}
            className={index === active ? "is-active" : ""} tabIndex={-1}
            onMouseDown={event => event.preventDefault()} onClick={() => choose(suggestion.value)}>
            <Highlight text={suggestion.label ?? suggestion.value} query={typed} />
          </button>
        ))}
      </div>
    </div>, document.body);
}
