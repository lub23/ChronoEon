import type { CaptureHistoryItem } from "./index";
import { titleMatchScore } from "./titleMatch";

const MATCH_THRESHOLD = 0.35;
/** A month away halves confidence; very recent history still wins ties. */
const HALF_LIFE_DAYS = 30;

export function inferLocation(
  title: string,
  history: readonly CaptureHistoryItem[],
  date: string,
): string | undefined {
  let best: CaptureHistoryItem | undefined;
  let bestScore = 0;
  const targetTime = Date.parse(date);
  for (const item of history) {
    const location = item.location?.trim();
    if (!location || !item.title.trim()) continue;
    const match = titleMatchScore(title, item.title);
    if (match < MATCH_THRESHOLD) continue;
    const itemTime = Date.parse(item.date);
    const days = Number.isFinite(targetTime) && Number.isFinite(itemTime)
      ? Math.abs(targetTime - itemTime) / 86_400_000
      : Number.POSITIVE_INFINITY;
    const score = match / (1 + days / HALF_LIFE_DAYS);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best?.location?.trim();
}

/** Same local-learning score as the single best answer, but enough for chips. */
export function inferLocationCandidates(
  title: string,
  history: readonly CaptureHistoryItem[],
  date: string,
  limit = 4,
): Array<{ value: string; score: number }> {
  const targetTime = Date.parse(date);
  const candidates = new Map<string, number>();
  for (const item of history) {
    const location = item.location?.trim();
    if (!location || !item.title.trim()) continue;
    const match = titleMatchScore(title, item.title);
    if (match < MATCH_THRESHOLD) continue;
    const itemTime = Date.parse(item.date);
    const days = Number.isFinite(targetTime) && Number.isFinite(itemTime)
      ? Math.abs(targetTime - itemTime) / 86_400_000
      : Number.POSITIVE_INFINITY;
    const score = match / (1 + days / HALF_LIFE_DAYS);
    candidates.set(location, Math.max(candidates.get(location) ?? 0, score));
  }
  return [...candidates].map(([value, score]) => ({ value, score }))
    .sort((left, right) => right.score - left.score || left.value.localeCompare(right.value))
    .slice(0, limit);
}
