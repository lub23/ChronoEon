import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ALL_DAY_REMINDERS,
  BUILTIN_CURRENCIES,
  DEFAULT_CHRONOEON_SETTINGS,
  TIMED_REMINDERS,
  categoryOptionsForKind,
  defaultCategoryForKind,
  resolveReminderTime,
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
} from "../domain/entry";
import { inferCategory, inferLocation, type CaptureHistoryItem } from "@chronoeon/domain";
import { entryToDraft, type EntryEditContext, type RecurrenceEditScope } from "../domain/entryWorkflow";
import type { ConfirmRequest } from "./ConfirmDialog";
import { catalogLabel, categoryLabel, compositeCategoryLabel, localeTag, paymentMethodLabel, t, type MessageKey } from "../i18n";
import { AttachmentField } from "./AttachmentField";
import { GlassDatePicker, GlassTimePicker } from "./GlassDateTimePicker";
import { GlassSelect, type GlassSelectOption } from "./GlassSelect";
import { Icon } from "./Icon";
import { TagInput } from "./TagInput";
import { TaskStatusMenu } from "./TaskSummaryList";
import { TaskStatusGlyph } from "./ItemGlyph";
import { registerModalDismiss } from "./modalLayer";
import { readCurrentPlace } from "../platform/location";

interface EntryComposerProps {
  locale: Locale;
  selectedDate: string;
  editing: Entry | null;
  /** Canonical series source when `editing` is a projected occurrence. */
  sourceEntry?: Entry | null;
  settings?: ChronoEonSettings;
  availableTags?: string[];
  onClose: () => void;
  onSave: (draft: EntryDraft, editingId?: string, context?: EntryEditContext) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onNotice?: (message: string, tone?: "normal" | "warning") => void;
  onConfirm?: (request: ConfirmRequest) => Promise<boolean>;
  initialDraft?: Partial<EntryDraft>;
  /** Local entries are the only category-learning corpus; never sent anywhere. */
  history?: readonly CaptureHistoryItem[];
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
  const draft: EntryDraft = {
    kind: "event",
    title: "",
    date: selectedDate,
    start: seed?.start ?? (seed?.kind === "idea" ? currentClock : "09:00"),
    end: "",
    allDay: false,
    calendar: settings.defaultCalendarID,
    category: defaultCategoryForKind("event", settings),
    currency: settings.bill.currency,
    payment: settings.bill.paymentMethods[0],
    recurrence: "none",
    reminder: "none",
    ...seed,
  };
  return normalizeScheduleTimes(draft, settings.timeScale);
}

const kinds: EntryKind[] = ["task", "event", "idea", "bill"];
const recurrenceOptions: Array<{ value: Recurrence; key: MessageKey }> = [
  { value: "none", key: "recurrenceNone" },
  { value: "daily", key: "recurrenceDaily" },
  { value: "weekly", key: "recurrenceWeekly" },
  { value: "monthly", key: "recurrenceMonthly" },
  { value: "yearly", key: "recurrenceYearly" },
];

/** Every reminder value the shared domain can resolve, in both time modes. */
const reminderLabels: Record<Reminder, MessageKey> = {
  none: "reminderNone",
  "at-time": "reminderAtTime",
  "5min": "reminder5min",
  "15min": "reminder15min",
  "30min": "reminder30min",
  "1hour": "reminder1hour",
  "2hour": "reminder2hour",
  "12hour": "reminder12hour",
  "1day": "reminder1day",
  "1week": "reminder1week",
  "day-9am": "reminderDay9am",
  "day-before-9am": "reminderPreviousDay9am",
  "day-before-5pm": "reminderPreviousDay5pm",
  "week-before-9am": "reminderPreviousWeek9am",
};

const priorities: Array<{ value: EntryPriority; key: MessageKey }> = [
  { value: "low", key: "priorityLow" },
  { value: "high", key: "priorityHigh" },
];

const statusKeys: Record<EntryStatus, MessageKey> = {
  open: "statusOpen",
  "in-progress": "statusInProgress",
  done: "statusDone",
  cancelled: "statusCancelled",
};

function statusKeyFor(status: EntryStatus): MessageKey {
  return statusKeys[status];
}

function labeledOptions<Value extends string>(items: Array<{ value: Value; key: MessageKey }>, locale: Locale): GlassSelectOption[] {
  return items.map(({ value, key }) => ({ value, label: t(key, locale) }));
}

function weekdayFor(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay() : 1;
}

function withCurrentOption(options: EntryCategoryOption[], category: string): EntryCategoryOption[] {
  if (!category || options.some((option) => option.value === category)) return options;
  return [{ value: category, label: category, color: "#8b8b83" }, ...options];
}

