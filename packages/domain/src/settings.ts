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
  builtin?: boolean;
  builtinKey?: string;
}

export interface PaymentMethodConfig {
  id: string;
  name: string;
  builtin?: boolean;
  builtinKey?: string;
}

export interface ItemCategoryConfig {
  id: string;
  name: string;
  color: string;
  icon: string;
  builtin?: boolean;
  builtinKey?: string;
}

export interface BillPrimaryCategory {
  id: string;
  name: string;
  color: string;
  /** Canonical cash-flow direction; the stored bill amount is a magnitude. */
  direction: "income" | "expense";
  sub: string[];
  builtin?: boolean;
  builtinKey?: string;
  builtinSubKeys?: string[];
}

export interface CalendarConfig {
  id: string;
  name: string;
  color: string;
  textColor: string;
  folder: string;
  categories: CalendarCategory[];
  defaultCategoryId: string;
  billCategories: BillPrimaryCategory[];
  defaultBillCategoryId: string;
  defaultBillSubCategoryId: string;
  paymentMethods: PaymentMethodConfig[];
  defaultPaymentMethodId: string;
  itemCategories: ItemCategoryConfig[];
  defaultItemCategoryId: string;
  provider?: string;
  externalId?: string;
}

export interface BillConfig {
  currency: string;
  customCurrencies: Record<string, string>;
}

export type PhotoDisplayMode = "first" | "stable-random" | "slideshow";

export interface ChronoEonSettings {
  settingsVersion: 2;
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

export const SHARED_SETTINGS_KEYS = ["calendars", "defaultCalendarID", "bill"] as const;
export type SharedSettings = Pick<ChronoEonSettings, typeof SHARED_SETTINGS_KEYS[number]>;

/** User catalogs travel with data; presentation, input and device behavior do not. */
export function sharedSettings(settings: Partial<ChronoEonSettings>): Partial<SharedSettings> {
  return Object.fromEntries(SHARED_SETTINGS_KEYS.filter(key => settings[key] !== undefined)
    .map(key => [key, settings[key]])) as Partial<SharedSettings>;
}

export function mergeSharedSettings(local: ChronoEonSettings, remote: Partial<ChronoEonSettings>): ChronoEonSettings {
  return normalizeChronoEonSettings({ ...local, ...sharedSettings(remote) });
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
  return { id: DEFAULT_CATEGORY_ID, name: DEFAULT_CATEGORY_NAME[locale], color: "#90d7ec", builtin: true, builtinKey: "default" };
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
    { id: "income", name: income, color: "#2f8f5b", direction: "income", sub: [labels.salary, labels.bonus], builtin: true, builtinKey: "income", builtinSubKeys: ["salary", "bonus"] },
    { id: "expense", name: expense, color: "#c0392b", direction: "expense", sub: [labels.daily, labels.medical], builtin: true, builtinKey: "expense", builtinSubKeys: ["daily", "medical"] },
  ];
}

export const BUILTIN_CURRENCIES: Record<string, CurrencyDefinition> = {
  CNY: { symbol: "￥", name: "人民币", nameEn: "Chinese yuan" },
  USD: { symbol: "$", name: "美元", nameEn: "US dollar" },
  EUR: { symbol: "€", name: "欧元", nameEn: "Euro" },
  GBP: { symbol: "￡", name: "英镑", nameEn: "British pound" },
  JPY: { symbol: "¥", name: "日元", nameEn: "Japanese yen" }
};

export const DEFAULT_PAYMENT_METHODS = ["Bank Card", "Cash"];
export const ITEM_CATEGORY_IDS = ["electronics", "clothing", "home", "transport", "hobby", "other"] as const;
export const DEFAULT_ITEM_CATEGORY_IDS = ["electronics", "other"] as const;
export type ItemCategoryId = string;

const ITEM_CATEGORY_NAMES: Partial<Record<typeof ITEM_CATEGORY_IDS[number], Record<Locale, string>>> = {
  electronics: { en: "Electronics", zh: "电子产品" },
  clothing: { en: "Clothing", zh: "衣物" },
  home: { en: "Home", zh: "家居用品" },
  transport: { en: "Transport", zh: "交通工具" },
  hobby: { en: "Hobbies", zh: "兴趣爱好" },
  other: { en: "Other", zh: "其他物品" },
};

