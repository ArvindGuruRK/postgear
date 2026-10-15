/**
 * What a failure becomes on the wire.
 *
 * Every error that reaches the stream passes through `describeSeoFailure`,
 * which maps it to a kind, a catalogue message and a retryable flag — and
 * nothing else. The original goes to the caller's logger. This is the single
 * chokepoint that keeps page text, provider error bodies and key fragments
 * out of responses; the analyzer has three sources of such text (the crawled
 * site, the authority provider, the model), which is three reasons to have
 * exactly one chokepoint.
 *
 * Both engines' errors are recognised by shape rather than `instanceof`, as
 * `ai.errors.ts` does: the classes live in packages whose runtime this file
 * — and the service spec that depends on it — need not load.
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import type { AiErrorKind } from '@postgear/ai-engine';
import type { CrawlErrorKind } from '@postgear/seo-engine';
import { isAbortError, isEngineError } from '../ai/ai.errors';
import { messageForKind } from '../ai/ai.messages';
import { messageForCrawlKind, SEO_MESSAGES } from './seo.messages';
import type { SeoErrorKind } from './seo.types';

export interface DescribedSeoFailure {
  kind: SeoErrorKind;
  message: string;
  retryable: boolean;
}

const CRAWL_KINDS: ReadonlySet<string> = new Set<CrawlErrorKind>([
  'unsafe_url',
  'unreachable',
  'timeout',
  'blocked',
  'bad_status',
  'not_html',
  'too_large',
  'browser_unavailable',
  'aborted',
]);

interface CrawlErrorShape {
  kind: CrawlErrorKind;
  retryable: boolean;
}

export function isCrawlError(error: unknown): error is Error & CrawlErrorShape {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as Partial<CrawlErrorShape> & { name?: unknown };
  return (
    candidate.name === 'SeoCrawlError' &&
    typeof candidate.kind === 'string' &&
    CRAWL_KINDS.has(candidate.kind) &&
    typeof candidate.retryable === 'boolean'
  );
}

/** The wire kind for a crawl kind: the two the browser does not distinguish fold into neighbours. */
function wireKindForCrawl(kind: CrawlErrorKind): SeoErrorKind {
  switch (kind) {
    case 'bad_status':
      return 'unreachable';
    case 'browser_unavailable':
      return 'unexpected';
    default:
      return kind;
  }
}

/** The wire kind for a model failure: only a timeout and an abort keep their name. */
function wireKindForAi(kind: AiErrorKind): SeoErrorKind {
  switch (kind) {
    case 'timeout':
      return 'timeout';
    case 'aborted':
      return 'aborted';
    default:
      return 'unexpected';
  }
}

export function describeSeoFailure(error: unknown): DescribedSeoFailure {
  if (isCrawlError(error)) {
    return {
      kind: wireKindForCrawl(error.kind),
      message: messageForCrawlKind(error.kind),
      retryable: error.retryable,
    };
  }

  if (isEngineError(error)) {
    return {
      kind: wireKindForAi(error.kind),
      message: messageForKind(error.kind),
      retryable: error.retryable,
    };
  }

  if (isAbortError(error)) {
    return { kind: 'aborted', message: SEO_MESSAGES.ABORTED, retryable: false };
  }

  // Messages this API wrote itself (a 402 from the credits service, a 429
  // from the gate) are already safe to show, and their status says the kind.
  if (error instanceof HttpException) {
    const status = error.getStatus();
    const body = error.getResponse();
    const message =
      typeof body === 'string'
        ? body
        : typeof (body as { message?: unknown }).message === 'string'
          ? (body as { message: string }).message
          : SEO_MESSAGES.UNEXPECTED;
    const kind: SeoErrorKind =
      status === HttpStatus.PAYMENT_REQUIRED
        ? 'out_of_credits'
        : status === HttpStatus.TOO_MANY_REQUESTS
          ? 'busy'
          : 'unexpected';
    return { kind, message, retryable: kind === 'busy' };
  }

  return { kind: 'unexpected', message: SEO_MESSAGES.UNEXPECTED, retryable: true };
}
