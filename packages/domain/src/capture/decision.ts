import type { EntryKind } from "../entry";
import type { CaptureHistoryItem } from "./index";
import { titleMatchScore } from "./titleMatch";

export interface CaptureFieldCandidate {
  value: string;
  count: number;
  match: number;
}

export interface CaptureKindCandidate {
  value: EntryKind;
  count: number;
  match: number;
}

export interface CaptureFieldDecision {
  options: CaptureFieldCandidate[];
  selected?: string;
}

export interface CaptureFieldDecisions {
  kind: { options: CaptureKindCandidate[]; selected?: EntryKind };
  category: CaptureFieldDecision;
  location: CaptureFieldDecision;
  note: CaptureFieldDecision;
  defaultDuration?: number;
}

interface DecisionRecord {
  id: string;
  item: CaptureHistoryItem;
  tokens: Set<string>;
  signature: string;
}

interface CandidateRecord {
  count: number;
  lastSeen: number;
  match: number;
}

function titleTokens(title: string): Set<string> {
  const normalized = title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const tokens = new Set<string>();
  for (const word of normalized.split(/\s+/).filter(Boolean)) {
    if (!/[\u3400-\u9fff]/.test(word)) {
      tokens.add(word);
      continue;
    }
    const characters = [...word];
    if (characters.length < 2) {
      tokens.add(word);
      continue;
    }
    for (let index = 1; index < characters.length; index += 1) {
      tokens.add(characters[index - 1] + characters[index]);
    }
  }
  return tokens;
}

function itemSignature(item: CaptureHistoryItem): string {
  return JSON.stringify([
    item.kind,
    item.title,
    item.category,
    item.date,
    item.location ?? "",
    item.note ?? "",
    item.start ?? "",
    item.end ?? "",
  ]);
}

function parseClock(value: string | undefined): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value ?? "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
}

/**
 * A small in-memory frequency index. `sync` diffs the current history against
 * the records it already holds, so saving one new entry updates the affected
 * buckets instead of rebuilding every distribution.
 */
export class CaptureDecisionIndex {
  private readonly records = new Map<string, DecisionRecord>();
  private readonly terms = new Map<string, Set<string>>();
  private sequence = 0;

  constructor(history: readonly CaptureHistoryItem[] = []) {
    this.sync(history);
  }

  sync(history: readonly CaptureHistoryItem[]): void {
    const currentIds = new Set<string>();
    for (const item of history) {
      const id = item.id ?? `capture-${this.sequence + 1}`;
      const signature = itemSignature(item);
      const existing = this.records.get(id);
      currentIds.add(id);
      if (existing?.signature === signature) continue;
      if (existing) this.remove(id);
      this.add(id, item, signature);
      if (!item.id) this.sequence += 1;
    }
    for (const id of [...this.records.keys()]) {
      if (!currentIds.has(id)) this.remove(id);
    }
  }

  decide(
    title: string,
    options: { kind?: EntryKind; availableCategories?: ReadonlySet<string> } = {},
  ): CaptureFieldDecisions {
    const queryTokens = titleTokens(title);
    const records = queryTokens.size ? this.matches(title, queryTokens) : [];
    const kindCandidates = this.rank(records, (item) => item.kind, undefined, title)
      .map((candidate) => ({ ...candidate, value: candidate.value as EntryKind }))
      .sort((left, right) => KIND_ORDER[left.value] - KIND_ORDER[right.value]);
    const selectedKind = options.kind ?? chooseKind(kindCandidates);
    const scoped = records.filter((item) => item.item.kind === selectedKind);
    const category = this.rank(scoped, (item) => item.category, options.availableCategories, title);
    const location = this.rank(scoped, (item) => item.location, undefined, title);
    const note = this.rank(scoped, (item) => item.note?.trim(), undefined, title);
    return {
      kind: { options: kindCandidates, selected: selectedKind },
      category: { options: category, selected: significant(category)?.value },
      location: { options: location, selected: significant(location)?.value },
      note: { options: note, selected: significant(note)?.value },
      defaultDuration: this.duration(scoped),
    };
  }

