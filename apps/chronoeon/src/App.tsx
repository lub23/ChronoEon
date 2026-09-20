import { isMobilePlatform } from "./hooks/useTouchDevice";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { addDays, addMonths, differenceInCalendarDays, format, parseISO } from "date-fns";
import { draftToEntry, entriesForDate, isAppView, resolveEntryColor, type AppView, type DueReminder, type Entry, type EntryDraft, type EntryStatus, type Locale, type ThemeMode } from "./domain/entry";
import { EMPTY_ENTRY_FILTER, entryMatchesFilter, filterActive, type EntryFilter } from "./domain/entryFilter";
import { billCategoryOptions, createDefaultSettings, createEntryId, formatEntryTime, normalizeChronoEonSettings, outstandingTaskSections, scheduleCategoryOptions, timerSessionToDraft, type ChronoEonSettings, type TimerSegment, type TimerSession } from "@chronoeon/domain";
import type { LunarPreference } from "./domain/lunar";
import { entryToDraft, entryWithDraft, entryWithOccurrenceMove, entryWithOccurrenceStatus, sourceEntryId, type EntryEditContext } from "./domain/entryWorkflow";
import { entryMatchesSearch } from "./domain/search";
import { exportEntriesCsv, settingsSyncPayload, importSettingsBundleJson } from "./domain/dataTransfer";
import { useChronoEonStore } from "./hooks/useChronoEonStore";
import { useLiveTimer, type TimerLifecycleEvent } from "./hooks/useLiveTimer";
import { notifyTimer } from "./platform/timerNotification";
import { BackgroundTimingError } from "./platform/background";
import { closeTimerWindow, emitTimerState, listenTimerCommands, openTimerWindow } from "./platform/timerWindow";
import { usePersistentPreference } from "./hooks/usePersistentPreference";
import { useReminders } from "./hooks/useReminders";
import { useSqliteEntries } from "./hooks/useSqliteEntries";
import {
  isTauri,
  setCompactWindow,
  startDesktopDrag,
  toggleMiniWindowVisible,
} from "./platform/desktop";
import { observeMiniWindowGeometry, rememberMiniGeometry } from "./platform/miniWindow";
import { saveTextDocument } from "./platform/fileTransfer";
import {
  DEFAULT_CAPTURE_SHORTCUT,
  DEFAULT_MINI_SHORTCUT,
  registerCaptureShortcut,
  registerMiniShortcut,
  unregisterCaptureShortcut,
  unregisterMiniShortcut,
} from "./platform/globalShortcut";
import { focusAppWindow, showSystemNotification } from "./platform/notifications";
import { createSqliteStoreSession, storageBootErrorMessage } from "./platform/sqliteSession";
import { isStorageError, type DeletedEntrySummary, type SqliteEntryStore, type SyncStore, type TimerStore } from "@chronoeon/storage";
import { useSyncService } from "./sync/useSyncService";
import { DEFAULT_SYNC_CONFIG, type SyncConfig } from "./sync/types";
import { calendarDisplayName, categoryLabel, t } from "./i18n";
import { AgendaView } from "./components/AgendaView";
import type { AgendaFilter } from "./domain/agendaTimeline";
import { Brand } from "./components/Brand";
import { AmbientParticles } from "./components/AmbientParticles";
import { EntryComposer } from "./components/EntryComposer";
import { Icon } from "./components/Icon";
import { IdeasView } from "./components/IdeasView";
import { StatsView } from "./components/StatsView";
import { MonthView } from "./components/MonthView";
import { EntryContextMenu, type EntryMenuTarget } from "./components/EntryContextMenu";
import { TimerPill, TimerWidget } from "./components/TimerWidget";
import { DayView } from "./components/DayView";
import { QuickNoteDialog } from "./components/QuickNoteDialog";
import { SmartCaptureDialog } from "./components/SmartCaptureDialog";
import { TaskSummaryPopover } from "./components/TaskSummaryList";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { highlightedRange } from "./components/TopBar";
import { TreeCanopy } from "./components/TreeCanopy";
import { GlassDatePicker } from "./components/GlassDateTimePicker";
import { ViewDock } from "./components/ViewDock";
import { WindowControls, WindowResizeHandles } from "./components/WindowControls";
import { ChatDialog } from "./components/ChatDialog";
import { FilterPanel } from "./components/FilterPanel";
import { SettingsDialog, type AccentTheme, type AppPreferences, type SettingsSection } from "./components/SettingsDialog";
import { useConfirmDialog } from "./components/ConfirmDialog";
import { ReminderDialog } from "./components/ReminderDialog";
import { ImagePreview } from "./components/ImagePreview";
import { subscribeImagePreview } from "./components/photoPreviewBus";
import { MotionPresence } from "./components/MotionPresence";
import { useVisualViewport } from "./hooks/useVisualViewport";
import { navigationPageKey, useSwipeNavigation } from "./hooks/useSwipeNavigation";
import { clearSmartCaptureRecovery, readSmartCaptureRecovery, writeSmartCaptureRecovery, type SmartCaptureRecoveryState } from "./ai/draftRecovery";
import { createMemoryConversationStore, type AiConversationApi } from "./ai/memoryConversationStore";
import {
  activeAIProvider,
  providerIsConfigured,
  warmUpAIProvider,
  fetchAIModels,
  hasLocalAIKey as hasStoredLocalAIKey,
  hasRemoteAIKey as hasStoredRemoteAIKey,
  normalizeAIProviderPreferences,
  readAIProviderPreferences,
  requestAICompletion,
  saveLocalAIKey as storeLocalAIKey,
  clearLocalAIKey as clearStoredLocalAIKey,
  saveRemoteAIKey as storeRemoteAIKey,
  clearRemoteAIKey as clearStoredRemoteAIKey,
  writeAIProviderPreferences,
  type AIProviderPreferences,
} from "./ai/provider";

interface ToastState {
  message: string;
  tone?: "normal" | "warning";
  /** Optional follow-up, e.g. undoing a delete. */
  action?: { label: string; run: () => void };
}

const CSV_FILE_FILTERS = [{ name: "CSV", extensions: ["csv", "txt"] }];
type CalendarView = Extract<AppView, "day" | "week" | "month">;

function isCalendarView(view: AppView): view is CalendarView {
  return view === "day" || view === "week" || view === "month";
}

function mediaMatches(query: string): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}


