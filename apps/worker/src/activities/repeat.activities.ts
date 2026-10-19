/**
 * The activity behind repeating posts (2026-10-19): after a root publishes,
 * `postPublishWorkflow` asks for its next occurrence. The work itself, and
 * why it is a new post rather than a republish, is in
 * `lib/next-occurrence.ts`; this file only binds it to the worker's client
 * and logger.
 */
import type { PostPublishInput } from '@postgear/scheduling';
import { Context } from '@temporalio/activity';
import { type NextOccurrenceResult, queueNextOccurrence } from '../lib/next-occurrence';
import type { ActivityDeps } from './deps';

export function createRepeatActivities(deps: ActivityDeps) {
  return {
    /** Idempotent: a retry, or a second channel of the same post, finds what the first made. */
    async queueNextOccurrence(input: PostPublishInput): Promise<NextOccurrenceResult> {
      return queueNextOccurrence(input, {
        temporalClient: deps.temporalClient,
        log: (message, meta) => Context.current().log.warn(message, meta),
      });
    },
  };
}

export type RepeatActivities = ReturnType<typeof createRepeatActivities>;
