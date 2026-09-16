export type CaptureSpanKind = "date" | "time" | "duration" | "place" | "amount" | "cue";
export interface CaptureSpan { kind: CaptureSpanKind; text: string; }
interface LocatedSpan extends CaptureSpan { start: number; end: number; }
export interface CaptureText { input: string; spans: LocatedSpan[]; }

/** Mask rather than delete: every extractor keeps offsets into the original input. */
export function remainingText(text: CaptureText): string {
  let result = text.input;
  for (const { start, end } of text.spans) result = result.slice(0, start) + " ".repeat(end - start) + result.slice(end);
  return result;
}
export function consume(text: CaptureText, start: number, length: number, kind: CaptureSpanKind): void {
  text.spans.push({ kind, start, end: start + length, text: text.input.slice(start, start + length) });
}
export function consumeMatch(text: CaptureText, match: RegExpExecArray, kind: CaptureSpanKind): void {
  consume(text, match.index, match[0].length, kind);
}

export const CHINESE_NUMBER = "零〇一二两三四五六七八九十百千万亿";
export const NUMBER = "(?:\\d+(?:\\.\\d+)?|[" + CHINESE_NUMBER + "]+(?:点[零〇一二两三四五六七八九]+)?)";
const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10_000, 亿: 100_000_000 };
export function parseNumber(input: string): number {
  if (/^\d+(?:\.\d+)?$/.test(input)) return Number(input);
  if (input === "半") return 0.5;
  const [integer, fraction] = input.split("点");
  if (![...integer].some((char) => char in units)) {
    const value = Number([...integer].map((char) => digits[char] ?? "?").join(""));
    return fraction ? value + Number("0." + [...fraction].map((char) => digits[char] ?? "?").join("")) : value;
  }
  let total = 0, section = 0, digit = 0;
  for (const char of integer) {
    if (char in digits) { digit = digits[char]; continue; }
    const unit = units[char];
    if (!unit) return NaN;
    if (unit < 10_000) section += (digit || 1) * unit;
    else { total = unit === 10_000 ? total + (section + digit) * unit : (total + section + digit) * unit; section = 0; }
    digit = 0;
  }
  const value = total + section + digit;
  return fraction ? value + Number("0." + [...fraction].map((char) => digits[char] ?? "?").join("")) : value;
}
export function captureTitle(text: CaptureText): string {
  return remainingText(text).replace(/\s+/g, " ").replace(/^[\s,，.。:：;；、\-–—~]+|[\s,，.。:：;；、\-–—~]+$/g, "").trim();
}
