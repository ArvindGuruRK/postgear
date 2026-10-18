import {
  BadBodyError,
  NotEnoughScopesError,
  RefreshTokenError,
  RetryableError,
} from '@postgear/social-core';
import { chunk, distinctDays, planUpserts, safeFailure } from './analytics-sync';

const ids = { organizationId: 'org-1', integrationId: 'ch-1' };

describe('planUpserts', () => {
  it('keeps one row per metric and day, the last point winning, oldest first', () => {
    const rows = planUpserts(
      [
        { metric: 'likes', date: '2026-10-14', value: 5 },
        { metric: 'followers', date: '2026-10-14', value: 900 },
        { metric: 'likes', date: '2026-10-13', value: 2 },
        { metric: 'likes', date: '2026-10-14', value: 6 },
      ],
      ids,
    );

    expect(rows).toEqual([
      { ...ids, metric: 'likes', date: new Date('2026-10-13T00:00:00.000Z'), value: 2 },
      { ...ids, metric: 'followers', date: new Date('2026-10-14T00:00:00.000Z'), value: 900 },
      { ...ids, metric: 'likes', date: new Date('2026-10-14T00:00:00.000Z'), value: 6 },
    ]);
    expect(distinctDays(rows)).toBe(2);
  });

  it('drops what cannot be stored rather than failing the sync', () => {
    const rows = planUpserts(
      [
        { metric: 'bogus' as never, date: '2026-10-14', value: 1 },
        { metric: 'likes', date: 'yesterday', value: 1 },
        { metric: 'likes', date: '2026-13-45', value: 1 },
        { metric: 'likes', date: '2026-10-14', value: Number.NaN },
        { metric: 'likes', date: '2026-10-14', value: -1 },
        { metric: 'likes', date: '2026-10-14', value: 0 },
      ],
      ids,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(0);
  });
});

describe('chunk', () => {
  it('splits into batches of the size, the last one shorter', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 200)).toEqual([]);
  });
});

describe('safeFailure', () => {
  const body = 'Bearer secret-token echoed by the platform';

  it('maps each class to a status, a retry decision and a message without the provider body', () => {
    const dead = safeFailure(new RefreshTokenError('expired', 'x', body, 401), 'Acme');
    expect(dead).toEqual({
      status: 'NEEDS_RECONNECT',
      message: 'Acme needs reconnecting before its metrics can be read.',
      retry: false,
    });

    const scopes = safeFailure(new NotEnoughScopesError('x', ['tweet.read']), 'Acme');
    expect(scopes.status).toBe('NEEDS_PERMISSIONS');
    expect(scopes.retry).toBe(false);
    expect(scopes.message).toContain('permission');

    const transient = safeFailure(new RetryableError('down', 'x', body, 503), 'Acme');
    expect(transient).toEqual({
      status: 'FAILED',
      message: 'Acme could not be reached. PostGear will try again.',
      retry: true,
    });

    const unknown = safeFailure(new TypeError('cannot read properties of undefined'), 'Acme');
    expect(unknown.status).toBe('FAILED');
    expect(unknown.retry).toBe(true);
    expect(unknown.message).not.toContain('undefined');

    for (const failure of [dead, scopes, transient, unknown]) {
      expect(failure.message).not.toContain('secret-token');
    }
  });

  it('keeps a bad request’s own message (composed by PostGear) and does not retry it', () => {
    const refused = safeFailure(
      new BadBodyError('X returned a response PostGear could not read.', 'x', body, 200),
      'Acme',
    );

    expect(refused).toEqual({
      status: 'FAILED',
      message: 'X returned a response PostGear could not read.',
      retry: false,
    });
  });
});
