import type { EntryKind, Locale } from "../entry";
import type { CaptureHistoryItem } from "./index";
import { normalizedTitle, titleMatchScore } from "./titleMatch";

/** What the user usually records under one title: the defaults a parser or a
 *  model should reach for when the text itself gives no value. */
export interface CaptureHabitTitle {
  title: string;
  count: number;
  kind: EntryKind;
  category?: string;
  location?: string;
  /** HH:mm the user usually starts this; absent when it is mostly all-day. */
  start?: string;
  durationMinutes?: number;
  payment?: string;
  /** Typical absolute amount of a bill. */
  amount?: number;
  currency?: string;
  tags?: string[];
}

export interface CaptureHabitCount<T extends string = string> { value: T; count: number }

export interface CaptureHabits {
  total: number;
  kinds: CaptureHabitCount<EntryKind>[];
  titles: CaptureHabitTitle[];
  /** Median length of timed entries per kind. */
  durations: Partial<Record<EntryKind, number>>;
  /** Share of entries carrying a clock time per kind. */
  timedShare: Partial<Record<EntryKind, number>>;
  categories: Partial<Record<EntryKind, CaptureHabitCount[]>>;
  locations: CaptureHabitCount[];
  payments: CaptureHabitCount[];
  /** Bill categories with the payment method they are usually paid with. */
  billCategoryPayments: Array<{ category: string; payment: string; count: number }>;
  currency?: string;
  /** Average title length in characters. */
  titleLength: number;
}

const KINDS: EntryKind[] = ["event", "task", "bill", "idea"];
const pad = (value: number) => String(value).padStart(2, "0");

function clockMinutes(value?: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value ?? "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
}

function clockText(minutes: number): string {
  return pad(Math.floor(minutes / 60) % 24) + ":" + pad(minutes % 60);
}

