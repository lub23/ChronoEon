import { useEffect, useRef, useState } from "react";
import { MotionPresence, createMotionPortal as createPortal } from "./MotionPresence";
import { PRESET_COLORS } from "@chronoeon/domain";
import type { Locale } from "../domain/entry";
import { t } from "../i18n";
import { GlassSelect, type GlassSelectOption } from "./GlassSelect";
import { itemIconChoices, resolveItemIcon } from "./ItemsView";
import { Icon } from "./Icon";
import { registerModalDismiss } from "./modalLayer";

export interface EditableCategory {
  id: string;
  name: string;
  color: string;
  icon?: string;
  builtin?: boolean;
  builtinKey?: string;
  builtinSubKeys?: string[];
  direction?: "income" | "expense";
  sub?: string[];
}

interface CategoryCatalogManagerProps {
  locale: Locale;
  label: string;
  mode: "calendar" | "bill" | "payment" | "item";
  categories: EditableCategory[];
  onChange: (categories: EditableCategory[]) => void;
  onDelete: (id: string) => void;
  /** Current entry count by catalog category id; used before destructive delete. */
  entryCounts?: Record<string, number>;
  defaultCategoryId?: string;
  defaultSubCategoryId?: string;
  reassignOptions?: GlassSelectOption[];
  reassignTarget?: string;
  onSetDefault?: (id: string) => void;
  onReassignDelete?: (id: string, target: string) => Promise<void>;
}

function uniqueName(categories: EditableCategory[], locale: Locale): string {
  const base = locale === "zh" ? "新分类" : "New category";
  let name = base;
  let index = 2;
  while (categories.some((category) => category.name === name)) name = `${base} ${index++}`;
  return name;
}

export function ColorMenu({ locale, category, onColor, mode }: {
  locale: Locale;
  category: EditableCategory;
  onColor: (color: string) => void;
  mode: "calendar" | "bill" | "payment" | "item";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 238;
      const height = 270;
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
      const top = rect.bottom + height <= window.innerHeight - 8
        ? rect.bottom + 6
        : Math.max(8, rect.top - height - 6);
      setPosition({ left, top });
    };
    place();
    const close = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node) || sheetRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const unregisterKey = registerModalDismiss(onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      unregisterKey();
    };
  }, [open]);

  const usesColor = mode === "calendar" || mode === "bill" || mode === "item";
  const presetGroups = [
    { key: "light", colors: PRESET_COLORS.filter((color) => color.group === "light") },
    { key: "dark", colors: PRESET_COLORS.filter((color) => color.group === "dark") },
  ] as const;

  return (
    <div className="category-color-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={!usesColor ? "category-swatch is-static" : open ? "category-swatch is-open" : "category-swatch"}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${t("categoryColorCustom", locale)} · ${category.name}`}
      >
        <i style={{ background: category.color }} />
        <Icon name="chevron-down" size={11} />
      </button>
      {mode === "payment" && <div className="category-neutral-mark" aria-hidden="true"><Icon name="coins" size={13} /></div>}
      {usesColor && open && createPortal(
        <div ref={sheetRef} className="category-color-sheet" role="dialog" aria-label={`${t("categoryColorCustom", locale)} · ${category.name}`} style={{ left: position.left, top: position.top }}>
          {presetGroups.map((group) => (
            <div key={group.key} className="category-color-group" role="radiogroup" aria-label={t(group.key === "light" ? "categoryColorLight" : "categoryColorDark", locale)}>
              <small>{t(group.key === "light" ? "categoryColorLight" : "categoryColorDark", locale)}</small>
              <div>
                {group.colors.map((preset) => {
                  const name = locale === "zh" ? preset.nameZh : preset.nameEn;
                  const selected = category.color.toLowerCase() === preset.hex.toLowerCase();
                  return (
                    <button
                      key={preset.hex}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={selected ? "preset-color is-active" : "preset-color"}
                      style={{ background: preset.hex }}
                      onClick={() => { onColor(preset.hex); setOpen(false); }}
                      aria-label={`${name} ${preset.hex}`}
                      title={`${name} ${preset.hex}`}
                    />
                  );
                })}
              </div>
            </div>
          ))}
          <label className="category-custom-color">
            <span>{t("categoryColorCustom", locale)}</span>
            <input
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(category.color) ? category.color : "#77787b"}
              onChange={(event) => onColor(event.target.value)}
              aria-label={`${t("categoryColorCustom", locale)} · ${category.name}`}
            />
          </label>
        </div>,
        document.body,
      )}
    </div>
  );
}

