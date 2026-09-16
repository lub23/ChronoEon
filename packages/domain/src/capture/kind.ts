import type { EntryKind } from "../entry";
import { consumeMatch, remainingText, type CaptureText } from "./text";

export function extractKind(text: CaptureText, hasAmount: boolean): EntryKind {
  const prefix = /^\s*(event|日程|事件|会议|bill|expense|账单|记账|支出|task|todo|待办|任务)\s*[:：]\s*/i.exec(remainingText(text));
  let kind: EntryKind = "event";
  if (prefix) {
    kind = /task|todo|待办|任务/i.test(prefix[1]) ? "task" : /bill|expense|账单|记账|支出/i.test(prefix[1]) ? "bill" : "event";
    consumeMatch(text, prefix, "cue");
  }
  const taskCue = /记得|别忘了|提醒我|待办|需要|截止(?:到)?|之前(?:完成)?|\b(?:remember to|need to|must|todo|task|by)\b|^\s*要/gim;
  for (const cue of remainingText(text).matchAll(taskCue)) {
    if (!prefix) kind = "task";
    consumeMatch(text, cue, "cue");
  }
  return hasAmount ? "bill" : kind;
}
