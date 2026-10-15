/**
 * The metrics stand-in: deterministic, shaped like a real account, and
 * willing to fail on request. The real source is checked only for which
 * platforms it answers for — the providers themselves are tested in
 * `@postgear/social-core`.
 */
import { NotEnoughScopesError, RefreshTokenError, RetryableError } from '@postgear/social-core';
import {
  createAnalyticsSource,
  SimulatedAnalyticsProvider,
  simulatedChannelPoints,
  simulatedPostMetrics,
} from './analytics-source';

const channel = {
  id: 'seed-channel-linkedin',
  internalId: 'acct',
  rootInternalId: 'acct',
  providerIdentifier: 'linkedin',
  name: 'Acme Marketing',
};

const NOW = Date.UTC(2026, 9, 15, 12);

function byMetric(points: ReturnType<typeof simulatedChannelPoints>, metric: string) {
  return points.filter((point) => point.metric === metric);
}

describe('createAnalyticsSource', () => {
  it('answers for every platform in simulation, and only for platforms with metrics otherwise', () => {
    const simulated = createAnalyticsSource({ ANALYTICS_SIMULATION: 'true' });
    expect(simulated.simulated).toBe(true);
    expect(simulated.resolve('linkedin')).toBeInstanceOf(SimulatedAnalyticsProvider);
    expect(simulated.resolve('linkedin')?.name).toBe('LinkedIn');
    expect(simulated.resolve('made-up')?.name).toBe('made-up');

    const real = createAnalyticsSource({ ANALYTICS_SIMULATION: 'false' });
    expect(real.simulated).toBe(false);
    expect(real.resolve('linkedin')).toBeNull();
    expect(real.resolve('made-up')).toBeNull();
    expect(real.resolve('x')?.identifier).toBe('x');
    expect(real.resolve('linkedin-page')?.identifier).toBe('linkedin-page');
  });
});

describe('simulatedChannelPoints', () => {
  it('is deterministic for a channel and a day', () => {
    const first = simulatedChannelPoints('ch-a', 'linkedin', 30, NOW);
    const second = simulatedChannelPoints('ch-a', 'linkedin', 30, NOW);
    const other = simulatedChannelPoints('ch-b', 'linkedin', 30, NOW);

    expect(second).toEqual(first);
    expect(other).not.toEqual(first);
  });

  it('covers exactly the window, ending today, with every metric each day', () => {
    const points = simulatedChannelPoints('ch-a', 'linkedin', 7, NOW);
    const days = [...new Set(points.map((point) => point.date))];

    expect(days).toHaveLength(7);
    expect(days[0]).toBe('2026-10-09');
    expect(days[6]).toBe('2026-10-15');
    expect(byMetric(points, 'followers')).toHaveLength(7);
    expect(byMetric(points, 'impressions')).toHaveLength(7);
    expect(byMetric(points, 'engagements')).toHaveLength(7);
    expect(byMetric(points, 'views')).toHaveLength(0);
    expect(byMetric(simulatedChannelPoints('ch-a', 'youtube', 7, NOW), 'views')).toHaveLength(7);
  });

  it('has a follower level in range that trends up, and flows that look like an account', () => {
    const points = simulatedChannelPoints('ch-a', 'instagram', 90, NOW);
    const followers = byMetric(points, 'followers').map((point) => point.value);

    expect(Math.min(...followers)).toBeGreaterThanOrEqual(100);
    expect(Math.max(...followers)).toBeLessThan(20_000);
    expect(followers[followers.length - 1]).toBeGreaterThan(followers[0]);

    for (const day of [...new Set(points.map((point) => point.date))]) {
      const onDay = Object.fromEntries(
        points.filter((point) => point.date === day).map((point) => [point.metric, point.value]),
      );

      expect(onDay.impressions).toBeGreaterThan(0);
      expect(onDay.reach).toBeLessThanOrEqual(onDay.impressions);
      expect(onDay.engagements).toBeLessThan(onDay.impressions);
      expect(onDay.likes + onDay.comments + onDay.shares).toBeLessThanOrEqual(onDay.engagements);
      expect(Number.isInteger(onDay.clicks)).toBe(true);
    }
  });

  it('is a function of the date, not of when it is read: yesterday’s row does not move', () => {
    const today = simulatedChannelPoints('ch-a', 'linkedin', 2, NOW);
    const tomorrow = simulatedChannelPoints('ch-a', 'linkedin', 3, NOW + 24 * 60 * 60_000);

    expect(tomorrow.filter((point) => point.date === '2026-10-15')).toEqual(
      today.filter((point) => point.date === '2026-10-15'),
    );
  });
});

describe('simulatedPostMetrics', () => {
  it('is stable for a post id on a day, and grows a little by the next day', () => {
    const now = simulatedPostMetrics('sim-1', 'linkedin', NOW);
    const again = simulatedPostMetrics('sim-1', 'linkedin', NOW);
    const later = simulatedPostMetrics('sim-1', 'linkedin', NOW + 30 * 24 * 60 * 60_000);
    const other = simulatedPostMetrics('sim-2', 'linkedin', NOW);

    expect(again).toEqual(now);
    expect(other).not.toEqual(now);
    expect(later.impressions).toBeGreaterThan(now.impressions);
    expect(now.impressions).toBeGreaterThanOrEqual(200);
    expect(now.likes + now.comments + now.shares + now.saves).toBeLessThan(now.impressions);
    expect(now.views).toBe(0);
    expect(simulatedPostMetrics('sim-1', 'youtube', NOW).views).toBeGreaterThan(0);
  });
});

describe('SimulatedAnalyticsProvider', () => {
  const provider = new SimulatedAnalyticsProvider('linkedin', 'LinkedIn');

  it('answers both reads', async () => {
    await expect(provider.channelAnalytics(channel, 'token', 7)).resolves.toHaveLength(7 * 8);
    await expect(provider.postAnalytics(channel, 'token', 'sim-1')).resolves.toMatchObject({
      impressions: expect.any(Number),
    });
  });

  it('throws the error class a directive in the channel name asks for', async () => {
    const named = (name: string) => ({ ...channel, name });

    await expect(
      provider.channelAnalytics(named('Acme [simulate:analytics:401]'), 't', 7),
    ).rejects.toBeInstanceOf(RefreshTokenError);
    await expect(
      provider.channelAnalytics(named('Acme [simulate:analytics:403]'), 't', 7),
    ).rejects.toBeInstanceOf(NotEnoughScopesError);
    await expect(
      provider.postAnalytics(named('Acme [simulate:analytics:429]'), 't', 'p'),
    ).rejects.toBeInstanceOf(RetryableError);
  });
});
