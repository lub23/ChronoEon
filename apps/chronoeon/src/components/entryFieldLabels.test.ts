import { describe, expect, it } from "vitest";
import { endClockAfter, reminderTriggerLabel, weekdayLabels } from "./entryFieldLabels";

describe("shared field labels", () => {
  it("derives an end clock one slot after the start, wrapped inside the day", () => {
    expect(endClockAfter("14:00", 60)).toBe("15:00");
    expect(endClockAfter("09:30", 30)).toBe("10:00");
    expect(endClockAfter("23:30", 60)).toBe("00:30");
    expect(endClockAfter(undefined, 60)).toBeUndefined();
    expect(endClockAfter("", 60)).toBeUndefined();
  });

  it("keeps the weekday strip one letter wide in both locales", () => {
    expect(weekdayLabels).toEqual(["S", "M", "T", "W", "T", "F", "S"]);
  });

  it("resolves when a relative reminder actually fires", () => {
    expect(reminderTriggerLabel({ date: "2026-09-21", start: "14:00", allDay: false, reminder: "15min" }, "zh"))
      .toBe("9月21日 13:45");
    // English keeps the 24-hour clock too, so the hint stays short enough to
    // sit beside the reminder's label.
    expect(reminderTriggerLabel({ date: "2026-09-21", start: "14:00", allDay: false, reminder: "15min" }, "en"))
      .not.toMatch(/[AP]M/);
    expect(reminderTriggerLabel({ date: "2026-09-21", start: "14:00", allDay: false, reminder: "none" }, "zh")).toBe("");
  });
});
