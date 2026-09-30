import { describe, expect, it } from "vitest";
import { createDefaultSettings } from "../settings";
import { useExampleCatalogs } from "../testFixtures";
import { CaptureDecisionIndex, parseCapture, splitCaptureItems } from "./index";
import type { CaptureHistoryItem } from "./index";

const settings = useExampleCatalogs(createDefaultSettings());
const now = new Date(2026, 8, 9, 9, 0);

const history: CaptureHistoryItem[] = [
  { id: "work-1", kind: "event", title: "上午工作", category: "beta", location: "办公室", note: "带工牌", start: "09:30", end: "11:30", date: "2026-09-01" },
  { id: "work-2", kind: "event", title: "远程工作", category: "beta", location: "家里", start: "09:00", end: "09:30", date: "2026-09-02" },
  { id: "work-3", kind: "bill", title: "工作餐", category: "Expense/Daily", date: "2026-09-03" },
];

describe("capture field decision index", () => {
  it("recognises custom payment names literally, including regex punctuation", () => {
    const custom = createDefaultSettings("en");
    custom.calendars[0].paymentMethods = [{ id: "custom-pay", name: "Test+Pay" }];
    expect(parseCapture("Coffee 20 yuan Test+Pay", { now, settings: custom, locale: "en" }).draft.payment).toBe("custom-pay");
    expect(parseCapture("Coffee 20 yuan TestttPay", { now, settings: custom, locale: "en" }).draft.payment).toBeUndefined();
  });
  it("selects the dominant kind rather than the first kind in display order", () => {
    const index = new CaptureDecisionIndex([
      { kind: "event", title: "Review", category: "alpha", date: "2026-09-01" },
      { kind: "task", title: "Review", category: "beta", date: "2026-09-02" },
      { kind: "task", title: "Review", category: "beta", date: "2026-09-03" },
    ]);
    expect(index.decide("Review").kind.selected).toBe("task");
  });
  it("keeps a bare purchase quantity out of the amount field", () => {
    expect(parseCapture("buy 2 books", { now, locale: "en", settings }).draft.amount).toBeUndefined();
    expect(parseCapture("idea: Grow herbs", { now, locale: "en", settings }).draft.kind).toBe("idea");
  });
  it("splits multiple notes while keeping commas and decimal amounts together", () => {
    expect(splitCaptureItems("九点半到十一点半工作。买菜 20.5 元；看半小时书，写 1,200 元报告"))
      .toEqual(["九点半到十一点半工作", "买菜 20.5 元", "看半小时书，写 1,200 元报告"]);
  });

  it("splits Chinese/English periods and semicolons and every newline form", () => {
    expect(splitCaptureItems(" ;第一条。第二条;third.第四条；\r\nfifth\nsixth\rseventh。 \n"))
      .toEqual(["第一条", "第二条", "third", "第四条", "fifth", "sixth", "seventh"]);
    expect(splitCaptureItems(" 。.;；\r\n ")).toEqual([]);
  });

  it("keeps comma clauses and grouped decimal amounts in the same item", () => {
    expect(splitCaptureItems("咖啡，蛋糕 -20.50 元, cash; lunch -1,200.25 元. 回家"))
      .toEqual(["咖啡，蛋糕 -20.50 元, cash", "lunch -1,200.25 元", "回家"]);
  });

  it("prefers the dominant historical kind and category for a title term", () => {
    const result = parseCapture("九点半到十一点半工作", { now, locale: "zh", settings, history });
    expect(result.draft).toMatchObject({ kind: "event", category: "beta", start: "09:30", end: "11:30" });
    expect(result.decisions.kind.options).toHaveLength(2);
    expect(result.decisions.category.selected).toBe("beta");
  });

  it("keeps top three locations and notes for alternate picking", () => {
    const index = new CaptureDecisionIndex(history);
    const decisions = index.decide("工作");
    expect(decisions.location.options.map((option) => option.value)).toEqual(["家里", "办公室"]);
    expect(decisions.note.options.map((option) => option.value)).toEqual(["带工牌"]);
    expect(decisions.note.selected).toBe("带工牌");
  });

  it("syncs one new record without a fresh index", () => {
    const index = new CaptureDecisionIndex(history);
    index.sync([...history, { id: "work-4", kind: "event", title: "晚上工作", category: "alpha", location: "办公室", note: "整理周报", date: "2026-09-04" }]);
    const decisions = index.decide("工作");
    expect(decisions.category.selected).toBe("beta");
    expect(decisions.category.options.map((option) => option.value)).toEqual(["beta", "alpha"]);
  });

  it("uses an explicit note and does not overwrite it from history", () => {
    const result = parseCapture("明天上午工作 备注:准备评审", { now, locale: "zh", settings, history });
    expect(result.draft).toMatchObject({ title: "工作", note: "准备评审", category: "beta" });
  });
});
