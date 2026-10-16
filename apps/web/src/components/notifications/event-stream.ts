/**
 * Server-sent events over a GET, for the notification stream (Sprint 8).
 *
 * `lib/sse.ts` is the POST-shaped client the AI studio needs. The bell has
 * nothing to send, so this is the same parser on a `fetch` GET — still
 * `fetch` rather than the browser's `EventSource`, which cannot be told to
 * stop sending the request's cookies to another origin, reconnects on its
 * own schedule, and gives the caller no way to tell an opened stream from a
 * pending one. Here `onOpen` fires once the headers say the stream is live,
 * which is what resets the reconnect backoff.
 */
import { ApiError, BROWSER_API_URL } from '@/lib/api';
import { createSseParser } from '@/lib/sse';

export interface EventStreamFrame {
  type: string;
  data: unknown;
}

export interface EventStreamOptions {
  signal?: AbortSignal;
  /** The response is a live event stream; events will follow. */
  onOpen?: () => void;
  onEvent: (frame: EventStreamFrame) => void;
}

/**
 * Opens `path` and delivers each frame to `onEvent` until the stream ends.
 * Resolves on a clean end, rejects with an `ApiError` before the stream
 * opens, and with the abort reason when the signal fires.
 */
export async function openEventStream(
  path: string,
  { signal, onOpen, onEvent }: EventStreamOptions,
): Promise<void> {
  const response = await fetch(`${BROWSER_API_URL}${path}`, {
    method: 'GET',
    headers: { Accept: 'text/event-stream' },
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

  onOpen?.();

  const parser = createSseParser(({ event, data }) => {
    if (!event) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }

    onEvent({ type: event, data: parsed });
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
    if (signal?.aborted) {
      throw abortError(signal);
    }
    throw cause;
  } finally {
    reader.releaseLock();
  }

  if (signal?.aborted) {
    throw abortError(signal);
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The request was aborted.', 'AbortError');
}
