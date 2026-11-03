import type { IconName } from "./Icon";
import type { MessageKey } from "../i18n";

/** The sub-views under the Insights button, in menu order. */
export type InsightsTab = "bills" | "tasks" | "items" | "ideas" | "map";

export const INSIGHTS_TABS: Array<{ tab: InsightsTab; icon: IconName; label: MessageKey }> = [
  { tab: "bills", icon: "coins", label: "statsBills" },
  { tab: "tasks", icon: "clock", label: "statsTasks" },
  { tab: "items", icon: "box", label: "items" },
  { tab: "ideas", icon: "idea", label: "ideas" },
  { tab: "map", icon: "map", label: "map" },
];

export function insightsTabIcon(tab: InsightsTab): IconName {
  return INSIGHTS_TABS.find((item) => item.tab === tab)?.icon ?? "insights";
}

/** Both navigation surfaces share the same groups and order. */
export const INSIGHTS_GROUPS = [
  { key: "things", label: "collections", icon: "box", tabs: ["items", "ideas"] },
  { key: "stats", label: "insights", icon: "insights", tabs: ["bills", "tasks", "map"] },
] as const;
