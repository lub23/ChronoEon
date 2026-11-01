import { addIsoDays, isIsoDate } from "../calendar";
import { CHINESE_NUMBER, NUMBER, consume, consumeMatch, parseNumber, remainingText, type CaptureText } from "./text";

const pad = (n: number) => String(n).padStart(2, "0");
export const localDate = (date: Date): string => date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
const iso = (year: number, month: number, day: number) => year + "-" + pad(month) + "-" + pad(day);
const weekdayNames = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function extractDate(text: CaptureText, now: Date): string {
  const today = localDate(now);
  const input = remainingText(text);
  const take = (match: RegExpExecArray, value: string): string | undefined => {
    if (!isIsoDate(value)) return undefined;
    consumeMatch(text, match, "date"); return value;
  };
  let match = /(?<!\d)(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})(?:日|号)?(?!\d)/.exec(input);
  if (match) return take(match, iso(+match[1], +match[2], +match[3])) ?? today;
  match = /(大后天|后天|明天|今天|昨天|前天)|\b(day after tomorrow|day before yesterday|tomorrow|today|yesterday)\b/i.exec(input);
  if (match) {
    const offsets: Record<string, number> = { 大后天: 3, 后天: 2, 明天: 1, 今天: 0, 昨天: -1, 前天: -2, "day after tomorrow": 2, "day before yesterday": -2, tomorrow: 1, today: 0, yesterday: -1 };
    return take(match, addIsoDays(today, offsets[match[0].toLowerCase()]))!;
  }
  match = new RegExp("(" + NUMBER + ")天(后|前)|\\bin (\\d+) days?\\b", "i").exec(input);
  if (match) {
    const days = parseNumber(match[1] ?? match[3]) * (match[2] === "前" ? -1 : 1);
    if (Number.isInteger(days) && Math.abs(days) <= 20_000) return take(match, addIsoDays(today, days))!;
  }
  match = /(下下|下|这|本)?(?:周|星期|礼拜)([一二三四五六日天])|\b(?:on\s+)?(?:(next|this)\s+)?(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i.exec(input);
  if (match) {
    const day = match[2] ? "一二三四五六日天".indexOf(match[2]) % 7 + 1 : weekdayNames.indexOf(match[4].toLowerCase()) + 1;
    const target = match[2] === "天" ? 7 : day;
    const current = now.getDay() || 7;
    const prefix = (match[1] ?? match[3] ?? "").toLowerCase();
    let days = target - current;
    if (prefix === "下下") days += 14;
    else if (prefix === "下" || prefix === "next") days += 7;
    else if (!prefix && days < 0) days += 7;
    return take(match, addIsoDays(today, days))!;
  }
  match = /(下|这|本)?周末|\b(?:(next|this)\s+)?weekend\b/i.exec(input);
  if (match) {
    let days = 6 - (now.getDay() || 7);
    const prefix = match[1] ?? match[2];
    if (prefix === "下" || prefix === "next" || (!prefix && days < 0)) days += 7;
    return take(match, addIsoDays(today, days))!;
  }
  match = /(?<![\d/\-])(\d{1,2})(?:月|\/)(\d{1,2})(?:日|号)?(?![\d/\-])/.exec(input);
  if (match) {
    let year = now.getFullYear();
    if (iso(year, +match[1], +match[2]) < today) year++;
    return take(match, iso(year, +match[1], +match[2])) ?? today;
  }
  match = /(?<!\d)(\d{1,2})(?:日|号)(?!\d)/.exec(input);
  if (match && +match[1] >= 1 && +match[1] <= 31) {
    // A day without a month means its next valid occurrence, including month end.
    for (let offset = 0; offset < 12; offset++) {
      const month = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const value = iso(month.getFullYear(), month.getMonth() + 1, +match[1]);
      if (value >= today && isIsoDate(value)) return take(match, value)!;
    }
  }
  return today;
}

