import type { ApiKeyView } from '@/types/developers';
import {
  atKeyLimit,
  curlExample,
  docsUrl,
  formatCreated,
  formatLastUsed,
  keyStatus,
  liveKeyCount,
  MAX_LIVE_KEYS,
  statusBadge,
} from './api-keys-view-model';

const NOW = new Date('2026-10-16T12:00:00Z');

function key(overrides: Partial<ApiKeyView> = {}): ApiKeyView {
  return {
    id: 'key-1',
    name: 'CI',
    prefix: 'pg_abcdefgh',
    createdAt: '2026-10-16T10:00:00Z',
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

describe('keyStatus and statusBadge', () => {
  it('reads a key with no revokedAt as live, in the success tone', () => {
    expect(keyStatus(key())).toBe('live');
    expect(statusBadge('live')).toEqual({ label: 'Live', variant: 'success' });
  });

  it('reads a revoked key as revoked, as an outline sticker', () => {
    expect(keyStatus(key({ revokedAt: '2026-10-16T11:00:00Z' }))).toBe('revoked');
    expect(statusBadge('revoked')).toEqual({ label: 'Revoked', variant: 'outline' });
  });
});

describe('the key ceiling', () => {
  it('counts live keys only', () => {
    const keys = [key(), key({ id: 'k2', revokedAt: '2026-10-01T00:00:00Z' }), key({ id: 'k3' })];

    expect(liveKeyCount(keys)).toBe(2);
    expect(atKeyLimit(keys)).toBe(false);
  });

  it('is reached at ten live keys however many are revoked', () => {
    const live = Array.from({ length: MAX_LIVE_KEYS }, (_, i) => key({ id: `live-${i}` }));
    const revoked = Array.from({ length: 5 }, (_, i) =>
      key({ id: `old-${i}`, revokedAt: '2026-10-01T00:00:00Z' }),
    );

    expect(atKeyLimit([...live, ...revoked])).toBe(true);
    expect(atKeyLimit([...live.slice(1), ...revoked])).toBe(false);
  });
});

describe('timestamps', () => {
  it('says Never for a key that was never used', () => {
    expect(formatLastUsed(null, NOW)).toBe('Never');
    expect(formatLastUsed('not a date', NOW)).toBe('Never');
  });

  it('reads a used key relatively', () => {
    expect(formatLastUsed('2026-10-16T11:58:30Z', NOW)).toBe('2 minutes ago');
    expect(formatLastUsed('2026-10-16T09:00:00Z', NOW)).toBe('3 hours ago');
    expect(formatLastUsed('2026-10-10T12:00:00Z', NOW)).toBe('6 days ago');
  });

  it('shows the creation date without the year inside the current one', () => {
    expect(formatCreated('2026-10-16T10:00:00Z', NOW)).toMatch(/16/);
    expect(formatCreated('2026-10-16T10:00:00Z', NOW)).not.toMatch(/2026/);
    expect(formatCreated('2025-03-04T10:00:00Z', NOW)).toMatch(/2025/);
    expect(formatCreated('garbage', NOW)).toBe('');
  });
});

describe('developer strings', () => {
  it('points at the Swagger UI on the API origin', () => {
    expect(docsUrl('http://localhost:3001')).toBe('http://localhost:3001/api/docs');
    expect(docsUrl('https://api.postgear.rkay.in/')).toBe('https://api.postgear.rkay.in/api/docs');
  });

  it('writes a curl that proves the key against /v1/me', () => {
    const secret = `pg_${'a'.repeat(40)}`;

    expect(curlExample('http://localhost:3001/', secret)).toBe(
      `curl -H "Authorization: Bearer ${secret}" http://localhost:3001/v1/me`,
    );
  });
});
