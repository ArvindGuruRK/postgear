/**
 * The `[simulate:...]` markers both stand-ins understand.
 *
 * `PUBLISH_SIMULATION` (lib/publisher.ts) reads them in a post's text and
 * `AUTOMATION_SIMULATION` (automation/providers/provider-executor.ts) reads
 * them in a step's resolved settings, so one way of asking for a failure
 * works everywhere:
 *
 * | Marker               | Meaning                                                |
 * |----------------------|--------------------------------------------------------|
 * | `[simulate:429]`     | Rate limited: a failure worth retrying                 |
 * | `[simulate:5xx]`     | The app is down: a failure worth retrying              |
 * | `[simulate:500]`     | The same as `5xx`                                      |
 * | `[simulate:401]`     | The connection was refused (expired or revoked)        |
 * | `[simulate:403]`     | Not allowed (missing permission)                       |
 * | `[simulate:400]`     | The app refused the content: retrying will not help    |
 * | `[simulate:slow:5]`  | Takes five seconds, then goes on                       |
 *
 * A failure marker may carry an attempt bound: `[simulate:429x2]` fails
 * attempts 1 and 2 and lets the third through.
 *
 * Pure: no clock, no I/O, so both stand-ins and their tests share it.
 */

const DIRECTIVE = /\[simulate:(429|5xx|500|401|400|403|slow)(?::(\d+)|x(\d+))?\]/i;

export interface SimulationDirective {
  kind: '429' | '5xx' | '401' | '400' | '403' | 'slow';
  /** For failures: fail attempts up to and including this one. Absent means always. */
  untilAttempt?: number;
  /** For `slow`: seconds to wait. */
  seconds?: number;
}

/** The first marker in the text, or null. */
export function parseSimulationDirective(message: string): SimulationDirective | null {
  const match = DIRECTIVE.exec(message);

  if (!match) {
    return null;
  }

  const raw = match[1].toLowerCase();
  const kind = (raw === '500' ? '5xx' : raw) as SimulationDirective['kind'];

  return {
    kind,
    ...(match[3] ? { untilAttempt: Number(match[3]) } : {}),
    ...(kind === 'slow' ? { seconds: match[2] ? Number(match[2]) : 5 } : {}),
  };
}

/** True when the directive still applies on this attempt (`429x2` stops after attempt 2). */
export function directiveApplies(directive: SimulationDirective, attempt: number): boolean {
  return directive.untilAttempt === undefined || attempt <= directive.untilAttempt;
}

/** What a marker asks a workflow step's stand-in to do. */
export type SimulatedOutcome =
  | { kind: 'retryable'; status: 429 | 500 }
  | { kind: 'connectionBroken'; status: 401 | 403 }
  | { kind: 'permanent'; status: 400 }
  | { kind: 'slow'; seconds: number };

/**
 * The outcome a marker in `text` forces on this attempt, or null when the
 * stand-in should succeed.
 */
export function simulatedOutcome(text: string, attempt: number): SimulatedOutcome | null {
  const directive = parseSimulationDirective(text);
  if (!directive || !directiveApplies(directive, attempt)) {
    return null;
  }

  switch (directive.kind) {
    case '429':
      return { kind: 'retryable', status: 429 };
    case '5xx':
      return { kind: 'retryable', status: 500 };
    case '401':
      return { kind: 'connectionBroken', status: 401 };
    case '403':
      return { kind: 'connectionBroken', status: 403 };
    case '400':
      return { kind: 'permanent', status: 400 };
    case 'slow':
      return { kind: 'slow', seconds: directive.seconds ?? 5 };
  }
}
