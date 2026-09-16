import type { Entry, EntryDraft, EntryKind, Locale } from "@chronoeon/domain";

export interface EntryQuery {
  from?: string;
  to?: string;
  kinds?: EntryKind[];
  calendarIds?: string[];
  categories?: string[];
  search?: string;
}

export interface EntrySnapshot {
  entry: Entry;
  /** Disposable store revision (`"v1:<updated_at>"`). */
  revision: string;
}

export type EntryRepositoryEvent =
  | { type: "created" | "updated"; snapshot: EntrySnapshot }
  | { type: "deleted"; id: string; revision?: string }
  | { type: "rebuilt" };

/**
 * SQLite-backed application boundary (architecture pivot). One row per entry
 * or recurrence series; occurrences stay virtual (projected by
 * `@chronoeon/domain > calendar.ts`). Date moves are ordinary updates.
 */
export interface EntryStore {
  list(query?: EntryQuery): Promise<Entry[]>;
  get(id: string): Promise<Entry | null>;
  create(entry: Entry): Promise<Entry>;
  /** `expectedUpdatedAt`: raw ISO `updated_at` to compare against (a `"v1:"` revision prefix is accepted and stripped). */
  update(entry: Entry, options?: { expectedUpdatedAt?: string }): Promise<Entry>;
  delete(id: string): Promise<void>;
  subscribe?(listener: (event: EntryRepositoryEvent) => void): () => void;
}

export interface NotificationRequest {
  entryId: string;
  title: string;
  body?: string;
  fireAt: string;
}

export interface NotificationPort {
  schedule(request: NotificationRequest): Promise<void>;
  cancel(entryId: string): Promise<void>;
  reconcile(requests: NotificationRequest[]): Promise<void>;
  requestPermission(): Promise<"granted" | "denied" | "unavailable">;
}

export interface AiParseContext {
  locale: Locale;
  now: string;
  timeZone: string;
  defaultDate: string;
  availableCategories: string[];
  availableCurrencies: string[];
  availablePaymentMethods: string[];
}

export interface AiParseProposal {
  draft: EntryDraft;
  confidence?: number;
  warnings?: string[];
}

/** Provider-neutral AI boundary. Providers return proposals; only the store may persist them. */
export interface AiProvider {
  readonly id: string;
  isAvailable(): Promise<boolean>;
  parse(input: string, context: AiParseContext): Promise<AiParseProposal[]>;
}
