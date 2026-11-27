/**
 * Where a week of a Twitch schedule comes from (Sprint 13, Module 14 section
 * C3): Twitch's Helix API with PostGear's app token, or, in simulation, the
 * hand-written fixtures next to this file. The service sees one interface
 * and never knows which.
 *
 * Every time is UTC, as Twitch sends it (`utc_offset` is not supported); the
 * zone is the person's, applied in the browser by `segmentsToRows`.
 */
import type { ScheduleSegment, ScheduleVacation } from '@postgear/design-engine';

/** The UTC instants the fetch covers. */
export interface ScheduleWindow {
  start: Date;
  end: Date;
}

export interface ScheduleRequest {
  login: string;
  /** The week's Monday, `YYYY-MM-DD`. */
  weekStart: string;
  window: ScheduleWindow;
  signal?: AbortSignal;
}

export interface Broadcaster {
  login: string;
  displayName: string;
}

/**
 * What Twitch said, as data. `no_schedule` is Twitch's 404 (no schedule, or
 * no streams in it) and `no_user` an unknown login; both are answers, not
 * failures, so both are cached. A failure is thrown.
 */
export type ScheduleOutcome =
  | {
      kind: 'found';
      broadcaster: Broadcaster;
      segments: ScheduleSegment[];
      vacation: ScheduleVacation | null;
    }
  | { kind: 'no_schedule'; broadcaster: Broadcaster }
  | { kind: 'no_user' };

export interface ScheduleSource {
  /** Which binding this is, for the boot log line. */
  readonly mode: 'helix' | 'simulation';
  fetch(request: ScheduleRequest): Promise<ScheduleOutcome>;
}

/**
 * A fetch that went wrong, by one code. Never carries Twitch's own words, a
 * token or an address, so it is safe to log by `code`.
 */
export type ScheduleFailureCode =
  | 'unconfigured'
  | 'rate_limited'
  | 'platform_changed'
  | 'upstream_failed';

export class ScheduleFetchFailure extends Error {
  constructor(readonly code: ScheduleFailureCode) {
    super(`schedule fetch failed: ${code}`);
    this.name = 'ScheduleFetchFailure';
  }
}

/** The longest a title or a category is kept: what a design row may hold. */
export const MAX_SEGMENT_TEXT = 200;

/** One line of plain text, capped: Twitch's words never carry a control character into a design. */
export function plainText(value: string): string {
  return (
    value
      // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is removed.
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_SEGMENT_TEXT)
  );
}
