import { addDays, format } from "date-fns";
import { CATEGORY_COLORS, type Entry } from "../domain/entry";

function day(base: Date, offset: number): string {
  return format(addDays(base, offset), "yyyy-MM-dd");
}

function entry(base: Date, partial: Omit<Entry, "createdAt" | "source" | "color"> & { color?: string }): Entry {
  return {
    ...partial,
    color: partial.color ?? CATEGORY_COLORS[partial.category] ?? CATEGORY_COLORS.uncategorized,
    createdAt: `${day(base, -2)}T08:00:00.000Z`,
    source: "demo"
  };
}

/**
 * The browser demo set. It is intentionally a feature showcase: every entry
 * kind, status, and the richer fields (tags, images, recurrence, reminders,
 * priority/urgency, cross-midnight and multi-day spans, +/− bills, ideas with
 * bodies) appear at least once so the calendar, agenda and hover details can be
 * exercised without a real database. On the desktop the real SQLite store
 * replaces this.
 */
export function createDemoEntries(now = new Date()): Entry[] {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return [
    entry(base, {
      id: "demo-morning-walk",
      kind: "task",
      title: "Morning walk by the river",
      titleZh: "沿河晨行",
      date: day(base, 0),
      start: "07:30",
      end: "08:10",
      status: "done",
      category: "wellbeing",
      note: "No headphones. Let the morning arrive quietly."
    }),
    entry(base, {
      id: "demo-design-review",
      kind: "event",
      title: "ChronoEon design review",
      titleZh: "时元设计评审",
      date: day(base, 0),
      start: "09:30",
      end: "10:45",
      category: "work",
      location: "Studio · North room",
      tags: ["design", "chronoeon"],
      calendar: "work"
    }),
    entry(base, {
      id: "demo-prototype",
      kind: "task",
      title: "Polish the timeline prototype",
      titleZh: "打磨时间轴原型",
      date: day(base, 0),
      start: "11:10",
      end: "12:30",
      status: "in-progress",
      category: "work",
      priority: "high",
      reminder: "15min",
      note: "Focus on rhythm and the empty states."
    }),
    entry(base, {
      id: "demo-lunch",
      kind: "bill",
      title: "Lunch with Lin",
      titleZh: "与林君午餐",
      date: day(base, 0),
      start: "12:45",
      category: "finance",
      amount: -68,
      currency: "CNY",
      payment: "WeChat"
    }),
    entry(base, {
      id: "demo-reading",
      kind: "task",
      title: "Read two chapters",
      titleZh: "读书两章",
      date: day(base, 0),
      start: "19:30",
      end: "20:15",
      status: "open",
      category: "learning"
    }),
    entry(base, {
      id: "demo-night-shift",
      kind: "event",
      title: "On-call rotation (overnight)",
      titleZh: "夜间值班",
      date: day(base, 0),
      start: "23:30",
      end: "00:30",
      endDate: day(base, 1),
      category: "work",
      tags: ["on-call"],
      urgency: "high",
      note: "Cross-midnight span — the end falls on the next civil day."
    }),
    entry(base, {
      id: "demo-idea-window",
      kind: "idea",
      title: "A one-day floating window for quiet focus",
      titleZh: "做一个只看今日的置顶小窗",
      date: day(base, 0),
      allDay: true,
      category: "personal",
      note: "List view or days=1 Day view; minimal chrome, quick capture at the top."
    }),
    entry(base, {
      id: "demo-standup-series",
      kind: "event",
      title: "Weekly team standup",
      titleZh: "每周团队站会",
      date: day(base, 1),
      start: "09:30",
      end: "10:00",
      category: "work",
      recurrence: "weekly",
      recurringDays: [0],
      recurringEnd: day(base, 60),
      reminder: "at-time",
      calendar: "work"
    }),
    entry(base, {
      id: "demo-weekend-retreat",
      kind: "event",
      title: "Weekend hiking retreat",
      titleZh: "周末徒步",
      date: day(base, 4),
      endDate: day(base, 6),
      allDay: true,
      category: "wellbeing",
      tags: ["outdoors"],
      location: "Misty Ridge Trail",
      note: "A three-day all-day banner that spans two week rows."
    }),
    entry(base, {
      id: "demo-groceries",
      kind: "task",
      title: "Pick up tea and fruit",
      titleZh: "买茶与鲜果",
      date: day(base, 1),
      start: "17:40",
      status: "open",
      category: "personal",
      reminder: "30min"
    }),
    entry(base, {
      id: "demo-planning",
      kind: "event",
      title: "Weekly planning",
      titleZh: "一周筹划",
      date: day(base, 1),
      start: "09:00",
      end: "09:45",
      category: "work"
    }),
    entry(base, {
      id: "demo-call",
      kind: "event",
      title: "Call with the Windows tester",
      titleZh: "Windows 测试沟通",
      date: day(base, 2),
      start: "15:00",
      end: "15:40",
      category: "work",
      location: "Video call",
      tags: ["qa"]
    }),
    entry(base, {
      id: "demo-freelance-invoice",
      kind: "bill",
      title: "Freelance invoice paid",
      titleZh: "自由职业回款",
      date: day(base, 2),
      start: "10:00",
      category: "finance",
      amount: 2400,
      currency: "CNY",
      payment: "Bank transfer",
      note: "Positive amount — income, not an expense."
    }),
    entry(base, {
      id: "demo-subway",
      kind: "bill",
      title: "Subway top-up",
      titleZh: "地铁充值",
      date: day(base, 2),
      start: "08:00",
      category: "finance",
      amount: -100,
      currency: "CNY"
    }),
    entry(base, {
      id: "demo-idea-review",
      kind: "idea",
      title: "Weekly review as a letter to oneself",
      titleZh: "把周回顾写成给自己的短笺",
      date: day(base, -1),
      allDay: true,
      category: "learning",
      note: "Less dashboard, more reflection. Offer three gentle prompts."
    }),
    entry(base, {
      id: "demo-idea-inbox",
      kind: "idea",
      title: "Let the inbox breathe",
      titleZh: "让收件箱也留有呼吸",
      date: day(base, -3),
      allDay: true,
      category: "personal",
      note: "Archive suggestions after seven days, but never auto-delete."
    }),
    entry(base, {
      id: "demo-yesterday-task",
      kind: "task",
      title: "Map the migration boundaries",
      titleZh: "梳理迁移边界",
      date: day(base, -1),
      start: "10:00",
      end: "11:30",
      status: "done",
      category: "work"
    }),
    entry(base, {
      id: "demo-dropped-sprint",
      kind: "task",
      title: "Rebuild the CSV importer",
      titleZh: "重写 CSV 导入器",
      date: day(base, -2),
      start: "14:00",
      end: "16:00",
      status: "cancelled",
      category: "work",
      note: "Superseded by the newer importer; left as a cancelled record."
    }),
    entry(base, {
      id: "demo-photo-walk",
      kind: "task",
      title: "Photograph the old quarter",
      titleZh: "拍摄老城区",
      date: day(base, 3),
      start: "16:30",
      end: "18:00",
      status: "open",
      category: "personal",
      tags: ["photos"],
      images: ["attachments/old-quarter-01.png", "attachments/old-quarter-02.png"],
      reminder: "1day",
      note: "Golden hour; bring the 35mm."
    }),
    entry(base, {
      id: "demo-next-week",
      kind: "event",
      title: "Structured notes workshop",
      titleZh: "结构化笔记研讨",
      date: day(base, 5),
      start: "14:00",
      end: "16:00",
      category: "learning",
      location: "Conference Room B"
    }),
    entry(base, {
      id: "demo-birthday",
      kind: "event",
      title: "Mum's birthday",
      titleZh: "妈妈生日",
      date: day(base, 8),
      allDay: true,
      category: "personal",
      reminder: "1day",
      priority: "high",
      note: "Reserve the restaurant early.",
      tags: ["family"]
    }),
    entry(base, {
      id: "demo-gym",
      kind: "task",
      title: "Gym — full body",
      titleZh: "健身房 · 全身",
      date: day(base, -1),
      start: "07:00",
      end: "07:45",
      status: "done",
      category: "wellbeing",
      recurrence: "daily",
      recurringEnd: day(base, 30)
    }),
    entry(base, {
      id: "demo-invoice-reminder",
      kind: "bill",
      title: "Electricity bill",
      titleZh: "电费账单",
      date: day(base, 6),
      start: "00:00",
      category: "finance",
      amount: -186.4,
      currency: "CNY",
      reminder: "day-before-9am",
      note: "Recurring monthly utility."
    }),
    entry(base, {
      id: "demo-focus-block",
      kind: "task",
      title: "Deep work: storage schema",
      titleZh: "深度工作 · 存储模式",
      date: day(base, 1),
      start: "13:30",
      end: "15:30",
      status: "open",
      category: "work",
      priority: "low",
      urgency: "low",
      calendar: "work",
      tags: ["deep-work"]
    })
  ];
}
