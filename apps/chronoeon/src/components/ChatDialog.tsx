import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { entriesInRange, statsPresetRange, type StatsRange } from "@chronoeon/domain";
import type { Entry, EntryKind, Locale } from "../domain/entry";
import type { AiConversation, AiMessageRecord } from "@chronoeon/storage";
import type { AiConversationApi } from "../ai/memoryConversationStore";
import type { AIChatMessage } from "@chronoeon/domain";
import { activeAIProvider, providerIsConfigured, requestAICompletion, type AIProviderPreferences } from "../ai/provider";
import { advisorToolResultForModel, advisorTools, executeAdvisorToolCall, type AdvisorTool, type AdvisorToolResult } from "../ai/advisorAgent";
import { localeTag, t, type MessageKey } from "../i18n";
import { Icon } from "./Icon";
import { renderChatMarkdown } from "./ChatMarkdown";
import { registerModalDismiss } from "./modalLayer";
import { ChatContextPicker, type ChatContextRange } from "./ChatContextPicker";

interface ChatDialogProps {
  locale: Locale;
  entries: Entry[];
  aiPreferences: AIProviderPreferences;
  conversations: AiConversationApi | null;
  refreshVersion?: number;
  onOpenEntry: (entryId: string) => void;
  onOpenSettings: () => void;
  onClose: () => void;
}

const toolMessages: Record<AdvisorTool, MessageKey> = {
  search_entries: "aiToolSearchEntries",
  date_range_entries: "aiToolDateRangeEntries",
  read_recent_entries: "aiToolRecentEntries",
  overdue_tasks: "aiToolOverdueTasks",
  upcoming_tasks: "aiToolUpcomingTasks",
  spending_summary: "aiToolSpendingSummary",
};

function toolDetail(result: AdvisorToolResult, locale: "en" | "zh"): string {
  const details: string[] = [];
  if (result.call.query?.trim()) details.push(t("aiToolTerms", locale).replace("{terms}", result.call.query.trim()));
  if (result.call.range) details.push(t("aiToolRange", locale)
    .replace("{start}", result.call.range.start)
    .replace("{end}", result.call.range.end));
  details.push(t("aiToolResultCount", locale).replace("{count}", String(result.entries.length)));
  return details.join(" · ");
}

