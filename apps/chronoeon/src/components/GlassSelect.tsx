import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { MotionPresence, createMotionPortal as createPortal } from "./MotionPresence";
import { Icon } from "./Icon";

export interface GlassSelectOption {
  value: string;
  label: string;
  color?: string;
  group?: string;
}

interface GlassSelectBaseProps {
  options: GlassSelectOption[];
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
}
type GlassSelectProps = GlassSelectBaseProps & (
  | { multiple?: false; value: string; onChange: (value: string) => void }
  | { multiple: true; value: string[]; onChange: (value: string[]) => void; summaryLabel: string }
);

function optionId(baseId: string, index: number) {
  return `${baseId}-option-${index}`;
}

function flatIndex(options: GlassSelectOption[], value: string) {
  const index = options.findIndex((option) => option.value === value);
  return index >= 0 ? index : 0;
}

/**
 * A replacement for native popups, whose menu surface cannot share the app's
 * glass/accent system. The trigger remains a normal form control: labels,
 * disabled state, keyboard choice and screen-reader roles all stay intact.
 */
export function GlassSelect(props: GlassSelectProps) {
  const { value, options, className, disabled, ariaLabel } = props;
  const firstValue = typeof value === "string" ? value : value[0] ?? "";
  const selectedValues = new Set(typeof value === "string" ? [value] : value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => flatIndex(options, firstValue));
  const [position, setPosition] = useState({ left: 0, top: 0, width: 220, above: false });
  const [placed, setPlaced] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const baseId = useId();
  const selected = options.find((option) => selectedValues.has(option.value));

  const place = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const belowSpace = window.innerHeight - rect.bottom - 12;
    const above = belowSpace < 216 && rect.top > window.innerHeight * 0.55;
    const textWidth = Math.max(0, ...options.map(option => [...option.label]
      .reduce((width, char) => width + (char.charCodeAt(0) > 255 ? 11 : 6), 0)));
    const contentWidth = Math.ceil(textWidth + (props.multiple ? 62 : 50));
    const width = props.multiple
      ? Math.min(260, Math.max(contentWidth, 128), window.innerWidth - 16)
      : rect.width;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const top = above
      ? Math.max(8, rect.top - Math.min(272, rect.top - 8) - 6)
      : Math.min(window.innerHeight - 72, rect.bottom + 6);
    setPosition({ left, top, width, above });
    setPlaced(true);
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open]);

  useEffect(() => {
    if (!open) setPlaced(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || popupRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      triggerRef.current?.focus();
      setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    setActiveIndex(current => props.multiple ? Math.max(0, Math.min(current, options.length - 1)) : flatIndex(options, firstValue));
  }, [options, firstValue, props.multiple]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(optionId(baseId, activeIndex))?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, baseId, open]);

  function select(index: number) {
    const option = options[index];
    if (!option) return;
    if (props.multiple) {
      props.onChange(selectedValues.has(option.value) ? props.value.filter(value => value !== option.value) : [...props.value, option.value]);
    } else {
      props.onChange(option.value);
      setOpen(false);
    }
    triggerRef.current?.focus({ preventScroll: true });
  }

  function onTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!open && ["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      setActiveIndex(flatIndex(options, firstValue));
      setOpen(true);
      return;
    }
    if (!open) return;
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => {
        const delta = event.key === "ArrowDown" ? 1 : -1;
        return (current + delta + options.length) % options.length;
      });
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    }
    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(options.length - 1);
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select(activeIndex);
    }
  }

  let lastGroup: string | undefined;
  const menuItems = options.map((option, index) => {
    const isSelected = selectedValues.has(option.value);
    const heading = option.group && option.group !== lastGroup ? option.group : null;
    lastGroup = option.group;
    return (
      <div key={option.value}>
        {heading && <small className="glass-select-heading">{heading}</small>}
        <button
          type="button"
          id={optionId(baseId, index)}
          role="option"
          aria-selected={isSelected}
          className={[
            "glass-select-option",
            isSelected ? "is-selected" : "",
            index === activeIndex ? "is-active" : "",
          ].filter(Boolean).join(" ")}
          onPointerEnter={() => setActiveIndex(index)}
          onClick={() => select(index)}
        >
          {props.multiple && <span className={isSelected ? "glass-select-checkbox is-checked" : "glass-select-checkbox"} aria-hidden="true">
            {isSelected && <Icon name="check" size={10} />}
          </span>}
          <i className="glass-select-mark">
            {option.color ? <b style={{ background: option.color }} /> : isSelected ? <b /> : null}
          </i>
          <span>{option.label}</span>
        </button>
      </div>
    );
  });

  return (
    <div ref={rootRef} className={["glass-select", props.multiple ? "is-multiple" : "", open ? "is-open" : "", className ?? ""].filter(Boolean).join(" ")}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        className="glass-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${baseId}-listbox` : undefined}
        aria-activedescendant={open ? optionId(baseId, activeIndex) : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="glass-select-value">
          {!props.multiple && <i className="glass-select-mark">
            {selected?.color ? <b style={{ background: selected.color }} /> : null}
          </i>}
          {props.multiple ? props.summaryLabel : selected?.label ?? "\u00a0"}
          {props.multiple && <small className="glass-select-count">{props.value.length}/{options.length}</small>}
        </span>
        <Icon name="chevron-down" size={13} />
      </button>
      <MotionPresence>{open && createPortal(
        <div
          ref={popupRef}
          className={[position.above ? "glass-select-popup is-above" : "glass-select-popup", placed ? "" : "is-unplaced"].filter(Boolean).join(" ")}
          style={{
            "--popup-left": `${position.left}px`,
            "--popup-top": `${position.top}px`,
            "--popup-width": `${position.width}px`,
          } as CSSProperties}
        >
          <div className="glass-select-list" id={`${baseId}-listbox`} role="listbox" aria-multiselectable={props.multiple || undefined} aria-label={ariaLabel}>
            {menuItems}
          </div>
        </div>,
        document.body,
      )}</MotionPresence>
    </div>
  );
}
