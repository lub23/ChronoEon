import type { useSyncService } from "../sync/useSyncService";
import { useTouchDevice } from "../hooks/useTouchDevice";
import { useEffect, useRef, useState } from "react";
import { titleFor, type CalendarConfig, type ChronoEonSettings } from "@chronoeon/domain";
import type { DeletedEntrySummary } from "@chronoeon/storage";
import type { AIProviderPreferences } from "../ai/provider";
import type { Locale, ThemeMode } from "../domain/entry";
import type { LunarPreference } from "../domain/lunar";
import { DEFAULT_CAPTURE_SHORTCUT, DEFAULT_MINI_SHORTCUT, formatAccelerator, isValidAccelerator } from "../platform/globalShortcut";
import type { NotificationPermissionState } from "../platform/notifications";
import { compositeCategoryLabel, t, type MessageKey } from "../i18n";
import { AISettingsPanel } from "./AISettingsPanel";
import { CalendarCatalogManager } from "./CalendarCatalogManager";
import { CategoryCatalogManager } from "./CategoryCatalogManager";
import { SyncSettingsPanel } from "./SyncSettingsPanel";
import type { SyncConfig } from "../sync/types";
import { GlassSelect } from "./GlassSelect";
import { Icon } from "./Icon";
import { backgroundTimingSupported } from "../platform/background";
import { BackgroundTimingSettings } from "./BackgroundTimingSettings";
import { registerModalDismiss } from "./modalLayer";

export type SettingsSection = "general" | "calendar" | "reminders" | "ai" | "data";

export type AccentTheme = "terracotta" | "jade" | "ocean" | "violet";

export interface AppPreferences {
  lunar: LunarPreference;
  dayPhotos: boolean;
  accentTheme: AccentTheme;
  remindersEnabled: boolean;
  captureShortcut: string;
  captureShortcutEnabled: boolean;
  miniShortcut: string;
  miniShortcutEnabled: boolean;
  lowEndMode: boolean;
}

interface SettingsDialogProps {
  locale: Locale;
  theme: ThemeMode;
  settings: ChronoEonSettings;
  entries: import("../domain/entry").Entry[];
  preferences: AppPreferences;
  transferBusy: boolean;
  notificationPermission: NotificationPermissionState;
  shortcutStatus: "registered" | "conflict" | "unsupported" | "off";
  miniShortcutStatus: "registered" | "conflict" | "unsupported" | "off";
  initialSection?: SettingsSection;
  aiPreferences: AIProviderPreferences;
  localKeyStored: boolean;
  remoteKeyStored: boolean;
  onAIPreferencesChange: (preferences: AIProviderPreferences) => void;
  onSaveLocalKey: (value: string) => Promise<void>;
  onClearLocalKey: () => Promise<void>;
  onSaveRemoteKey: (value: string) => Promise<void>;
  onClearRemoteKey: () => Promise<void>;
  onTestAI: () => Promise<void>;
  onClose: () => void;
  onLocaleChange: (locale: Locale) => void;
  onThemeChange: (theme: ThemeMode) => void;
  onSettingsChange: (settings: ChronoEonSettings) => void;
  onReassignCategories: (sourceCategory: string, targetCategory: string) => Promise<void>;
  onPreferencesChange: (patch: Partial<AppPreferences>) => void;
  onRequestNotifications: () => void;
  onTestNotification: () => void;
  onExportEntries: () => Promise<void>;
  syncConfig: SyncConfig;
  onSyncConfigChange: (config: SyncConfig) => void;
  syncService: ReturnType<typeof useSyncService>;
  deletedEntries: DeletedEntrySummary[];
  recycleBusy: string;
  onRestoreDeleted: (id: string) => Promise<void>;
  onClearDeleted: () => Promise<void>;
  /** Sync runs in Rust; the browser demo shows a notice instead of the panel. */
  isTauri: boolean;
}

function Toggle({ checked, onChange, label, detail, blocked = false }: { checked: boolean; onChange: (value: boolean) => void; label: string; detail?: string; blocked?: boolean }) {
  return (
    <label className={blocked ? "settings-toggle-row is-blocked" : "settings-toggle-row"}>
      <span className="settings-option-copy"><strong>{label}</strong>{detail && <small>{detail}</small>}</span>
      <span className={checked ? "settings-switch is-on" : "settings-switch"} aria-hidden="true"><i /></span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} aria-label={label} />
    </label>
  );
}

