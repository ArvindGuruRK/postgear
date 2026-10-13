import { AiProviderError } from '../types';
import {
  backoffDelay,
  classifyError,
  normaliseRunError,
  redactSecrets,
  withDeadline,
  withRetry,
  withTimeout,
} from './resilience';

describe('classifyError', () => {
  it('maps provider statuses and codes to kinds', () => {
    expect(classifyError({ status: 401, message: 'Unauthorized' }).kind).toBe('invalid_key');
    expect(classifyError({ status: 403, message: 'Forbidden' }).kind).toBe('invalid_key');
    expect(classifyError({ status: 429, message: 'Too many' }).kind).toBe('rate_limited');
    expect(classifyError({ status: 503, message: 'Bad gateway' }).kind).toBe('unavailable');
    expect(classifyError({ code: 'ECONNRESET', message: 'socket' }).kind).toBe('unavailable');
    expect(classifyError({ code: 'ENOTFOUND', message: 'dns' }).kind).toBe('unavailable');
    expect(classifyError({ name: 'AbortError', message: 'aborted' }).kind).toBe('aborted');
    expect(classifyError({ name: 'APIUserAbortError', message: 'x' }).kind).toBe('aborted');
    expect(classifyError({ name: 'APIConnectionTimeoutError', message: 'x' }).kind).toBe('timeout');
    expect(classifyError({ message: 'Request timed out' }).kind).toBe('timeout');
    expect(
      classifyError({ status: 400, code: 'content_policy_violation', message: 'rejected' }).kind,
    ).toBe('content_policy');
    expect(classifyError({ message: 'blocked by our safety system' }).kind).toBe('content_policy');
    expect(classifyError({ name: 'ZodError', issues: [], message: 'bad' }).kind).toBe('bad_output');
  });

  it('marks only rate limits, outages and timeouts retryable', () => {
    expect(classifyError({ status: 429 }).retryable).toBe(true);
    expect(classifyError({ status: 500 }).retryable).toBe(true);
    expect(classifyError({ name: 'TimeoutError' }).retryable).toBe(true);
    expect(classifyError({ status: 401 }).retryable).toBe(false);
    expect(classifyError({ status: 400, message: 'bad request' }).retryable).toBe(false);
    expect(classifyError(new Error('something odd')).retryable).toBe(false);
    expect(classifyError({ name: 'AbortError' }).retryable).toBe(false);
  });

  it('passes an AiProviderError through unchanged', () => {
    const error = new AiProviderError('content_policy', 'nope', false);
    expect(classifyError(error)).toBe(error);
  });

  it('never keeps a key in the message', () => {
    const error = classifyError({
      status: 500,
      message: 'Request failed with Authorization: Bearer sk-proj-abcdef123456 and tvly-xyz987654',
    });
    expect(error.message).not.toContain('sk-proj-abcdef123456');
    expect(error.message).not.toContain('tvly-xyz987654');
    expect(error.message).toContain('[redacted]');
  });
});

describe('redactSecrets', () => {
  it('redacts OpenAI and Tavily keys and bearer tokens', () => {
    expect(redactSecrets('key sk-abcdefgh1234 here')).toBe('key sk-[redacted] here');
    expect(redactSecrets('tvly-abcdefgh')).toBe('tvly-[redacted]');
    expect(redactSecrets('Bearer abc.def-ghi')).toBe('Bearer [redacted]');
    expect(redactSecrets('nothing to see')).toBe('nothing to see');
  });
});

describe('backoffDelay', () => {
  it('doubles with equal jitter and caps at the maximum', () => {
    expect(backoffDelay(1, 500, 8_000, () => 0)).toBe(250);
    expect(backoffDelay(1, 500, 8_000, () => 1)).toBe(500);
    expect(backoffDelay(2, 500, 8_000, () => 0)).toBe(500);
    expect(backoffDelay(3, 500, 8_000, () => 1)).toBe(2_000);
    expect(backoffDelay(10, 500, 8_000, () => 1)).toBe(8_000);
  });
});

