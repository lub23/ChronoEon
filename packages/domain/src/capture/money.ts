import type { ChronoEonSettings } from "../settings";
import { NUMBER, consume, consumeMatch, parseNumber, remainingText, type CaptureText } from "./text";

const INCOME = /工资|薪资|薪水|奖金|收入|报销|退款|返现|收到|赚|\b(?:salary|income|bonus|reimbursement|refund|received|earned)\b/i;
const BILL_CUE = /账单|记账|支出|花了|花费|付了|支付|买|午饭|午餐|晚餐|早餐|咖啡|奶茶|房租|电费|水费|燃气|网费|\b(?:bill|expense|paid|spent|bought|rent|lunch|dinner|breakfast|coffee)\b/i;
const payments: Array<[string, RegExp]> = [
  ["Alipay", /支付宝|\bAlipay\b/i], ["WeChat", /微信(?:支付)?|\bWeChat(?:\s+Pay)?\b/i],
  ["Credit Card", /信用卡|\bcredit card\b/i], ["Debit Card", /借记卡|银行卡|\bdebit card\b/i], ["Cash", /现金|\bcash\b/i],
];
export interface CaptureMoney { amount?: number; currency?: string; payment?: string; }
export function extractMoney(text: CaptureText, settings: ChronoEonSettings): CaptureMoney {
  const input = remainingText(text);
  const prefix = "(?:[¥￥$€£]|\\b(?:CNY|RMB|USD|EUR|GBP|JPY)\\b)";
  const suffix = "(?:块钱|块|元|人民币|美元|美金|刀|欧元|英镑|日元|\\b(?:CNY|RMB|USD|EUR|GBP|JPY|dollars?|yuan)\\b)";
  const explicit = new RegExp("(?:" + prefix + ")\\s*([+-]?" + NUMBER + ")(?![\\d.])|(?<![\\d.])([+-]?" + NUMBER + ")\\s*(?:" + suffix + ")", "i").exec(input);
  const match = explicit ?? (INCOME.test(text.input) || BILL_CUE.test(text.input) ? /(?<![\d.:/\-])([+-]?\d+(?:\.\d{1,2})?)(?![\d.:/\-])/.exec(input) : null);
  if (!match) return {};
  const number = explicit ? explicit[1] ?? explicit[2] : match[1];
  const value = parseNumber(number.replace(/^[+-]/, ""));
  if (!Number.isFinite(value)) return {};
  const income = number.startsWith("+") || (!number.startsWith("-") && INCOME.test(text.input));
  const currency = /\$|USD|美元|美金|刀|dollars?/i.test(match[0]) ? "USD" : /€|EUR|欧元/i.test(match[0]) ? "EUR"
    : /£|GBP|英镑/i.test(match[0]) ? "GBP" : /JPY|日元/i.test(match[0]) ? "JPY"
    : /[¥￥]|CNY|RMB|元|块|人民币|yuan/i.test(match[0]) ? "CNY" : settings.bill.currency;
  consumeMatch(text, match, "amount");
  const cue = /(?:花了|花费|付了|支付了?|买了|到账|收到|收入|支出|\b(?:paid|spent|costs?|received))\s*$/i.exec(input.slice(0, match.index));
  if (cue) consumeMatch(text, cue, "cue");
  const after = /^\s*的/.exec(input.slice(match.index + match[0].length));
  if (after) consume(text, match.index + match[0].length, after[0].length, "cue");
  let payment: string | undefined;
  for (const method of settings.bill.paymentMethods) {
    const pattern = payments.find(([name]) => name.toLowerCase() === method.toLowerCase())?.[1];
    const found = pattern?.exec(remainingText(text));
    if (found) { payment = method; consumeMatch(text, found, "cue"); break; }
  }
  return { amount: (income ? 1 : -1) * value, currency, payment };
}
