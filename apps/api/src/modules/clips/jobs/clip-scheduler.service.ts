/**
 * The one Clips scheduler (Sprint 13, Module 15). It owns starting every
 * QUEUED Clips job but a Preview Export: Module 04's import cap and Module
 * 11's fair render queue folded into one pass over three classes (`media`,
 * `media-py`, `render`). The rules are `nextJobs` (`clip-scheduler.rules.ts`);
 * the claim is `ClipJobsRepository.claimNext`.
 *
 * - **A pass** claims the jobs that may start now, in one serializable
 *   transaction, then hands each to Temporal in order. A start Temporal
 *   refuses gives its claim and every later one back (the next pass, or the
 *   reconcile, tries again).
 * - **When a pass runs**: when a job is made (`start`), when any job ends
 *   (the worker's `settled` call), and in the maintenance reconcile.
 * - **The import cap** is `clips.concurrent_imports`, read through the
 *   resolver during the pass, so an operator's edit applies at the next one
 *   (about a second, the resolver's stamp check).
 * - **A Preview Export** is started at once and holds no slot (Module 11):
 *   the editor waits on it.
 * - **A paid AI job** (`PAID_AI_KINDS`) starts only with its AI minutes
 *   charge standing (one ledger read when a pick would start it): a route
 *   that writes the row before its charge lands, or a refused charge that
 *   left its row, never gets model work. It keeps waiting; the reconcile
 *   fails it once it is old with still no charge.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ClipJob } from '@postgear/db';
import { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import { SchedulingService } from '../../scheduling/scheduling.service';
import { liveChargeFor } from '../clips-ai-charges';
import { ClipJobsRepository } from './clip-jobs.repository';
import {
  DEFAULT_SLOTS,
  PAID_AI_KINDS,
  type SchedulerClass,
  type SchedulerJob,
  schedulerClassOf,
} from './clip-scheduler.rules';

type StartableJob = Pick<ClipJob, 'id' | 'organizationId' | 'kind'> & { input?: unknown };

/** The env variable that sets each class's global slots. */
export const SLOT_SETTINGS: Readonly<Record<SchedulerClass, string>> = Object.freeze({
  media: 'CLIPS_MEDIA_SLOTS',
  'media-py': 'CLIPS_MEDIA_PY_SLOTS',
  render: 'CLIPS_RENDER_SLOTS',
});

/** Each class's global slots from the config, or the default for one that is missing or not a whole number. */
export function schedulerSlots(
  config?: Pick<ConfigService, 'get'> | null,
): Readonly<Record<SchedulerClass, number>> {
  const read = (cls: SchedulerClass) => {
    const value = Number(config?.get(SLOT_SETTINGS[cls]) ?? DEFAULT_SLOTS[cls]);
    return Number.isFinite(value) && value >= 1 ? Math.floor(value) : DEFAULT_SLOTS[cls];
  };
  return Object.freeze({
    media: read('media'),
    'media-py': read('media-py'),
    render: read('render'),
  });
}

@Injectable()
export class ClipSchedulerService {
  private readonly logger = new Logger(ClipSchedulerService.name);
  readonly slots: Readonly<Record<SchedulerClass, number>>;

  constructor(
    private readonly repository: ClipJobsRepository,
    private readonly scheduling: SchedulingService,
    private readonly resolver: EntitlementResolver,
    @Optional() config?: ConfigService,
  ) {
    this.slots = schedulerSlots(config);
  }

  /**
   * Starts one job just made: a Preview Export at once, anything else by a
   * pass (it may stay QUEUED behind others). True when it started. Never
   * throws: a busy database leaves it QUEUED for the next pass.
   */
  async start(job: StartableJob): Promise<boolean> {
    if (schedulerClassOf(job) === null) return this.dispatch(job);
    const started = await this.startNext(job.organizationId);
    return started.includes(job.id);
  }

  /**
   * One pass across every class and workspace. Answers the ids started.
   * Throws only when the claim itself fails (the database refused it).
   */
  async pass(now: Date = new Date()): Promise<string[]> {
    const caps = new Map<string, Promise<number>>();
    const capOf = (orgId: string) => this.resolver.get(orgId, 'clips.concurrent_imports');
    const importCap = (orgId: string): Promise<number> => {
      // Once per workspace per pass, also when Postgres makes the claim retry.
      let cap = caps.get(orgId);
      if (!cap) {
        cap = Promise.resolve(capOf(orgId)).then(Number);
        caps.set(orgId, cap);
      }
      return cap;
    };

    const claimed = await this.repository.claimNext(this.slots, importCap, now, (job) =>
      this.mayStart(job),
    );
    const started: string[] = [];
    for (let index = 0; index < claimed.length; index += 1) {
      const job = claimed[index] as (typeof claimed)[number];
      if (await this.dispatch(job)) {
        started.push(job.id);
        continue;
      }
      // Temporal is out of reach: hand every remaining claim back.
      for (const rest of claimed.slice(index)) {
        await this.repository.releaseClaim(rest.organizationId, rest.id);
      }
      break;
    }
    return started;
  }

  /**
   * Whether a pick may start: always, but for a paid AI job, only while its
   * charge stands (the net of its charges and their reversals is above 0).
   */
  async mayStart(job: Pick<SchedulerJob, 'id' | 'organizationId' | 'kind'>): Promise<boolean> {
    if (!PAID_AI_KINDS.has(job.kind)) return true;
    return (await liveChargeFor(job.organizationId, job.id)) > 0;
  }

  /** `pass` that logs instead of throwing, for callers that must not fail. */
  async startNext(orgId?: string): Promise<string[]> {
    try {
      return await this.pass();
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.job.start_waiting_failed',
          orgId: orgId ?? null,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
      return [];
    }
  }

  /** One workflow start; false leaves the row QUEUED (logged). */
  async dispatch(job: Pick<ClipJob, 'id' | 'organizationId' | 'kind'>): Promise<boolean> {
    const started = await this.scheduling.startClipJob(job.id, job.organizationId, job.kind);
    if (!started) {
      this.logger.warn(
        JSON.stringify({ event: 'clips.job.start_deferred', jobId: job.id, kind: job.kind }),
      );
    }
    return started;
  }
}
