/**
 * The moment picker and the title writer (Sprint 13 Clips AI, Module 05).
 *
 * - `pickMoments`: one structured call per window of rows, a few at a time,
 *   each with its own deadline. A failed window is skipped; the run fails
 *   only when most windows fail. Picks come back raw (row numbers and five
 *   parts): the caller checks every row number against the rows it sent.
 * - `writeTitles`: one call for a shortlist, a title of at most eight words
 *   each. A missing or unusable title is an empty string, never a guess.
 *
 * Neither ever logs a row, the request or an answer.
 */
import { normaliseRunError, providerError, withTimeout } from '../model/resilience';
import { stripMarkup } from '../prompts/fields';
import {
  buildMomentPrompt,
  buildTitlePrompt,
  MOMENT_REQUEST_MAX_CHARS,
  MOMENT_ROW_MAX_CHARS,
  momentPicksSchema,
  momentTitlesSchema,
  PICKS_PER_WINDOW,
  TITLE_MAX_WORDS,
} from '../prompts/moments';
import type {
  ModelClient,
  MomentPickRequest,
  MomentPickResult,
  RawMomentPick,
  TitleRequest,
} from '../types';

/** Windows read at once. */
export const MOMENT_CONCURRENCY = 3;
/** One window's deadline. */
export const MOMENT_WINDOW_TIMEOUT_MS = 60_000;
/** Moments titled in one call. */
export const TITLE_BATCH = 40;

function oneLine(text: string, max: number): string {
  return text
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

async function pickWindow(
  model: ModelClient,
  request: MomentPickRequest,
  rows: MomentPickRequest['windows'][number],
  signal: AbortSignal | undefined,
): Promise<RawMomentPick[]> {
  const prompt = buildMomentPrompt({
    rows: rows.map((row) => ({ n: row.n, text: oneLine(row.text, MOMENT_ROW_MAX_CHARS) })),
    request: oneLine(request.request, MOMENT_REQUEST_MAX_CHARS),
    genre: request.genre,
    genreNote: request.genreNote,
    lengthHint: request.lengthHint,
    language: request.language,
  });
  const answer = await withTimeout(
    model.structured({ schema: momentPicksSchema, ...prompt, signal }),
    request.windowTimeoutMs ?? MOMENT_WINDOW_TIMEOUT_MS,
    signal,
  );
  return answer.picks.slice(0, PICKS_PER_WINDOW).map((pick) => ({
    fromRow: pick.fromRow,
    toRow: pick.toRow,
    parts: {
      hook: pick.hook,
      standsAlone: pick.standsAlone,
      payoff: pick.payoff,
      clarity: pick.clarity,
      shareable: pick.shareable,
    },
    funny: pick.funny === true,
    matchesRequest: pick.matchesRequest === true,
  }));
}

export async function pickMoments(
  model: ModelClient,
  request: MomentPickRequest,
  options: { signal?: AbortSignal } = {},
): Promise<MomentPickResult> {
  const windows = request.windows.filter((rows) => rows.length > 0);
  if (windows.length === 0) return { picks: [], windows: 0, failed: 0 };
  const picks: RawMomentPick[] = [];
  let failed = 0;
  let next = 0;
  const concurrency = Math.max(1, request.concurrency ?? MOMENT_CONCURRENCY);

  const worker = async () => {
    while (next < windows.length) {
      const rows = windows[next] as MomentPickRequest['windows'][number];
      next += 1;
      try {
        picks.push(...(await pickWindow(model, request, rows, options.signal)));
      } catch (error) {
        if (options.signal?.aborted) throw normaliseRunError(error, options.signal);
        failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, windows.length) }, worker));

  if (failed * 2 > windows.length) {
    throw providerError('unavailable', { message: 'Most of the transcript could not be read.' });
  }
  return { picks, windows: windows.length, failed };
}

/** A title as kept: no quotes, hashtags or numbering, at most eight words. */
export function cleanTitle(raw: string): string {
  const words = stripMarkup(raw)
    .replace(/^\s*\d+[.)]\s+/, '')
    .replace(/#[\p{L}\p{N}_]+/gu, ' ')
    .replace(/["“”«»]/g, '')
    .replace(/\p{Cc}+/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, TITLE_MAX_WORDS);
  return words
    .join(' ')
    .replace(/^['‘’]+|['‘’]+$/g, '')
    .slice(0, 120);
}

export async function writeTitles(
  model: ModelClient,
  request: TitleRequest,
  options: { signal?: AbortSignal } = {},
): Promise<string[]> {
  const out: string[] = [];
  for (let at = 0; at < request.moments.length; at += TITLE_BATCH) {
    const moments = request.moments.slice(at, at + TITLE_BATCH).map((text) => oneLine(text, 600));
    const prompt = buildTitlePrompt({ moments, language: request.language });
    let titles: string[] = [];
    try {
      ({ titles } = await model.structured({
        schema: momentTitlesSchema,
        ...prompt,
        signal: options.signal,
      }));
    } catch (error) {
      throw normaliseRunError(error, options.signal);
    }
    // A short answer leaves the rest untitled; a title is never shifted onto another moment.
    for (let k = 0; k < moments.length; k += 1) {
      out.push(titles.length === moments.length ? cleanTitle(titles[k] ?? '') : '');
    }
  }
  return out;
}