  private matches(title: string, queryTokens: Set<string>): DecisionRecord[] {
    const matchedIds = new Set<string>();
    for (const token of queryTokens) {
      for (const id of this.terms.get(token) ?? []) matchedIds.add(id);
    }
    const matched = [...matchedIds]
      .map((id) => this.records.get(id)!)
      .filter((record) => [...queryTokens].some((token) => record.tokens.has(token)));
    matched.sort((left, right) =>
      titleMatchScore(title, right.item.title) - titleMatchScore(title, left.item.title)
      || right.item.date.localeCompare(left.item.date)
      || right.id.localeCompare(left.id));
    return matched;
  }

  private rank(
    records: readonly DecisionRecord[],
    selector: (item: CaptureHistoryItem) => string | undefined,
    available?: ReadonlySet<string>,
    query = "",
  ): CaptureFieldCandidate[] {
    const groups = new Map<string, CandidateRecord>();
    let total = 0;
    for (const record of records) {
      const value = selector(record.item)?.trim();
      if (!value || (available && !available.has(value))) continue;
      const group = groups.get(value) ?? { count: 0, lastSeen: 0, match: 0 };
      group.count += 1;
      group.lastSeen = Math.max(group.lastSeen, Date.parse(record.item.date) || 0);
      group.match = Math.max(group.match, query ? titleMatchScore(query, record.item.title) : 1);
      groups.set(value, group);
      total += 1;
    }
    return [...groups.entries()]
      .map(([value, group]) => ({ value, count: group.count, match: group.match }))
      .sort((left, right) => right.count - left.count
        || (groups.get(right.value)!.lastSeen - groups.get(left.value)!.lastSeen)
        || right.match - left.match
        || left.value.localeCompare(right.value))
      .slice(0, 3)
      .map((candidate) => ({ ...candidate, match: candidate.match * (candidate.count / (total || 1)) }));
  }

  private duration(records: readonly DecisionRecord[]): number | undefined {
    const counts = new Map<number, number>();
    for (const record of records) {
      const start = parseClock(record.item.start);
      const end = parseClock(record.item.end);
      if (start === undefined || end === undefined || end <= start) continue;
      counts.set(end - start, (counts.get(end - start) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
    return top ? (top[0] <= 30 ? 30 : 60) : undefined;
  }

  private add(id: string, item: CaptureHistoryItem, signature: string): void {
    const tokens = titleTokens(item.title);
    this.records.set(id, { id, item, tokens, signature });
    for (const token of tokens) {
      const ids = this.terms.get(token);
      if (ids) ids.add(id);
      else this.terms.set(token, new Set([id]));
    }
  }

  private remove(id: string): void {
    const record = this.records.get(id);
    if (!record) return;
    for (const token of record.tokens) {
      const ids = this.terms.get(token);
      if (!ids) continue;
      ids.delete(id);
      if (!ids.size) this.terms.delete(token);
    }
    this.records.delete(id);
  }
}

function chooseKind(candidates: readonly CaptureKindCandidate[]): EntryKind | undefined {
  return significant(candidates)?.value;
}

const KIND_ORDER: Record<EntryKind, number> = { event: 0, task: 1, bill: 2, idea: 3 };

/** A narrow win, or a repeated top choice, is strong enough to prefill. */
function significant<T extends CaptureFieldCandidate | CaptureKindCandidate>(
  candidates: readonly T[],
  minimumCount = 1,
): T | undefined {
  const top = candidates[0];
  if (!top || top.count < minimumCount) return undefined;
  const total = candidates.reduce((sum, candidate) => sum + candidate.count, 0);
  return top.count / total >= 0.4 || top.count >= 2 ? top : undefined;
}
