/**
 * A brand kit's clip fields (Sprint 13, Module 10): the shape and the checks,
 * shared by the two doors that write them, `PATCH /clips/brand-kits/:id`
 * (the kit page) and Studio's `PATCH /studio/brand-kits/:id` (whose strict
 * schema takes them too; Studio's screens never send them). One set of
 * rules, so a kit can never hold through one door what the other refuses.
 *
 * - The logo's corner: one of `LOGO_POSITIONS`, or null for no logo on clips.
 * - The caption style: a built-in id or one of the workspace's own styles
 *   (422 `caption_style_not_found` otherwise).
 * - The intro and an outro video: one of the workspace's own live videos,
 *   READY (422 `brand_video_not_ready`), at most `BRAND_VIDEO_MAX_MS` long
 *   (422 `brand_video_too_long`); another workspace's, or a deleted one, is a
 *   404 `video_not_found`.
 * - The outro card's line: one plain line of at most `CARD_TEXT_MAX`
 *   characters, no emoji (emoji are stickers, not text); empty clears it.
 *
 * `clipLogoAssetId` is not here: it is the API's own copy of the logo
 * (`ClipBrandKitsService.use`), never written from a request.
 */
import { HttpStatus, NotFoundException } from '@nestjs/common';
import { prisma } from '@postgear/db';
import {
  BRAND_VIDEO_MAX_MS,
  CARD_TEXT_MAX,
  hasEmoji,
  isBuiltInCaptionStyle,
  LOGO_POSITIONS,
} from '@postgear/video-engine';
import { z } from 'zod';
import { ClipErrorException } from '../clip-error.exception';
import { isUuid } from '../clips.ids';
import { CLIPS_MESSAGES } from '../clips.messages';

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

const outroText = z
  .string()
  .max(CARD_TEXT_MAX * 4)
  .transform((text) => text.trim())
  .pipe(
    z
      .string()
      .max(CARD_TEXT_MAX)
      .refine((text) => !CONTROL.test(text), 'One plain line')
      .refine((text) => !hasEmoji(text), 'No emoji'),
  )
  .transform((text) => (text.length > 0 ? text : null));

/** The clip fields, every one optional and nullable, for a strict patch schema to spread. */
export const clipBrandFields = {
  clipLogoPosition: z.enum(LOGO_POSITIONS).nullable().optional(),
  clipCaptionStyleId: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,63}$/i)
    .nullable()
    .optional(),
  clipIntroVideoId: z.string().uuid().nullable().optional(),
  clipOutroVideoId: z.string().uuid().nullable().optional(),
  clipOutroText: outroText.nullable().optional(),
};

export const CLIP_BRAND_FIELD_NAMES = [
  'clipLogoPosition',
  'clipCaptionStyleId',
  'clipIntroVideoId',
  'clipOutroVideoId',
  'clipOutroText',
] as const;

export interface ClipBrandFieldsInput {
  clipLogoPosition?: (typeof LOGO_POSITIONS)[number] | null;
  clipCaptionStyleId?: string | null;
  clipIntroVideoId?: string | null;
  clipOutroVideoId?: string | null;
  clipOutroText?: string | null;
}

/** The columns a checked patch writes (only the keys it named). */
export type ClipBrandFieldsWrite = ClipBrandFieldsInput;

/** True when the body names at least one clip field. */
export function namesClipBrandField(body: object): boolean {
  return CLIP_BRAND_FIELD_NAMES.some((name) => name in body);
}

/**
 * Checks the clip fields a patch names against the workspace's rows and
 * answers the columns to write. Throws the refusals in the file comment.
 */
export async function checkClipBrandFields(
  orgId: string,
  body: ClipBrandFieldsInput,
): Promise<ClipBrandFieldsWrite> {
  const write: ClipBrandFieldsWrite = {};
  if (body.clipLogoPosition !== undefined) write.clipLogoPosition = body.clipLogoPosition;
  if (body.clipOutroText !== undefined) write.clipOutroText = body.clipOutroText;
  if (body.clipCaptionStyleId !== undefined) {
    if (body.clipCaptionStyleId !== null) await assertCaptionStyle(orgId, body.clipCaptionStyleId);
    write.clipCaptionStyleId = body.clipCaptionStyleId;
  }
  if (body.clipIntroVideoId !== undefined) {
    if (body.clipIntroVideoId !== null) await assertBrandVideo(orgId, body.clipIntroVideoId);
    write.clipIntroVideoId = body.clipIntroVideoId;
  }
  if (body.clipOutroVideoId !== undefined) {
    if (body.clipOutroVideoId !== null) await assertBrandVideo(orgId, body.clipOutroVideoId);
    write.clipOutroVideoId = body.clipOutroVideoId;
  }
  return write;
}

async function assertCaptionStyle(orgId: string, styleId: string): Promise<void> {
  if (isBuiltInCaptionStyle(styleId)) return;
  const own = isUuid(styleId)
    ? await prisma.clipCaptionStyle.findFirst({
        where: { id: styleId, organizationId: orgId },
        select: { id: true },
      })
    : null;
  if (!own)
    throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'caption_style_not_found');
}

async function assertBrandVideo(orgId: string, videoId: string): Promise<void> {
  const video = await prisma.clipVideo.findFirst({
    where: { id: videoId, organizationId: orgId, deletedAt: null, status: { not: 'REMOVED' } },
    select: { status: true, durationMs: true },
  });
  if (!video) {
    throw new NotFoundException({
      message: CLIPS_MESSAGES.VIDEO_NOT_FOUND,
      code: 'video_not_found',
    });
  }
  if (video.status !== 'READY' || video.durationMs === null) {
    throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'brand_video_not_ready');
  }
  if (video.durationMs > BRAND_VIDEO_MAX_MS) {
    throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'brand_video_too_long');
  }
}
