/** Ordered fragments: "辽宁酒店" matches "辽宁开原酒店", without matching reversed words. */
export function captureMatchPositions(text: string, query: string): number[] | null {
  const haystack = text.toLocaleLowerCase();
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const contiguous = haystack.indexOf(needle);
  if (contiguous >= 0) return Array.from({ length: needle.length }, (_, index) => contiguous + index);
  const positions: number[] = [];
  let cursor = 0;
  for (const character of needle.replace(/\s+/g, "")) {
    const index = haystack.indexOf(character, cursor);
    if (index < 0) return null;
    positions.push(index);
    cursor = index + character.length;
  }
  return positions;
}
