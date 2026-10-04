import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ALL_DAY_REMINDERS,
  BUILTIN_CURRENCIES,
  DEFAULT_CHRONOEON_SETTINGS,
  TIMED_REMINDERS,
  categoryOptionsForKind,
  defaultCategoryForKind,
  defaultItemCategoryForCalendar,
  defaultPaymentMethodForCalendar,
  itemCategoriesForCalendar,
  paymentMethodsForCalendar,
  type ChronoEonSettings,
  type Entry,
  type EntryCategoryOption,
  type EntryDraft,
  type EntryKind,
  type EntryPriority,
  type EntryStatus,
  type Locale,
  type Recurrence,
  type Reminder,
  addIsoDays,
  parseClockMinutes,
  formatClockMinutes,
  ITEM_CATEGORIES,
  validateItemDraft,
  type ItemDraft,
} from "../domain/entry";
import { CaptureDecisionIndex, inferCategory, inferLocationCandidates, type CaptureHistoryItem } from "@chronoeon/domain";
import { entryToDraft, type EntryEditContext, type RecurrenceEditScope } from "../domain/entryWorkflow";
import type { ConfirmRequest } from "./ConfirmDialog";
import { catalogLabel, categoryLabel, compositeCategoryLabel, paymentMethodLabel, t, type MessageKey } from "../i18n";
import { AttachmentField } from "./AttachmentField";
import { GlassDatePicker, GlassTimePicker } from "./GlassDateTimePicker";
import { GlassSelect, type GlassSelectOption } from "./GlassSelect";
import { Icon } from "./Icon";
import { TagInput } from "./TagInput";
import { TaskStatusMenu } from "./TaskSummaryList";
import { EntryGlyph, TaskStatusGlyph } from "./ItemGlyph";
import { registerModalDismiss } from "./modalLayer";
import { FieldSuggestions, locationFieldCandidates } from "./FieldSuggestions";
import { readCurrentPlace } from "../platform/location";
import { labeledOptions, priorities, recurrenceOptions, reminderLabels, reminderTriggerLabel, weekdayIndexForDate } from "./entryFieldLabels";
import type { Item } from "@chronoeon/domain";
import { ItemFields, ItemPhotoField } from "./ItemFields";
import { acquisitionLabels, itemCategoryIconName } from "./ItemsView";
import { RecurrenceWeekdays } from "./RecurrenceWeekdays";

interface EntryComposerProps {
  locale: Locale;
  selectedDate: string;
  entries?: Entry[];
  editing: Entry | null;
  /** Canonical series source when `editing` is a projected occurrence. */
  sourceEntry?: Entry | null;
  settings?: ChronoEonSettings;
  availableTags?: string[];
  onClose: () => void;
  onSave: (draft: EntryDraft, editingId?: string, context?: EntryEditContext) => Entry | void | Promise<Entry | void>;
  onDelete: (id: string) => void | Promise<void>;
  onNotice?: (message: string, tone?: "normal" | "warning") => void;
  onConfirm?: (request: ConfirmRequest) => Promise<boolean>;
  initialDraft?: Partial<EntryDraft>;
  /** Local entries are the only category-learning corpus; never sent anywhere. */
  history?: readonly CaptureHistoryItem[];
  items?: Item[];
  pendingItemLink?: Item | null;
  editingItem?: Item | null;
  initialItemDraft?: Partial<ItemDraft> | null;
  onOpenBill?: (entry: Entry) => void;
  onEditItem?: (item: Item) => void;
  onCreateItemFromBill?: (entry: Entry, category: Item["category"]) => void | Promise<void>;
  onSaveItem?: (draft: ItemDraft, id?: string) => Promise<void>;
  onDeleteItem?: (id: string) => void | Promise<void>;
}

function normalizeScheduleTimes(draft: EntryDraft, timeScale: ChronoEonSettings["timeScale"]): EntryDraft {
  if (draft.allDay || (draft.kind !== "task" && draft.kind !== "event")) return draft;
  const start = parseClockMinutes(draft.start);
  if (start === null) return draft;

  let next = { ...draft };
  if (next.endDate && next.endDate < next.date) next.endDate = next.date;
  const end = parseClockMinutes(next.end);
  // An earlier clock time is valid when the end date is after the start date;
  // within one civil day it means the user picked a reversed range.
  const crossesCivilDay = Boolean(next.endDate && next.endDate > next.date);
  if (!crossesCivilDay && (end === null || end <= start)) {
    const absoluteEnd = start + timeScale;
    if (absoluteEnd >= 24 * 60) {
      next.end = formatClockMinutes(absoluteEnd - 24 * 60);
      next.endDate = addIsoDays(next.date, 1);
    } else {
      next.end = formatClockMinutes(absoluteEnd);
      next.endDate = next.endDate ?? next.date;
    }
  }
  return next;
}

function initialDraft(selectedDate: string, editing: Entry | null, settings: ChronoEonSettings, seed?: Partial<EntryDraft>): EntryDraft {
  if (editing) return entryToDraft(editing);
  const now = new Date();
  const currentClock = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const calendar = seed?.calendar ?? settings.defaultCalendarID;
  const draft: EntryDraft = {
    kind: "event",
    title: "",
    date: selectedDate,
    start: seed?.start ?? (seed?.kind === "idea" ? currentClock : "09:00"),
    end: "",
    allDay: false,
    calendar,
    category: defaultCategoryForKind("event", settings, calendar),
    currency: settings.bill.currency,
    payment: defaultPaymentMethodForCalendar(settings, calendar),
    recurrence: "none",
    reminder: defaultReminder(seed?.kind ?? "event", seed?.allDay),
    ...seed,
  };
  return normalizeScheduleTimes(draft, settings.timeScale);
}