export function CategoryCatalogManager({
  locale,
  label,
  mode,
  categories,
  onChange,
  onDelete,
  entryCounts = {},
  defaultCategoryId,
  defaultSubCategoryId,
  reassignOptions = [],
  reassignTarget = "",
  onSetDefault,
  onReassignDelete,
}: CategoryCatalogManagerProps) {
  const [draft, setDraft] = useState<EditableCategory | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; target: string } | null>(null);
  const [reassignBusy, setReassignBusy] = useState(false);
  const editingRef = useRef<HTMLInputElement>(null);
  const editing = draft;
  const isCreating = Boolean(draft && !categories.some(category => category.id === draft.id));

  useEffect(() => {
    if (!editing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setDraft(null);
    };
    return registerModalDismiss(onKey);
  }, [editing]);

  useEffect(() => { if (editing) editingRef.current?.focus(); }, [editing?.id]);
  useEffect(() => { setPendingDelete(null); }, [draft?.id]);

  const patch = (id: string, change: (category: EditableCategory) => EditableCategory) => {
    setDraft((current) => current?.id === id ? change(current) : current);
  };

  function add() {
    const id = `catalog-${crypto.randomUUID()}`;
    setDraft({
      id,
      name: uniqueName(categories, locale),
      color: PRESET_COLORS[9].hex,
      ...(mode === "bill" ? { direction: "expense" as const, sub: [] } : {})
    });
  }

  function confirmEdit() {
    if (!draft) return;
    onChange(categories.some(category => category.id === draft.id)
      ? categories.map(category => category.id === draft.id ? draft : category)
      : [...categories, draft]);
    setDraft(null);
  }

  function closeEditor() {
    setDraft(null);
  }

  function addSub(id: string) {
    patch(id, (category) => ({ ...category, sub: [...(category.sub ?? []), t("categoryUntitled", locale)] }));
  }

  const deleteTargetOptions = pendingDelete
    ? reassignOptions.filter((option) => {
      const source = categories.find((category) => category.id === pendingDelete.id);
      if (!source) return true;
      if (mode === "bill") return option.value.split("/")[0] !== source.id;
      return option.value !== source.id;
    })
    : [];

  function requestDelete(id: string) {
    const count = entryCounts[id] ?? 0;
    const source = categories.find((category) => category.id === id);
    const targets = reassignOptions.filter((option) => {
      if (!source) return true;
      if (mode === "bill") return option.value.split("/")[0] !== source.id;
      return option.value !== source.id;
    });
    if (!count || !targets.length || !onReassignDelete) {
      onDelete(id);
      setDraft(null);
      return;
    }
    setPendingDelete({ id, target: reassignTarget || targets[0]?.value || "" });
  }

  async function confirmReassignDelete() {
    if (!pendingDelete || !onReassignDelete) return;
    setReassignBusy(true);
    try {
      await onReassignDelete(pendingDelete.id, pendingDelete.target);
      onDelete(pendingDelete.id);
      setPendingDelete(null);
      setDraft(null);
    } finally {
      setReassignBusy(false);
    }
  }

  return (
    <section className="category-catalog" aria-label={label}>
      <header className="category-catalog-header">
        <h5>{label}</h5>
        <button type="button" className="category-add" onClick={add}>
          <Icon name="plus" size={13} />{t("categoryAdd", locale)}
        </button>
      </header>
      <ul className="category-catalog-list">
        {categories.map((category) => (
          <li key={category.id} className={`category-row is-${mode}${category.id === defaultCategoryId ? " is-default" : ""}`}>
            <div className="category-main">
              <i className="category-overview-swatch" style={{ "--swatch": category.color, background: category.color } as React.CSSProperties} aria-hidden="true" />
              <div className="category-copy">
                <span className="category-name" title={category.name}>{mode === "item" && <Icon name={resolveItemIcon(category.icon)} size={15} />} {category.name}</span>
                {category.id === defaultCategoryId && (
                  <small className="category-default-badge">{t("defaultCategoryBadge", locale)}</small>
                )}


            {mode === "bill" && (
                  <small className="category-sub-summary">
                    {(category.sub ?? []).filter(Boolean).join(" · ") || t("categoryNoSubcategories", locale)}
                  </small>
                )}
              </div>
              <button
                type="button"
                className="category-edit-button"
                onClick={() => setDraft(structuredClone(category))}
                aria-label={`${t("categoryEdit", locale)} · ${category.name}`}
                title={t("categoryEdit", locale)}
              >
                <Icon name="edit" size={13} />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <MotionPresence>{editing && createPortal(
        <div className="category-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}>
          <section className="category-editor" role="dialog" aria-modal="true" aria-label={`${t("categoryEdit", locale)} · ${editing.name}`}>
            <header>
              {(mode === "calendar" || mode === "bill" || mode === "item") && <ColorMenu locale={locale} category={editing} mode={mode} onColor={(color) => patch(editing.id, (current) => ({ ...current, color }))} />}
              <strong>{editing.name}</strong>
              <button type="button" className="icon-button" onClick={closeEditor} aria-label={t("close", locale)}>
                <Icon name="close" size={15} />
              </button>
            </header>

            <label className="field-label">
              <span>{t("category", locale)}</span>
              <input
                ref={editingRef}
                className="category-name-input"
                value={editing.name}
                aria-label={`${t("categoryEdit", locale)} · ${editing.name}`}
                onChange={(event) => patch(editing.id, (current) => ({ ...current, name: event.target.value, builtin: false }))}
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (!value) patch(editing.id, (current) => ({ ...current, name: t("categoryUntitled", locale) }));
                }}
                onKeyDown={(event) => { if (event.key === "Enter") confirmEdit(); }}
              />
            </label>

            {mode === "item" && <label className="field-label">
              <span>{locale === "zh" ? "图标" : "Icon"}</span>
              <GlassSelect value={editing.icon ?? "other"} ariaLabel={locale === "zh" ? "图标" : "Icon"}
                options={itemIconChoices.map(option => ({ value: option.value, label: option[locale], mark: <Icon name={option.icon} size={16} /> }))}
                onChange={icon => patch(editing.id, current => ({ ...current, icon }))} />
            </label>}

            {mode === "bill" && (
              <label className="field-label category-direction">
                <span>{t("billDirection", locale)}</span>
                <div className="segmented-control" role="group" aria-label={t("billDirection", locale)}>
                  {(["expense", "income"] as const).map((direction) => (
                    <button
                      key={direction}
                      type="button"
                      className={editing.direction === direction ? "is-active" : ""}
                      aria-pressed={editing.direction === direction}
                      onClick={() => patch(editing.id, (current) => ({ ...current, direction }))}
                    >
                      {t(direction === "income" ? "billIncome" : "statsExpense", locale)}
                    </button>
                  ))}
                </div>
              </label>
            )}

            {mode === "bill" && (
              <div className="category-sub-editor">
                <p>{t("categorySubcategories", locale)}</p>
                {(editing.sub ?? []).map((name, index) => (
                  <div className="category-sub-row" key={`${editing.id}-${index}`}>
                    <i style={{ background: editing.color }} aria-hidden="true" />
                    <input
                      value={name}
                      aria-label={`${t("categorySubcategories", locale)} · ${editing.name} ${index + 1}`}
                      onChange={(event) => patch(editing.id, (current) => ({
                        ...current,
                        builtin: false,
                        sub: (current.sub ?? []).map((value, subIndex) => subIndex === index ? event.target.value : value),
                      }))}
                    />
                    <button
                      type="button"
                      className="icon-button subtle is-danger"
                      aria-label={`${t("categoryDelete", locale)} · ${name}`}
                      onClick={() => patch(editing.id, (current) => ({
                        ...current,
                        sub: (current.sub ?? []).filter((_, subIndex) => subIndex !== index),
                      }))}
                    >
                      <Icon name="close" size={11} />
                    </button>
                  </div>
                ))}
                <button type="button" className="category-add-sub" onClick={() => addSub(editing.id)}>
                  <Icon name="plus" size={11} />{t("categoryAddSub", locale)}
                </button>
              </div>
            )}

            {pendingDelete && (
              <div className="category-reassign">
                <p>
                  {t("categoryDeleteUsed", locale).replace(
                    "{count}",
                    String(entryCounts[pendingDelete.id] ?? 0),
                  )}
                </p>
                <GlassSelect
                  value={pendingDelete.target}
                  ariaLabel={t("categoryReassignTarget", locale)}
                  options={deleteTargetOptions}
                  onChange={(value) => setPendingDelete({ ...pendingDelete, target: value })}
                />
              </div>
            )}

            <footer>
              {isCreating ? (
                <>
                  <button type="button" className="primary-action" onClick={confirmEdit}><Icon name="check" size={14} />{t("confirmAction", locale)}</button>
                </>
              ) : pendingDelete ? (
                <>
                  <button type="button" className="danger-button" disabled={reassignBusy} onClick={() => void confirmReassignDelete()}>
                    {reassignBusy ? t("saving", locale) : t("categoryDeleteAndReassign", locale)}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="danger-button"
                    disabled={editing.id === defaultCategoryId}
                    title={editing.id === defaultCategoryId ? t("cannotDeleteDefaultCategory", locale) : undefined}
                    onClick={() => requestDelete(editing.id)}
                  >
                    <Icon name="trash" size={14} />{t("categoryDelete", locale)}
                  </button>
                  {onSetDefault && editing.id !== defaultCategoryId && (
                    <button type="button" className="secondary-button" onClick={() => onSetDefault(editing.id)}>
                      <Icon name="check" size={14} />{t("setDefaultCategory", locale)}
                    </button>
                  )}
                  <button type="button" className="primary-action" onClick={confirmEdit}><Icon name="check" size={14} />{t("confirmAction", locale)}</button>
                </>
              )}
            </footer>
          </section>
        </div>,
        document.body,
      )}</MotionPresence>
    </section>
  );
}
