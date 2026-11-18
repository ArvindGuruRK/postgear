/**
 * Saved layouts (Sprint 12, Module 10 section 6): a workspace keeps up to 50
 * named layouts, each for one shape, and any member may save, rename and
 * delete them.
 *
 * A stored layout is read back with the engine's `layoutSchema` before it
 * is answered, so a row written by an older PostGear (or edited by hand)
 * that no longer reads is left out of the list and logged, never sent to an
 * editor that would choke on it.
 */
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ClipLayoutPreset, Prisma } from '@postgear/db';
import { type ClipLayout, layoutSchema, RATIOS, type Ratio } from '@postgear/video-engine';
import { isUuid } from '../clips.ids';
import { CLIP_LAYOUTS_MESSAGES } from './clip-layouts.messages';
import { ClipLayoutsRepository } from './clip-layouts.repository';
import {
  type CreateLayoutInput,
  type ListLayoutsQuery,
  MAX_SAVED_LAYOUTS,
  type RenameLayoutInput,
} from './clip-layouts.schema';

export interface SavedLayoutView {
  id: string;
  name: string;
  ratio: Ratio;
  layout: ClipLayout;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class ClipLayoutsService {
  private readonly logger = new Logger(ClipLayoutsService.name);

  constructor(private readonly repository: ClipLayoutsRepository) {}

  async list(orgId: string, query: ListLayoutsQuery): Promise<{ layouts: SavedLayoutView[] }> {
    const rows = await this.repository.list(orgId, query.ratio);
    const layouts: SavedLayoutView[] = [];
    for (const row of rows) {
      const view = this.toView(row);
      if (view) layouts.push(view);
    }
    return { layouts };
  }

  /** 201 `{ layout }`; 409 `layout_limit` at 50. */
  async create(
    orgId: string,
    userId: string,
    body: CreateLayoutInput,
  ): Promise<{ layout: SavedLayoutView }> {
    const result = await this.repository.create(
      orgId,
      userId,
      { name: body.name, ratio: body.ratio, layout: body.layout as Prisma.InputJsonValue },
      MAX_SAVED_LAYOUTS,
    );
    if (result.outcome === 'limit') {
      throw new ConflictException({ message: CLIP_LAYOUTS_MESSAGES.LIMIT, code: 'layout_limit' });
    }
    const view = this.toView(result.layout);
    if (!view) throw notFound();
    return { layout: view };
  }

  async rename(
    orgId: string,
    id: string,
    body: RenameLayoutInput,
  ): Promise<{ layout: SavedLayoutView }> {
    const row = isUuid(id) ? await this.repository.rename(orgId, id, body.name) : null;
    const view = row ? this.toView(row) : null;
    if (!view) throw notFound();
    return { layout: view };
  }

  async remove(orgId: string, id: string): Promise<{ message: string }> {
    const removed = isUuid(id) ? await this.repository.remove(orgId, id) : false;
    if (!removed) throw notFound();
    return { message: CLIP_LAYOUTS_MESSAGES.DELETED };
  }

  private toView(row: ClipLayoutPreset): SavedLayoutView | null {
    const layout = layoutSchema.safeParse(row.layout);
    const ratio = (RATIOS as readonly string[]).includes(row.ratio) ? (row.ratio as Ratio) : null;
    if (!layout.success || !ratio) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.layout.unreadable',
          layoutId: row.id,
          orgId: row.organizationId,
        }),
      );
      return null;
    }
    return {
      id: row.id,
      name: row.name,
      ratio,
      layout: layout.data,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

function notFound(): NotFoundException {
  return new NotFoundException({
    message: CLIP_LAYOUTS_MESSAGES.NOT_FOUND,
    code: 'layout_not_found',
  });
}
