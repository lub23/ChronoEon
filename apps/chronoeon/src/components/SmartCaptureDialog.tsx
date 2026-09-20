import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { format, parseISO } from "date-fns";
import {
  ALL_DAY_REMINDERS,
  BUILTIN_CURRENCIES,
  TIMED_REMINDERS,
  buildSmartCapturePrompt,
  categoryOptionsForKind,
  defaultCategoryForKind,
  extractAIJson,
  formatEntryTime,
  inferCategory,
  inferLocation,
  normalizeAIStructuredResult,
  parseCapture,
  type CaptureHistoryItem,
  validateAIStructuredDraft,
  type AIValidationIssue,
  type ChronoEonSettings,
  type EntryDraft,
  type EntryKind,
  type EntryPriority,
  type Locale,
  type Reminder,
} from "@chronoeon/domain";
import type { AIProviderPreferences } from "../ai/provider";
import { activeAIProvider, providerIsConfigured, requestSmartCapture } from "../ai/provider";
import type { SmartCaptureRecoveryState } from "../ai/draftRecovery";
import { paymentMethodLabel, t, type MessageKey } from "../i18n";
import { GlassDatePicker, GlassTimePicker } from "./GlassDateTimePicker";
import { GlassSelect } from "./GlassSelect";
import { useModalDismiss } from "./modalLayer";
import { Icon } from "./Icon";

interface SmartCaptureDialogProps {
  raw: string;
  locale: Locale;
  settings: ChronoEonSettings;
  history?: readonly CaptureHistoryItem[];
  aiPreferences: AIProviderPreferences;
  recovery?: SmartCaptureRecoveryState | null;
  onRecoveryChange?: (state: Omit<SmartCaptureRecoveryState, "updatedAt">) => void;
  onClose: () => void;
  onConfigureAI: () => void;
  onConfirm: (drafts: EntryDraft[]) => Promise<boolean>;
}

type AutofillField = "category" | "location";

interface PreviewDraft {
  key: string;
  draft: EntryDraft;
  warnings: AIValidationIssue[];
  /** Fields guessed from similar past items rather than parsed from the text. */
  autofilled: AutofillField[];
}

/**
 * A quick note rarely names its category or place. Borrow both from the most
 * similar recent items, the same learner the composer uses, and say so: the
 * user is asked to check a guess, never silently handed one.
 */
function autofillDraft(
  draft: EntryDraft,
  categoryConfidence: number,
  history: readonly CaptureHistoryItem[],
  settings: ChronoEonSettings,
): { draft: EntryDraft; autofilled: AutofillField[] } {
  const autofilled: AutofillField[] = [];
  let next = draft;
  if (categoryConfidence > 0) autofilled.push("category");
  if (!next.location && next.kind !== "idea" && settings.locationAutofill) {
    const location = inferLocation(next.title, history, next.date);
    if (location) {
      next = { ...next, location };
      autofilled.push("location");
    }
  }
  return { draft: next, autofilled };
}

const issueMessages: Record<AIValidationIssue["code"], MessageKey> = {
  "missing-title": "aiIssueMissingTitle",
  "invalid-kind": "aiIssueInvalidKind",
  "invalid-date": "aiIssueInvalidDate",
  "invalid-time": "aiIssueInvalidTime",
  "missing-start": "aiIssueMissingStart",
  "invalid-end": "aiIssueInvalidEnd",
  "unknown-category": "aiIssueUnknownCategory",
  "invalid-amount": "aiIssueInvalidAmount",
  "empty-response": "aiIssueEmptyResponse",
};

const kinds: EntryKind[] = ["task", "event", "bill", "idea"];

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

function firstErrorFor(draft: EntryDraft, field: keyof EntryDraft): AIValidationIssue | undefined {
  return validateAIStructuredDraft(draft).find((issue) => issue.field === field && issue.severity === "error");
}

