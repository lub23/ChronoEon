import { describe, expect, it } from "vitest";
import { createDefaultSettings } from "../settings";
import { useExampleCatalogs } from "../testFixtures";
import { parseCapture, type CaptureHistoryItem, type CaptureOptions } from "./index";

// Wednesday 2026-09-09 09:00 local.
const now = new Date(2026, 8, 9, 9, 0, 0);
const settings = useExampleCatalogs(createDefaultSettings());
const base: CaptureOptions = { now, locale: "zh", settings };

function draft(input: string, options: Partial<CaptureOptions> = {}) {
  return parseCapture(input, { ...base, ...options }).draft;
}

describe("parseCapture · schedule", () => {
  it.each([
    ["明天下午3点到5点在图书馆复习高数", { kind: "event", date: "2026-09-10", start: "15:00", end: "17:00", allDay: false, location: "图书馆", title: "复习高数", category: "alpha" }],
    ["下周三上午十点半开会", { kind: "event", date: "2026-09-16", start: "10:30", end: "11:30", title: "开会", category: "beta" }],
    ["周五晚上7点和朋友吃饭", { kind: "event", date: "2026-09-11", start: "19:00", title: "和朋友吃饭", category: "alpha" }],
    ["今天14:00-15:30 设计评审", { kind: "event", date: "2026-09-09", start: "14:00", end: "15:30", title: "设计评审", category: "beta" }],
    ["9月12号去杭州出差三天", { kind: "event", date: "2026-09-12", endDate: "2026-09-14", allDay: true, location: "杭州", title: "出差", category: "beta" }],
    ["后天早上八点半去医院体检", { kind: "event", date: "2026-09-11", start: "08:30", location: "医院", title: "体检", category: "alpha" }],
    ["12号交房租", { kind: "event", date: "2026-09-12", allDay: true, title: "交房租", category: "alpha" }],
    ["健身一小时", { kind: "event", date: "2026-09-09", start: "09:00", end: "10:00", allDay: false, title: "健身" }],
    ["2026-10-01 国庆出游", { kind: "event", date: "2026-10-01", allDay: true, title: "国庆出游" }],
    ["开会9:30", { kind: "event", start: "09:30", end: "10:30", allDay: false, title: "开会" }],
    ["明天下午3:00吃饭", { kind: "event", date: "2026-09-10", start: "15:00", allDay: false, title: "吃饭" }],
    ["202607261234 会议", { kind: "event", start: undefined, allDay: true }],
    ["晚上在家看电影", { kind: "event", date: "2026-09-09", start: "19:00", location: "家", title: "看电影", category: "alpha" }],
  ] as const)("%s", (input, expected) => {
    expect(draft(input)).toMatchObject(expected);
  });

  it("recognises tasks from intent cues", () => {
    expect(draft("记得周五之前交报告")).toMatchObject({ kind: "task", date: "2026-09-11", allDay: true, title: "交报告", category: "beta" });
    expect(draft("待办：整理发票")).toMatchObject({ kind: "task", allDay: true, title: "整理发票" });
    expect(draft("todo: renew passport next Monday", { locale: "en" })).toMatchObject({ kind: "task", date: "2026-09-14", title: "renew passport" });
  });

  it("honours explicit kind prefixes", () => {
    expect(draft("日程：明天 14:00-15:30 设计评审")).toMatchObject({ kind: "event", date: "2026-09-10", start: "14:00", end: "15:30", title: "设计评审" });
    expect(draft("事件: 周末爬山")).toMatchObject({ kind: "event", date: "2026-09-12", title: "爬山" });
  });

  it("parses English dates, times and places", () => {
    expect(draft("Team sync tomorrow 3pm-4pm at Room 204", { locale: "en" })).toMatchObject({ kind: "event", date: "2026-09-10", start: "15:00", end: "16:00", location: "Room 204", title: "Team sync" });
    expect(draft("Dentist on Friday at 10:15", { locale: "en" })).toMatchObject({ date: "2026-09-11", start: "10:15", title: "Dentist" });
  });

  it("never produces ideas", () => {
    expect(draft("灵感：写一首诗").kind).not.toBe("idea");
  });
});

