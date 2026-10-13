/**
 * @jest-environment node
 *
 * The SSE client, against the wire format the API writes.
 *
 * Node's environment rather than jsdom: the test needs `ReadableStream`,
 * `TextEncoder` and `Response`, which jsdom does not expose and Node does.
 * `fetch` is replaced per test with a response built from a hand-made stream,
 * so chunk boundaries land exactly where each case wants them.
 */
import { ApiError } from './api';
import { createSseParser, type SseFrame, streamEvents } from './sse';

function collect(): { frames: SseFrame[]; parser: ReturnType<typeof createSseParser> } {
  const frames: SseFrame[] = [];
  return { frames, parser: createSseParser((frame) => frames.push(frame)) };
}

describe('createSseParser', () => {
  it('parses event and data lines, blank-line delimited', () => {
    const { frames, parser } = collect();

    parser.feed('event: stage\ndata: {"a":1}\n\nevent: done\ndata: {}\n\n');

    expect(frames).toEqual([
      { event: 'stage', data: '{"a":1}' },
      { event: 'done', data: '{}' },
    ]);
  });

  it('survives a frame split across chunks, even mid-line', () => {
    const { frames, parser } = collect();

    parser.feed('event: sta');
    parser.feed('ge\nda');
    parser.feed('ta: {"stage":"research"}\n');
    expect(frames).toEqual([]);

    parser.feed('\n');
    expect(frames).toEqual([{ event: 'stage', data: '{"stage":"research"}' }]);
  });

  it('ignores comment lines, including the heartbeat between frames', () => {
    const { frames, parser } = collect();

    parser.feed(': ping\n\n');
    parser.feed(': ping\nevent: token\ndata: {"text":"hi"}\n\n');

    expect(frames).toEqual([{ event: 'token', data: '{"text":"hi"}' }]);
  });

  it('joins multiple data lines with a newline and accepts CRLF', () => {
    const { frames, parser } = collect();

    parser.feed('data: first\r\ndata: second\r\n\r\n');

    expect(frames).toEqual([{ event: null, data: 'first\nsecond' }]);
  });

  it('keeps a value that itself contains a colon', () => {
    const { frames, parser } = collect();

    parser.feed('data: {"url":"https://example.com"}\n\n');

    expect(frames[0].data).toBe('{"url":"https://example.com"}');
  });

  it('delivers a trailing frame the stream closed without terminating', () => {
    const { frames, parser } = collect();

    parser.feed('event: done\ndata: {}');
    expect(frames).toEqual([]);

    parser.end();
    expect(frames).toEqual([{ event: 'done', data: '{}' }]);
  });
});

function streamOf(chunks: string[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
    ...init,
  });
}

describe('streamEvents', () => {
  const fetchSpy = jest.spyOn(globalThis, 'fetch');

  afterAll(() => fetchSpy.mockRestore());

  it('posts JSON with credentials and delivers each event, typed by the event field', async () => {
    fetchSpy.mockResolvedValueOnce(
      streamOf([
        'event: stage\ndata: {"type":"stage","stage":"research","status":"started"}\n\n: ping\n\n',
        'event: do',
        'ne\ndata: {"type":"done","result":{}}\n\n',
      ]),
    );
    const events: { type: string }[] = [];

    await streamEvents('/ai/generate', { topic: 'x' }, { onEvent: (event) => events.push(event) });

    expect(events.map((event) => event.type)).toEqual(['stage', 'done']);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\/ai\/generate$/),
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ topic: 'x' }),
        headers: expect.objectContaining({ Accept: 'text/event-stream' }),
      }),
    );
  });

  it('throws an ApiError built from the JSON body on a non-2xx before streaming', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "You've used this cycle's AI credits." }), {
        status: 402,
      }),
    );

    const failure = await streamEvents('/ai/generate', {}, { onEvent: () => undefined }).then(
      () => null,
      (cause: unknown) => cause,
    );

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 402, message: /AI credits/ });
  });

  it('skips a frame whose data is not JSON and resolves when the stream ends', async () => {
    fetchSpy.mockResolvedValueOnce(
      streamOf(['event: token\ndata: not json\n\nevent: token\ndata: {"text":"ok"}\n\n']),
    );
    const events: { type: string }[] = [];

    await expect(
      streamEvents('/ai/copilot/chat', {}, { onEvent: (event) => events.push(event) }),
    ).resolves.toBeUndefined();
    expect(events).toEqual([{ type: 'token', text: 'ok' }]);
  });

  it('rejects with the AbortError when the signal aborts mid-stream', async () => {
    const controller = new AbortController();
    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const body = new ReadableStream<Uint8Array>({
      start(ctrl) {
        streamController = ctrl;
        ctrl.enqueue(encoder.encode('event: token\ndata: {"text":"a"}\n\n'));
        // Never closes: the only way out is the abort.
      },
    });
    fetchSpy.mockImplementationOnce((_input, init) => {
      const signal = init?.signal;
      // Mimic the browser: an aborted fetch makes the next read reject.
      signal?.addEventListener('abort', () => {
        streamController?.error(new DOMException('The request was aborted.', 'AbortError'));
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    });

    const events: { type: string }[] = [];
    const run = streamEvents(
      '/ai/copilot/chat',
      {},
      {
        signal: controller.signal,
        onEvent: (event) => {
          events.push(event);
          controller.abort();
        },
      },
    );

    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(events).toHaveLength(1);
  });
});
