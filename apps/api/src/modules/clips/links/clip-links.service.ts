/**
 * The link probe (Module 03, sections 3 and 4): a pasted link becomes one
 * answer, which platform and what video, or one sentence saying why not.
 *
 * The order is fixed and cheapest first, so a refusal never costs a tool:
 *
 * 1. **Recognise** (pure): not a link we read is 422 with the refusal code.
 *    The canonical link is rebuilt from the id; it is the only address the
 *    worker is ever given.
 * 2. **Platform switch** (`CLIPS_PLATFORMS`): a paused platform is 422
 *    `platform_paused`.
 * 3. **Breaker**: a resting platform is 503 `platform_resting` at once.
 * 4. **Throttle**: ten probes a minute per workspace, then 429
 *    `probe_throttled`.
 * 5. **Plan gate**: `clips.enabled` false is 402 `clips_not_in_plan`, before
 *    any work is spent on the workspace.
 * 6. **Cache** (`clips:probe:<hash>`, ten minutes, finished videos only).
 * 7. **The worker** (`clipProbeWorkflow` on the quick media queue), waited on
 *    for 25 seconds. No answer is 503 `tools_offline`; a failure carries the
 *    worker's code (422 for the link's own refusals, 503 for a resting
 *    platform, which also counts towards the breaker, 502 otherwise).
 *
 * Then the answer itself: still live is 422 `link_live`; longer than the
 * plan's longest video is the 402 `clips_video_too_long` from the resolver;
 * and `existingVideoId` says whether the workspace already has it.
 *
 * The video import (Module 04) calls this same `probe` on the server and never
 * trusts a probe answer the browser sends.
 */