const PERIOD = "凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|晚间|夜里|夜晚|夜间|\\b(?:in the )?morning\\b|\\b(?:in the )?afternoon\\b|\\b(?:in the )?evening\\b|\\b(?:at )?night\\b|\\b(?:at )?noon\\b|\\b(?:at )?midnight\\b";
const HOUR = "(?:\\d{1,2}|[" + CHINESE_NUMBER + "]+)";
const CLOCK = "(?:\\d{1,2}(?::[0-5]\\d)?\\s*[ap]m|\\d{1,2}:[0-5]\\d|" + HOUR + "点(?:半|一刻|三刻|" + HOUR + "分?)?)";
function periodMinutes(period: string): number {
  if (/midnight|凌晨/i.test(period)) return 0;
  if (/中午|noon/i.test(period)) return 12 * 60;
  if (/下午|afternoon/i.test(period)) return 15 * 60;
  if (/傍晚/i.test(period)) return 18 * 60;
  if (/晚|夜|evening|night/i.test(period)) return 19 * 60;
  return /早/.test(period) ? 8 * 60 : 9 * 60;
}
function clockMinutes(clock: string, period: string): number | undefined {
  const english = /^(\d{1,2})(?::(\d{2}))?\s*([ap]m)?$/i.exec(clock);
  const chinese = new RegExp("^(" + HOUR + ")点(半|一刻|三刻|" + HOUR + "分?)?$").exec(clock);
  const hourText = english?.[1] ?? chinese?.[1];
  if (!hourText) return undefined;
  let hour = parseNumber(hourText);
  const fraction = chinese?.[2];
  const minute = english ? Number(english[2] ?? 0) : fraction === "半" ? 30 : fraction === "一刻" ? 15 : fraction === "三刻" ? 45 : fraction ? parseNumber(fraction.replace(/分$/, "")) : 0;
  const meridiem = english?.[3]?.toLowerCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) return undefined;
    hour = hour % 12 + (meridiem === "pm" ? 12 : 0);
  } else if (/下午|中午|傍晚|晚|夜|afternoon|evening|night|noon/i.test(period) && !/midnight/i.test(period) && hour < 12) hour += 12;
  else if (/凌晨|midnight/i.test(period) && hour === 12) hour = 0;
  return hour < 24 && minute < 60 ? hour * 60 + minute : undefined;
}

function extractDuration(text: CaptureText): { minutes: number; days: number } {
  const pattern = new RegExp("(?:\\bfor\\s+)?(" + NUMBER + "|半)(?:个)?(半)?\\s*(小时|钟头|分钟|分(?![钟类])|天|hours?\\b|hrs?\\b|h\\b|minutes?\\b|mins?\\b|min\\b|days?\\b)(半)?", "gi");
  let minutes = 0, days = 0;
  for (const match of remainingText(text).matchAll(pattern)) {
    let amount = parseNumber(match[1]);
    if (match[2] || match[4]) amount += 0.5;
    if (!(amount > 0) || amount > 20_000) continue;
    const unit = match[3].toLowerCase();
    if (/天|days?/.test(unit)) {
      if (!Number.isInteger(amount)) continue;
      days += amount;
    } else minutes += amount * (/小时|钟头|^h/.test(unit) ? 60 : 1);
    consumeMatch(text, match, "duration");
  }
  return { minutes: Math.round(minutes), days };
}

/** "现在" anchors a time to the moment of writing; "刚才" ends there instead. */
const NOW_WORDS = "现在|此刻|这会儿|这会|马上|立刻|立即|\\bright now\\b|\\bnow\\b";
const JUST_WORDS = "刚才|刚刚|\\bjust now\\b";
const NOW_PATTERN = new RegExp("(?:从\\s*|\\bfrom\\s+)?(" + JUST_WORDS + "|" + NOW_WORDS + ")(?:\\s*(?:起|开始)|\\s+on\\b)?", "gi");
const RANGE_GAP = /^\s*(?:到|至|[-–—~～]|to|until|till)\s*$/i;

/** Everyday meals carry a time of day even when none is written. A learned
 *  habit (the user's own lunch hour) takes precedence over these defaults. */
const ROUTINES: Array<{ pattern: RegExp; start: number; minutes: number }> = [
  { pattern: /早饭|早餐|早点|\bbreakfast\b/i, start: 8 * 60, minutes: 30 },
  { pattern: /午饭|午餐|\blunch\b/i, start: 12 * 60, minutes: 45 },
  { pattern: /下午茶|\bafternoon tea\b/i, start: 15 * 60, minutes: 30 },
  { pattern: /晚饭|晚餐|\bdinner\b|\bsupper\b/i, start: 18 * 60 + 30, minutes: 45 },
  { pattern: /夜宵|宵夜|\blate[- ]night snack\b/i, start: 22 * 60, minutes: 30 },
];

/** The current clock rounded to five minutes: "现在" at 12:17 is 12:15, not 12:30. */
function nowMinutes(now: Date): number {
  return Math.round((now.getHours() * 60 + now.getMinutes()) / 5) * 5;
}

interface TimePoint { index: number; length: number; minutes: number; clock?: string; period?: string; past?: boolean }

export interface TimeSpans {
  date: string;
  /** Minutes after midnight when the text names a start (clock, period or "now"). */
  start?: number;
  /** Explicit range end. */
  end?: number;
  /** "刚才": the entry ends now and starts one duration earlier. */
  endOnly?: number;
  duration: { minutes: number; days: number };
}

/** Phase one: consume every date/time word so the remaining title can be
 *  matched against history before the clock values are finalised. */
