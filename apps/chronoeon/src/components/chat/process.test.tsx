// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { ChatProcess } from "./ChatProcess";
import { settleProcess, startStep, type ChatProcess as Process } from "./process";

it("freezes completed durations while persistence and UI updates are still pending", () => {
  const process: Process = startStep({ conversationId: "test", startedAt: 100, steps: [] }, "answer", "aiStageAnswer", undefined, 100);
  const completed = settleProcess(process, "done", undefined, 1300);
  const persisted = settleProcess(completed, "done", "reply", 15100);
  expect(persisted.endedAt).toBe(1300);
  expect(persisted.steps[0].endedAt).toBe(1300);
  expect(persisted.messageId).toBe("reply");
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    act(() => root.render(<ChatProcess process={persisted} busy locale="en" now={15100} />));
    expect(host.querySelector("summary small")?.textContent).toContain("1.2");
    expect(host.querySelector("time")?.textContent).toBe("1.2s");
    expect(host.querySelector(".is-live")).toBeNull();
  } finally { act(() => root.unmount()); }
});
