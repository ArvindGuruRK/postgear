/**
 * Server-sent events on a `@Post()` route.
 *
 * ## Why not Nest's `@Sse()`
 *
 * Nest's decorator only answers `GET`, and an AI generation needs a body — a
 * topic, a tone, a list of channels, a conversation — that no sane client puts
 * in a query string. So the handlers take `@Req()`/`@Res()` and write the
 * stream by hand through this helper, which is the one place the wire format
 * lives: `event: <type>\ndata: <json>\n\n` per event and `: ping\n\n` as a
 * heartbeat, exactly what `apps/web/src/lib/sse.ts` parses.
 *
 * ## The two things a streaming route must get right
 *
 * - **Disconnects must stop the work.** A person who closes the tab halfway
 *   through a generation would otherwise keep paying for model calls that
 *   nobody will read. The request's `close` event aborts `signal`, and every
 *   engine call takes that signal.
 * - **Errors after the first byte cannot become HTTP errors.** The status and
 *   headers are already sent, so the global exception filter cannot help; a
 *   failure mid-stream is reported as an `error` *event*, never as a dropped
 *   socket the client has to guess at. That is the caller's job — this helper
 *   only guarantees that `send` and `close` are safe to call at any time,
 *   including after the client has gone.
 *
 * The heartbeat keeps proxies and load balancers from closing an idle
 * connection while a slow stage runs; a comment line is invisible to the
 * event parser, so it carries no meaning the client has to handle.
 */
import type { Request, Response } from 'express';

/** How often a comment is written while nothing else is. */
export const SSE_HEARTBEAT_MS = 15_000;

export interface SseStream {
  /** Writes one event. A no-op once the stream is closed, whoever closed it. */
  send(type: string, data: unknown): void;
  /** Ends the response. Idempotent. */
  close(): void;
  /** Aborted when the client disconnects before `close()` is called. */
  readonly signal: AbortSignal;
  /** True once the response has ended, by `close()` or by the client. */
  readonly closed: boolean;
}

/** The subset of an Express request/response this helper touches — what a test fakes. */
export type SseRequest = Pick<Request, 'on'>;
export type SseResponse = Pick<
  Response,
  'status' | 'setHeader' | 'flushHeaders' | 'write' | 'end' | 'writableEnded'
>;

export function openSseStream(
  request: SseRequest,
  response: SseResponse,
  options: { heartbeatMs?: number } = {},
): SseStream {
  const controller = new AbortController();
  let closed = false;

  response.status(200);
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  // Tells nginx not to buffer the response, which would turn a stream of
  // progress into one lump delivered at the end.
  response.setHeader('X-Accel-Buffering', 'no');
  response.flushHeaders();

  const heartbeat = setInterval(() => {
    if (!closed) {
      response.write(': ping\n\n');
    }
  }, options.heartbeatMs ?? SSE_HEARTBEAT_MS);
  // A timer must never keep the process alive on its own.
  heartbeat.unref();

  const finish = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    clearInterval(heartbeat);
    if (!response.writableEnded) {
      response.end();
    }
  };

  // Node emits `close` on the request when the socket drops *and* after a
  // response completes normally, so the abort is gated on whether we were the
  // ones who ended it.
  request.on('close', () => {
    if (!closed) {
      finish();
      controller.abort();
    }
  });

  return {
    send(type, data) {
      if (closed) {
        return;
      }
      response.write(`event: ${sanitizeEventType(type)}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    close: finish,
    signal: controller.signal,
    get closed() {
      return closed;
    },
  };
}

/**
 * An event name is a protocol token, not content. A newline inside one would
 * let a value end the frame early and forge the next line, so the characters
 * that structure the protocol are the only ones refused.
 */
function sanitizeEventType(type: string): string {
  return type.replace(/[\r\n:]/g, '');
}
