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
  defaultDuration?: number;
  /** Minutes after midnight the user usually starts a matching record. */
  defaultStart?: number;
}

interface DecisionRecord {
  id: string;
  item: CaptureHistoryItem;
  tokens: Set<string>;
  signature: string;
  matchScore?: number;
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
    item.calendar,
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

function median(values: readonly number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
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
    options: { kind?: EntryKind; availableCategories?: ReadonlySet<string>; calendar?: string } = {},
  ): CaptureFieldDecisions {
    const queryTokens = titleTokens(title);
    const records = (queryTokens.size ? this.matches(title, queryTokens) : []).filter(record => !options.calendar || !record.item.calendar || record.item.calendar === options.calendar);
    const kindCandidates = this.rank(records, (item) => item.kind, undefined, title)
      .map((candidate) => ({ ...candidate, value: candidate.value as EntryKind }));
    const selectedKind = options.kind ?? chooseKind(kindCandidates);
    const scoped = records.filter((item) => !selectedKind || item.item.kind === selectedKind);
    const category = this.rank(scoped, (item) => item.category, options.availableCategories, title);
    const location = this.rank(scoped, (item) => item.location, undefined, title);
    // Only near-identical titles teach a time: "午饭" must not inherit "午饭后散步".
    const habitual = scoped.filter(record => (record.matchScore ?? 0) >= 0.9);
    return {
      kind: { options: kindCandidates, selected: chooseKind(kindCandidates) },
      category: { options: category, selected: significant(category)?.value },
      location: { options: location, selected: significant(location)?.value },
      defaultDuration: this.duration(habitual),
      defaultStart: this.start(habitual),
    };
  }

  private matches(title: string, queryTokens: Set<string>): DecisionRecord[] {
    const matchedIds = new Set<string>();
    for (const token of queryTokens) {
      for (const id of this.terms.get(token) ?? []) matchedIds.add(id);
    }
    const matched = [...matchedIds]
      .map((id) => this.records.get(id)!)
      .map(record => ({ ...record, matchScore: titleMatchScore(title, record.item.title) }));
    matched.sort((left, right) => right.matchScore - left.matchScore
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
      group.match = Math.max(group.match, record.matchScore ?? (query ? titleMatchScore(query, record.item.title) : 1));
      groups.set(value, group);
      total += 1;
    }
    return [...groups.entries()]
      .map(([value, group]) => ({ value, count: group.count, match: group.match }))
      .sort((left, right) => right.match - left.match
        || right.count - left.count
        || (groups.get(right.value)!.lastSeen - groups.get(left.value)!.lastSeen)
        || left.value.localeCompare(right.value))
      .slice(0, 3)
      .map((candidate) => ({ ...candidate, match: candidate.match * (candidate.count / (total || 1)) }));
  }

  /** The median length of the matching records, to the nearest five minutes. */
  private duration(records: readonly DecisionRecord[]): number | undefined {
    const lengths: number[] = [];
    for (const record of records) {
      const start = parseClock(record.item.start);
      const end = parseClock(record.item.end);
      if (start === undefined || end === undefined || end <= start) continue;
      lengths.push(end - start);
    }
    const middle = median(lengths);
    return middle === undefined ? undefined : Math.max(5, Math.round(middle / 5) * 5);
  }

  /** The usual start, when the matching records agree on one: at least two timed
   *  records, mostly timed, and most of them within 45 minutes of the median. */
  private start(records: readonly DecisionRecord[]): number | undefined {
    const starts = records.map((record) => parseClock(record.item.start)).filter((value): value is number => value !== undefined);
    if (starts.length < 2 || starts.length * 2 < records.length) return undefined;
    const middle = median(starts)!;
    const near = starts.filter((value) => Math.abs(value - middle) <= 45).length;
    return near / starts.length >= 0.6 ? Math.round(middle / 5) * 5 : undefined;
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
  const [first, second] = candidates;
  if (first && second && first.count === second.count && first.match === second.match) return undefined;
  return significant(candidates)?.value;
}


/** Frequency ranks suggestions, but never substitutes for strong textual evidence. */
function significant<T extends CaptureFieldCandidate | CaptureKindCandidate>(candidates: readonly T[]): T | undefined {
  const [top, second] = candidates;
  return top && top.match >= 0.85 && (!second || top.match - second.match >= 0.2) ? top : undefined;
}
