/**
 * The failure chokepoint: every crawl kind, every model kind, an abort and
 * the API's own HTTP exceptions map to a wire kind and a catalogue message,
 * and nothing a site or a provider said ever comes through.
 */
import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { AI_MESSAGES } from '../ai/ai.messages';
import { PaymentRequiredException } from '../ai/credits/credits.service';
import { describeSeoFailure, isCrawlError } from './seo.errors';
import { SEO_MESSAGES } from './seo.messages';

const PAGE_TEXT = 'Internal server error at 10.0.0.7: token sk-abcdef leaked';

function crawlError(kind: string, retryable: boolean, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(PAGE_TEXT), { name: 'SeoCrawlError', kind, retryable, ...extra });
}

function aiError(kind: string, retryable: boolean) {
  return Object.assign(new Error(PAGE_TEXT), { name: 'AiProviderError', kind, retryable });
}

describe('isCrawlError', () => {
  it('recognises the engine’s error by shape, not by class', () => {
    expect(isCrawlError(crawlError('timeout', true))).toBe(true);
    expect(isCrawlError(aiError('timeout', true))).toBe(false);
    expect(isCrawlError(crawlError('made_up', true))).toBe(false);
    expect(isCrawlError(new Error('x'))).toBe(false);
    expect(isCrawlError(null)).toBe(false);
  });
});

describe('describeSeoFailure', () => {
  it.each([
    ['unreachable', 'unreachable', SEO_MESSAGES.UNREACHABLE, true],
    ['timeout', 'timeout', SEO_MESSAGES.TIMEOUT, true],
    ['blocked', 'blocked', SEO_MESSAGES.BLOCKED, false],
    ['bad_status', 'unreachable', SEO_MESSAGES.BAD_STATUS, false],
    ['not_html', 'not_html', SEO_MESSAGES.NOT_HTML, false],
    ['too_large', 'too_large', SEO_MESSAGES.TOO_LARGE, false],
    ['browser_unavailable', 'unexpected', SEO_MESSAGES.BROWSER_UNAVAILABLE, false],
    ['unsafe_url', 'unsafe_url', SEO_MESSAGES.INVALID_URL, false],
    ['aborted', 'aborted', SEO_MESSAGES.ABORTED, false],
  ])('maps the crawl kind %s to %s', (kind, wire, message, retryable) => {
    const described = describeSeoFailure(crawlError(kind, retryable));
    expect(described).toEqual({ kind: wire, message, retryable });
    expect(described.message).not.toContain('10.0.0.7');
  });

  it('maps model failures: timeout and abort keep their name, the rest are unexpected', () => {
    expect(describeSeoFailure(aiError('timeout', true))).toEqual({
      kind: 'timeout',
      message: AI_MESSAGES.TIMEOUT,
      retryable: true,
    });
    expect(describeSeoFailure(aiError('aborted', false)).kind).toBe('aborted');
    expect(describeSeoFailure(aiError('rate_limited', true))).toEqual({
      kind: 'unexpected',
      message: AI_MESSAGES.RATE_LIMITED,
      retryable: true,
    });
    expect(describeSeoFailure(aiError('bad_output', false)).message).toBe(AI_MESSAGES.BAD_OUTPUT);
  });

  it('treats an AbortError as a stop', () => {
    const abort = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    expect(describeSeoFailure(abort)).toEqual({
      kind: 'aborted',
      message: SEO_MESSAGES.ABORTED,
      retryable: false,
    });
  });

  it('forwards the API’s own HTTP messages with the kind their status implies', () => {
    expect(describeSeoFailure(new PaymentRequiredException('No credits left.'))).toEqual({
      kind: 'out_of_credits',
      message: 'No credits left.',
      retryable: false,
    });
    expect(
      describeSeoFailure(new HttpException(SEO_MESSAGES.BUSY, HttpStatus.TOO_MANY_REQUESTS)),
    ).toEqual({ kind: 'busy', message: SEO_MESSAGES.BUSY, retryable: true });
    expect(describeSeoFailure(new BadRequestException(SEO_MESSAGES.INVALID_URL))).toEqual({
      kind: 'unexpected',
      message: SEO_MESSAGES.INVALID_URL,
      retryable: false,
    });
  });

  it('hides everything else behind the generic message', () => {
    expect(describeSeoFailure(new Error(PAGE_TEXT))).toEqual({
      kind: 'unexpected',
      message: SEO_MESSAGES.UNEXPECTED,
      retryable: true,
    });
    expect(describeSeoFailure('a string').message).toBe(SEO_MESSAGES.UNEXPECTED);
    expect(describeSeoFailure(undefined).kind).toBe('unexpected');
  });
});
