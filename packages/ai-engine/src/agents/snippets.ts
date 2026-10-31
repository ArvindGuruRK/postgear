/**
 * The small writing jobs a workflow step asks for (Sprint 10): hashtags for
 * a post, and the same post in another voice.
 *
 * Each is one structured call on the same model client the pipeline uses,
 * with its prompt in `prompts/`. What the model returns is then held to the
 * rules the prompt asked for, because a model asked for "at most 280
 * characters" delivers 290 often enough:
 *
 * - hashtags: cleaned (`#`, one word, no repeats), cut to the count asked
 *   for (held to 3 to 15), then dropped from the end until the line fits
 *   the platform's limit;
 * - rewrite: tidied, then cut at a sentence end if it is over the limit.
 *
 * Either says `shortened: true` when it had to cut, so the step can tell
 * the person.
 */
import { normaliseRunError, providerError } from '../model/resilience';
import { truncateAtSentence } from '../prompts/content';
import {
  buildHashtagPrompt,
  HASHTAG_COUNT_MAX,
  HASHTAG_COUNT_MIN,
  hashtagsSchema,
  normaliseHashtags,
} from '../prompts/hashtags';
import { buildRewritePrompt, rewriteSchema } from '../prompts/rewrite';
import type {
  HashtagRequest,
  HashtagResult,
  ModelClient,
  RewriteRequest,
  RewriteResult,
  SnippetWriter,
} from '../types';

interface CallOptions {
  signal?: AbortSignal;
}

/** The count a request may ask for: a whole number from 3 to 15. */
export function hashtagCount(count: number): number {
  const whole = Number.isFinite(count) ? Math.round(count) : HASHTAG_COUNT_MIN;
  return Math.min(HASHTAG_COUNT_MAX, Math.max(HASHTAG_COUNT_MIN, whole));
}

function limitOf(maxCharacters: number | null | undefined): number | null {
  return typeof maxCharacters === 'number' && maxCharacters > 0 ? Math.floor(maxCharacters) : null;
}

export async function generateHashtags(
  model: ModelClient,
  request: HashtagRequest,
  options: CallOptions = {},
): Promise<HashtagResult> {
  const count = hashtagCount(request.count);
  const prompt = buildHashtagPrompt({ text: request.text, platform: request.platform, count });

  let raw: string[];
  try {
    ({ hashtags: raw } = await model.structured({
      schema: hashtagsSchema,
      ...prompt,
      signal: options.signal,
    }));
  } catch (error) {
    throw normaliseRunError(error, options.signal);
  }

  let hashtags = normaliseHashtags(raw).slice(0, count);
  if (hashtags.length === 0) {
    throw providerError('bad_output', { message: 'The model returned no usable hashtags.' });
  }

  const max = limitOf(request.maxCharacters);
  let shortened = false;
  while (max !== null && hashtags.length > 1 && hashtags.join(' ').length > max) {
    hashtags = hashtags.slice(0, -1);
    shortened = true;
  }

  return { hashtags, line: hashtags.join(' '), shortened };
}

/** Line endings, trailing spaces and runs of blank lines; the author's lines stay. */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function rewriteInVoice(
  model: ModelClient,
  request: RewriteRequest,
  options: CallOptions = {},
): Promise<RewriteResult> {
  const max = limitOf(request.maxCharacters);
  const prompt = buildRewritePrompt({
    text: request.text,
    platform: request.platform,
    voice: request.voice,
    maxCharacters: max,
    workspaceName: request.workspaceName,
  });

  let raw: string;
  try {
    ({ rewrite: raw } = await model.structured({
      schema: rewriteSchema,
      ...prompt,
      signal: options.signal,
    }));
  } catch (error) {
    throw normaliseRunError(error, options.signal);
  }

  const text = tidy(raw);
  if (text.length === 0) {
    throw providerError('bad_output', { message: 'The model returned an empty rewrite.' });
  }
  if (max !== null && text.length > max) {
    return { text: truncateAtSentence(text, max), shortened: true };
  }
  return { text, shortened: false };
}

/** Both jobs bound to one model client, for the API's engine. */
export function createSnippetWriter(model: ModelClient): SnippetWriter {
  return {
    hashtags: (request, options) => generateHashtags(model, request, options),
    rewrite: (request, options) => rewriteInVoice(model, request, options),
  };
}