function defaultItemCategoryName(id: ItemCategoryId, locale: Locale): string {
  return ITEM_CATEGORY_NAMES[id as typeof ITEM_CATEGORY_IDS[number]]?.[locale] ?? id;
}

export function defaultPaymentMethods(locale: Locale = "en"): PaymentMethodConfig[] {
  return locale === "zh"
    ? [{ id: "bank-card", name: "银行卡", builtin: true, builtinKey: "bank-card" }, { id: "cash", name: "现金", builtin: true, builtinKey: "cash" }]
    : [{ id: "bank-card", name: "Bank Card", builtin: true, builtinKey: "bank-card" }, { id: "cash", name: "Cash", builtin: true, builtinKey: "cash" }];
}

export function defaultItemCategories(locale: Locale = "en"): ItemCategoryConfig[] {
  return [
    { id: "electronics", name: defaultItemCategoryName("electronics", locale), color: "#5b8fb9", icon: "electronics", builtin: true, builtinKey: "electronics" },
    { id: "other", name: defaultItemCategoryName("other", locale), color: "#8b8b83", icon: "other", builtin: true, builtinKey: "other" },
  ];
}

export function newCalendarCatalogs(locale: Locale, suffix: string = crypto.randomUUID()) {
  const taskCategories = defaultTaskCategories(locale).map((category) => ({ ...category, id: `task-${suffix}` }));
  const billCategories = defaultBillCategories(locale).map((category, index) => ({
    ...category,
    id: `bill-${suffix}-${index}`,
    sub: [...category.sub],
  }));
  const paymentMethods = defaultPaymentMethods(locale).map((method, index) => ({
    ...method,
    id: `payment-${suffix}-${index}`,
    builtin: true,
  }));
  const itemCategories = defaultItemCategories(locale).map((category, index) => ({
    ...category,
    id: `item-${suffix}-${index}`,
    builtin: true,
  }));
  return { taskCategories, billCategories, paymentMethods, itemCategories };
}

export const DEFAULT_CHRONOEON_SETTINGS: ChronoEonSettings = {
  settingsVersion: 2,
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
      billCategories: defaultBillCategories(),
      defaultBillCategoryId: DEFAULT_BILL_CATEGORY_ID,
      defaultBillSubCategoryId: defaultBillCategories()[0].sub[0] ?? "",
      paymentMethods: defaultPaymentMethods(),
      defaultPaymentMethodId: "bank-card",
      itemCategories: defaultItemCategories(),
      defaultItemCategoryId: "other",
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
    currency: "CNY",
    customCurrencies: {},
  },
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
    defaultBillCategoryId: DEFAULT_BILL_CATEGORY_ID,
    defaultBillSubCategoryId: defaultBillCategories(locale)[0].sub[0] ?? "",
    paymentMethods: defaultPaymentMethods(locale),
    defaultPaymentMethodId: "bank-card",
    itemCategories: defaultItemCategories(locale),
    defaultItemCategoryId: "other",
  }));
  return settings;
}

