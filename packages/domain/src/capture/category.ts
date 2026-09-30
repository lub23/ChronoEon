import type { EntryKind } from "../entry";
import { billCategoriesForCalendar, billCategoryForValue, billDirectionForCategory, categoryOptionsForKind, defaultCategoryForKind, type ChronoEonSettings } from "../settings";
import type { CaptureHistoryItem } from "./index";
import { titleMatchScore } from "./titleMatch";
import { localDate } from "./time";
const schedule: Array<[RegExp, RegExp]> = [
  [/开会|会议|周会|工作|设计|评审|报告|项目|出差|\b(?:meeting|sync|work|review|project|conference)\b/i, /beta/i],
  [/学习|复习|高数|背单词|看书|读书|阅读|上课|健身|跑步|运动|散步|聚餐|朋友|电影|家务|\b(?:study|learn|class|read|reading|homework|gym|exercise|run|walk|hike|dinner|friend|movie)\b/i, /alpha/i],
];
const bills: Array<[RegExp, string, RegExp?]> = [
  [/工资|薪资|薪水|\b(?:salary|wages)\b/i, "income", /工资|salary|wages/i],
  [/奖金|补贴|\bbonus\b/i, "income", /奖金|bonus/i],
  [/日常|吃饭|午饭|午餐|晚餐|早餐|咖啡|奶茶|水果|蔬菜|生鲜|地铁|公交|打车|出租|高铁|机票|房租|房费|水费|电费|燃气|网费|话费|衣服|鞋|用品|猫粮|狗粮|礼物|\b(?:daily|coffee|tea|drink|fruit|vegetable|grocery|meal|lunch|dinner|breakfast|restaurant|taxi|metro|train|flight|transport|rent|electricity|utilities|internet|phone|clothes|shoes|supplies|gift)\b/i, "expense", /日常|午餐|lunch|daily/i],
  [/药|医院|看病|体检|保险|\b(?:medicine|doctor|hospital|dentist|insurance)\b/i, "expense", /医疗|medical/i],
];

export function inferCategory(
  title: string,
  raw: string,
  kind: EntryKind,
  settings: ChronoEonSettings,
  history: readonly CaptureHistoryItem[],
  now: Date,
  amount?: number,
  calendarId?: string,
  /** The composer stores bill magnitudes, so it asks to learn across both flows. */
  directionHint?: "income" | "expense" | "any",
): { value: string; confidence: number } {
  const options = categoryOptionsForKind(kind, settings, calendarId);
  const direction: "income" | "expense" | "any" = directionHint === "any"
    ? "any"
    : amount !== undefined && amount > 0 ? "income" : "expense";
  const canonicalValue = (value: string): string => {
    if (kind !== "bill") return value;
    const primary = billCategoryForValue(value, settings, calendarId);
    if (!primary) return value;
    const sub = value.split("/").slice(1).join("/");
    return sub ? `${primary.id}/${sub}` : primary.id;
  };
  const valid = new Set(options.map((option) => option.value));
  if (kind === "bill") for (const primary of billCategoriesForCalendar(settings, calendarId)) valid.add(primary.id);
  const available = (category: string) => valid.has(canonicalValue(category))
    && (kind !== "bill" || direction === "any" || billDirectionForCategory(category, settings, calendarId) === direction);
  const recent = history.filter((item) => item.kind === kind && available(item.category)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 500);
  const today = Date.parse(localDate(now));
  let best: CaptureHistoryItem | undefined, score = 0;
  for (const item of recent) {
    const age = (today - Date.parse(item.date)) / 86_400_000;
    const candidate = titleMatchScore(title, item.title) * (age <= 90 ? 1 : 0.85);
    if (candidate >= 0.35 && candidate > score) { best = item; score = candidate; }
  }
  if (best) return { value: canonicalValue(best.category), confidence: score };
  if (kind !== "bill") {
    for (const [keywords, names] of schedule) {
      if (!keywords.test(raw)) continue;
      const category = options.find((option) => names.test(option.value + " " + option.label));
      if (category) return { value: category.value, confidence: 0.75 };
    }
  } else {
    for (const [keywords, id, sub] of bills) {
      if (!keywords.test(raw)) continue;
      const primary = billCategoriesForCalendar(settings, calendarId).find((category) => category.id === id && category.direction === direction);
      if (primary) {
        const child = primary.sub.find((name) => sub?.test(name));
        return { value: child ? primary.id + "/" + child : primary.id, confidence: 0.75 };
      }
    }
  }
  let value = defaultCategoryForKind(kind, settings, calendarId);
  if (kind === "bill" && !available(value)) value = billCategoriesForCalendar(settings, calendarId).find((category) => category.direction === direction)?.id ?? value;
  return { value, confidence: 0 };
}