function Segmented({ options, value, onChange }: { options: Array<{ value: string; label: string }>; value: string; onChange: (value: string) => void }) {
  return (
    <div className="settings-segmented" role="group">
      {options.map((option) => <button key={option.value} type="button" className={option.value === value ? "is-active" : ""} onClick={() => onChange(option.value)} aria-pressed={option.value === value}>{option.label}</button>)}
    </div>
  );
}

/** The application-level keys wired in App.tsx, surfaced where users look. */
const shortcutReference: Array<{ key: MessageKey; combo: string }> = [
  { key: "shortcutNewEntry", combo: "N" },
  { key: "shortcutTimer", combo: "T" },
  { key: "shortcutSearch", combo: "Control+F" },
  { key: "shortcutSettings", combo: "CommandOrControl+," },
  { key: "shortcutClose", combo: "Esc" },
  { key: "shortcutMiniWindow", combo: "CommandOrControl+Shift+M" },
  { key: "shortcutMiniPresets", combo: "CommandOrControl+1–4" },
];



function SectionHeading({ title, detail }: { title: string; detail: string }) {
  return <header className="settings-section-heading"><h3>{title}</h3><p>{detail}</p></header>;
}

export function SettingsDialog({
  locale,
  theme,
  settings,
  entries,
  preferences,
  transferBusy,
  notificationPermission,
  shortcutStatus,
  miniShortcutStatus,
  initialSection = "general",
  aiPreferences,
  localKeyStored,
  remoteKeyStored,
  onAIPreferencesChange,
  onSaveLocalKey,
  onClearLocalKey,
  onSaveRemoteKey,
  onClearRemoteKey,
  onTestAI,
  onClose,
  onLocaleChange,
  onThemeChange,
  onSettingsChange,
  onReassignCategories,
  onPreferencesChange,
  onRequestNotifications,
  onTestNotification,
  onExportEntries,
  syncConfig,
  onSyncConfigChange,
  syncService,
  deletedEntries,
  recycleBusy,
  onRestoreDeleted,
  onClearDeleted,
  isTauri,
}: SettingsDialogProps) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const isTouchDevice = useTouchDevice();
  const [shortcutDraft, setShortcutDraft] = useState(preferences.captureShortcut);
  const [miniShortcutDraft, setMiniShortcutDraft] = useState(preferences.miniShortcut);
  const patch = (change: (current: ChronoEonSettings) => ChronoEonSettings) => onSettingsChange(change(settings));
  const activeCalendar = settings.calendars.find((calendar) => calendar.id === settings.defaultCalendarID) ?? settings.calendars[0];
  const updateCalendar = (id: string, change: (calendar: CalendarConfig) => CalendarConfig) => {
    patch((current) => ({
      ...current,
      calendars: current.calendars.map((calendar) => calendar.id === id ? change(calendar) : calendar),
    }));
  };
  const updateCalendarCategories = (categories: import("./CategoryCatalogManager").EditableCategory[]) => {
    if (!activeCalendar) return;
    patch((current) => ({
      ...current,
      calendars: current.calendars.map((calendar) => calendar.id === activeCalendar.id
        ? { ...calendar, categories }
        : calendar),
    }));
  };
  const deleteCalendarCategory = (id: string) => {
    patch((current) => ({
      ...current,
      calendars: current.calendars.map((calendar) => {
        if (calendar.id !== activeCalendar?.id || calendar.categories.length < 2) return calendar;
        const categories = calendar.categories.filter((category) => category.id !== id);
        return { ...calendar, categories, defaultCategoryId: calendar.defaultCategoryId === id ? categories[0].id : calendar.defaultCategoryId };
      }),
    }));
  };
  const setDefaultCalendarCategory = (id: string) => {
    if (!activeCalendar) return;
    updateCalendar(activeCalendar.id, (calendar) => ({ ...calendar, defaultCategoryId: id }));
  };
  const calendarCategoryCounts = Object.fromEntries((activeCalendar?.categories ?? []).map((category) => [
    category.id,
    entries.filter((entry) => entry.kind !== "bill" && (entry.category === category.id || entry.category === category.name)).length,
  ]));
  const calendarReassignOptions = (activeCalendar?.categories ?? []).map((category) => ({
    value: category.id,
    label: category.name,
    color: category.color,
  }));
  const updateBillCategories = (categories: import("./CategoryCatalogManager").EditableCategory[]) => {
    patch((current) => ({
      ...current,
      bill: {
        ...current.bill,
        categories: categories.map((category) => ({
          id: category.id,
          name: category.name,
          color: category.color,
          direction: category.direction ?? "expense",
          sub: category.sub ?? [],
        })),
      },
    }));
  };
  const setDefaultBillCategory = (id: string) => {
    const primary = settings.bill.categories.find((category) => category.id === id);
    if (!primary) return;
    const sub = primary.sub.includes(settings.bill.defaultSubCategoryId)
      ? settings.bill.defaultSubCategoryId
      : primary.sub[0];
    patch((current) => ({ ...current, bill: { ...current.bill, defaultCategoryId: id, defaultSubCategoryId: sub ?? "" } }));
  };
  const billCategoryCounts = Object.fromEntries(settings.bill.categories.map((category) => [
    category.id,
    entries.filter((entry) => entry.kind === "bill" && entry.category.split("/")[0] === category.name).length,
  ]));
  const billReassignOptions = settings.bill.categories.map((category) => {
    const sub = category.sub.includes(settings.bill.defaultSubCategoryId)
      ? settings.bill.defaultSubCategoryId
      : category.sub[0];
    return {
      value: sub ? `${category.name}/${sub}` : category.name,
      label: compositeCategoryLabel(sub ? `${category.name}/${sub}` : category.name, locale),
      color: category.color,
    };
  });
  const reassignBillCategory = async (id: string, target: string) => {
    const source = settings.bill.categories.find((category) => category.id === id)?.name;
    if (source) await onReassignCategories(source, target);
  };
  const deleteBillCategory = (id: string) => {
    patch((current) => {
      if (current.bill.categories.length < 2) return current;
      const categories = current.bill.categories.filter((category) => category.id !== id);
      const primary = categories.find((category) => category.id === current.bill.defaultCategoryId) ?? categories[0];
      return {
        ...current,
        bill: {
          ...current.bill,
          categories,
          defaultCategoryId: primary.id,
          defaultSubCategoryId: primary.sub.includes(current.bill.defaultSubCategoryId) ? current.bill.defaultSubCategoryId : primary.sub[0] ?? "",
        },
      };
    });
  };

  // Escape closes the dialog (it used to be impossible to close from the
  // keyboard at all, and a stray window-wide handler could race it).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => registerModalDismiss((event) => {
    event.preventDefault();
    closeRef.current();
  }), []);

  const sectionItems: Array<{ id: SettingsSection; icon: "settings" | "calendar" | "bell" | "sparkle" | "download" | "refresh"; label: MessageKey }> = [
    { id: "general", icon: "settings", label: "settingsGeneral" },
    { id: "calendar", icon: "calendar", label: "settingsCalendar" },
    { id: "reminders", icon: "bell", label: "remindersSetting" },
    { id: "ai", icon: "sparkle", label: "settingsAI" },
    { id: "data", icon: "refresh", label: "settingsData" },
  ];
  const permissionLabel: MessageKey = notificationPermission === "granted"
    ? "notificationsGranted"
    : notificationPermission === "unsupported"
      ? "notificationsUnsupported"
      : "notificationsDenied";
  const shortcutValid = isValidAccelerator(shortcutDraft);
  const miniShortcutValid = isValidAccelerator(miniShortcutDraft);
  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="settings-header">
          <div><span className="settings-eyebrow">{t("productName", locale)} · {t("settings", locale)}</span><h2 id="settings-title">{t("settingsTitle", locale)}</h2><p>{t("settingsDetail", locale)}</p></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t("close", locale)} autoFocus><Icon name="close" /></button>
        </header>
        <div className="settings-body">
          <nav className="settings-nav" aria-label={t("settings", locale)}>
            {sectionItems.map((item) => <button key={item.id} type="button" className={section === item.id ? "is-active" : ""} onClick={() => setSection(item.id)}><Icon name={item.icon} size={17} /><span>{t(item.label, locale)}</span></button>)}
          </nav>
          <div className="settings-content">
            {section === "general" && <>
              <SectionHeading title={t("settingsGeneral", locale)} detail={t("settingsAutoSaved", locale)} />
              <div className="settings-card">
                <div className="settings-option"><div className="settings-option-copy"><strong>{t("languageSetting", locale)}</strong><small>{t("languageSettingDetail", locale)}</small></div><Segmented value={locale} onChange={(value) => onLocaleChange(value as Locale)} options={[{ value: "zh", label: t("simplifiedChinese", locale) }, { value: "en", label: t("english", locale) }]} /></div>
                <div className="settings-option"><div className="settings-option-copy"><strong>{t("appearance", locale)}</strong><small>{t("appearanceDetail", locale)}</small></div><Segmented value={theme} onChange={(value) => onThemeChange(value as ThemeMode)} options={[{ value: "light", label: t("lightOption", locale) }, { value: "dark", label: t("darkOption", locale) }]} /></div>
                <Toggle checked={preferences.lowEndMode} onChange={(value) => onPreferencesChange({ lowEndMode: value })} label={t("lowEndMode", locale)} detail={t("lowEndModeDetail", locale)} />
                <div className="settings-option settings-accent-option"><div className="settings-option-copy"><strong>{t("accentTheme", locale)}</strong><small>{t("accentThemeDetail", locale)}</small></div><div className="accent-theme-options" role="radiogroup" aria-label={t("accentTheme", locale)}>{(["terracotta", "jade", "ocean", "violet"] as AccentTheme[]).map((accent) => <button key={accent} type="button" role="radio" aria-checked={preferences.accentTheme === accent} className={preferences.accentTheme === accent ? `accent-swatch accent-swatch--${accent} is-active` : `accent-swatch accent-swatch--${accent}`} onClick={() => onPreferencesChange({ accentTheme: accent })}><i />{t(`accent${accent[0].toUpperCase()}${accent.slice(1)}` as MessageKey, locale)}</button>)}</div></div>
              </div>

              {!isTouchDevice && (
                <>
                  <SectionHeading title={t("shortcutsTitle", locale)} detail={t("shortcutsDetail", locale)} />
                  <div className="settings-card">
                    <ul className="settings-shortcut-list">
                      {shortcutReference.map((item) => (
                        <li key={item.key}><span>{t(item.key, locale)}</span><kbd>{formatAccelerator(item.combo)}</kbd></li>
                      ))}
                      <li><span>{t("globalCapture", locale)}</span><kbd>{formatAccelerator(preferences.captureShortcut)}</kbd></li>
                    </ul>
                  </div>
                </>
              )}
            </>}

            {section === "calendar" && <>
              <SectionHeading title={t("calendarPreferences", locale)} detail={t("calendarPreferencesDetail", locale)} />
              <div className="settings-card">
                <label className="settings-field"><span>{t("weekStartsOn", locale)}</span>
                  <GlassSelect
                    value={String(settings.firstDay)}
                    ariaLabel={t("weekStartsOn", locale)}
                    options={[
                      { value: "1", label: t("monday", locale) },
                      { value: "2", label: t("tuesday", locale) },
                      { value: "3", label: t("wednesday", locale) },
                      { value: "4", label: t("thursday", locale) },
                      { value: "5", label: t("friday", locale) },
                      { value: "6", label: t("saturday", locale) },
                      { value: "0", label: t("sunday", locale) },
                    ]}
                    onChange={(value) => patch((current) => ({ ...current, firstDay: Number(value) as ChronoEonSettings["firstDay"] }))}
                  />
                </label>
                <label className="settings-field"><span>{t("timeScale", locale)}</span>
                  <GlassSelect
                    value={String(settings.timeScale)}
                    ariaLabel={t("timeScale", locale)}
                    options={[10, 15, 20, 30, 60].map((minutes) => ({ value: String(minutes), label: `${minutes} ${t("minutes", locale)}` }))}
                    onChange={(value) => patch((current) => ({ ...current, timeScale: Number(value) as ChronoEonSettings["timeScale"] }))}
                  />
                </label>
                <Toggle checked={settings.showWeekNumbers} onChange={(value) => patch((current) => ({ ...current, showWeekNumbers: value }))} label={t("showWeekNumbers", locale)} detail={t("showWeekNumbersDetail", locale)} />
                <Toggle checked={settings.locationAutofill} onChange={(value) => patch((current) => ({ ...current, locationAutofill: value }))} label={t("locationAutofill", locale)} detail={t("locationAutofillDetail", locale)} />
                <div className="settings-option"><div className="settings-option-copy"><strong>{t("lunarSetting", locale)}</strong><small>{t("lunarSettingDetail", locale)}</small></div><Segmented value={preferences.lunar} onChange={(value) => onPreferencesChange({ lunar: value as LunarPreference })} options={[{ value: "auto", label: t("lunarAuto", locale) }, { value: "always", label: t("lunarAlways", locale) }, { value: "never", label: t("lunarNever", locale) }]} /></div>
                <Toggle checked={preferences.dayPhotos} onChange={(value) => onPreferencesChange({ dayPhotos: value })} label={t("dayPhotosSetting", locale)} detail={t("dayPhotosSettingDetail", locale)} />
                <label className="settings-field"><span>{t("photoDisplayMode", locale)}</span>
                  <GlassSelect
                    value={settings.photoDisplayMode}
                    ariaLabel={t("photoDisplayMode", locale)}
                    options={[
                      { value: "first", label: t("photoFirst", locale) },
                      { value: "stable-random", label: t("photoStableRandom", locale) },
                      { value: "slideshow", label: t("photoSlideshow", locale) },
                    ]}
                    onChange={(value) => patch((current) => ({ ...current, photoDisplayMode: value as ChronoEonSettings["photoDisplayMode"] }))}
                  />
                </label>
              </div>

              <SectionHeading title={t("calendarManagement", locale)} detail={t("calendarManagementDetail", locale)} />
              <div className="settings-card settings-color-card">
                <CalendarCatalogManager
                  locale={locale}
                  label={t("calendarManagement", locale)}
                  calendars={settings.calendars}
                  defaultCalendarId={settings.defaultCalendarID}
                  onChange={(calendars) => patch((current) => ({ ...current, calendars }))}
                  onDelete={(id) => patch((current) => ({
                    ...current,
                    calendars: current.calendars.filter((calendar) => calendar.id !== id),
                  }))}
                  onSetDefault={(id) => patch((current) => ({ ...current, defaultCalendarID: id }))}
                />
              </div>

              {activeCalendar && (
                <>
                  <SectionHeading title={t("categoryColors", locale)} detail={t("categoryCatalogDetail", locale)} />
              <div className="settings-card settings-color-card">
                  <h4 className="settings-color-subheading">{t("categoryColorCalendar", locale)}</h4>
                  <CategoryCatalogManager
                      locale={locale}
                      label={t("categoryColorCalendar", locale)}
                      mode="calendar"
                      categories={activeCalendar.categories}
                      onChange={updateCalendarCategories}
                      onDelete={deleteCalendarCategory}
                      entryCounts={calendarCategoryCounts}
                      defaultCategoryId={activeCalendar.defaultCategoryId}
                      reassignOptions={calendarReassignOptions}
                      reassignTarget={activeCalendar.defaultCategoryId}
                      onSetDefault={setDefaultCalendarCategory}
                      onReassignDelete={(id, target) => onReassignCategories(id, target)}
                    />
                    <div className="settings-color-divider" role="presentation" />
                    <h4 className="settings-color-subheading">{t("categoryColorBill", locale)}</h4>
                    <CategoryCatalogManager
                      locale={locale}
                      label={t("categoryColorBill", locale)}
                      mode="bill"
                      categories={settings.bill.categories}
                      onChange={updateBillCategories}
                      onDelete={deleteBillCategory}
                      entryCounts={billCategoryCounts}
                      defaultCategoryId={settings.bill.defaultCategoryId}
                      defaultSubCategoryId={settings.bill.defaultSubCategoryId}
                      reassignOptions={billReassignOptions}
                      reassignTarget={billReassignOptions.find((option) => option.value.startsWith(
                        settings.bill.categories.find((category) => category.id === settings.bill.defaultCategoryId)?.name ?? ""
                      ))?.value ?? billReassignOptions[0]?.value ?? ""}
                      onSetDefault={setDefaultBillCategory}
                      onReassignDelete={(id, target) => reassignBillCategory(id, target)}
                    />
                  </div>
                </>
              )}
            </>}

            {section === "reminders" && <>
              <SectionHeading title={t("remindersSetting", locale)} detail={t("remindersSettingDetail", locale)} />
              <div className="settings-card">
                <Toggle
                  checked={preferences.remindersEnabled}
                  onChange={(value) => { onPreferencesChange({ remindersEnabled: value }); if (value) onRequestNotifications(); }}
                  label={t("remindersSetting", locale)}
                  detail={t("remindersSettingDetail", locale)}
                />
                <div className="settings-option">
                  <div className="settings-option-copy"><strong>{t("systemNotifications", locale)}</strong><small>{t("systemNotificationsDetail", locale)} · {t(permissionLabel, locale)}</small></div>
                  <div className="settings-inline-actions">
                    <button type="button" className="secondary-button" disabled={notificationPermission === "granted" || notificationPermission === "unsupported"} onClick={onRequestNotifications}>
                      <Icon name="bell" size={15} />{t("enableNotifications", locale)}
                    </button>
                    <button type="button" className="secondary-button" onClick={onTestNotification}>
                      <Icon name="sparkle" size={15} />{t("testNotification", locale)}
                    </button>
                  </div>
                </div>
              </div>

              {backgroundTimingSupported() && <BackgroundTimingSettings locale={locale} />}

              {!isTouchDevice && (
                <>
              <SectionHeading title={t("globalCapture", locale)} detail={t("globalCaptureDetail", locale)} />
              <div className="settings-card">
                <Toggle checked={preferences.captureShortcutEnabled} onChange={(value) => onPreferencesChange({ captureShortcutEnabled: value })} label={t("globalCapture", locale)} detail={shortcutStatus === "unsupported" ? t("globalCaptureUnavailable", locale) : shortcutStatus === "conflict" ? t("globalCaptureConflict", locale) : t("globalCaptureRegistered", locale)} />
                <div className="settings-option">
                  <div className="settings-option-copy">
                    <strong>{t("globalCaptureEdit", locale)}</strong>
                    <small><kbd>{formatAccelerator(preferences.captureShortcut)}</kbd></small>
                  </div>
                  <div className="settings-inline-actions">
                    <input
                      className="settings-shortcut-input"
                      value={shortcutDraft}
                      aria-label={t("globalCaptureEdit", locale)}
                      aria-invalid={!shortcutValid}
                      onChange={(event) => setShortcutDraft(event.target.value)}
                      onBlur={() => { if (shortcutValid) onPreferencesChange({ captureShortcut: shortcutDraft }); else setShortcutDraft(preferences.captureShortcut); }}
                      disabled={!preferences.captureShortcutEnabled || shortcutStatus === "unsupported"}
                    />
                    <button type="button" className="icon-button" title={t("filterReset", locale)} aria-label={t("filterReset", locale)} onClick={() => { setShortcutDraft(DEFAULT_CAPTURE_SHORTCUT); onPreferencesChange({ captureShortcut: DEFAULT_CAPTURE_SHORTCUT }); }}>
                      <Icon name="refresh" size={16} />
                    </button>
                  </div>
                </div>
              </div>

              <SectionHeading title={t("globalMini", locale)} detail={t("globalMiniDetail", locale)} />
              <div className="settings-card">
                <Toggle checked={preferences.miniShortcutEnabled} onChange={(value) => onPreferencesChange({ miniShortcutEnabled: value })} label={t("globalMini", locale)} detail={miniShortcutStatus === "unsupported" ? t("globalCaptureUnavailable", locale) : miniShortcutStatus === "conflict" ? t("globalCaptureConflict", locale) : t("globalCaptureRegistered", locale)} />
                <div className="settings-option">
                  <div className="settings-option-copy">
                    <strong>{t("globalMiniEdit", locale)}</strong>
                    <small><kbd>{formatAccelerator(preferences.miniShortcut)}</kbd></small>
                  </div>
                  <div className="settings-inline-actions">
                    <input
                      className="settings-shortcut-input"
                      value={miniShortcutDraft}
                      aria-label={t("globalMiniEdit", locale)}
                      aria-invalid={!miniShortcutValid}
                      onChange={(event) => setMiniShortcutDraft(event.target.value)}
                      onBlur={() => { if (miniShortcutValid) onPreferencesChange({ miniShortcut: miniShortcutDraft }); else setMiniShortcutDraft(preferences.miniShortcut); }}
                      disabled={!preferences.miniShortcutEnabled || miniShortcutStatus === "unsupported"}
                    />
                    <button type="button" className="icon-button" title={t("filterReset", locale)} aria-label={t("filterReset", locale)} onClick={() => { setMiniShortcutDraft(DEFAULT_MINI_SHORTCUT); onPreferencesChange({ miniShortcut: DEFAULT_MINI_SHORTCUT }); }}>
                      <Icon name="refresh" size={16} />
                    </button>
                  </div>
                </div>
              </div>
                </>
              )}
            </>}

            {section === "ai" && (
              <AISettingsPanel
                locale={locale}
                preferences={aiPreferences}
                localKeyStored={localKeyStored}
                remoteKeyStored={remoteKeyStored}
                onChange={onAIPreferencesChange}
                onSaveLocalKey={onSaveLocalKey}
                onClearLocalKey={onClearLocalKey}
                onSaveRemoteKey={onSaveRemoteKey}
                onClearRemoteKey={onClearRemoteKey}
                onTest={onTestAI}
              />
            )}

            {section === "data" && <>
              <SectionHeading title={t("settingsData", locale)} detail={t("syncDataNote", locale)} />
              <div className="settings-card settings-data-card">
                <div className="settings-data-block"><div className="settings-option-copy"><strong>{t("exportEntries", locale)}</strong><small>{t("entriesCsvDetail", locale)}</small></div><button type="button" className="secondary-button" disabled={transferBusy} onClick={() => void onExportEntries()}><Icon name="download" size={15} />{transferBusy ? t("importExportBusy", locale) : t("exportEntries", locale)}</button></div>
              </div>
              <SectionHeading title={t("recycleBin", locale)} detail={t("recycleBinDetail", locale)} />
              <div className="settings-card recycle-bin">
                {deletedEntries.length === 0 ? (
                  <p className="settings-footnote">{t("recycleBinEmpty", locale)}</p>
                ) : (
                  <>
                    <ul className="recycle-bin-list">
                      {deletedEntries.map((item) => (
                        <li key={item.id}>
                          <span>
                            <strong>{titleFor(item.entry, locale)}</strong>
                            <small>{item.entry.date} · {new Date(item.deletedAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US")}</small>
                          </span>
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={Boolean(recycleBusy)}
                            onClick={() => void onRestoreDeleted(item.id)}
                          >
                            <Icon name="restore" size={14} />{recycleBusy === item.id ? t("saving", locale) : t("undo", locale)}
                          </button>
                        </li>
                      ))}
                    </ul>
                    <button type="button" className="secondary-button recycle-bin-clear" disabled={Boolean(recycleBusy)} onClick={() => void onClearDeleted()}>
                      <Icon name="trash" size={14} />{t("recycleBinClear", locale)}
                    </button>
                  </>
                )}
              </div>
              {isTauri
                ? <SyncSettingsPanel entries={entries} locale={locale} config={syncConfig} onChange={onSyncConfigChange} service={syncService} />
                : <div className="settings-card"><p className="settings-footnote">{t("syncNeedsTauri", locale)}</p></div>}
            </>}
          </div>
        </div>
        <footer className="settings-footer"><span>{t("settingsAutoSaved", locale)}</span><button type="button" className="primary-action" onClick={onClose}>{t("close", locale)}<Icon name="arrow-right" size={15} /></button></footer>
      </section>
    </div>
  );
}
