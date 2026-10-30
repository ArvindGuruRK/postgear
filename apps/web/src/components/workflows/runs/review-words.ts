/**
 * A Manual Review in words (Module 08, WF-10.1): what was sent for review,
 * when it expires ("Expires in 6 days"), and who answered ("Approved by
 * Priya, 09:14"). Pure, so the copy is unit tested.
 */
import { LIMITS } from '@postgear/automation';
import type { ReviewOutput, RunStep } from '@/types/workflows';

export const REVIEW_STEP_TYPE = 'logic.manualReview';

export function isReviewStep(step: Pick<RunStep, 'nodeType'>): boolean {
  return step.nodeType === REVIEW_STEP_TYPE;
}

export interface ReviewContent {
  text: string;
  /** A link to the image, when the review carries one. */
  image: string | null;
  instructions: string;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** A media value as a link: a URL, or a media object's `url`. */
export function imageUrlOf(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return /^(https?:\/\/|\/)/.test(trimmed) ? trimmed : null;
  }
  if (typeof value === 'object' && value !== null && 'url' in value) {
    return imageUrlOf((value as { url: unknown }).url);
  }
  return null;
}

/** What the reviewer sees: the step's resolved input. */
export function reviewContent(input: unknown): ReviewContent {
  const record =
    typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  return {
    text: textOf(record.text),
    image: imageUrlOf(record.image),
    instructions: textOf(record.instructions),
  };
}

/** The answer, once there is one. */
export function reviewOutputOf(output: unknown): ReviewOutput | null {
  if (typeof output !== 'object' || output === null) return null;
  const decision = (output as { decision?: unknown }).decision;
  return decision === 'approved' || decision === 'rejected' ? (output as ReviewOutput) : null;
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MINUTE = 60_000;

function plural(count: number, one: string): string {
  return `${count} ${one}${count === 1 ? '' : 's'}`;
}

/** The moment the review stops waiting: its start plus the review lifetime. */
export function reviewExpiresAt(startedAt: string | null): number | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  return Number.isFinite(start) ? start + LIMITS.reviewTimeoutDays * DAY : null;
}

/** "Expires in 6 days", "Expires in 3 hours", "Expires in 1 minute". */
export function reviewExpiryText(startedAt: string | null, now: number = Date.now()): string {
  const expires = reviewExpiresAt(startedAt);
  if (expires === null) return `Expires ${LIMITS.reviewTimeoutDays} days after it was sent.`;
  const left = expires - now;
  if (left <= 0) return 'This review has expired.';
  if (left >= DAY) return `Expires in ${plural(Math.floor(left / DAY), 'day')}`;
  if (left >= HOUR) return `Expires in ${plural(Math.floor(left / HOUR), 'hour')}`;
  return `Expires in ${plural(Math.max(1, Math.floor(left / MINUTE)), 'minute')}`;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** "09:14" today, "28 Oct 09:14" on another day (local time). */
export function decidedTime(iso: string | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (date.toDateString() === new Date(now).toDateString()) return time;
  const month = date.toLocaleString('en', { month: 'short' });
  return `${date.getDate()} ${month} ${time}`;
}

/** "Approved by Priya, 09:14", "Rejected, 28 Oct 09:14". */
export function decidedText(
  output: Pick<ReviewOutput, 'decision' | 'reviewedBy' | 'decidedAt'>,
  now: number = Date.now(),
): string {
  const word = output.decision === 'approved' ? 'Approved' : 'Rejected';
  const who = output.reviewedBy ? ` by ${output.reviewedBy}` : '';
  const when = decidedTime(output.decidedAt, now);
  return `${word}${who}${when ? `, ${when}` : ''}`;
}

export const REVIEW_ANSWERED_ELSEWHERE = 'Someone else answered this review first.';
export const REVIEW_CLOSED = 'This review is closed: the run ended before anyone answered.';