export function ChatDialog({ locale, entries, aiPreferences, conversations, refreshVersion = 0, onOpenEntry, onOpenSettings, onClose }: ChatDialogProps) {
  const [list, setList] = useState<AiConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessageRecord[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationQuery, setConversationQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyFailedId, setCopyFailedId] = useState<string | null>(null);
  const [listLoaded, setListLoaded] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [carriedOpen, setCarriedOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [contextQuery, setContextQuery] = useState("");
  const [contextKinds, setContextKinds] = useState<EntryKind[]>([]);
  const [contextRange, setContextRange] = useState<ChatContextRange>("all");
  const [customContextRange, setCustomContextRange] = useState<StatsRange | null>(null);
  const [selectedContextIds, setSelectedContextIds] = useState<string[]>([]);
  const composingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const suggestions = useMemo(() => [
    t("aiSuggestionThisWeek", locale),
    t("aiSuggestionOverdue", locale),
    t("aiSuggestionSpending", locale),
    t("aiSuggestionWellbeing", locale),
  ], [locale]);
  const modelConfigured = providerIsConfigured(aiPreferences);
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
    setListLoaded(false);
    void reloadList().finally(() => setListLoaded(true));
  }, [reloadList, refreshVersion]);
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!conversations || !activeId) return;
    void conversations.listMessages(activeId).then(setMessages);
  }, [activeId, conversations, refreshVersion]);

  useEffect(() => { setAgentTraces([]); }, [activeId]);

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
    if (!busy && activeId && !messages.length) composerRef.current?.focus();
  }, [activeId, busy, messages.length]);

  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  closeRef.current = onClose;
  useEffect(() => registerModalDismiss((event) => {
    if (busyRef.current) return; // a reply is in flight; don't drop the conversation state
    event.preventDefault();
    closeRef.current();
  }), []);

  const startNew = useCallback(async () => {
    if (!conversations) return;
    const config = aiPreferences.backend === "local" ? aiPreferences.local : aiPreferences.remote;
    const conversation = await conversations.createConversation({
      providerKind: config.kind,
      baseUrl: config.baseUrl,
      model: config.model,
    });
    setActiveId(conversation.id);
    setMessages([]);
    setDraft("");
    setError(null);
    await reloadList();
  }, [aiPreferences, conversations, reloadList]);

  useEffect(() => {
    if (!conversations || !listLoaded || activeId || list.length || busy || !modelConfigured) return;
    void startNew();
  }, [activeId, busy, conversations, list.length, listLoaded, modelConfigured, startNew]);

  // Reopening the dialog must not strand the user with a disabled composer:
  // when conversations exist but none is selected, resume the most recent one.
  useEffect(() => {
    if (!conversations || !listLoaded || activeId || !list.length || busy || !modelConfigured) return;
    setActiveId(list[0].id);
  }, [activeId, busy, conversations, list, listLoaded, modelConfigured]);

  const send = useCallback(async (override?: string) => {
    const text = (override ?? draft).trim();
    if (!text || !conversations || !activeId || busy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setDraft("");
    try {
      const history = messages.filter((message) => message.role !== "system");
      const userMessage = await conversations.appendMessage(activeId, { role: "user", content: text });
      const firstUser = !history.some((message) => message.role === "user");
      if (firstUser) {
        await conversations.renameConversation(activeId, text.slice(0, 40));
      }
      const next = [...messages, userMessage];
      setMessages(next);
      const provider = activeAIProvider(aiPreferences);
      // Explicitly selected records stay authoritative and bypass tools. For an
      // open question, the model picks the local function; this app only parses,
      // executes, and returns its read-only tool_calls.
      const useTools = selectedContextEntries.length === 0;
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
          content: useTools
            ? `You are ChronoEon's local calendar advisor. Current local date: ${contextToday}. Answer in ${locale === "zh" ? "Simplified Chinese" : "English"}. When a question depends on user records, call a read-only tool first; multiple focused tool_calls are better than one broad search when topics differ. Use only entries returned by tools unless the user supplies new information. Be concise and practical. Prefer short paragraphs, bullets and bold key facts. If no tool returns matching data, say what is missing.`
            : `You are ChronoEon's local calendar advisor. Answer in ${locale === "zh" ? "Simplified Chinese" : "English"}. Use only the local entries supplied here unless the user gives new information. Be concise and practical. Prefer short paragraphs, bullets and bold key facts. If the answer is not present, say what is missing.\n\nChronoEon entries chosen by the user, most recent first (date | time | kind | status | title | note):\n${recent.join("\n")}`,
        },
        ...next.map((message) => ({ role: message.role as "user" | "assistant", content: message.content })),
      ];
      let promptTokens = 0;
      let completionTokens = 0;
      let reply = await requestAICompletion(
        provider,
        providerMessages,
        undefined,
        controller.signal,
        useTools ? { tools: advisorTools, toolChoice: "auto" } : undefined,
      );
      promptTokens += reply.promptTokens ?? 0;
      completionTokens += reply.completionTokens ?? 0;
      const toolResults: AdvisorToolResult[] = [];
      let toolRounds = 0;
      while (reply.toolCalls?.length && toolRounds < 2) {
        providerMessages.push({ role: "assistant", content: reply.content, tool_calls: reply.toolCalls });
        for (const rawCall of reply.toolCalls) {
          const result = executeAdvisorToolCall(rawCall, entries, contextToday);
          toolResults.push(result);
          providerMessages.push({
            role: "tool",
            content: advisorToolResultForModel(result),
            tool_call_id: rawCall.id,
            name: rawCall.function.name,
          });
        }
        setAgentTraces([...toolResults]);
        reply = await requestAICompletion(provider, providerMessages, undefined, controller.signal, { tools: advisorTools, toolChoice: "auto" });
        promptTokens += reply.promptTokens ?? 0;
        completionTokens += reply.completionTokens ?? 0;
        toolRounds += 1;
      }
      if (useTools && toolResults.length) setAgentTraces(toolResults);
      const assistant = await conversations.appendMessage(activeId, {
        role: "assistant",
        content: reply.content,
        reasoningContent: reply.reasoningContent,
        promptTokens,
        completionTokens,
      });
      setMessages((current) => [...current, assistant]);
      await reloadList();
    } catch (sendError) {
      console.warn("Chat send failed", sendError);
      const message = sendError instanceof Error ? sendError.message : String(sendError);
      if (!controller.signal.aborted) setError(t(/tool.?call|unsupported.*tool/i.test(message) ? "aiToolCallsUnsupported" : "aiRequestFailed", locale));
    } finally {
      setBusy(false);
    }
  }, [activeId, aiPreferences, busy, conversations, contextToday, draft, entries, locale, messages, reloadList, selectedContextEntries]);

  const toggleContextEntry = (id: string) => {
    setSelectedContextIds((current) => current.includes(id)
      ? current.filter((entryId) => entryId !== id)
      : [...current, id]);
  };

  const archive = useCallback(async () => {
    if (!conversations || !activeId) return;
    await conversations.archiveConversation(activeId);
    setActiveId(null);
    setMessages([]);
    await reloadList();
  }, [activeId, conversations, reloadList]);

  const remove = useCallback(async (id: string) => {
    if (!conversations) return;
    await conversations.deleteConversation(id);
    if (activeId === id) {
      setActiveId(null);
      setMessages([]);
    }
    await reloadList();
  }, [activeId, conversations, reloadList]);

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
  const providerConfig = aiPreferences.backend === "local" ? aiPreferences.local : aiPreferences.remote;
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
  const composerDisabled = busy || !activeId || !modelConfigured;
  const sendDisabled = composerDisabled || !draft.trim();

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
      <section className="chat-dialog" role="dialog" aria-modal="true" aria-labelledby="chat-title">
        <header className="chat-header">
          <div className="chat-id">
            <span className="chat-orb" aria-hidden="true"><Icon name="sparkle" size={18} /></span>
            <div>
              <h2 id="chat-title">{t("aiChatTitle", locale)}</h2>
              <p className="chat-model-line">
                <span className="chat-model-chip" title={providerConfig.baseUrl}>{active?.model ?? providerConfig.model ?? t("aiChatNoModel", locale)}</span>
                <span className={`chat-status${modelConfigured ? " is-ready" : ""}`}><i aria-hidden="true" />{t(modelConfigured ? "aiChatReady" : "aiChatNotConfigured", locale)}</span>
              </p>
            </div>
          </div>
          <div className="chat-header-actions">
            <button type="button" className="icon-button" disabled={!modelConfigured || busy} onClick={() => { void startNew(); }} aria-label={t("aiChatNew", locale)} title={t("aiChatNew", locale)}><Icon name="plus" size={16} /></button>
            <button type="button" className="icon-button" onClick={onOpenSettings} aria-label={t("aiChatConfigure", locale)} title={t("aiChatConfigure", locale)}><Icon name="settings" size={16} /></button>
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
            <aside className={railCollapsed ? "chat-rail is-collapsed" : "chat-rail"}>
              {railCollapsed ? (
                <button
                  type="button"
                  className="icon-button chat-rail-expand"
                  onClick={() => setRailCollapsed(false)}
                  aria-label={t("aiChatRailExpand", locale)}
                  aria-expanded={false}
                  title={t("aiChatRailExpand", locale)}
                >
                  <Icon name="chevron-double-right" size={15} />
                </button>
              ) : (
                <>
                  <div className="chat-rail-top">
                    <div className="chat-rail-search">
                      <Icon name="search" size={13} />
                      <input value={conversationQuery} onChange={(event) => setConversationQuery(event.target.value)} placeholder={t("search", locale)} aria-label={t("search", locale)} />
                    </div>
                    <button
                      type="button"
                      className="icon-button subtle"
                      onClick={() => setRailCollapsed(true)}
                      aria-label={t("aiChatRailCollapse", locale)}
                      aria-expanded={true}
                      title={t("aiChatRailCollapse", locale)}
                    >
                      <Icon name="chevron-double-left" size={14} />
                    </button>
                  </div>
                  <div className="chat-rail-list">
                    {filteredConversations.map((conversation) => (
                      <div key={conversation.id} className={conversation.id === activeId ? "chat-conversation is-active" : "chat-conversation"}>
                        <button type="button" className="chat-conversation-open" onClick={() => setActiveId(conversation.id)}>
                          <strong>{conversation.title ?? t("aiChatUntitled", locale)}</strong>
                          <small>{conversation.model ?? t("aiChatNoModel", locale)}</small>
                        </button>
                        <button type="button" className="icon-button subtle" disabled={busy && conversation.id === activeId} onClick={() => { void archiveFor(conversation.id); }} title={t("aiChatArchive", locale)} aria-label={t("aiChatArchive", locale)}><Icon name="folder" size={13} /></button>
                        <button type="button" className="icon-button subtle" disabled={busy && conversation.id === activeId} onClick={() => { void remove(conversation.id); }} title={t("delete", locale)} aria-label={t("delete", locale)}><Icon name="trash" size={13} /></button>
                      </div>
                    ))}
                    {!filteredConversations.length && <p className="chat-empty">{t("aiChatEmpty", locale)}</p>}
                  </div>
                </>
              )}
            </aside>

            <div className="chat-thread">
              <div className="chat-messages" ref={scrollRef}>
                {messages.map((message) => (
                  <div key={message.id} className={`chat-message chat-message--${message.role}`}>
                    <span className="chat-avatar" aria-hidden="true">
                      <Icon name={message.role === "user" ? "day" : "sparkle"} size={13} />
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
                    <span className="chat-avatar" aria-hidden="true"><Icon name="sparkle" size={13} /></span>
                    <div className="chat-bubble">
                      <span className="chat-typing" aria-hidden="true"><i /><i /><i /></span>
                      <p>{t("loading", locale)}</p>
                    </div>
                  </div>
                )}
                {agentTraces.map((trace, index) => <div className="chat-tool-trace" role="status" key={`${trace.call.tool}-${index}`}>
                  <Icon name="book" size={13} />
                  <div>
                    <strong>{t(toolMessages[trace.call.tool], locale)}</strong>
                    <span>{toolDetail(trace, locale)}</span>
                  </div>
                </div>)}
                {!messages.length && !busy && (
                  <div className="chat-welcome">
                    <span className="chat-welcome-orb" aria-hidden="true"><Icon name="sparkle" size={22} /></span>
                    <h3>{t("aiChatTitle", locale)}</h3>
                    <p>{t("aiChatStart", locale)}</p>
                    <div className="chat-suggestions">
                      {suggestions.map((suggestion) => (
                        <button key={suggestion} type="button" disabled={composerDisabled} onClick={() => { setDraft(suggestion); void send(suggestion); }}>{suggestion}</button>
                      ))}
                    </div>
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
                />
              )}
              <div className="chat-composer">
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
                <button
                  type="button"
                  className={contextOpen || selectedContextIds.length ? "chat-context-toggle is-active" : "chat-context-toggle"}
                  onClick={() => setContextOpen((open) => !open)}
                  aria-expanded={contextOpen}
                  aria-label={t("aiChatContext", locale)}
                  title={selectedContextIds.length
                    ? `${t("aiChatContext", locale)} · ${t("aiChatContextSelectedCount", locale).replace("{count}", String(selectedContextIds.length))}`
                    : t("aiChatContext", locale)}
                >
                  <Icon name="book" size={16} />
                  {selectedContextIds.length > 0 && <b>{selectedContextIds.length}</b>}
                </button>
                <textarea
                  ref={composerRef}
                  value={draft}
                  rows={1}
                  onChange={(event) => setDraft(event.target.value)}
                  onCompositionStart={() => { composingRef.current = true; }}
                  onCompositionEnd={() => { composingRef.current = false; }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && !composingRef.current) {
                      event.preventDefault();
                      if (!busy) void send();
                    }
                  }}
                  placeholder={t("aiChatPlaceholder", locale)}
                  disabled={composerDisabled}
                />
                {busy ? (
                  <button type="button" className="chat-send is-stop" onClick={() => { abortRef.current?.abort(); }} title={t("aiChatStop", locale)} aria-label={t("aiChatStop", locale)}>
                    <Icon name="stop" size={15} />
                  </button>
                ) : (
                  <button type="button" className="chat-send" onClick={() => { void send(); }} disabled={sendDisabled} title={t("aiChatSend", locale)} aria-label={t("aiChatSend", locale)}>
                    <Icon name="arrow-right" size={16} />
                  </button>
                )}
              </div>
              <p className="chat-composer-meta">
                <span className="chat-composer-model" title={providerConfig.baseUrl}><Icon name="sparkle" size={11} />{composerModel}</span>
                {tokenTotalsUsed && (
                  <span className="chat-composer-tokens">
                    {t("aiChatTokensUsed", locale)
                      .replace("{prompt}", String(tokenTotals.prompt))
                      .replace("{completion}", String(tokenTotals.completion))}
                  </span>
                )}
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
      setActiveId(null);
      setMessages([]);
    }
    await reloadList();
  }
}
