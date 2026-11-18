/**
 * Reads our error code off a failed waiting-caller workflow (the probe and
 * the channel list).
 *
 * The worker's activity throws an `ApplicationFailure` whose `details[0]` is
 * `{ code, platform? }`. Depending on whether the workflow rethrows the
 * activity's failure or its cause, `SchedulingService.runClipQuery` hands us
 * an `ActivityFailure` wrapping it, or the `ApplicationFailure` itself (it
 * already unwrapped the outer `WorkflowFailedError`). So the chain is walked
 * a few `cause` links deep, by shape rather than by class, and the first
 * well-formed code wins. Anything else (a timeout, a termination, a shape we
 * do not know) reads as `tool_failed`, whose sentence never repeats a tool's
 * text.
 */
import { CLIP_PLATFORMS, type ClipPlatformId } from '@postgear/video-engine';

export interface WorkflowFailureCode {
  code: string;
  platform?: ClipPlatformId;
}

/** Our codes are short snake_case words; anything else is not ours. */
const CODE = /^[a-z][a-z0-9_]{1,63}$/;
const MAX_DEPTH = 6;

function isPlatform(value: unknown): value is ClipPlatformId {
  return typeof value === 'string' && (CLIP_PLATFORMS as readonly string[]).includes(value);
}

/** `{ code, platform? }` from one failure's `details[0]`, if it has one. */
function codeIn(value: unknown): WorkflowFailureCode | null {
  if (typeof value !== 'object' || value === null) return null;
  const details = (value as { details?: unknown }).details;
  if (!Array.isArray(details) || details.length === 0) return null;
  const first = details[0] as { code?: unknown; platform?: unknown } | null;
  if (typeof first !== 'object' || first === null) return null;
  if (typeof first.code !== 'string' || !CODE.test(first.code)) return null;
  return isPlatform(first.platform)
    ? { code: first.code, platform: first.platform }
    : { code: first.code };
}

/** The code a failed workflow carries, or `tool_failed` when it carries none. */
export function workflowFailureCode(error: unknown): WorkflowFailureCode {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_DEPTH && current !== undefined && current !== null; depth++) {
    const found = codeIn(current);
    if (found) return found;
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : undefined;
  }
  return { code: 'tool_failed' };
}
