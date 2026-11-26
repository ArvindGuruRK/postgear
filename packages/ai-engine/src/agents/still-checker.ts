/**
 * The still-picture checker (Sprint 13 Clips AI, Module 06).
 *
 * One structured call per burst of movement, with its four stills and two
 * facts (where it is and whether the sound rose), a few at a time, each with
 * its own deadline. The model answers closed questions (`prompts/stills.ts`);
 * here the answer is cleaned and judged:
 *
 * - "nothing", `isMoment: false`, or less sure than `minSure`: not notable,
 *   and the caller drops the burst;
 * - otherwise notable, with one cleaned sentence of at most 15 words.
 *
 * A call that fails answers `null` for its burst (the caller treats it as
 * unchecked); only a cancel stops the whole run. Pictures, prompts and
 * answers are never logged.
 */
import { normaliseRunError, withTimeout } from '../model/resilience';
import {
  buildStillPrompt,
  STILL_LINE_MAX_WORDS,
  STILLS_PER_CHECK,
  stillVerdictSchema,
} from '../prompts/stills';
import type { ModelClient, StillCheckBurst, StillCheckRequest, StillVerdict } from '../types';

/** Bursts checked at once. */
export const STILL_CONCURRENCY = 3;
/** One burst's deadline. */
export const STILL_TIMEOUT_MS = 45_000;
/** Below this the model is unsure, and the burst is not notable. */
export const STILL_MIN_SURE = 0.6;

/** One sentence as kept: one line, at most 15 words, ending in a full stop. */
export function cleanStillLine(raw: string): string {
  const words = raw
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/["“”«»<>]/g, '')
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, STILL_LINE_MAX_WORDS);
  if (words.length === 0) return '';
  let line = words.join(' ').slice(0, 160);
  line = `${line.charAt(0).toUpperCase()}${line.slice(1)}`;
  return /[.!?]$/.test(line) ? line : `${line.replace(/[,;:]+$/, '')}.`;
}

/** The answer judged: notable only when it says so, names a kind and is sure enough. */
export function judgeStillAnswer(answer: {
  isMoment: boolean;
  kind: StillVerdict['kind'];
  sure: number;
  line: string;
}): StillVerdict {
  const sure = Number.isFinite(answer.sure) ? Math.min(1, Math.max(0, answer.sure)) : 0;
  const line = cleanStillLine(answer.line);
  const notable =
    answer.isMoment && answer.kind !== 'nothing' && sure >= STILL_MIN_SURE && line.length > 0;
  return { notable, kind: notable ? answer.kind : 'nothing', sure, line: notable ? line : '' };
}

async function checkOne(
  model: ModelClient,
  burst: StillCheckBurst,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<StillVerdict> {
  const prompt = buildStillPrompt({
    momentSec: burst.momentSec,
    spanSec: burst.spanSec,
    withSound: burst.withSound,
  });
  const answer = await withTimeout(
    model.structured({
      schema: stillVerdictSchema,
      ...prompt,
      images: burst.images.slice(0, STILLS_PER_CHECK),
      signal,
    }),
    timeoutMs,
    signal,
  );
  return judgeStillAnswer(answer);
}

export async function checkStills(
  model: ModelClient,
  request: StillCheckRequest,
  options: { signal?: AbortSignal } = {},
): Promise<Array<StillVerdict | null>> {
  const out: Array<StillVerdict | null> = request.bursts.map(() => null);
  let next = 0;
  const concurrency = Math.max(1, request.concurrency ?? STILL_CONCURRENCY);
  const timeoutMs = request.timeoutMs ?? STILL_TIMEOUT_MS;

  const worker = async () => {
    while (next < request.bursts.length) {
      const index = next;
      next += 1;
      const burst = request.bursts[index] as StillCheckBurst;
      if (burst.images.length === 0) continue;
      try {
        out[index] = await checkOne(model, burst, timeoutMs, options.signal);
      } catch (error) {
        if (options.signal?.aborted) throw normaliseRunError(error, options.signal);
        out[index] = null;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, request.bursts.length) }, worker));
  return out;
}
