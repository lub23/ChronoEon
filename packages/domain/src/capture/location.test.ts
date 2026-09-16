import { describe, expect, it } from "vitest";
import { inferLocation, type CaptureHistoryItem } from "./index";

const item = (title: string, location: string, date: string): CaptureHistoryItem => ({
  kind: "event", title, category: "work", location, date,
});

describe("inferLocation", () => {
  it("prefers the strongest title match and breaks ties by date", () => {
    const history = [
      item("健身训练", "南馆", "2026-09-01"),
      item("健身房", "东馆", "2026-09-03"),
    ];
    expect(inferLocation("健身训练一小时", history, "2026-09-04")).toBe("南馆");
    expect(inferLocation("今天健身一小时", [
      item("健身", "滨江跑道", "2026-09-11"),
      item("开会", "会议室 B", "2026-09-11"),
    ], "2026-09-12")).toBe("滨江跑道");
    expect(inferLocation("unrelated", [
      item("健身", "滨江跑道", "2026-09-11"),
    ], "2026-09-12")).toBeUndefined();
  });
});
