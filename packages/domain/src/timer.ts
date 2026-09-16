import type { EntryDraft } from "./entry";

/**
 * A crash-safe live stopwatch model shared by every ChronoEon client. The
 * session is a list of segments so pausing never loses accumulated time, and a
 * heartbeat lets a recovered session drop wall-clock time spent while the app
 * was closed instead of silently inflating the recording.
 */
export interface TimerSegment {
  /** Epoch milliseconds. */
  start: number;
  /** Epoch milliseconds; absent while the segment is still running. */
  end?: number;
}

/** Editable context attached to a recording; every field is optional. */
export interface TimerDetails {
  category?: string;
  location?: string;
  note?: string;
  images?: string[];
}

export interface TimerSession extends TimerDetails {
  id: string;
  title: string;
  calendarId: string;
  kind: "task" | "event";
  segments: TimerSegment[];
  createdAt: number;
  /** Last heartbeat; the recovery cut-off for an interrupted segment. */
  lastTick: number;
}

export interface TimerStartOptions extends TimerDetails {
  title: string;
  calendarId: string;
  kind?: "task" | "event";
}

/** A heartbeat gap larger than this means the app was closed, not merely idle. */
export const TIMER_RECOVERY_GAP_MS = 90_000;
export const TIMER_HEARTBEAT_MS = 5_000;
/** Segments shorter than this are accidental start→stop taps. */
export const TIMER_MIN_SEGMENT_MS = 1_000;

export function isTimerRunning(session: TimerSession | null | undefined): boolean {
  if (!session || session.segments.length === 0) return false;
  return session.segments[session.segments.length - 1].end === undefined;
}

export function timerElapsedMs(session: TimerSession | null | undefined, now: number): number {
  if (!session) return 0;
  return session.segments.reduce((sum, segment) => sum + Math.max(0, (segment.end ?? now) - segment.start), 0);
}

/** Format a millisecond duration as `H:MM:SS`, dropping a zero hour part. */
export function formatTimerDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

export function createTimerSession(options: TimerStartOptions, startedAt: number): TimerSession {
  return {
    id: `timer_${startedAt}`,
    title: options.title,
    calendarId: options.calendarId,
    category: options.category,
    location: options.location?.trim() || undefined,
    note: options.note?.trim() || undefined,
    images: options.images?.length ? options.images : undefined,
    kind: options.kind ?? "event",
    segments: [{ start: startedAt }],
    createdAt: startedAt,
    lastTick: startedAt
  };
}

/**
 * Change title or details mid-recording; segments and timestamps are untouched.
 * Text is stored as typed (the inputs are controlled) and trimmed only when the
 * draft is built.
 */
export function updateTimerSession(session: TimerSession, patch: TimerDetails & { title?: string }): TimerSession {
  return {
    ...session,
    ...patch,
    images: patch.images !== undefined ? (patch.images.length ? patch.images : undefined) : session.images,
  };
}

export function pauseTimerSession(session: TimerSession, at: number): TimerSession {
  if (!isTimerRunning(session)) return session;
  const segments = session.segments.slice();
  segments[segments.length - 1] = { ...segments[segments.length - 1], end: at };
  return { ...session, segments, lastTick: at };
}

export function resumeTimerSession(session: TimerSession, at: number): TimerSession {
  if (isTimerRunning(session)) return session;
  return { ...session, segments: [...session.segments, { start: at }], lastTick: at };
}

export interface TimerRecovery {
  session: TimerSession;
  /** True when offline time was discarded and the user should review the result. */
  recovered: boolean;
}

/**
 * Rebuild a persisted session. When the heartbeat is stale the open segment is
 * capped at the last heartbeat, so a crash never bills the user for hours the
 * app was not running.
 */
export function recoverTimerSession(
  session: TimerSession,
  now: number,
  gapMs = TIMER_RECOVERY_GAP_MS
): TimerRecovery {
  if (!isTimerRunning(session)) return { session, recovered: false };
  const gap = now - (session.lastTick || session.createdAt);
  if (gap <= gapMs) return { session, recovered: false };
  const segments = session.segments.slice();
  const last = { ...segments[segments.length - 1] };
  last.end = Math.max(last.start, session.lastTick || last.start);
  segments[segments.length - 1] = last;
  return { session: { ...session, segments }, recovered: true };
}

/** Close every open segment and drop sub-second noise. */
export function finalizeTimerSegments(session: TimerSession, at: number): TimerSegment[] {
  return session.segments
    .map((segment) => ({ start: segment.start, end: segment.end ?? at }))
    .filter((segment) => segment.end - segment.start >= TIMER_MIN_SEGMENT_MS);
}

function localStamp(value: Date): { date: string; time: string } {
  const pad = (input: number) => String(input).padStart(2, "0");
  return {
    date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
    time: `${pad(value.getHours())}:${pad(value.getMinutes())}`
  };
}

/**
 * Turn a finished recording into an entry draft. The span covers the first
 * start to the last end so a paused-and-resumed session stays one readable
 * calendar block; the exact recorded duration is preserved in the note.
 */
export function timerSessionToDraft(
  session: TimerSession,
  segments: TimerSegment[],
  fallbackTitle: string
): EntryDraft | null {
  if (segments.length === 0) return null;
  const first = segments[0];
  const last = segments[segments.length - 1];
  const begin = localStamp(new Date(first.start));
  const finish = localStamp(new Date(last.end ?? last.start));
  const recordedMs = segments.reduce((sum, segment) => sum + Math.max(0, (segment.end ?? segment.start) - segment.start), 0);
  const spanMs = (last.end ?? last.start) - first.start;
  const paused = segments.length > 1 && spanMs - recordedMs >= TIMER_MIN_SEGMENT_MS;
  const stamp = paused ? `⏱ ${formatTimerDuration(recordedMs)} / ${segments.length}` : `⏱ ${formatTimerDuration(recordedMs)}`;
  const note = session.note?.trim();

  return {
    kind: session.kind,
    title: session.title.trim() || fallbackTitle,
    date: begin.date,
    start: begin.time,
    end: finish.time,
    endDate: finish.date !== begin.date ? finish.date : undefined,
    allDay: false,
    calendar: session.calendarId,
    category: session.category ?? "uncategorized",
    location: session.location?.trim() || undefined,
    images: session.images?.length ? session.images : undefined,
    note: note ? `${note}\n${stamp}` : stamp
  };
}
