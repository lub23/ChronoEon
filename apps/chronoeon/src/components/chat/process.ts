import type { MessageKey } from "../../i18n";
import type { AdvisorTool, AdvisorToolResult } from "../../ai/advisorAgent";

export const TOOL_LABELS: Record<AdvisorTool, MessageKey> = {
  search_entries: "aiToolSearchEntries",
  overdue_tasks: "aiToolOverdueTasks",
  upcoming_tasks: "aiToolUpcomingTasks",
  spending_summary: "aiToolSpendingSummary",
};

export function toolStepLabel(name: string): MessageKey {
  return (TOOL_LABELS as Record<string, MessageKey>)[name] ?? "aiStepTool";
}

export type ChatStepStatus = "active" | "done" | "error";

/** One line in the process card: what the assistant is doing right now, or did. */
export interface ChatProcessStep {
  id: string;
  label: MessageKey;
  status: ChatStepStatus;
  /** Free text under the label: search terms, result counts, "answering directly". */
  detail?: string;
  /** Retrieved records for a tool step, expandable in the card. */
  result?: AdvisorToolResult;
  startedAt: number;
  endedAt?: number;
}

/** The visible reasoning trail of one reply. It lives in the session only:
 *  once the reply is stored it stays attached to that message until the
 *  conversation changes. */
export interface ChatProcess {
  conversationId: string;
  messageId?: string;
  steps: ChatProcessStep[];
  startedAt: number;
  endedAt?: number;
}

export function startStep(process: ChatProcess, id: string, label: MessageKey, detail?: string, now = performance.now()): ChatProcess {
  const step: ChatProcessStep = { id, label, status: "active", detail, startedAt: now };
  return { ...process, steps: [...process.steps.filter((existing) => existing.id !== id), step] };
}

export function endStep(process: ChatProcess, id: string, patch: Partial<ChatProcessStep> = {}, now = performance.now()): ChatProcess {
  return {
    ...process,
    steps: process.steps.map((step) => step.id === id && step.status === "active"
      ? { ...step, status: "done", endedAt: now, ...patch }
      : step),
  };
}

/** Close every open step at once, e.g. when the reply arrives or fails. */
export function settleProcess(process: ChatProcess, status: ChatStepStatus = "done", messageId?: string, completedAt = performance.now()): ChatProcess {
  const now = process.endedAt ?? completedAt;
  return {
    ...process,
    messageId: messageId ?? process.messageId,
    endedAt: now,
    steps: process.steps.map((step) => step.status === "active" ? { ...step, status, endedAt: now } : step),
  };
}