describe('withRetry', () => {
  it('retries a 429 and then succeeds', async () => {
    const sleep = jest.fn<Promise<void>, [number, AbortSignal | undefined]>(async () => undefined);
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw { status: 429, message: 'rate limited' };
        return 'ok';
      },
      { attempts: 3, baseMs: 100, sleep, random: () => 0.5 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[0][0]).toBe(75);
    expect(sleep.mock.calls[1][0]).toBe(150);
  });

  it('does not retry a 401', async () => {
    const sleep = jest.fn<Promise<void>, [number, AbortSignal | undefined]>(async () => undefined);
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw { status: 401, message: 'bad key' };
        },
        { attempts: 3, sleep },
      ),
    ).rejects.toMatchObject({ kind: 'invalid_key', retryable: false });
    expect(calls).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('gives up after the last attempt with the classified error', async () => {
    const sleep = jest.fn<Promise<void>, [number, AbortSignal | undefined]>(async () => undefined);
    await expect(
      withRetry(
        async () => {
          throw { status: 503, message: 'down' };
        },
        { attempts: 3, sleep },
      ),
    ).rejects.toMatchObject({ kind: 'unavailable', retryable: true });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('uses real timers for the backoff and respects abort while waiting', async () => {
    jest.useFakeTimers();
    try {
      const controller = new AbortController();
      let calls = 0;
      const promise = withRetry(
        async () => {
          calls += 1;
          throw { status: 429 };
        },
        { attempts: 3, baseMs: 1_000, signal: controller.signal, random: () => 1 },
      );
      const settled = promise.catch((error: unknown) => error);
      await jest.advanceTimersByTimeAsync(10);
      controller.abort();
      const error = await settled;
      expect(error).toMatchObject({ kind: 'aborted' });
      expect(calls).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('refuses to start when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = jest.fn(async () => 'never');
    await expect(withRetry(fn, { signal: controller.signal })).rejects.toMatchObject({
      kind: 'aborted',
    });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('withTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('rejects with timeout when the promise is slow', async () => {
    const never = new Promise<string>(() => undefined);
    const settled = withTimeout(never, 1_000).catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(await settled).toMatchObject({ kind: 'timeout', retryable: true });
  });

  it('resolves when the promise is fast', async () => {
    await expect(withTimeout(Promise.resolve(42), 1_000)).resolves.toBe(42);
  });

  it('rejects with aborted when the signal fires first', async () => {
    const controller = new AbortController();
    const never = new Promise<string>(() => undefined);
    const settled = withTimeout(never, 5_000, controller.signal).catch((error: unknown) => error);
    controller.abort();
    expect(await settled).toMatchObject({ kind: 'aborted' });
  });
});

describe('withDeadline', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('aborts the callee signal on timeout and reports timeout', async () => {
    let seen: AbortSignal | undefined;
    const settled = withDeadline(
      (signal) =>
        new Promise<string>(() => {
          seen = signal;
        }),
      { timeoutMs: 500 },
    ).catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(500);
    expect(await settled).toMatchObject({ kind: 'timeout' });
    expect(seen?.aborted).toBe(true);
  });

  it('reports the caller abort as aborted, whatever the callee threw', async () => {
    const controller = new AbortController();
    const settled = withDeadline(
      (signal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('socket hang up')));
        }),
      { timeoutMs: 5_000, signal: controller.signal },
    ).catch((error: unknown) => error);
    controller.abort();
    expect(await settled).toMatchObject({ kind: 'aborted' });
  });

  it('classifies what the callee throws', async () => {
    await expect(
      withDeadline(
        async () => {
          throw { status: 429 };
        },
        { timeoutMs: 1_000 },
      ),
    ).rejects.toMatchObject({ kind: 'rate_limited' });
  });
});

describe('normaliseRunError', () => {
  it('prefers the abort, then the provider error, then the cause', () => {
    const controller = new AbortController();
    controller.abort();
    expect(normaliseRunError(new Error('x'), controller.signal).kind).toBe('aborted');
    const provider = new AiProviderError('bad_output', 'x', false);
    expect(normaliseRunError(provider)).toBe(provider);
    expect(normaliseRunError(new Error('wrapped', { cause: provider }))).toBe(provider);
    expect(normaliseRunError({ status: 500 }).kind).toBe('unavailable');
  });
});
