import { CATEGORY_COLORS, type EntryKind, type Locale } from "./entry";

export interface ColorPreset {
  nameZh: string;
  nameEn: string;
  hex: string;
  group: "light" | "dark";
}

export interface CalendarCategory {
  id: string;
  name: string;
  color: string;
}

export interface BillPrimaryCategory {
  id: string;
  name: string;
  color: string;
  /** Canonical cash-flow direction; the stored bill amount is a magnitude. */
  direction: "income" | "expense";
  sub: string[];
}

export interface CalendarConfig {
  id: string;
  name: string;
  color: string;
  textColor: string;
  folder: string;
  categories: CalendarCategory[];
  defaultCategoryId: string;
  billCategories?: BillPrimaryCategory[];
  provider?: string;
  externalId?: string;
}

export interface BillConfig {
  categories: BillPrimaryCategory[];
  defaultCategoryId: string;
  defaultSubCategoryId: string;
  currency: string;
  customCurrencies: Record<string, string>;
  paymentMethods: string[];
}

export type PhotoDisplayMode = "first" | "stable-random" | "slideshow";

export interface ChronoEonSettings {
  settingsVersion: 1;
  language: Locale;
  firstDay: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  headingName: string;
  migrateOnModeSwitch: boolean;
  calendars: CalendarConfig[];
  defaultCalendarID: string;
  timeScale: 10 | 15 | 20 | 30 | 60;
  showWeekNumbers: boolean;
  locationAutofill: boolean;
  diaryMode: "daily" | "weekly";
  autoCreateFiles: boolean;
  autoCreateScheduleSection: boolean;
  dayViewMaxOverlapColumns: 2 | 3 | 4 | 5;
  photoDisplayMode: PhotoDisplayMode;
  bill: BillConfig;
}

export interface CurrencyDefinition {
  symbol: string;
  name: string;
  nameEn: string;
}

export interface EntryCategoryOption {
  value: string;
  label: string;
  color?: string;
  group?: string;
}

export const PRESET_COLORS: ColorPreset[] = [
  { nameZh: "藕色", nameEn: "Lotus", hex: "#edd1d8", group: "light" },
  { nameZh: "杏色", nameEn: "Apricot", hex: "#fab27b", group: "light" },
  { nameZh: "白绿", nameEn: "Pale Green", hex: "#cde6c7", group: "light" },
  { nameZh: "浅绿", nameEn: "Light Green", hex: "#84bf96", group: "light" },
  { nameZh: "若竹色", nameEn: "Bamboo", hex: "#65c294", group: "light" },
  { nameZh: "水色", nameEn: "Aqua", hex: "#afdfe4", group: "light" },
  { nameZh: "空色", nameEn: "Sky", hex: "#90d7ec", group: "light" },
  { nameZh: "勿忘草色", nameEn: "Forget-me-not", hex: "#7bbfea", group: "light" },
  { nameZh: "露草色", nameEn: "Dayflower", hex: "#33a3dc", group: "light" },
  { nameZh: "藤色", nameEn: "Wisteria", hex: "#afb4db", group: "light" },
  { nameZh: "藤紫", nameEn: "Wisteria Purple", hex: "#9b95c9", group: "light" },
  { nameZh: "莹白", nameEn: "Crystal White", hex: "#e3f9fd", group: "light" },
  { nameZh: "象牙白", nameEn: "Ivory", hex: "#fffbf0", group: "light" },
  { nameZh: "红色", nameEn: "Red", hex: "#d71345", group: "dark" },
  { nameZh: "朱色", nameEn: "Vermilion", hex: "#f26522", group: "dark" },
  { nameZh: "橙色", nameEn: "Orange", hex: "#f47920", group: "dark" },
  { nameZh: "茶色", nameEn: "Brown", hex: "#8f4b2e", group: "dark" },
  { nameZh: "薄绿", nameEn: "Deep Green", hex: "#1d953f", group: "dark" },
  { nameZh: "绿色", nameEn: "Green", hex: "#45b97c", group: "dark" },
  { nameZh: "青色", nameEn: "Cyan", hex: "#009ad6", group: "dark" },
  { nameZh: "蓝色", nameEn: "Blue", hex: "#145b7d", group: "dark" },
  { nameZh: "桔梗", nameEn: "Bellflower", hex: "#444693", group: "dark" },
  { nameZh: "紫色", nameEn: "Purple", hex: "#8552a1", group: "dark" },
  { nameZh: "牡丹", nameEn: "Peony", hex: "#ea66a6", group: "dark" },
  { nameZh: "薄墨色", nameEn: "Light Ink", hex: "#74787c", group: "dark" },
  { nameZh: "灰色", nameEn: "Gray", hex: "#77787b", group: "dark" }
];

