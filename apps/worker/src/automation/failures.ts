/**
 * How a step fails: executors and the engine throw `StepFailure`; the
 * activity turns it into the stored `AutomationStepError` and the
 * `ApplicationFailure` the workflow's retry policy reads.
 *
 * The message is the one sentence the user sees, so it is plain words and
 * never carries a stack, a status line or a secret. Anything for support
 * goes in `details` (redacted before it is stored).
 */
import {
  AUTOMATION_FAILURE_TYPES,
  type AutomationStepError,
  NON_RETRYABLE_AUTOMATION_FAILURES,
} from '@postgear/scheduling';
import { ApplicationFailure } from '@temporalio/activity';

export type FailureKind = keyof typeof AUTOMATION_FAILURE_TYPES;

/** The short code a failure gets when the thrower gave none. */
const DEFAULT_CODES: Record<FailureKind, string> = {
  retryable: 'temporary',
  permanent: 'permanent',
  notConnected: 'not_connected',
  outOfCredits: 'out_of_credits',
  limit: 'limit',
};

export const UNEXPECTED_MESSAGE = 'Something unexpected went wrong in this step.';
export const TIMEOUT_MESSAGE = 'This step took too long.';

export class StepFailure extends Error {
  readonly code: string;
  /**
   * Retryable failures only: when the app asked PostGear to come back
   * (`Retry-After`, capped by the provider). Temporal's next retry waits this
   * long instead of the policy's backoff; the attempt count is unchanged.
   */
  retryAfterMs?: number;

  constructor(
    readonly kind: FailureKind,
    message: string,
    code?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'StepFailure';
    this.code = code ?? DEFAULT_CODES[kind];
  }

  toStepError(): AutomationStepError {
    return {
      message: this.message,
      code: this.code,
      retryable: this.kind === 'retryable',
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

export function permanent(message: string, code?: string, details?: unknown): StepFailure {
  return new StepFailure('permanent', message, code, details);
}

export function notConnected(message: string, code?: string, details?: unknown): StepFailure {
  return new StepFailure('notConnected', message, code, details);
}

const KIND_BY_TYPE = new Map<string, FailureKind>(
  (Object.entries(AUTOMATION_FAILURE_TYPES) as [FailureKind, string][]).map(([kind, type]) => [
    type,
    kind,
  ]),
);

/** The failure kind for an `ApplicationFailure.type`, or undefined for any other type. */
export function kindOfType(type: string | null | undefined): FailureKind | undefined {
  return type ? KIND_BY_TYPE.get(type) : undefined;
}

/** The stored code for a failure type the workflow reports (null: a timeout or a crash). */
export function codeOfType(type: string | null, timedOut: boolean): string {
  if (timedOut) return 'timeout';
  const kind = kindOfType(type);
  return kind ? DEFAULT_CODES[kind] : 'unexpected';
}

/**
 * Any thrown value as a typed failure. Unknown errors are retryable (a
 * network blip, a database restart) and keep their own text in `details`
 * only, never in the message.
 */
export function toStepFailure(error: unknown): StepFailure {
  if (error instanceof StepFailure) {
    return error;
  }
  if (error instanceof ApplicationFailure) {
    const kind = kindOfType(error.type);
    if (kind) {
      return new StepFailure(kind, error.message, undefined, error.details?.[0]);
    }
  }
  const name = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : String(error);
  return new StepFailure('retryable', UNEXPECTED_MESSAGE, 'unexpected', { name, message });
}

/**
 * What the activity throws: Temporal retries only `retryable`, after
 * `retryAfterMs` when the app named a wait.
 */
export function toApplicationFailure(
  kind: FailureKind,
  stepError: AutomationStepError,
  retryAfterMs?: number,
) {
  const type = AUTOMATION_FAILURE_TYPES[kind];
  const nonRetryable = NON_RETRYABLE_AUTOMATION_FAILURES.includes(type);
  return ApplicationFailure.create({
    type,
    message: stepError.message,
    nonRetryable,
    details: [{ code: stepError.code }],
    ...(!nonRetryable && retryAfterMs !== undefined && retryAfterMs > 0
      ? { nextRetryDelay: retryAfterMs }
      : {}),
  });
}