/** Translate untouched shipped catalog rows; renamed rows keep their stored text. */
export function localizeBuiltinSettings(settings: ChronoEonSettings, locale: Locale): ChronoEonSettings {
  const billDefaults = defaultBillCategories(locale);
  const paymentDefaults = defaultPaymentMethods(locale);
  const itemDefaults = defaultItemCategories(locale);
  const itemTargets = ITEM_CATEGORY_IDS.map((id) => ({
    id,
    name: defaultItemCategoryName(id, locale),
    icon: id,
  }));
  return {
    ...settings,
    language: locale,
    calendars: settings.calendars.map((calendar) => ({
      ...calendar,
      categories: calendar.categories.map((category) => category.builtin && category.builtinKey === "default"
        ? { ...category, name: DEFAULT_CATEGORY_NAME[locale] }
        : category),
      billCategories: calendar.billCategories.map((category) => {
        if (!category.builtin || !category.builtinKey) return category;
        const target = billDefaults.find((candidate) => candidate.builtinKey === category.builtinKey);
        if (!target) return category;
        return {
          ...category,
          name: target.name,
          sub: category.builtinSubKeys?.length
            ? category.sub.map((name, index) => target.sub[index] ?? name)
            : category.sub,
        };
      }),
      paymentMethods: calendar.paymentMethods.map((method) => {
        if (!method.builtin || !method.builtinKey) return method;
        const name = BUILTIN_PAYMENT_NAMES[method.builtinKey]?.[locale]
          ?? paymentDefaults.find((candidate) => candidate.builtinKey === method.builtinKey)?.name;
        return name ? { ...method, name } : method;
      }),
      itemCategories: calendar.itemCategories.map((category) => {
        if (!category.builtin || !category.builtinKey) return category;
        const target = itemTargets.find((candidate) => candidate.id === category.builtinKey)
          ?? itemDefaults.find((candidate) => candidate.builtinKey === category.builtinKey);
        return target ? { ...category, name: target.name, icon: target.icon } : category;
      }),
    })),
  };
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
    return [{
      id: item.id,
      name: item.name,
      color: stringValue(item.color, CATEGORY_COLORS.uncategorized),
      ...(item.builtin === true ? { builtin: true } : {}),
      ...(typeof item.builtinKey === "string" ? { builtinKey: item.builtinKey } : {}),
    }];
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
      sub: Array.isArray(item.sub) ? item.sub.filter((entry): entry is string => typeof entry === "string") : [],
      ...(item.builtin === true ? { builtin: true } : {}),
      ...(typeof item.builtinKey === "string" ? { builtinKey: item.builtinKey } : {}),
      ...(Array.isArray(item.builtinSubKeys)
        ? { builtinSubKeys: item.builtinSubKeys.filter((entry): entry is string => typeof entry === "string") }
        : {}),
    }];
  });
  return categories.length ? categories : structuredClone(fallback);
}

function builtinPaymentKey(name: string): string | undefined {
  const normalized = name.trim().toLocaleLowerCase();
  if (normalized === "bank card" || normalized === "bank-card") return "bank-card";
  if (normalized === "cash") return "cash";
  if (normalized === "alipay") return "alipay";
  if (normalized === "wechat") return "wechat";
  if (normalized === "credit card" || normalized === "credit-card") return "credit-card";
  if (normalized === "debit card" || normalized === "debit-card") return "debit-card";
  return undefined;
}

const BUILTIN_PAYMENT_NAMES: Record<string, Record<Locale, string>> = {
  "bank-card": { en: "Bank Card", zh: "银行卡" },
  cash: { en: "Cash", zh: "现金" },
  alipay: { en: "Alipay", zh: "支付宝" },
  wechat: { en: "WeChat", zh: "微信" },
  "credit-card": { en: "Credit Card", zh: "信用卡" },
  "debit-card": { en: "Debit Card", zh: "借记卡" },
};

function normalizePaymentMethods(value: unknown, fallback: PaymentMethodConfig[]): PaymentMethodConfig[] {
  if (!Array.isArray(value)) return structuredClone(fallback);
  const methods = value.flatMap((candidate) => {
    if (typeof candidate === "string" && candidate.trim()) {
      const name = candidate.trim();
      const builtinKey = builtinPaymentKey(name);
      return [{ id: name, name, ...(builtinKey ? { builtin: true, builtinKey } : {}) }];
    }
    const item = asRecord(candidate);
    if (typeof item.id !== "string" || !item.id.trim() || typeof item.name !== "string" || !item.name.trim()) return [];
    const id = item.id.trim();
    const name = item.name.trim();
    const builtinKey = item.builtin !== false ? builtinPaymentKey(name) ?? builtinPaymentKey(id) : undefined;
    return [{
      id,
      name,
      ...(item.builtin === true || builtinKey ? { builtin: true } : {}),
      ...(typeof item.builtinKey === "string" ? { builtinKey: item.builtinKey } : builtinKey ? { builtinKey } : {}),
    }];
  });
  return methods.length ? [...new Map(methods.map(method => [method.id, method])).values()] : structuredClone(fallback);
}

