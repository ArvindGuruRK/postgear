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
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { ProgressSample } from '@postgear/video-engine';
import type { SseStream } from '../../../common/sse';
import { CLIPS_MESSAGES } from '../clips.messages';
import { median, TERMINAL_JOB_STATUSES, toJobView } from './clip-job-view';
import { ClipJobsRepository } from './clip-jobs.repository';
import { ClipJobsService } from './clip-jobs.service';

export const JOB_EVENTS_POLL_MS = 750;
export const JOB_EVENTS_MAX_MS = 30 * 60_000;
/** Samples older than this are dropped; the estimate only reads the last minute. */
const SAMPLE_KEEP_MS = 90_000;

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

        const view = toJobView(job, { samples, priorSeconds: priorSeconds ?? null });

        if (TERMINAL_JOB_STATUSES.has(job.status)) {
          stream.send(
            job.status === 'DONE' ? 'done' : job.status === 'FAILED' ? 'failed' : 'cancelled',
            view,
          );
          return;
        }

        const fingerprint = `${view.status}|${view.stage}|${view.progress}|${view.etaSeconds}`;
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
