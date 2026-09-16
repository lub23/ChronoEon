/** Loose local matching for titles that may mix Chinese and Latin text. */
export function titleBigrams(title: string): Set<string> {
  const chars = [...title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")];
  return new Set(chars.length < 2 ? chars : chars.slice(1).map((char, index) => chars[index] + char));
}

export function normalizedTitle(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function titleMatchScore(title: string, candidate: string): number {
  const target = titleBigrams(title);
  const other = titleBigrams(candidate);
  const shared = [...target].filter((gram) => other.has(gram)).length;
  const overlap = shared / (target.size + other.size - shared || 1);
  const normalizedTarget = normalizedTitle(title);
  const normalizedCandidate = normalizedTitle(candidate);
  const contained = Boolean(normalizedTarget && normalizedCandidate
    && (normalizedTarget.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedTarget)));
  return Math.max(overlap, contained ? 0.82 : 0);
}
