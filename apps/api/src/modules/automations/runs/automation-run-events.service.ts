/**
 * Live progress of one run over SSE (Module 07, "Live progress"): the API
 * polls the database every 750 ms and sends what changed.
 *
 * ## Why a poll, not Redis pub/sub
 *
 * The worker is another process, `RedisService` deliberately exposes only
 * counters and keys, and its in-memory fallback cannot reach the worker.
 * The bell already polls for the same reason (`notifications.dispatcher.ts`).
 * The database is the truth either way, and one indexed query per open run
 * view per 750 ms is cheap. Pub/sub can come later behind the same events.
 *
 * ## What is sent
 *
 * - `step`: a step's latest attempt, the same redacted shape as
 *   `GET /automation-runs/:runId` (`RunStepView`), whenever any of its
 *   attempt rows changed. The first poll sends every step, so a reconnect
 *   gets the whole picture.
 * - `run`: `{ id, status, error, stepCount, startedAt, finishedAt }` on the
 *   first poll and whenever one of them changes.
 * - `error`: `{ message }` when the stream stops on a problem.
 *
 * Steps are read after the run, so when the run reads terminal every step
 * written before it is in the same poll: the client gets the last steps,
 * then the final `run` event, then the stream closes. It also closes after
 * 30 minutes; the client reconnects.
 *
 * ## Late rows
 *
 * `updatedAt` is stamped by the worker before its write commits, so with
 * parallel steps a row can appear with a stamp older than one already
 * seen. Each poll looks 5 seconds further back than the newest stamp seen
 * and skips rows it already sent at that stamp.
 */
import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import type { SseStream } from '../../../common/sse';
import { RUN_MESSAGES } from './automation-runs.messages';
import { AutomationRunsRepository } from './automation-runs.repository';
import { UUID_PATTERN } from './automation-runs.service';
import { connectionValuesOf, TERMINAL_RUN_STATUSES, toRunEvent, toStepView } from './run-views';

export const RUN_EVENTS_POLL_MS = 750;
export const RUN_EVENTS_MAX_MS = 30 * 60_000;
export const RUN_EVENTS_OVERLAP_MS = 5_000;

/** Time, as a test replaces it. */
export interface RunEventsClock {
  now(): number;
  /** Resolves after `ms`, or at once when `signal` aborts (the client left). */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export const RUN_EVENTS_CLOCK = Symbol('RUN_EVENTS_CLOCK');

const realClock: RunEventsClock = { now: () => Date.now(), sleep: abortableSleep };

@Injectable()
export class AutomationRunEventsService {
  private readonly logger = new Logger(AutomationRunEventsService.name);
  private readonly clock: RunEventsClock;

  constructor(
    private readonly repository: AutomationRunsRepository,
    @Optional() @Inject(RUN_EVENTS_CLOCK) clock?: RunEventsClock,
  ) {
    this.clock = clock ?? realClock;
  }

  /** Checked before the stream opens, so another workspace's run is a plain 404. */
  async assertRun(orgId: string, runId: string): Promise<void> {
    const run = UUID_PATTERN.test(runId)
      ? await this.repository.findRunSummary(orgId, runId)
      : null;
    if (!run) throw new NotFoundException(RUN_MESSAGES.RUN_NOT_FOUND);
  }

  /** Polls until the run is terminal, 30 minutes pass, or the client leaves. Never throws. */
  async stream(orgId: string, runId: string, stream: SseStream): Promise<void> {
    const deadline = this.clock.now() + RUN_EVENTS_MAX_MS;
    const sent = new Map<string, number>();
    let newest = 0;
    let lastRunEvent = '';

    try {
      const { values, unreadable } = connectionValuesOf(
        await this.repository.connectionCredentials(orgId),
      );
      if (unreadable > 0) {
        this.logger.warn(
          JSON.stringify({ event: 'automation.connections.unreadable', orgId, count: unreadable }),
        );
      }

      while (!stream.closed) {
        const run = await this.repository.findRunSummary(orgId, runId);
        if (!run) {
          stream.send('error', { message: RUN_MESSAGES.RUN_GONE });
          return;
        }

        const changed = await this.repository.stepsChangedSince(
          orgId,
          runId,
          new Date(Math.max(0, newest - RUN_EVENTS_OVERLAP_MS)),
        );
        const fresh = changed.filter((row) => sent.get(row.id) !== row.updatedAt.getTime());
        for (const row of changed) newest = Math.max(newest, row.updatedAt.getTime());

        if (fresh.length > 0) {
          for (const row of fresh) sent.set(row.id, row.updatedAt.getTime());
          const keys = [...new Set(fresh.map((row) => row.nodeKey))];
          for (const entry of await this.repository.latestSteps(orgId, runId, keys)) {
            stream.send('step', toStepView(entry, values));
          }
        }

        const event = toRunEvent(run, values);
        const fingerprint = JSON.stringify(event);
        if (fingerprint !== lastRunEvent) {
          stream.send('run', event);
          lastRunEvent = fingerprint;
        }

        if (TERMINAL_RUN_STATUSES.has(run.status) || this.clock.now() >= deadline) return;
        await this.clock.sleep(RUN_EVENTS_POLL_MS, stream.signal);
      }
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'automation.run_events.failed',
          runId,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
      stream.send('error', { message: RUN_MESSAGES.STREAM_STOPPED });
    }
  }
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });

    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}
