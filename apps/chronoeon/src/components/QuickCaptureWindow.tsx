import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import {
  CaptureDecisionIndex, categoryOptionsForKind, completeCapture, createDefaultSettings, currencySymbol, draftToEntry, isAssetCapture,
  localizeBuiltinSettings, normalizeChronoEonSettings, parseCapture, resolveEntryColor, splitCaptureItems,
  GEO_LEVEL_DEVICE, GEO_LEVEL_MANUAL, GEO_PRECISE_SCORE,
  type AIChatContentPart, type ChronoEonSettings, type Entry, type EntryDraft, type GeoPlace, type Locale,
} from "@chronoeon/domain";
import type { GeocodeStore, SqliteEntryStore } from "@chronoeon/storage";
import { readNearbyPlace } from "../platform/location";
import { captureHistory, parseAICapture } from "../ai/captureAgent";
import { activeAIProvider, askIsReady, readAIProviderPreferences } from "../ai/provider";
import { attachmentModelImage, pickEntryAttachments, storeAttachmentFile } from "../platform/attachments";
import { isTauri } from "../platform/desktop";
import { readPreferenceValue } from "../platform/preferences";
import { createSqliteStoreSession } from "../platform/sqliteSession";
import { QUICK_WINDOW_HEIGHT, emitQuickManual, emitQuickSaved, hideQuickWindow, dragQuickWindow, quickWindowFocused, resetQuickWindowAnchor, listenQuickOpen, observeQuickWindowFocus, quickWindowSpace, resizeQuickWindow } from "../platform/quickWindow";
import { categoryLabel, t } from "../i18n";
import { CAPTURE_COMPLETION_PATTERN, CAPTURE_LOCATE_TOKEN, captureSyntaxGroups, captureTokenCompletions } from "./captureSyntax";
import { endClockAfter, recurrenceOptions, reminderLabels } from "./entryFieldLabels";
import { FieldSuggestions, locationFieldCandidates } from "./FieldSuggestions";
import { Icon } from "./Icon";
import { CHIP_ICON_SIZE, EntryGlyph } from "./ItemGlyph";
import "../styles/quickCapture.css";

const MAX_PHOTOS = 4;
interface Photo { reference: string; name: string; thumb: string }

