import { consume, consumeMatch, remainingText, type CaptureText } from "./text";

// Bound Chinese place phrases at action words, not at arbitrary calendar text.
const ACTION = /开会|复习|学习|看书|读书|体检|出差|跑步|散步|健身|吃饭|聚餐|看电影|工作|买|参加|办理|交|取|开|吃|见|看|上课|听|写|做|打球|玩|拍|想|考虑/;
export function extractPlace(text: CaptureText, history: readonly { location?: string }[]): string | undefined {
  let input = remainingText(text);
  const known = [...new Set(history.map((item) => item.location?.trim()).filter((place): place is string => Boolean(place)))].sort((a, b) => b.length - a.length);
  for (const place of known) {
    const index = input.indexOf(place);
    if (index < 0) continue;
    // Latin place names must be whole words ("Home" must not eat "homework").
    if (/^[a-z]/i.test(place) && /[a-z]/i.test(input[index - 1] ?? "")) continue;
    if (/[a-z]$/i.test(place) && /[a-z]/i.test(input[index + place.length] ?? "")) continue;
    const prefix = /(?:地点\s*[:：]\s*|[在去到@]\s*|\bat\s+)$/i.exec(input.slice(0, index));
    if (place.length < 2 && !prefix) continue;
    consume(text, prefix?.index ?? index, place.length + (prefix?.[0].length ?? 0), "place");
    return place;
  }
  const chinese = /(?:地点\s*[:：]\s*|[在去到@]\s*)([^\s,，。;；:：!?！？]+)/.exec(input);
  if (chinese) {
    const candidate = chinese[1];
    const stop = candidate.search(ACTION);
    const place = candidate.slice(0, Math.min(stop >= 0 ? stop : candidate.length, 8));
    if (place && !/^\d/.test(place)) {
      consume(text, chinese.index, chinese[0].length - candidate.length + place.length, "place");
      return place;
    }
  }
  input = remainingText(text);
  const english = /(?:\b(?:at|in)\s+|@)([^,;.!?\n]+?)(?=\s+(?:to|for)\s+|$|[,;.!?\n])/i.exec(input);
  if (english && /[a-z]/i.test(english[1]) && english[1].trim().split(/\s+/).length <= 6) {
    consumeMatch(text, english, "place"); return english[1].trim();
  }
  return undefined;
}
