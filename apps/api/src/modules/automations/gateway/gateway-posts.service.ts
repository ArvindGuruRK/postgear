/**
 * Create Draft, Add To Queue, Publish To {Platform} and Get Post (Sprint 10,
 * Module 10), for the worker, through the same `PostsService` the composer
 * and the copilot use. Nothing here re-checks a post: channels, tags, media
 * and every platform rule are the posts service's (`prepare`,
 * `assertQueueable`), so a workflow's post is held to exactly a person's
 * rules and fails with the same sentences.
 *
 * ## Never the same post twice
 *
 * Two guards, one per layer. The route runs inside the effect ledger
 * (`GatewayBindingService.runEffect`), so a retry after success returns the
 * stored answer. And the group id is derived from the effect's key (UUID v5
 * of `${runId}:${nodeKey}`), so an attempt that crashed after writing and is
 * run again finds its own post (`PostsService.create` returns a known group
 * untouched) instead of writing a second one.
 *
 * A publish that crashed between writing and signalling is left queued at
 * the time it was written; the maintenance reconcile (every 15 minutes)
 * starts the workflow of any queued row that has none, and it publishes.
 */
import { createHash } from 'node:crypto';
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isValidTimeZone, nextFreeSlot, platformById } from '@postgear/automation';
import { State } from '@postgear/db';
import { documentFromText, renderPlainText } from '@postgear/social-core';
import type { Env } from '../../../config/env';
import { nextFullHour } from '../../ai/tools/copilot-tools';
import { ChannelsService, type ChannelView } from '../../channels/channels.service';
import { MAX_THREAD_PARTS } from '../../posts/dto/posts.schema';
import { type PostDetail, PostsService } from '../../posts/posts.service';
import type { GatewayResponse } from './gateway.schema';
import { GatewayBindingService } from './gateway-binding.service';
import type { DraftBody, GetPostBody, PublishBody, QueueBody } from './gateway-posts.schema';

/**
 * The namespace of every workflow post group. Fixed forever: changing it
 * would let a step retried across a deploy write its post a second time.
 */
export const AUTOMATION_GROUP_NAMESPACE = '6d0f3c2a-8b1e-4f57-9a3c-5e2d7b4a1f60';

export const POST_GATEWAY_MESSAGES = {
  POST_GONE: 'This post no longer exists.',
  TOO_MANY_PARTS: `A thread can have at most ${MAX_THREAD_PARTS} parts. Join some paragraphs and try again.`,
  BAD_TIME_ZONE: 'Choose a valid time zone for this step.',
  NO_FREE_SLOT: 'These channels have no free posting time in the next year.',
  wrongPlatform: (channel: string, platform: string) =>
    `${channel} is not a ${platform} channel. Choose ${platform} channels only.`,
} as const;

/** UUID version 5 (RFC 9562, SHA-1) of `name` in `namespace`. */
export function uuidV5(name: string, namespace: string): string {
  const space = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(space).update(name, 'utf8').digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The post group a step writes: the same for every attempt of that step in that run. */
export function automationGroupId(runId: string, nodeKey: string): string {
  return uuidV5(`${runId}:${nodeKey}`, AUTOMATION_GROUP_NAMESPACE);
}

/** One paragraph per part, for "Make a thread from blank lines"; the whole text otherwise. */
export function splitParts(
  text: string,
  parts: 'single' | 'splitOnBlankLines' = 'single',
): string[] {
  const normalised = text.replace(/\r\n?/g, '\n');
  if (parts === 'single') return [normalised.trim()];
  const paragraphs = normalised
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '');
  return paragraphs.length > 0 ? paragraphs : [''];
}

type ChannelOutput = { id: string; name: string; provider: string };

export type DraftOutput = {
  postGroup: string;
  link: string;
  channels: ChannelOutput[];
  text: string;
  mediaCount: number;
};

export type QueueOutput = { postGroup: string; scheduledFor: string; channels: ChannelOutput[] };

export type PublishOutput = { postGroup: string; channels: ChannelOutput[]; status: 'publishing' };