export function extractTimeSpans(text: CaptureText, now: Date): TimeSpans {
  const date = extractDate(text, now);
  const input = remainingText(text);
  const pattern = new RegExp("(?<![\\d:])(?:at\\s+)?(?:((?:" + PERIOD + "))\\s*)?(" + CLOCK + ")(?![\\d:])", "gi");
  const points: TimePoint[] = [];
  for (const match of input.matchAll(pattern)) {
    // Clock minutes (三点二十分) belong to the clock, not to a duration.
    // Conversely 一点五小时 is a decimal duration, not the clock 01:05.
    if (/^(?:个)?(?:小时|钟头)/.test(input.slice(match.index + match[0].length))) continue;
    const minutes = clockMinutes(match[2], match[1] ?? "");
    if (minutes !== undefined) points.push({ index: match.index, length: match[0].length, minutes, clock: match[2], period: match[1] ?? "" });
  }
  for (const match of input.matchAll(NOW_PATTERN)) {
    points.push({ index: match.index, length: match[0].length, minutes: nowMinutes(now), past: new RegExp("^(?:" + JUST_WORDS + ")$", "i").test(match[1]) });
  }
  points.sort((left, right) => left.index - right.index);
  const result: TimeSpans = { date, duration: { minutes: 0, days: 0 } };
  const [first, second] = points;
  if (first && second && RANGE_GAP.test(input.slice(first.index + first.length, second.index))) {
    let start = first.minutes;
    let end = second.minutes;
    if (second.clock) {
      // A bare end inherits the start's half of the day: 下午3点到5点 ends at 17:00.
      const meridiem = /([ap]m)$/i.exec(first.clock ?? "")?.[1]?.toLowerCase();
      const inherited = second.period || first.period || (meridiem === "pm" ? "afternoon" : "");
      end = clockMinutes(second.clock, inherited) ?? end;
      // Without any period, speech uses the 12-hour clock, and an end that has
      // already passed means its next reading: "10点到2点" ends at 14:00, and
      // "现在到十二点半" written at 14:00 ends at half past midnight.
      if (end < start && !inherited && !/[ap]m$/i.test(second.clock)) {
        const next = Math.floor(end / 60) <= 12 ? end + 720 : end + 1440;
        end = next > start ? next : end + 1440;
      }
    }
    // "两点到现在" written at 16:05 means 14:00, not a fourteen-hour afternoon.
    if (first.clock && !first.period && !/[ap]m$/i.test(first.clock) && end - start > 720 && start + 720 < end) start += 720;
    const from = /(?:从|\bfrom)\s*$/i.exec(input.slice(0, first.index));
    const begin = from ? from.index : first.index;
    consume(text, begin, second.index + second.length - begin, "time");
    result.start = start;
    result.end = end;
  } else if (first) {
    consume(text, first.index, first.length, "time");
    if (first.past) result.endOnly = first.minutes;
    else result.start = first.minutes;
  }
  result.duration = extractDuration(text);
  if (result.start === undefined && result.endOnly === undefined) {
    const period = new RegExp("(?:" + PERIOD + ")(?!茶)", "i").exec(remainingText(text));
    if (period) { result.start = periodMinutes(period[0]); consumeMatch(text, period, "time"); }
  }
  return result;
}

/** Phase two: turn the consumed spans into a draft time, filling what the text
 *  left open from the user's habits (learned start/duration) or a daily routine. */
export function resolveTime(
  text: CaptureText,
  spans: TimeSpans,
  now: Date,
  defaults: { duration?: number; start?: number } = {},
): { date: string; start?: string; end?: string; endDate?: string; allDay: boolean } {
  let { date, start, end } = spans;
  const { duration } = spans;
  const routine = ROUTINES.find((candidate) => candidate.pattern.test(remainingText(text)));
  const span = duration.minutes + duration.days * 1440 || defaults.duration || routine?.minutes || 60;
  if (start === undefined && spans.endOnly !== undefined) {
    end = spans.endOnly;
    start = end - span;
    if (start < 0) { date = addIsoDays(date, -1); start += 1440; end += 1440; }
  }
  if (start === undefined) {
    if (duration.minutes) {
      start = Math.ceil((now.getHours() * 60 + now.getMinutes() + (now.getSeconds() || now.getMilliseconds() ? 1 / 60 : 0)) / 15) * 15;
    } else if (defaults.start !== undefined) start = defaults.start;
    else if (routine) start = routine.start;
  }
  if (start === undefined) return { date, start: undefined, end: undefined, allDay: true, endDate: duration.days > 1 ? addIsoDays(date, duration.days - 1) : undefined };
  if (start >= 1440) { date = addIsoDays(date, 1); start -= 1440; if (end !== undefined) end -= 1440; }
  end ??= start + span;
  if (end < start) end += 1440;
  const clock = (minutes: number) => pad(Math.floor(minutes / 60) % 24) + ":" + pad(minutes % 60);
  return { date, start: clock(start), end: clock(end), endDate: end >= 1440 ? addIsoDays(date, Math.floor(end / 1440)) : undefined, allDay: false };
}
