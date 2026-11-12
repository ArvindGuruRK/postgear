/**
 * Saved Ideas (Sprint 11 Module 10, backlog #3): a shortlist the whole
 * workspace shares, of cards someone wanted to come back to.
 *
 * Any member may save, note and remove: it is a team's scratch list, not
 * anyone's property, and each idea says who saved it. A copy of the card is
 * kept (validated by `dto/ideas.schema.ts`), so an idea still opens after the
 * feed has moved on and Create Post still has its brief and its place.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@postgear/db';
import { DISCOVER_MESSAGES } from './discover.messages';
import {
  MAX_IDEAS,
  type SaveIdeaInput,
  type SavedItem,
  type SavedPlace,
} from './dto/ideas.schema';
import { DiscoverIdeasRepository, type IdeaRow } from './ideas.repository';

export interface IdeaView {
  id: string;
  item: SavedItem;
  place: SavedPlace;
  language: string;
  note: string | null;
  savedBy: { id: string; name: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

export interface IdeasAnswer {
  ideas: IdeaView[];
  limit: number;
}

function toView(row: IdeaRow): IdeaView {
  return {
    id: row.id,
    item: row.item as unknown as SavedItem,
    place: row.place as unknown as SavedPlace,
    language: row.language,
    note: row.note,
    savedBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class DiscoverIdeasService {
  constructor(private readonly repository: DiscoverIdeasRepository) {}

  async list(orgId: string): Promise<IdeasAnswer> {
    return { ideas: (await this.repository.list(orgId, MAX_IDEAS)).map(toView), limit: MAX_IDEAS };
  }

  savedItemIds(orgId: string): Promise<string[]> {
    return this.repository.savedItemIds(orgId);
  }

  /** Idempotent: a card saved twice answers the first copy, its note untouched. */
  async save(
    orgId: string,
    userId: string | null,
    input: SaveIdeaInput,
  ): Promise<{ idea: IdeaView; created: boolean }> {
    const outcome = await this.repository.save(
      orgId,
      userId,
      {
        itemId: input.item.id,
        item: input.item as unknown as Prisma.InputJsonValue,
        place: input.place as unknown as Prisma.InputJsonValue,
        language: input.language,
        note: input.note && input.note.length > 0 ? input.note : null,
      },
      MAX_IDEAS,
    );
    if (outcome.outcome === 'limit') {
      throw new ConflictException(DISCOVER_MESSAGES.ideaLimit(MAX_IDEAS));
    }
    return { idea: toView(outcome.row), created: outcome.outcome === 'saved' };
  }

  async updateNote(orgId: string, id: string, note: string | null): Promise<IdeaView> {
    const row = await this.repository.updateNote(orgId, id, note && note.length > 0 ? note : null);
    if (!row) throw new NotFoundException(DISCOVER_MESSAGES.ideaNotFound);
    return toView(row);
  }

  async remove(orgId: string, id: string): Promise<void> {
    if (!(await this.repository.remove(orgId, id))) {
      throw new NotFoundException(DISCOVER_MESSAGES.ideaNotFound);
    }
  }
}
