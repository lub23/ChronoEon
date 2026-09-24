import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  ALL_DAY_REMINDERS,
  BUILTIN_CURRENCIES,
  TIMED_REMINDERS,
  categoryOptionsForKind,
  defaultCategoryForKind,
  entriesInRange,
  parseCapture,
  parseClockMinutes,
  splitCaptureItems,
  statsPresetRange,
  validateAIStructuredDraft,
  CaptureDecisionIndex,
  type AIValidationIssue,
  type ChronoEonSettings,
  type EntryDraft,
  type EntryKind,
  type EntryStatus,
  type CaptureFieldDecisions,
  type Recurrence,
  type Reminder,
  type StatsRange,
} from "@chronoeon/domain";
import type { Entry, Locale } from "../domain/entry";
import type { AiConversation, AiConversationMode, AiMessageRecord } from "@chronoeon/storage";
import type { AiConversationApi } from "../ai/memoryConversationStore";
import type { AIChatContentPart, AIChatMessage, AIToolCall, EntryPriority } from "@chronoeon/domain";
import { activeAIProvider, askIsReady, requestAICompletion, type AICompletionResult, type AIProviderPreferences } from "../ai/provider";
import { advisorToolResultForModel, advisorTools, executeAdvisorToolCall, type AdvisorTool, type AdvisorToolResult } from "../ai/advisorAgent";
import { categoryLabel, localeTag, paymentMethodLabel, t, type MessageKey } from "../i18n";
import { Icon } from "./Icon";
import { renderChatMarkdown } from "./ChatMarkdown";
import { registerModalDismiss, useModalDismiss } from "./modalLayer";
import { ChatContextPicker, type ChatContextRange } from "./ChatContextPicker";
import { GlassDatePicker, GlassTimePicker } from "./GlassDateTimePicker";
import { GlassSelect } from "./GlassSelect";
import { AttachmentField } from "./AttachmentField";
import { TagInput } from "./TagInput";
import { endClockAfter, labeledOptions, priorities, recurrenceOptions, reminderLabels, reminderTriggerLabel, weekdayIndexForDate } from "./entryFieldLabels";
import { RecurrenceWeekdays } from "./RecurrenceWeekdays";
import { attachmentModelImage, pickEntryAttachments, releaseAttachment, storeAttachmentFile } from "../platform/attachments";
import { readCurrentPlace } from "../platform/location";
import { askPresets, askPresetToolPlan, type AskPreset, type AskPresetToolPlan } from "../ai/askPresets";
import { TaskStatusGlyph } from "./ItemGlyph";
import { openImagePreview } from "./photoPreviewBus";

interface ChatDialogProps {
  locale: Locale;
  entries: Entry[];
  aiPreferences: AIProviderPreferences;
  conversations: AiConversationApi | null;
  settings: ChronoEonSettings;
  availableTags?: string[];
  initialMode?: ChatMode;
  refreshVersion?: number;
  onOpenEntry: (entryId: string) => void;
  onConfirmCapture: (drafts: EntryDraft[]) => Promise<boolean>;
  onOpenManualCapture: (text: string) => void;
  onOpenSettings: () => void;
  onClose: () => void;
}

/** Narrow chat surfaces slide the history rail over the thread instead of
 *  giving up a permanent column, so the conversation keeps the full width. */
const RAIL_OVERLAY_QUERY = "(max-width: 900px)";

function mediaMatches(query: string): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

/** Each composer keeps its own symbol, so a reply or a rail entry is readable
 *  without relying on the accent colour alone. */
const MODE_ICONS = { capture: "edit", ask: "sparkle" } as const;
const MODE_TITLE_PREFIX = /^(?:随心记|随心问|Capture|Ask)\s+/;

const toolMessages: Record<AdvisorTool, MessageKey> = {
  search_entries: "aiToolSearchEntries",
  overdue_tasks: "aiToolOverdueTasks",
  upcoming_tasks: "aiToolUpcomingTasks",
  spending_summary: "aiToolSpendingSummary",
};

const captureIssueMessages: Record<AIValidationIssue["code"], MessageKey> = {
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

type ChatMode = "capture" | "ask";

interface CaptureDraftItem {
  key: string;
  draft: EntryDraft;
  warnings: AIValidationIssue[];
  decisions?: CaptureFieldDecisions;
}

interface CaptureReview {
  id: string;
  /** The review belongs to the conversation that produced it. */
  conversationId: string;
  source: string;
  drafts: CaptureDraftItem[];
  edited: boolean;
  saved: boolean;
  countdown: number;
}

const CAPTURE_AUTO_SAVE_MS = 10_000;
const CAPTURE_KINDS: EntryKind[] = ["task", "event", "bill", "idea"];
/** Inline photos a chat turn may carry; keeps one request inside provider limits. */
const MAX_CHAT_PHOTOS = 4;
const ASK_PRESET_GROUPS: AskPreset["group"][] = ["schedule", "money", "wellbeing"];
const CAPTURE_STATUSES: EntryStatus[] = ["open", "in-progress", "done", "cancelled"];
const CAPTURE_STATUS_LABELS: Record<EntryStatus, MessageKey> = {
  open: "statusOpen",
  "in-progress": "statusInProgress",
  done: "statusDone",
  cancelled: "statusCancelled",
};
/** Analysis answers are only useful when the reasoning behind them is visible. */
const ANALYSIS_CONTRACT = " When the question asks for an analysis, name the method or metrics you use, show the numbers that support each statement, keep observations separate from interpretation, and close with at most three concrete actions. Use compact bullets instead of wide tables. Give the advice room: a complete answer may run to 1600 Chinese characters or 900 English words, and it should never stop mid-thought. Never report a count that conflicts with your listed items, and never call a pattern continuous unless adjacent returned dates support it. Never invent entries that were not returned.";
// The reply cap is a guard rail, not a target: advice that stops short is worse
// than advice that costs a few more tokens, so every answer keeps a generous
// ceiling regardless of what the endpoint's own default is set to.
const ADVISOR_MIN_MAX_TOKENS = 8192;
const TOOL_GUIDANCE = " search_entries matches several space-separated terms at once (logical OR), so combine every keyword for one topic into a single call instead of issuing one call per term; the records stay in the user's language, so never retry a search with translated terms; once a tool has returned enough data, stop calling tools and answer from what you have.";
const PLANNED_TOOL_GUIDANCE = " The fixed method's local tool plan has already run; use only its tool results and the user's message, and do not request more tools.";

function plannedToolCalls(plan: AskPresetToolPlan): AIToolCall[] {
  return plan.calls.map((call, index) => ({
    id: `${plan.id}-${index}`,
    type: "function" as const,
    function: { name: call.tool, arguments: JSON.stringify(call.arguments) },
  }));
}

function appendAdvisorResults(
  rawCalls: AIToolCall[],
  providerMessages: AIChatMessage[],
  entries: readonly Entry[],
  today: string,
  results: AdvisorToolResult[],
): void {
  for (const rawCall of rawCalls) {
    const result = executeAdvisorToolCall(rawCall, entries, today);
    results.push(result);
    providerMessages.push({
      role: "tool",
      content: advisorToolResultForModel(result),
      tool_call_id: rawCall.id,
      name: rawCall.function.name,
    });
  }
}

function toolDetail(result: AdvisorToolResult, locale: "en" | "zh"): string {
  const details: string[] = [];
  if (result.call.query?.trim()) details.push(t("aiToolTerms", locale).replace("{terms}", result.call.query.trim()));
  if (result.call.range) details.push(t("aiToolRange", locale)
    .replace("{start}", result.call.range.start)
    .replace("{end}", result.call.range.end));
  details.push(t("aiToolResultCount", locale).replace("{count}", String(result.entries.length)));
  return details.join(" · ");
}

function captureSummary(draft: EntryDraft, locale: Locale, settings: ChronoEonSettings): string {
  const date = format(parseISO(draft.date), locale === "zh" ? "M月d日" : "MMM d");
  const time = draft.allDay ? "" : [draft.start, draft.end].filter(Boolean).join("-");
  const categoryOption = categoryOptionsForKind(draft.kind, settings, draft.calendar)
    .find((option) => option.value === draft.category);
  const category = categoryOption?.label ?? categoryLabel(draft.category, locale);
  const details = [
    category,
    `**${draft.title || t("untitled", locale)}**`,
    `[[kind:${draft.kind}]]${t(draft.kind, locale)}[[/kind]]`,
    [date, time].filter(Boolean).join(" "),
    draft.location,
  ].filter(Boolean);
  if (draft.kind === "bill" && draft.amount != null) details.push(`${draft.amount} ${draft.currency ?? settings.bill.currency}`);
  if (draft.payment) details.push(paymentMethodLabel(draft.payment, locale));
  if (draft.reminder && draft.reminder !== "none") details.push(`⏰ ${t(reminderLabels[draft.reminder], locale)}`);
  if (draft.priority) details.push(`⚑ ${labeledOptions(priorities, locale).find((option) => option.value === draft.priority)?.label ?? draft.priority}`);
  if (draft.urgency) details.push(`⚡ ${labeledOptions(priorities, locale).find((option) => option.value === draft.urgency)?.label ?? draft.urgency}`);
  if (draft.recurrence && draft.recurrence !== "none") {
    const recurrence = recurrenceOptions.find((option) => option.value === draft.recurrence);
    if (recurrence) details.push(`🔁 ${t(recurrence.key, locale)}`);
  }
  return details.join(" · ");
}

function captureReviewMarkdown(drafts: EntryDraft[], locale: Locale, settings: ChronoEonSettings): string {
  return drafts.map((draft, index) => `${index + 1}. ${captureSummary(draft, locale, settings)}`).join("\n");
}

function captureHistory(entries: readonly Entry[]) {
  return entries.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    title: entry.title,
    category: entry.category,
    location: entry.location,
    note: entry.note,
    start: entry.start,
    end: entry.end,
    date: entry.date,
  }));
}

