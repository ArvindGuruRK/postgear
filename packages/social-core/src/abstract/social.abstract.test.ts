/**
 * The shared HTTP layer.
 *
 * These behaviours are worth pinning because every provider inherits them: if
 * the retry loop is unbounded, one flaky platform stalls a worker; if a 401 is
 * classified as retryable, a dead credential is retried forever instead of
 * prompting a reconnect.
 */
import {
  BadBodyError,
  NotEnoughScopesError,
  RefreshTokenError,
  RetryableError,
  truncateBody,
} from './errors';
import type { HandledError } from './social.abstract';
import { SocialAbstract } from './social.abstract';

class TestProvider extends SocialAbstract {
  readonly identifier = 'test';

  /** Exposed so the tests can drive the protected members directly. */
  call(url: string, options?: Parameters<SocialAbstract['fetch']>[1]) {
    return this.fetch(url, options);
  }

  callJson<T>(url: string) {
    return this.fetchJson<T>(url);
  }

  scopes(required: string[], granted: string | string[] | undefined) {
    return this.checkScopes(required, granted);
  }

  pkce() {
    return this.generatePkcePair();
  }

  handled: HandledError | undefined;

  protected override handleErrors(): HandledError | undefined {
    return this.handled;
  }
}

function response(status: number, body = '', headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

describe('SocialAbstract', () => {
  let provider: TestProvider;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    provider = new TestProvider();
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    // Retries sleep with real timers; collapsing them keeps the suite fast
    // without changing the code path being exercised.
    jest.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void) => {
      callback();
      return 0 as unknown as NodeJS.Timeout;
    }) as unknown as typeof setTimeout);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('retry behaviour', () => {
    it('retries a 429 and returns the eventual success', async () => {
      fetchMock
        .mockResolvedValueOnce(response(429, 'slow down'))
        .mockResolvedValueOnce(response(200, 'ok'));

      const result = await provider.call('https://example.test/a');

      expect(result.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('gives up after a bounded number of attempts', async () => {
      fetchMock.mockResolvedValue(response(503, 'unavailable'));

      await expect(provider.call('https://example.test/a')).rejects.toBeInstanceOf(RetryableError);

      // Bounded, not infinite — an unbounded loop would pin a worker on a
      // platform having a bad day.
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('retries a network-level failure, then reports it as retryable', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNRESET'));

      await expect(provider.call('https://example.test/a')).rejects.toBeInstanceOf(RetryableError);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('does not retry a 400', async () => {
      fetchMock.mockResolvedValue(response(400, 'bad request'));

      await expect(provider.call('https://example.test/a')).rejects.toBeInstanceOf(BadBodyError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('honours Retry-After when the platform sends one', async () => {
      fetchMock
        .mockResolvedValueOnce(response(429, 'slow down', { 'retry-after': '2' }))
        .mockResolvedValueOnce(response(200, 'ok'));

      await provider.call('https://example.test/a');

      // A server saying when to come back beats guessing, and ignoring it is
      // how an integration earns a longer ban.
      expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 2_000);
    });

    it('caps the backoff rather than doubling without limit', async () => {
      fetchMock
        .mockResolvedValueOnce(response(429, '', { 'retry-after': '3600' }))
        .mockResolvedValueOnce(response(200, 'ok'));

      await provider.call('https://example.test/a');

      expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 8_000);
    });
  });

  describe('error classification', () => {
    it('maps 401 to a refresh signal', async () => {
      fetchMock.mockResolvedValue(response(401, 'expired'));

      await expect(provider.call('https://example.test/a')).rejects.toBeInstanceOf(
        RefreshTokenError,
      );
    });

    it('maps 403 to missing scopes, not to a refresh', async () => {
      fetchMock.mockResolvedValue(response(403, 'forbidden'));

      // Refreshing a valid-but-powerless token returns an equally powerless
      // one; the user has to re-consent instead.
      await expect(provider.call('https://example.test/a')).rejects.toBeInstanceOf(
        NotEnoughScopesError,
      );
    });

    it('lets a provider promote a 200-shaped failure to a refresh', async () => {
      provider.handled = { type: 'refresh-token', value: 'token revoked' };
      fetchMock.mockResolvedValue(response(400, 'REVOKED_ACCESS_TOKEN'));

      const error = await provider.call('https://example.test/a').catch((e) => e);

      expect(error).toBeInstanceOf(RefreshTokenError);
      expect(error.message).toBe('token revoked');
    });

    it('carries the provider identifier and body on the error', async () => {
      fetchMock.mockResolvedValue(response(400, '{"error":"nope"}'));

      const error = await provider.call('https://example.test/a').catch((e) => e);

      expect(error.identifier).toBe('test');
      expect(error.providerBody).toBe('{"error":"nope"}');
      expect(error.status).toBe(400);
    });

    it('treats an unparseable success body as a bad body', async () => {
      fetchMock.mockResolvedValue(response(200, 'not json'));

      await expect(provider.callJson('https://example.test/a')).rejects.toBeInstanceOf(
        BadBodyError,
      );
    });

    it('returns an empty object for an empty success body', async () => {
      fetchMock.mockResolvedValue(response(200, ''));

      await expect(provider.callJson('https://example.test/a')).resolves.toEqual({});
    });
  });

  describe('scope checking', () => {
    it('accepts a space-delimited grant', () => {
      expect(() => provider.scopes(['read', 'write'], 'read write extra')).not.toThrow();
    });

    it('accepts a comma-delimited and URL-encoded grant', () => {
      expect(() => provider.scopes(['a.b', 'c.d'], 'a.b%2Cc.d')).not.toThrow();
    });

    it('names the missing scopes when something was not granted', () => {
      const error = (() => {
        try {
          provider.scopes(['read', 'write'], ['read']);
        } catch (e) {
          return e as NotEnoughScopesError;
        }
      })();

      expect(error).toBeInstanceOf(NotEnoughScopesError);
      expect(error?.missingScopes).toEqual(['write']);
    });

    it('does not fail when the platform reports no scopes at all', () => {
      // Silence is not evidence of a problem — the first real call will 403 if
      // something is genuinely missing, and that path is already handled.
      expect(() => provider.scopes(['read'], undefined)).not.toThrow();
    });
  });

  describe('PKCE', () => {
    it('derives an S256 challenge in base64url with no padding', () => {
      const { codeVerifier, codeChallenge } = provider.pkce();

      expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
      expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(codeChallenge).not.toContain('=');
    });

    it('produces a fresh pair each time', () => {
      expect(provider.pkce().codeVerifier).not.toBe(provider.pkce().codeVerifier);
    });
  });

  describe('truncateBody', () => {
    it('caps long payloads so they cannot blow a durable workflow history', () => {
      const truncated = truncateBody('x'.repeat(10_000), 100);

      expect(truncated.length).toBeLessThan(200);
      expect(truncated).toContain('truncated');
    });

    it('survives circular structures', () => {
      const circular: Record<string, unknown> = { a: 1 };
      circular.self = circular;

      expect(() => truncateBody(circular)).not.toThrow();
    });
  });
});
