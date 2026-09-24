import { consumeMatch, remainingText, type CaptureText } from "./text";

export function extractNote(text: CaptureText): string | undefined {
  const match = /(?:备注|note)\s*[:：]\s*([^\n]+)/i.exec(remainingText(text));
  if (!match) return undefined;
  const value = match[1].trim();
 if (!value) return undefined;
  consumeMatch(text, match, "cue");
  return value.replace(/\s+/g, " ");
}
