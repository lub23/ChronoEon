import { useEffect, useRef, useState } from "react";
import { MotionPresence, createMotionPortal as createPortal } from "./MotionPresence";
import { PRESET_COLORS } from "@chronoeon/domain";
import type { Locale } from "../domain/entry";
import { t } from "../i18n";
import { GlassSelect, type GlassSelectOption } from "./GlassSelect";
import { Icon } from "./Icon";
import { registerModalDismiss } from "./modalLayer";

export interface EditableCategory {
  id: string;
  name: string;
  color: string;
  direction?: "income" | "expense";
  sub?: string[];
}

interface CategoryCatalogManagerProps {
  locale: Locale;
  label: string;
  mode: "calendar" | "bill";
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

function ColorMenu({ locale, category, onColor }: {
  locale: Locale;
  category: EditableCategory;
  onColor: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    const unregisterKey = registerModalDismiss(onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      unregisterKey();
    };
  }, [open]);

  const presetGroups = [
    { key: "light", colors: PRESET_COLORS.filter((color) => color.group === "light") },
    { key: "dark", colors: PRESET_COLORS.filter((color) => color.group === "dark") },
  ] as const;

  return (
    <div className="category-color-menu" ref={rootRef}>
      <button
        type="button"
        className={open ? "category-swatch is-open" : "category-swatch"}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${t("categoryColorCustom", locale)} · ${category.name}`}
      >
        <i style={{ background: category.color }} />
        <Icon name="chevron-down" size={11} />
      </button>
      {open && (
        <div className="category-color-sheet" role="dialog" aria-label={`${t("categoryColorCustom", locale)} · ${category.name}`}>
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
        </div>
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; target: string } | null>(null);
  const [reassignBusy, setReassignBusy] = useState(false);
  const editingRef = useRef<HTMLInputElement>(null);
  const editing = categories.find((category) => category.id === editingId) ?? null;

  useEffect(() => {
    if (!editing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setEditingId(null);
    };
    return registerModalDismiss(onKey);
  }, [editing]);

  useEffect(() => { if (editing) editingRef.current?.focus(); }, [editing?.id]);
  useEffect(() => { setPendingDelete(null); }, [editingId]);

  const patch = (id: string, change: (category: EditableCategory) => EditableCategory) => {
    onChange(categories.map((category) => category.id === id ? change(category) : category));
  };

  function add() {
    const id = `catalog-${crypto.randomUUID()}`;
    onChange([...categories, {
      id,
      name: uniqueName(categories, locale),
      color: PRESET_COLORS[9].hex,
      ...(mode === "bill" ? { direction: "expense" as const, sub: [] } : {})
    }]);
    setEditingId(id);
  }

  function addSub(id: string) {
    patch(id, (category) => ({ ...category, sub: [...(category.sub ?? []), t("categoryUntitled", locale)] }));
  }

  const deleteTargetOptions = pendingDelete
    ? reassignOptions.filter((option) => {
      const source = categories.find((category) => category.id === pendingDelete.id);
      if (!source) return true;
      if (mode === "bill") return option.value.split("/")[0] !== source.name;
      return option.value !== source.id;
    })
    : [];

  function requestDelete(id: string) {
    const count = entryCounts[id] ?? 0;
    const source = categories.find((category) => category.id === id);
    const targets = reassignOptions.filter((option) => {
      if (!source) return true;
      if (mode === "bill") return option.value.split("/")[0] !== source.name;
      return option.value !== source.id;
    });
    if (!count || !targets.length || !onReassignDelete) {
      onDelete(id);
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
      setEditingId(null);
    } finally {
      setReassignBusy(false);
    }
  }

  return (
    <section className="category-catalog" aria-label={label}>
      <ul className="category-catalog-list">
        {categories.map((category) => (
          <li key={category.id} className="category-row">
            <div className="category-main">
              <i className="category-overview-swatch" style={{ "--swatch": category.color, background: category.color } as React.CSSProperties} aria-hidden="true" />
              <div className="category-copy">
                <span className="category-name" title={category.name}>{category.name}</span>
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
                onClick={() => setEditingId(category.id)}
                aria-label={`${t("categoryEdit", locale)} · ${category.name}`}
                title={t("categoryEdit", locale)}
              >
                <Icon name="edit" size={13} />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button type="button" className="category-add" onClick={add}>
        <Icon name="plus" size={13} />{t("categoryAdd", locale)}
      </button>
      <MotionPresence>{editing && createPortal(
        <div className="category-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingId(null); }}>
          <section className="category-editor" role="dialog" aria-modal="true" aria-label={`${t("categoryEdit", locale)} · ${editing.name}`}>
            <header>
              <ColorMenu locale={locale} category={editing} onColor={(color) => patch(editing.id, (current) => ({ ...current, color }))} />
              <strong>{editing.name}</strong>
              <button type="button" className="icon-button" onClick={() => setEditingId(null)} aria-label={t("close", locale)}>
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
                onChange={(event) => patch(editing.id, (current) => ({ ...current, name: event.target.value }))}
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (!value) patch(editing.id, (current) => ({ ...current, name: t("categoryUntitled", locale) }));
                }}
                onKeyDown={(event) => { if (event.key === "Enter") setEditingId(null); }}
              />
            </label>

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
              {pendingDelete ? (
                <>
                  <button type="button" className="secondary-button" disabled={reassignBusy} onClick={() => setPendingDelete(null)}>{t("cancel", locale)}</button>
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
                  {onSetDefault && (
                    <button type="button" className="secondary-button" disabled={editing.id === defaultCategoryId} onClick={() => onSetDefault(editing.id)}>
                      <Icon name="check" size={14} />{t("setDefaultCategory", locale)}
                    </button>
                  )}
                  <button type="button" className="primary-action" onClick={() => setEditingId(null)}>{t("close", locale)}</button>
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
