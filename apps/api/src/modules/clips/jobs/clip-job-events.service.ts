/**
 * Live progress of one clip job over SSE (Sprint 12, Module 02), the same
 * shape of loop as `AutomationRunEventsService`: the worker is another
 * process, so the API re-reads the row every 750 ms and sends what changed.
 * One indexed read per open job view is cheap, and the database is the
 * truth either way.
 *
 * Events:
 * - `progress`: the job view, on the first poll and whenever the status,
 *   the step, the progress or the estimate changed.
 * - `done`, `failed`, `cancelled`: the final view, then the stream closes.
 * - `error`: `{ message }` when the stream itself stops on a problem.
 *
 * The estimate is built from the progress samples this stream saw (the pace
 * over the last minute), with the workspace's typical length for the kind as
 * the prior before there is a pace. It closes after 30 minutes; the client
 * reconnects and picks up from the row.
 *
 * Sprint 13, Module 11: `streamMany` follows several jobs at once (an Export
 * All batch) with ONE read per poll for all of them. The same events and
 * payloads, one per job change (the view's `id` says which job): `progress`
 * while it changes, then that job's `done`, `failed` or `cancelled`. The
 * stream stays open until every job has sent its last event (a job that is
 * gone, or another workspace's, is dropped silently), then closes.
 *
 * Sprint 13, Module 15: a job waiting for its turn carries `waiting` (its
 * place in the queue and about how long), asked again every
 * `WAITING_REFRESH_MS`; a change in it is a change worth a `progress` event.
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { ClipJob } from '@postgear/db';
import type { ProgressSample } from '@postgear/video-engine';
import type { SseStream } from '../../../common/sse';
import { CLIPS_MESSAGES } from '../clips.messages';
import {
  type ClipJobView,
  type ClipJobWaiting,
  isWaitingTurn,
  median,
  TERMINAL_JOB_STATUSES,
  toJobView,
} from './clip-job-view';
import { ClipJobsRepository } from './clip-jobs.repository';
import { ClipJobsService } from './clip-jobs.service';

export const JOB_EVENTS_POLL_MS = 750;
export const JOB_EVENTS_MAX_MS = 30 * 60_000;
/** Samples older than this are dropped; the estimate only reads the last minute. */
const SAMPLE_KEEP_MS = 90_000;
/** How often a waiting job's place in the queue is asked again (the queue itself is read every 5 s). */
export const WAITING_REFRESH_MS = 5_000;

export interface JobEventsClock {
  now(): number;
  /** Resolves after `ms`, or at once when `signal` aborts (the client left). */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export const JOB_EVENTS_CLOCK = Symbol('JOB_EVENTS_CLOCK');

const realClock: JobEventsClock = { now: () => Date.now(), sleep: abortableSleep };

@Injectable()
export class ClipJobEventsService {
  private readonly logger = new Logger(ClipJobEventsService.name);
  private readonly clock: JobEventsClock;

  constructor(
    private readonly jobs: ClipJobsService,
    private readonly repository: ClipJobsRepository,
    @Optional() @Inject(JOB_EVENTS_CLOCK) clock?: JobEventsClock,
  ) {
    this.clock = clock ?? realClock;
  }

  /** Before the stream opens, so another workspace's job is a plain 404. */
  async assertJob(orgId: string, jobId: string): Promise<void> {
    await this.jobs.require(orgId, jobId);
  }

  /** Polls until the job ends, 30 minutes pass, or the client leaves. Never throws. */
  async stream(orgId: string, jobId: string, stream: SseStream): Promise<void> {
    const deadline = this.clock.now() + JOB_EVENTS_MAX_MS;
    const samples: ProgressSample[] = [];
    let priorSeconds: number | null | undefined;
    let last = '';
    let waiting: { at: number; value: ClipJobWaiting | null } | null = null;

    try {
      while (!stream.closed) {
        const job = await this.repository.find(orgId, jobId);
        if (!job) {
          stream.send('error', { message: CLIPS_MESSAGES.JOB_GONE });
          return;
        }

        if (job.status === 'RUNNING') {
          const now = this.clock.now();
          const previous = samples[samples.length - 1];
          if (!previous || previous.progress !== job.progress) {
            samples.push({ at: now, progress: job.progress });
          }
          while (samples.length > 1 && (samples[0] as ProgressSample).at < now - SAMPLE_KEEP_MS) {
            samples.shift();
          }
          if (priorSeconds === undefined) {
            priorSeconds = median(await this.repository.recentDurations(orgId, job.kind));
          }
        }

        if (isWaitingTurn(job)) {
          const now = this.clock.now();
          if (!waiting || now - waiting.at >= WAITING_REFRESH_MS) {
            waiting = { at: now, value: (await this.jobs.waitingFor([job])).get(job.id) ?? null };
          }
        }

        const view = toJobView(
          job,
          { samples, priorSeconds: priorSeconds ?? null },
          waiting?.value ?? null,
        );

        if (TERMINAL_JOB_STATUSES.has(job.status)) {
          stream.send(
            job.status === 'DONE' ? 'done' : job.status === 'FAILED' ? 'failed' : 'cancelled',
            view,
          );
          return;
        }

        const fingerprint = fingerprintOf(view);
        if (fingerprint !== last) {
          stream.send('progress', view);
          last = fingerprint;
        }

        if (this.clock.now() >= deadline) return;
        await this.clock.sleep(JOB_EVENTS_POLL_MS, stream.signal);
      }
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.job_events.failed',
          jobId,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
      stream.send('error', { message: CLIPS_MESSAGES.STREAM_STOPPED });
    }
  }