/** Detail fields that must stay visible when an existing entry already uses them. */
function hasDetailFields(entry: Entry | null | undefined): boolean {
  if (!entry) return false;
  return Boolean(
    (entry.kind !== "idea" && Boolean(entry.priority || entry.urgency))
    || entry.tags?.length
    || entry.images?.length
    || entry.note
    || entry.location
  );
}


export function EntryComposer({
  locale,
  selectedDate,
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
}: EntryComposerProps) {
  const occurrence = Boolean(editing?.recurrenceSourceId && editing.occurrenceDate);
  const source = sourceEntry ?? editing;
  const initialScope: RecurrenceEditScope = occurrence ? "occurrence" : "series";
  const [scope, setScope] = useState<RecurrenceEditScope>(initialScope);
  const [draft, setDraft] = useState<EntryDraft>(() => initialDraft(selectedDate, occurrence ? editing : source, settings, seed));
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
  const [locating, setLocating] = useState(false);
  // A selected value wins over every later title-derived suggestion.
  const categoryTouchedRef = useRef(false);
  // A cleared or typed location is explicit, even when the field is empty.
  const locationTouchedRef = useRef(false);
  // Existing detail fields keep the section open, so an edit never hides data.
  const [showDetails, setShowDetails] = useState(() => hasDetailFields(occurrence ? editing : source));
  const [statusMenu, setStatusMenu] = useState<{ left: number; top: number } | null>(null);
  // The draft at open time is the discard baseline: Esc (or the close button)
  // with unsaved changes asks before losing them.
  const pristineRef = useRef<string>(JSON.stringify(initialDraft(selectedDate, occurrence ? editing : source, settings, seed)));
  const dirty = JSON.stringify(draft) !== pristineRef.current;

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
    setShowDetails(hasDetailFields(nextScope === "occurrence" ? editing : source));
    // A saved category is already an explicit user choice; never auto-replace it.
    categoryTouchedRef.current = Boolean(source);
    locationTouchedRef.current = Boolean(source?.location || seed?.location);
    setError(null);
  }, [selectedDate, editing, source, settings, occurrence, seed]);

  // Reuse the offline capture learner: recent exact/subtitle matches beat the
  // built-in keyword rules, while an explicit picker choice becomes final.
  useEffect(() => {
    if (categoryTouchedRef.current) return;
    const title = draft.title.trim();
    if (!title) return;
    const suggestion = inferCategory(title, draft.title, draft.kind, settings, history, new Date(), draft.amount, draft.calendar, "any");
    if (suggestion.confidence <= 0 || suggestion.value === draft.category) return;
    setDraft((current) => ({ ...current, category: suggestion.value }));
  }, [draft.title, draft.kind, draft.amount, draft.category, history, settings]);

  // Same local-learning idea as categories, but rank equal title matches by
  // calendar distance and stop as soon as the user owns the location field.
  useEffect(() => {
    if (!settings.locationAutofill || locationTouchedRef.current || draft.location) return;
    const location = inferLocation(draft.title, history, draft.date);
    if (location) update("location", location);
  }, [draft.title, draft.date, draft.location, history, settings]);

  const categoryOptions = useMemo(
    () => withCurrentOption(categoryOptionsForKind(draft.kind, settings, draft.calendar), draft.category),
    [draft.kind, draft.category, draft.calendar, settings],
  );
  const billGroups = useMemo(() => {
    const groups = new Map<string, EntryCategoryOption[]>();
    for (const option of categoryOptions) {
      const group = option.group ? catalogLabel(option.group, locale, option.group) : t("category", locale);
      groups.set(group, [...(groups.get(group) ?? []), option]);
    }
    return [...groups.entries()];
  }, [categoryOptions, locale]);
  const weekdays = locale === "zh"
    ? ["日", "一", "二", "三", "四", "五", "六"]
    : ["S", "M", "T", "W", "T", "F", "S"];
  const weekdayTitles = locale === "zh"
    ? ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
    : ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const occurrenceOnly = scope === "occurrence";
  const recurringSeries = Boolean(source?.recurrence && source.recurrence !== "none");

  // Showing when a reminder will actually fire removes the main uncertainty of
  // relative reminders ("15 minutes before *what*?").
  const reminderPreview = useMemo(() => {
    if (!draft.reminder || draft.reminder === "none") return "";
    const trigger = resolveReminderTime({
      date: draft.date,
      start: draft.start,
      allDay: draft.allDay,
      reminder: draft.reminder,
    });
    if (!trigger) return "";
    return trigger.toLocaleString(localeTag[locale], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [draft.allDay, draft.date, draft.reminder, draft.start, locale]);

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
      const reminder = (allDay ? ALL_DAY_REMINDERS : TIMED_REMINDERS).includes(current.reminder ?? "none")
        ? current.reminder
        : "none";
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

  function changeKind(kind: EntryKind) {
    setDraft((current) => {
      const options = categoryOptionsForKind(kind, settings, current.calendar);
      const category = options.some((option) => option.value === current.category)
        ? current.category
        : defaultCategoryForKind(kind, settings);
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
        payment: kind === "bill" ? current.payment ?? settings.bill.paymentMethods[0] : undefined,
        recurrence: kind === "idea" ? "none" : current.recurrence,
        recurringDays: kind === "idea" ? undefined : current.recurringDays,
        recurringEnd: kind === "idea" ? undefined : current.recurringEnd,
        reminder: kind === "idea" ? "none" : current.reminder,
        priority: kind === "idea" ? undefined : current.priority,
        urgency: kind === "idea" ? undefined : current.urgency,
      };
    });
  }

  function changeRecurrence(recurrence: Recurrence) {
    setDraft((current) => ({
      ...current,
      recurrence,
      recurringDays: recurrence === "weekly"
        ? (current.recurringDays?.length ? current.recurringDays : [weekdayFor(current.date)])
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

  async function submit(event: React.FormEvent) {
    event.preventDefault();
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
      await onSave(
        normalized.kind === "task" || normalized.kind === "event"
          ? { ...normalized, title: normalized.title.trim() }
          : { ...normalized, title: normalized.title.trim(), end: "", endDate: undefined },
        source?.id,
        { scope, occurrenceDate: occurrenceOnly ? editing?.occurrenceDate : undefined },
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
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
          <div className="composer-title-line">
            <h2 id="composer-title">{editing ? t("editTitle", locale) : t("createTitle", locale)}</h2>
            <div className="composer-category-field composer-category-field--top">
              <GlassSelect
                value={draft.category}
                ariaLabel={t("category", locale)}
                options={draft.kind === "bill"
                  ? billGroups.flatMap(([group, options]) => options.map((option) => ({
                    value: option.value,
                    label: option.group ? compositeCategoryLabel(option.value, locale) : categoryLabel(option.value, locale, option.label),
                    color: option.color,
                    group,
                  })))
                  : categoryOptions.map((option) => ({ value: option.value, label: categoryLabel(option.value, locale, option.label), color: option.color, group: option.group }))}
                onChange={(value) => { categoryTouchedRef.current = true; update("category", value); }}
              />
            </div>
            {draft.kind === "task" && (
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
            {draft.kind === "task" || draft.kind === "event" ? (
              <label className="all-day-toggle all-day-toggle--compact composer-header-toggle">
                <input type="checkbox" checked={Boolean(draft.allDay)} onChange={(event) => changeAllDay(event.target.checked)} />
                <i className="fake-checkbox" aria-hidden="true" />
                <span>{t("allDay", locale)}</span>
              </label>
            ) : null}
            </div>
          <button className="icon-button" type="button" onClick={requestClose} aria-label={t("close", locale)}><Icon name="close" /></button>
        </header>

        <div className="composer-kind-bar">
          <div className="kind-switcher" role="tablist" aria-label={t("type", locale)}>
            {kinds.map((kind) => (
              <button key={kind} disabled={occurrenceOnly} type="button" role="tab" aria-selected={draft.kind === kind} className={draft.kind === kind ? `is-active kind-${kind}` : ""} onClick={() => changeKind(kind)}>
                <span className={`kind-dot kind-dot--${kind}`} />{t(kind, locale)}
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

          <div className="title-location-row">
            <label className={`field-label field-label--large field-label--title${error === "required" ? " has-error" : ""}`}>
              <span>{t("title", locale)} <em>*</em></span>
              <input disabled={occurrenceOnly} autoFocus={!occurrenceOnly} value={draft.title} onChange={(event) => update("title", event.target.value)} placeholder={t("titlePlaceholder", locale)} />
              {error === "required" && <small>{t("required", locale)}</small>}
            </label>
            {draft.kind !== "idea" && (
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
                </div>
              </label>
            )}
          </div>

          {statusMenu && draft.kind === "task" && (
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

          <div className={draft.kind === "task" || draft.kind === "event" ? "when-groups" : "when-groups when-groups--single"}>
            <div className="when-group">
              <span>{t("start", locale)}</span>
              <div className="when-controls">
                <GlassDatePicker
                  value={draft.date}
                  ariaLabel={t(editing ? "moveToDate" : "date", locale)}
                  locale={locale}
                  disabled={occurrenceOnly}
                  clearable={false}
                  onChange={(value) => update("date", value ?? draft.date)}
                />
                {!draft.allDay && (
                  <GlassTimePicker
                    value={draft.start}
                    ariaLabel={t("start", locale)}
                    locale={locale}
                    disabled={occurrenceOnly}
                    clearable={false}
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
                    onChange={(value) => update("endDate", value)}
                  />
                  {!draft.allDay && (
                    <GlassTimePicker
                      value={draft.end}
                      ariaLabel={t("end", locale)}
                      locale={locale}
                      disabled={occurrenceOnly}
                    onChange={(value, committed) => updateTime("end", value, committed)}
                    />
                  )}
                </div>
              </div>
            )}
          </div>

          {error && error !== "required" && <p className="form-error" role="alert">{t(error, locale)}</p>}

          {!occurrenceOnly && (
            <>
              {draft.kind !== "idea" && (
                <section className="recurrence-fields">
                  <div className="field-row">
                    <label className="field-label"><span>{t("recurrence", locale)}</span>
                      <GlassSelect
                        value={draft.recurrence ?? "none"}
                        ariaLabel={t("recurrence", locale)}
                        options={labeledOptions(recurrenceOptions, locale)}
                        onChange={(value) => changeRecurrence(value as Recurrence)}
                      />
                    </label>
                    <label className="field-label"><span>{t("reminder", locale)}</span>
                      <GlassSelect
                        value={draft.reminder ?? "none"}
                        ariaLabel={t("reminder", locale)}
                        options={(draft.allDay ? ALL_DAY_REMINDERS : TIMED_REMINDERS).map((value) => ({ value, label: t(reminderLabels[value], locale) }))}
                        onChange={(value) => update("reminder", value as Reminder)}
                      />
                    </label>
                  </div>
                  {reminderPreview && <p className="field-hint field-hint--quiet"><Icon name="bell" size={13} /> {t("reminderNext", locale)} · {reminderPreview}</p>}
                  {draft.recurrence && draft.recurrence !== "none" && (
                    <div className="field-row recurrence-detail-row">
                      <label className="field-label">
                        <span>{t("repeatUntil", locale)}</span>
                        <GlassDatePicker
                          value={draft.recurringEnd}
                          min={draft.date}
                          ariaLabel={t("repeatUntil", locale)}
                          locale={locale}
                          onChange={(value) => update("recurringEnd", value)}
                        />
                      </label>
                      {draft.recurrence === "weekly" && <fieldset className="weekday-field"><legend>{t("repeatOn", locale)}</legend><div className="weekday-picker">
                        {weekdays.map((day, index) => <label key={index} title={weekdayTitles[index]} className={draft.recurringDays?.includes(index) ? "is-active" : ""}><input type="checkbox" checked={Boolean(draft.recurringDays?.includes(index))} onChange={(event) => toggleWeekday(index, event.target.checked)} /><span>{day}</span></label>)}
                      </div></fieldset>}
                    </div>
                  )}
                </section>
              )}

              {draft.kind === "bill" && <>
                <div className="bill-primary-row">
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
                        ...settings.bill.paymentMethods.map((method) => ({ value: method, label: paymentMethodLabel(method, locale) })),
                      ]}
                      onChange={(value) => update("payment", value || undefined)}
                    />
                  </label>
                </div>
              </>}

              <label className="field-label"><span>{t("note", locale)}</span><textarea rows={4} value={draft.note ?? ""} onChange={(event) => update("note", event.target.value)} placeholder={t("notePlaceholder", locale)} /></label>

              <button type="button" className="details-toggle" onClick={() => setShowDetails(!showDetails)} aria-expanded={showDetails}>
                <Icon name={showDetails ? "chevron-down" : "chevron-right"} size={14} />
                {t(showDetails ? "fewerFields" : "moreFields", locale)}
              </button>

              {showDetails && (
                <section className="composer-details">
                  {(draft.kind === "task" || draft.kind === "event") && (
                    <div className="field-row">
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

                  <label className="field-label"><span>{t("tags", locale)}</span>
                    <TagInput value={draft.tags} available={availableTags} onChange={(tags) => update("tags", tags)} locale={locale} />
                  </label>

                  <AttachmentField
                    locale={locale}
                    settings={settings}
                    entryDate={draft.date}
                    value={draft.images ?? []}
                    onChange={(next) => update("images", next.length ? next : undefined)}
                    onNotice={onNotice}
                  />
                </section>
              )}
            </>
          )}

          <footer className="composer-footer">
            {source ? <button className="danger-button" type="button" onClick={remove}><Icon name="trash" size={16} />{t(recurringSeries ? "deleteSeries" : "delete", locale)}</button> : <span />}
            <div><button className="secondary-button" type="button" onClick={requestClose}>{t("cancel", locale)}</button><button className="primary-action" type="submit" disabled={submitting}>{t(occurrenceOnly ? "moveOccurrence" : "save", locale)}<Icon name="arrow-right" size={16} /></button></div>
          </footer>
        </form>
      </section>
    </div>
  );
}
