import { CaptureDecisionIndex, addIsoDays, differenceInIsoDays, categoryOptionsForKind, inferCategory, inferLocationCandidates, parseCapture, type CaptureFieldDecisions, type CaptureOptions, type EntryDraft } from "@chronoeon/domain";

export interface EditableCapture {
  draft: EntryDraft;
  decisions?: CaptureFieldDecisions;
  touched?: Array<keyof EntryDraft>;
  baseline?: EntryDraft;
}

/** Re-rank on title/date/type changes; only explicit edits own a field. The
 * original time/money form the baseline when newly typed cues are removed. */
export function refineCapture<T extends EditableCapture>(item: T, patch: Partial<EntryDraft>, options: CaptureOptions): T & EditableCapture {
  const touched = [...new Set([...(item.touched ?? []), ...Object.keys(patch) as Array<keyof EntryDraft>])];
  let draft = { ...item.draft, ...patch };
  const baseline = item.baseline ?? item.draft;
  if (!["title", "kind", "date", "calendar", "amount"].some(key => key in patch)) return { ...item, draft, touched, baseline };
  const history = (options.history ?? []).filter(entry => !entry.calendar || entry.calendar === draft.calendar);
  const index = new CaptureDecisionIndex(history);
  const parsed = parseCapture(draft.title, { ...options, settings: { ...options.settings, defaultCalendarID: draft.calendar ?? options.settings.defaultCalendarID }, history, decisionIndex: index });
  const span = (kind: string) => parsed.spans.some(value => value.kind === kind);
  const kind = touched.includes("kind") || !("title" in patch) ? draft.kind
    : parsed.decisions.kind.selected || span("amount") || span("cue") ? parsed.draft.kind : baseline.kind;
  const decisions = index.decide(parsed.draft.title, { kind, availableCategories: new Set(categoryOptionsForKind(kind, options.settings, draft.calendar).map(value => value.value)) });
  const locations = !options.settings.locationAutofill ? [] : inferLocationCandidates(parsed.draft.title, history.filter(entry => entry.kind === kind), draft.date);
  decisions.location = { options: locations.map(value => ({ value: value.value, count: 1, match: value.score })), selected: decisions.location.selected };
  const temporal = span("date") || span("time") || span("duration");
  const amount = touched.includes("amount") ? draft.amount : span("amount") ? parsed.draft.amount : baseline.amount;
  const category = decisions.category.selected ?? inferCategory(parsed.draft.title, draft.title, kind, options.settings, [], options.now, amount, draft.calendar).value;
  const automatic: Partial<EntryDraft> = {
    kind, category, location: span("place") ? parsed.draft.location : decisions.location.selected,
    note: parsed.draft.note ?? baseline.note,
    tags: parsed.draft.tags ?? baseline.tags,
    priority: parsed.draft.priority ?? baseline.priority,
    urgency: parsed.draft.urgency ?? baseline.urgency,
    status: kind === "task" ? parsed.draft.status ?? baseline.status : undefined,
    recurrence: parsed.draft.recurrence ?? baseline.recurrence,
    recurringDays: parsed.draft.recurringDays ?? baseline.recurringDays,
    reminder: parsed.draft.reminder ?? baseline.reminder,
    date: span("date") ? parsed.draft.date : baseline.date,
    start: temporal ? parsed.draft.start : baseline.start,
    end: temporal ? parsed.draft.end : baseline.end,
    endDate: temporal ? (parsed.draft.endDate ? addIsoDays(span("date") ? parsed.draft.date : draft.date, differenceInIsoDays(parsed.draft.endDate, parsed.draft.date)) : undefined) : baseline.endDate,
    allDay: temporal ? parsed.draft.allDay : baseline.allDay,
    amount: kind === "bill" ? amount : undefined,
    currency: span("amount") ? parsed.draft.currency : baseline.currency,
    payment: span("amount") ? parsed.draft.payment : baseline.payment,
  };
  for (const key of touched) delete automatic[key];
  draft = { ...draft, ...automatic };
  return { ...item, draft, decisions, touched, baseline };
}