export type PostSummaryOutput = {
  id: string;
  group: string;
  state: string;
  text: string;
  mediaCount: number;
  media: { kind: 'media'; id: string; url: string; type: 'image' | 'video' }[];
  channels: ChannelOutput[];
  tags: string[];
  publishDate: string;
  releaseUrl: string | null;
};

type PostContent = Pick<DraftBody, 'channels' | 'text' | 'mediaIds' | 'tags'>;

@Injectable()
export class GatewayPostsService {
  constructor(
    private readonly binding: GatewayBindingService,
    private readonly posts: PostsService,
    private readonly channels: ChannelsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Create Draft: a draft at the next full hour, like the copilot's. */
  async draft(body: DraftBody): Promise<GatewayResponse<DraftOutput>> {
    await this.binding.bind(body, ['postgear.createDraft']);
    return this.binding.runEffect(body, 'post.draft', async () => {
      const parts = splitParts(body.text, body.parts);
      const detail = await this.create(body, parts, {
        state: State.DRAFT,
        publishDate: nextFullHour(),
      });
      return {
        output: {
          postGroup: detail.group,
          link: this.composerLink(body.organizationId, detail.group),
          channels: channelsOf(detail),
          text: parts.join('\n\n'),
          mediaCount: body.mediaIds.length,
        },
        credits: 0,
      };
    });
  }

  /** Add To Queue: the next free posting time on every chosen channel, or the chosen time. */
  async queue(body: QueueBody): Promise<GatewayResponse<QueueOutput>> {
    await this.binding.bind(body, ['postgear.addToQueue']);
    return this.binding.runEffect(body, 'post.queue', async () => {
      const publishDate =
        body.when === 'at' && body.at ? new Date(body.at) : await this.freeSlot(body);
      const detail = await this.create(body, [body.text.trim()], {
        state: State.QUEUE,
        publishDate,
      });
      return {
        output: {
          postGroup: detail.group,
          scheduledFor: detail.publishDate.toISOString(),
          channels: channelsOf(detail),
        },
        credits: 0,
      };
    });
  }

  /** Publish To {Platform}: queued now and handed to the publisher, like Post Now. */
  async publish(body: PublishBody): Promise<GatewayResponse<PublishOutput>> {
    await this.binding.bind(body, ['postgear.publish']);
    return this.binding.runEffect(body, 'post.publish', async () => {
      await this.assertPlatform(body);
      const detail = await this.create(
        body,
        [body.text.trim()],
        { state: State.QUEUE, publishDate: new Date(), publishNow: true },
        body.settings,
      );
      return {
        output: {
          postGroup: detail.group,
          channels: channelsOf(detail),
          status: 'publishing' as const,
        },
        credits: 0,
      };
    });
  }

  /** Get Post: a summary of a post of this workspace; read-only, so no effect. */
  async get(body: GetPostBody): Promise<GatewayResponse<PostSummaryOutput>> {
    await this.binding.bind(body, ['postgear.getPost']);
    const ref = await this.posts.findPostRef(body.organizationId, body.post.trim());
    if (!ref) {
      throw new UnprocessableEntityException({
        message: POST_GATEWAY_MESSAGES.POST_GONE,
        code: 'post_gone',
      });
    }
    let detail: PostDetail;
    try {
      detail = await this.posts.get(body.organizationId, ref.group);
    } catch {
      throw new UnprocessableEntityException({
        message: POST_GATEWAY_MESSAGES.POST_GONE,
        code: 'post_gone',
      });
    }
    const media = detail.shared.flatMap((part) =>
      part.media.map((item) => ({
        kind: 'media' as const,
        id: item.id,
        url: item.url,
        type: item.type,
      })),
    );
    return {
      output: {
        id: ref.rootId,
        group: detail.group,
        state: detail.state,
        text: detail.shared.map((part) => renderPlainText(part.content)).join('\n\n'),
        mediaCount: media.length,
        media,
        channels: channelsOf(detail),
        tags: detail.tags.map((tag) => tag.name),
        publishDate: detail.publishDate.toISOString(),
        releaseUrl: detail.channels.find((channel) => channel.releaseURL)?.releaseURL ?? null,
      },
      credits: 0,
    };
  }

  /** The post, written through the composer's own path under the step's group. */
  private async create(
    body: PostContent & { runId: string; nodeKey: string; organizationId: string },
    parts: string[],
    when: { state: 'DRAFT' | 'QUEUE'; publishDate: Date; publishNow?: boolean },
    settings?: Record<string, unknown>,
  ): Promise<PostDetail> {
    if (parts.length > MAX_THREAD_PARTS) {
      throw new UnprocessableEntityException({
        message: POST_GATEWAY_MESSAGES.TOO_MANY_PARTS,
        code: 'too_many_parts',
      });
    }
    return this.posts.create(
      body.organizationId,
      {
        state: when.state,
        publishDate: when.publishDate.toISOString(),
        ...(when.publishNow ? { publishNow: true } : {}),
        shared: parts.map((text, index) => ({
          content: documentFromText(text),
          // Media goes on the first part, as the copilot's drafts do.
          media: index === 0 ? body.mediaIds.map((id) => ({ id })) : [],
        })),
        channels: body.channels.map((channelId) => ({
          channelId,
          customized: false,
          ...(settings ? { settings } : {}),
        })),
        ...(body.tags && body.tags.length > 0 ? { tags: body.tags } : {}),
      },
      {
        group: automationGroupId(body.runId, body.nodeKey),
        creationMethod: 'AUTOMATION',
      },
    );
  }

  /**
   * One time for every chosen channel: the earliest of their posting times
   * (all of them together) with no queued post on any of them within a
   * minute, read in the step's zone.
   */
  private async freeSlot(body: QueueBody): Promise<Date> {
    if (!isValidTimeZone(body.timeZone)) {
      throw new UnprocessableEntityException({
        message: POST_GATEWAY_MESSAGES.BAD_TIME_ZONE,
        code: 'bad_time_zone',
      });
    }
    const now = Date.now();
    const chosen = new Set(body.channels);
    const channels = (await this.channels.list(body.organizationId)).filter((channel) =>
      chosen.has(channel.id),
    );
    const postingTimes = channels.flatMap((channel) =>
      channel.postingTimes.map((entry) => entry.time),
    );
    const taken = await this.posts.queuedTimes(
      body.organizationId,
      channels.map((channel) => channel.id),
      new Date(now - 60_000),
    );
    const slot = nextFreeSlot({ postingTimes, taken, from: now, timeZone: body.timeZone });
    if (slot === null) {
      throw new UnprocessableEntityException({
        message: POST_GATEWAY_MESSAGES.NO_FREE_SLOT,
        code: 'no_free_slot',
      });
    }
    return new Date(slot);
  }

  /** Publish To's channels must all be of its card's platform (LinkedIn covers Pages too). */
  private async assertPlatform(body: PublishBody): Promise<void> {
    const platform = platformById(body.provider);
    if (!platform) return;
    const byId = new Map<string, ChannelView>(
      (await this.channels.list(body.organizationId)).map((channel) => [channel.id, channel]),
    );
    for (const id of body.channels) {
      const channel = byId.get(id);
      // An unknown channel is the posts service's to refuse, with its own words.
      if (channel && !platform.providers.includes(channel.providerIdentifier)) {
        throw new UnprocessableEntityException({
          message: POST_GATEWAY_MESSAGES.wrongPlatform(channel.name, platform.title),
          code: 'wrong_platform',
        });
      }
    }
  }

  private composerLink(organizationId: string, group: string): string {
    const base = this.config.get('WEB_URL', { infer: true }).replace(/\/+$/, '');
    return `${base}/${organizationId}/composer?group=${encodeURIComponent(group)}`;
  }
}

function channelsOf(detail: PostDetail): ChannelOutput[] {
  return detail.channels.map((channel) => ({
    id: channel.channelId,
    name: channel.name,
    provider: channel.providerIdentifier,
  }));
}
