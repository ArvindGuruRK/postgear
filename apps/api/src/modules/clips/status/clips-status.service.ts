/**
 * `GET /clips/status` (Sprint 12, Module 02): whether Clips can work right
 * now, for the page to say so before anyone pastes a link.
 *
 * - **Tools**: the API has no video tools; the worker does. It asks the
 *   worker through `clipRuntimeCheckWorkflow` on the media queue and waits
 *   at most 10 seconds, so with the worker stopped the page learns "the
 *   video tools are not running" in about that long, never a hung request.
 *   An answer is kept a minute (an unreachable one 15 seconds), and all
 *   pages share one check a minute through its workflow id.
 * - **Space**: the workspace's video space used against its plan's limit,
 *   a gauge counted from `ClipAsset.bytes` (no ledger), the same count the
 *   import check uses (`ClipLimitsGuard.storageUsedBytes`).
 * - **Limits and meters** (Module 04): the plan's Clips values and this
 *   cycle's import and AI minutes, so the page can show what is left before
 *   anyone imports.
 * - **Platforms and simulation**: what this deployment allows.
 * - **Sample** (Module 06): whether Try A Sample has a video here.
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Key, MeterKey } from '@postgear/entitlements';
import {
  CLIP_RUNTIME_CHECK_WAIT_MS,
  CLIP_RUNTIME_CHECK_WORKFLOW,
  type ClipRuntimeReport,
  clipRuntimeCheckWorkflowId,
  MEDIA_QUICK_TASK_QUEUE,
} from '@postgear/scheduling';
import type { ClipPlatformId } from '@postgear/video-engine';
import type { Env } from '../../../config/env';
import { EntitlementResolver, type MeterState } from '../../entitlements/entitlement-resolver';
import { SchedulingService } from '../../scheduling/scheduling.service';
import { CLIPS_MESSAGES } from '../clips.messages';
import { gigabytesToBytes } from '../clips.units';
import { ClipLimitsGuard } from '../limits/clip-limits.guard';
import { ClipSampleLink } from '../videos/clip-sample';

const ANSWER_CACHE_MS = 60_000;
const OFFLINE_CACHE_MS = 15_000;

export interface ClipsToolsState {
  /** `ok`: every required check passed; `not_ok`: the worker answered with a problem; `offline`: no answer. */
  state: 'ok' | 'not_ok' | 'offline';
  /** A sentence for the page when the state is not ok. */
  message: string | null;
  checks: Array<{ name: string; ok: boolean; required: boolean; reason: string | null }>;
  checkedAt: string | null;
}

/** The plan's Clips values the page shows or gates on (registry keys, values as resolved). */
export const CLIPS_STATUS_LIMIT_KEYS = [
  'clips.enabled',
  'clips.max_video_minutes',
  'clips.upload_max_gb',
  'clips.storage_gb',
  'clips.retention_days',
  'clips.concurrent_imports',
  'clips.export_max_quality',
  'clips.export_watermark',
  'clips.queue_priority',
  'clips.browse_channels',
  'clips.downloads_per_day',
] as const satisfies readonly Key[];

export type ClipsStatusLimits = Record<(typeof CLIPS_STATUS_LIMIT_KEYS)[number], unknown>;

/** One meter in whole minutes: `used` rounds up, `limit` and `remaining` round down. */
export interface ClipsMeterView {
  used: number;
  limit: number | null;
  remaining: number | null;
  /** When the cycle resets (ISO). */
  cycleEnd: string;
}

export interface ClipsStatus {
  tools: ClipsToolsState;
  simulation: boolean;
  platforms: ClipPlatformId[];
  storage: { usedBytes: number; limitBytes: number | null };
  /** Module 04: the plan's Clips values. */
  limits: ClipsStatusLimits;
  /** Module 04: this cycle's import and AI minutes. */
  meters: { importMinutes: ClipsMeterView; aiMinutes: ClipsMeterView };
  /** Module 04: the space gauge again, under the name the sprint document uses. */
  usage: { storageBytes: number };
  /** Module 06: whether Try A Sample has a video to import here. */
  sample: { available: boolean };
}