describe("parseCapture · bills", () => {
  it.each([
    ["午饭花了35块", { kind: "bill", amount: -35, currency: "CNY", category: "Expense/Daily", title: "午饭" }],
    ["午餐 ¥36.50", { kind: "bill", amount: -36.5, category: "Expense/Daily", title: "午餐" }],
    ["薪资到账 12000", { kind: "bill", amount: 12000, category: "Income/Salary", title: "薪资" }],
    ["薪资 ￥8000", { kind: "bill", amount: 8000, category: "Income/Salary" }],
    ["打车去机场 58元", { kind: "bill", amount: -58, category: "Expense/Daily", location: "机场", title: "打车" }],
    ["星巴克咖啡 $4.5", { kind: "bill", amount: -4.5, currency: "USD", category: "Expense/Daily" }],
    ["买了三十块钱的水果", { kind: "bill", amount: -30, category: "Expense/Daily", title: "水果" }],
    ["奖金收到 320", { kind: "bill", amount: 320, category: "Income/Bonus", title: "奖金" }],
    ["昨天电费 180", { kind: "bill", date: "2026-09-08", amount: -180, category: "Expense/Daily", title: "电费" }],
    ["房租 3500 支付宝", { kind: "bill", amount: -3500, category: "Expense/Daily", payment: "Alipay" }],
  ] as const)("%s", (input, expected) => {
    expect(draft(input)).toMatchObject(expected);
  });

  it("dates bills at the day they are captured", () => {
    expect(draft("午饭 30元").date).toBe("2026-09-09");
  });
});

describe("parseCapture · learned categories", () => {
  const history: CaptureHistoryItem[] = [
    { kind: "event", title: "背单词", category: "alpha", date: "2026-09-01" },
    { kind: "event", title: "周会", category: "beta", date: "2026-09-02" },
    { kind: "event", title: "陪妈妈散步", category: "alpha", location: "滨江公园", date: "2026-09-03" },
    { kind: "bill", title: "猫粮", category: "Expense/Daily", date: "2026-09-03" },
  ];

  it("prefers the category the user gave a near-identical title before", () => {
    const result = parseCapture("背单词半小时", { ...base, history });
    expect(result.draft).toMatchObject({ category: "alpha", start: "09:00", end: "09:30", title: "背单词" });
    expect(result.confidence.category).toBeGreaterThanOrEqual(0.9);
    expect(draft("买猫粮 120", { history })).toMatchObject({ kind: "bill", category: "Expense/Daily" });
  });

  it("learns a short habit title embedded in a longer phrase", () => {
    const custom = createDefaultSettings();
    custom.calendars[0].categories = [{ id: "health", name: "健康", color: "#65c294" }];
    custom.calendars[0].defaultCategoryId = "health";
    const healthHistory = [{ kind: "event" as const, title: "健身", category: "health", date: "2026-09-08" }];
    expect(draft("今天健身一小时", { settings: custom, history: healthHistory })).toMatchObject({ kind: "event", category: "health" });
  });

  it("recognises places the user has typed before", () => {
    expect(draft("明天滨江公园跑步", { history })).toMatchObject({ location: "滨江公园", title: "跑步" });
  });

  it("falls back to the lexicon, then the default category", () => {
    expect(draft("周会", { history }).category).toBe("beta");
    expect(draft("随便记一下").category).toBe(settings.calendars[0].defaultCategoryId);
    expect(parseCapture("随便记一下", base).confidence.category).toBe(0);
  });
});

describe("parseCapture · spans and titles", () => {
  it("reports which fragments were consumed", () => {
    const result = parseCapture("明天下午3点在图书馆看书 花了20元", base);
    expect(result.spans.map((span) => span.kind)).toEqual(expect.arrayContaining(["date", "time", "place", "amount"]));
    expect(result.draft.title).toBe("看书");
  });

  it("falls back to an untitled label", () => {
    expect(draft("明天").title).toBe("未命名条目");
    expect(draft("tomorrow", { locale: "en" }).title).toBe("Untitled entry");
  });
});


