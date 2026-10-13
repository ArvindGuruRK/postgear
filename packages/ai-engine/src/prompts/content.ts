/**
 * Content stage — the post itself, as parts.
 *
 * Format decides shape and length (contract §1): one short post, one long
 * post, a short thread or a long thread. {@link partLimits} is the single
 * place those numbers live; the prompt quotes them and the pipeline enforces
 * them afterwards, because a model given "at most 280 characters" delivers
 * 290 often enough that the guard is not optional. The guard's order is
 * cheap-to-expensive: one repair prompt that shows the model the exact
 * overflow, then a sentence-boundary truncation as the last resort — an
 * over-limit part must never reach a platform that will reject the post.
 *
 * Text rules are deliberately plain: no hashtags (platforms treat them
 * differently and PostGear's composer has its own handling), no markdown
 * (none of the platforms render it), `\n` between lines (what the composer
 * expects).
 */
import { z } from 'zod';
import type { PostFormat, ResearchSource, Tone } from '../types';
import { block, field } from './fields';
import { toneRules } from './tone';

export interface PartLimits {
  minParts: number;
  maxParts: number;
  /** Hard ceiling for one part. Always finite: the format supplies one when the caller does not. */
  maxChars: number;
  /** A soft floor for long formats; the prompt asks for it, the guard does not enforce it. */
  minChars: number;
  /** One line for the prompt and the UI. */
  description: string;
}

export const SHORT_PART_LIMIT = 280;
export const LONG_PART_LIMIT = 1_000;
export const LONG_POST_LIMIT = 1_500;
export const LONG_POST_FLOOR = 800;

export function partLimits(format: PostFormat, maxCharacters: number | null): PartLimits {
  const cap = (limit: number) =>
    maxCharacters !== null && maxCharacters > 0 ? Math.min(limit, maxCharacters) : limit;

  switch (format) {
    case 'one_short':
      return {
        minParts: 1,
        maxParts: 1,
        maxChars: cap(SHORT_PART_LIMIT),
        minChars: 0,
        description: `one short post of at most ${cap(SHORT_PART_LIMIT)} characters`,
      };
    case 'one_long': {
      const maxChars = cap(LONG_POST_LIMIT);
      const minChars = Math.min(LONG_POST_FLOOR, Math.floor(maxChars * 0.6));
      return {
        minParts: 1,
        maxParts: 1,
        maxChars,
        minChars,
        description: `one long post of ${minChars} to ${maxChars} characters`,
      };
    }
    case 'thread_short':
      return {
        minParts: 3,
        maxParts: 5,
        maxChars: cap(SHORT_PART_LIMIT),
        minChars: 0,
        description: `a thread of 3 to 5 parts, each at most ${cap(SHORT_PART_LIMIT)} characters`,
      };
    case 'thread_long':
      return {
        minParts: 3,
        maxParts: 6,
        maxChars: cap(LONG_PART_LIMIT),
        minChars: 0,
        description: `a thread of 3 to 6 parts, each at most ${cap(LONG_PART_LIMIT)} characters`,
      };
  }
}

export function contentSchema(withImage: boolean) {
  const part = z.object({
    text: z.string().min(1).describe('The text of this part. Plain text, lines separated by \\n.'),
    imagePrompt: withImage
      ? z
          .string()
          .nullable()
          .optional()
          .describe(
            'For the first part only: a descriptive prompt for an illustration — style, subject, light, mood. No brand names, no text in the image.',
          )
      : z.null().optional().describe('Not used for this request.'),
  });
  return z.object({ parts: z.array(part).min(1).max(6) });
}

export type ContentOutput = z.infer<ReturnType<typeof contentSchema>>;

export interface ContentPromptInput {
  topic: string;
  tone: Tone;
  format: PostFormat;
  category: string;
  hook: string;
  withImage: boolean;
  maxCharacters: number | null;
  platforms: string[];
  sources: ResearchSource[];
  workspaceName?: string;
  /** Set on the repair pass: what was wrong with the previous answer. */
  repairNote?: string;
}

