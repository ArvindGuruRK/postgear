import { ApiError } from '@/lib/api';
import type { ShareView } from '@/types/studio';
import {
  createdLabel,
  dayLabel,
  listedShare,
  mergeShares,
  problemOf,
  revokeLabel,
  shareLinkOf,
  UNREACHABLE,
  viewedLabel,
} from './share-model';
import { SHARE_DAY_OPTIONS, sinceLabel } from './studio-view-model';

const NOW = new Date('2026-10-27T12:00:00.000Z');
const ORIGIN = 'http://localhost:3000';

function share(id: string, overrides: Partial<ShareView> = {}): ShareView {
  return {
    id,
    expiresAt: '2026-11-03T12:00:00.000Z',
    createdAt: '2026-10-27T11:00:00.000Z',
    lastViewedAt: null,
    ...overrides,
  };
}

describe('share labels', () => {
  it('names each expiry choice in days', () => {
    expect(SHARE_DAY_OPTIONS.map(dayLabel)).toEqual([
      '1 day',
      '3 days',
      '7 days',
      '14 days',
      '30 days',
    ]);
  });

  it('says how long ago something happened', () => {
    expect(sinceLabel('2026-10-27T11:59:30.000Z', NOW)).toBe('just now');
    expect(sinceLabel('2026-10-27T11:59:00.000Z', NOW)).toBe('1 minute ago');
    expect(sinceLabel('2026-10-27T11:15:00.000Z', NOW)).toBe('45 minutes ago');
    expect(sinceLabel('2026-10-27T10:00:00.000Z', NOW)).toBe('2 hours ago');
    expect(sinceLabel('2026-10-26T06:00:00.000Z', NOW)).toBe('yesterday');
    expect(sinceLabel('2026-10-24T12:00:00.000Z', NOW)).toBe('3 days ago');
    expect(sinceLabel('2026-09-15T12:00:00.000Z', NOW)).toMatch(/^on Sep 1[45]$/);
    expect(sinceLabel('2025-09-15T12:00:00.000Z', NOW)).toMatch(/2025$/);
    expect(sinceLabel('not a date', NOW)).toBe('recently');
    // The minute clock runs a little behind the server's: a link made a moment ago.
    expect(sinceLabel('2026-10-27T12:00:40.000Z', NOW)).toBe('just now');
  });

  it('says when a link was created and when it was last opened', () => {
    expect(createdLabel('2026-10-27T12:00:40.000Z', NOW)).toBe('Created just now');
    expect(createdLabel('2026-10-25T12:00:00.000Z', NOW)).toBe('Created 2 days ago');
    expect(viewedLabel('2026-10-27T07:00:00.000Z', NOW)).toBe('Last viewed 5 hours ago');
    expect(viewedLabel('2026-10-26T10:00:00.000Z', NOW)).toBe('Last viewed yesterday');
  });

  it('tells one Revoke button from the next by when its link expires', () => {
    expect(revokeLabel('2026-11-03T12:00:00.000Z', NOW)).toBe(
      'Revoke the link that expires in 7 days',
    );
    expect(revokeLabel('2026-10-27T12:30:00.000Z', NOW)).toBe(
      'Revoke the link that expires in under an hour',
    );
    expect(revokeLabel('2026-10-27T11:00:00.000Z', NOW)).toBe('Revoke the link that expired');
  });
});

describe('the new link', () => {
  it('takes the address the API built', () => {
    expect(
      shareLinkOf(
        { token: 'tok_123', url: 'https://postgear.rkay.in/share/design/tok_123' },
        ORIGIN,
      ),
    ).toBe('https://postgear.rkay.in/share/design/tok_123');
  });

  it('builds it from the token on this app when the address is missing or unusable', () => {
    expect(shareLinkOf({ token: 'tok_123' }, ORIGIN)).toBe(
      'http://localhost:3000/share/design/tok_123',
    );
    expect(
      shareLinkOf({ token: 'tok_123', url: 'localhost:3000/share/design/tok_123' }, ORIGIN),
    ).toBe('http://localhost:3000/share/design/tok_123');
  });

  it('gives nothing rather than an address that is not a web page', () => {
    expect(shareLinkOf({}, ORIGIN)).toBeNull();
    expect(shareLinkOf({ url: 'javascript:alert(1)' }, ORIGIN)).toBeNull();
  });

  it('keeps no token or address in the list', () => {
    const created = share('a', { token: 'tok_123', url: `${ORIGIN}/share/design/tok_123` });

    expect(listedShare(created)).toEqual(share('a'));
    expect(listedShare(created)).not.toHaveProperty('token');
    expect(listedShare(created)).not.toHaveProperty('url');
  });
});

describe('mergeShares', () => {
  it('puts links made while the list loaded first, and leaves out links revoked meanwhile', () => {
    const fetched = [share('b'), share('c'), share('d')];

    expect(mergeShares(fetched, [share('new')], new Set(['c'])).map((entry) => entry.id)).toEqual([
      'new',
      'b',
      'd',
    ]);
  });

  it('lists a link once when the fetch already has it', () => {
    const fetched = [share('new'), share('b')];

    expect(mergeShares(fetched, [share('new')], new Set()).map((entry) => entry.id)).toEqual([
      'new',
      'b',
    ]);
  });

  it('leaves out a link made and then revoked here', () => {
    expect(mergeShares([], [share('new')], new Set(['new']))).toEqual([]);
  });
});

describe('problemOf', () => {
  it("shows the API's own sentence", () => {
    const limit = new ApiError(
      'This design already has 20 working share links. Revoke one to make another.',
      409,
      'share_limit',
    );

    expect(problemOf(limit, 'Fallback.')).toBe(
      'This design already has 20 working share links. Revoke one to make another.',
    );
  });

  it('says the connection was lost when the request never got an answer', () => {
    expect(problemOf(new TypeError('Failed to fetch'), 'Fallback.')).toBe(UNREACHABLE);
  });

  it('falls back for anything else', () => {
    expect(problemOf(new SyntaxError('Unexpected token <'), 'Fallback.')).toBe('Fallback.');
  });
});