import { createHash } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CLIP_PROBE_TIMEOUT_MS,
  CLIP_PROBE_WORKFLOW,
  CLIP_WAIT_FOR_ANSWER_MS,
  clipProbeWorkflowId,
  MEDIA_QUICK_TASK_QUEUE,
} from '@postgear/scheduling';
import {
  type ClipPlatformId,
  isLinkRefusal,
  type LinkInfo,
  type LinkRef,
  recogniseLink,
  uploadOnlyMessage,
} from '@postgear/video-engine';
import type { Env } from '../../../config/env';
import { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import { RedisService } from '../../redis/redis.service';
import { SchedulingService } from '../../scheduling/scheduling.service';
import { ClipErrorException } from '../clip-error.exception';
import { ClipLinksRepository } from './clip-links.repository';
import type { ClipLinkProber, ClipProbeResult } from './clip-links.types';
import { withinRate } from './clip-rate-limit';
import { parseLinkInfo } from './link-info.schema';
import { ClipPlatformBreaker } from './platform-breaker';
import { workflowFailureCode } from './workflow-failure';

export const PROBES_PER_MINUTE = 10;
export const PROBE_CACHE_SECONDS = 10 * 60;
/** The workflow's own limit: the activity's 20 seconds plus room for one retry to start and finish. */
export const PROBE_EXECUTION_TIMEOUT_MS = CLIP_PROBE_TIMEOUT_MS * 3;
const MS_PER_MINUTE = 60_000;

/** Worker codes that are the link's own refusal (422): the same link would fail again. */
const LINK_REFUSALS = new Set([
  'link_unsupported',
  'link_not_a_video',
  'link_private',
  'link_live',
  'link_not_found',
  'link_many_videos',
  'platform_paused',
]);

/** `clips:probe:<hash>`: the first 32 hex characters of the canonical link's SHA-256. */
export function linkHash(canonicalUrl: string): string {
  return createHash('sha256').update(canonicalUrl).digest('hex').slice(0, 32);
}

@Injectable()
export class ClipLinksService implements ClipLinkProber {
  private readonly logger = new Logger(ClipLinksService.name);
  private readonly platforms: ReadonlySet<ClipPlatformId>;

  constructor(
    private readonly scheduling: SchedulingService,
    private readonly resolver: EntitlementResolver,
    private readonly redis: RedisService,
    private readonly breaker: ClipPlatformBreaker,
    private readonly repository: ClipLinksRepository,
    config: ConfigService<Env, true>,
  ) {
    this.platforms = new Set(config.get('CLIPS_PLATFORMS', { infer: true }));
  }

  async probe(orgId: string, url: string): Promise<ClipProbeResult> {
    const recognised = recogniseLink(url);
    if (isLinkRefusal(recognised)) {
      // Module 12: a site with no extractor (Riverside, StreamYard) is named in its sentence.
      throw new ClipErrorException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        recognised.code,
        recognised.site ? { message: uploadOnlyMessage(recognised.site) } : {},
      );
    }
    const link = recognised;
    const { platform } = link;

    if (!this.platforms.has(platform)) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'platform_paused', {
        platform,
      });
    }
    if (await this.breaker.isResting(platform)) {
      throw new ClipErrorException(HttpStatus.SERVICE_UNAVAILABLE, 'platform_resting', {
        platform,
      });
    }
    if (!(await withinRate(this.redis, `clips:probe:rate:${orgId}`, PROBES_PER_MINUTE, 60))) {
      throw new ClipErrorException(HttpStatus.TOO_MANY_REQUESTS, 'probe_throttled');
    }
    await this.resolver.assert(orgId, 'clips.enabled', (enabled) => enabled === true);

    // Module 19: a video removed after a rights request, refused before any fetch.
    // (The answer must carry the same id, see `sameVideo`, so one check covers it.)
    await this.refuseBlocked(platform, [link.externalId]);

    const hash = linkHash(link.canonicalUrl);
    const info = (await this.cached(hash, link)) ?? (await this.ask(hash, link, orgId));

    if (info.live) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'link_live');
    }
    const videoMinutes = Math.ceil(info.durationMs / MS_PER_MINUTE);
    await this.resolver.assert(
      orgId,
      'clips.max_video_minutes',
      (limit) => limit === null || info.durationMs <= limit * MS_PER_MINUTE,
      { needed: videoMinutes },
    );

    const existingVideoId = await this.repository.existingVideoId(orgId, platform, info.externalId);
    return { link, info, existingVideoId };
  }

  /** 410 `video_removed`: "This video was removed after a request from its owner." */
  private async refuseBlocked(platform: ClipPlatformId, externalIds: string[]): Promise<void> {
    if (await this.repository.isBlocked(platform, externalIds)) {
      throw new ClipErrorException(HttpStatus.GONE, 'video_removed');
    }
  }

  /** A cached answer for this link, if one is there and still reads as one. */
  private async cached(hash: string, link: LinkRef): Promise<LinkInfo | null> {
    const raw = await this.redis.get(cacheKey(hash));
    if (raw === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const info = parseLinkInfo(parsed);
    return info && sameVideo(info, link) ? info : null;
  }

  /** Asks the worker, maps its failure to our answer, and keeps a finished video's answer. */
  private async ask(hash: string, link: LinkRef, orgId: string): Promise<LinkInfo> {
    const outcome = await this.scheduling.runClipQuery<unknown>({
      workflowType: CLIP_PROBE_WORKFLOW,
      workflowId: clipProbeWorkflowId(hash),
      taskQueue: MEDIA_QUICK_TASK_QUEUE,
      args: [link],
      waitMs: CLIP_WAIT_FOR_ANSWER_MS,
      executionTimeoutMs: PROBE_EXECUTION_TIMEOUT_MS,
    });

    if (outcome.outcome === 'unavailable') {
      throw new ClipErrorException(HttpStatus.SERVICE_UNAVAILABLE, 'tools_offline');
    }
    if (outcome.outcome === 'failed') {
      throw await this.failure(link, outcome.error, orgId);
    }

    const info = parseLinkInfo(outcome.value);
    if (!info || !sameVideo(info, link)) {
      this.logger.error(
        JSON.stringify({ event: 'clips.probe.bad_answer', platform: link.platform, hash, orgId }),
      );
      throw new ClipErrorException(HttpStatus.BAD_GATEWAY, 'tool_failed');
    }
    // The canonical link stays the one recognition built, whatever came back.
    const answer: LinkInfo = { ...info, canonicalUrl: link.canonicalUrl };
    if (!answer.live) {
      await this.redis.set(cacheKey(hash), JSON.stringify(answer), PROBE_CACHE_SECONDS);
    }
    return answer;
  }

  private async failure(link: LinkRef, error: unknown, orgId: string): Promise<ClipErrorException> {
    const { code } = workflowFailureCode(error);
    const { platform } = link;
    this.logger.log(JSON.stringify({ event: 'clips.probe.failed', platform, code, orgId }));

    if (LINK_REFUSALS.has(code)) {
      return new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, code, { platform });
    }
    if (code === 'platform_resting') {
      await this.breaker.recordResting(platform);
      return new ClipErrorException(HttpStatus.SERVICE_UNAVAILABLE, 'platform_resting', {
        platform,
      });
    }
    if (code === 'clips_busy' || code === 'tools_offline') {
      return new ClipErrorException(HttpStatus.SERVICE_UNAVAILABLE, code);
    }
    return new ClipErrorException(HttpStatus.BAD_GATEWAY, 'tool_failed');
  }
}

function cacheKey(hash: string): string {
  return `clips:probe:${hash}`;
}

/** The answer is about the link that was asked: same platform and id. */
function sameVideo(info: LinkInfo, link: LinkRef): boolean {
  return info.platform === link.platform && info.externalId === link.externalId;
}