function readPreference<T>(key: string, fallback: T): T {
  try {
    const raw = readPreferenceValue(`chronoeon.preference.${key}`);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch { return fallback; }
}

function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Bills and ideas carry one clock time at most; a timed schedule always gets an end. */
function normalizeDraft(draft: EntryDraft, timeScale: number): EntryDraft {
  if (draft.kind !== "task" && draft.kind !== "event") return { ...draft, allDay: !draft.start, end: undefined, endDate: undefined };
  if (draft.allDay || draft.end) return draft;
  const end = endClockAfter(draft.start, timeScale);
  return end ? { ...draft, end } : draft;
}

function draftSummary(draft: EntryDraft, locale: Locale, settings: ChronoEonSettings): string {
  const zh = locale === "zh";
  const parts: string[] = [];
  const time = draft.allDay || !draft.start ? t("allDay", locale) : `${draft.start}${draft.end ? `–${draft.end}` : ""}`;
  parts.push(`${draft.date}${draft.endDate && draft.endDate !== draft.date ? `→${draft.endDate}` : ""} ${time}`);
  parts.push(categoryLabel(draft.category, locale, undefined, settings));
  if (draft.kind === "bill" && typeof draft.amount === "number") {
    const method = settings.calendars.flatMap((calendar) => calendar.paymentMethods).find((candidate) => candidate.id === draft.payment)?.name ?? draft.payment;
    parts.push(`${draft.amount > 0 ? "+" : "−"}${currencySymbol(draft.currency ?? settings.bill.currency, settings)}${Math.abs(draft.amount)}${method ? ` ${method}` : ""}`);
  }
  if (draft.location) parts.push(`@${draft.location}`);
  if (draft.kind === "task" && draft.status && draft.status !== "open") parts.push(t(draft.status === "done" ? "statusDone" : draft.status === "cancelled" ? "statusCancelled" : "statusInProgress", locale));
  if (draft.recurrence && draft.recurrence !== "none") {
    const option = recurrenceOptions.find((candidate) => candidate.value === draft.recurrence);
    if (option) parts.push(`🔁 ${t(option.key, locale)}`);
  }
  if (draft.reminder && draft.reminder !== "none") parts.push(`⏰ ${t(reminderLabels[draft.reminder], locale)}`);
  if (draft.priority) parts.push(`⚑ ${t(draft.priority === "high" ? "priorityHigh" : "priorityLow", locale)}`);
  if (draft.tags?.length) parts.push(draft.tags.map((tag) => `#${tag}`).join(" "));
  const note = (draft.note ?? "").replace(/\s+/g, " ").trim();
  if (note) parts.push(`📝 ${note.length > 40 ? `${note.slice(0, 40)}…` : note}`);
  return parts.join(zh ? " · " : " · ");
}

/**
 * The quick capture window: one input, a live local parse of what is typed,
 * and a save that writes straight into the shared SQLite file. Photos go to the
 * model instead, because only it can read them.
 */
export function QuickCaptureWindow() {
  const locale = readPreference<Locale>("locale", "zh");
  const settings = useMemo(() => localizeBuiltinSettings(normalizeChronoEonSettings(readPreference<ChronoEonSettings>("settings", createDefaultSettings(locale))), locale), [locale]);
  const [store, setStore] = useState<SqliteEntryStore | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [places, setPlaces] = useState<GeoPlace[]>([]);
  const geocodeStore = useRef<GeocodeStore | null>(null);
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState<number | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [drafts, setDrafts] = useState<EntryDraft[]>([]);
  const [parsedFor, setParsedFor] = useState("");
  const [aiDrafts, setAiDrafts] = useState(false);
  const [busy, setBusy] = useState<"" | "parse" | "ai" | "save" | "photo">("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(0);
  const [syntaxOpen, setSyntaxOpen] = useState(false);
  const [above, setAbove] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const dialogBusyRef = useRef(false);
  const busyRef = useRef(false);
  busyRef.current = Boolean(busy);
  const decisionIndex = useRef(new CaptureDecisionIndex());
  const abortRef = useRef<AbortController | null>(null);
  const today = localDateKey();
  const draggingRef = useRef(false);
  const blurTimer = useRef<number | undefined>(undefined);
  const stripTokens = captureSyntaxGroups(locale).flatMap(group => group.items).filter(item => ["/task ", "/bill ", "@"].includes(item.insert));
  const modelReady = askIsReady(readAIProviderPreferences());
  const history = useMemo(() => captureHistory(entries.filter((entry) => !entry.calendar || entry.calendar === settings.defaultCalendarID)), [entries, settings.defaultCalendarID]);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    let active = true;
    void createSqliteStoreSession().then(async (session) => {
      if (!session || !active) return;
      setStore(session.store);
      geocodeStore.current = session.geocodes;
      setEntries(await session.store.list());
      const rows = await session.geocodes.all();
      setPlaces(rows.filter((row) => row.lng !== null && row.lat !== null && ((row.score ?? 0) >= GEO_PRECISE_SCORE || row.level === GEO_LEVEL_DEVICE || row.level === GEO_LEVEL_MANUAL))
        .map((row) => ({ address: row.address, lng: row.lng!, lat: row.lat!, score: row.score, level: row.level })));
    }).catch((reason) => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, [locale]);

  useEffect(() => {
    let dispose = () => {};
    void listenQuickOpen(() => { inputRef.current?.focus(); setSaved(0); }).then((unlisten) => { dispose = unlisten; });
    return () => dispose();
  }, []);
  useEffect(() => {
    let dispose = () => {};
    void observeQuickWindowFocus((focused) => {
      window.clearTimeout(blurTimer.current);
      if (!focused) blurTimer.current = window.setTimeout(() => {
        if (draggingRef.current || dialogBusyRef.current || busyRef.current) return;
        void quickWindowFocused().then(current => { if (!current && !draggingRef.current && !dialogBusyRef.current && !busyRef.current) void hideQuickWindow(); });
      }, 180);
    }).then((unlisten) => { dispose = unlisten; });
    return () => { window.clearTimeout(blurTimer.current); dispose(); };
  }, []);
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Live parse: pure text only. Photos need the model, so the preview waits.
  useEffect(() => {
    if (aiDrafts) return;
    if (photos.length || !text.trim()) { setDrafts([]); setParsedFor(""); return; }
    const timer = window.setTimeout(() => {
      decisionIndex.current.sync(history);
      const parts = splitCaptureItems(text).filter((part) => !isAssetCapture(part));
      setDrafts(parts.map((part) => normalizeDraft(parseCapture(part, { now: new Date(), locale, settings, history, decisionIndex: decisionIndex.current }).draft, settings.timeScale)));
      setParsedFor(text);
    }, 160);
    return () => window.clearTimeout(timer);
  }, [text, photos.length, history, locale, settings, aiDrafts]);

  // The window grows with its content; when the screen below runs out the
  // results flip above the input and the top edge moves up instead.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const height = Math.ceil(root.getBoundingClientRect().height) + 2;
        void quickWindowSpace().then((space) => {
          const needsAbove = height > QUICK_WINDOW_HEIGHT + space.below && space.above > space.below;
          setAbove(needsAbove);
          return resizeQuickWindow(height, needsAbove);
        }).catch(() => undefined);
      });
    });
    observer.observe(root);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, []);

  const completionQuery = CAPTURE_COMPLETION_PATTERN.exec(text.slice(0, cursor ?? text.length))?.[1] ?? "";
  const prefixText = text.slice(0, cursor ?? text.length);
  // `@定位` asks the device: a nearby known place wins, otherwise the system
  // address is offered and remembered for the map.
  const locateToken = CAPTURE_LOCATE_TOKEN.test(completionQuery) && /(?:^|\s)@[^\s]*$/.test(prefixText);
  const [locateCandidates, setLocateCandidates] = useState<{ values: string[]; busy: boolean } | null>(null);
  const placesRef = useRef(places);
  placesRef.current = places;
  useEffect(() => {
    if (!locateToken) { setLocateCandidates(null); return; }
    let active = true;
    setLocateCandidates({ values: [], busy: true });
    void readNearbyPlace(locale, placesRef.current).then((place) => {
      if (!active) return;
      if (place && !place.fromHistory) {
        void geocodeStore.current?.put({ address: place.label, lng: place.longitude, lat: place.latitude, score: 90, level: GEO_LEVEL_DEVICE }).catch(() => undefined);
        setPlaces((current) => [...current, { address: place.label, lng: place.longitude, lat: place.latitude, score: 90, level: GEO_LEVEL_DEVICE }]);
      }
      setLocateCandidates({ values: place?.candidates ?? [], busy: false });
    }).catch(() => { if (active) setLocateCandidates({ values: [], busy: false }); });
    return () => { active = false; };
  }, [locateToken, locale]);
  const completions = useMemo(() => {
    if (locateToken) {
      if (!locateCandidates || locateCandidates.busy) return [{ value: `@${completionQuery}`, label: t("captureLocating", locale) }];
      if (!locateCandidates.values.length) return [{ value: `@${completionQuery}`, label: t("locationUnavailable", locale) }];
      return locateCandidates.values.map((value) => ({ value: `@${/\s/.test(value) ? `"${value}"` : value}`, label: value }));
    }
    return completeCapture(prefixText, {
      categories: [...new Map(categoryOptionsForKind("event", settings).concat(categoryOptionsForKind("task", settings), categoryOptionsForKind("bill", settings), categoryOptionsForKind("idea", settings)).map((value) => [value.value, { value: value.value, label: value.label }])).values()],
      locations: locationFieldCandidates(prefixText.replace(/(?:^|\s)@[^\s]*$/, ""), completionQuery, history, today).map((value) => value.value),
      tags: [...new Set(entries.flatMap((entry) => entry.tags ?? []))],
      ...captureTokenCompletions(locale),
    });
  }, [prefixText, completionQuery, settings, history, entries, today, locale, locateToken, locateCandidates]);

  const updateText = (next: string, caret?: number) => {
    setText(next);
    setAiDrafts(false);
    setError("");
    setSaved(0);
    if (caret !== undefined) {
      setCursor(caret);
      requestAnimationFrame(() => inputRef.current?.setSelectionRange(caret, caret));
    }
    inputRef.current?.focus();
  };
  const insertToken = (value: string) => {
    const node = inputRef.current;
    const start = node?.selectionStart ?? text.length;
    const end = node?.selectionEnd ?? start;
    const before = text.slice(0, start);
    const lead = before && !/\s$/.test(before) ? " " : "";
    updateText(`${before}${lead}${value}${text.slice(end)}`, before.length + lead.length + value.length);
  };
  const chooseCompletion = (value: string) => {
    const caret = inputRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/(?:^|\s)[/@#%&^*~][^\s]*$/, (match) => `${/^\s/.test(match) ? " " : ""}${value} `);
    updateText(before + text.slice(caret), before.length);
  };

  const addPhotos = async (files?: File[]) => {
    if (busy || photos.length >= MAX_PHOTOS) return;
    setBusy("photo"); setError("");
    dialogBusyRef.current = !files;
    try {
      const picked = files
        ? (await Promise.all(files.slice(0, MAX_PHOTOS - photos.length).map((file) => storeAttachmentFile(file)))).flatMap((item) => item ? [item] : [])
        : (await pickEntryAttachments({ settings, entryDate: today })).picked;
      if (picked.length) setPhotos((current) => [...current, ...picked.map((item) => ({ reference: item.reference, name: item.name, thumb: item.displayUrl }))].slice(0, MAX_PHOTOS));
      setAiDrafts(false);
    } catch (reason) {
      console.warn("Could not attach a photo", reason);
      setError(t("chatPhotoFailed", locale));
    } finally {
      dialogBusyRef.current = false;
      setBusy("");
      inputRef.current?.focus();
    }
  };
  const paste = (event: ClipboardEvent<HTMLElement>) => {
    const files = [...(event.clipboardData?.items ?? [])].filter((item) => item.kind === "file" && item.type.startsWith("image/")).map((item) => item.getAsFile()).filter((file): file is File => Boolean(file));
    if (!files.length) return;
    event.preventDefault();
    void addPhotos(files);
  };

  const runModel = async (preliminary?: EntryDraft[]) => {
    const preferences = readAIProviderPreferences();
    const provider = activeAIProvider(preferences);
    if (!provider || !askIsReady(preferences)) { setError(t("aiChatNotConfigured", locale)); return; }
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setBusy("ai"); setError("");
    try {
      const images: AIChatContentPart[] = [];
      for (const photo of photos) {
        const url = await attachmentModelImage(photo.reference);
        if (!url) throw new Error("Photo unavailable");
        images.push({ type: "image_url", image_url: { url } });
      }
      const result = await parseAICapture({ provider, text: text.trim(), images, entries, places, settings, locale, signal: controller.signal, preliminary });
      setDrafts(result.parsed.candidates.map((candidate) => normalizeDraft(candidate.draft, settings.timeScale)));
      setAiDrafts(true);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy("");
    }
  };

  const save = async () => {
    if (!store) { setError(t("quickDesktopOnly", locale)); return; }
    if (!drafts.length) return;
    setBusy("save"); setError("");
    try {
      const references = photos.map((photo) => photo.reference);
      for (const draft of drafts) {
        const withPhotos = references.length ? { ...draft, images: [...(draft.images ?? []), ...references] } : draft;
        await store.create(draftToEntry(withPhotos, "local", resolveEntryColor(draft.category, draft.kind, settings, draft.calendar)));
      }
      const count = drafts.length;
      setSaved(count);
      setText(""); setPhotos([]); setDrafts([]); setParsedFor(""); setAiDrafts(false);
      void emitQuickSaved(count);
      setEntries(await store.list());
      window.setTimeout(() => { setSaved(0); void hideQuickWindow(); }, 900);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy("");
    }
  };

  const send = useCallback(async () => {
    if (busy) return;
    const trimmed = text.trim();
    if (!trimmed && !photos.length) { setError(t("quickNoteEmpty", locale)); return; }
    if (isAssetCapture(trimmed)) { setError(t("quickAssetHint", locale)); return; }
    if (photos.length && !aiDrafts) { await runModel(); return; }
    await save();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, text, photos.length, aiDrafts, drafts, store, settings, locale]);

  const manual = async () => {
    await emitQuickManual(text.trim());
    setText(""); setPhotos([]); setDrafts([]);
    void hideQuickWindow();
  };

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") { event.preventDefault(); abortRef.current?.abort(); void hideQuickWindow(); return; }
    if (event.key === "Enter" && !event.shiftKey && !composingRef.current) { event.preventDefault(); void send(); }
  };

  const draftList = drafts.length > 0 && (
    <section className="quick-results" aria-live="polite">
      <header>
        <strong>{t("quickDrafts", locale).replace("{count}", String(drafts.length))}</strong>
        <div>
          {!aiDrafts && !photos.length && modelReady && (
            <button type="button" className="quick-chip" disabled={Boolean(busy)} onClick={() => void runModel(drafts)} title={t("captureAIOptimize", locale)}>
              <Icon name="sparkle" size={12} />{t("captureAIOptimize", locale)}
            </button>
          )}
          {aiDrafts && <span className="quick-ai-badge"><Icon name="sparkle" size={11} />AI</span>}
        </div>
      </header>
      <ol>
        {drafts.map((draft, index) => (
          <li key={`${index}-${draft.title}`} className={`quick-draft is-${draft.kind}`}>
            <span className="quick-draft-glyph"><EntryGlyph kind={draft.kind} status={draft.status} size={CHIP_ICON_SIZE} /></span>
            <div>
              <strong>{draft.title}</strong>
              <small>{draftSummary(draft, locale, settings)}</small>
            </div>
            <button type="button" className="icon-button subtle" title={t("quickRemove", locale)} aria-label={t("quickRemove", locale)} onClick={() => setDrafts((current) => current.filter((_, position) => position !== index))}><Icon name="close" size={12} /></button>
          </li>
        ))}
      </ol>
    </section>
  );

  return (
    <div ref={rootRef} className={`quick-window${above ? " is-above" : ""}`}>
      <div className="quick-shell" onPaste={paste}>
        {above && draftList}
        <div className="quick-drag-bar" onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault();
          draggingRef.current = true;
          window.clearTimeout(blurTimer.current);
          void dragQuickWindow().catch(reason => setError(String(reason))).finally(() => { draggingRef.current = false; resetQuickWindowAnchor(); });
        }} title={locale === "zh" ? "拖动以移动窗口" : "Drag to move window"}><span className="quick-handle" /></div>
        <div className="quick-strip" role="toolbar" aria-label={t("captureSyntaxTitle", locale)}>
          <button type="button" className={syntaxOpen ? "quick-chip is-active" : "quick-chip"} onClick={() => setSyntaxOpen((open) => !open)} aria-expanded={syntaxOpen} title={t("captureSyntaxTitle", locale)}>
            <Icon name="command" size={12} />
          </button>
          {stripTokens.map(token => <button key={token.insert} type="button" className="quick-chip" onClick={() => insertToken(token.insert)} title={token.label}><code>{token.insert.trim()}</code><span>{token.label}</span></button>)}
          <button type="button" className="quick-chip quick-more" onClick={() => setSyntaxOpen(open => !open)} aria-expanded={syntaxOpen}>{locale === "zh" ? "全部语法" : "All syntax"}<Icon name={syntaxOpen ? "chevron-up" : "chevron-down"} size={11} /></button>
        </div>
        {syntaxOpen && (
          <div className="chat-syntax-panel quick-syntax-panel" role="dialog" aria-label={t("captureSyntaxTitle", locale)}>
            <div className="chat-syntax-groups">
              {captureSyntaxGroups(locale).map((group) => (
                <section key={group.title}>
                  <p>{group.title}</p>
                  <div>{group.items.map((item) => <button key={item.insert} type="button" onClick={() => insertToken(item.insert)}><code>{item.insert.trim()}</code><small>{item.label}</small></button>)}</div>
                </section>
              ))}
            </div>
            <footer><strong>{t("captureSyntaxSplit", locale)}</strong><span>{t("captureSyntaxSplitHint", locale)}</span></footer>
          </div>
        )}
        {photos.length > 0 && (
          <div className="quick-photos">
            {photos.map((photo) => (
              <span key={photo.reference} className="quick-photo">
                <img src={photo.thumb} alt={photo.name} />
                <button type="button" onClick={() => { setPhotos((current) => current.filter((item) => item.reference !== photo.reference)); setAiDrafts(false); }} aria-label={`${t("chatRemovePhoto", locale)}: ${photo.name}`}><Icon name="close" size={9} /></button>
              </span>
            ))}
            <small>{t("quickPhotoHint", locale)}</small>
          </div>
        )}
        <div className="quick-composer">
          <button type="button" className="quick-tool" onClick={() => void addPhotos()} disabled={Boolean(busy) || photos.length >= MAX_PHOTOS} title={t("chatAddPhoto", locale)} aria-label={t("chatAddPhoto", locale)}><Icon name="image" size={15} /></button>
          <textarea ref={inputRef} value={text} rows={1} placeholder={t("quickNotePlaceholder", locale)} disabled={busy === "save"}
            onChange={(event) => { setText(event.target.value); setCursor(event.target.selectionStart); setAiDrafts(false); setError(""); setSaved(0); }}
            onSelect={(event) => setCursor(event.currentTarget.selectionStart)}
            onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={() => { composingRef.current = false; }}
            onKeyDown={keyDown} />
          <FieldSuggestions inputRef={inputRef} locale={locale} suggestions={completions} query={completionQuery} caret onSelect={chooseCompletion} />
          <button type="button" className="quick-tool" onClick={() => void manual()} title={t("quickNoteManualAdd", locale)} aria-label={t("quickNoteManualAdd", locale)}><Icon name="edit" size={15} /></button>
          {busy === "ai" ? (
            <button type="button" className="quick-send is-stop" onClick={() => abortRef.current?.abort()} title={t("aiChatStop", locale)} aria-label={t("aiChatStop", locale)}><Icon name="stop" size={14} /></button>
          ) : (
            <button type="button" className="quick-send" onClick={() => void send()} disabled={Boolean(busy) || (!text.trim() && !photos.length)} title={t(photos.length && !aiDrafts ? "quickNoteParse" : "save", locale)} aria-label={t(photos.length && !aiDrafts ? "quickNoteParse" : "save", locale)}>
              <Icon name={photos.length && !aiDrafts ? "sparkle" : "arrow-right"} size={15} />
            </button>
          )}
        </div>
        <footer className="quick-status">
          {error ? <span className="quick-error" role="alert">{error}</span>
            : saved ? <span className="quick-saved"><Icon name="check" size={12} />{t("quickSaved", locale).replace("{count}", String(saved))}</span>
            : busy === "ai" ? <span>{t("quickParsing", locale)}</span>
            : !store && isTauri() ? <span>{t("loading", locale)}</span>
            : !store ? <span>{t("quickDesktopOnly", locale)}</span>
            : <span>{t("quickWindowHint", locale)}</span>}
          {parsedFor && !aiDrafts && !photos.length && <em>{t("captureSyntaxSplitHint", locale)}</em>}
        </footer>
        {!above && draftList}
      </div>
    </div>
  );
}