function normalizeItemCategories(value: unknown, fallback: ItemCategoryConfig[]): ItemCategoryConfig[] {
  if (!Array.isArray(value)) return structuredClone(fallback);
  const categories = value.flatMap((candidate) => {
    const item = asRecord(candidate);
    if (typeof item.id !== "string" || !item.id.trim() || typeof item.name !== "string" || !item.name.trim()) return [];
    const id = item.id.trim();
    const name = item.name.trim();
    const defaultNames = ITEM_CATEGORY_NAMES[id as typeof ITEM_CATEGORY_IDS[number]];
    const builtinKey = item.builtin !== false && defaultNames && name === defaultNames.en ? id : undefined;
    return [{
      id,
      name,
      color: stringValue(item.color, PRESET_COLORS[9].hex),
      icon: stringValue(item.icon, id),
      ...(item.builtin === true || builtinKey ? { builtin: true } : {}),
      ...(typeof item.builtinKey === "string" ? { builtinKey: item.builtinKey } : builtinKey ? { builtinKey } : {}),
    }];
  });
  return categories.length ? [...new Map(categories.map(category => [category.id, category])).values()] : structuredClone(fallback);
}

/**
 * Normalize the non-secret type/catalog portion of settings. Unknown or secret
 * fields are ignored rather than copied into application state.
 */
export function normalizeChronoEonSettings(value: unknown): ChronoEonSettings {
  const defaults = createDefaultSettings();
  const input = asRecord(value);
  const language = input.language === "zh" ? "zh" : "en";
  const billInput = asRecord(input.bill);
  const legacyBillCategories = normalizeBillCategories(billInput.categories, []);
  const legacyPaymentMethods = normalizePaymentMethods(billInput.paymentMethods ?? input.paymentMethods, defaultPaymentMethods(language));
  const legacyItemCategoriesValue = input.itemCategories;
  const legacyItemCategories = normalizeItemCategories(legacyItemCategoriesValue, defaultItemCategories(language));
  const calendarsInput = Array.isArray(input.calendars) && input.calendars.length
    ? input.calendars
    : [{
      id: stringValue(input.defaultCalendarID, defaults.defaultCalendarID),
      name: defaults.calendars[0].name,
      color: defaults.calendars[0].color,
      textColor: defaults.calendars[0].textColor,
      folder: defaults.calendars[0].folder,
    }];
  const calendars = calendarsInput.flatMap((candidate) => {
    const calendar = asRecord(candidate);
    if (typeof calendar.id !== "string") return [];
    const fallback = defaults.calendars[0];
    const categories = normalizeCategories(calendar.categories, fallback.categories);
    const persistedDefault = stringValue(calendar.defaultCategoryId, fallback.defaultCategoryId);
    const defaultCategoryId = categories.some((category) => category.id === persistedDefault)
      ? persistedDefault
      : categories[0]?.id ?? fallback.defaultCategoryId;
    const billCategories = normalizeBillCategories(calendar.billCategories, legacyBillCategories.length ? legacyBillCategories : fallback.billCategories);
    const persistedBillCategoryId = stringValue(calendar.defaultBillCategoryId ?? billInput.defaultCategoryId, billCategories[0]?.id ?? fallback.defaultBillCategoryId);
    const defaultBillCategoryId = billCategories.some((category) => category.id === persistedBillCategoryId)
      ? persistedBillCategoryId
      : billCategories[0]?.id ?? fallback.defaultBillCategoryId;
    const billPrimary = billCategories.find((category) => category.id === defaultBillCategoryId);
    const persistedBillSubCategoryId = stringValue(calendar.defaultBillSubCategoryId ?? billInput.defaultSubCategoryId, billPrimary?.sub[0] ?? "");
    const defaultBillSubCategoryId = billPrimary?.sub.includes(persistedBillSubCategoryId)
      ? persistedBillSubCategoryId
      : billPrimary?.sub[0] ?? "";
    const paymentMethods = normalizePaymentMethods(calendar.paymentMethods, legacyPaymentMethods.length ? legacyPaymentMethods : fallback.paymentMethods);
    const persistedPaymentMethod = stringValue(calendar.defaultPaymentMethodId ?? billInput.defaultPaymentMethod, paymentMethods[0]?.id ?? "");
    const defaultPaymentMethodId = paymentMethods.some((method) => method.id === persistedPaymentMethod)
      ? persistedPaymentMethod
      : paymentMethods[0]?.id ?? "";
    const itemCategories = normalizeItemCategories(calendar.itemCategories, legacyItemCategories.length ? legacyItemCategories : fallback.itemCategories);
    const persistedItemCategoryId = stringValue(calendar.defaultItemCategoryId ?? input.defaultItemCategoryId, itemCategories[0]?.id ?? "");
    const defaultItemCategoryId = itemCategories.some((category) => category.id === persistedItemCategoryId)
      ? persistedItemCategoryId
      : itemCategories[0]?.id ?? "";
    return [{
      id: calendar.id,
      name: stringValue(calendar.name, calendar.id),
      color: stringValue(calendar.color, fallback.color),
      textColor: stringValue(calendar.textColor, fallback.textColor),
      folder: stringValue(calendar.folder, fallback.folder),
      categories,
      defaultCategoryId,
      billCategories,
      defaultBillCategoryId,
      defaultBillSubCategoryId,
      paymentMethods,
      defaultPaymentMethodId,
      itemCategories,
      defaultItemCategoryId,
      provider: typeof calendar.provider === "string" ? calendar.provider : undefined,
      externalId: typeof calendar.externalId === "string" ? calendar.externalId : undefined
    }];
  });

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
  const allowedColumns = [2, 3, 4, 5] as const;
  const dayViewMaxOverlapColumns = allowedColumns.includes(input.dayViewMaxOverlapColumns as typeof allowedColumns[number])
    ? input.dayViewMaxOverlapColumns as typeof allowedColumns[number]
    : defaults.dayViewMaxOverlapColumns;

  const normalized: ChronoEonSettings = {
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
      currency: stringValue(billInput.currency ?? input.currency, defaults.bill.currency).toUpperCase(),
      customCurrencies: Object.fromEntries(Object.entries(asRecord(billInput.customCurrencies ?? input.customCurrencies)).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    }
  };
  return localizeBuiltinSettings(normalized, language);
}