function median(values: readonly number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

const round5 = (value: number) => Math.round(value / 5) * 5;

function counted<T extends string>(values: ReadonlyArray<T | undefined>): CaptureHabitCount<T>[] {
  const counts = new Map<T, number>();
  for (const value of values) {
    const trimmed = value?.trim() as T | undefined;
    if (trimmed) counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}

/** A value only counts as a habit when it recurs and covers most records. */
function dominant<T extends string>(values: ReadonlyArray<T | undefined>, minCount = 2, share = 0.5): T | undefined {
  const [top] = counted(values);
  const defined = values.filter(Boolean).length;
  return top && top.count >= minCount && top.count / defined >= share ? top.value : undefined;
}

function timedMinutes(item: CaptureHistoryItem): number | undefined {
  const start = clockMinutes(item.start);
  const end = clockMinutes(item.end);
  if (start === undefined || end === undefined) return undefined;
  const minutes = end >= start ? end - start : end + 1440 - start;
  return minutes > 0 ? minutes : undefined;
}

function habitForGroup(group: readonly CaptureHistoryItem[]): CaptureHabitTitle {
  const kind = counted(group.map((item) => item.kind))[0].value;
  const same = group.filter((item) => item.kind === kind);
  const starts = same.map((item) => clockMinutes(item.start)).filter((value): value is number => value !== undefined);
  const durations = same.map(timedMinutes).filter((value): value is number => value !== undefined);
  const amounts = same.map((item) => item.amount).filter((value): value is number => typeof value === "number" && Number.isFinite(value)).map(Math.abs);
  const tags = counted(same.flatMap((item) => item.tags ?? [])).filter((tag) => tag.count >= 2 && tag.count / same.length >= 0.5).slice(0, 3);
  const start = starts.length >= 2 && starts.length * 2 >= same.length ? median(starts) : undefined;
  const duration = median(durations);
  const amount = median(amounts);
  return {
    title: counted(group.map((item) => item.title.trim()))[0].value,
    count: group.length,
    kind,
    category: dominant(same.map((item) => item.category)),
    location: dominant(same.map((item) => item.location)),
    start: start === undefined ? undefined : clockText(round5(start)),
    durationMinutes: duration === undefined ? undefined : Math.max(5, round5(duration)),
    payment: kind === "bill" ? dominant(same.map((item) => item.payment)) : undefined,
    amount: kind === "bill" && amount !== undefined ? Math.round(amount) : undefined,
    currency: kind === "bill" ? dominant(same.map((item) => item.currency)) : undefined,
    tags: tags.length ? tags.map((tag) => tag.value) : undefined,
  };
}

/** Pure statistics over the user's own records; nothing here is persisted, so
 *  the profile is always rebuilt from the current database. */
export function buildCaptureHabits(history: readonly CaptureHistoryItem[], options: { maxTitles?: number; minCount?: number } = {}): CaptureHabits {
  const { maxTitles = 60, minCount = 2 } = options;
  const items = history.filter((item) => item.title.trim());
  const groups = new Map<string, CaptureHistoryItem[]>();
  for (const item of items) {
    const key = normalizedTitle(item.title);
    if (!key) continue;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  const durations: CaptureHabits["durations"] = {};
  const timedShare: CaptureHabits["timedShare"] = {};
  const categories: CaptureHabits["categories"] = {};
  for (const kind of KINDS) {
    const ofKind = items.filter((item) => item.kind === kind);
    if (!ofKind.length) continue;
    const length = median(ofKind.map(timedMinutes).filter((value): value is number => value !== undefined));
    if (length !== undefined) durations[kind] = Math.max(5, round5(length));
    timedShare[kind] = ofKind.filter((item) => clockMinutes(item.start) !== undefined).length / ofKind.length;
    categories[kind] = counted(ofKind.map((item) => item.category)).slice(0, 3);
  }
  const bills = items.filter((item) => item.kind === "bill");
  const billsByCategory = new Map<string, CaptureHistoryItem[]>();
  for (const bill of bills) {
    if (!bill.category?.trim() || !bill.payment?.trim()) continue;
    billsByCategory.set(bill.category, [...(billsByCategory.get(bill.category) ?? []), bill]);
  }
  const billCategoryPayments = [...billsByCategory.entries()].flatMap(([category, group]) => {
    const [top] = counted(group.map((item) => item.payment));
    return top && top.count >= 2 ? [{ category, payment: top.value, count: top.count }] : [];
  }).sort((left, right) => right.count - left.count).slice(0, 6);
  return {
    total: items.length,
    kinds: counted(items.map((item) => item.kind)),
    titles: [...groups.values()]
      .filter((group) => group.length >= minCount)
      .sort((left, right) => right.length - left.length || left[0].title.localeCompare(right[0].title))
      .slice(0, maxTitles)
      .map(habitForGroup),
    durations,
    timedShare,
    categories,
    locations: counted(items.map((item) => item.location)).slice(0, 6),
    payments: counted(bills.map((item) => item.payment)).slice(0, 3),
    billCategoryPayments,
    currency: dominant(bills.map((item) => item.currency)),
    titleLength: items.length ? Math.round(items.reduce((sum, item) => sum + [...item.title.trim()].length, 0) / items.length) : 0,
  };
}

const KIND_LABELS: Record<Locale, Record<EntryKind, string>> = {
  zh: { event: "事件", task: "任务", bill: "账目", idea: "灵感" },
  en: { event: "Event", task: "Task", bill: "Bill", idea: "Idea" },
};

/** Frequent records that resemble what is being typed come first, so the
 *  bounded profile spends its budget on the habits that matter right now. */
function rankTitles(titles: readonly CaptureHabitTitle[], query: string): CaptureHabitTitle[] {
  const text = query.trim();
  if (!text) return [...titles];
  const scores = new Map(titles.map((habit) => [habit, Math.max(titleMatchScore(habit.title, text), titleMatchScore(text, habit.title))]));
  return [...titles].sort((left, right) => (scores.get(right) ?? 0) - (scores.get(left) ?? 0) || right.count - left.count);
}

/** A compact, human-readable profile. It doubles as model context and as the
 *  explanation the user sees of what the app has learned. Empty while there is
 *  too little history to call anything a habit. When `query` is given, the
 *  records most similar to it lead the list. */
export function describeCaptureHabits(habits: CaptureHabits, locale: Locale, budget = 1400, query = ""): string {
  if (habits.total < 5) return "";
  const zh = locale === "zh";
  const kindLabel = (kind: EntryKind) => KIND_LABELS[locale][kind];
  const list = (values: string[]) => values.join(zh ? "、" : ", ");
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  const lines: string[] = [];
  lines.push(zh ? `用户记录习惯（基于 ${habits.total} 条记录）：` : `User's recording habits (from ${habits.total} records):`);

  const kinds = habits.kinds.map((kind) => `${kindLabel(kind.value)} ${percent(kind.count / habits.total)}`);
  const timing = KINDS.flatMap((kind) => {
    const share = habits.timedShare[kind];
    const duration = habits.durations[kind];
    if (share === undefined) return [];
    if (share < 0.3) return [zh ? `${kindLabel(kind)}多为全天` : `${kindLabel(kind)} mostly all-day`];
    return duration ? [zh ? `${kindLabel(kind)}常用时长 ${duration} 分钟` : `${kindLabel(kind)} usually ${duration} min`] : [];
  });
  lines.push(`- ${zh ? "类型" : "Kinds"}: ${list(kinds)}${timing.length ? `; ${list(timing)}` : ""}`);

  for (const kind of KINDS) {
    const top = habits.categories[kind];
    if (!top?.length || kind === "bill") continue;
    lines.push(`- ${zh ? `${kindLabel(kind)}常用分类` : `${kindLabel(kind)} categories`}: ${list(top.map((item) => `${item.value} (${item.count})`))}`);
  }
  if (habits.locations.length) lines.push(`- ${zh ? "常用地点" : "Usual places"}: ${list(habits.locations.map((item) => item.value))}`);
  const billCategories = habits.categories.bill;
  if (habits.payments.length || billCategories?.length || habits.currency) {
    const parts = [
      habits.currency,
      habits.payments.length ? (zh ? `常用支付 ${list(habits.payments.map((item) => item.value))}` : `usually paid by ${list(habits.payments.map((item) => item.value))}`) : "",
      billCategories?.length ? (zh ? `常见分类 ${list(billCategories.map((item) => item.value))}` : `categories ${list(billCategories.map((item) => item.value))}`) : "",
    ].filter(Boolean);
    lines.push(`- ${zh ? "账目" : "Bills"}: ${parts.join(zh ? "，" : "; ")}`);
  }

  const described: string[] = [];
  let used = lines.join("\n").length;
  for (const habit of rankTitles(habits.titles, query)) {
    const details = [
      `${kindLabel(habit.kind)}${habit.category ? `/${habit.category}` : ""}`,
      habit.start ? `${habit.start}${habit.durationMinutes ? `+${habit.durationMinutes}min` : ""}` : habit.durationMinutes ? `${habit.durationMinutes}min` : "",
      habit.location ? `@${habit.location}` : "",
      habit.payment ?? "",
      habit.amount !== undefined ? `≈${habit.amount}${habit.currency ? ` ${habit.currency}` : ""}` : "",
      habit.tags?.length ? habit.tags.map((tag) => `#${tag}`).join(" ") : "",
    ].filter(Boolean).join(" · ");
    const line = `${habit.title} → ${details} (×${habit.count})`;
    if (used + line.length > budget) break;
    used += line.length + 2;
    described.push(line);
  }
  if (described.length) lines.push(`- ${zh ? "常见记录" : "Frequent records"}: ${described.join("; ")}`);
  if (habits.billCategoryPayments.length) {
    const line = `- ${zh ? "账目分类的支付习惯" : "Payment by bill category"}: ${habits.billCategoryPayments.map((item) => `${item.category} → ${item.payment} (×${item.count})`).join("; ")}`;
    if (used + line.length <= budget) { lines.push(line); used += line.length + 1; }
  }
  if (habits.titleLength) lines.push(`- ${zh ? `标题风格：平均 ${habits.titleLength} 字，简短，不含时间地点` : `Title style: about ${habits.titleLength} characters, short, without times or places`}`);
  return lines.join("\n");
}

/** Per-session learning from the current SQLite projection, including edits and deletions. */
export class CaptureHabitLearner {
  private records = new Map<string, { signature: string; item: CaptureHistoryItem }>();
  private groups = new Map<string, Map<string, CaptureHistoryItem>>();
  private learned = new Map<string, CaptureHabitTitle>();
  private profile: CaptureHabits | undefined;

  update(history: readonly CaptureHistoryItem[]): CaptureHabits {
    const incoming = new Map(history.map((item, index) => [item.id ?? `row:${index}`, item]));
    const dirty = new Set<string>();
    const remove = (id: string, item: CaptureHistoryItem) => {
      const key = normalizedTitle(item.title);
      this.groups.get(key)?.delete(id);
      dirty.add(key);
    };
    for (const [id, stored] of this.records) if (!incoming.has(id)) { remove(id, stored.item); this.records.delete(id); }
    for (const [id, item] of incoming) {
      const signature = JSON.stringify(item);
      const stored = this.records.get(id);
      if (stored?.signature === signature) continue;
      if (stored) remove(id, stored.item);
      const key = normalizedTitle(item.title);
      const group = this.groups.get(key) ?? new Map<string, CaptureHistoryItem>();
      group.set(id, item); this.groups.set(key, group); dirty.add(key);
      this.records.set(id, { signature, item: { ...item } });
    }
    if (!this.profile || dirty.size) {
      for (const key of dirty) {
        const group = this.groups.get(key);
        if (!key || !group || group.size < 2) { this.learned.delete(key); if (!group?.size) this.groups.delete(key); }
        else this.learned.set(key, habitForGroup([...group.values()]));
      }
      this.profile = { ...buildCaptureHabits([...this.records.values()].map(record => record.item), { maxTitles: 0 }),
        titles: [...this.learned.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title)) };
    }
    return this.profile;
  }
}