export function buildContentPrompt(input: ContentPromptInput): { system: string; user: string } {
  const limits = partLimits(input.format, input.maxCharacters);
  const system = [
    'You write the full text of a social media post from a brief, a hook and research notes.',
    toneRules(input.tone, input.workspaceName),
    `Shape: ${limits.description}.`,
    'Rules:',
    `- Part 1 begins with the hook, exactly as given, as its own first line.`,
    `- No part may exceed ${limits.maxChars} characters. Count carefully; shorter is fine.`,
    limits.minChars > 0 ? `- Aim for at least ${limits.minChars} characters.` : null,
    limits.maxParts > 1
      ? `- Return between ${limits.minParts} and ${limits.maxParts} parts; each part must stand on its own and the last part closes the thought.`
      : '- Return exactly one part.',
    '- Plain text only: no hashtags, no markdown, no emoji, no numbered "1/5" prefixes.',
    '- Put "\\n" between lines. Short lines read better on a phone.',
    '- Use the research where it adds a fact; never invent statistics or quotes.',
    '- Be concrete and specific; end with one natural call to action or question.',
    input.withImage
      ? '- Also write "imagePrompt" for part 1: a vivid description for an illustration, with no brand names and no text in the image. Leave it null on other parts.'
      : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  const user = [
    field('Voice', input.tone),
    field('Format', input.format),
    field('Category', input.category),
    field('Max characters per part', limits.maxChars),
    field('Min characters', limits.minChars > 0 ? limits.minChars : null),
    field('Parts', `${limits.minParts}-${limits.maxParts}`),
    field('Image prompts', input.withImage ? 'yes' : 'no'),
    field('Platforms', input.platforms.length > 0 ? input.platforms.join(', ') : 'generic'),
    field('Workspace', input.workspaceName),
    block('Hook', input.hook),
    block('Brief', input.topic),
    block(
      'Research',
      input.sources
        .map((source) => `- ${source.title} | ${source.url} | ${source.snippet}`)
        .join('\n'),
    ),
    input.repairNote ? block('Repair', input.repairNote) : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  return { system, user };
}

/**
 * Removes what the platforms cannot render or the rules forbid: markdown
 * emphasis and headings, hashtags, bullet glyphs, CRLF line endings and runs
 * of blank lines. Keeps the author's `\n` line structure.
 */
export function cleanPartText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|\s)[*_]([^*_\n]+)[*_](?=\s|$|[.,!?])/g, '$1$2')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/(^|\s)#[\p{L}_][\p{L}\p{N}_]*/gu, '$1')
    .replace(/[ \t]+$/gm, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Cuts `text` to at most `max` characters at the last sentence end, else the
 * last line break, else the last word, so the result still reads as prose.
 */
export function truncateAtSentence(text: string, max: number): string {
  if (text.length <= max) return text;
  const window = text.slice(0, max);
  const sentenceEnd = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('! '),
    window.lastIndexOf('? '),
    window.lastIndexOf('.\n'),
    window.lastIndexOf('!\n'),
    window.lastIndexOf('?\n'),
  );
  if (sentenceEnd >= Math.floor(max * 0.4)) return window.slice(0, sentenceEnd + 1).trim();
  const lineEnd = window.lastIndexOf('\n');
  if (lineEnd >= Math.floor(max * 0.4)) return window.slice(0, lineEnd).trim();
  const wordEnd = window.lastIndexOf(' ');
  const cut = wordEnd > 0 ? window.slice(0, wordEnd) : window;
  return `${cut.replace(/[,;:\s]+$/, '')}…`.slice(0, max);
}

/** The first line of a part, which is where the hook has to be. */
export function firstLine(text: string): string {
  const index = text.indexOf('\n');
  return (index === -1 ? text : text.slice(0, index)).trim();
}

/**
 * Makes the hook the first line of the first part when the model left it
 * out, and never duplicates it when the model already put it there (in any
 * casing or with trailing punctuation differences).
 */
export function ensureHookLeads(text: string, hook: string): string {
  const normalise = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  const head = normalise(text.slice(0, hook.length + 20));
  const wanted = normalise(hook);
  if (wanted.length === 0 || head.startsWith(wanted)) return text;
  return `${hook.trim()}\n${text}`.trim();
}
