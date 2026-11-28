/**
 * Add Hook Title (Sprint 13 Clips AI, Module 09): three short opening lines
 * for a clip, written from the words it plays.
 *
 * One structured call on the snippet writer's model client. What comes back
 * is held to the brief whatever the model did: each title loses quotation
 * marks, hashtags, emoji and list marks, is trimmed and cut to seven words,
 * and repeats (case and punctuation aside) are dropped. Three different
 * titles must remain; a model that leaves fewer is asked once more, and a
 * second miss is `bad_output` (the API answers 502 with a sentence).
 *
 * Never logs the words or a title.
 */
import { normaliseRunError, providerError, withTimeout } from '../model/resilience';
import { stripMarkup } from '../prompts/fields';
import {
  buildHookTitlePrompt,
  HOOK_TEXT_MAX_CHARS,
  HOOK_TITLE_COUNT,
  HOOK_TITLE_MAX_CHARS,
  HOOK_TITLE_MAX_WORDS,
  hookTitlesSchema,
} from '../prompts/hook-titles';
import type { HookTitleRequest, HookTitleResult, ModelClient } from '../types';

/** One call's deadline. */
export const HOOK_TITLE_TIMEOUT_MS = 30_000;
/** Calls made at most before giving up (the first, and one more after a short answer). */
const ATTEMPTS = 2;

/**
 * The words sent: one line, at most `max` characters, cut after the last
 * whole sentence that fits (or the last whole word when no sentence does).
 */
export function hookText(text: string, max = HOOK_TEXT_MAX_CHARS): string {
  const line = text
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (line.length <= max) return line;
  const window = line.slice(0, max + 1);
  const sentenceEnd = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('! '),
    window.lastIndexOf('? '),
  );
  if (sentenceEnd > 0) return window.slice(0, sentenceEnd + 1).trim();
  const wordEnd = window.lastIndexOf(' ');
  return (wordEnd > 0 ? window.slice(0, wordEnd) : line.slice(0, max)).trim();
}

/**
 * One title as the brief wants it: no quotation marks (an apostrophe inside a
 * word stays), no hashtags, no emoji, no list mark or trailing full stop, at
 * most seven words and 80 characters. May answer '' (nothing usable).
 */
export function cleanHookTitle(raw: string): string {
  const words = stripMarkup(raw)
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/^\s*(?:\d+[.)]|[-*•])\s+/u, '')
    .replace(/#[\p{L}\p{N}_]*/gu, ' ')
    .replace(/["“”„«»‹›]/gu, ' ')
    .replace(/(^|\s)['‘’`]+/gu, '$1')
    .replace(/['‘’`]+(?=\s|$)/gu, '')
    .replace(/\p{Extended_Pictographic}|‍|️/gu, ' ')
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word))
    .slice(0, HOOK_TITLE_MAX_WORDS);
  return words
    .join(' ')
    .slice(0, HOOK_TITLE_MAX_CHARS)
    .replace(/[\s.,;:]+$/u, '')
    .trim();
}

/** Two titles are the same when their letters and numbers are, case aside. */
function sameKey(title: string): string {
  return title
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((part) => part.length > 0)
    .join(' ');
}

/** Each answer cleaned, empties and repeats dropped, in the model's order. */
export function distinctHookTitles(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const answer of raw) {
    const title = cleanHookTitle(typeof answer === 'string' ? answer : '');
    const key = sameKey(title);
    if (title.length === 0 || seen.has(key)) continue;
    seen.add(key);
    kept.push(title);
  }
  return kept;
}

export async function writeHookTitles(
  model: ModelClient,
  request: HookTitleRequest,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<HookTitleResult> {
  const text = hookText(request.text);
  if (text.length === 0) {
    throw providerError('bad_output', { message: 'There are no words to title.' });
  }
  const prompt = buildHookTitlePrompt({
    text,
    language: request.language.trim() || 'English',
    attempt: request.attempt ?? 0,
  });

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    let raw: string[];
    try {
      ({ hookTitles: raw } = await withTimeout(
        model.structured({ schema: hookTitlesSchema, ...prompt, signal: options.signal }),
        options.timeoutMs ?? HOOK_TITLE_TIMEOUT_MS,
        options.signal,
      ));
    } catch (error) {
      throw normaliseRunError(error, options.signal);
    }
    const titles = distinctHookTitles(Array.isArray(raw) ? raw : []);
    if (titles.length >= HOOK_TITLE_COUNT) {
      return { titles: [titles[0] as string, titles[1] as string, titles[2] as string] };
    }
  }
  throw providerError('bad_output', {
    message: 'The model did not answer three usable hook titles.',
  });
}
