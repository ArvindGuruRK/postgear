/**
 * What a failure becomes on the wire.
 *
 * Every error that reaches a stream or a tool result passes through
 * `describeFailure`, which maps it to a kind, a catalogue message and a
 * retryable flag, and nothing else. The original, with the provider's own
 * text, goes to the caller's logger. This is the single chokepoint that keeps
 * provider error bodies and key fragments out of responses.
 *
 * Engine errors are recognised by shape rather than by `instanceof`: the
 * class lives in `@postgear/ai-engine`, and a structural check keeps this
 * file, and the service and tool tests that depend on it, independent of
 * the engine's runtime.
 */
import { HttpException } from '@nestjs/common';
import type { AiErrorKind } from '@postgear/ai-engine';
import { AI_MESSAGES, messageForKind } from './ai.messages';

/** The engine's kinds, plus the two only the API can produce. */
export type StreamErrorKind = AiErrorKind | 'out_of_credits' | 'unexpected';

export interface DescribedFailure {
  kind: StreamErrorKind;
  message: string;
  retryable: boolean;
}

const ENGINE_KINDS: ReadonlySet<string> = new Set<AiErrorKind>([
  'not_configured',
  'invalid_key',
  'rate_limited',
  'unavailable',
  'timeout',
  'bad_output',
  'content_policy',
  'aborted',
]);

interface EngineErrorShape {
  kind: AiErrorKind;
  retryable: boolean;
}

export function isEngineError(error: unknown): error is Error & EngineErrorShape {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as Partial<EngineErrorShape>;
  return (
    typeof candidate.kind === 'string' &&
    ENGINE_KINDS.has(candidate.kind) &&
    typeof candidate.retryable === 'boolean'
  );
}

/**
 * By name, not by class: an `AbortSignal`'s reason is a `DOMException`, which
 * is not an `Error` in every realm (jest's vm context among them).
 */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

/**
 * A tool's failure, worded for the model and the person reading the chat.
 * Thrown by the copilot tools; the engine turns it into `tool_result ok:false`.
 */
export class CopilotToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CopilotToolError';
  }
}

export function describeFailure(error: unknown): DescribedFailure {
  if (isEngineError(error)) {
    return {
      kind: error.kind,
      message: messageForKind(error.kind),
      retryable: error.retryable,
    };
  }

  if (isAbortError(error)) {
    return { kind: 'aborted', message: AI_MESSAGES.ABORTED, retryable: false };
  }

  // Messages this API wrote itself (a tool refusing a foreign channel, the
  // posts service refusing an attachment) are already safe to show.
  if (error instanceof CopilotToolError) {
    return { kind: 'unexpected', message: error.message, retryable: false };
  }

  if (error instanceof HttpException) {
    const body = error.getResponse();
    const message =
      typeof body === 'string'
        ? body
        : typeof (body as { message?: unknown }).message === 'string'
          ? (body as { message: string }).message
          : AI_MESSAGES.UNEXPECTED;
    return { kind: 'unexpected', message, retryable: false };
  }

  return { kind: 'unexpected', message: AI_MESSAGES.UNEXPECTED, retryable: true };
}