function scheduleSummary(draft: EntryDraft, locale: Locale): string {
  const date = format(parseISO(draft.date), locale === "zh" ? "M月d日" : "MMM d");
  if (draft.allDay) return `${date} · ${t("allDay", locale)}`;
  return draft.start ? `${date} · ${formatEntryTime(draft, locale)}` : date;
}

export function SmartCaptureDialog({ raw, locale, settings, history, aiPreferences, recovery, onRecoveryChange, onClose, onConfigureAI, onConfirm }: SmartCaptureDialogProps) {
  const today = useMemo(() => new Date(), []);
  const seed = useMemo<PreviewDraft>(() => {
    const parsed = parseCapture(raw, { now: today, locale, settings, history });
    const completed = autofillDraft(parsed.draft, parsed.confidence.category, history ?? [], settings);
    return { key: "offline", draft: completed.draft, warnings: [], autofilled: completed.autofilled };
  }, [locale, raw, settings, history, today]);
  const recoveredItems = useMemo<PreviewDraft[]>(() => (recovery?.drafts ?? []).map((draft, index) => ({
    key: `recovered-${index}-${draft.title}`,
    draft,
    warnings: [],
    autofilled: [],
  })), [recovery?.drafts]);
  const [items, setItems] = useState<PreviewDraft[]>(recoveredItems.length ? recoveredItems : [seed]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [mode, setMode] = useState<"offline" | "ai">(recovery?.mode ?? "offline");
  const [busy, setBusy] = useState<"ai" | "save" | null>(null);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const firstTitleRef = useRef<HTMLInputElement>(null);
  const editedRef = useRef(false);
  const recoveredAtOpen = useRef(recovery?.raw === raw && recoveredItems.length > 0);
  const savingRef = useRef(false);
  const [waking, setWaking] = useState(false);

  useEffect(() => {
    firstTitleRef.current?.focus();
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    editedRef.current = false;
    recoveredAtOpen.current = recovery?.raw === raw && recoveredItems.length > 0;
    setItems(recoveredAtOpen.current ? recoveredItems : [seed]);
    setMode(recoveredAtOpen.current ? recovery?.mode ?? "offline" : "offline");
    setEditingKey(null);
    setError("");
    setBusy(null);
  }, [raw]);

  useEffect(() => {
    onRecoveryChange?.({ mode, raw, drafts: items.map((item) => item.draft) });
  }, [items, mode, onRecoveryChange, raw]);

  useModalDismiss((event) => {
    event.preventDefault();
    if (busy !== "save") onClose();
  });

  useEffect(() => {
    if (busy !== "ai") return;
    const timeout = globalThis.setTimeout(() => setWaking(true), 8_000);
    return () => globalThis.clearTimeout(timeout);
  }, [busy]);

  function cancelAI() {
    abortRef.current?.abort();
    abortRef.current = null;
    setWaking(false);
    if (!savingRef.current) setBusy(null);
  }

  const patch = (key: string, change: Partial<EntryDraft>) => {
    // A slow model must never overwrite what the user has already corrected.
    editedRef.current = true;
    cancelAI();
    setItems((current) => current.map((item) => item.key === key
      ? {
        ...item,
        draft: { ...item.draft, ...change },
        // Once the user owns a guessed field, it is no longer a guess.
        autofilled: item.autofilled.filter((field) => !(field in change)),
      }
      : item));
    setError("");
  };

  const changeKind = (item: PreviewDraft, kind: EntryKind) => {
    patch(item.key, {
      kind,
      category: defaultCategoryForKind(kind, settings, item.draft.calendar),
      allDay: kind === "task" || kind === "event" ? item.draft.allDay : false,
      start: kind === "task" || kind === "event" ? item.draft.start ?? "09:00" : item.draft.start,
      end: kind === "task" || kind === "event" ? item.draft.end ?? "" : "",
      endDate: kind === "task" || kind === "event" ? item.draft.endDate : undefined,
      location: kind === "idea" ? undefined : item.draft.location,
      amount: kind === "bill" ? item.draft.amount ?? 0 : undefined,
      currency: kind === "bill" ? item.draft.currency ?? settings.bill.currency : undefined,
      payment: kind === "bill" ? item.draft.payment ?? settings.bill.paymentMethods[0] : undefined,
      priority: kind === "task" || kind === "event" ? item.draft.priority : undefined,
      urgency: kind === "task" || kind === "event" ? item.draft.urgency : undefined,
      recurrence: kind === "idea" ? "none" : item.draft.recurrence,
      reminder: kind === "idea" ? "none" : item.draft.reminder ?? "none",
    });
  };

  async function improveWithAI() {
    if (!providerIsConfigured(aiPreferences)) {
      onConfigureAI();
      return;
    }
    if (abortRef.current || savingRef.current) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy("ai");
    setWaking(false);
    setError("");
    try {
      const prompt = buildSmartCapturePrompt(raw, format(new Date(), "yyyy-MM-dd HH:mm"), locale, settings);
      const completion = await requestSmartCapture(activeAIProvider(aiPreferences), prompt, controller.signal);
      if (controller.signal.aborted || abortRef.current !== controller) return;
      const normalized = normalizeAIStructuredResult(extractAIJson(completion.content), format(today, "yyyy-MM-dd"), settings);
      if (!normalized.candidates.length) throw new Error(t("aiIssueEmptyResponse", locale));
      setItems(normalized.candidates.map((candidate, index) => {
        let draft: EntryDraft = {
          ...candidate.draft,
          allDay: candidate.draft.kind === "task" || candidate.draft.kind === "event" ? candidate.draft.allDay : false,
          start: candidate.draft.kind === "task" || candidate.draft.kind === "event" ? candidate.draft.start ?? "09:00" : candidate.draft.start,
        };
        let warnings = candidate.issues.filter((issue) => issue.severity === "warning");
        // The model fell back to the default category: try the local learner
        // before showing a default, and drop the "unknown" note if it helps.
        let categoryConfidence = 0;
        if (warnings.some((issue) => issue.code === "unknown-category")) {
          const learned = inferCategory(draft.title, raw, draft.kind, settings, history ?? [], today, draft.amount, draft.calendar);
          if (learned.confidence > 0) {
            draft = { ...draft, category: learned.value };
            categoryConfidence = learned.confidence;
            warnings = warnings.filter((issue) => issue.code !== "unknown-category");
          }
        }
        const completed = autofillDraft(draft, categoryConfidence, history ?? [], settings);
        return { key: `ai-${Date.now()}-${index}`, draft: completed.draft, warnings, autofilled: completed.autofilled };
      }));
      setMode("ai");
      setEditingKey(null);
    } catch (reason) {
      if (!controller.signal.aborted && abortRef.current === controller) {
        const aborted = reason instanceof DOMException && reason.name === "AbortError";
        const detail = reason instanceof Error ? reason.message : String(reason);
        setError(aborted ? t("aiRequestCancelled", locale) : `${t("aiRequestFailed", locale)} · ${detail}`);
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(null);
        setWaking(false);
      }
    }
  }

  useEffect(() => {
    // Defer one microtask so StrictMode setup/cleanup cannot issue two requests.
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed && providerIsConfigured(aiPreferences) && !recoveredAtOpen.current && !editedRef.current) void improveWithAI();
    });
    return () => {
      disposed = true;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [raw, aiPreferences]);

  const validation = items.map((item) => validateAIStructuredDraft(item.draft));
  const invalid = !items.length || validation.some((issues) => issues.some((issue) => issue.severity === "error"));

  async function confirm() {
    if (invalid || savingRef.current) return;
    cancelAI();
    savingRef.current = true;
    setBusy("save");
    setError("");
    try {
      const saved = await onConfirm(items.map((item) => item.draft));
      if (!saved) { savingRef.current = false; setBusy(null); }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      savingRef.current = false;
      setBusy(null);
    }
  }


  return (
    <div className="smart-capture-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && busy !== "save") onClose(); }}>
      <section className="smart-capture-dialog" role="dialog" aria-modal="true" aria-labelledby="smart-capture-title" aria-describedby="smart-capture-description">
        <header className="smart-capture-header">
          <span className="smart-capture-mark"><Icon name="sparkle" size={16} /></span>
          <div><h2 id="smart-capture-title">{t("smartCaptureTitle", locale)}</h2><span className="eyebrow">{t(mode === "ai" ? "smartCaptureAIPreview" : "smartCaptureOffline", locale)}</span></div>
          <button type="button" className="icon-button" disabled={busy === "save"} onClick={onClose} aria-label={t("close", locale)}><Icon name="close" size={16} /></button>
        </header>
        <p id="smart-capture-description" className="visually-hidden">{t("smartCaptureDetail", locale)}</p>
        <div className="smart-capture-source-row">
          <blockquote className="smart-capture-raw" title={raw}>{raw}</blockquote>
          <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void improveWithAI()}>
            <Icon name="sparkle" size={14} />{t(providerIsConfigured(aiPreferences) ? error ? "smartCaptureRetry" : "smartCaptureAI" : "smartCaptureConfigure", locale)}
          </button>
        </div>
        {(busy === "ai" || mode === "ai") && <div className="smart-capture-toolbar">
          {busy === "ai" && <span className="smart-capture-status" role="status">{t(waking ? "smartCaptureWaking" : "smartCaptureWorking", locale)}</span>}
          {mode === "ai" && <button type="button" className="link-button" disabled={Boolean(busy)} onClick={() => { cancelAI(); editedRef.current = true; setItems([seed]); setMode("offline"); setError(""); }}>{t("smartCaptureOffline", locale)}</button>}
          {busy === "ai" && <button type="button" className="link-button" onClick={cancelAI}>{t("aiChatStop", locale)}</button>}
        </div>}
        <div className="smart-capture-list">
          {items.map((item, index) => {
            const issues = [...validation[index], ...item.warnings];
            const categoryOptions = categoryOptionsForKind(item.draft.kind, settings, item.draft.calendar);
            const categoryOption = categoryOptions.find((option) => option.value === item.draft.category);
            const category = categoryOption?.label ?? item.draft.category;
            const editing = editingKey === item.key;
            return (
              <article className={`smart-capture-card${editing ? " is-editing" : " is-collapsed"}`} key={item.key}>
                <header>
                  <button
                    type="button"
                    className="smart-capture-summary"
                    aria-expanded={editing}
                    onClick={() => {
                      setEditingKey(editing ? null : item.key);
                      if (!editing) requestAnimationFrame(() => firstTitleRef.current?.focus());
                    }}
                  >
                    <strong>{index + 1}</strong>
                    <span className="smart-capture-summary-main">
                      <b>{item.draft.title || t("untitled", locale)}</b>
                      <small>
                        <span>{t(item.draft.kind, locale)}</span>
                        <span>{scheduleSummary(item.draft, locale)}</span>
                        {category && <span className={item.autofilled.includes("category") ? "smart-capture-category is-autofilled" : "smart-capture-category"} style={{ "--category-color": categoryOption?.color ?? "var(--accent)" } as CSSProperties} title={item.autofilled.includes("category") ? t("smartCaptureAutofilled", locale) : undefined}><i aria-hidden="true" />{category}{item.autofilled.includes("category") && <em>{t("smartCaptureAutoTag", locale)}</em>}</span>}
                        {item.draft.location && <span className={item.autofilled.includes("location") ? "smart-capture-place is-autofilled" : "smart-capture-place"} title={item.autofilled.includes("location") ? t("smartCaptureAutofilled", locale) : undefined}><Icon name="map-pin" size={10} />{item.draft.location}{item.autofilled.includes("location") && <em>{t("smartCaptureAutoTag", locale)}</em>}</span>}
                        {item.draft.kind === "bill" && item.draft.amount != null && <span>{item.draft.amount}</span>}
                      </small>
                    </span>
                    {issues.some((issue) => issue.severity === "error") && <i aria-hidden="true" />}
                  </button>
                  <button type="button" className="icon-button" disabled={items.length === 1 || busy === "save"} onClick={() => { cancelAI(); editedRef.current = true; setItems((current) => current.filter((candidate) => candidate.key !== item.key)); }} aria-label={t("delete", locale)}><Icon name="close" size={13} /></button>
                </header>
                {editing && (
                  <div className="smart-capture-editor">
                    <div className="smart-capture-row smart-capture-row--three">
                      <label><span>{t("type", locale)}</span><GlassSelect value={item.draft.kind} ariaLabel={t("type", locale)} options={kinds.map((kind) => ({ value: kind, label: t(kind, locale) }))} onChange={(value) => changeKind(item, value as EntryKind)} /></label>
                      <label className={item.autofilled.includes("category") ? "is-autofilled" : undefined}><span>{t("category", locale)}{item.autofilled.includes("category") && <em className="smart-capture-auto-tag">{t("smartCaptureAutoTag", locale)}</em>}</span><GlassSelect value={item.draft.category} ariaLabel={t("category", locale)} options={categoryOptions.map((option) => ({ value: option.value, label: option.label, color: option.color, group: option.group }))} onChange={(value) => patch(item.key, { category: value })} /></label>
                      {(item.draft.kind === "task" || item.draft.kind === "event") && (
                        <label className="all-day-toggle smart-capture-all-day">
                          <input type="checkbox" checked={Boolean(item.draft.allDay)} onChange={(event) => patch(item.key, { allDay: event.target.checked, start: event.target.checked ? undefined : item.draft.start ?? "09:00", end: event.target.checked ? undefined : item.draft.end })} />
                          <i className="fake-checkbox" aria-hidden="true" />
                          <span>{t("allDay", locale)}</span>
                        </label>
                      )}
                    </div>
                    <div className="smart-capture-row smart-capture-row--split">
                      <label className="smart-capture-title-field"><span>{t("title", locale)}</span><input ref={firstTitleRef} className={firstErrorFor(item.draft, "title") ? "is-invalid" : ""} value={item.draft.title} onChange={(event) => patch(item.key, { title: event.target.value })} /></label>
                      {item.draft.kind !== "idea" && <label className={item.autofilled.includes("location") ? "is-autofilled" : undefined}><span>{t("location", locale)}{item.autofilled.includes("location") && <em className="smart-capture-auto-tag">{t("smartCaptureAutoTag", locale)}</em>}</span><input value={item.draft.location ?? ""} onChange={(event) => patch(item.key, { location: event.target.value })} placeholder={t("locationPlaceholder", locale)} /></label>}
                    </div>
                    <div className="smart-capture-when">
                      <div className="smart-capture-when-field smart-capture-when-field--date">
                        <span>{t("startDate", locale)}</span>
                        <GlassDatePicker value={item.draft.date} ariaLabel={t("startDate", locale)} locale={locale} clearable={false} onChange={(value) => patch(item.key, { date: value ?? item.draft.date })} />
                      </div>
                      {!item.draft.allDay && <div className="smart-capture-when-field smart-capture-when-field--time">
                        <span>{t("startTime", locale)}</span>
                        <GlassTimePicker value={item.draft.start} ariaLabel={t("startTime", locale)} locale={locale} clearable={false} onChange={(value) => patch(item.key, { start: value })} />
                      </div>}
                      {(item.draft.kind === "task" || item.draft.kind === "event") && <>
                        <div className="smart-capture-when-field smart-capture-when-field--date">
                          <span>{t("endDate", locale)}</span>
                          <GlassDatePicker value={item.draft.endDate ?? item.draft.date} min={item.draft.date} ariaLabel={t("endDate", locale)} locale={locale} onChange={(value) => patch(item.key, { endDate: value })} />
                        </div>
                        {!item.draft.allDay && <div className="smart-capture-when-field smart-capture-when-field--time">
                          <span>{t("endTime", locale)}</span>
                          <GlassTimePicker value={item.draft.end} ariaLabel={t("endTime", locale)} locale={locale} onChange={(value) => patch(item.key, { end: value })} />
                        </div>}
                      </>}
                    </div>
                    {(item.draft.kind === "task" || item.draft.kind === "event") && (
                      <div className="smart-capture-row smart-capture-row--two">
                        <label><span>{t("priority", locale)}</span><GlassSelect value={item.draft.priority ?? ""} ariaLabel={t("priority", locale)} options={[{ value: "", label: t("priorityNormal", locale) }, ...priorities.map(({ value, key }) => ({ value, label: t(key, locale) }))]} onChange={(value) => patch(item.key, { priority: (value || undefined) as EntryPriority | undefined })} /></label>
                        <label><span>{t("reminder", locale)}</span><GlassSelect value={item.draft.reminder ?? "none"} ariaLabel={t("reminder", locale)} options={(item.draft.allDay ? ALL_DAY_REMINDERS : TIMED_REMINDERS).map((value) => ({ value, label: t(reminderLabels[value], locale) }))} onChange={(value) => patch(item.key, { reminder: value as Reminder })} /></label>
                      </div>
                    )}
                    {item.draft.kind === "bill" && (
                      <div className="smart-capture-row smart-capture-row--bill">
                        <label className={firstErrorFor(item.draft, "amount") ? "has-error" : ""}><span>{t("amount", locale)}</span><input type="number" step="0.01" value={item.draft.amount ?? ""} onChange={(event) => patch(item.key, { amount: event.target.value === "" ? undefined : Number(event.target.value) })} placeholder="0.00" /></label>
                        <label><span>{t("currency", locale)}</span><GlassSelect value={item.draft.currency ?? settings.bill.currency} ariaLabel={t("currency", locale)} options={[...Object.entries(BUILTIN_CURRENCIES).map(([code, currency]) => ({ value: code, label: locale === "zh" ? currency.name : code })), ...Object.keys(settings.bill.customCurrencies).filter((code) => !BUILTIN_CURRENCIES[code]).map((code) => ({ value: code, label: code }))]} onChange={(value) => patch(item.key, { currency: value })} /></label>
                        <label><span>{t("payment", locale)}</span><GlassSelect value={item.draft.payment ?? ""} ariaLabel={t("payment", locale)} options={[{ value: "", label: t("paymentNone", locale) }, ...settings.bill.paymentMethods.map((method) => ({ value: method, label: paymentMethodLabel(method, locale) }))]} onChange={(value) => patch(item.key, { payment: value || undefined })} /></label>
                      </div>
                    )}
                    <label className="smart-capture-note"><span>{t("note", locale)}</span><textarea rows={2} value={item.draft.note ?? ""} onChange={(event) => patch(item.key, { note: event.target.value })} placeholder={t("notePlaceholder", locale)} /></label>
                  </div>
                )}
                {(issues.length > 0 || item.autofilled.length > 0) && <ul className="smart-capture-issues">
                  {item.autofilled.length > 0 && <li className="autofill" key="autofill">{t(item.autofilled.length === 2 ? "smartCaptureAutofilledBoth" : item.autofilled[0] === "category" ? "smartCaptureAutofilledCategory" : "smartCaptureAutofilledLocation", locale)}</li>}
                  {issues.map((issue, issueIndex) => <li className={issue.severity} key={`${issue.code}-${issueIndex}`}>{t(issueMessages[issue.code], locale)}</li>)}
                </ul>}
              </article>
            );
          })}
        </div>
        {error && <p className="smart-capture-error" role="alert">{error}</p>}
        {invalid && !error && <p className="smart-capture-error" role="status">{t("smartCaptureInvalid", locale)}</p>}
        <footer><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={onClose}>{t("cancel", locale)}</button><button type="button" className="primary-action" disabled={invalid || busy === "save"} onClick={() => void confirm()}>{busy === "save" ? t("saving", locale) : t("smartCaptureConfirm", locale)}<Icon name="arrow-right" size={14} /></button></footer>
      </section>
    </div>
  );
}
