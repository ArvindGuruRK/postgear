/**
 * The yt-dlp flat lister, asked through the worker (Module 03, section 5):
 * Kick always, Twitch and YouTube when the official route is out.
 *
 * The API never starts a program. It asks `clipListChannelWorkflow` on the
 * quick media queue and waits up to 25 seconds, as the probe does; requests
 * for the same list share one execution through the workflow id. In front of
 * it:
 *
 * - the platform breaker shared with the probe (a resting platform answers
 *   `platform_resting` at once and starts nothing);
 * - two flat lists at a time per platform, across every API instance, held
 *   as two Redis slots with an expiry (a crashed holder frees its slot);
 *   with both taken for three seconds the answer is `clips_busy`.
 *
 * No answer in time is `tools_offline`; a failure carries the worker's code.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  CLIP_LIST_CHANNEL_WORKFLOW,
  CLIP_WAIT_FOR_ANSWER_MS,
  clipListChannelWorkflowId,
  MEDIA_QUICK_TASK_QUEUE,
} from '@postgear/scheduling';
import type {
  ChannelLister,
  ChannelListQuery,
  ChannelPage,
  ChannelRef,
  ClipListChannelAnswer,
  ClipListChannelRequest,
  ChannelPlatformId,
} from '@postgear/video-engine';
import type { RedisService } from '../../../redis/redis.service';
import type { ClipQueryOutcome, SchedulingService } from '../../../scheduling/scheduling.service';
import type { ClipPlatformBreaker } from '../../links/platform-breaker';
import { workflowFailureCode } from '../../links/workflow-failure';
import { isListingFailureCode, ListingFailure } from './listing-failure';

/** Flat lists running at once per platform. */
export const FLAT_SLOTS = 2;
/** A slot outlives the longest wait (25 s) with room, and frees itself if its holder dies. */
const SLOT_SECONDS = 45;
const SLOT_WAIT_MS = 3_000;
const SLOT_POLL_MS = 250;
/** The workflow's own limit: one flat list plus a retry. */
const LIST_EXECUTION_TIMEOUT_MS = 90_000;

export interface WorkerFlatListerDeps {
  scheduling: Pick<SchedulingService, 'runClipQuery'>;
  breaker: Pick<ClipPlatformBreaker, 'isResting' | 'recordResting'>;
  redis: Pick<RedisService, 'setIfAbsent' | 'get' | 'delete'>;
  sleep?: (ms: number) => Promise<void>;
}

export class WorkerFlatLister implements ChannelLister {
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    readonly platform: ChannelPlatformId,
    private readonly deps: WorkerFlatListerDeps,
  ) {
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async resolve(handle: string): Promise<ChannelRef> {
    const answer = await this.ask({ op: 'resolve', platform: this.platform, handle });
    if (answer.op !== 'resolve') throw new ListingFailure('channel_listing_failed');
    return answer.channel;
  }

  async list(channel: ChannelRef, query: ChannelListQuery): Promise<ChannelPage> {
    const answer = await this.ask({ op: 'list', platform: this.platform, channel, query });
    if (answer.op !== 'list') throw new ListingFailure('channel_listing_failed');
    return answer.page;
  }

  private async ask(request: ClipListChannelRequest): Promise<ClipListChannelAnswer> {
    if (await this.deps.breaker.isResting(this.platform)) {
      throw new ListingFailure('platform_resting');
    }
    const slot = await this.takeSlot();
    let outcome: ClipQueryOutcome<ClipListChannelAnswer>;
    try {
      const id = createHash('sha256').update(JSON.stringify(request)).digest('hex').slice(0, 32);
      outcome = await this.deps.scheduling.runClipQuery<ClipListChannelAnswer>({
        workflowType: CLIP_LIST_CHANNEL_WORKFLOW,
        workflowId: clipListChannelWorkflowId(id),
        taskQueue: MEDIA_QUICK_TASK_QUEUE,
        args: [request],
        waitMs: CLIP_WAIT_FOR_ANSWER_MS,
        executionTimeoutMs: LIST_EXECUTION_TIMEOUT_MS,
      });
    } finally {
      await this.releaseSlot(slot);
    }

    if (outcome.outcome === 'unavailable') throw new ListingFailure('tools_offline');
    if (outcome.outcome === 'failed') {
      const { code } = workflowFailureCode(outcome.error);
      if (code === 'platform_resting') await this.deps.breaker.recordResting(this.platform);
      throw new ListingFailure(isListingFailureCode(code) ? code : 'channel_listing_failed', {
        cause: outcome.error,
      });
    }
    const answer = outcome.value as ClipListChannelAnswer | null;
    if (typeof answer !== 'object' || answer === null || answer.op !== request.op) {
      throw new ListingFailure('channel_listing_failed');
    }
    return answer;
  }

  /** One of the platform's slots, or `clips_busy` after a short wait. */
  private async takeSlot(): Promise<{ key: string; holder: string }> {
    const holder = randomUUID();
    const deadline = Date.now() + SLOT_WAIT_MS;
    for (;;) {
      for (let index = 0; index < FLAT_SLOTS; index++) {
        const key = `clips:flat:${this.platform}:slot:${index}`;
        if (await this.deps.redis.setIfAbsent(key, holder, SLOT_SECONDS)) return { key, holder };
      }
      if (Date.now() >= deadline) throw new ListingFailure('clips_busy');
      await this.sleep(SLOT_POLL_MS);
    }
  }

  /** Frees the slot only if it is still ours (it may have expired and been taken). */
  private async releaseSlot(slot: { key: string; holder: string }): Promise<void> {
    if ((await this.deps.redis.get(slot.key)) === slot.holder) {
      await this.deps.redis.delete(slot.key);
    }
  }
}
