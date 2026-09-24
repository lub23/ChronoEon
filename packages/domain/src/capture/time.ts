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

export function extractTime(
  text: CaptureText,
  now: Date,
  historicalDuration = 60,
): { date: string; start?: string; end?: string; endDate?: string; allDay: boolean } {
  let date = extractDate(text, now);
  const input = remainingText(text);
  const pattern = new RegExp("(?<![\\d:])(?:at\\s+)?(?:((?:" + PERIOD + "))\\s*)?(" + CLOCK + ")(?![\\d:])", "gi");
  // Clock minutes (三点二十分) belong to the clock, not to a duration.
  // Conversely 一点五小时 is a decimal duration, not the clock 01:05.
  const matches = [...input.matchAll(pattern)].filter((match) => !/^(?:个)?(?:小时|钟头)/.test(input.slice(match.index + match[0].length)));
  let start: number | undefined, end: number | undefined;
  const first = matches[0];
  if (first) {
    start = clockMinutes(first[2], first[1] ?? "");
    if (start !== undefined) {
      consumeMatch(text, first, "time");
      const second = matches[1];
      if (second && /^\s*(?:到|至|[-–—~～]|to|until)\s*$/i.test(input.slice(first.index + first[0].length, second.index))) {
        const meridiem = /([ap]m)$/i.exec(first[2])?.[1].toLowerCase();
        end = clockMinutes(second[2], second[1] ?? first[1] ?? (meridiem === "pm" ? "afternoon" : ""));
        if (end !== undefined) {
          consumeMatch(text, second, "time");
          consume(text, first.index + first[0].length, second.index - first.index - first[0].length, "time");
        }
      }
    }
  }
  const duration = extractDuration(text);
  if (start === undefined) {
    const period = new RegExp("(?:" + PERIOD + ")(?!茶)", "i").exec(remainingText(text));
    if (period) { start = periodMinutes(period[0]); consumeMatch(text, period, "time"); }
    else if (duration.minutes) {
      start = Math.ceil((now.getHours() * 60 + now.getMinutes() + (now.getSeconds() || now.getMilliseconds() ? 1 / 60 : 0)) / 15) * 15;
      if (start >= 1440) { date = addIsoDays(date, 1); start -= 1440; }
    }
  }
  if (start === undefined) return { date, start: undefined, end: undefined, allDay: true, endDate: duration.days > 1 ? addIsoDays(date, duration.days - 1) : undefined };
  end ??= start + (duration.minutes + duration.days * 1440 || historicalDuration);
  if (end < start) end += 1440;
  const clock = (minutes: number) => pad(Math.floor(minutes / 60) % 24) + ":" + pad(minutes % 60);
  return { date, start: clock(start), end: clock(end), endDate: end >= 1440 ? addIsoDays(date, Math.floor(end / 1440)) : undefined, allDay: false };
}