function App() {
  useVisualViewport();
  const [locale, setLocale] = usePersistentPreference<Locale>("locale", "zh");
  const [theme, setTheme] = usePersistentPreference<ThemeMode>("theme", "light");
  const [settingsPreference, setSettingsPreference] = usePersistentPreference<ChronoEonSettings>("settings", createDefaultSettings(locale));
  const settings = useMemo(() => normalizeChronoEonSettings(settingsPreference), [settingsPreference]);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const demoStore = useChronoEonStore(settings, !isTauri());
  const [sqliteStore, setSqliteStore] = useState<SqliteEntryStore | null>(null);
  const [syncJournal, setSyncJournal] = useState<SyncStore | null>(null);
  const [chatSyncVersion, setChatSyncVersion] = useState(0);
  const [timerStore, setTimerStore] = useState<TimerStore | null>(null);
  // Tauri persists conversations in SQLite; the browser demo keeps them in
  // memory so the chat surface is still exercisable outside the desktop shell.
  const [conversationStore, setConversationStore] = useState<AiConversationApi | null>(() => (isTauri() ? null : createMemoryConversationStore()));
  const sqliteEntries = useSqliteEntries(sqliteStore);
  const sqliteStoreRef = useRef<SqliteEntryStore | null>(null);
  sqliteStoreRef.current = sqliteStore;
  // SQLite is the only data path on Tauri. Before the store boots the app
  // renders empty (never demo data — a fast edit must not land in a demo
  // cache); the browser demo falls back to its localStorage demo data.
  const entries = sqliteStore ? sqliteEntries.entries : (isTauri() ? [] : demoStore.entries);
  const [sqliteBootFailed, setSqliteBootFailed] = useState(false);
  const writable = !isTauri() || !sqliteBootFailed;
  // A fresh session starts filtered to the default calendar. With a single
  // calendar the empty set already means "everything", so nothing is stored.
  const [entryFilter, setEntryFilter] = useState<EntryFilter>(() => ({
    ...EMPTY_ENTRY_FILTER,
    calendarIds: settings.calendars.length > 1 ? [settings.defaultCalendarID] : [],
  }));
  const [filter, setFilter] = useState<AgendaFilter>([]);
  const filteredEntries = useMemo(
    () => entries.filter((entry) => entryMatchesFilter(entry, entryFilter) && (!filter.length || filter.includes(entry.kind))),
    [entries, entryFilter, filter],
  );
  // Filter chips always show catalog names. A value that only survives in
  // stored rows is appended verbatim so it can still be filtered or cleared.
  const scheduleCategories = useMemo(
    () => scheduleCategoryOptions(settings, entries.flatMap((entry) => entry.kind !== "bill" && entry.category ? [entry.category] : [])),
    [entries, settings],
  );
  const billCategories = useMemo(
    () => billCategoryOptions(settings, entries.flatMap((entry) => entry.kind === "bill" && entry.category ? [entry.category] : [])),
    [entries, settings],
  );
  const calendars = useMemo(
    () => settings.calendars.map((item) => ({ id: item.id, name: calendarDisplayName(item.name, locale) })),
    [locale, settings],
  );
  const [activeViewPreference, setActiveView] = usePersistentPreference<AppView>("view", "agenda");
  const activeView = isAppView(activeViewPreference) ? activeViewPreference : "agenda";
  const [calendarViewPreference, setCalendarView] = usePersistentPreference<AppView>("calendarView", "day");
  const calendarView = calendarViewPreference === "week" ? "week" : "day";
  const [dayCount, setDayCount] = usePersistentPreference<number>("dayCount", 1);
  const [compact, setCompact] = usePersistentPreference<boolean>("compact", new URLSearchParams(window.location.search).get("compact") === "1");
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterAnchor, setFilterAnchor] = useState({ top: 20, bottom: 54, right: 390 });
  const [focusFilterSearch, setFocusFilterSearch] = useState(false);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const showFilter = useCallback((focusSearch = false) => {
    const rect = filterTriggerRef.current?.getBoundingClientRect();
    if (rect) setFilterAnchor({ top: rect.top, bottom: rect.bottom, right: rect.right });
    setFocusFilterSearch(focusSearch);
    setFilterOpen(true);
  }, []);
  const closeFilter = useCallback(() => {
    setFilterOpen(false);
    filterTriggerRef.current?.focus({ preventScroll: true });
  }, []);
  const searchedEntries = useMemo(
    () => filteredEntries.filter((entry) => entryMatchesSearch(entry, search, locale)),
    [filteredEntries, locale, search],
  );
  const [miniDayCountPref, setMiniDayCount] = usePersistentPreference<number>("miniDayCount", 1);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const [editingSourceEntry, setEditingSourceEntry] = useState<Entry | null>(null);
  const [composerSeed, setComposerSeed] = useState<Partial<EntryDraft> | undefined>(undefined);
  const [smartCaptureRecovery, setSmartCaptureRecovery] = useState<SmartCaptureRecoveryState | null>(() => readSmartCaptureRecovery());
  const [smartCaptureRaw, setSmartCaptureRaw] = useState<string | null>(() => readSmartCaptureRecovery()?.raw ?? null);
  const [quickNoteOpen, setQuickNoteOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsSection>("general");
  const [reminderNotice, setReminderNotice] = useState<DueReminder[] | null>(null);
  const [imagePreview, setImagePreview] = useState<{ items: string[]; index: number } | null>(null);
  const [aiPreferences, setAIPreferencesState] = useState<AIProviderPreferences>(readAIProviderPreferences);
  const [localKeyStored, setLocalKeyStored] = useState(false);
  const [remoteKeyStored, setRemoteKeyStored] = useState(false);
  const [transferBusy, setTransferBusy] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [deletedEntries, setDeletedEntries] = useState<DeletedEntrySummary[]>([]);
  const [recycleBusy, setRecycleBusy] = useState("");
  const [lunar, setLunar] = usePersistentPreference<LunarPreference>("lunar", "auto");
  const [dayPhotos, setDayPhotos] = usePersistentPreference<boolean>("dayPhotos", true);
  const [accentTheme, setAccentTheme] = usePersistentPreference<AccentTheme>("accentTheme", "terracotta");
  const [lowEndMode, setLowEndMode] = usePersistentPreference<boolean>("lowEndMode", false);
  const [syncConfig, setSyncConfig] = usePersistentPreference<SyncConfig>("syncConfig", DEFAULT_SYNC_CONFIG);
  const [remindersEnabled, setRemindersEnabled] = usePersistentPreference<boolean>("remindersEnabled", true);
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistentPreference<boolean>("sidebarCollapsed", false);
  const [mobileViewport, setMobileViewport] = useState(() => mediaMatches("(max-width: 820px)"));
  const [captureShortcut, setCaptureShortcut] = usePersistentPreference<string>("captureShortcut", DEFAULT_CAPTURE_SHORTCUT);
  const [captureShortcutEnabled, setCaptureShortcutEnabled] = usePersistentPreference<boolean>("captureShortcutEnabled", true);
  const [shortcutStatus, setShortcutStatus] = useState<"registered" | "conflict" | "unsupported" | "off">("off");
  const [miniShortcut, setMiniShortcut] = usePersistentPreference<string>("miniShortcut", DEFAULT_MINI_SHORTCUT);
  const [miniShortcutEnabled, setMiniShortcutEnabled] = usePersistentPreference<boolean>("miniShortcutEnabled", true);
  const [miniShortcutStatus, setMiniShortcutStatus] = useState<"registered" | "conflict" | "unsupported" | "off">("off");
  const [timerOpen, setTimerOpen] = useState(false);
  const [compactJumpOpen, setCompactJumpOpen] = useState(false);
  const [compactJumpAnchor, setCompactJumpAnchor] = useState({ left: 70, top: 60 });
  const compactJumpTriggerRef = useRef<HTMLButtonElement>(null);
  const compactJumpPopRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [entryMenu, setEntryMenu] = useState<EntryMenuTarget | null>(null);
  // Writes are queued, never dropped: a second save arriving while the first
  // is on disk waits its turn instead of silently vanishing.
  const writeQueue = useRef<Promise<unknown>>(Promise.resolve());
  const writeDepth = useRef(0);
  // Queued jobs must read the latest state at run time, not the render that
  // queued them, or the compare-and-swap revision goes stale mid-queue.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const sqliteEntriesRef = useRef(sqliteEntries);
  sqliteEntriesRef.current = sqliteEntries;
  // A per-entry guard so a double-click cannot queue a second write that
  // would flip the first one back and fail the compare-and-swap.
  const busyEntryIds = useRef(new Set<string>());
  const compactNativeInitialized = useRef(false);

  const safeMiniDayCount = Math.min(3, Math.max(1, Math.round(miniDayCountPref) || 1));

  // Day/week share the range button. Month never replaces that choice.
  useEffect(() => {
    if ((activeView === "day" || activeView === "week") && activeView !== calendarView) setCalendarView(activeView);
  }, [activeView, calendarView, setCalendarView]);

  const { confirm, dialog: confirmDialog } = useConfirmDialog(locale);
  // A stored preference can arrive out of range (an older build, a hand-edited
  // profile); clamp once here rather than in every consumer.
  const safeDayCount = Math.min(6, Math.max(1, Math.round(dayCount) || 1));
  // Same guard for the Day-view body: an unknown stored value must not blank
  // the view, and the timeline layout only exists at 1-3 columns.
  const selectedKey = format(selectedDate, "yyyy-MM-dd");
  const todayKey = format(new Date(), "yyyy-MM-dd");
  const completedSinceKey = format(addDays(parseISO(todayKey), -30), "yyyy-MM-dd");
  const completedTasks = useMemo(
    () => searchedEntries
      .filter((entry) => entry.kind === "task" && entry.status === "done" && entry.date >= completedSinceKey)
      .sort((left, right) => right.date.localeCompare(left.date) || left.title.localeCompare(right.title)),
    [completedSinceKey, searchedEntries],
  );
  const outstanding = useMemo(() => outstandingTaskSections(searchedEntries, todayKey), [searchedEntries, todayKey]);
  const overdueTasks = outstanding.overdue;
  const upcomingTasks = outstanding.upcoming;

  const toastTimer = useRef<number | undefined>(undefined);
  const notify = useCallback((message: string, tone: ToastState["tone"] = "normal", action?: ToastState["action"]) => {
    if (toastTimer.current !== undefined) window.clearTimeout(toastTimer.current);
    setToast({ message, tone, action });
    if (tone === "warning" && !action) return;
    toastTimer.current = window.setTimeout(() => setToast(null), action ? 6500 : 3600);
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimer.current !== undefined) window.clearTimeout(toastTimer.current);
    setToast(null);
  }, []);

  useEffect(() => () => { if (toastTimer.current !== undefined) window.clearTimeout(toastTimer.current); }, []);
  useEffect(() => {
    const handler = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, []);

  const navigation = useSwipeNavigation({
    enabled: mobileViewport && !compact,
    activeView,
    selectedDate,
    onDateChange: setSelectedDate,
    menuOpen: mobileMenuOpen,
    onViewChange: commitView,
    onMenuChange: setMobileMenuOpen,
  });
  const selectView = navigation.selectView;

  const updateSettings = useCallback((next: ChronoEonSettings) => {
    setSettingsPreference(normalizeChronoEonSettings(next));
  }, [setSettingsPreference]);

  const changeLocale = useCallback((next: Locale) => {
    setLocale(next);
    updateSettings({ ...settings, language: next });
  }, [setLocale, settings, updateSettings]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.accent = accentTheme;
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [accentTheme, locale, theme]);

  useEffect(() => {
    writeAIProviderPreferences(aiPreferences);
  }, [aiPreferences]);

  const warmCaptureProvider = useCallback(() => {
    if (providerIsConfigured(aiPreferences)) void warmUpAIProvider(activeAIProvider(aiPreferences));
  }, [aiPreferences]);
  useEffect(() => { warmCaptureProvider(); }, [warmCaptureProvider]);

  useEffect(() => {
    let disposed = false;
    void hasStoredLocalAIKey().then((stored) => { if (!disposed) setLocalKeyStored(stored); }).catch(() => { if (!disposed) setLocalKeyStored(false); });
    void hasStoredRemoteAIKey().then((stored) => { if (!disposed) setRemoteKeyStored(stored); }).catch(() => { if (!disposed) setRemoteKeyStored(false); });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    // Snap to today when entering the mini window, then leave navigation alone
    // so the compact header's arrows actually work.
    if (compact) setSelectedDate((current) => (format(current, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd") ? current : new Date()));
    const initialized = compactNativeInitialized.current;
    if (!initialized && !compact) {
      compactNativeInitialized.current = true;
      return;
    }
    compactNativeInitialized.current = true;
    // A URL/profile can boot straight into mini mode. That initial shape is not
    // the user's normal window, so only later transitions sample the original.
    void setCompactWindow(compact, { captureNormal: initialized }).catch((error) => {
      console.warn("Could not update native mini window", error);
    });
  }, [compact]);

  useEffect(() => {
    if (!compactJumpOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest(".glass-picker-popup")) return;
      if (compactJumpTriggerRef.current?.contains(target) || compactJumpPopRef.current?.contains(target)) return;
      setCompactJumpOpen(false);
    };
    const close = () => setCompactJumpOpen(false);
    document.addEventListener("mousedown", closeOnOutsideClick);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      window.removeEventListener("resize", close);
    };
  }, [compactJumpOpen]);

  // While the mini window is active, remember its geometry per display so it
  // reopens where the user left it (size, position and monitor-specific shape).
  useEffect(() => {
    if (!compact) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void observeMiniWindowGeometry((geometry) => {
      if (!disposed) void rememberMiniGeometry(geometry);
    }).then((unsubscribe) => {
      if (disposed) unsubscribe();
      else cleanup = unsubscribe;
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [compact]);

  /** Reuse the booting/ready session for early local writes. */
  const ensureSqliteStore = useCallback(async (): Promise<SqliteEntryStore> => {
    if (sqliteStoreRef.current) return sqliteStoreRef.current;
    const session = await createSqliteStoreSession({});
    if (!session) throw new Error("SQLite storage is unavailable");
    setSqliteStore(session.store);
    setSyncJournal(session.sync);
    setTimerStore(session.timers);
    setConversationStore(session.conversations);
    setSqliteBootFailed(false);
    return session.store;
  }, []);

  const refreshDeletedEntries = useCallback(async () => {
    const store = sqliteStoreRef.current;
    if (!store) {
      setDeletedEntries([]);
      return;
    }
    try {
      setDeletedEntries(await store.deletedEntries());
    } catch (error) {
      console.warn("Could not read the recycle bin", error);
    }
  }, []);

  useEffect(() => {
    void refreshDeletedEntries();
  }, [refreshDeletedEntries, sqliteStore]);

  // Boot the SQLite store — the app's only data path on Tauri. The browser demo
  // has no store; a failed Tauri boot blocks writes and shows the bilingual
  // storage error rather than silently falling back to demo data.
  useEffect(() => {
    if (!isTauri()) return;
    void ensureSqliteStore().catch((error) => {
      console.warn("SQLite storage failed to boot:", error);
      setSqliteBootFailed(true);
      if (isStorageError(error)) {
        const message = storageBootErrorMessage(error.code, settingsRef.current.language);
        if (message) notify(message, "warning");
      } else {
        notify(t("entrySaveFailed", settingsRef.current.language), "warning");
      }
    });
  }, [ensureSqliteStore, notify]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 820px)");
    const update = (event: MediaQueryListEvent) => setMobileViewport(event.matches);
    setMobileViewport(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const syncSettings = useMemo(() => settingsSyncPayload(settings, {
    theme, accentTheme, dayPhotos, lunar, remindersEnabled, captureShortcut,
    captureShortcutEnabled, miniShortcut, miniShortcutEnabled, lowEndMode,
  }), [settings, theme, accentTheme, dayPhotos, lunar, remindersEnabled, captureShortcut,
    captureShortcutEnabled, miniShortcut, miniShortcutEnabled, lowEndMode]);
  const syncService = useSyncService(syncJournal, syncConfig, syncSettings, {
    importSettings: (payload) => {
    const imported = importSettingsBundleJson(JSON.stringify(payload));
    updateSettings(imported.settings);
    setLocale(imported.settings.language);
    if (imported.preferences.theme) setTheme(imported.preferences.theme);
    if (imported.preferences.accentTheme) setAccentTheme(imported.preferences.accentTheme);
    if (imported.preferences.dayPhotos !== undefined) setDayPhotos(imported.preferences.dayPhotos);
    if (imported.preferences.lunar) setLunar(imported.preferences.lunar);
    if (imported.preferences.lowEndMode !== undefined) setLowEndMode(imported.preferences.lowEndMode);
    if (imported.preferences.remindersEnabled !== undefined) setRemindersEnabled(imported.preferences.remindersEnabled);
    if (imported.preferences.captureShortcut) setCaptureShortcut(imported.preferences.captureShortcut);
    if (imported.preferences.captureShortcutEnabled !== undefined) setCaptureShortcutEnabled(imported.preferences.captureShortcutEnabled);
    if (imported.preferences.miniShortcut) setMiniShortcut(imported.preferences.miniShortcut);
    if (imported.preferences.miniShortcutEnabled !== undefined) setMiniShortcutEnabled(imported.preferences.miniShortcutEnabled);
    },
    onApplied: async () => { await sqliteEntries.reload(); await refreshDeletedEntries(); setChatSyncVersion((value) => value + 1); },
    onConflicts: (count) => notify(`${t("syncConflictNotice", locale)} (${count})`, "warning"),
  });

  /**
   * Serialize writes as a FIFO queue. Two overlapping writes race on the same
   * row, so the second one used to be dropped without a word; queueing keeps
   * the compare-and-swap contract honest and gives the interface something
   * concrete to show while the disk is busy. A failed job never blocks the
   * rest of the queue.
   */
  const withSaving = useCallback(async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
    writeDepth.current += 1;
    setSaving(true);
    const run = writeQueue.current.then(work);
    writeQueue.current = run.then(() => undefined, () => undefined);
    try {
      return await run;
    } finally {
      writeDepth.current -= 1;
      if (writeDepth.current === 0) setSaving(false);
    }
  }, []);

  const reportWriteFailure = useCallback((error: unknown) => {
    if (error instanceof BackgroundTimingError) { notify(t("backgroundUnavailable", locale), "warning"); return; }
    console.warn("Could not persist entry", error);
    if (isStorageError(error) && error.code === "RevisionMismatch") void sqliteEntries.reload();
    notify(t("entrySaveFailed", locale), "warning");
  }, [locale, notify, sqliteEntries]);

  const persistCreated = useCallback(async (entry: Entry): Promise<void> => {
    if (isTauri()) { await ensureSqliteStore().then((store) => store.create(entry)); return; }
    demoStore.insert(entry);
  }, [demoStore, ensureSqliteStore]);

  const persistUpdated = useCallback(async (entry: Entry): Promise<void> => {
    if (isTauri()) {
      await ensureSqliteStore().then((store) => store.update(entry, {
        expectedUpdatedAt: sqliteEntriesRef.current.revisions.get(entry.id),
      }));
      return;
    }
    demoStore.replace(entry.id, entry);
  }, [demoStore, ensureSqliteStore]);

  const reassignCategories = useCallback(async (sourceCategory: string, targetCategory: string) => {
    if (!sourceCategory || !targetCategory || sourceCategory === targetCategory) return;
    const matches = entriesRef.current.filter((entry) => {
      if (entry.kind === "bill") return entry.category.split("/")[0] === sourceCategory;
      return entry.category === sourceCategory;
    });
    for (const entry of matches) {
      await persistUpdated({
        ...entry,
        category: targetCategory,
        color: resolveEntryColor(targetCategory, entry.kind, settings, entry.calendar),
      });
    }
  }, [persistUpdated, settings]);

  const persistDeleted = useCallback(async (id: string): Promise<void> => {
    if (isTauri()) { await ensureSqliteStore().then((store) => store.delete(id)); return; }
    demoStore.remove(id);
  }, [demoStore, ensureSqliteStore]);

  const restoreDeletedEntry = useCallback(async (id: string, fallback?: Entry): Promise<void> => {
    setRecycleBusy(id);
    try {
      const store = sqliteStoreRef.current ?? (isTauri() ? await ensureSqliteStore() : null);
      if (store) await store.restoreDeleted(id);
      else if (fallback) await persistCreated(fallback);
      else throw new Error("Entry is no longer recoverable");
      await refreshDeletedEntries();
      notify(t("restored", locale));
    } catch (error) {
      reportWriteFailure(error);
    } finally {
      setRecycleBusy("");
    }
  }, [ensureSqliteStore, locale, notify, persistCreated, refreshDeletedEntries, reportWriteFailure]);

  const clearRecycleBin = useCallback(async () => {
    const store = sqliteStoreRef.current;
    if (!store) return;
    setRecycleBusy("all");
    try {
      await store.clearDeletedEntries();
      await refreshDeletedEntries();
      notify(t("recycleBinCleared", locale));
    } catch (error) {
      reportWriteFailure(error);
    } finally {
      setRecycleBusy("");
    }
  }, [locale, notify, refreshDeletedEntries, reportWriteFailure]);

  const closeComposer = useCallback(() => {
    setComposerOpen(false);
    setEditingEntry(null);
    setEditingSourceEntry(null);
    setComposerSeed(undefined);
  }, []);

  const openSettings = useCallback((section: SettingsSection = "general") => {
    void refreshDeletedEntries();
    setSettingsInitialSection(section);
    setSettingsOpen(true);
  }, [refreshDeletedEntries]);

  useEffect(() => {
    if (settingsOpen) void refreshDeletedEntries();
  }, [refreshDeletedEntries, settingsOpen, syncService.status?.lastSuccess]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        showFilter(true);
      }
      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        openSettings();
      }
      // While any modal overlay is open, single-key shortcuts are ignored:
      // pressing "n" with the composer already open used to close and re-open
      // it (flicker, and the open form's draft was reset), and "t" stacked the
      // timer under whatever was on screen.
      const modalOpen = composerOpen || settingsOpen || chatOpen || filterOpen || quickNoteOpen || timerOpen || smartCaptureRaw !== null;
      if (!typing && !modalOpen && event.key.toLowerCase() === "n") {
        event.preventDefault();
        closeComposer();
        setComposerOpen(true);
      }
      if (!typing && !modalOpen && event.key.toLowerCase() === "t" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setTimerOpen(true);
      }
      // Modal dialogs (composer, confirm, settings, chat, import) own Escape on
      // the shared modal bus and mark the event as handled; this fallback only
      // closes chrome that has no dialog of its own — so a dirty composer can
      // never be force-closed behind an open confirm.
      if (event.key === "Escape" && !event.defaultPrevented) {
        closeComposer();
        setSettingsOpen(false);
        setMobileMenuOpen(false);
        setTimerOpen(false);
        setEntryMenu(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chatOpen, closeComposer, composerOpen, openSettings, filterOpen, quickNoteOpen, settingsOpen, showFilter, smartCaptureRaw, timerOpen]);

  const openComposer = useCallback((entry: Entry | null = null) => {
    const source = entry?.recurrenceSourceId
      ? entries.find((candidate) => candidate.id === sourceEntryId(entry)) ?? entry
      : entry;
    setComposerSeed(undefined);
    setEditingEntry(entry);
    setEditingSourceEntry(source);
    setComposerOpen(true);
  }, [entries]);

  const openComposerAt = useCallback((seed: Partial<EntryDraft>) => {
    setComposerSeed(seed);
    setEditingEntry(null);
    setEditingSourceEntry(null);
    setComposerOpen(true);
  }, []);

  const handleCapture = useCallback((value: string) => {
    if (!value.trim()) return;
    const next: SmartCaptureRecoveryState = { raw: value.trim(), mode: "offline", drafts: [], updatedAt: Date.now() };
    writeSmartCaptureRecovery(next);
    setSmartCaptureRecovery(next);
    setSmartCaptureRaw(next.raw);
  }, []);

  const confirmSmartCapture = useCallback(async (drafts: EntryDraft[]): Promise<boolean> => {
    if (!drafts.length) return false;
    if (!writable) {
      notify(t("entrySaveFailed", locale), "warning");
      return false;
    }
    const result = await withSaving(async () => {
      try {
        for (const draft of drafts) {
          const created = draftToEntry(draft, "local", resolveEntryColor(draft.category, draft.kind, settings, draft.calendar));
          await persistCreated(created);
        }
        clearSmartCaptureRecovery();
        setSmartCaptureRecovery(null);
        setSmartCaptureRaw(null);
        notify(`${drafts.length} ${t("smartCaptureCreated", locale)}`);
        return true;
      } catch (error) {
        reportWriteFailure(error);
        return false;
      }
    });
    return result === true;
  }, [locale, notify, persistCreated, reportWriteFailure, settings, withSaving, writable]);

  const saveEntry = useCallback(async (draft: EntryDraft, editingId?: string, context?: EntryEditContext) => {
    if (!writable) {
      notify(t("entrySaveFailed", locale), "warning");
      return;
    }
    if (editingId) {
      const previous = entriesRef.current.find((entry) => entry.id === editingId);
      if (!previous) return;
      const editContext = context ?? { scope: "series" as const };
      if (editContext.scope === "occurrence" && editContext.occurrenceDate) {
        const occurrenceDate = editContext.occurrenceDate;
        const updatedSource = entryWithOccurrenceMove(previous, occurrenceDate, draft);
        try {
          await persistUpdated(updatedSource);
        } catch (error) {
          reportWriteFailure(error);
          return;
        }
        closeComposer();
        notify(t("occurrenceMoved", locale));
        return;
      }

      const updated = entryWithDraft(previous, draft, settings);
      try {
        await persistUpdated(updated);
      } catch (error) {
        reportWriteFailure(error);
        return;
      }
      closeComposer();
      notify(updated.recurrence !== "none" && updated.date !== previous.date ? t("seriesMoved", locale) : t("updated", locale));
      return;
    }

    const created = draftToEntry(draft, "local", resolveEntryColor(draft.category, draft.kind, settings, draft.calendar));
    try {
      await persistCreated(created);
      closeComposer();
      notify(t("created", locale));
    } catch (error) {
      reportWriteFailure(error);
    }
  }, [closeComposer, locale, notify, persistCreated, persistUpdated, reportWriteFailure, settings, writable]);

  /** Public save entry point: serialized so overlapping writes cannot race. */
  const handleSave = useCallback(async (draft: EntryDraft, editingId?: string, context?: EntryEditContext) => {
    await withSaving(() => saveEntry(draft, editingId, context));
  }, [saveEntry, withSaving]);

  const handleReschedule = useCallback(async (entry: Entry, patch: import("@chronoeon/domain").CalendarSchedulePatch) => {
    const sourceId = sourceEntryId(entry);
    const source = entriesRef.current.find((candidate) => candidate.id === sourceId);
    if (!source) return;
    const base = entryToDraft(entry);
    const draft: EntryDraft = {
      ...base,
      date: patch.date,
      start: patch.start,
      end: patch.end,
      endDate: patch.endDate,
      allDay: patch.allDay ?? base.allDay,
    };
    await handleSave(
      draft,
      source.id,
      entry.recurrenceSourceId && entry.occurrenceDate
        ? { scope: "occurrence", occurrenceDate: entry.occurrenceDate }
        : { scope: "series" },
    );
  }, [handleSave]);

  const handleDelete = useCallback(async (id: string) => {
    if (!writable) {
      notify(t("entrySaveFailed", locale), "warning");
      return;
    }
    const sourceId = sourceEntryId({ id });
    const entry = entries.find((candidate) => candidate.id === sourceId);
    if (!entry) return;
    // Keep the whole record so an accidental delete is one click from undone.
    const removed: Entry = { ...entry };
    try {
      await persistDeleted(entry.id);
      await refreshDeletedEntries();
    } catch (error) {
      reportWriteFailure(error);
      return;
    }
    closeComposer();
    notify(t("deleted", locale), "normal", {
      label: t("undo", locale),
      run: () => { void restoreDeletedEntry(entry.id, removed); },
    });
  }, [closeComposer, entries, locale, notify, persistDeleted, refreshDeletedEntries, restoreDeletedEntry, writable]);

  /** Persist a finished recording as a normal calendar entry. */
  const finishTimer = useCallback(async (segments: TimerSegment[], session: TimerSession) => {
    const draft = timerSessionToDraft(session, segments, t("timerUntitled", locale));
    if (!draft) return;
    if (!writable) throw new Error(t("timerSaveFailed", locale));
    await withSaving(async () => {
      const entry = draftToEntry(draft, "local", resolveEntryColor(draft.category, draft.kind, settings, draft.calendar));
      if (isTauri()) await (await ensureSqliteStore()).createFromTimer(entry, session.id);
      else await persistCreated(entry);
    });
    notify(t("timerSaved", locale));
  }, [ensureSqliteStore, locale, notify, persistCreated, settings, withSaving, writable]);

  const desktopTimerWindow = isTauri() && !isMobilePlatform();
  const onTimerEvent = useCallback((event: TimerLifecycleEvent, session: TimerSession, elapsedMs: number) => {
    const label = session.category ? categoryLabel(session.category, locale, session.category) : "";
    void notifyTimer(event, session, elapsedMs, locale, label).catch((error) => console.warn("Timer notification failed", error));
    if (!desktopTimerWindow) return;
    // The pinned window follows the recording: it appears with the first
    // segment (unless the app itself is already the pinned mini window) and
    // leaves with the last.
    if (event === "start" && !compact) void openTimerWindow(locale).catch((error) => console.warn("Could not open the timer window", error));
    if (event === "stop" || event === "cancel") void closeTimerWindow().catch((error) => console.warn("Could not close timer window", error));
  }, [compact, desktopTimerWindow, locale]);

  const timer = useLiveTimer(timerStore, finishTimer, onTimerEvent, reportWriteFailure);

  // Mirror every session change to the pinned window; it ticks on its own.
  useEffect(() => {
    if (!desktopTimerWindow) return;
    void emitTimerState(timer.session).catch((error) => console.warn("Timer state delivery failed", error));
  }, [desktopTimerWindow, timer.session]);

  const timerRef = useRef(timer);
  timerRef.current = timer;
  const timerErrorRef = useRef(reportWriteFailure);
  timerErrorRef.current = reportWriteFailure;
  useEffect(() => {
    if (!desktopTimerWindow) return;
    let disposed = false;
    let dispose: (() => void) | undefined;
    void listenTimerCommands((command) => {
      const live = timerRef.current;
      if (command === "pause") live.pause();
      else if (command === "resume") live.resume();
      else if (command === "stop") void live.stop().catch((error) => timerErrorRef.current(error));
      else if (command === "hide") void closeTimerWindow().catch((error) => console.warn("Could not close timer window", error));
      else if (command === "open") void emitTimerState(live.session).catch((error) => console.warn("Timer state delivery failed", error));
    }).then((unlisten) => { if (disposed) unlisten(); else dispose = unlisten; }).catch((error) => console.warn("Timer command listener failed", error));
    return () => { disposed = true; dispose?.(); };
  }, [desktopTimerWindow]);

  const reminders = useReminders({
    entries,
    locale,
    enabled: remindersEnabled,
    ready: !isTauri() || sqliteStore !== null,
    onError: reportWriteFailure,
    onRemind: useCallback((due: DueReminder[]) => {
      void focusAppWindow();
      setReminderNotice(due);
    }, []),
  });

  /** Global capture: raise the window and open the quick-note box. */
  const triggerGlobalCapture = useCallback(() => {
    void focusAppWindow();
    setSettingsOpen(false);
    setTimerOpen(false);
    setQuickNoteOpen(true);
    warmCaptureProvider();
  }, [warmCaptureProvider]);

  useEffect(() => {
    if (!captureShortcutEnabled) {
      setShortcutStatus("off");
      void unregisterCaptureShortcut();
      return;
    }
    let disposed = false;
    void registerCaptureShortcut(captureShortcut, triggerGlobalCapture).then((result) => {
      if (!disposed) setShortcutStatus(result.status);
    });
    return () => {
      disposed = true;
      void unregisterCaptureShortcut();
    };
  }, [captureShortcut, captureShortcutEnabled, triggerGlobalCapture]);

  const exportEntries = useCallback(async () => {
    setTransferBusy(true);
    try {
      const saved = await saveTextDocument(
        exportEntriesCsv(entries),
        `chronoeon-entries-${todayKey}.csv`,
        CSV_FILE_FILTERS,
        "text/csv;charset=utf-8",
      );
      if (saved) notify(t("entriesExported", locale));
    } catch (error) {
      console.warn("Could not export entries", error);
      notify(t("exportFailed", locale), "warning");
    } finally {
      setTransferBusy(false);
    }
  }, [entries, locale, notify, todayKey]);

  const toggleCompact = useCallback(() => {
    // The mini window is the same shell, so search and the filter carry over
    // untouched; only the window geometry and the dock change.
    setCompact(!compact);
  }, [compact, setCompact]);

  // The mini window has no week, month or statistics entry, so a view it
  // cannot show falls back to the agenda rather than rendering off-menu.
  useEffect(() => {
    if (!compact) return;
    if (activeView === "week" || activeView === "month" || activeView === "insights") setActiveView("agenda");
  }, [activeView, compact, setActiveView]);

  /** Global mini shortcut: enter the mini window, or hide/show it when compact. */
  const triggerMiniWindow = useCallback(() => {
    void focusAppWindow();
    if (!compact) toggleCompact();
    else void toggleMiniWindowVisible();
  }, [compact, toggleCompact]);

  useEffect(() => {
    if (!miniShortcutEnabled) {
      setMiniShortcutStatus("off");
      void unregisterMiniShortcut();
      return;
    }
    let disposed = false;
    void registerMiniShortcut(miniShortcut, triggerMiniWindow).then((result) => {
      if (!disposed) setMiniShortcutStatus(result.status);
    });
    return () => {
      disposed = true;
      void unregisterMiniShortcut();
    };
  }, [miniShortcut, miniShortcutEnabled, triggerMiniWindow]);

  // Mini-window keyboard navigation: arrows walk the days. Typing fields and
  // open dialogs keep every key for themselves.
  useEffect(() => {
    if (!compact) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target) {
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable) return;
        if (target.closest('[role="dialog"]')) return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        navigate(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        navigate(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [compact, navigate]);

  function navigate(direction: -1 | 0 | 1) {
    if (direction === 0) {
      setSelectedDate(new Date());
      return;
    }
    if (compact) {
      // The title-bar arrows always step one civil day on phones and in the
      // mini window, whatever the visible day count is.
      setSelectedDate((current) => addDays(current, direction));
      return;
    }
    // Day steps one day at a time: the arrows are a title-bar control, not a
    // page-turn for a multi-day board. Week keeps its whole-week step and
    // Month keeps its month step.
    setSelectedDate((current) => activeView === "month"
      ? addMonths(current, direction)
      : addDays(current, (activeView === "week" ? 7 : 1) * direction));
  }

  function commitView(view: AppView) {
    setActiveView(view);
    setMobileMenuOpen(false);
  }

  async function toggleTask(id: string, projectedEntry?: Entry) {
    if (!writable) {
      notify(t("entrySaveFailed", locale), "warning");
      return;
    }
    if (busyEntryIds.current.has(id)) return;
    const occurrenceDate = /::recurrence::(\d{4}-\d{2}-\d{2})$/.exec(id)?.[1];
    const displayed = projectedEntry
      ?? entriesForDate(entries, selectedKey).find((candidate) => candidate.id === id)
      ?? (occurrenceDate ? entriesForDate(entries, occurrenceDate).find((candidate) => candidate.id === id) : undefined)
      ?? entries.find((candidate) => candidate.id === id);
    if (!displayed || displayed.kind !== "task") return;
    const source = entries.find((candidate) => candidate.id === sourceEntryId(displayed));
    if (!source) return;
    const nextStatus: NonNullable<Entry["status"]> = displayed.status === "done" ? "open" : "done";
    const changedAt = new Date().toISOString();
    const updated = displayed.recurrenceSourceId && displayed.occurrenceDate
      ? entryWithOccurrenceStatus(source, displayed.occurrenceDate, nextStatus, changedAt)
      : {
          ...source,
          status: nextStatus,
          doneAt: nextStatus === "done" ? changedAt : undefined,
          cancelledAt: undefined,
        };
    busyEntryIds.current.add(id);
    try {
      await withSaving(() => persistUpdated(updated));
    } catch (error) {
      reportWriteFailure(error);
    } finally {
      busyEntryIds.current.delete(id);
    }
  }

  async function convertIdea(id: string, date: string) {
    if (!writable) {
      notify(t("entrySaveFailed", locale), "warning");
      return;
    }
    if (busyEntryIds.current.has(id)) return;
    const source = entries.find((candidate) => candidate.id === sourceEntryId({ id }));
    if (!source) return;
    // Keep the source id: the converted entry is written by `persistUpdated`,
    // which addresses the row by id. Reassigning the id here orphaned the row
    // (same snap-back as the old drag bug). The id is minted once at creation.
    const updated: Entry = {
      ...source,
      kind: "task",
      date,
      start: source.start,
      end: source.end,
      endDate: undefined,
      allDay: Boolean(source.allDay),
      status: "open",
      recurrence: "none",
      recurringDays: undefined,
      recurringEnd: undefined,
      recurrenceExceptions: undefined,
      recurrenceMoves: undefined,
      color: resolveEntryColor(source.category, "task", settings, source.calendar),
    };
    busyEntryIds.current.add(id);
    try {
      await withSaving(() => persistUpdated(updated));
    } catch (error) {
      reportWriteFailure(error);
      return;
    } finally {
      busyEntryIds.current.delete(id);
    }
    notify(t("converted", locale));
  }

  const openEntryMenu = useCallback((entry: Entry, event: React.MouseEvent) => {
    event.stopPropagation();
    setEntryMenu({ entry, x: event.clientX, y: event.clientY });
  }, []);

  const setEntryStatus = useCallback(async (entry: Entry, status: EntryStatus) => {
    if (!writable) {
      notify(t("entrySaveFailed", locale), "warning");
      return;
    }
    const source = entries.find((candidate) => candidate.id === sourceEntryId(entry));
    if (!source) return;
    const changedAt = new Date().toISOString();
    const updated = entry.recurrenceSourceId && entry.occurrenceDate
      ? entryWithOccurrenceStatus(source, entry.occurrenceDate, status, changedAt)
      : {
        ...source,
        status,
        doneAt: status === "done" ? changedAt : undefined,
        cancelledAt: status === "cancelled" ? changedAt : undefined,
      };
    try {
      await persistUpdated(updated);
    } catch (error) {
      reportWriteFailure(error);
    }
  }, [entries, locale, notify, persistUpdated, reportWriteFailure, writable]);

  const duplicateEntry = useCallback(async (entry: Entry) => {
    const source = entries.find((candidate) => candidate.id === sourceEntryId(entry)) ?? entry;
    const copy: Entry = {
      ...source,
      id: createEntryId(),
      date: entry.date,
      status: source.kind === "task" ? "open" : source.status,
      doneAt: undefined,
      cancelledAt: undefined,
      recurrenceExceptions: undefined,
      recurrenceMoves: undefined,
      recurrenceSourceId: undefined,
      occurrenceDate: undefined,
      createdAt: new Date().toISOString(),
      markdown: undefined,
      filePath: undefined,
    };
    await handleSave(entryToDraft(copy));
    notify(t("duplicated", locale));
  }, [entries, handleSave, locale, notify]);

  const moveEntryByDays = useCallback(async (entry: Entry, days: number) => {
    const target = format(addDays(new Date(), days), "yyyy-MM-dd");
    if (target === entry.date) return;
    // Move the whole span, not just the first day: a multi-day entry moved
    // to tomorrow must keep its duration instead of collapsing to one day.
    const offset = differenceInCalendarDays(parseISO(target), parseISO(entry.date));
    await handleReschedule(entry, {
      date: target,
      start: entry.allDay ? undefined : entry.start,
      end: entry.allDay ? undefined : entry.end,
      endDate: entry.endDate ? format(addDays(parseISO(entry.endDate), offset), "yyyy-MM-dd") : undefined,
      allDay: entry.allDay,
    });
  }, [handleReschedule]);

  const copyEntryText = useCallback(async (entry: Entry) => {
    const parts = [entry.title, entry.date, formatEntryTime(entry, locale), entry.location, entry.note].filter(Boolean);
    const text = parts.join(" · ");
    try {
      await navigator.clipboard.writeText(text);
      notify(t("copiedText", locale));
    } catch {
      notify(text);
    }
  }, [locale, notify]);

  const viewActions = useRef({ toggleTask, setEntryStatus, convertIdea, openComposerAt, openComposer, selectView, openEntryMenu, handleReschedule });
  viewActions.current = { toggleTask, setEntryStatus, convertIdea, openComposerAt, openComposer, selectView, openEntryMenu, handleReschedule };
  // A clock tick, speech update or toast must not rebuild a whole calendar.
  // Keep just the active/incoming JSX surfaces stable; events read live actions.
  const currentPageKey = navigationPageKey(activeView, selectedDate);
  const visiblePages = useMemo(() => {
    const current = { key: navigationPageKey(activeView, selectedDate), view: activeView, date: selectedDate };
    const incoming = navigation.preview;
    const incomingKey = incoming && navigationPageKey(incoming.view, incoming.date);
    return incoming && incomingKey !== current.key
      ? [current, { key: incomingKey!, view: incoming.view, date: incoming.date }] : [current];
  }, [activeView, selectedDate, navigation.preview?.view, navigation.preview?.date]);
  const renderedViews = useMemo(() => {
  /** `visibleDays` lets the mini window use its own 1-3 day range. */
    function renderView(visibleDays: number, view: AppView, selectedDate: Date) {
    // "Photos only" hides every item chip. The calendar views keep the entries
    // themselves because they read the day's photos from them; the list-like
    // views simply render nothing.
    const itemEntries = entryFilter.photosOnly ? [] : searchedEntries;
    const photosOnly = entryFilter.photosOnly;
    if (view === "agenda") return <AgendaView entries={itemEntries} selectedDate={selectedDate} locale={locale} settings={settings} filter={filter} search={search} lunar={lunar} onSelectDate={setSelectedDate} onToggle={(id, entry) => { void viewActions.current.toggleTask(id, entry); }} onEdit={entry => viewActions.current.openComposer(entry)} onNew={(date) => (date ? viewActions.current.openComposerAt({ date, allDay: true }) : viewActions.current.openComposer())} onEntryMenu={(...args) => viewActions.current.openEntryMenu(...args)} />;
    if (view === "month") return <MonthView entries={searchedEntries} selectedDate={selectedDate} locale={locale} settings={settings} filter={filter} search={search} weekStartsOn={settings.firstDay} showWeekNumbers={settings.showWeekNumbers} lunar={lunar} showPhotos={dayPhotos || photosOnly} photosOnly={photosOnly} onSelectDate={setSelectedDate} onOpenAgenda={() => viewActions.current.selectView("day")} onToggle={(id, entry) => { void viewActions.current.toggleTask(id, entry); }} onEdit={entry => viewActions.current.openComposer(entry)} onEntryMenu={(...args) => viewActions.current.openEntryMenu(...args)} onNewAt={(date) => viewActions.current.openComposerAt({ date, allDay: true })} onReschedule={(...args) => viewActions.current.handleReschedule(...args)} />;
    if (view === "day" || view === "week") {
      return (
        <DayView
          entries={searchedEntries}
          selectedDate={selectedDate}
          locale={locale}
          settings={settings}
          days={view === "week" ? 7 : visibleDays}
          anchor={view === "week" ? "week" : "selection"}
          weekStartsOn={settings.firstDay}
          timeScale={settings.timeScale}
          lunar={lunar}
          showPhotos={dayPhotos || photosOnly}
          photosOnly={photosOnly}
          filter={filter}
          search={search}
          onSelectDate={setSelectedDate}
          onToggle={(id, entry) => { void viewActions.current.toggleTask(id, entry); }}
          onEdit={entry => viewActions.current.openComposer(entry)}
          onNew={() => viewActions.current.openComposer()}
          onNewAt={(draft) => viewActions.current.openComposerAt(draft)}
          onReschedule={(...args) => viewActions.current.handleReschedule(...args)}
          onEntryMenu={(...args) => viewActions.current.openEntryMenu(...args)}
        />
      );
    }
    if (view === "ideas") return <IdeasView entries={itemEntries} locale={locale} settings={settings} search={search} today={todayKey} onEdit={entry => viewActions.current.openComposer(entry)} onConvert={(id, date) => { void viewActions.current.convertIdea(id, date); }} onNew={() => viewActions.current.openComposerAt({ kind: "idea", date: todayKey, start: format(new Date(), "HH:mm") })} />;
    return <StatsView entries={photosOnly ? [] : searchedEntries} locale={locale} settings={settings} today={todayKey} search={search} onToggle={(id, entry) => { void viewActions.current.toggleTask(id, entry); }} onStatus={(entry, status) => { void viewActions.current.setEntryStatus(entry, status); }} onOpenDate={(date) => { setSelectedDate(parseISO(date)); viewActions.current.selectView("day"); }} />;
  }
    return new Map(visiblePages.map(page => [page.key, renderView(compact ? safeMiniDayCount : safeDayCount, page.view, page.date)]));
  }, [visiblePages, compact, safeMiniDayCount, safeDayCount, entryFilter.photosOnly,
    searchedEntries, selectedDate, locale, settings, filter, search, lunar, dayPhotos, todayKey]);

  const preferences: AppPreferences = { lunar, dayPhotos, accentTheme, remindersEnabled, captureShortcut, captureShortcutEnabled, miniShortcut, miniShortcutEnabled, lowEndMode };

  function applyPreferences(patch: Partial<AppPreferences>) {
    if (patch.lunar !== undefined) setLunar(patch.lunar);
    if (patch.dayPhotos !== undefined) setDayPhotos(patch.dayPhotos);
    if (patch.accentTheme !== undefined) setAccentTheme(patch.accentTheme);
    if (patch.remindersEnabled !== undefined) setRemindersEnabled(patch.remindersEnabled);
    if (patch.captureShortcut !== undefined) setCaptureShortcut(patch.captureShortcut);
    if (patch.captureShortcutEnabled !== undefined) setCaptureShortcutEnabled(patch.captureShortcutEnabled);
    if (patch.miniShortcut !== undefined) setMiniShortcut(patch.miniShortcut);
    if (patch.miniShortcutEnabled !== undefined) setMiniShortcutEnabled(patch.miniShortcutEnabled);
    if (patch.lowEndMode !== undefined) setLowEndMode(patch.lowEndMode);
  }

  const entryMenuNode = entryMenu ? (
    <EntryContextMenu
      locale={locale}
      target={entryMenu}
      onClose={() => setEntryMenu(null)}
      onEdit={openComposer}
      onStatus={(entry, status) => { void setEntryStatus(entry, status); }}
      onDuplicate={(entry) => { void duplicateEntry(entry); }}
      onMoveByDays={(entry, days) => { void moveEntryByDays(entry, days); }}
      onOpenDay={(entry) => { setSelectedDate(parseISO(entry.date)); selectView("day"); }}
      onCopyText={(entry) => { void copyEntryText(entry); }}
      onDelete={(entry) => {
        void confirm({
          title: t(entry.recurrence && entry.recurrence !== "none" ? "deleteSeriesConfirm" : "deleteConfirm", locale),
          detail: entry.title,
          confirmLabel: t("delete", locale),
          tone: "danger",
        }).then((accepted) => { if (accepted) void handleDelete(entry.id); });
      }}
    />
  ) : null;

  const timerNode = timerOpen ? (
    <TimerWidget locale={locale} settings={settings} timer={timer} open={timerOpen} compact={compact} history={entries} onConfirm={confirm} onNotice={notify} onPin={desktopTimerWindow && !compact ? () => { void openTimerWindow(locale).catch((error) => console.warn("Could not open the timer window", error)); } : undefined} onClose={() => setTimerOpen(false)} />
  ) : null;

  const changeAIPreferences = useCallback((next: AIProviderPreferences) => {
    setAIPreferencesState(normalizeAIProviderPreferences(next));
  }, []);

  const saveLocalAIKey = useCallback(async (value: string) => {
    await storeLocalAIKey(value);
    setLocalKeyStored(Boolean(value.trim()));
  }, []);

  const clearLocalAIKey = useCallback(async () => {
    await clearStoredLocalAIKey();
    setLocalKeyStored(false);
  }, []);

  const saveRemoteAIKey = useCallback(async (value: string) => {
    await storeRemoteAIKey(value);
    setRemoteKeyStored(Boolean(value.trim()));
  }, []);

  const clearRemoteAIKey = useCallback(async () => {
    await clearStoredRemoteAIKey();
    setRemoteKeyStored(false);
  }, []);

  const testAI = useCallback(async () => {
    const provider = activeAIProvider(aiPreferences);
    await fetchAIModels(provider);
  }, [aiPreferences]);

  const sendTestNotification = useCallback(async () => {
    const delivered = await showSystemNotification({
      title: `🔔 ${t("reminderTitle", locale)}`,
      body: t("systemNotificationsDetail", locale),
    });
    notify(t(delivered ? "testNotificationSent" : "testNotificationBlocked", locale), delivered ? "normal" : "warning");
  }, [locale, notify]);

  const settingsDialog = settingsOpen ? <SettingsDialog
    locale={locale}
    theme={theme}
    settings={settings}
    entries={entries}
    preferences={preferences}
    transferBusy={transferBusy}
    notificationPermission={reminders.permission}
    shortcutStatus={shortcutStatus}
    miniShortcutStatus={miniShortcutStatus}
    initialSection={settingsInitialSection}
    aiPreferences={aiPreferences}
    localKeyStored={localKeyStored}
    remoteKeyStored={remoteKeyStored}
    onAIPreferencesChange={changeAIPreferences}
    onSaveLocalKey={saveLocalAIKey}
    onClearLocalKey={clearLocalAIKey}
    onSaveRemoteKey={saveRemoteAIKey}
    onClearRemoteKey={clearRemoteAIKey}
    onTestAI={testAI}
    onTestNotification={() => { void sendTestNotification(); }}
    onClose={() => setSettingsOpen(false)}
    onLocaleChange={changeLocale}
    onThemeChange={setTheme}
    onSettingsChange={updateSettings}
    onReassignCategories={reassignCategories}
    onPreferencesChange={applyPreferences}
    onRequestNotifications={() => { void reminders.requestPermission(); }}
    onExportEntries={exportEntries}
    syncConfig={syncConfig}
    onSyncConfigChange={setSyncConfig}
    syncService={syncService}
    deletedEntries={deletedEntries}
    recycleBusy={recycleBusy}
    onRestoreDeleted={(id) => restoreDeletedEntry(id)}
    onClearDeleted={clearRecycleBin}
    isTauri={isTauri()}
  /> : null;

  const reminderDialog = reminderNotice?.length ? (
    <ReminderDialog
      reminders={reminderNotice}
      locale={locale}
      onClose={() => setReminderNotice(null)}
      onOpen={(entry) => {
        setReminderNotice(null);
        openComposer(entry);
      }}
    />
  ) : null;

  useEffect(() => subscribeImagePreview((request) => setImagePreview(request)), []);

  const imagePreviewNode = imagePreview ? (
    <ImagePreview
      locale={locale}
      items={imagePreview.items}
      index={imagePreview.index}
      onIndexChange={(index) => setImagePreview((current) => current ? { ...current, index } : current)}
      onClose={() => setImagePreview(null)}
    />
  ) : null;

  const quickNoteNode = quickNoteOpen ? (
    <QuickNoteDialog
      locale={locale}
      onParse={(value) => { setQuickNoteOpen(false); handleCapture(value); }}
      onManualAdd={(value) => {
        setQuickNoteOpen(false);
        const [title, ...lines] = value.split("\n");
        openComposerAt(value ? { title, note: lines.join("\n").trim() || undefined } : {});
      }}
      onClose={() => setQuickNoteOpen(false)}
    />
  ) : null;

  const updateSmartRecovery = useCallback((next: Omit<SmartCaptureRecoveryState, "updatedAt">) => {
    writeSmartCaptureRecovery(next);
    setSmartCaptureRecovery((current) => ({ ...next, updatedAt: current?.updatedAt ?? Date.now() }));
  }, []);

  const smartCaptureDialog = smartCaptureRaw && !settingsOpen ? <SmartCaptureDialog
    key={smartCaptureRaw}
    history={entries}
    raw={smartCaptureRaw}
    locale={locale}
    settings={settings}
    aiPreferences={aiPreferences}
    recovery={smartCaptureRecovery}
    onRecoveryChange={updateSmartRecovery}
    onClose={() => {
      clearSmartCaptureRecovery();
      setSmartCaptureRecovery(null);
      setSmartCaptureRaw(null);
    }}
    onConfigureAI={() => {
      // Keep the session mounted in storage while Settings is open. The dialog
      // reappears with the same offline/AI preview when the user returns.
      setSettingsInitialSection("ai");
      setSettingsOpen(true);
    }}
    onConfirm={confirmSmartCapture}
  /> : null;

  const chatDialog = chatOpen ? <ChatDialog
      refreshVersion={chatSyncVersion}
    locale={locale}
    entries={entries}
    aiPreferences={aiPreferences}
    conversations={conversationStore}
    onOpenEntry={(entryId) => {
      const entry = entries.find((candidate) => candidate.id === entryId);
      if (entry) {
        setChatOpen(false);
        openComposer(entry);
      }
    }}
    onOpenSettings={() => { setSettingsInitialSection("ai"); setSettingsOpen(true); }}
    onClose={() => setChatOpen(false)}
  /> : null;

  const filterControl = <button ref={filterTriggerRef} type="button"
    className={(compact ? "view-dock-action view-dock-filter" : "icon-button topbar-filter-trigger")
      + (filter.length || filterActive(entryFilter) || search.trim() ? " is-active" : "")}
    aria-label={t("filterPanelTitle", locale)} title={t("filterPanelTitle", locale)} aria-expanded={filterOpen} aria-haspopup="dialog"
    onClick={() => { if (filterOpen) closeFilter(); else showFilter(); }}>
    <Icon name="filter" size={17} />
    {search.trim() && <i className="filter-active-dot" role="status" aria-label={t("filterSearchActive", locale)} />}
  </button>;
  const filterPanel = filterOpen ? <FilterPanel locale={locale} settings={settings}
    kind={filter} filter={entryFilter} scheduleCategories={scheduleCategories} billCategories={billCategories}
    calendars={calendars} anchor={filterAnchor} focusSearch={focusFilterSearch}
    entries={entryFilter.photosOnly ? filteredEntries.filter(entry => entry.images?.length) : filteredEntries}
    search={search} onSearch={setSearch} onKindChange={setFilter} onChange={setEntryFilter} onClose={closeFilter}
    onOpenEntry={entry => { setSelectedDate(parseISO(entry.date)); openComposer(entry); }} /> : null;

  const captureDialog = composerOpen ? <EntryComposer availableTags={[...new Set(entries.flatMap(entry => entry.tags ?? []))]}
    locale={locale} settings={settings} selectedDate={selectedKey} editing={editingEntry} sourceEntry={editingSourceEntry}
    history={entries} onClose={closeComposer} onSave={handleSave} onDelete={handleDelete} onNotice={notify} onConfirm={confirm}
    initialDraft={composerSeed} /> : smartCaptureDialog ?? quickNoteNode;

  // On phone widths the same button is the drawer's close affordance; the
  // collapsed rail remains a desktop-only destination.
  function setSidebarCollapsedState(collapsed: boolean) {
    setSidebarCollapsed(collapsed);
    if (collapsed) setMobileMenuOpen(false);
  }

  if (compact) {
    // The mini window is the normal shell at its narrowest: the same top bar
    // (filter moved to the dock), the same views, and the same dock minus the
    // sidebar, maximise, 4/5/6-day, week, month and statistics entries. The
    // effect below has already moved an unsupported view back to the agenda.
    const miniView = activeView;
    const miniCalendarView = miniView === "day";
    return (
      <div className={`app-shell is-mini${miniCalendarView ? " is-calendar-shell" : ""}${lowEndMode ? " is-low-end" : ""}`}>
        {!lowEndMode && !mobileViewport && <AmbientParticles />}
        {!isMobilePlatform() && <WindowResizeHandles />}
        <main className="main-shell">
          <TopBar
            locale={locale}
            view={miniView}
            selectedDate={selectedDate}
            weekStartsOn={settings.firstDay}
            dayCount={miniView === "day" ? safeMiniDayCount : undefined}
            filterControl={filterControl}
            onNavigate={navigate}
            onJumpDate={setSelectedDate}
            onMobileMenu={navigation.openSidebar}
            saving={saving}
            mini
            showWindowControls={!isMobilePlatform()}
          />
          <div className="content-scroll">
            <section className={miniCalendarView
              ? "content-inner content-inner--calendar"
              : miniView === "agenda" ? "content-inner content-inner--list"
              : "content-inner content-inner--ideas"}>
              <div key={miniView} className="view-stage">
                {miniView === "agenda" && <>
                  <header className="hero-header view-title-row">
                    <div>
                      <h1 className="view-heading"><span className="headline-leaf">{t("welcome", locale)}</span></h1>
                    </div>
                  </header>
                </>}
                {renderedViews.get(miniView)}
              </div>
            </section>
          </div>
          <ViewDock
            locale={locale}
            activeView={miniView}
            timerActive={timer.active}
            dayCount={safeMiniDayCount}
            mini
            onViewChange={(view) => {
              setActiveView(view === "day" ? "day" : view === "ideas" ? "ideas" : "agenda");
              setMobileMenuOpen(false);
            }}
            onDayCountChange={setMiniDayCount}
            filterControl={filterControl}
            onTimer={() => setTimerOpen(true)}
            onQuickNote={() => setQuickNoteOpen(true)}
            onRestore={toggleCompact}
          >
            <TimerPill locale={locale} timer={timer} onOpen={() => setTimerOpen(true)} />
          </ViewDock>
        </main>
        <MotionPresence>{captureDialog}</MotionPresence>
        <MotionPresence>{chatDialog}</MotionPresence>
        <MotionPresence>{filterPanel}</MotionPresence>
        <MotionPresence>{settingsDialog}</MotionPresence>
        <MotionPresence>{reminderDialog}</MotionPresence>
        <MotionPresence>{imagePreviewNode}</MotionPresence>
        <MotionPresence>{timerNode}</MotionPresence>
        <MotionPresence>{entryMenuNode}</MotionPresence>
        <MotionPresence>{confirmDialog}</MotionPresence>
        {toast && <Toast toast={toast} locale={locale} onDismiss={dismissToast} />}
      </div>
    );
  }

  const calendarShell = activeView === "month" || activeView === "day" || activeView === "week";
  return (
      <div className={`app-shell${calendarShell ? " is-calendar-shell" : ""}${lowEndMode ? " is-low-end" : ""}`}>
      {!lowEndMode && !mobileViewport && <AmbientParticles />}
      {!isMobilePlatform() && <WindowResizeHandles />}
      <div ref={navigation.backdropRef} className={mobileMenuOpen ? "mobile-sidebar-backdrop is-open" : "mobile-sidebar-backdrop"} onClick={() => setMobileMenuOpen(false)} />
      {/* The drawer must never inherit the collapsed rail's 72px width, or the
          opened menu wraps every label into a vertical sliver. */}
      <div ref={navigation.sidebarRef} data-side={navigation.sidebarSide} aria-hidden={mobileViewport && !mobileMenuOpen ? true : undefined} inert={mobileViewport && !mobileMenuOpen} className={[mobileMenuOpen ? "sidebar-wrap is-open" : "sidebar-wrap", sidebarCollapsed && !mobileViewport && !mobileMenuOpen ? "is-collapsed" : ""].filter(Boolean).join(" ")}>
        <Sidebar locale={locale} activeView={activeView} collapsed={sidebarCollapsed && !mobileViewport && !mobileMenuOpen} dayCount={activeView === "day" ? safeDayCount : undefined} onViewChange={selectView} onDayCountChange={setDayCount} onCollapsedChange={setSidebarCollapsedState} onNew={() => openComposer()} onCompact={toggleCompact} onChat={() => setChatOpen(true)} onOpenSettings={() => { openSettings(); setMobileMenuOpen(false); }} />
      </div>
      <main className="main-shell">
        {!lowEndMode && <TreeCanopy />}
        <TopBar
          locale={locale}
          view={activeView}
          selectedDate={selectedDate}
          weekStartsOn={settings.firstDay}
          dayCount={activeView === "day" ? safeDayCount : undefined}
          filterControl={filterControl}
          onNavigate={navigate}
          onJumpDate={setSelectedDate}
          onMobileMenu={navigation.openSidebar}
          saving={saving}
          showWindowControls={!isMobilePlatform()}
        />
        <div ref={navigation.pagerRef} className="view-pager" data-axis={navigation.preview?.axis ?? "x"}>
          {visiblePages.map(({ key, view }) => (
          <div key={key} className={"content-scroll view-page" + (isCalendarView(view) ? " is-calendar-page" : "")} data-view={view}
            data-position={key === currentPageKey ? "current" : "preview"} aria-hidden={key !== currentPageKey || undefined} inert={key !== currentPageKey}
            style={key !== currentPageKey ? { "--page-origin": navigation.preview!.side * 100 + "%" } as React.CSSProperties : undefined}>
          <section className={isCalendarView(view)
            ? "content-inner content-inner--calendar"
            : view === "agenda" ? "content-inner content-inner--list"
            : view === "ideas" ? "content-inner content-inner--ideas"
            : "content-inner"}>
            <div key={view} className="view-stage">
              {view === "agenda" && <>
                <header className="hero-header view-title-row">
                  <div>
                    <h1 className="view-heading"><span className="headline-leaf">{t("welcome", locale)}</span></h1>
                  </div>
                  <div className="hero-tools">
                    <div className="hero-summary">
                      <TaskSummaryPopover
                        label={t("reviewHighlights", locale)}
                        count={completedTasks.length}
                        entries={completedTasks}
                        emptyLabel={t("reviewNoHighlights", locale)}
                        tone="completed"
                        locale={locale}
                        settings={settings}
                        onToggle={(id, entry) => { void toggleTask(id, entry); }}
                        onStatus={(entry, status) => { void setEntryStatus(entry, status); }}
                        onOpen={(entry) => {
                          setSelectedDate(parseISO(entry.date));
                          selectView("day");
                        }}
                      />
                      <TaskSummaryPopover
                        label={t("reviewCarriedOver", locale)}
                        count={overdueTasks.length + upcomingTasks.length}
                        entries={overdueTasks}
                        emptyLabel={t("reviewNothingCarried", locale)}
                        upcomingEntries={upcomingTasks}
                        upcomingLabel={t("reviewUpcoming", locale)}
                        upcomingEmptyLabel={t("reviewNothingUpcoming", locale)}
                        tone="overdue"
                        locale={locale}
                        settings={settings}
                        onToggle={(id, entry) => { void toggleTask(id, entry); }}
                        onStatus={(entry, status) => { void setEntryStatus(entry, status); }}
                        onOpen={(entry) => {
                          setSelectedDate(parseISO(entry.date));
                          selectView("day");
                        }}
                      />
                    </div>
                  </div>
                </header>
              </>}
              {renderedViews.get(key)}
            </div>
          </section>
          </div>
          ))}
        </div>
        <ViewDock
          locale={locale}
          activeView={activeView}
          calendarView={calendarView}
          timerActive={timer.active}
          dayCount={safeDayCount}
          onViewChange={selectView}
          onDayCountChange={setDayCount}
          onTimer={() => setTimerOpen(true)}
          onQuickNote={() => { setQuickNoteOpen(true); warmCaptureProvider(); }}
        >
          <TimerPill locale={locale} timer={timer} onOpen={() => setTimerOpen(true)} />
        </ViewDock>
      </main>
      <MotionPresence>{captureDialog}</MotionPresence>
      <MotionPresence>{chatDialog}</MotionPresence>
      <MotionPresence>{filterPanel}</MotionPresence>
      <MotionPresence>{settingsDialog}</MotionPresence>
      <MotionPresence>{reminderDialog}</MotionPresence>
      <MotionPresence>{imagePreviewNode}</MotionPresence>
      <MotionPresence>{timerNode}</MotionPresence>
      <MotionPresence>{entryMenuNode}</MotionPresence>
      <MotionPresence>{confirmDialog}</MotionPresence>
      {toast && <Toast toast={toast} locale={locale} onDismiss={dismissToast} />}
    </div>
  );
}

function Toast({ toast, locale, onDismiss }: { toast: ToastState; locale: Locale; onDismiss: () => void }) {
  return (
    <div className={`toast toast--${toast.tone ?? "normal"}`} role="status" aria-live={toast.tone === "warning" ? "assertive" : "polite"}>
      <span className="toast-mark"><Icon name={toast.tone === "warning" ? "close" : "check"} size={15} /></span>
      <span className="toast-message">{toast.message}</span>
      {toast.action && (
        <button type="button" className="toast-action" onClick={() => { toast.action?.run(); onDismiss(); }}>{toast.action.label}</button>
      )}
      <button type="button" className="toast-close" onClick={onDismiss} aria-label={t("close", locale)} title={t("close", locale)}>
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}

export default App;
