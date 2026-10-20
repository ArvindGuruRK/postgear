import { describeChannel, describePost, formatRelative } from './post-status';

const now = new Date('2026-10-11T10:00:00Z');
const later = '2026-10-11T12:00:00.000Z';
const earlier = '2026-10-11T09:00:00.000Z';

const channel = (state: 'DRAFT' | 'QUEUE' | 'PUBLISHED' | 'ERROR', publishStatus = null) => ({
  state,
  publishStatus,
});

describe('describePost', () => {
  it('reads a future queued post as scheduled and a past one as publishing', () => {
    expect(
      describePost({ state: 'QUEUE', publishDate: later, channels: [channel('QUEUE')] }, now),
    ).toMatchObject({ tone: 'scheduled', variant: 'primary', live: false });
    expect(
      describePost({ state: 'QUEUE', publishDate: earlier, channels: [channel('QUEUE')] }, now),
    ).toMatchObject({ tone: 'publishing', live: true });
  });

  it('shows the retry in progress with its next attempt', () => {
    const retrying = {
      kind: 'retrying' as const,
      attempt: 2,
      maxAttempts: 5,
      nextAttemptAt: '2026-10-11T10:05:00.000Z',
      message: 'rate limited',
      updatedAt: '2026-10-11T10:04:00.000Z',
    };

    const shown = describePost(
      {
        state: 'QUEUE',
        publishDate: earlier,
        channels: [{ state: 'QUEUE', publishStatus: retrying }],
      },
      now,
    );

    expect(shown.tone).toBe('retrying');
    expect(shown.detail).toMatch(/^Attempt 2 of 5 failed, next try /);
  });

  it('explains a failure, and a partial publish by its count', () => {
    const failed = {
      kind: 'failed' as const,
      reason: 'needs_reconnect' as const,
      message: 'expired',
      attempts: 1,
      failedAt: earlier,
    };

    expect(
      describePost(
        {
          state: 'ERROR',
          publishDate: earlier,
          channels: [{ state: 'ERROR', publishStatus: failed }],
        },
        now,
      ),
    ).toMatchObject({ tone: 'failed', variant: 'danger', detail: 'Channel needs reconnecting' });

    expect(
      describePost(
        {
          state: 'ERROR',
          publishDate: earlier,
          channels: [{ state: 'ERROR', publishStatus: failed }, channel('PUBLISHED')],
        },
        now,
      ).detail,
    ).toBe('Published to 1 of 2 channels');
  });

  it('describes drafts, published posts and single channels', () => {
    expect(describePost({ state: 'DRAFT', publishDate: later, channels: [] }, now)).toMatchObject({
      tone: 'draft',
      variant: 'outline',
    });
    expect(describeChannel(channel('PUBLISHED'), earlier, now)).toMatchObject({
      tone: 'published',
      variant: 'success',
    });
  });
});

describe('formatRelative', () => {
  it('rounds to the most useful unit in both directions', () => {
    expect(formatRelative(new Date('2026-10-11T10:00:20Z'), now)).toBe('in less than a minute');
    expect(formatRelative(new Date('2026-10-11T10:45:00Z'), now)).toBe('in 45 minutes');
    expect(formatRelative(new Date('2026-10-11T13:00:00Z'), now)).toBe('in 3 hours');
    expect(formatRelative(new Date('2026-10-08T10:00:00Z'), now)).toBe('3 days ago');
  });
});