  /**
   * Module 11: polls several jobs of the workspace until each has ended, 30
   * minutes pass, or the client leaves. Never throws.
   */
  async streamMany(orgId: string, jobIds: readonly string[], stream: SseStream): Promise<void> {
    const deadline = this.clock.now() + JOB_EVENTS_MAX_MS;
    const watched = new Map<string, Watched>(
      [...new Set(jobIds)].map((id) => [id, { samples: [], last: '', ended: false }]),
    );
    const priors = new Map<ClipJob['kind'], number | null>();
    let waiting: { at: number; values: Map<string, ClipJobWaiting> } | null = null;

    try {
      while (!stream.closed) {
        const open = [...watched].filter(([, state]) => !state.ended).map(([id]) => id);
        if (open.length === 0) return;
        const rows = new Map(
          (await this.repository.findMany(orgId, open)).map((job) => [job.id, job]),
        );
        const now = this.clock.now();
        const queued = [...rows.values()].filter(isWaitingTurn);
        if (queued.length === 0) {
          waiting = null;
        } else if (!waiting || now - waiting.at >= WAITING_REFRESH_MS) {
          // One look at the queue for every waiting job of the batch.
          waiting = { at: now, values: await this.jobs.waitingFor(queued) };
        }

        for (const id of open) {
          const state = watched.get(id) as Watched;
          const job = rows.get(id);
          if (!job) {
            state.ended = true;
            continue;
          }

          if (job.status === 'RUNNING') {
            const now = this.clock.now();
            const previous = state.samples[state.samples.length - 1];
            if (!previous || previous.progress !== job.progress) {
              state.samples.push({ at: now, progress: job.progress });
            }
            while (
              state.samples.length > 1 &&
              (state.samples[0] as ProgressSample).at < now - SAMPLE_KEEP_MS
            ) {
              state.samples.shift();
            }
            if (!priors.has(job.kind)) {
              priors.set(job.kind, median(await this.repository.recentDurations(orgId, job.kind)));
            }
          }

          const view = toJobView(
            job,
            { samples: state.samples, priorSeconds: priors.get(job.kind) ?? null },
            waiting?.values.get(job.id) ?? null,
          );

          if (TERMINAL_JOB_STATUSES.has(job.status)) {
            stream.send(
              job.status === 'DONE' ? 'done' : job.status === 'FAILED' ? 'failed' : 'cancelled',
              view,
            );
            state.ended = true;
            continue;
          }

          const fingerprint = fingerprintOf(view);
          if (fingerprint !== state.last) {
            stream.send('progress', view);
            state.last = fingerprint;
          }
        }

        if ([...watched.values()].every((state) => state.ended)) return;
        if (this.clock.now() >= deadline) return;
        await this.clock.sleep(JOB_EVENTS_POLL_MS, stream.signal);
      }
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.job_events.failed',
          jobs: watched.size,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
      stream.send('error', { message: CLIPS_MESSAGES.STREAM_STOPPED });
    }
  }
}

interface Watched {
  samples: ProgressSample[];
  last: string;
  ended: boolean;
}

/** What changes a view enough to send it again. */
function fingerprintOf(view: ClipJobView): string {
  const waiting = view.waiting
    ? `${view.waiting.position}|${view.waiting.aboutSeconds}|${view.waiting.lowPriority}`
    : '-';
  return `${view.status}|${view.stage}|${view.progress}|${view.etaSeconds}|${waiting}`;
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
