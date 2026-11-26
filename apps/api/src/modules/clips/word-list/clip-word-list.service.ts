/**
 * The workspace's own bleep words (Sprint 13, Module 09, Bleep Bad Words).
 *
 * The editor finds the words to bleep itself (`findBleepWords` in the
 * engine, the built-in list of the clip's language plus these), so the API
 * only keeps the list: read it, and replace it whole. Free, no AI.
 *
 * Never logs a word: events carry the workspace id and a count.
 */
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ClipErrorException } from '../clip-error.exception';
import { CLIP_WORD_LIST_MESSAGES } from './clip-word-list.messages';
import { ClipWordListRepository } from './clip-word-list.repository';
import { normaliseWordList } from './clip-word-list.schema';

export interface WordListView {
  words: string[];
}

@Injectable()
export class ClipWordListService {
  private readonly logger = new Logger(ClipWordListService.name);

  constructor(private readonly repository: ClipWordListRepository) {}

  /** `GET /clips/word-list`: an empty list until the workspace saves one. */
  async read(orgId: string): Promise<WordListView> {
    return { words: (await this.repository.read(orgId)) ?? [] };
  }

  /** `PUT /clips/word-list`: the list cleaned, then kept whole in place of the old one. */
  async replace(orgId: string, userId: string, raw: readonly string[]): Promise<WordListView> {
    const list = normaliseWordList(raw);
    if (!list.ok) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, list.code, {
        message: CLIP_WORD_LIST_MESSAGES[list.code],
      });
    }
    const words = await this.repository.save(orgId, userId, list.words);
    this.logger.log(
      JSON.stringify({ event: 'clips.word_list.saved', orgId, userId, words: words.length }),
    );
    return { words };
  }
}
