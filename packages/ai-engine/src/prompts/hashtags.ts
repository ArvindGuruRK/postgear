/**
 * Hashtags (Sprint 10, a workflow's Generate Hashtags step): a short list
 * of tags that fit a post, asked for in one structured call.
 *
 * The prompt asks for exactly `count` tags; the caller (`agents/snippets.ts`)
 * still cleans what comes back (a model writes "#Small Business" or repeats
 * a tag often enough) and holds the line to the platform's length rule,
 * because a prompt is a request, not a guarantee.
 */
import { z } from 'zod';
import { block, field } from './fields';

/** The fewest and most hashtags a step may ask for. */
export const HASHTAG_COUNT_MIN = 3;
export const HASHTAG_COUNT_MAX = 15;

/** The longest one hashtag may be, `#` included. Longer ones read as spam. */
export const HASHTAG_MAX_LENGTH = 40;

export const hashtagsSchema = z.object({
  hashtags: z
    .array(z.string().min(1).max(200))
    .min(1)
    .max(30)
    .describe('The hashtags, each starting with #, most relevant first.'),
});

export type HashtagsOutput = z.infer<typeof hashtagsSchema>;

export interface HashtagPromptInput {
  text: string;
  /** A provider identifier (`instagram`, `x` ...) or `generic`. */
  platform: string;
  count: number;
}

export function buildHashtagPrompt(input: HashtagPromptInput): { system: string; user: string } {
  const system = [
    'You suggest hashtags for a social media post.',
    'Rules:',
    `- Return exactly ${input.count} hashtags, the most relevant first.`,
    '- Each hashtag starts with # and is one word: letters, numbers and underscores only, no spaces.',
    `- At most ${HASHTAG_MAX_LENGTH} characters each.`,
    '- Every hashtag must fit what the post is about. Mix a few broad ones with specific ones.',
    '- Never repeat a hashtag, and never invent a brand name the post does not mention.',
    '- Lean into how people use hashtags on the platform when one is given.',
  ].join('\n');

  const user = [
    field('Platform', input.platform),
    field('Count', input.count),
    block('Text', input.text),
  ].join('\n');

  return { system, user };
}

/**
 * Cleans what a model returned: `#` in front, one word, no punctuation, no
 * repeats (case-insensitively), nothing longer than {@link HASHTAG_MAX_LENGTH}.
 */
export function normaliseHashtags(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of raw) {
    const word = value
      .replace(/^#+/, '')
      .replace(/[^\p{L}\p{N}_]+/gu, '')
      .slice(0, HASHTAG_MAX_LENGTH - 1);
    if (word.length === 0 || /^\d+$/.test(word)) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(`#${word}`);
  }
  return tags;
}