const kinds: EntryKind[] = ["task", "event", "idea", "bill"];
const composerKinds = [...kinds, "item"] as const;

function defaultItemDraft(date: string, settings: ChronoEonSettings, calendarId = settings.defaultCalendarID): ItemDraft {
  return {
    name: "", calendarId, category: defaultItemCategoryForCalendar(settings, calendarId), acquisition: "purchase",
    acquiredOn: date, acquiredAt: "12:00", cost: 0, currency: settings.bill.currency,
    payment: defaultPaymentMethodForCalendar(settings, calendarId), images: [],
  };
}

function normalizeItemDraftClock(draft: Partial<ItemDraft> & Pick<ItemDraft, "name" | "calendarId" | "category" | "acquisition" | "acquiredOn" | "cost" | "currency">): ItemDraft {
  return { ...draft, acquiredAt: draft.acquiredAt?.match(/(\d{2}:\d{2})$/)?.[1] ?? "12:00" };
}

function defaultReminder(kind: EntryKind, allDay?: boolean): Reminder {
  if (kind !== "task") return "none";
  return allDay ? "day-before-5pm" : "30min";
}

const statusKeys: Record<EntryStatus, MessageKey> = {
  open: "statusOpen",
  "in-progress": "statusInProgress",
  done: "statusDone",
  cancelled: "statusCancelled",
};

function statusKeyFor(status: EntryStatus): MessageKey {
  return statusKeys[status];
}

function withCurrentOption(options: EntryCategoryOption[], category: string): EntryCategoryOption[] {
  if (!category || options.some((option) => option.value === category)) return options;
  return [{ value: category, label: category, color: "#8b8b83" }, ...options];
}