const IMPORT_MINUTES: MeterKey = 'clips.import_minutes_per_month';
const AI_MINUTES: MeterKey = 'clips.ai_minutes_per_month';

@Injectable()
export class ClipsStatusService {
  private cached: { tools: ClipsToolsState; until: number } | null = null;
  private inFlight: Promise<ClipsToolsState> | null = null;
  private readonly simulation: boolean;
  private readonly platforms: ClipPlatformId[];

  constructor(
    private readonly scheduling: SchedulingService,
    private readonly resolver: EntitlementResolver,
    private readonly limits: ClipLimitsGuard,
    config: ConfigService<Env, true>,
    private readonly sample: ClipSampleLink,
  ) {
    this.simulation = config.get('CLIPS_SIMULATION', { infer: true }) === 'true';
    this.platforms = [...config.get('CLIPS_PLATFORMS', { infer: true })];
  }

  async status(orgId: string): Promise<ClipsStatus> {
    const now = new Date();
    const [tools, usedBytes, values, importMinutes, aiMinutes] = await Promise.all([
      this.tools(),
      this.limits.storageUsedBytes(orgId),
      this.resolver.getMany(orgId, CLIPS_STATUS_LIMIT_KEYS, now),
      this.resolver.meter(orgId, IMPORT_MINUTES, now),
      this.resolver.meter(orgId, AI_MINUTES, now),
    ]);
    const limits = Object.fromEntries(
      CLIPS_STATUS_LIMIT_KEYS.map((key) => [key, values[key]]),
    ) as ClipsStatusLimits;
    const limitGb = limits['clips.storage_gb'];
    return {
      tools,
      simulation: this.simulation,
      platforms: this.platforms,
      storage: {
        usedBytes,
        limitBytes: typeof limitGb === 'number' ? gigabytesToBytes(limitGb) : null,
      },
      limits,
      meters: { importMinutes: meterView(importMinutes), aiMinutes: meterView(aiMinutes) },
      usage: { storageBytes: usedBytes },
      sample: { available: this.sample.url !== null },
    };
  }

  /** The worker's tools, from the cache or one shared check. */
  async tools(): Promise<ClipsToolsState> {
    if (this.cached && Date.now() < this.cached.until) return this.cached.tools;
    if (!this.inFlight) {
      this.inFlight = this.check().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async check(): Promise<ClipsToolsState> {
    const now = new Date();
    const answer = await this.scheduling.runClipQuery<ClipRuntimeReport>({
      workflowType: CLIP_RUNTIME_CHECK_WORKFLOW,
      workflowId: clipRuntimeCheckWorkflowId(now),
      taskQueue: MEDIA_QUICK_TASK_QUEUE,
      args: [],
      waitMs: CLIP_RUNTIME_CHECK_WAIT_MS,
      executionTimeoutMs: 60_000,
    });

    let tools: ClipsToolsState;
    if (answer.outcome === 'answered') {
      const report = answer.value;
      tools = {
        state: report.ok ? 'ok' : 'not_ok',
        message: report.ok ? null : CLIPS_MESSAGES.tools_offline,
        checks: report.checks.map((check) => ({
          name: check.name,
          ok: check.ok,
          required: check.required,
          reason: check.reason,
        })),
        checkedAt: report.checkedAt,
      };
    } else {
      tools = {
        state: 'offline',
        message: CLIPS_MESSAGES.TOOLS_NOT_RUNNING,
        checks: [],
        checkedAt: null,
      };
    }

    this.cached = {
      tools,
      until: Date.now() + (tools.state === 'offline' ? OFFLINE_CACHE_MS : ANSWER_CACHE_MS),
    };
    return tools;
  }
}

function meterView(meter: MeterState): ClipsMeterView {
  return {
    used: meter.used,
    limit: meter.limit,
    remaining: meter.remaining,
    cycleEnd: meter.cycleEnd.toISOString(),
  };
}
