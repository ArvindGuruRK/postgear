/**
 * Server-sent events over a POST, for the AI endpoints (Sprint 6).
 *
 * ## Why not `EventSource`
 *
 * The browser's `EventSource` only speaks GET, and a generation request is a
 * body (topic, tone, channels) not a query string. So this is `fetch` with
 * the response body read as it arrives, and the SSE wire format parsed by
 * hand. The format is small (`event:` and `data:` lines, blank-line
 * delimited, `:` comments for the API's heartbeat) and the parser below is
 * the whole of it.
 *
 * ## The two kinds of failure
 *
 * A failure *before* the stream opens (402 out of credits, 422 a channel
 * that cannot be used, 503 not configured) arrives as an ordinary JSON error,
 * and is thrown as the same `ApiError` the rest of the app shows. A failure
 * *after* the stream opens arrives as an `error` event, because the status
 * line has already been sent; the caller sees it through `onEvent` like any
 * other event, and the promise still resolves when the stream ends.
 *
 * Aborting the signal closes the connection, which the API treats as "stop
 * the engine run"; the promise then rejects with the `AbortError`.
 */
import { ApiError, BROWSER_API_URL } from './api';

export interface SseFrame {
  /** The `event:` field, or null when the frame had none. */
  event: string | null;
  /** The `data:` lines, joined with `\n` as the specification says. */
  data: string;
}

/**
 * An incremental parser: feed it text as it arrives, and it calls back with
 * each complete frame. A frame split across two chunks (the usual case, since
 * chunk boundaries fall wherever the network puts them) is held until its
 * closing blank line arrives.
 */
export function createSseParser(onFrame: (frame: SseFrame) => void): {
  feed(chunk: string): void;
  /** Delivers a final frame the stream closed without terminating. */
  end(): void;
} {
  let buffer = '';

  const emit = (raw: string) => {
    let event: string | null = null;
    const data: string[] = [];

    for (const line of raw.split('\n')) {
      // The API's heartbeat is `: ping`; the specification says ignore it.
      if (line.startsWith(':') || line.length === 0) {
        continue;
      }

      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      // One optional space after the colon is part of the delimiter, not the value.
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');

      if (field === 'event') {
        event = value;
      } else if (field === 'data') {
        data.push(value);
      }
      // `id` and `retry` are legal fields this client has no use for.
    }

    if (event !== null || data.length > 0) {
      onFrame({ event, data: data.join('\n') });
    }
  };

  return {
    feed(chunk) {
      // CRLF is normalized once here so the frame splitting only has to know `\n`.
      buffer += chunk.replace(/\r\n?/g, '\n');

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        emit(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');
      }
    },
    end() {
      if (buffer.trim().length > 0) {
        emit(buffer);
      }
      buffer = '';
    },
  };
}

export interface StreamOptions<T> {
  signal?: AbortSignal;
  onEvent: (event: T) => void;
}

/**
 * Posts `body` to `path` and delivers each streamed event to `onEvent`.
 *
 * The event's type is the `event:` field, falling back to a `type` in the
 * JSON; the API sends both, identical. A frame whose data is not JSON is
 * dropped rather than thrown: one malformed heartbeat must not end a
 * generation that is otherwise going fine.
 */
export async function streamEvents<T extends { type: string }>(
  path: string,
  body: unknown,
  { signal, onEvent }: StreamOptions<T>,
): Promise<void> {
  const response = await fetch(`${BROWSER_API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    credentials: 'include',
    cache: 'no-store',
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    let message = 'Something went wrong. Please try again.';

    try {
      const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      if (typeof payload.error === 'string') {
        message = payload.error;
      }
    } catch {
      // A proxy's HTML error page; the status still says what happened.
    }

    throw new ApiError(message, response.status);
  }

  if (!response.body) {
    return;
  }

  const parser = createSseParser(({ event, data }) => {
    let parsed: unknown;

    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }

    if (typeof parsed !== 'object' || parsed === null) {
      return;
    }

    const record = parsed as Record<string, unknown>;
    const type = event ?? (typeof record.type === 'string' ? record.type : null);

    if (type) {
      onEvent({ ...record, type } as T);
    }
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { value, done } = await reader.read();

      if (done) {
        break;
      }

      parser.feed(decoder.decode(value, { stream: true }));
    }

    parser.feed(decoder.decode());
    parser.end();
  } catch (cause) {
    // A read on an aborted body rejects with the abort reason in every
    // browser; where it does not, the signal still says what happened.
    if (signal?.aborted) {
      throw abortError(signal);
    }

    throw cause;
  } finally {
    reader.releaseLock();
  }

  // Some runtimes end an aborted body cleanly instead of rejecting the read.
  // An abort is an abort either way; the caller must not take it for "done".
  if (signal?.aborted) {
    throw abortError(signal);
  }
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The request was aborted.', 'AbortError');
}