function offlineCapture(
  raw: string,
  settings: ChronoEonSettings,
  locale: Locale,
  entries: readonly Entry[],
  decisionIndex: CaptureDecisionIndex,
): CaptureDraftItem[] {
  decisionIndex.sync(captureHistory(entries));
  return splitCaptureItems(raw).map((item, index) => {
    const parsed = parseCapture(item, {
      now: new Date(),
      locale,
      settings,
      history: captureHistory(entries),
      decisionIndex,
    });
    return { key: `offline-${index}`, draft: parsed.draft, warnings: [], decisions: parsed.decisions };
  });
}

/** Only tasks and events span an all-day range; a bill or idea carries one
 *  clock time at most, so a parsed `allDay` must not swallow its HH:MM. A
 *  timed schedule always carries an end, so the card never shows `--:--`. */
function normalizeCapturedDraft(draft: EntryDraft, timeScale: number): EntryDraft {
  if (draft.kind !== "task" && draft.kind !== "event") {
    return { ...draft, allDay: false, end: undefined, endDate: undefined };
  }
  if (draft.allDay || draft.end) return draft;
  const end = endClockAfter(draft.start, timeScale);
  return end ? { ...draft, end } : draft;
}

export function ChatDialog({
  locale, entries, aiPreferences, conversations, settings, availableTags = [], initialMode = "capture",
  refreshVersion = 0, onOpenEntry, onConfirmCapture, onOpenManualCapture, onOpenSettings, onClose,
}: ChatDialogProps) {
  const [list, setList] = useState<AiConversation[]>([]);
  const [messages, setMessages] = useState<AiMessageRecord[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationQuery, setConversationQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyFailedId, setCopyFailedId] = useState<string | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [carriedOpen, setCarriedOpen] = useState(false);
  // Wide surfaces keep the history column beside the thread; a narrow surface
  // slides it over the thread on demand, so it never squeezes the chat.
  const [narrowRail, setNarrowRail] = useState(() => mediaMatches(RAIL_OVERLAY_QUERY));
  const [railOpen, setRailOpen] = useState(() => !mediaMatches(RAIL_OVERLAY_QUERY));
  const [mode, setMode] = useState<ChatMode>(initialMode);
  // Each composer keeps its own open conversation so switching tabs never has
  // to create an empty history record just to have somewhere to type.
  const [activeByMode, setActiveByMode] = useState<Record<ChatMode, string | null>>({ capture: null, ask: null });
  // Reopening the dialog resumes the conversation the mode already had, so a
  // message that is in the database never looks lost. A mode is decided once:
  // "new conversation" must not be undone by the restore.
  const restoredModesRef = useRef<Set<ChatMode>>(new Set());
  const activeId = activeByMode[mode];
  const [contextQuery, setContextQuery] = useState("");
  const [contextKinds, setContextKinds] = useState<EntryKind[]>([]);
  const [contextRange, setContextRange] = useState<ChatContextRange>("all");
  const [customContextRange, setCustomContextRange] = useState<StatsRange | null>(null);
  const [selectedContextIds, setSelectedContextIds] = useState<string[]>([]);
  const composingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const captureSavingRef = useRef(false);
  // The thread mirrors the database, never an optimistic copy of it: every
  // append is followed by a read, and only the newest read may paint. Without
  // the guard a reload that resolves after the append painted the same user
  // message twice.
  const messageLoadRef = useRef(0);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(RAIL_OVERLAY_QUERY);
    const update = () => setNarrowRail(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const suggestions = useMemo(() => (mode === "capture"
    ? [t("captureSuggestionMeeting", locale), t("captureSuggestionExpense", locale), t("captureSuggestionIdea", locale)]
    : []), [locale, mode]);
  // 随心问 and 随心记 can point at different models; only the active composer's
  // own readiness decides whether it talks to one.
  const modelConfigured = mode === "ask" && askIsReady(aiPreferences);
  const contextToday = format(new Date(), "yyyy-MM-dd");
  const contextDateRange = useMemo(() => {
    if (contextRange === "all") return null;
    if (contextRange === "custom") return customContextRange ?? statsPresetRange("1m", contextToday);
    return statsPresetRange(contextRange, contextToday);
  }, [contextRange, contextToday, customContextRange]);
  const contextCandidates = useMemo(() => {
    const scoped = contextDateRange ? entriesInRange(entries, contextDateRange) : entries;
    return [...scoped]
      .sort((left, right) => right.date.localeCompare(left.date))
      .filter((entry) => contextKinds.length === 0 || contextKinds.includes(entry.kind))
      .filter((entry) => {
        const query = contextQuery.trim().toLocaleLowerCase();
        if (!query) return true;
        return [
          entry.title,
          entry.note,
          entry.location,
          entry.category,
          entry.date,
          entry.tags?.join(" "),
        ].filter(Boolean).join(" ").toLocaleLowerCase().includes(query);
      })
      .slice(0, 120);
  }, [contextDateRange, contextKinds, contextQuery, entries]);
  const selectedContextEntries = useMemo(() => selectedContextIds
    .map((id) => entries.find((entry) => entry.id === id))
    .filter((entry): entry is Entry => Boolean(entry))
    .sort((left, right) => right.date.localeCompare(left.date)), [entries, selectedContextIds]);
  const entryIdKey = useMemo(() => entries.map((entry) => entry.id).join("\n"), [entries]);
  useEffect(() => {
    const available = new Set(entryIdKey ? entryIdKey.split("\n") : []);
    setSelectedContextIds((current) => {
      const next = current.filter((id) => available.has(id));
      return next.length === current.length ? current : next;
    });
  }, [entryIdKey]);
  const [agentTraces, setAgentTraces] = useState<AdvisorToolResult[]>([]);
  const [pendingCapture, setPendingCapture] = useState<CaptureReview | null>(null);
  const captureDecisionIndex = useRef<CaptureDecisionIndex | null>(null);
  const [captureSaving, setCaptureSaving] = useState(false);
  const [expandedDrafts, setExpandedDrafts] = useState<string[]>([]);
  const [locating, setLocating] = useState<string | null>(null);
  const [photos, setPhotos] = useState<{ reference: string; name: string; thumb: string }[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const presets = useMemo(() => askPresets(locale), [locale]);

  const selectContextRange = useCallback((range: ChatContextRange) => {
    if (range === "custom" && !customContextRange) {
      setCustomContextRange(statsPresetRange("1m", format(new Date(), "yyyy-MM-dd")));
    }
    setContextRange(range);
  }, [customContextRange]);

  const changeCustomContextRange = useCallback((patch: Partial<StatsRange>) => {
    const current = customContextRange ?? statsPresetRange("1m", format(new Date(), "yyyy-MM-dd"));
    const next = { ...current, ...patch };
    if (next.start > next.end) next.end = next.start;
    if (next.end < next.start) next.start = next.end;
    setCustomContextRange(next);
  }, [customContextRange]);

  const reloadList = useCallback(async () => {
    if (!conversations) return;
    setList(await conversations.listConversations());
  }, [conversations]);

  useEffect(() => {
    void reloadList();
  }, [reloadList, refreshVersion]);

  useEffect(() => {
    if (!conversations || !list.length) return;
    for (const target of ["capture", "ask"] as ChatMode[]) {
      if (restoredModesRef.current.has(target)) continue;
      const recent = list.find((conversation) => conversation.mode === target);
      if (!recent) continue;
      restoredModesRef.current.add(target);
      setActiveByMode((current) => (current[target] ? current : { ...current, [target]: recent.id }));
    }
  }, [conversations, list]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const loadMessages = useCallback(async (conversationId: string) => {
    if (!conversations) return;
    const token = messageLoadRef.current + 1;
    messageLoadRef.current = token;
    const loaded = await conversations.listMessages(conversationId);
    if (messageLoadRef.current === token) setMessages(loaded);
  }, [conversations]);

  useEffect(() => {
    if (!conversations || !activeId) {
      messageLoadRef.current += 1;
      setMessages((current) => (current.length ? [] : current));
      return;
    }
    void loadMessages(activeId);
  }, [activeId, conversations, loadMessages, refreshVersion]);

  /** The review outlives the dialog: reopening it shows the same drafts. */
  const persistCaptureReview = useCallback((review: CaptureReview) => {
    void conversations?.saveCaptureReview({
      conversationId: review.conversationId,
      messageId: review.id,
      source: review.source,
      drafts: review.drafts,
      edited: review.edited,
      saved: review.saved,
      updatedAt: new Date().toISOString(),
    }).catch((error: unknown) => console.warn("Could not store the capture review", error));
  }, [conversations]);

  // A ref, not state: a re-render here would run this effect's own cleanup and
  // cancel the read it just started.
  const reviewLoadedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!conversations || !activeId || reviewLoadedRef.current === activeId) return;
    reviewLoadedRef.current = activeId;
    let current = true;
    void conversations.loadCaptureReview(activeId).then((stored) => {
      if (!current || !stored) return;
      setPendingCapture({
        id: stored.messageId,
        conversationId: stored.conversationId,
        source: stored.source,
        drafts: stored.drafts as CaptureDraftItem[],
        edited: stored.edited,
        saved: stored.saved,
        countdown: CAPTURE_AUTO_SAVE_MS / 1000,
      });
    }).catch((error: unknown) => console.warn("Could not read the capture review", error));
    return () => { current = false; };
  }, [activeId, conversations]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length, busy]);

  useEffect(() => {
    const node = composerRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(150, Math.max(44, node.scrollHeight))}px`;
  }, [draft]);

  useEffect(() => {
    if (!busy && !messages.length) composerRef.current?.focus();
  }, [activeId, busy, messages.length]);

  // Any pointer outside an open helper panel dismisses it: the panel used to
  // sit over its own trigger, which left no way out.
  useEffect(() => {
    if (!contextOpen && !carriedOpen) return;
    const dismiss = (event: Event) => {
      const target = event.target as Element | null;
      if (target?.closest?.(".chat-context-panel, .chat-carried-panel, .chat-tool, .chat-carried-toggle")) return;
      setContextOpen(false);
      setCarriedOpen(false);
    };
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [carriedOpen, contextOpen]);

  // Escape belongs to the open helper panel before it reaches the dialog.
  useModalDismiss((event) => {
    event.preventDefault();
    setContextOpen(false);
    setCarriedOpen(false);
  }, contextOpen || carriedOpen);

  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  closeRef.current = onClose;
  useEffect(() => registerModalDismiss((event) => {
    if (busyRef.current) return; // a reply is in flight; don't drop the conversation state
    event.preventDefault();
    closeRef.current();
  }), []);

  const conversationTitle = useCallback((targetMode: ChatMode) =>
    t(targetMode === "capture" ? "quickNote" : "aiChatTitle", locale), [locale]);

  /** A history record is created when the conversation really starts, not when
   * the user looks at the other tab or clears the composer. */
  const startConversation = useCallback(async (targetMode: ChatMode) => {
    if (!conversations) throw new Error(t("aiChatNeedsDesktop", locale));
    const config = activeAIProvider(aiPreferences.ask);
    const conversation = await conversations.createConversation({
      providerKind: config.kind,
      baseUrl: config.baseUrl,
      model: config.model,
      mode: targetMode,
      title: conversationTitle(targetMode),
    });
    setActiveByMode((current) => ({ ...current, [targetMode]: conversation.id }));
    return conversation.id;
  }, [aiPreferences, conversationTitle, conversations, locale]);

  const startNew = useCallback(() => {
    restoredModesRef.current.add(mode);
    setActiveByMode((current) => ({ ...current, [mode]: null }));
    setMessages([]);
    setDraft("");
    setError(null);
    setAgentTraces([]);
  }, [mode]);

  /** The header switch and the Tab key share one entry point, so both also
   *  dismiss the transient panels that belong to the previous composer. */
  const switchMode = useCallback((next: ChatMode) => {
    setMode(next);
    setContextOpen(false);
    setCarriedOpen(false);
  }, []);

  /** The tab follows the record the user opens, so a reply can never be built
   * from the wrong composer's rules. Transient panels belong to one view, so
   * opening a record always starts them clean. */
  const openConversation = useCallback((conversation: AiConversation) => {
    if (conversation.id !== activeId) {
      setAgentTraces([]);
      setDraft("");
    }
    setActiveByMode((current) => ({ ...current, [conversation.mode]: conversation.id }));
    setMode(conversation.mode);
    // Picking a record is the end of the gesture that opened the drawer.
    if (narrowRail) setRailOpen(false);
  }, [activeId, narrowRail]);

  const send = useCallback(async (override?: string) => {
    const text = (override ?? draft).trim();
    if (!text || !conversations || busy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setDraft("");
    let succeeded = false;
    try {
      const photoRefs = photos.map((photo) => photo.reference);
      const imageParts: AIChatContentPart[] = [];
      for (const reference of photoRefs) {
        const dataUrl = await attachmentModelImage(reference);
        if (dataUrl) imageParts.push({ type: "image_url", image_url: { url: dataUrl } });
      }
      const withPhotos = (items: CaptureDraftItem[]) => items.map((item) => {
        const draft = normalizeCapturedDraft(item.draft, settings.timeScale);
        return {
          ...item,
          draft: photoRefs.length ? { ...draft, images: [...(draft.images ?? []), ...photoRefs] } : draft,
        };
      });
      const conversationId = activeId ?? await startConversation(mode);
      const history = messages.filter((message) => message.role !== "system");
      const firstUser = !history.some((message) => message.role === "user");
      const sentText = photoRefs.length
        ? `${text}\n\n${t("chatPhotoAttached", locale).replace("{count}", String(photoRefs.length))}`
        : text;
      const userMessage = await conversations.appendMessage(conversationId, { role: "user", content: sentText });
      // The mode badge already names the composer, so a record is titled by
      // what the user actually wrote.
      if (firstUser) await conversations.renameConversation(conversationId, text.slice(0, 40));
      const next = [...history, userMessage];
      await loadMessages(conversationId);
      if (mode === "capture") {
        captureDecisionIndex.current ??= new CaptureDecisionIndex();
        const drafts = withPhotos(offlineCapture(text, settings, locale, entries, captureDecisionIndex.current));
        const assistant = await conversations.appendMessage(conversationId, {
            role: "assistant",
            content: `${t("captureOfflineReady", locale)}\n\n${captureReviewMarkdown(drafts.map((item) => item.draft), locale, settings)}`,
        });
        await loadMessages(conversationId);
        const review: CaptureReview = {
          id: assistant.id,
          conversationId,
          source: text,
          drafts,
          edited: false,
          saved: false,
          countdown: CAPTURE_AUTO_SAVE_MS / 1000,
        };
        setPendingCapture(review);
        await reloadList();
        succeeded = true;
        return;
      }
      const provider = activeAIProvider(aiPreferences.ask);
      // Explicitly selected records stay authoritative and bypass tools. For an
      // open question, the model picks the local function; this app only parses,
      // executes, and returns its read-only tool_calls.
      const presetPlan = selectedContextEntries.length === 0
        ? askPresetToolPlan(text, locale, contextToday)
        : null;
      const useTools = selectedContextEntries.length === 0 && !presetPlan;
      const contextEntries = selectedContextEntries;
      setAgentTraces([]);
      const recent = contextEntries.map((entry) => [
          entry.date,
          entry.start || (entry.allDay ? "all-day" : "anytime"),
          entry.kind,
          entry.status,
          entry.title,
          entry.note ? entry.note.replace(/\s+/g, " ").slice(0, 140) : "",
        ].filter(Boolean).join(" | "));
      const providerMessages: AIChatMessage[] = [
        {
          role: "system" as const,
          content: selectedContextEntries.length
            ? `You are ChronoEon's local calendar advisor. Answer in ${locale === "zh" ? "Simplified Chinese" : "English"}. Use only the local entries supplied here unless the user gives new information. Be concise and practical. Prefer short paragraphs, bullets and bold key facts. If the answer is not present, say what is missing.${ANALYSIS_CONTRACT}\n\nChronoEon entries chosen by the user, most recent first (date | time | kind | status | title | note):\n${recent.join("\n")}`
            : `You are ChronoEon's local calendar advisor. Current local date: ${contextToday}. Answer in ${locale === "zh" ? "Simplified Chinese" : "English"}.${presetPlan ? PLANNED_TOOL_GUIDANCE : ` When a question depends on user records, call a read-only tool first; use focused query terms and an explicit range or days; use overdue/upcoming/spending functions only when they are clearly applicable. If a broad search covers the request, do not also call redundant tools.${TOOL_GUIDANCE}`} Use only entries returned by tools unless the user supplies new information. Be concise and practical. Prefer short paragraphs, bullets and bold key facts. If no tool returns matching data, say what is missing.${ANALYSIS_CONTRACT}`,
        },
        ...next.map((message, index) => ({
          role: message.role as "user" | "assistant",
          // Photos ride with the turn that carried them, never with the history.
          content: imageParts.length && index === next.length - 1
            ? [{ type: "text" as const, text: message.content }, ...imageParts]
            : message.content,
        })),
      ];
      let promptTokens = 0;
      let completionTokens = 0;
      const recordUsage = (completion: AICompletionResult) => {
        promptTokens += completion.promptTokens ?? 0;
        completionTokens += completion.completionTokens ?? 0;
      };
      const answerOptions = {
        // 随心问 owns the thinking switch; 随心记 always answers with JSON only.
        disableReasoning: !aiPreferences.ask.thinking,
        maxTokens: Math.max(provider.maxTokens ?? 0, ADVISOR_MIN_MAX_TOKENS),
      };
      const advisorOptions = useTools
        ? { ...answerOptions, tools: advisorTools, toolChoice: "auto" as const }
        : answerOptions;
      const toolResults: AdvisorToolResult[] = [];
      let toolRounds = 0;
      let reply: AICompletionResult;
      if (presetPlan) {
        const rawCalls = plannedToolCalls(presetPlan);
        providerMessages.push({ role: "assistant", content: "", tool_calls: rawCalls });
        appendAdvisorResults(rawCalls, providerMessages, entries, contextToday, toolResults);
        setAgentTraces([...toolResults]);
        reply = await requestAICompletion(provider, providerMessages, undefined, controller.signal, answerOptions);
        recordUsage(reply);
      } else {
        reply = await requestAICompletion(
          provider,
          providerMessages,
          undefined,
          controller.signal,
          advisorOptions,
        );
        recordUsage(reply);
        while (reply.toolCalls?.length && toolRounds < 2) {
          providerMessages.push({ role: "assistant", content: reply.content, tool_calls: reply.toolCalls });
          appendAdvisorResults(reply.toolCalls, providerMessages, entries, contextToday, toolResults);
          setAgentTraces([...toolResults]);
          reply = await requestAICompletion(provider, providerMessages, undefined, controller.signal, advisorOptions);
          recordUsage(reply);
          toolRounds += 1;
        }
      }
      if (reply.toolCalls?.length) {
        providerMessages.push({ role: "assistant", content: reply.content, tool_calls: reply.toolCalls });
        appendAdvisorResults(reply.toolCalls, providerMessages, entries, contextToday, toolResults);
        setAgentTraces([...toolResults]);
        reply = await requestAICompletion(provider, providerMessages, undefined, controller.signal, answerOptions);
        recordUsage(reply);
      }
      if (toolResults.length) setAgentTraces(toolResults);
      await conversations.appendMessage(conversationId, {
        role: "assistant",
        content: reply.content,
        reasoningContent: reply.reasoningContent,
        promptTokens,
        completionTokens,
      });
      await loadMessages(conversationId);
      await reloadList();
    } catch (sendError) {
      console.warn("Chat send failed", sendError);
      const message = sendError instanceof Error ? sendError.message : String(sendError);
      if (!controller.signal.aborted) setError(t(/tool.?call|unsupported.*tool/i.test(message) ? "aiToolCallsUnsupported" : "aiRequestFailed", locale));
    } finally {
      setBusy(false);
      if (succeeded) setPhotos([]);
    }
  }, [activeId, aiPreferences, busy, contextToday, conversationTitle, conversations, draft, entries, locale, messages,
    mode, modelConfigured, photos, reloadList, selectedContextEntries, settings, startConversation]);

  const toggleContextEntry = (id: string) => {
    setSelectedContextIds((current) => current.includes(id)
      ? current.filter((entryId) => entryId !== id)
      : [...current, id]);
  };

  const remove = useCallback(async (id: string) => {
    if (!conversations) return;
    await conversations.deleteConversation(id);
    if (activeId === id) {
      setActiveByMode((current) => ({ ...current, [mode]: null }));
      setMessages([]);
    }
    await reloadList();
  }, [activeId, conversations, mode, reloadList]);

  const saveCaptureReview = useCallback(async (review: CaptureReview) => {
    if (captureSavingRef.current || review.saved) return;
    captureSavingRef.current = true;
    setCaptureSaving(true);
    setError(null);
    try {
      const saved = await onConfirmCapture(review.drafts.map((item) => item.draft));
      if (saved) {
        setPendingCapture((current) => current?.id === review.id ? { ...current, saved: true, countdown: 0 } : current);
      } else {
        setError(t("entrySaveFailed", locale));
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      captureSavingRef.current = false;
      setCaptureSaving(false);
    }
  }, [locale, onConfirmCapture]);

  const pendingInvalid = Boolean(pendingCapture?.drafts.some((item) =>
    validateAIStructuredDraft(item.draft).some((issue) => issue.severity === "error")));
  // A review is shown only in the conversation that produced it: switching to
  // another record keeps it (it comes back), and it is dismissed by hand.
  const activeReview = pendingCapture && pendingCapture.conversationId === activeId ? pendingCapture : null;
  const pendingCaptureRef = useRef<CaptureReview | null>(null);
  pendingCaptureRef.current = pendingCapture;

  // Any change to the drafts (or to their saved flag) is written immediately;
  // the countdown is deliberately excluded, so a ticking review is not a
  // stream of writes.
  const reviewSignature = pendingCapture
    ? `${pendingCapture.conversationId}|${pendingCapture.id}|${pendingCapture.edited}|${pendingCapture.saved}|${JSON.stringify(pendingCapture.drafts)}`
    : "";
  useEffect(() => {
    const review = pendingCaptureRef.current;
    if (review) persistCaptureReview(review);
  }, [persistCaptureReview, reviewSignature]);

  useEffect(() => {
    const review = pendingCaptureRef.current;
    if (mode !== "capture" || captureSaving || !review || review.conversationId !== activeId
      || review.edited || review.saved || pendingInvalid) return;
    const tick = window.setInterval(() => {
      setPendingCapture((current) => current?.id === review.id
        ? { ...current, countdown: Math.max(0, current.countdown - 1) }
        : current);
    }, 1000);
    const timeout = window.setTimeout(() => { void saveCaptureReview(review); }, CAPTURE_AUTO_SAVE_MS);
    return () => { window.clearInterval(tick); window.clearTimeout(timeout); };
  }, [activeId, captureSaving, mode, pendingCapture?.conversationId, pendingCapture?.edited, pendingCapture?.id, pendingCapture?.saved, pendingInvalid, saveCaptureReview]);

  const patchCaptureDraft = (key: string, patch: Partial<EntryDraft>) => {
    setPendingCapture((current) => current ? {
      ...current,
      edited: true,
      countdown: 0,
      drafts: current.drafts.map((item) => item.key === key ? { ...item, draft: { ...item.draft, ...patch } } : item),
    } : current);
  };

  /** Dismissing is the only way the card goes away for good. */
  function dismissCaptureReview(review: CaptureReview) {
    setPendingCapture((current) => (current?.id === review.id ? null : current));
    void conversations?.deleteCaptureReview(review.conversationId)
      .catch((error: unknown) => console.warn("Could not drop the capture review", error));
  }

  /** One parsed item can be dropped without touching the rest of the review. */
  function removeCaptureDraft(review: CaptureReview, key: string) {
    const drafts = review.drafts.filter((item) => item.key !== key);
    if (!drafts.length) {
      dismissCaptureReview(review);
      return;
    }
    const next: CaptureReview = { ...review, drafts, edited: true, countdown: 0 };
    setPendingCapture(next);
    persistCaptureReview(next);
  }

  const toggleDraftDetails = (key: string) => {
    setExpandedDrafts((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  };

  /** Fill a draft's location from the device instead of making the user type it. */
  async function locateDraft(key: string) {
    if (locating) return;
    setLocating(key);
    try {
      const place = await readCurrentPlace(locale);
      if (place) patchCaptureDraft(key, { location: place.label });
      else setError(t("locationUnavailable", locale));
    } finally {
      setLocating(null);
    }
  }

  async function addPhotos() {
    if (photoBusy || photos.length >= MAX_CHAT_PHOTOS) return;
    setPhotoBusy(true);
    setError(null);
    try {
      const { picked, skipped } = await pickEntryAttachments({ settings, entryDate: contextToday });
      if (skipped.length) setError(`${t("chatPhotoFailed", locale)} · ${skipped.join(", ")}`);
      if (picked.length) appendPhotos(picked.map((item) => ({ reference: item.reference, name: item.name, thumb: item.displayUrl })));
    } catch (error) {
      console.warn("Could not attach a photo to the chat", error);
      setError(t("chatPhotoFailed", locale));
    } finally {
      setPhotoBusy(false);
    }
  }

  function appendPhotos(next: { reference: string; name: string; thumb: string }[]) {
    setPhotos((current) => [...current, ...next].slice(0, MAX_CHAT_PHOTOS));
  }

  /** A pasted screenshot goes through the same storage and compression path. */
  async function pastePhotos(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...(event.clipboardData?.items ?? [])]
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (!files.length || photos.length >= MAX_CHAT_PHOTOS) return;
    event.preventDefault();
    setPhotoBusy(true);
    setError(null);
    try {
      const stored = [];
      for (const file of files.slice(0, MAX_CHAT_PHOTOS - photos.length)) {
        const picked = await storeAttachmentFile(file);
        if (picked) stored.push({ reference: picked.reference, name: picked.name, thumb: picked.displayUrl });
      }
      if (stored.length) appendPhotos(stored);
      else setError(t("chatPhotoFailed", locale));
    } finally {
      setPhotoBusy(false);
    }
  }

  /** Methods are queued into the message so the user can add their own words. */
  const queuePreset = (preset: AskPreset) => {
    setDraft((current) => (current.trim() ? `${current.trim()}\n${preset.prompt}` : preset.prompt));
    composerRef.current?.focus();
  };

  function removePhoto(reference: string) {
    releaseAttachment(reference);
    setPhotos((current) => current.filter((photo) => photo.reference !== reference));
  }

  const changeCaptureKind = (item: CaptureDraftItem, kind: EntryKind) => {
    patchCaptureDraft(item.key, {
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

  const copyMessage = useCallback(async (message: AiMessageRecord) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedId(message.id);
      setCopyFailedId(null);
      window.setTimeout(() => setCopiedId((current) => (current === message.id ? null : current)), 1600);
    } catch {
      setCopyFailedId(message.id);
      window.setTimeout(() => setCopyFailedId((current) => (current === message.id ? null : current)), 2400);
    }
  }, []);

  const messageTime = (value: string) => {
    const date = new Date(value);
    return date.toDateString() === new Date().toDateString()
      ? date.toLocaleTimeString(localeTag[locale], { hour: "2-digit", minute: "2-digit" })
      : date.toLocaleString(localeTag[locale], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  const active = list.find((conversation) => conversation.id === activeId) ?? null;
  const providerConfig = activeAIProvider(aiPreferences.ask);
  // Composer status line: which model answers, and how many tokens the
  // conversation has burned so far (summed from the assistant replies).
  const composerModel = active?.model ?? providerConfig.model ?? t("aiChatNoModel", locale);
  const tokenTotals = useMemo(() => messages.reduce(
    (totals, message) => message.role === "assistant"
      ? { prompt: totals.prompt + (message.promptTokens ?? 0), completion: totals.completion + (message.completionTokens ?? 0) }
      : totals,
    { prompt: 0, completion: 0 },
  ), [messages]);
  const tokenTotalsUsed = tokenTotals.prompt > 0 || tokenTotals.completion > 0;
  const filteredConversations = list.filter((conversation) => {
    const query = conversationQuery.trim().toLocaleLowerCase();
    return !query || `${conversation.title ?? ""} ${conversation.model ?? ""}`.toLocaleLowerCase().includes(query);
  });
  // The textarea itself must stay usable while empty; only the send button
  // waits for content. Disabling the field on empty text made the first
  // keystroke impossible.
  const composerDisabled = busy;
  const sendDisabled = composerDisabled || !draft.trim() || (mode === "ask" && !modelConfigured);

  return (
    <div
      className="workspace-chooser-backdrop chat-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget || busy) return;
        // The first backdrop click dismisses an open helper panel; it must not
        // throw away an in-progress conversation underneath it.
        if (carriedOpen) { setCarriedOpen(false); return; }
        if (contextOpen) { setContextOpen(false); return; }
        onClose();
      }}
    >
      <section
        className={`chat-dialog is-${mode}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-title"
        onKeyDown={(event) => {
          // Tab is the composer switch. Only panels with their own keyboard
          // navigation keep the default tab order.
          if (event.key !== "Tab" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
          const target = event.target as Element | null;
          if (target?.closest?.(".glass-select-popup, .glass-picker-popup, .chat-context-panel, .chat-carried-panel")) return;
          if (busy) return;
          event.preventDefault();
          switchMode(mode === "capture" ? "ask" : "capture");
        }}
      >
        <header className="chat-header">
          <div className="chat-id">
            <h2 id="chat-title" className="visually-hidden">{t(mode === "capture" ? "quickNote" : "aiChatTitle", locale)}</h2>
            {/* One fixed slot for the history rail, open or closed. */}
            {conversations && (
              <button
                type="button"
                className="icon-button subtle chat-rail-toggle"
                onClick={() => setRailOpen((open) => !open)}
                aria-expanded={railOpen}
                aria-label={t(railOpen ? "aiChatRailCollapse" : "aiChatRailExpand", locale)}
                title={t(railOpen ? "aiChatRailCollapse" : "aiChatRailExpand", locale)}
              >
                <Icon name={railOpen ? "chevron-double-left" : "chevron-double-right"} size={14} />
              </button>
            )}
            <div className="chat-mode-tabs" role="tablist" aria-label={t("chatModes", locale)} title={t("chatModesHint", locale)}>
              {(["capture", "ask"] as ChatMode[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  data-mode={value}
                  disabled={busy}
                  aria-selected={mode === value}
                  tabIndex={mode === value ? 0 : -1}
                  className={mode === value ? "is-active" : ""}
                  onClick={() => switchMode(value)}
                >
                  <Icon name={MODE_ICONS[value]} size={mode === value ? 16 : 13} />
                  {t(value === "capture" ? "quickNote" : "aiChatTitle", locale)}
                </button>
              ))}
            </div>
          </div>
          <div className="chat-header-actions">
            <button type="button" className="icon-button subtle" disabled={busy} onClick={onClose} aria-label={t("close", locale)}><Icon name="close" size={16} /></button>
          </div>
        </header>

        {!conversations && (
          <div className="chat-preview-issue" role="status">
            <div><strong>{t("aiChatNeedsDesktop", locale)}</strong><p>{t("aiChatStart", locale)}</p></div>
            <button type="button" className="secondary-button" onClick={onOpenSettings}>{t("aiChatConfigure", locale)}</button>
          </div>
        )}

        {conversations && (
          <div className="chat-layout">
            <aside
              className={narrowRail
                ? (railOpen ? "chat-rail is-overlay is-open" : "chat-rail is-collapsed")
                : (railOpen ? "chat-rail" : "chat-rail is-collapsed")}
            >
              {!railOpen ? (
                <div className="chat-rail-actions is-collapsed">
                  <button type="button" className="chat-rail-action" disabled={busy} onClick={startNew} aria-label={t("aiChatNew", locale)} title={t("aiChatNew", locale)}><Icon name="plus" size={14} /></button>
                  <button type="button" className="chat-rail-action" onClick={onOpenSettings} aria-label={t("aiChatConfigure", locale)} title={t("aiChatConfigure", locale)}><Icon name="settings" size={14} /></button>
                </div>
              ) : (
                <>
                  <div className="chat-rail-top">
                    <div className="chat-rail-search">
                      <Icon name="search" size={13} />
                      <input value={conversationQuery} onChange={(event) => setConversationQuery(event.target.value)} placeholder={t("search", locale)} aria-label={t("search", locale)} />
                    </div>
                  </div>
                  <div className="chat-rail-list">
                    {filteredConversations.map((conversation) => (
                      <div key={conversation.id} className={conversation.id === activeId ? "chat-conversation is-active" : "chat-conversation"}>
                        <button type="button" className="chat-conversation-open" onClick={() => openConversation(conversation)}>
                          <strong>
                            <i
                              className={`chat-mode-badge is-${conversation.mode}`}
                              title={t(conversation.mode === "capture" ? "quickNote" : "aiChatTitle", locale)}
                              aria-label={t(conversation.mode === "capture" ? "quickNote" : "aiChatTitle", locale)}
                            >
                              <Icon name={MODE_ICONS[conversation.mode]} size={12} />
                            </i>
                            {conversation.title?.replace(MODE_TITLE_PREFIX, "") || t("aiChatUntitled", locale)}
                          </strong>
                          <small>{messageTime(conversation.updatedAt)}</small>
                        </button>
                        <button type="button" className="icon-button subtle" disabled={busy && conversation.id === activeId} onClick={() => { void archiveFor(conversation.id); }} title={t("aiChatArchive", locale)} aria-label={t("aiChatArchive", locale)}><Icon name="folder" size={13} /></button>
                        <button type="button" className="icon-button subtle" disabled={busy && conversation.id === activeId} onClick={() => { void remove(conversation.id); }} title={t("delete", locale)} aria-label={t("delete", locale)}><Icon name="trash" size={13} /></button>
                      </div>
                    ))}
                    {!filteredConversations.length && <p className="chat-empty">{t("aiChatEmpty", locale)}</p>}
                  </div>
                  <div className="chat-rail-actions">
                    <button type="button" className="chat-rail-action" disabled={busy} onClick={startNew}>
                      <Icon name="plus" size={15} /><span>{t("aiChatNew", locale)}</span>
                    </button>
                    <button type="button" className="chat-rail-action" onClick={onOpenSettings}>
                      <Icon name="settings" size={15} /><span>{t("aiChatConfigure", locale)}</span>
                    </button>
                  </div>
                </>
              )}
            </aside>

            <div className="chat-thread">
              <div className="chat-messages" ref={scrollRef}>
                {messages.map((message) => (
                  <div key={message.id} className={`chat-message chat-message--${message.role}`}>
                    <span className={message.role === "user" ? "chat-avatar is-user" : "chat-avatar is-assistant"} aria-hidden="true">
                      <Icon name={message.role === "user" ? "day" : MODE_ICONS[mode]} size={13} />
                    </span>
                    <div className="chat-bubble">
                      {message.reasoningContent && (
                        <details className="chat-reasoning">
                          <summary>{t("aiChatShowThinking", locale)}</summary>
                          <div>{renderChatMarkdown(message.reasoningContent)}</div>
                        </details>
                      )}
                      <div className="chat-rich">{renderChatMarkdown(message.content)}</div>
                      <footer className="chat-meta">
                        <time>{messageTime(message.createdAt)}</time>
                        {message.role === "assistant" && (
                          <>
                            <button type="button" className="chat-meta-action" onClick={() => { void copyMessage(message); }}>
                              <Icon name={copiedId === message.id ? "check" : "copy"} size={12} />
                              {copiedId === message.id ? t("copied", locale) : t("copy", locale)}
                            </button>
                            {copyFailedId === message.id && <span className="chat-copy-error">{t("aiCopyFailed", locale)}</span>}
                            {message.proposedEntryId && (
                              <button type="button" className="chat-meta-action is-accent" onClick={() => onOpenEntry(message.proposedEntryId!)}>
                                <Icon name="arrow-right" size={12} />{t("aiChatOpenEntry", locale)}
                              </button>
                            )}
                          </>
                        )}
                      </footer>
                    </div>
                  </div>
                ))}
                {busy && (
                  <div className="chat-message chat-message--assistant is-busy" aria-live="polite">
                    <span className="chat-avatar is-assistant" aria-hidden="true"><Icon name={MODE_ICONS[mode]} size={13} /></span>
                    <div className="chat-bubble">
                      <span className="chat-typing" aria-hidden="true"><i /><i /><i /></span>
                      <p>{t("loading", locale)}</p>
                    </div>
                  </div>
                )}
                {agentTraces.map((trace, index) => (
                  <details className="chat-tool-trace" role="status" key={`${trace.call.tool}-${index}`}>
                    <summary>
                      <Icon name="book" size={13} />
                      <span>
                        <strong>{t(toolMessages[trace.call.tool], locale)}</strong>
                        <small>{toolDetail(trace, locale)}</small>
                      </span>
                    </summary>
                    <ul className="chat-tool-items">
                      {trace.entries.slice(0, 20).map((entry) => (
                        <li key={entry.id}>
                          <i style={{ background: entry.color }} aria-hidden="true" />
                          <span>
                            <strong>{entry.title}</strong>
                            <small>{entry.date}{entry.start ? ` · ${entry.start}` : t("allDay", locale)}</small>
                          </span>
                        </li>
                      ))}
                    </ul>
                    {trace.entries.length > 20 && <p className="chat-tool-more">{t("aiToolMoreItems", locale).replace("{count}", String(trace.entries.length - 20))}</p>}
                  </details>
                ))}
                {activeReview && (
                  <section className="chat-capture-review" aria-label={t("captureReview", locale)}>
                    <header>
                      <div>
                        <strong>{activeReview.saved ? t("captureSaved", locale) : t("captureReview", locale)}</strong>
                        <small>
                          {activeReview.saved ? t("captureSavedDetail", locale)
                            : activeReview.edited ? t("captureManualConfirm", locale)
                            : pendingInvalid ? t("captureFixBeforeSave", locale)
                            : t("captureAutoSaveIn", locale).replace("{seconds}", String(activeReview.countdown))}
                        </small>
                      </div>
                      {/* Confirm and dismiss sit side by side as the two icons
                          the eye already reads: ✓ writes, ✕ drops. */}
                      <div className="capture-review-actions">
                        {!activeReview.saved && (
                          <button
                            type="button"
                            className="capture-review-confirm"
                            disabled={captureSaving || pendingInvalid}
                            onClick={() => { void saveCaptureReview(activeReview); }}
                            aria-label={t("captureConfirm", locale)}
                            title={t("captureConfirm", locale)}
                          >
                            <Icon name={captureSaving ? "clock" : "check"} size={15} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="icon-button subtle capture-review-dismiss"
                          onClick={() => dismissCaptureReview(activeReview)}
                          aria-label={t("captureDismiss", locale)}
                          title={t("captureDismiss", locale)}
                        >
                          <Icon name="close" size={14} />
                        </button>
                      </div>
                    </header>
                    {activeReview.drafts.map((item, index) => {
                      const issues = [...item.warnings, ...validateAIStructuredDraft(item.draft)];
                      const categoryOptions = categoryOptionsForKind(item.draft.kind, settings, item.draft.calendar);
                      const schedulable = item.draft.kind === "task" || item.draft.kind === "event";
                      const fieldOptions = item.decisions;
                      const expanded = expandedDrafts.includes(item.key);
                      const reminderHint = reminderTriggerLabel(item.draft, locale);
                      // A range that ends before it starts is called out right
                      // under the end controls, where the eye already is.
                      const startMinutes = parseClockMinutes(item.draft.start);
                      const endMinutes = parseClockMinutes(item.draft.end);
                      const endBeforeStart = !item.draft.allDay && Boolean(
                        (item.draft.endDate && item.draft.endDate < item.draft.date)
                        || ((!item.draft.endDate || item.draft.endDate === item.draft.date)
                          && startMinutes !== null && endMinutes !== null && endMinutes < startMinutes),
                      );
                      return (
                        <div className="capture-review-card" key={item.key}>
                          {/* Symmetric to the item number: one parsed item can be
                              dropped on its own, as long as nothing is written yet. */}
                          {!activeReview.saved && (
                            <button
                              type="button"
                              className="capture-review-remove"
                              onClick={() => removeCaptureDraft(activeReview, item.key)}
                              aria-label={`${t("delete", locale)}: ${item.draft.title || t("untitled", locale)}`}
                              title={t("delete", locale)}
                            >
                              <Icon name="close" size={11} />
                            </button>
                          )}
                          <div className="capture-review-summary">
                            <span className={issues.some((issue) => issue.severity === "error") ? "capture-review-index has-error" : "capture-review-index"} title={issues.some((issue) => issue.severity === "error") ? t("captureFixBeforeSave", locale) : undefined}>{index + 1}</span>
                            {/* The all-day tab rides on the card's top edge beside the
                                item number, so no field gives up width for it. */}
                            {schedulable && (
                              <button
                                type="button"
                                className={item.draft.allDay ? "capture-review-allday is-on" : "capture-review-allday"}
                                aria-pressed={Boolean(item.draft.allDay)}
                                aria-label={t("allDay", locale)}
                                title={t("allDay", locale)}
                                onClick={() => patchCaptureDraft(item.key, {
                                  allDay: !item.draft.allDay,
                                  start: !item.draft.allDay ? undefined : item.draft.start ?? "09:00",
                                  end: !item.draft.allDay
                                    ? undefined
                                    : item.draft.end || endClockAfter(item.draft.start ?? "09:00", settings.timeScale),
                                })}
                              >
                                <span aria-hidden="true">24h</span>
                              </button>
                            )}
                            <input
                              className="capture-review-title-input"
                              value={item.draft.title}
                              placeholder={t("title", locale)}
                              aria-label={t("title", locale)}
                              onChange={(event) => patchCaptureDraft(item.key, { title: event.target.value })}
                            />
                            {/* The task status sits inside the kind control's
                                left edge; both halves stay separate buttons, so
                                a click is never ambiguous. */}
                            <span className={item.draft.kind === "task" ? "capture-review-kind has-status" : "capture-review-kind"}>
                              {item.draft.kind === "task" && (
                                <GlassSelect
                                  className="is-compact"
                                  value={item.draft.status ?? "open"}
                                  ariaLabel={t("statusLabel", locale)}
                                  options={CAPTURE_STATUSES.map((status) => ({
                                    value: status,
                                    label: t(CAPTURE_STATUS_LABELS[status], locale),
                                    mark: <TaskStatusGlyph status={status} size={14} />,
                                  }))}
                                  onChange={(value) => patchCaptureDraft(item.key, { status: value as EntryStatus })}
                                />
                              )}
                              <GlassSelect value={item.draft.kind} ariaLabel={t("type", locale)} options={CAPTURE_KINDS.map((kind) => ({ value: kind, label: t(kind, locale) }))} onChange={(value) => changeCaptureKind(item, value as EntryKind)} />
                            </span>
                            {item.draft.kind !== "idea" && (
                              <span className="capture-review-location-wrap">
                                <input
                                  className="capture-review-location"
                                  value={item.draft.location ?? ""}
                                  placeholder={t("locationPlaceholder", locale)}
                                  aria-label={t("location", locale)}
                                  onChange={(event) => patchCaptureDraft(item.key, { location: event.target.value || undefined })}
                                />
                                {Boolean(item.draft.location) && (
                                  <button
                                    type="button"
                                    className="capture-review-location-clear"
                                    onClick={() => patchCaptureDraft(item.key, { location: undefined })}
                                    aria-label={t("clearLocation", locale)}
                                    title={t("clearLocation", locale)}
                                  >
                                    <Icon name="close" size={11} />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="capture-review-location-pin"
                                  onClick={() => void locateDraft(item.key)}
                                  disabled={locating === item.key}
                                  aria-label={t("useDeviceLocation", locale)}
                                  title={t("useDeviceLocation", locale)}
                                >
                                  <Icon name="map-pin" size={12} />
                                </button>
                              </span>
                            )}
                            <label className="capture-review-category">
                              <GlassSelect value={item.draft.category} ariaLabel={t("category", locale)} options={categoryOptions.map((option) => ({ value: option.value, label: option.label, color: option.color, group: option.group }))} onChange={(value) => patchCaptureDraft(item.key, { category: value })} />
                            </label>
                          </div>

                          {fieldOptions && fieldOptions.location.options.length > 1 && (
                            <div className="capture-field-options" role="group" aria-label={t("captureFieldSuggestions", locale)}>
                              <small>{t("captureFieldSuggestions", locale)}</small>
                              {fieldOptions.location.options.map((option) => (
                                <button
                                  key={option.value}
                                  type="button"
                                  className={item.draft.location === option.value ? "is-active" : ""}
                                  onClick={() => patchCaptureDraft(item.key, { location: option.value })}
                                >
                                  {option.value}
                                </button>
                              ))}
                            </div>
                          )}

                          <div className={item.draft.kind === "bill" ? "capture-review-when is-bill" : "capture-review-when"}>
                            <span className={item.draft.allDay ? "capture-review-cluster is-single" : "capture-review-cluster"}>
                              <GlassDatePicker value={item.draft.date} ariaLabel={t("startDate", locale)} locale={locale} clearable={false} hideIcon onChange={(value) => patchCaptureDraft(item.key, { date: value ?? item.draft.date })} />
                              {!item.draft.allDay && (
                                <GlassTimePicker
                                  value={item.draft.start}
                                  ariaLabel={t("startTime", locale)}
                                  locale={locale}
                                  clearable={false}
                                  hideIcon
                                  onChange={(value) => patchCaptureDraft(item.key, {
                                    start: value,
                                    // An end time is only asked for when the range
                                    // could not be derived from the start.
                                    end: item.draft.end || endClockAfter(value, settings.timeScale),
                                  })}
                                />
                              )}
                            </span>
                            {schedulable ? (
                              <span className={item.draft.allDay ? "capture-review-cluster is-end is-single" : "capture-review-cluster is-end"}>
                                <GlassDatePicker value={item.draft.endDate ?? item.draft.date} min={item.draft.date} ariaLabel={t("endDate", locale)} locale={locale} hideIcon onChange={(value) => patchCaptureDraft(item.key, { endDate: value })} />
                                {/* Never clearable: an empty clock would show
                                    `--:--` where an end is always expected. */}
                                {!item.draft.allDay && (
                                  <GlassTimePicker value={item.draft.end} ariaLabel={t("endTime", locale)} locale={locale} clearable={false} hideIcon onChange={(value) => patchCaptureDraft(item.key, { end: value })} />
                                )}
                                {endBeforeStart && <small className="capture-review-warn" role="alert">{t("aiIssueInvalidEnd", locale)}</small>}
                              </span>
                            ) : item.draft.kind === "bill" ? (
                              /* A bill has no range: amount, currency and method
                                 share one line under the start half, and the
                                 end half stays empty. */
                              <div className="capture-review-bill">
                                <label className="capture-review-amount">
                                  <input type="number" step="0.01" value={item.draft.amount ?? ""} placeholder="0.00" aria-label={t("amount", locale)} onChange={(event) => patchCaptureDraft(item.key, { amount: event.target.value === "" ? undefined : Number(event.target.value) })} />
                                </label>
                                <GlassSelect
                                  value={item.draft.currency ?? settings.bill.currency}
                                  ariaLabel={t("currency", locale)}
                                  options={[
                                    ...Object.entries(BUILTIN_CURRENCIES).map(([code, currency]) => ({ value: code, label: locale === "zh" ? currency.name : code })),
                                    ...Object.keys(settings.bill.customCurrencies).filter((code) => !BUILTIN_CURRENCIES[code]).map((code) => ({ value: code, label: code })),
                                  ]}
                                  onChange={(value) => patchCaptureDraft(item.key, { currency: value })}
                                />
                                <GlassSelect
                                  value={item.draft.payment ?? ""}
                                  ariaLabel={t("payment", locale)}
                                  options={[
                                    { value: "", label: t("paymentNone", locale) },
                                    ...settings.bill.paymentMethods.map((method) => ({ value: method, label: paymentMethodLabel(method, locale) })),
                                  ]}
                                  onChange={(value) => patchCaptureDraft(item.key, { payment: value || undefined })}
                                />
                              </div>
                            ) : null}
                          </div>

                          <button
                            type="button"
                            className={expanded ? "capture-review-more is-open" : "capture-review-more"}
                            onClick={() => toggleDraftDetails(item.key)}
                            aria-expanded={expanded}
                          >
                            <Icon name={expanded ? "chevron-up" : "chevron-down"} size={13} />
                            {t(expanded ? "fewerFields" : "moreFields", locale)}
                          </button>

                          {expanded && (
                            <div className="capture-review-editor">
                              {item.draft.kind !== "idea" && (
                                <>
                                  <div className="field-row--inline">
                                    <label><span>{t("recurrence", locale)}</span>
                                      <GlassSelect value={item.draft.recurrence ?? "none"} ariaLabel={t("recurrence", locale)} options={recurrenceOptions.map((option) => ({ value: option.value, label: t(option.key, locale) }))} onChange={(value) => patchCaptureDraft(item.key, {
                                        recurrence: value as Recurrence,
                                        recurringDays: value === "weekly"
                                          ? (item.draft.recurringDays?.length ? item.draft.recurringDays : [weekdayIndexForDate(item.draft.date)])
                                          : undefined,
                                        recurringEnd: value === "none" ? undefined : item.draft.recurringEnd,
                                      })} />
                                    </label>
                                    <label className="is-wide"><span>{t("reminder", locale)}{reminderHint && <em className="field-hint field-hint--quiet"><Icon name="bell" size={12} /> {reminderHint}</em>}</span>
                                      <GlassSelect value={item.draft.reminder ?? "none"} ariaLabel={t("reminder", locale)} options={(item.draft.allDay ? ALL_DAY_REMINDERS : TIMED_REMINDERS).map((value) => ({ value, label: t(reminderLabels[value], locale) }))} onChange={(value) => patchCaptureDraft(item.key, { reminder: value as Reminder })} />
                                    </label>
                                  </div>
                                  {item.draft.recurrence !== "none" && (
                                    <div className="capture-review-detail-row">
                                      <label><span>{t("repeatUntil", locale)}</span>
                                        <GlassDatePicker
                                          value={item.draft.recurringEnd}
                                          min={item.draft.date}
                                          ariaLabel={t("repeatUntil", locale)}
                                          locale={locale}
                                          placeholder={t("repeatNone", locale)}
                                          hideIcon
                                          onChange={(value) => patchCaptureDraft(item.key, { recurringEnd: value })}
                                        />
                                      </label>
                                      {item.draft.recurrence === "weekly" && (
                                        <RecurrenceWeekdays
                                          locale={locale}
                                          value={item.draft.recurringDays}
                                          onToggle={(day, selected) => patchCaptureDraft(item.key, {
                                            recurringDays: selected
                                              ? [...new Set([...(item.draft.recurringDays ?? []), day])].sort((left, right) => left - right)
                                              : (item.draft.recurringDays ?? []).filter((value) => value !== day),
                                          })}
                                        />
                                      )}
                                    </div>
                                  )}
                                </>
                              )}
                              {/* A three-line note beside the single-line tags. */}
                              <div className="capture-review-pair">
                                <label>
                                  <span>{t("note", locale)}</span>
                                  <textarea rows={3} value={item.draft.note ?? ""} onChange={(event) => patchCaptureDraft(item.key, { note: event.target.value })} />
                                  {fieldOptions && fieldOptions.note.options.length > 1 && (
                                    <div className="capture-field-options capture-field-options--note" role="group" aria-label={t("captureFieldSuggestions", locale)}>
                                      {fieldOptions.note.options.map((option) => (
                                        <button
                                          key={option.value}
                                          type="button"
                                          className={item.draft.note === option.value ? "is-active" : ""}
                                          title={option.value}
                                          onClick={() => patchCaptureDraft(item.key, { note: option.value })}
                                        >
                                          {option.value}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </label>
                                <div className="capture-review-pair-side">
                                  <label><span>{t("tags", locale)}</span><TagInput value={item.draft.tags} available={availableTags} locale={locale} onChange={(tags) => patchCaptureDraft(item.key, { tags })} /></label>
                                  {/* Importance and urgency sit under the tags,
                                      where a narrow phone still fits them. */}
                                  {schedulable && (
                                    <div className="capture-review-stack">
                                      <label><span>{t("priority", locale)}</span>
                                        <GlassSelect
                                          value={item.draft.priority ?? ""}
                                          ariaLabel={t("priority", locale)}
                                          options={[{ value: "", label: t("priorityNormal", locale) }, ...labeledOptions(priorities, locale)]}
                                          onChange={(value) => patchCaptureDraft(item.key, { priority: (value || undefined) as EntryPriority | undefined })}
                                        />
                                      </label>
                                      <label><span>{t("urgency", locale)}</span>
                                        <GlassSelect
                                          value={item.draft.urgency ?? ""}
                                          ariaLabel={t("urgency", locale)}
                                          options={[{ value: "", label: t("priorityNormal", locale) }, ...labeledOptions(priorities, locale)]}
                                          onChange={(value) => patchCaptureDraft(item.key, { urgency: (value || undefined) as EntryPriority | undefined })}
                                        />
                                      </label>
                                    </div>
                                  )}
                                </div>
                              </div>
                              <AttachmentField
                                locale={locale}
                                settings={settings}
                                entryDate={item.draft.date}
                                value={item.draft.images ?? []}
                                onChange={(next) => patchCaptureDraft(item.key, { images: next.length ? next : undefined })}
                              />
                              {issues.length > 0 && <ul className="capture-review-issues">{issues.map((issue, issueIndex) => <li key={`${issue.code}-${issueIndex}`}>{t(captureIssueMessages[issue.code], locale)}</li>)}</ul>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </section>
                )}
                {!messages.length && !busy && (
                  <div className="chat-welcome">
                    <span className="chat-welcome-orb" aria-hidden="true"><Icon name={MODE_ICONS[mode]} size={22} /></span>
                    <h3>{t(mode === "capture" ? "quickNote" : "aiChatTitle", locale)}</h3>
                    <p>{t(mode === "capture" ? "quickNotePlaceholder" : "aiChatStart", locale)}</p>
                    {mode === "capture" ? (
                      <div className="chat-suggestions">
                        {suggestions.map((suggestion) => (
                          <button key={suggestion} type="button" disabled={composerDisabled} onClick={() => { setDraft(suggestion); void send(suggestion); }}>{suggestion}</button>
                        ))}
                      </div>
                    ) : (
                      <section className="chat-presets" aria-label={t("askMethodsTitle", locale)}>
                        <header>
                          <strong>{t("askMethodsTitle", locale)}</strong>
                          <small>{t("askMethodsHint", locale)}</small>
                        </header>
                        {ASK_PRESET_GROUPS.map((group) => (
                          <div className="chat-preset-group" key={group}>
                            <p>{t(group === "schedule" ? "askPresetGroupSchedule" : group === "money" ? "askPresetGroupMoney" : "askPresetGroupWellbeing", locale)}</p>
                            <div className="chat-preset-cards">
                              {presets.filter((preset) => preset.group === group).map((preset) => (
                                <button
                                  key={preset.id}
                                  type="button"
                                  className="chat-preset-card"
                                  disabled={composerDisabled || !modelConfigured}
                                  onClick={() => queuePreset(preset)}
                                >
                                  <strong>{preset.label}</strong>
                                  <small>{preset.hint}</small>
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </section>
                    )}
                  </div>
                )}
              </div>
              {error && <p className="chat-error" role="status">{error}</p>}
              {carriedOpen && (
                <div className="chat-carried-panel" role="dialog" aria-label={t("aiChatContextCarried", locale)}>
                  <header>
                    <strong>{t("aiChatContextCarried", locale)}</strong>
                    {selectedContextEntries.length > 0 && <small>{t("aiChatContextSelectedCount", locale).replace("{count}", String(selectedContextEntries.length))}</small>}
                  </header>
                  {selectedContextEntries.length === 0 ? (
                    <p className="chat-carried-empty">{t("aiChatContextCarriedEmpty", locale)}</p>
                  ) : (
                    <ul>
                      {selectedContextEntries.map((entry) => (
                        <li key={entry.id}>
                          <i style={{ background: entry.color }} aria-hidden="true" />
                          <span>
                            <strong>{entry.title}</strong>
                            <small>{entry.date}{entry.start ? ` · ${entry.start}` : entry.allDay ? ` · ${t("allDay", locale)}` : ""}</small>
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleContextEntry(entry.id)}
                            aria-label={`${t("aiChatRemoveContext", locale)}: ${entry.title}`}
                            title={t("aiChatRemoveContext", locale)}
                          >
                            <Icon name="close" size={12} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <footer>
                    <button type="button" onClick={() => { setCarriedOpen(false); setContextOpen(true); }}>{t("aiChatContextOpenPicker", locale)}</button>
                  </footer>
                </div>
              )}
              {contextOpen && (
                <ChatContextPicker
                  candidates={contextCandidates}
                  query={contextQuery}
                  kinds={contextKinds}
                  range={contextRange}
                  customRange={customContextRange ?? statsPresetRange("1m", contextToday)}
                  selectedIds={selectedContextIds}
                  locale={locale}
                  onQueryChange={setContextQuery}
                  onKindsChange={setContextKinds}
                  onRangeChange={selectContextRange}
                  onCustomRangeChange={changeCustomContextRange}
                  onToggle={toggleContextEntry}
                  onClear={() => setSelectedContextIds([])}
                  onClose={() => setContextOpen(false)}
                />
              )}
              {photos.length > 0 && (
                <div className="chat-photo-strip" aria-label={t("chatAddPhoto", locale)}>
                  {photos.map((photo) => (
                    <span className="chat-photo-thumb" key={photo.reference}>
                      <button
                        type="button"
                        className="chat-photo-open"
                        onClick={() => openImagePreview(photos.map((item) => item.thumb), photos.indexOf(photo))}
                        aria-label={`${t("photoPreview", locale)}: ${photo.name}`}
                        title={t("photoPreview", locale)}
                      >
                        <img src={photo.thumb} alt={photo.name} />
                      </button>
                      <button
                        type="button"
                        className="chat-photo-remove"
                        onClick={() => removePhoto(photo.reference)}
                        aria-label={`${t("chatRemovePhoto", locale)}: ${photo.name}`}
                        title={t("chatRemovePhoto", locale)}
                      >
                        <Icon name="close" size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="chat-composer-tools">
                <button
                  type="button"
                  className={contextOpen || selectedContextIds.length ? "chat-tool is-active" : "chat-tool"}
                  onClick={() => setContextOpen((open) => !open)}
                  aria-expanded={contextOpen}
                  aria-label={t("aiChatContext", locale)}
                  title={selectedContextIds.length
                    ? `${t("aiChatContext", locale)} · ${t("aiChatContextSelectedCount", locale).replace("{count}", String(selectedContextIds.length))}`
                    : t("aiChatContext", locale)}
                >
                  <Icon name="book" size={14} />
                  {selectedContextIds.length > 0 && <b>{selectedContextIds.length}</b>}
                </button>
                <button
                  type="button"
                  className={photoBusy ? "chat-tool is-busy" : "chat-tool"}
                  onClick={() => void addPhotos()}
                  disabled={photoBusy || photos.length >= MAX_CHAT_PHOTOS}
                  aria-label={t("chatAddPhoto", locale)}
                  title={t("chatAddPhoto", locale)}
                >
                  <Icon name="image" size={14} />
                </button>
                {selectedContextEntries.length > 0 && (
                  <button
                    type="button"
                    className="chat-carried-toggle"
                    onClick={() => { setCarriedOpen((open) => !open); setContextOpen(false); }}
                    aria-expanded={carriedOpen}
                    aria-haspopup="dialog"
                    aria-label={t("aiChatContextCarried", locale)}
                    title={selectedContextEntries.map((entry) => entry.title).join(" · ")}
                  >
                    {selectedContextEntries.slice(0, 3).map((entry) => (
                      <i key={entry.id} style={{ background: entry.color }} aria-hidden="true" />
                    ))}
                    {selectedContextEntries.length > 3 && <em>+{selectedContextEntries.length - 3}</em>}
                  </button>
                )}
                {mode === "capture" && photos.length > 0 && <small>{t("chatPhotoParseHint", locale)}</small>}
              </div>
              <div className="chat-composer">
                <textarea
                  ref={composerRef}
                  value={draft}
                  rows={1}
                  onChange={(event) => setDraft(event.target.value)}
                  onPaste={(event) => { void pastePhotos(event); }}
                  onCompositionStart={() => { composingRef.current = true; }}
                  onCompositionEnd={() => { composingRef.current = false; }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && !composingRef.current) {
                      event.preventDefault();
                      if (!busy) void send();
                    }
                  }}
                  placeholder={t(mode === "capture" ? "quickNotePlaceholder" : "aiChatPlaceholder", locale)}
                  disabled={composerDisabled}
                />
                {busy ? (
                  <button type="button" className="chat-send is-stop" onClick={() => { abortRef.current?.abort(); }} title={t("aiChatStop", locale)} aria-label={t("aiChatStop", locale)}>
                    <Icon name="stop" size={15} />
                  </button>
                ) : (
                  <>
                    {mode === "capture" && (
                      <button
                        type="button"
                        className="chat-manual-add"
                        onClick={() => onOpenManualCapture(pendingCapture?.source ?? draft.trim())}
                        title={t("quickNoteManualAdd", locale)}
                        aria-label={t("quickNoteManualAdd", locale)}
                      >
                        <Icon name="edit" size={15} />
                      </button>
                    )}
                    <button type="button" className="chat-send" onClick={() => { void send(); }} disabled={sendDisabled} title={t(mode === "capture" ? "quickNoteParse" : "aiChatSend", locale)} aria-label={t(mode === "capture" ? "quickNoteParse" : "aiChatSend", locale)}>
                      <Icon name="arrow-right" size={16} />
                    </button>
                  </>
                )}
              </div>
              <p className="chat-composer-meta">
                {mode === "capture" ? (
                  <small className="chat-capture-hint">{t("captureMultiItemHint", locale)}</small>
                ) : <>
                  <span className={`chat-status${modelConfigured ? " is-ready" : ""}`}><i aria-hidden="true" />{t(modelConfigured ? "aiChatReady" : "aiChatNotConfigured", locale)}</span>
                  <span className="chat-composer-model" title={providerConfig.baseUrl}><Icon name={MODE_ICONS[mode]} size={11} />{composerModel}</span>
                  {tokenTotalsUsed && (
                    <span className="chat-composer-tokens">
                      <i aria-hidden="true" />
                      {t("aiChatTokensUsed", locale)
                        .replace("{prompt}", String(tokenTotals.prompt))
                        .replace("{completion}", String(tokenTotals.completion))}
                    </span>
                  )}
                </>}
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );

  async function archiveFor(id: string) {
    if (!conversations) return;
    await conversations.archiveConversation(id);
    if (activeId === id) {
      setActiveByMode((current) => ({ ...current, [mode]: null }));
      setMessages([]);
      setAgentTraces([]);
    }
    await reloadList();
  }
}
