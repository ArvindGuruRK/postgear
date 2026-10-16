/**
 * @jest-environment node
 *
 * The GET event-stream client against the API's wire format: `onOpen` fires
 * once the stream is live, frames arrive typed and parsed, a non-2xx before
 * the stream throws the API's message, and an abort rejects as an abort.
 */
import { ApiError } from '@/lib/api';
import { type EventStreamFrame, isAbortError, openEventStream } from './event-stream';

function streamOf(chunks: string[], onPull?: () => void): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      onPull?.();
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index++]));
      } else {
        controller.close();
      }
    },
  });
}

describe('openEventStream', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('requests the path with credentials, reports open, and delivers parsed frames', async () => {
    const fetchMock = jest.fn(async () =>
      new Response(
        streamOf([
          'event: ready\ndata: {"unread":2}\n\n: ping\n\nevent: notif',
          'ication\ndata: {"notification":{"id":"n1"},"unread":3}\n\n',
        ]),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const frames: EventStreamFrame[] = [];
    const opened = jest.fn();

    await openEventStream('/notifications/stream', { onOpen: opened, onEvent: (f) => frames.push(f) });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/notifications/stream',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'text/event-stream' },
      }),
    );
    expect(opened).toHaveBeenCalledTimes(1);
    expect(frames).toEqual([
      { type: 'ready', data: { unread: 2 } },
      { type: 'notification', data: { notification: { id: 'n1' }, unread: 3 } },
    ]);
  });

  it('throws the API message on a non-2xx and never reports open', async () => {
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ error: 'No active workspace', statusCode: 403 }), {
        status: 403,
      }),
    ) as unknown as typeof fetch;
    const opened = jest.fn();

    await expect(
      openEventStream('/notifications/stream', { onOpen: opened, onEvent: () => undefined }),
    ).rejects.toEqual(new ApiError('No active workspace', 403));
    expect(opened).not.toHaveBeenCalled();
  });

  it('drops a frame whose data is not JSON and one without an event name', async () => {
    global.fetch = jest.fn(async () =>
      new Response(streamOf(['event: ready\ndata: not json\n\ndata: {"a":1}\n\nevent: ok\ndata: {}\n\n']), {
        status: 200,
      }),
    ) as unknown as typeof fetch;
    const frames: EventStreamFrame[] = [];

    await openEventStream('/x', { onEvent: (f) => frames.push(f) });

    expect(frames).toEqual([{ type: 'ok', data: {} }]);
  });

  it('rejects with an abort error when the signal fires mid-stream', async () => {
    const controller = new AbortController();
    let pulls = 0;
    global.fetch = jest.fn(async (_url: string, init: RequestInit) => {
      const body = streamOf(['event: ready\ndata: {}\n\n', 'event: never\ndata: {}\n\n'], () => {
        pulls += 1;
        if (pulls === 2) {
          controller.abort();
          // Node's fetch is not what cancels this hand-made stream; mimic the body erroring.
          throw new DOMException('The operation was aborted.', 'AbortError');
        }
      });
      init.signal?.addEventListener('abort', () => undefined);
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;

    const frames: EventStreamFrame[] = [];
    let caught: unknown;
    try {
      await openEventStream('/x', {
        signal: controller.signal,
        onEvent: (f) => frames.push(f),
      });
    } catch (error) {
      caught = error;
    }

    expect(frames).toEqual([{ type: 'ready', data: {} }]);
    expect(isAbortError(caught)).toBe(true);
  });
});