describe("parseCapture · dates, durations and conservative extraction", () => {
  it.each([
    ["大后天旅行", { date: "2026-09-12", title: "旅行", allDay: true }],
    ["前天读书", { date: "2026-09-07", title: "读书" }],
    ["三天后开会", { date: "2026-09-12", title: "开会" }],
    ["下下周一上课", { date: "2026-09-21", title: "上课" }],
    ["本周一开会", { date: "2026-09-07", title: "开会" }],
    ["星期天爬山", { date: "2026-09-13", title: "爬山" }],
    ["下周日爬山", { date: "2026-09-20", title: "爬山" }],
    ["周二开会", { date: "2026-09-15", title: "开会" }],
    ["9/12 旅行", { date: "2026-09-12", title: "旅行" }],
    ["2026年10月1日旅行", { date: "2026-10-01", title: "旅行" }],
    ["5号交房租", { date: "2026-10-05", title: "交房租" }],
    ["9月12日旅行3天", { date: "2026-09-12", endDate: "2026-09-14", allDay: true, title: "旅行" }],
    ["晚上11点到凌晨1点读书", { start: "23:00", end: "01:00", endDate: "2026-09-10", title: "读书" }],
    ["上午三点一刻开会", { start: "03:15", end: "04:15", title: "开会" }],
    ["下午三点三刻开会", { start: "15:45", end: "16:45", title: "开会" }],
    ["读书一个半小时", { start: "09:00", end: "10:30", title: "读书" }],
    ["读书一小时半", { start: "09:00", end: "10:30", title: "读书" }],
    ["健身 1.5h", { start: "09:00", end: "10:30", title: "健身" }],
    ["看书两小时30分钟", { start: "09:00", end: "11:30", title: "看书" }],
    ["Call tomorrow at noon", { date: "2026-09-10", start: "12:00", end: "13:00", title: "Call" }],
    ["Meeting next Monday at 12am", { date: "2026-09-14", start: "00:00", end: "01:00", title: "Meeting" }],
    ["Meet at 12pm", { start: "12:00", end: "13:00", title: "Meet" }],
    ["Meeting in 3 days", { date: "2026-09-12", title: "Meeting" }],
    ["Read for 1 hour 30 minutes", { start: "09:00", end: "10:30", title: "Read" }],
    ["Design review day after tomorrow", { date: "2026-09-11", title: "Design review" }],
    ["下午茶", { allDay: true, title: "下午茶" }],
    ["Room 204 review", { kind: "event", allDay: true, title: "Room 204 review" }],
    ["2026-02-30 review", { date: "2026-09-09", title: "2026-02-30 review" }],
    ["现在想一个问题", { location: undefined, title: "现在想一个问题" }],
    ["重要会议", { kind: "event", title: "重要会议" }],
    ["Lunch €12.50", { kind: "bill", amount: -12.5, currency: "EUR", title: "Lunch" }],
    ["薪资两万三千元", { kind: "bill", amount: 23000, category: "Income/Salary", title: "薪资" }],
  ] as const)("%s", (input, expected) => expect(draft(input)).toMatchObject(expected));

  it("rounds duration-only events up to the next quarter-hour, including midnight", () => {
    expect(draft("读书半小时", { now: new Date(2026, 8, 9, 9, 7) })).toMatchObject({ start: "09:15", end: "09:45" });
    expect(draft("读书半小时", { now: new Date(2026, 8, 9, 23, 59) })).toMatchObject({ date: "2026-09-10", start: "00:00", end: "00:30" });
    expect(draft("1月2日旅行", { now: new Date(2026, 11, 31) })).toMatchObject({ date: "2027-01-02" });
  });

  it("only learns from valid categories of the same kind and direction", () => {
    const history: CaptureHistoryItem[] = [
      { kind: "event", title: "散步", category: "deleted", date: "2026-09-08" },
      { kind: "bill", title: "散步", category: "Income/Salary", date: "2026-09-08" },
    ];
    expect(draft("散步", { history }).category).toBe("alpha");
    expect(draft("散步 20元", { history }).category).not.toContain("Income");
  });

  it("honours custom calendar categories and never mutates history", () => {
    const custom = createDefaultSettings();
    custom.calendars[0].categories = [{ id: "study", name: "Learning", color: "#123456" }];
    custom.calendars[0].defaultCategoryId = "study";
    const history = Object.freeze([{ kind: "event" as const, title: "背单词", category: "study", date: "2026-09-08" }]);
    expect(draft("背单词半小时", { settings: custom, history }).category).toBe("study");
    expect(draft("复习高数", { settings: custom }).category).toBe("study");
  });

  it("does not extract a one-character history place from the middle of a word", () => {
    const history: CaptureHistoryItem[] = [{ kind: "event", title: "阅读", category: "alpha", location: "家", date: "2026-09-08" }];
    expect(draft("专家咨询", { history })).toMatchObject({ location: undefined, title: "专家咨询" });
  });
});


it.each([
  ["下午三点二十分开会", { start: "15:20", end: "16:20", title: "开会" }],
  ["明天10点45分看书半小时", { date: "2026-09-10", start: "10:45", end: "11:15", title: "看书" }],
  ["健身一点五小时", { start: "09:00", end: "10:30", title: "健身" }],
] as const)("keeps clock minutes separate from duration: %s", (input, expected) => {
  expect(draft(input)).toMatchObject(expected);
});