export function EntryComposer({
  locale,
  selectedDate,
  entries = [],
  editing,
  sourceEntry,
  settings = DEFAULT_CHRONOEON_SETTINGS,
  availableTags = [],
  onClose,
  onSave,
  onDelete,
  onNotice,
  onConfirm,
  initialDraft: seed,
  history = [],
  items = [],
  pendingItemLink = null,
  onEditItem,
  onOpenBill,
  onCreateItemFromBill,
  editingItem = null,
  initialItemDraft = null,
  onSaveItem,
  onDeleteItem,
}: EntryComposerProps) {
  const occurrence = Boolean(editing?.recurrenceSourceId && editing.occurrenceDate);
  const source = sourceEntry ?? editing;
  const initialScope: RecurrenceEditScope = occurrence ? "occurrence" : "series";
  const [scope, setScope] = useState<RecurrenceEditScope>(initialScope);
  const [draft, setDraft] = useState<EntryDraft>(() => initialDraft(selectedDate, occurrence ? editing : source, settings, seed));
  const [activeKind, setActiveKind] = useState<(typeof composerKinds)[number]>(
    editingItem || initialItemDraft ? "item" : seed?.kind ?? draft.kind,
  );
  const [itemDraft, setItemDraft] = useState<ItemDraft | null>(() => editingItem
    ? normalizeItemDraftClock({ ...defaultItemDraft(selectedDate, settings), ...editingItem })
    : initialItemDraft ? normalizeItemDraftClock({ ...defaultItemDraft(selectedDate, settings), ...initialItemDraft }) : null);
  const [billItemCategory, setBillItemCategory] = useState("");
  const linkedBillItem = pendingItemLink ?? (editing?.kind === "bill" ? items.find(item => item.purchaseEntryId === editing.id || item.saleEntryId === editing.id) : undefined);
  // Category direction owns the sign, so the composer only edits a magnitude.
  const [amountText, setAmountText] = useState(() => (
    draft.amount == null ? "" : String(Math.abs(draft.amount))
  ));
  const amountTextRef = useRef(draft.amount);
  useEffect(() => {
    if (draft.amount === amountTextRef.current) return;
    amountTextRef.current = draft.amount;
    setAmountText(draft.amount == null ? "" : String(Math.abs(draft.amount)));
  }, [draft.amount]);
  const [error, setError] = useState<MessageKey | null>(null);
  // A single in-flight write: `draftToEntry` mints a fresh id per call, so a
  // second submit before the first lands would create a duplicate row.
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false); // ref so the guard holds even inside one render tick
  const [itemBusy, setItemBusy] = useState(false);
  const itemBusyRef = useRef(false);
  const [locating, setLocating] = useState(false);
  const locationInput = useRef<HTMLInputElement | null>(null);
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  // A selected value wins over every later title-derived suggestion.
  const categoryTouchedRef = useRef(false);
  // A cleared or typed location is explicit, even when the field is empty.
  const locationTouchedRef = useRef(false);
  const itemTouchedRef = useRef(new Set<keyof ItemDraft>());
  const itemPristineRef = useRef(JSON.stringify(itemDraft));
  const localHistory = useMemo(() => history.filter(entry => !entry.calendar || entry.calendar === draft.calendar), [history, draft.calendar]);
  const itemHistory = useMemo(() => items.filter(item => item.calendarId === itemDraft?.calendarId && item.id !== editingItem?.id).map(item => ({
    id: item.id, kind: "event" as const, title: item.name, category: item.category, location: item.location, date: item.acquiredOn,
  })), [items, itemDraft?.calendarId, editingItem?.id]);
  const itemSuggestions = useMemo(() => itemDraft && settings.locationAutofill
    ? inferLocationCandidates(itemDraft.name, [...itemHistory, ...history.filter(entry => !entry.calendar || entry.calendar === itemDraft.calendarId)], itemDraft.acquiredOn)
    : [], [itemDraft?.name, itemDraft?.calendarId, itemDraft?.acquiredOn, itemHistory, history, settings.locationAutofill]);
  const itemLocationSuggestions = useMemo(() => itemDraft && settings.locationAutofill
    ? locationFieldCandidates(itemDraft.name, itemDraft.location, [...itemHistory, ...history.filter(entry => !entry.calendar || entry.calendar === itemDraft.calendarId)], itemDraft.acquiredOn)
    : [], [itemDraft?.name, itemDraft?.location, itemDraft?.calendarId, itemDraft?.acquiredOn, itemHistory, history, settings.locationAutofill]);
  useEffect(() => {
    if (!itemDraft || editingItem) return;
    const availableCategories = new Set(itemCategoriesForCalendar(settings, itemDraft.calendarId).map(item => item.id));
    const category = new CaptureDecisionIndex(itemHistory).decide(itemDraft.name, { kind: "event", availableCategories }).category.selected
      ?? defaultItemCategoryForCalendar(settings, itemDraft.calendarId);
    const location = itemSuggestions[0]?.value;
    setItemDraft(current => {
      if (!current) return current;
      const nextCategory = itemTouchedRef.current.has("category") ? current.category : category;
      const nextLocation = itemTouchedRef.current.has("location") || !settings.locationAutofill ? current.location : location;
      return current.category === nextCategory && current.location === nextLocation ? current : { ...current, category: nextCategory, location: nextLocation };
    });
  }, [itemDraft?.name, itemDraft?.calendarId, itemHistory, itemSuggestions, editingItem, settings]);
  const [statusMenu, setStatusMenu] = useState<{ left: number; top: number } | null>(null);
  const locationSuggestions = useMemo(
    () => settings.locationAutofill && draft.title.trim() && activeKind !== "item"
      ? locationFieldCandidates(draft.title, draft.location, localHistory, draft.date)
      : [],
    [activeKind, draft.date, draft.location, draft.title, localHistory, settings.locationAutofill],
  );
  // The draft at open time is the discard baseline: Esc (or the close button)
  // with unsaved changes asks before losing them.
  const pristineRef = useRef<string>(JSON.stringify(initialDraft(selectedDate, occurrence ? editing : source, settings, seed)));
  const dirty = activeKind === "item" ? JSON.stringify(itemDraft) !== itemPristineRef.current : JSON.stringify(draft) !== pristineRef.current;

  const requestClose = useCallback(() => {
    if (!dirty) {
      onClose();
      return;
    }
    if (!onConfirm) {
      onClose();
      return;
    }
    void onConfirm({
      title: t("discardTitle", locale),
      detail: t("discardDetail", locale),
      confirmLabel: t("discardConfirm", locale),
      tone: "danger",
    }).then((accepted) => { if (accepted) onClose(); });
  }, [dirty, locale, onClose, onConfirm]);

  // Escape is owned on the shared modal bus (newest modal wins). The composer
  // registers once on mount; a confirm it opens registers later, so one Escape
  // press closes exactly one layer — the old window-wide Escape in App used to
  // close this dirty sheet at the same instant the discard confirm opened,
  // losing the user's edits and leaving the confirm's promise unsettled.
  // The handler reads through a ref so it always runs the latest discard guard
  // without re-registering on every keystroke.
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;
  useEffect(() => registerModalDismiss((event) => {
    event.preventDefault();
    requestCloseRef.current();
  }), []);

  useEffect(() => {
    const nextScope: RecurrenceEditScope = occurrence ? "occurrence" : "series";
    setScope(nextScope);
    setDraft(initialDraft(selectedDate, nextScope === "occurrence" ? editing : source, settings, seed));
    pristineRef.current = JSON.stringify(initialDraft(selectedDate, nextScope === "occurrence" ? editing : source, settings, seed));
    // A saved category is already an explicit user choice; never auto-replace it.
    categoryTouchedRef.current = Boolean(source || seed?.category);
    locationTouchedRef.current = Boolean(source || seed?.location);
    setBillItemCategory("");
    setError(null);
  }, [selectedDate, editing, source, settings, occurrence, seed]);

  useEffect(() => {
    itemTouchedRef.current = new Set(Object.keys(editingItem ?? initialItemDraft ?? {}) as Array<keyof ItemDraft>);
    itemPristineRef.current = JSON.stringify(editingItem || initialItemDraft ? normalizeItemDraftClock({ ...defaultItemDraft(selectedDate, settings), ...(editingItem ?? initialItemDraft) }) : null);
    if (editingItem) setItemDraft(normalizeItemDraftClock({ ...defaultItemDraft(selectedDate, settings), ...editingItem }));
    else if (initialItemDraft) setItemDraft(normalizeItemDraftClock({ ...defaultItemDraft(selectedDate, settings), ...initialItemDraft }));
    setActiveKind(editingItem || initialItemDraft ? "item" : seed?.kind ?? editing?.kind ?? "event");
  }, [selectedDate, editing, editingItem, initialItemDraft, seed, settings]);

  // Reuse the offline capture learner: recent exact/subtitle matches beat the
  // built-in keyword rules, while an explicit picker choice becomes final.
  useEffect(() => {
    if (categoryTouchedRef.current) return;
    const title = draft.title.trim();
    const suggestion = inferCategory(title, draft.title, draft.kind, settings, localHistory, new Date(), draft.amount, draft.calendar, "any");
    const category = suggestion.confidence > 0 ? suggestion.value : defaultCategoryForKind(draft.kind, settings, draft.calendar);
    if (category !== draft.category) setDraft((current) => ({ ...current, category }));
  }, [draft.title, draft.kind, draft.amount, draft.calendar, draft.category, localHistory, settings]);

  // Same local-learning idea as categories, but rank equal title matches by
  // calendar distance and stop as soon as the user owns the location field.
  useEffect(() => {
    if (!settings.locationAutofill || locationTouchedRef.current) return;
    const location = locationSuggestions[0]?.value;
    if (location !== draft.location) update("location", location);
  }, [draft.location, locationSuggestions, settings.locationAutofill]);

  const categoryOptions = useMemo(
    () => withCurrentOption(categoryOptionsForKind(draft.kind, settings, draft.calendar), draft.category),
    [draft.kind, draft.category, draft.calendar, settings],
  );
  const billGroups = useMemo(() => {
    const groups = new Map<string, EntryCategoryOption[]>();
    for (const option of categoryOptions) {
      const primary = option.value.split("/")[0];
      const group = option.group ? catalogLabel(primary, locale, option.group, settings) + (primary.startsWith("ledger-") ? ` · ${locale === "zh" ? "自定义" : "Custom"}` : "") : t("category", locale);
      groups.set(group, [...(groups.get(group) ?? []), option]);
    }
    return [...groups.entries()];
  }, [categoryOptions, locale, settings]);
  const occurrenceOnly = scope === "occurrence";
  const recurringSeries = Boolean(source?.recurrence && source.recurrence !== "none");

  // Showing when a reminder will actually fire removes the main uncertainty of
  // relative reminders ("15 minutes before *what*?").
  const reminderPreview = useMemo(
    () => reminderTriggerLabel(draft, locale),
    [draft, locale],
  );

  function update<K extends keyof EntryDraft>(key: K, value: EntryDraft[K]) {
    setDraft((current) => {
      let next = { ...current, [key]: value } as EntryDraft;
      if (key === "date" && current.endDate) {
        if (current.endDate === current.date) next.endDate = value as string;
        else if (typeof value === "string" && typeof current.date === "string") {
          const oldDate = new Date(`${current.date}T00:00:00Z`);
          const newDate = new Date(`${value}T00:00:00Z`);
          const delta = Math.round((newDate.getTime() - oldDate.getTime()) / 86400000);
          if (Number.isFinite(delta)) next.endDate = addIsoDays(current.endDate, delta);
        }
      }
      return normalizeScheduleTimes(next, settings.timeScale);
    });
    setError(null);
  }

  function updateTime(key: "start" | "end", value: string | undefined, committed = false) {
    setDraft((current) => {
      const next = { ...current, [key]: value } as EntryDraft;
      return committed ? normalizeScheduleTimes(next, settings.timeScale) : next;
    });
    setError(null);
  }

  function changeScope(next: RecurrenceEditScope) {
    setScope(next);
    setDraft(initialDraft(selectedDate, next === "occurrence" ? editing : source, settings, seed));
    setError(null);
  }

  /** Fill the location with a real system address, including street/POI when available. */
  async function locateDevice() {
    if (locating || occurrenceOnly) return;
    setLocating(true);
    try {
      const place = await readCurrentPlace(locale);
      if (!place) {
        onNotice?.(t("locationUnavailable", locale), "warning");
        return;
      }
      update("location", place.label);
    } finally {
      setLocating(false);
    }
  }

  function changeAllDay(allDay: boolean) {
    setDraft((current) => {
      // A reminder value only resolves in its own time mode; carrying the old
      // value across the toggle would store a reminder that never fires, so
      // reset it to "none" instead.
      const oldReminder = current.reminder ?? "none";
      const reminder = (allDay ? ALL_DAY_REMINDERS : TIMED_REMINDERS).includes(oldReminder)
        ? oldReminder
        : defaultReminder(current.kind, allDay);
      let next: EntryDraft = { ...current, allDay, reminder };
      if (!allDay && !next.start) {
        const now = new Date();
        next.start = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
        next.end = "";
      }
      if (allDay) {
        next.start = undefined;
        next.end = undefined;
      }
      return normalizeScheduleTimes(next, settings.timeScale);
    });
    setError(null);
  }

  function changeEntryKind(kind: EntryKind) {
    if (kind !== "bill") setBillItemCategory("");
    setDraft((current) => {
      const options = categoryOptionsForKind(kind, settings, current.calendar);
      const category = options.some((option) => option.value === current.category)
        ? current.category
        : defaultCategoryForKind(kind, settings, current.calendar);
      return {
        ...current,
        kind,
        status: kind === "task" ? (current.kind === "task" ? current.status ?? "open" : "open") : undefined,
        category,
        end: kind === "task" || kind === "event" ? current.end : "",
        endDate: kind === "task" || kind === "event" ? current.endDate : undefined,
        allDay: kind === "task" || kind === "event" ? current.allDay : false,
        amount: kind === "bill" ? current.amount : undefined,
        currency: kind === "bill" ? current.currency ?? settings.bill.currency : undefined,
        payment: kind === "bill" ? current.payment ?? defaultPaymentMethodForCalendar(settings, current.calendar) : undefined,
        recurrence: kind === "idea" ? "none" : current.recurrence,
        recurringDays: kind === "idea" ? undefined : current.recurringDays,
        recurringEnd: kind === "idea" ? undefined : current.recurringEnd,
        reminder: kind === "idea" ? "none" : current.reminder ?? defaultReminder(kind, current.allDay),
        priority: kind === "idea" ? undefined : current.priority,
        urgency: kind === "idea" ? undefined : current.urgency,
      };
    });
  }

  function changeKind(kind: (typeof composerKinds)[number], item?: Item) {
    if (kind === "item") {
      setBillItemCategory("");
      const next = item
        ? normalizeItemDraftClock({ ...defaultItemDraft(selectedDate, settings), ...item })
        : itemDraft ?? normalizeItemDraftClock({
          ...defaultItemDraft(draft.date, settings, draft.calendar),
          name: draft.title,
          acquiredOn: draft.date,
          acquiredAt: draft.start ?? "12:00",
          cost: draft.kind === "bill" ? Math.abs(draft.amount ?? 0) : 0,
          currency: draft.currency ?? settings.bill.currency,
          payment: draft.payment ?? defaultPaymentMethodForCalendar(settings, draft.calendar),
        });
      setItemDraft(next);
      setActiveKind("item");
      return;
    }
    setActiveKind(kind);
    changeEntryKind(kind);
  }

  function changeRecurrence(recurrence: Recurrence) {
    setDraft((current) => ({
      ...current,
      recurrence,
      recurringDays: recurrence === "weekly"
        ? (current.recurringDays?.length ? current.recurringDays : [weekdayIndexForDate(current.date)])
        : undefined,
      recurringEnd: recurrence === "none" ? undefined : current.recurringEnd,
    }));
    setError(null);
  }

  function toggleWeekday(day: number, checked: boolean) {
    setDraft((current) => {
      const days = new Set(current.recurringDays ?? []);
      if (checked) days.add(day); else days.delete(day);
      return { ...current, recurringDays: [...days].sort((left, right) => left - right) };
    });
    setError(null);
  }

  function patchItem(value: Partial<ItemDraft>) {
    for (const key of Object.keys(value) as Array<keyof ItemDraft>) itemTouchedRef.current.add(key);
    setItemDraft(current => ({ ...(current ?? defaultItemDraft(selectedDate, settings)), ...value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (activeKind === "item") {
      await submitItem();
      return;
    }
    if (submittingRef.current) return;
    const normalized = normalizeScheduleTimes(draft, settings.timeScale);
    if (normalized !== draft) setDraft(normalized);
    if (!normalized.title.trim()) return setError("required");
    if (normalized.endDate && normalized.endDate < normalized.date) return setError("invalidDateRange");
    if (normalized.recurringEnd && normalized.recurringEnd < normalized.date) return setError("invalidRecurrenceEnd");
    if (!occurrenceOnly && normalized.recurrence === "weekly" && !normalized.recurringDays?.length) return setError("selectWeekday");
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const saved = await onSave(
        normalized.kind === "task" || normalized.kind === "event"
          ? { ...normalized, title: normalized.title.trim() }
          : { ...normalized, title: normalized.title.trim(), end: "", endDate: undefined },
        source?.id,
        { scope, occurrenceDate: occurrenceOnly ? editing?.occurrenceDate : undefined },
      );
      if (normalized.kind === "bill" && saved && !linkedBillItem && billItemCategory && onCreateItemFromBill) {
        try {
          await onCreateItemFromBill(saved, billItemCategory);
        } catch {
          onNotice?.(t("itemSaveFailed", locale), "warning");
        }
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function submitItem() {
    if (!itemDraft || itemBusyRef.current || !onSaveItem) return;
    itemBusyRef.current = true;
    setItemBusy(true);
    setError(null);
    try {
      const normalized = { ...itemDraft, name: itemDraft.name.trim() };
      validateItemDraft(normalized);
      await onSaveItem(normalized, editingItem?.id);
    } catch {
      setError("itemSaveFailed" as MessageKey);
    } finally {
      itemBusyRef.current = false;
      setItemBusy(false);
    }
  }

  function remove() {
    if (!source) return;
    const request: ConfirmRequest = {
      title: t(recurringSeries ? "deleteSeriesConfirm" : "deleteConfirm", locale),
      detail: source.title,
      confirmLabel: t("delete", locale),
      tone: "danger",
    };
    if (!onConfirm) {
      void onDelete(source.id);
      return;
    }
    void onConfirm(request).then((accepted) => { if (accepted) void onDelete(source.id); });
  }

  return (
    <div
      className="composer-backdrop"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}
    >
      <section
        className="composer-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="composer-title"
      >
        <i className="composer-handle" aria-hidden="true" style={{ width: 37, height: 4 }} />
        <header className="composer-header">
          <div className={`composer-title-line${activeKind === "item" ? " composer-title-line--item" : ""}`}>
            <h2 id="composer-title">{activeKind === "item" ? (editingItem ? t("editTitle", locale) : t("createTitle", locale)) : editing ? t("editTitle", locale) : t("createTitle", locale)}</h2>
            <div className="composer-category-field composer-category-field--top">
              <GlassSelect
                value={activeKind === "item" ? itemDraft?.category ?? defaultItemCategoryForCalendar(settings, itemDraft?.calendarId ?? draft.calendar) : draft.category}
                ariaLabel={t("category", locale)}
                options={activeKind !== "item" && draft.kind === "bill"
                  ? billGroups.flatMap(([group, options]) => options.map((option) => ({
                    value: option.value,
                    label: option.group ? compositeCategoryLabel(option.value, locale, settings) : categoryLabel(option.value, locale, option.label, settings),
                    color: option.color,
                    group,
                  })))
                  : activeKind === "item"
                    ? itemCategoriesForCalendar(settings, itemDraft?.calendarId ?? draft.calendar).map(option => ({ value: option.id, label: option.name, mark: <Icon name={itemCategoryIconName(option.id, settings, itemDraft?.calendarId ?? draft.calendar)} size={15} /> }))
                    : categoryOptions.map((option) => ({ value: option.value, label: categoryLabel(option.value, locale, option.label, settings), color: option.color, group: option.group }))}
                onChange={(value) => {
                  if (activeKind === "item") patchItem({ category: value as Item["category"] });
                  else { categoryTouchedRef.current = true; update("category", value); }
                }}
              />
            </div>
            {activeKind === "item" && (
              <GlassSelect
                value={itemDraft?.acquisition ?? "purchase"}
                ariaLabel={t("itemAcquisition", locale)}
                options={Object.entries(acquisitionLabels).map(([value, label]) => ({ value, label: t(label, locale) }))}
                onChange={value => patchItem({ acquisition: value as ItemDraft["acquisition"], ...(value !== "purchase" ? { purchaseEntryId: undefined, cost: 0 } : {}) })}
              />
            )}
            {activeKind === "task" && draft.kind === "task" && (
              <button
                type="button"
                className="icon-button composer-status-toggle"
                disabled={occurrenceOnly}
                aria-haspopup="menu"
                aria-expanded={Boolean(statusMenu)}
                aria-label={t("statusLabel", locale)}
                title={t(statusKeyFor(draft.status ?? "open"), locale)}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setStatusMenu({ left: rect.left, top: rect.bottom + 4 });
                }}
              >
                <TaskStatusGlyph status={draft.status ?? "open"} size={16} />
              </button>
            )}
            {activeKind !== "item" && (draft.kind === "task" || draft.kind === "event") ? (
              <label className="all-day-toggle all-day-toggle--compact composer-header-toggle">
                <input type="checkbox" checked={Boolean(draft.allDay)} onChange={(event) => changeAllDay(event.target.checked)} />
                <i className="fake-checkbox" aria-hidden="true" />
                {/* Same 24h mark as the capture review, so the two forms read alike. */}
                <span aria-hidden="true">24h</span>
                <span className="visually-hidden">{t("allDay", locale)}</span>
              </label>
            ) : null}
            </div>
          <button className="icon-button" type="button" onClick={requestClose} aria-label={t("close", locale)}><Icon name="close" /></button>
        </header>

        <div className="composer-kind-bar">
          <div className="kind-switcher" role="tablist" aria-label={t("type", locale)}>
            {composerKinds.map((kind) => (
              <button key={kind} disabled={occurrenceOnly} type="button" role="tab" aria-selected={activeKind === kind} className={activeKind === kind ? `is-active kind-${kind}` : ""} onClick={() => changeKind(kind)}>
                {kind === "item" ? <Icon name="box" size={17} /> : <EntryGlyph kind={kind} size={17} />}{t(kind === "item" ? "items" : kind, locale)}
              </button>
            ))}
            </div>
          </div>

        <form className="composer-form" onSubmit={submit}>
          {occurrence && (
            <section className="recurrence-scope" aria-label={t("recurrenceOccurrence", locale)}>
              <div className="scope-switcher" role="group">
                <button type="button" className={scope === "occurrence" ? "is-active" : ""} onClick={() => changeScope("occurrence")}>{t("thisOccurrence", locale)}</button>
                <button type="button" className={scope === "series" ? "is-active" : ""} onClick={() => changeScope("series")}>{t("entireSeries", locale)}</button>
              </div>
              <p>{t(scope === "occurrence" ? "occurrenceEditHint" : "seriesEditHint", locale)}</p>
            </section>
          )}

          {activeKind === "item" && itemDraft && (
            <ItemFields
              draft={itemDraft}
              patch={patchItem}
              locationSuggestions={itemLocationSuggestions}
              items={items}
              entries={entries}
              locale={locale}
              settings={settings}
              today={todayKey}
              busy={itemBusy}
              editing={Boolean(editingItem)}
              itemId={editingItem?.id}
              onOpenBill={onOpenBill}
              showDate
              showPhotos={false}
              onError={message => setError(message as MessageKey)}
            />
          )}

          {activeKind !== "item" && (
          <div className="title-location-row">
            <label className={`field-label field-label--large field-label--title${error === "required" ? " has-error" : ""}`}>
              <span>{t("title", locale)} <em>*</em></span>
              <input disabled={occurrenceOnly} autoFocus={!occurrenceOnly} value={draft.title} onChange={(event) => update("title", event.target.value)} placeholder={t("titlePlaceholder", locale)} />
              {error === "required" && <small>{t("required", locale)}</small>}
            </label>
            {draft.kind !== "idea" ? (
              <label className="field-label location-field">
                <span>
                  {t("location", locale)}
                  <button
                    type="button"
                    className="icon-button location-locate"
                    onClick={() => void locateDevice()}
                    disabled={occurrenceOnly || locating}
                    aria-label={t("useDeviceLocation", locale)}
                    title={t("useDeviceLocation", locale)}
                  >
                    <Icon name="map-pin" size={14} />
                  </button>
                </span>
                <div className="location-input-wrap">
                  <input
                    disabled={occurrenceOnly}
                    ref={locationInput}
                    value={draft.location ?? ""}
                    onChange={(event) => { locationTouchedRef.current = true; update("location", event.target.value); }}
                    placeholder={t("locationPlaceholder", locale)}
                  />
                  {Boolean(draft.location) && (
                    <button
                      type="button"
                      className="icon-button location-clear"
                      disabled={occurrenceOnly}
                      onClick={() => { locationTouchedRef.current = true; update("location", undefined); }}
                      aria-label={t("clearLocation", locale)}
                      title={t("clearLocation", locale)}
                    >
                      <Icon name="close" size={11} />
                    </button>
                  )}
                  <FieldSuggestions inputRef={locationInput} locale={locale} suggestions={locationSuggestions}
                    onSelect={value => { locationTouchedRef.current = true; update("location", value); }} />
                </div>
              </label>
            ) : (
              <label className="field-label idea-title-tags">
                <span>{t("tags", locale)}</span>
                <TagInput value={draft.tags} available={availableTags} onChange={(tags) => update("tags", tags)} locale={locale} />
              </label>
            )}
          </div>
          )}

          {statusMenu && draft.kind === "task" && activeKind !== "item" && (
            <TaskStatusMenu
              state={{ status: draft.status ?? "open", left: statusMenu.left, top: statusMenu.top }}
              locale={locale}
              onClose={() => setStatusMenu(null)}
              onSelect={(status: EntryStatus) => {
                setStatusMenu(null);
                update("status", status);
              }}
            />
          )}

          {activeKind !== "item" && (
          <div className={draft.kind === "task" || draft.kind === "event" ? "when-groups" : "when-groups when-groups--single"}>
            <div className="when-group">
              <span>{t("time", locale)}</span>
              <div className="when-controls">
                <GlassDatePicker
                  value={draft.date}
                  ariaLabel={t(editing ? "moveToDate" : "date", locale)}
                  locale={locale}
                  disabled={occurrenceOnly}
                  clearable={false}
                  hideIcon
                  onChange={(value) => update("date", value ?? draft.date)}
                />
                {!draft.allDay && (
                  <GlassTimePicker
                    value={draft.start}
                    ariaLabel={t("start", locale)}
                    locale={locale}
                    disabled={occurrenceOnly}
                    clearable={false}
                    hideIcon
                    onChange={(value, committed) => updateTime("start", value, committed)}
                  />
                )}
              </div>
            </div>
            {(draft.kind === "task" || draft.kind === "event") && (
              <div className="when-group">
                <span>{t("end", locale)}</span>
                <div className="when-controls">
                  <GlassDatePicker
                    value={draft.endDate ?? draft.date}
                    min={draft.date}
                    ariaLabel={t("endDate", locale)}
                    locale={locale}
                    disabled={occurrenceOnly}
                    hideIcon
                    onChange={(value) => update("endDate", value)}
                  />
                  {!draft.allDay && (
                    <GlassTimePicker
                      value={draft.end}
                      ariaLabel={t("end", locale)}
                      locale={locale}
                      disabled={occurrenceOnly}
                      hideIcon
                      onChange={(value, committed) => updateTime("end", value, committed)}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
          )}

          {activeKind !== "item" && error && error !== "required" && <p className="form-error" role="alert">{t(error, locale)}</p>}

          {!occurrenceOnly && activeKind !== "item" && (
            <>
              {draft.kind === "bill" && activeKind === "bill" && <div className="bill-primary-row">
                <label className="field-label"><span>{t("amount", locale)}</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={amountText}
                    onChange={(event) => {
                      const raw = event.target.value;
                      const parsed = raw.trim() === "" ? undefined : Number(raw);
                      const value = parsed !== undefined && Number.isFinite(parsed) ? Math.abs(parsed) : undefined;
                      setAmountText(value == null ? raw : String(value));
                      amountTextRef.current = value;
                      update("amount", value);
                    }}
                    placeholder="0.00"
                  />
                </label>
                <label className="field-label"><span>{t("currency", locale)}</span>
                  <GlassSelect
                    value={draft.currency ?? settings.bill.currency}
                    ariaLabel={t("currency", locale)}
                    options={[
                      ...Object.entries(BUILTIN_CURRENCIES).map(([code, currency]) => ({ value: code, label: locale === "zh" ? currency.name : code })),
                      ...Object.keys(settings.bill.customCurrencies).filter((code) => !BUILTIN_CURRENCIES[code]).map((code) => ({ value: code, label: locale === "zh" ? code : code })),
                    ]}
                    onChange={(value) => update("currency", value)}
                  />
                </label>
                <label className="field-label"><span>{t("payment", locale)}</span>
                  <GlassSelect
                    value={draft.payment ?? ""}
                    ariaLabel={t("payment", locale)}
                    options={[
                      { value: "", label: t("paymentNone", locale) },
                      ...paymentMethodsForCalendar(settings, draft.calendar).map((method) => ({ value: method.id, label: paymentMethodLabel(method.name, locale) })),
                    ]}
                    onChange={(value) => update("payment", value || undefined)}
                  />
                </label>
              </div>}

              {draft.kind !== "idea" && (
                <section className="recurrence-fields">
                  {/* Repeat, reminder, importance and urgency share one line. */}
                  <div className="field-row--inline">
                    <label className="field-label"><span>{t("recurrence", locale)}</span>
                      <GlassSelect
                        value={draft.recurrence ?? "none"}
                        ariaLabel={t("recurrence", locale)}
                        options={labeledOptions(recurrenceOptions, locale)}
                        onChange={(value) => changeRecurrence(value as Recurrence)}
                      />
                    </label>
                    {/* The trigger time rides beside the reminder's own title. */}
                    <label className="field-label is-wide"><span>{t("reminder", locale)}{reminderPreview && <em className="field-hint field-hint--quiet"><Icon name="bell" size={12} /> {reminderPreview}</em>}</span>
                      <GlassSelect
                        value={draft.reminder ?? "none"}
                        ariaLabel={t("reminder", locale)}
                        options={(draft.allDay ? ALL_DAY_REMINDERS : TIMED_REMINDERS).map((value) => ({ value, label: t(reminderLabels[value], locale) }))}
                        onChange={(value) => update("reminder", value as Reminder)}
                      />
                    </label>
                  </div>
                  {/* A narrow repeat-until date beside the weekday strip. */}
                  {draft.recurrence !== "none" && (
                    <div className="recurrence-detail-row">
                      <label className="field-label">
                        <span>{t("repeatUntil", locale)}</span>
                        <GlassDatePicker
                          value={draft.recurringEnd}
                          min={draft.date}
                          ariaLabel={t("repeatUntil", locale)}
                          locale={locale}
                          placeholder={t("repeatNone", locale)}
                          hideIcon
                          onChange={(value) => update("recurringEnd", value)}
                        />
                      </label>
                      {draft.recurrence === "weekly" && <RecurrenceWeekdays locale={locale} value={draft.recurringDays} onToggle={toggleWeekday} />}
                    </div>
                  )}
                </section>
              )}

              {/* A three-line note beside the single-line tags. */}
              <div className={draft.kind === "idea" ? "composer-pair composer-pair--note-only" : "composer-pair"}>
                <label className="field-label"><span>{t("note", locale)}</span><textarea rows={4} value={draft.note ?? ""} onChange={(event) => update("note", event.target.value)} placeholder={t("notePlaceholder", locale)} /></label>
                <div className="composer-pair-side">
                  {draft.kind !== "idea" && <label className="field-label"><span>{t("tags", locale)}</span>
                    <TagInput value={draft.tags} available={availableTags} onChange={(tags) => update("tags", tags)} locale={locale} />
                  </label>}
                  {/* Importance and urgency sit under the tags, where a narrow
                      phone still fits them. */}
                  {(draft.kind === "task" || draft.kind === "event") && (
                    <div className="field-stack">
                      <label className="field-label"><span>{t("priority", locale)}</span>
                        <GlassSelect
                          value={draft.priority ?? ""}
                          ariaLabel={t("priority", locale)}
                          options={[{ value: "", label: t("priorityNormal", locale) }, ...labeledOptions(priorities, locale)]}
                          onChange={(value) => update("priority", (value || undefined) as EntryPriority | undefined)}
                        />
                      </label>
                      <label className="field-label"><span>{t("urgency", locale)}</span>
                        <GlassSelect
                          value={draft.urgency ?? ""}
                          ariaLabel={t("urgency", locale)}
                          options={[{ value: "", label: t("priorityNormal", locale) }, ...labeledOptions(priorities, locale)]}
                          onChange={(value) => update("urgency", (value || undefined) as EntryPriority | undefined)}
                        />
                      </label>
                    </div>
                  )}
                  {draft.kind === "bill" && (
                    <label className="field-label item-from-bill-field">
                      <span className="linked-field-heading">{pendingItemLink ? `${locale === "zh" ? "关联物品" : "Linked asset"} · ${pendingItemLink.name}` : t("itemAddFromBill", locale)}{linkedBillItem && onEditItem && <button type="button" className="icon-button" aria-label={`${t("itemAddFromBill", locale)} · ${linkedBillItem.name}`} onClick={() => onEditItem(linkedBillItem)}><Icon name="arrow-right" size={14} /></button>}</span>
                      <GlassSelect
                        value={linkedBillItem?.category ?? billItemCategory}
                        disabled={Boolean(linkedBillItem)}
                        ariaLabel={t("itemAddFromBill", locale)}
                        options={[
                          { value: "", label: t("itemNoAdd", locale) },
                          ...itemCategoriesForCalendar(settings, draft.calendar).map(option => ({
                            value: option.id,
                            label: option.name,
                            mark: <Icon name={itemCategoryIconName(option.id, settings, draft.calendar)} size={15} />,
                          })),
                        ]}
                        onChange={setBillItemCategory}
                      />
                    </label>
                  )}
                </div>
              </div>

              <AttachmentField
                locale={locale}
                settings={settings}
                entryDate={draft.date}
                icon={<EntryGlyph kind={draft.kind} status={draft.status} size={20} />}
                value={draft.images ?? []}
                onChange={(next) => update("images", next.length ? next : undefined)}
                onNotice={onNotice}
              />
            </>
          )}

          {activeKind === "item" && itemDraft && (
            <>
              <ItemPhotoField
                value={itemDraft.images ?? []}
                locale={locale}
                settings={settings}
                entryDate={itemDraft.acquiredOn}
                busy={itemBusy}
                disabled={itemBusy}
                onChange={images => patchItem({ images })}
                onNotice={message => setError(message as MessageKey)}
              />
              {error && <p className="form-error" role="alert">{t(error, locale)}</p>}
            </>
          )}

          <footer className="composer-footer">
            {activeKind === "item"
              ? editingItem && onDeleteItem
                ? <button className="danger-button" type="button" onClick={() => { void onDeleteItem(editingItem.id); }}><Icon name="trash" size={16} />{t("delete", locale)}</button>
                : <span />
              : source ? <button className="danger-button" type="button" onClick={remove}><Icon name="trash" size={16} />{t(recurringSeries ? "deleteSeries" : "delete", locale)}</button> : <span />}
            <div><button className="primary-action" type="submit" disabled={activeKind === "item" ? itemBusy : submitting}>{t(occurrenceOnly ? "moveOccurrence" : "save", locale)}<Icon name="arrow-right" size={16} /></button></div>
          </footer>
        </form>
      </section>
    </div>
  );
}
