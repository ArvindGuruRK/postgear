/**
 * Caption styles (Sprint 13, Module 03): the six built in, and up to 30 of a
 * workspace's own ("Create A Style").
 *
 * - A look is checked by the engine's schema. Its font is a Studio family the
 *   editor's font list offers; the API holds no font files, so a family the
 *   export does not have fails that export with `font_missing`, as text does.
 * - Deleting a style a clip still uses is allowed: that clip falls back to
 *   the default look (`resolveStyle`), it never loses its captions.
 * - A stored look that no longer reads (saved by a newer version) is left
 *   out of the list and logged by id, never by content.
 */
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ClipCaptionStyle, Prisma } from '@postgear/db';
import {
  CAPTION_STYLES,
  type CaptionLook,
  type CaptionStyle,
  captionLookSchema,
  DEFAULT_CAPTION_STYLE,
  MAX_CUSTOM_CAPTION_STYLES,
} from '@postgear/video-engine';
import { isUuid } from '../clips.ids';
import { CLIP_CAPTION_STYLES_MESSAGES } from './clip-caption-styles.messages';
import { ClipCaptionStylesRepository } from './clip-caption-styles.repository';
import type {
  CreateCaptionStyleInput,
  UpdateCaptionStyleInput,
} from './clip-caption-styles.schema';

export interface CaptionStyleView {
  id: string;
  name: string;
  hint: string;
  builtIn: boolean;
  look: CaptionLook;
}

export interface CaptionStylesAnswer {
  styles: CaptionStyleView[];
  defaultStyleId: string;
  /** How many of its own the workspace keeps, and the most it can. */
  own: number;
  limit: number;
}

@Injectable()
export class ClipCaptionStylesService {
  private readonly logger = new Logger(ClipCaptionStylesService.name);

  constructor(private readonly repository: ClipCaptionStylesRepository) {}

  /** `{ styles, defaultStyleId, own, limit }`: built in first, then the workspace's. */
  async list(orgId: string): Promise<CaptionStylesAnswer> {
    const own = await this.own(orgId);
    return {
      styles: [...CAPTION_STYLES.map(toBuiltInView), ...own],
      defaultStyleId: DEFAULT_CAPTION_STYLE,
      own: own.length,
      limit: MAX_CUSTOM_CAPTION_STYLES,
    };
  }

  /** The workspace's own styles whose look still reads. */
  async own(orgId: string): Promise<CaptionStyleView[]> {
    const rows = await this.repository.list(orgId);
    const views: CaptionStyleView[] = [];
    for (const row of rows) {
      const view = this.toView(row);
      if (view) views.push(view);
    }
    return views;
  }

  /** One of the workspace's own, or null: never another workspace's. */
  async findOwn(orgId: string, id: string): Promise<CaptionStyleView | null> {
    if (!isUuid(id)) return null;
    const row = await this.repository.find(orgId, id);
    return row ? this.toView(row) : null;
  }

  /** 201 `{ style }`; 409 `caption_style_limit` at 30. */
  async create(
    orgId: string,
    userId: string,
    body: CreateCaptionStyleInput,
  ): Promise<{ style: CaptionStyleView }> {
    const result = await this.repository.create(
      orgId,
      userId,
      { name: body.name, look: body.look as Prisma.InputJsonValue },
      MAX_CUSTOM_CAPTION_STYLES,
    );
    if (result.outcome === 'limit') {
      throw new ConflictException({
        message: CLIP_CAPTION_STYLES_MESSAGES.LIMIT,
        code: 'caption_style_limit',
      });
    }
    const view = this.toView(result.style);
    if (!view) throw notFound();
    return { style: view };
  }

  async update(
    orgId: string,
    id: string,
    body: UpdateCaptionStyleInput,
  ): Promise<{ style: CaptionStyleView }> {
    const row = isUuid(id)
      ? await this.repository.update(orgId, id, {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.look !== undefined ? { look: body.look as Prisma.InputJsonValue } : {}),
        })
      : null;
    const view = row ? this.toView(row) : null;
    if (!view) throw notFound();
    return { style: view };
  }

  async remove(orgId: string, id: string): Promise<{ message: string }> {
    const removed = isUuid(id) ? await this.repository.remove(orgId, id) : false;
    if (!removed) throw notFound();
    return { message: CLIP_CAPTION_STYLES_MESSAGES.DELETED };
  }

  private toView(row: ClipCaptionStyle): CaptionStyleView | null {
    const look = captionLookSchema.safeParse(row.look);
    if (!look.success) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.caption_style.unreadable',
          styleId: row.id,
          orgId: row.organizationId,
        }),
      );
      return null;
    }
    return { id: row.id, name: row.name, hint: '', builtIn: false, look: look.data };
  }
}

function toBuiltInView(style: CaptionStyle): CaptionStyleView {
  return { id: style.id, name: style.name, hint: style.hint, builtIn: true, look: style.look };
}

function notFound(): NotFoundException {
  return new NotFoundException({
    message: CLIP_CAPTION_STYLES_MESSAGES.NOT_FOUND,
    code: 'caption_style_not_found',
  });
}