export function selectedCalendar(settings: ChronoEonSettings, calendarId?: string): CalendarConfig {
  return settings.calendars.find((calendar) => calendar.id === (calendarId ?? settings.defaultCalendarID))
    ?? settings.calendars[0]
    ?? createDefaultSettings().calendars[0];
}

export function billCategoriesForCalendar(settings: ChronoEonSettings, calendarId?: string): BillPrimaryCategory[] {
  return selectedCalendar(settings, calendarId).billCategories;
}

export function paymentMethodsForCalendar(settings: ChronoEonSettings, calendarId?: string): PaymentMethodConfig[] {
  return selectedCalendar(settings, calendarId).paymentMethods;
}

export function defaultPaymentMethodForCalendar(settings: ChronoEonSettings, calendarId?: string): string {
  const calendar = selectedCalendar(settings, calendarId);
  return calendar.defaultPaymentMethodId || calendar.paymentMethods[0]?.id || "";
}

export function itemCategoriesForCalendar(settings: ChronoEonSettings, calendarId?: string): ItemCategoryConfig[] {
  return selectedCalendar(settings, calendarId).itemCategories;
}

export function defaultItemCategoryForCalendar(settings: ChronoEonSettings, calendarId?: string): string {
  const calendar = selectedCalendar(settings, calendarId);
  return calendar.defaultItemCategoryId || calendar.itemCategories[0]?.id || "";
}

export function allBillCategories(settings: ChronoEonSettings): BillPrimaryCategory[] {
  return [...new Map(settings.calendars.flatMap(calendar => calendar.billCategories).map(category => [category.id, category])).values()];
}

