/**
 * Post tags (2026-10-19, after Postiz's): a workspace's own labels, each in
 * one colour of the avatar palette, shown on the calendar card and used to
 * filter it.
 *
 * Any member may create, rename, recolour and delete them, as in Postiz: they
 * label posts, which every member writes, rather than configure the workspace.
 *
 * The posts module resolves a save's tag ids through `findLive` rather than
 * reading this table itself, so this module stays the single owner of `Tags`
 * the way channels and media own theirs.
 */
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type CreateTagInput,
  MAX_TAGS_PER_WORKSPACE,
  type TagColor,
  type UpdateTagInput,
} from './dto/tags.schema';
import { TAG_MESSAGES } from './tags.messages';
import { type TagRow, TagsRepository } from './tags.repository';

/** What `/tags` returns, and what a post carries in its `tags`. */
export interface TagView {
  id: string;
  name: string;
  color: TagColor;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class TagsService {
  constructor(private readonly repository: TagsRepository) {}

  async list(orgId: string): Promise<TagView[]> {
    return (await this.repository.list(orgId)).map(toTagView);
  }

  /**
   * The live tags of this workspace among `ids`, keyed by id. A caller checks
   * that every id it was sent came back: anything missing is another
   * workspace's, deleted, or made up.
   */
  async findLive(orgId: string, ids: string[]): Promise<Map<string, TagView>> {
    const wellFormed = [...new Set(ids)].filter((id) => UUID_PATTERN.test(id));
    const rows = await this.repository.findLive(orgId, wellFormed);
    return new Map(rows.map((row) => [row.id, toTagView(row)]));
  }

  async create(orgId: string, input: CreateTagInput): Promise<TagView> {
    const result = await this.repository.create(orgId, input, MAX_TAGS_PER_WORKSPACE);

    switch (result.outcome) {
      case 'too_many':
        throw new UnprocessableEntityException(TAG_MESSAGES.TOO_MANY);
      case 'name_taken':
        throw new ConflictException(TAG_MESSAGES.NAME_TAKEN);
      case 'created':
        return toTagView(result.tag);
    }
  }

  async update(orgId: string, id: string, input: UpdateTagInput): Promise<TagView> {
    if (!UUID_PATTERN.test(id)) {
      throw new NotFoundException(TAG_MESSAGES.NOT_FOUND);
    }

    const result = await this.repository.update(orgId, id, input);

    switch (result.outcome) {
      case 'not_found':
        throw new NotFoundException(TAG_MESSAGES.NOT_FOUND);
      case 'name_taken':
        throw new ConflictException(TAG_MESSAGES.NAME_TAKEN);
      case 'updated':
        return toTagView(result.tag);
    }
  }

  async remove(orgId: string, id: string): Promise<void> {
    if (!UUID_PATTERN.test(id) || !(await this.repository.softDelete(orgId, id))) {
      throw new NotFoundException(TAG_MESSAGES.NOT_FOUND);
    }
  }
}

/**
 * Stored colours are always one of `TAG_COLORS` (the schema refuses anything
 * else), so this is a narrowing, not a conversion.
 */
export function toTagView(row: TagRow): TagView {
  return { id: row.id, name: row.name, color: row.color as TagColor };
}