/**
 * Each catalog ships exactly one default category, named in the language the
 * app was first started in. Everything else is user data: renameable,
 * re-colourable and deletable, and never re-injected on load.
 */
export const DEFAULT_CATEGORY_ID = "default";
export const DEFAULT_CATEGORY_NAME: Record<Locale, string> = { en: "Default", zh: "默认分类" };
export const DEFAULT_BILL_CATEGORY_ID = "income";

export function defaultTaskCategory(locale: Locale = "en"): CalendarCategory {
  return { id: DEFAULT_CATEGORY_ID, name: DEFAULT_CATEGORY_NAME[locale], color: "#90d7ec" };
}

export function defaultTaskCategories(locale: Locale = "en"): CalendarCategory[] {
  return [defaultTaskCategory(locale)];
}

export function defaultBillCategories(locale: Locale = "en"): BillPrimaryCategory[] {
  const income = locale === "zh" ? "收入" : "Income";
  const expense = locale === "zh" ? "消费" : "Expense";
  const labels = locale === "zh"
    ? { salary: "工资", bonus: "奖金", daily: "日常", medical: "医疗" }
    : { salary: "Salary", bonus: "Bonus", daily: "Daily", medical: "Medical" };
  return [
    { id: "income", name: income, color: "#2f8f5b", direction: "income", sub: [labels.salary, labels.bonus] },
    { id: "expense", name: expense, color: "#c0392b", direction: "expense", sub: [labels.daily, labels.medical] },
  ];
}

export const BUILTIN_CURRENCIES: Record<string, CurrencyDefinition> = {
  CNY: { symbol: "￥", name: "人民币", nameEn: "Chinese yuan" },
  USD: { symbol: "$", name: "美元", nameEn: "US dollar" },
  EUR: { symbol: "€", name: "欧元", nameEn: "Euro" },
  GBP: { symbol: "￡", name: "英镑", nameEn: "British pound" },
  JPY: { symbol: "¥", name: "日元", nameEn: "Japanese yen" }
};

export const DEFAULT_PAYMENT_METHODS = ["Cash", "Alipay", "WeChat", "Credit Card", "Debit Card"];

export const DEFAULT_CHRONOEON_SETTINGS: ChronoEonSettings = {
  settingsVersion: 1,
  language: "en",
  firstDay: 1,
  headingName: "Entries",
  migrateOnModeSwitch: true,
  calendars: [
    {
      id: "default",
      name: "Default",
      color: "#90d7ec",
      textColor: "#1f2937",
      folder: "Diary",
      categories: defaultTaskCategories(),
      defaultCategoryId: DEFAULT_CATEGORY_ID,
      billCategories: defaultBillCategories()
    }
  ],
  defaultCalendarID: "default",
  timeScale: 30,
  showWeekNumbers: true,
  locationAutofill: true,
  diaryMode: "daily",
  autoCreateFiles: true,
  autoCreateScheduleSection: true,
  dayViewMaxOverlapColumns: 3,
  photoDisplayMode: "first",
  bill: {
    categories: defaultBillCategories(),
    defaultCategoryId: DEFAULT_BILL_CATEGORY_ID,
    defaultSubCategoryId: "Salary",
    currency: "CNY",
    customCurrencies: {},
    paymentMethods: DEFAULT_PAYMENT_METHODS
  }
};

