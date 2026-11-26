/**
 * Add Hook Title (Sprint 13, Module 09): three short opening lines for a
 * clip, written from the words it plays.
 *
 * 1. **Throttle**: ten asks a minute per workspace (Redis, the Clips
 *    fixed-window counter), then 429 `hook_titles_throttled`. This is the
 *    whole price: hook titles are free, so no AI minutes and no usage entry.
 * 2. **The words**: the clip's spoken transcript only (the video's own
 *    listened words with their fixes, never a captions file or a
 *    translation), read through `ClipCaptionsService.words(..., 'spoken')`,
 *    which also holds the clip to the workspace (another workspace's clip is
 *    a plain 404). Only the sentences inside the stretches the clip plays are
 *    kept, whole, until 1,500 characters. None heard: 422
 *    `hook_titles_no_words`.
 * 3. **The title writer**: `writeHookTitles` on the snippet writer (AI
 *    simulation answers from the words). No model configured: 503
 *    `hook_titles_off`. Any failure, including fewer than three usable
 *    titles: 502 `hook_titles_failed`.
 *
 * Nothing here logs a word or a title: events carry ids and counts.
 */
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { HOOK_TEXT_MAX_CHARS } from '@postgear/ai-engine';
import { languageName, translationLines } from '@postgear/video-engine';
import { AI_ENGINE, type AiEngine } from '../../ai/engine/engine.types';
import { RedisService } from '../../redis/redis.service';
import { ClipCaptionsService } from '../captions/clip-captions.service';
import { ClipErrorException } from '../clip-error.exception';
import { withinRate } from '../links/clip-rate-limit';
import { CLIP_HOOK_TITLES_MESSAGES } from './clip-hook-titles.messages';

/** Asks a workspace may make in one minute. */
export const HOOK_TITLES_PER_MINUTE = 10;

export interface HookTitlesView {
  titles: [string, string, string];
}

/**
 * Whole sentences, in order, joined until the next would pass `max`
 * characters. A first sentence longer than `max` is sent alone (the title
 * writer cuts it at a word).
 */
export function hookTextFrom(sentences: readonly string[], max = HOOK_TEXT_MAX_CHARS): string {
  let text = '';
  for (const raw of sentences) {
    const sentence = raw.replace(/\s+/g, ' ').trim();
    if (sentence.length === 0) continue;
    const next = text.length === 0 ? sentence : `${text} ${sentence}`;
    if (next.length > max) return text.length === 0 ? sentence : text;
    text = next;
  }
  return text;
}

@Injectable()
export class ClipHookTitlesService {
  private readonly logger = new Logger(ClipHookTitlesService.name);

  constructor(
    private readonly captions: ClipCaptionsService,
    private readonly redis: RedisService,
    @Inject(AI_ENGINE) private readonly ai: AiEngine,
  ) {}

  /** `attempt`: 0 for the first ask, counting up on each Try Again (new titles each time). */
  async suggest(
    orgId: string,
    userId: string,
    clipId: string,
    attempt = 0,
  ): Promise<HookTitlesView> {
    if (
      !(await withinRate(this.redis, `clips:hook-titles:rate:${orgId}`, HOOK_TITLES_PER_MINUTE, 60))
    ) {
      throw new ClipErrorException(HttpStatus.TOO_MANY_REQUESTS, 'hook_titles_throttled', {
        message: CLIP_HOOK_TITLES_MESSAGES.THROTTLED,
      });
    }

    const { transcript, ranges } = await this.captions.words(orgId, clipId, 'spoken');
    const sentences = transcript
      ? translationLines({ words: transcript.words }, ranges).map((line) => line.text)
      : [];
    const text = hookTextFrom(sentences);
    if (!transcript || text.length === 0) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'hook_titles_no_words', {
        message: CLIP_HOOK_TITLES_MESSAGES.NO_WORDS,
      });
    }

    const writer = this.ai.createSnippetWriter({ orgId });
    if (!writer) {
      throw new ClipErrorException(HttpStatus.SERVICE_UNAVAILABLE, 'hook_titles_off', {
        message: CLIP_HOOK_TITLES_MESSAGES.OFF,
      });
    }

    try {
      const { titles } = await writer.writeHookTitles({
        text,
        language: languageName(transcript.language),
        attempt,
      });
      this.logger.log(
        JSON.stringify({
          event: 'clips.hook_titles.written',
          orgId,
          userId,
          clipId,
          sentences: sentences.length,
          characters: text.length,
          titles: titles.length,
          attempt,
        }),
      );
      return { titles };
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.hook_titles.failed',
          orgId,
          clipId,
          kind: String((error as { kind?: unknown } | null)?.kind ?? 'unknown'),
        }),
      );
      throw new ClipErrorException(HttpStatus.BAD_GATEWAY, 'hook_titles_failed', {
        message: CLIP_HOOK_TITLES_MESSAGES.FAILED,
      });
    }
  }
}