export function allItemCategories(settings: ChronoEonSettings): ItemCategoryConfig[] {
  return [...new Map(settings.calendars.flatMap(calendar => calendar.itemCategories).map(category => [category.id, category])).values()];
}

/** Canonical default category value stored for a newly-created entry. */
export function defaultCategoryForKind(
  kind: EntryKind,
  settings: ChronoEonSettings = DEFAULT_CHRONOEON_SETTINGS,
  calendarId?: string,
): string {
  if (kind === "bill") {
    const calendar = selectedCalendar(settings, calendarId);
    const primary = calendar.billCategories.find((category) => category.id === calendar.defaultBillCategoryId)
      ?? calendar.billCategories[0];
    if (!primary) return "uncategorized";
    const sub = primary.sub.includes(calendar.defaultBillSubCategoryId)
      ? calendar.defaultBillSubCategoryId
      : primary.sub[0];
    return sub ? `${primary.id}/${sub}` : primary.id;
  }
  const calendar = selectedCalendar(settings, calendarId);
  return calendar.defaultCategoryId || calendar.categories[0]?.id || "uncategorized";
}

export function categoryOptionsForKind(
  kind: EntryKind,
  settings: ChronoEonSettings = DEFAULT_CHRONOEON_SETTINGS,
  calendarId?: string
): EntryCategoryOption[] {
  if (kind === "bill") return billCategoryOptions(settings, [], calendarId);
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

/** IDs identify catalogs even when their display names coincide. */
export function billCategoryForValue(
  value: string,
  settings: ChronoEonSettings = DEFAULT_CHRONOEON_SETTINGS,
  calendarId?: string,
): BillPrimaryCategory | undefined {
  const primary = value.split("/")[0].toLocaleLowerCase();
  const categories = billCategoriesForCalendar(settings, calendarId);
  return categories.find((category) => category.id.toLocaleLowerCase() === primary)
    ?? categories.find((category) => category.name.toLocaleLowerCase() === primary);
}

/** Filter options use stable parent IDs, grouped by user-owned display names. */
export function billCategoryOptions(
  settings: ChronoEonSettings = DEFAULT_CHRONOEON_SETTINGS,
  stored: string[] = [],
  calendarId?: string,
): EntryCategoryOption[] {
  const categories = billCategoriesForCalendar(settings, calendarId);
  const options: EntryCategoryOption[] = [];
  const seen = new Set<string>();
  for (const category of categories) {
    if (!category.sub.length) {
      if (seen.has(category.id)) continue;
      seen.add(category.id);
      options.push({ value: category.id, label: category.name, color: category.color, group: category.name });
      continue;
    }
    for (const sub of category.sub) {
      const value = `${category.id}/${sub}`;
      if (seen.has(value)) continue;
      seen.add(value);
      options.push({ value, label: sub, color: category.color, group: category.name });
    }
  }
  for (const value of stored) {
    if (seen.has(value)) continue;
    seen.add(value);
    const [primary, secondary] = value.split("/");
    const owner = billCategoryForValue(value, settings, calendarId);
    options.push({
      value,
      label: secondary || owner?.name || value,
      color: owner?.color,
      group: owner?.name ?? primary,
    });
  }
  return options;
}

export function billDirectionForCategory(
  category: string,
  settings: ChronoEonSettings = DEFAULT_CHRONOEON_SETTINGS,
  calendarId?: string,
): "income" | "expense" {
  return billCategoryForValue(category, settings, calendarId)?.direction ?? "expense";
}

/** Bills store magnitudes; category direction is the single sign source. */
export function signedBillAmount(
  amount: number | undefined,
  category: string,
  settings: ChronoEonSettings = DEFAULT_CHRONOEON_SETTINGS,
  calendarId?: string,
): number | undefined {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return undefined;
  return billDirectionForCategory(category, settings, calendarId) === "income" ? Math.abs(amount) : -Math.abs(amount);
}

export function resolveEntryColor(
  category: string,
  kind: EntryKind,
  settings: ChronoEonSettings = DEFAULT_CHRONOEON_SETTINGS,
  calendarId?: string
): string {
  if (kind === "bill") {
    const billCategory = billCategoryForValue(category, settings, calendarId);
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
