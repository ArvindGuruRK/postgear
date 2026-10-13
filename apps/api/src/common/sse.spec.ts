/**
 * The SSE wire format and its two safety properties: a disconnect aborts the
 * signal, and nothing is written after the stream has ended, whoever ended it.
 */
import { EventEmitter } from 'node:events';
import { openSseStream, type SseRequest, type SseResponse } from './sse';

function fakeResponse() {
  const chunks: string[] = [];
  const headers = new Map<string, string>();
  const response = {
    statusCode: 0,
    writableEnded: false,
    status: jest.fn(function (this: { statusCode: number }, code: number) {
      this.statusCode = code;
      return this;
    }),
    setHeader: jest.fn((name: string, value: string) => {
      headers.set(name, value);
    }),
    flushHeaders: jest.fn(),
    write: jest.fn((chunk: string) => {
      chunks.push(chunk);
      return true;
    }),
    end: jest.fn(function (this: { writableEnded: boolean }) {
      this.writableEnded = true;
    }),
  };

  return { response: response as unknown as SseResponse, raw: response, chunks, headers };
}

function fakeRequest() {
  const emitter = new EventEmitter();
  return { request: emitter as unknown as SseRequest, emitter };
}

describe('openSseStream', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sends the stream headers before any event and flushes them at once', () => {
    const { response, raw, headers } = fakeResponse();
    const { request } = fakeRequest();

    openSseStream(request, response);

    expect(raw.statusCode).toBe(200);
    expect(headers.get('Content-Type')).toBe('text/event-stream; charset=utf-8');
    expect(headers.get('Cache-Control')).toBe('no-cache, no-transform');
    expect(headers.get('Connection')).toBe('keep-alive');
    expect(headers.get('X-Accel-Buffering')).toBe('no');
    expect(raw.flushHeaders).toHaveBeenCalledTimes(1);
    expect(raw.write).not.toHaveBeenCalled();
  });

  it('writes one frame per event: an event line, a JSON data line, a blank line', () => {
    const { response, chunks } = fakeResponse();
    const { request } = fakeRequest();
    const stream = openSseStream(request, response);

    stream.send('stage', { stage: 'research', status: 'started' });
    stream.send('token', { text: 'multi\nline' });

    expect(chunks).toEqual([
      'event: stage\ndata: {"stage":"research","status":"started"}\n\n',
      'event: token\ndata: {"text":"multi\\nline"}\n\n',
    ]);
  });

  it('keeps protocol characters out of the event name', () => {
    const { response, chunks } = fakeResponse();
    const { request } = fakeRequest();
    const stream = openSseStream(request, response);

    stream.send('done\ndata: forged', 1);

    expect(chunks[0]).toBe('event: donedata forged\ndata: 1\n\n');
  });

  it('writes a comment heartbeat on the interval and stops it on close', () => {
    const { response, raw, chunks } = fakeResponse();
    const { request } = fakeRequest();
    const stream = openSseStream(request, response, { heartbeatMs: 1_000 });

    jest.advanceTimersByTime(2_500);
    expect(chunks).toEqual([': ping\n\n', ': ping\n\n']);

    stream.close();
    jest.advanceTimersByTime(5_000);

    expect(chunks).toHaveLength(2);
    expect(raw.end).toHaveBeenCalledTimes(1);
    expect(stream.closed).toBe(true);
  });

  it('aborts the signal when the client disconnects, and drops later events', () => {
    const { response, raw, chunks } = fakeResponse();
    const { request, emitter } = fakeRequest();
    const stream = openSseStream(request, response);
    const onAbort = jest.fn();
    stream.signal.addEventListener('abort', onAbort);

    emitter.emit('close');

    expect(stream.signal.aborted).toBe(true);
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(stream.closed).toBe(true);

    stream.send('done', {});
    stream.close();

    expect(chunks).toHaveLength(0);
    expect(raw.end).toHaveBeenCalledTimes(1);
  });

  it('does not abort when the close event follows a normal end', () => {
    const { response } = fakeResponse();
    const { request, emitter } = fakeRequest();
    const stream = openSseStream(request, response);

    stream.send('done', {});
    stream.close();
    // Node fires `close` on the request after the response finishes, too.
    emitter.emit('close');

    expect(stream.signal.aborted).toBe(false);
  });

  it('is safe to close twice', () => {
    const { response, raw } = fakeResponse();
    const { request } = fakeRequest();
    const stream = openSseStream(request, response);

    stream.close();
    stream.close();

    expect(raw.end).toHaveBeenCalledTimes(1);
  });
});
