/**
 * Send To Composer (Sprint 12, Module 17 section 2): `POST /clips/:clipId/send`.
 *
 * 1. The clip must have an exported file that is still in Media, else 409
 *    `clip_not_exported` ("Export this clip first, then send it."). A clip
 *    changed since that export is refused with 409 `clip_export_outdated`
 *    unless the person chose Send The Old Version (`oldVersion: true`): the
 *    file that posts is the exported one.
 * 2. Every channel must be the workspace's (else 400, as the composer's own
 *    save answers), and the clip must fit each one (`videoFit` with the
 *    channel's provider rules and the exported file's facts), else 422
 *    `clip_does_not_fit` naming the channels: the dialog greys them, so this
 *    only answers a request that went around it.
 * 3. A draft through `PostsService.create`, exactly as Studio's
 *    `prepareSend`: DRAFT, the top of the next hour, the caption and the
 *    clip's file shared by every channel.
 * 4. Its `ClipPost` row: `PostsService` writes it on save; it is synced
 *    again here so the answer never comes before the clip shows Scheduled
 *    (running it twice writes nothing).
 *
 * Answers `{ group }`; the web opens the composer on it. No stream: the
 * export already happened.
 */
import {
  BadRequestException,
  HttpStatus,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { prisma } from '@postgear/db';
import {
  documentFromText,
  IntegrationManager,
  type VideoFacts,
  videoFit,
  videoFitSentence,
} from '@postgear/social-core';
import { safeParseClipDocument } from '@postgear/video-engine';
import { securityLogger } from '../../../common/logging/security-logger';
import { ChannelsService } from '../../channels/channels.service';
import { createPostSchema, postDocumentSchema } from '../../posts/dto/posts.schema';
import { POST_MESSAGES } from '../../posts/posts.messages';
import { type PostActor, PostsService } from '../../posts/posts.service';
import { ClipErrorException } from '../clip-error.exception';
import { isUuid } from '../clips.ids';
import { documentUsesAiVoice } from './clip-ai-voice';
import type { SendClipInput } from './clip-item.schema';
import { clipNotFound } from './clip-item.service';
import { ClipPostsService } from './clip-posts.service';

/** Where a sent clip's draft is parked: the top of the next hour, like Studio's. */
export function nextFullHour(now: Date = new Date()): Date {
  const date = new Date(now);
  date.setUTCMinutes(0, 0, 0);
  date.setUTCHours(date.getUTCHours() + 1);
  return date;
}

@Injectable()
export class ClipSendService {
  private readonly manager = new IntegrationManager();

  constructor(
    private readonly posts: PostsService,
    private readonly channels: ChannelsService,
    private readonly clipPosts: ClipPostsService,
  ) {}

  async send(
    orgId: string,
    clipId: string,
    input: SendClipInput,
    actor?: PostActor,
  ): Promise<{ group: string }> {
    if (!isUuid(clipId)) throw clipNotFound();
    const clip = await prisma.clip.findFirst({
      where: { id: clipId, organizationId: orgId },
      select: {
        id: true,
        revision: true,
        lastExportedRevision: true,
        exportedMediaId: true,
        document: true,
      },
    });
    if (!clip) throw clipNotFound();

    const media = clip.exportedMediaId
      ? await prisma.media.findFirst({
          where: { id: clip.exportedMediaId, organizationId: orgId, deletedAt: null },
          select: { id: true, fileSize: true, width: true, height: true, durationMs: true },
        })
      : null;
    if (!media) throw new ClipErrorException(HttpStatus.CONFLICT, 'clip_not_exported');

    const current =
      clip.lastExportedRevision !== null && clip.lastExportedRevision === clip.revision;
    if (!current && input.oldVersion !== true) {
      throw new ClipErrorException(HttpStatus.CONFLICT, 'clip_export_outdated');
    }

    const known = new Map(
      (await this.channels.list(orgId)).map((channel) => [channel.id, channel]),
    );
    const chosen = input.channelIds.map((id) => known.get(id));
    if (chosen.some((channel) => channel === undefined)) {
      securityLogger.warn('post.foreign_reference', { orgId, kind: 'channel' });
      throw new BadRequestException({
        message: POST_MESSAGES.CHANNEL_UNAVAILABLE,
        code: 'channel_unavailable',
      });
    }

    const facts: VideoFacts = {
      durationMs: media.durationMs,
      width: media.width,
      height: media.height,
      bytes: media.fileSize,
    };
    const misfits: string[] = [];
    for (const channel of chosen) {
      if (!channel) continue;
      const provider = this.manager.find(channel.providerIdentifier);
      if (!provider) continue; // The composer's own save refuses an unsupported platform.
      const fit = videoFit(provider.rules, facts);
      if (!fit.ok) misfits.push(`${channel.name}: ${videoFitSentence(fit, provider.name, facts)}`);
    }
    if (misfits.length > 0) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'clip_does_not_fit', {
        message: `${misfits.length === 1 ? 'This channel cannot take this clip.' : 'These channels cannot take this clip.'} ${misfits.join(' ')}`,
      });
    }

    const content = documentFromText(input.caption);
    if (!postDocumentSchema.safeParse(content).success) {
      throw new UnprocessableEntityException({
        message: 'This caption cannot be used. Shorten it and try again.',
        code: 'caption_invalid',
      });
    }

    // Module 13 (D13-10): a clip with a made-up voice starts marked Made With
    // AI; captions, cuts and layouts never do. The person may turn it off.
    const parsed = safeParseClipDocument(clip.document);
    const madeWithAi = await documentUsesAiVoice(orgId, parsed.ok ? parsed.doc : null);

    const post = await this.posts.create(
      orgId,
      createPostSchema.parse({
        state: 'DRAFT',
        publishDate: nextFullHour().toISOString(),
        shared: [{ content, media: [{ id: media.id }] }],
        channels: input.channelIds.map((channelId) => ({ channelId, customized: false })),
        ...(madeWithAi ? { madeWithAi: true } : {}),
      }),
      actor ? { actor } : {},
    );
    await this.clipPosts.syncForPost(orgId, post.group, [media.id]);
    return { group: post.group };
  }
}