/** First-run settings, with the shipped default categories named in `locale`. */
export function createDefaultSettings(locale: Locale = "en"): ChronoEonSettings {
  const settings = structuredClone(DEFAULT_CHRONOEON_SETTINGS);
  settings.language = locale;
  settings.calendars = settings.calendars.map((calendar) => ({
    ...calendar,
    categories: defaultTaskCategories(locale),
    defaultCategoryId: DEFAULT_CATEGORY_ID,
    billCategories: defaultBillCategories(locale),
  }));
  settings.bill = {
    ...settings.bill,
    categories: defaultBillCategories(locale),
    defaultCategoryId: DEFAULT_BILL_CATEGORY_ID,
    defaultSubCategoryId: defaultBillCategories(locale)[0].sub[0] ?? "",
  };
  return settings;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeCategories(value: unknown, fallback: CalendarCategory[]): CalendarCategory[] {
  if (!Array.isArray(value)) return structuredClone(fallback);
  const categories = value.flatMap((candidate) => {
    const item = asRecord(candidate);
    if (typeof item.id !== "string" || typeof item.name !== "string") return [];
    return [{ id: item.id, name: item.name, color: stringValue(item.color, CATEGORY_COLORS.uncategorized) }];
  });
  return categories.length ? categories : structuredClone(fallback);
}

function normalizeBillCategories(value: unknown, fallback: BillPrimaryCategory[]): BillPrimaryCategory[] {
  if (!Array.isArray(value)) return structuredClone(fallback);
  const categories = value.flatMap((candidate) => {
    const item = asRecord(candidate);
    if (typeof item.id !== "string" || typeof item.name !== "string") return [];
    return [{
      id: item.id,
      name: item.name,
      color: stringValue(item.color, CATEGORY_COLORS.uncategorized),
      direction: item.direction === "income" ? "income" as const : "expense" as const,
      sub: Array.isArray(item.sub) ? item.sub.filter((entry): entry is string => typeof entry === "string") : []
    }];
  });
  return categories.length ? categories : structuredClone(fallback);
}

/**
 * Normalize the non-secret type/catalog portion of settings. Unknown or secret
 * fields are ignored rather than copied into application state.
 */
export function normalizeChronoEonSettings(value: unknown): ChronoEonSettings {
  const defaults = createDefaultSettings();
  const input = asRecord(value);
  const calendarsInput = Array.isArray(input.calendars) ? input.calendars : [];
  const calendars = calendarsInput.flatMap((candidate) => {
    const calendar = asRecord(candidate);
    if (typeof calendar.id !== "string") return [];
    const fallback = defaults.calendars[0];
    const categories = normalizeCategories(calendar.categories, fallback.categories);
    const persistedDefault = stringValue(calendar.defaultCategoryId, fallback.defaultCategoryId);
    const defaultCategoryId = categories.some((category) => category.id === persistedDefault)
      ? persistedDefault
      : categories[0]?.id ?? fallback.defaultCategoryId;
    return [{
      id: calendar.id,
      name: stringValue(calendar.name, calendar.id),
      color: stringValue(calendar.color, fallback.color),
      textColor: stringValue(calendar.textColor, fallback.textColor),
      folder: stringValue(calendar.folder, fallback.folder),
      categories,
      defaultCategoryId,
      billCategories: normalizeBillCategories(calendar.billCategories, defaults.bill.categories),
      provider: typeof calendar.provider === "string" ? calendar.provider : undefined,
      externalId: typeof calendar.externalId === "string" ? calendar.externalId : undefined
    }];
  });

  const billInput = asRecord(input.bill);
  const language = input.language === "zh" ? "zh" : "en";
  const firstDay = typeof input.firstDay === "number" && Number.isInteger(input.firstDay) && input.firstDay >= 0 && input.firstDay <= 6
    ? input.firstDay as ChronoEonSettings["firstDay"]
    : defaults.firstDay;
  const diaryMode = input.diaryMode === "weekly" ? "weekly" : "daily";
  const photoDisplayMode = input.photoDisplayMode === "stable-random" || input.photoDisplayMode === "slideshow"
    ? input.photoDisplayMode
    : "first";
  const allowedScale = [10, 15, 20, 30, 60] as const;
  const timeScale = allowedScale.includes(input.timeScale as typeof allowedScale[number])
    ? input.timeScale as typeof allowedScale[number]
    : defaults.timeScale;
  const paymentMethodsValue = billInput.paymentMethods ?? input.paymentMethods;
  const paymentMethods = Array.isArray(paymentMethodsValue)
    ? paymentMethodsValue.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
    : defaults.bill.paymentMethods;
  const billCategories = normalizeBillCategories(billInput.categories, defaults.bill.categories);
  const persistedBillCategoryId = stringValue(billInput.defaultCategoryId, defaults.bill.defaultCategoryId);
  const billCategoryId = billCategories.some((category) => category.id === persistedBillCategoryId)
    ? persistedBillCategoryId
    : billCategories[0]?.id ?? defaults.bill.defaultCategoryId;
  const billPrimary = billCategories.find((category) => category.id === billCategoryId);
  const billSubCategoryId = billPrimary?.sub.includes(stringValue(billInput.defaultSubCategoryId, defaults.bill.defaultSubCategoryId))
    ? stringValue(billInput.defaultSubCategoryId, defaults.bill.defaultSubCategoryId)
    : billPrimary?.sub[0] ?? "";
  const allowedColumns = [2, 3, 4, 5] as const;
  const dayViewMaxOverlapColumns = allowedColumns.includes(input.dayViewMaxOverlapColumns as typeof allowedColumns[number])
    ? input.dayViewMaxOverlapColumns as typeof allowedColumns[number]
    : defaults.dayViewMaxOverlapColumns;

  return {
    ...defaults,
    language,
    firstDay,
    headingName: stringValue(input.headingName, defaults.headingName),
    migrateOnModeSwitch: typeof input.migrateOnModeSwitch === "boolean" ? input.migrateOnModeSwitch : defaults.migrateOnModeSwitch,
    calendars: calendars.length ? calendars : defaults.calendars,
    defaultCalendarID: stringValue(input.defaultCalendarID, defaults.defaultCalendarID),
    timeScale,
    showWeekNumbers: typeof input.showWeekNumbers === "boolean" ? input.showWeekNumbers : defaults.showWeekNumbers,
    locationAutofill: typeof input.locationAutofill === "boolean" ? input.locationAutofill : defaults.locationAutofill,
    diaryMode,
    autoCreateFiles: typeof input.autoCreateFiles === "boolean" ? input.autoCreateFiles : defaults.autoCreateFiles,
    autoCreateScheduleSection: typeof input.autoCreateScheduleSection === "boolean" ? input.autoCreateScheduleSection : defaults.autoCreateScheduleSection,
    dayViewMaxOverlapColumns,
    photoDisplayMode,
    bill: {
      categories: billCategories,
      defaultCategoryId: billCategoryId,
      defaultSubCategoryId: billSubCategoryId,
      currency: stringValue(billInput.currency ?? input.currency, defaults.bill.currency).toUpperCase(),
      customCurrencies: Object.fromEntries(Object.entries(asRecord(billInput.customCurrencies ?? input.customCurrencies)).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
      paymentMethods
    }
  };
}

function selectedCalendar(settings: ChronoEonSettings, calendarId?: string): CalendarConfig {
  return settings.calendars.find((calendar) => calendar.id === (calendarId ?? settings.defaultCalendarID))
    ?? settings.calendars[0]
    ?? createDefaultSettings().calendars[0];
}

/** Canonical default category value stored for a newly-created entry. */
export function defaultCategoryForKind(
  kind: EntryKind,
  settings: ChronoEonSettings = DEFAULT_CHRONOEON_SETTINGS,
  calendarId?: string,
): string {
  if (kind === "bill") {
    const primary = settings.bill.categories.find((category) => category.id === settings.bill.defaultCategoryId)
      ?? settings.bill.categories[0];
    if (!primary) return "uncategorized";
    const sub = primary.sub.includes(settings.bill.defaultSubCategoryId)
      ? settings.bill.defaultSubCategoryId
      : primary.sub[0];
    return sub ? `${primary.name}/${sub}` : primary.name;
  }
  const calendar = selectedCalendar(settings, calendarId);
  return calendar.defaultCategoryId || calendar.categories[0]?.id || "uncategorized";
}

export function categoryOptionsForKind(
  kind: EntryKind,
  settings: ChronoEonSettings = DEFAULT_CHRONOEON_SETTINGS,
  calendarId?: string
): EntryCategoryOption[] {
  if (kind === "bill") {
    return settings.bill.categories.flatMap((category) => category.sub.length
      ? category.sub.map((sub) => ({ value: `${category.name}/${sub}`, label: sub, group: category.name, color: category.color }))
      : [{ value: category.name, label: category.name, group: category.name, color: category.color }]);
  }
  return selectedCalendar(settings, calendarId).categories.map((category) => ({
    value: category.id,
    label: category.name,
    color: category.color
  }));
}

/**
 * Filter options for the schedule catalogs. Every configured category is
 * listed by its stored name, and a value that only survives in entry rows is
 * appended verbatim so an old entry can still be filtered or unticked.
 */
export function scheduleCategoryOptions(
  settings: ChronoEonSettings = DEFAULT_CHRONOEON_SETTINGS,
  stored: string[] = []
): EntryCategoryOption[] {
  const options: EntryCategoryOption[] = [];
  const seen = new Set<string>();
  for (const calendar of settings.calendars) {
    for (const category of calendar.categories) {
      if (seen.has(category.id)) continue;
      seen.add(category.id);
      options.push({ value: category.id, label: category.name, color: category.color, group: calendar.name });
    }
  }
  const byName = new Map(settings.calendars.flatMap((calendar) => calendar.categories.map((category) => [category.name, category] as const)));
  for (const value of stored) {
    if (seen.has(value)) continue;
    const named = byName.get(value);
    if (named && seen.has(named.id)) continue;
    seen.add(value);
    options.push({ value, label: value, color: named?.color ?? CATEGORY_COLORS[value] });
  }
  return options;
}

/** Filter options for the bill catalog, grouped by primary category name. */
export function billCategoryOptions(
  settings: ChronoEonSettings = DEFAULT_CHRONOEON_SETTINGS,
  stored: string[] = []
): EntryCategoryOption[] {
  const options: EntryCategoryOption[] = [];
  const seen = new Set<string>();
  for (const category of settings.bill.categories) {
    if (!category.sub.length) {
      if (seen.has(category.name)) continue;
      seen.add(category.name);
      options.push({ value: category.name, label: category.name, color: category.color, group: category.name });
      continue;
    }
    for (const sub of category.sub) {
      const value = `${category.name}/${sub}`;
      if (seen.has(value)) continue;
      seen.add(value);
      options.push({ value, label: sub, color: category.color, group: category.name });
    }
  }
  for (const value of stored) {
    if (seen.has(value)) continue;
    seen.add(value);
    const [primary, secondary] = value.split("/");
    const owner = settings.bill.categories.find((category) => category.name === primary);
    options.push({
      value,
      label: secondary ?? value,
      color: owner?.color,
      group: owner?.name ?? primary,
    });
  }
  return options;
}

export function billDirectionForCategory(
  category: string,
  settings: ChronoEonSettings = DEFAULT_CHRONOEON_SETTINGS,
): "income" | "expense" {
  const [primaryName] = category.split("/");
  const primary = settings.bill.categories.find((candidate) =>
    candidate.id.toLocaleLowerCase() === primaryName.toLocaleLowerCase()
    || candidate.name.toLocaleLowerCase() === primaryName.toLocaleLowerCase());
  return primary?.direction ?? "expense";
}

/** Bills store magnitudes; category direction is the single sign source. */
export function signedBillAmount(
  amount: number | undefined,
  category: string,
  settings: ChronoEonSettings = DEFAULT_CHRONOEON_SETTINGS,
): number | undefined {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return undefined;
  return billDirectionForCategory(category, settings) === "income" ? Math.abs(amount) : -Math.abs(amount);
}

export function resolveEntryColor(
  category: string,
  kind: EntryKind,
  settings: ChronoEonSettings = DEFAULT_CHRONOEON_SETTINGS,
  calendarId?: string
): string {
  if (kind === "bill") {
    const [primary] = category.split("/");
    const billCategory = settings.bill.categories.find((candidate) =>
      candidate.id.toLocaleLowerCase() === primary.toLocaleLowerCase()
      || candidate.name.toLocaleLowerCase() === primary.toLocaleLowerCase());
    if (billCategory) return billCategory.color;
  }

  const normalCategory = selectedCalendar(settings, calendarId).categories.find((candidate) =>
    candidate.id.toLocaleLowerCase() === category.toLocaleLowerCase()
    || candidate.name.toLocaleLowerCase() === category.toLocaleLowerCase());
  return normalCategory?.color ?? CATEGORY_COLORS[category] ?? CATEGORY_COLORS.uncategorized;
}

export function currencySymbol(code: string, settings: ChronoEonSettings = DEFAULT_CHRONOEON_SETTINGS): string {
  return settings.bill.customCurrencies[code] ?? BUILTIN_CURRENCIES[code]?.symbol ?? code;
}
