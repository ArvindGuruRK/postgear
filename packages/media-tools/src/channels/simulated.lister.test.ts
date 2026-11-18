import type { LinkRef } from '@postgear/video-engine';
import { resolveSimulationLink } from '../downloader/simulation';
import { mapProbeJson } from '../downloader/yt-dlp.probe';
import { createSimulatedChannelLister } from './simulated.lister';

const NOW = new Date('2026-11-18T12:00:00.000Z');
const now = (): Date => NOW;

describe('createSimulatedChannelLister', () => {
  it('resolves acme and the simstreamer alias on every platform, and nothing else', async () => {
    const twitch = createSimulatedChannelLister('twitch', { now });
    expect(await twitch.resolve('acme')).toMatchObject({
      handle: 'acme',
      externalId: '900000900',
      broadcasterType: 'affiliate',
    });
    expect(await twitch.resolve('SimStreamer')).toMatchObject({ externalId: '900000900' });
    expect(await createSimulatedChannelLister('youtube').resolve('@acme')).toMatchObject({
      externalId: 'UCsimacme000000000000001',
      uploadsListId: 'UUsimacme000000000000001',
    });
    expect(await createSimulatedChannelLister('kick').resolve('acme')).toMatchObject({
      externalId: 'acme',
    });
    await expect(twitch.resolve('someone_else')).rejects.toMatchObject({
      code: 'channel_not_found',
    });
    await expect(twitch.resolve('a/b')).rejects.toMatchObject({ code: 'channel_not_found' });
  });

  it('lists about 30 items per channel with a live one, a processing one and one near expiry', async () => {
    const lister = createSimulatedChannelLister('twitch', { now });
    const channel = await lister.resolve('acme');
    const streams = await lister.list(channel, { kind: 'streams', limit: 50 });
    const clips = await lister.list(channel, { kind: 'clips', limit: 50 });
    expect(streams.items.length + clips.items.length).toBe(30);
    expect(streams.items.filter((item) => item.state === 'live')).toHaveLength(1);
    expect(streams.items.filter((item) => item.state === 'processing')).toHaveLength(1);
    const soonest = streams.items
      .map((item) => Date.parse(item.expiresAt ?? ''))
      .filter((time) => !Number.isNaN(time))
      .sort((a, b) => a - b)[0] as number;
    expect(soonest - NOW.getTime()).toBeLessThan(12 * 3600_000);
    expect(soonest).toBeGreaterThan(NOW.getTime());
    expect(clips.items.every((item) => item.channel === 'acme' && item.thumbnailUrl === null)).toBe(
      true,
    );
    for (const platform of ['kick', 'youtube'] as const) {
      const other = createSimulatedChannelLister(platform, { now });
      const ref = await other.resolve(platform === 'youtube' ? '@acme' : 'acme');
      const kinds =
        platform === 'youtube'
          ? (['uploads', 'streams', 'shorts'] as const)
          : (['streams', 'clips'] as const);
      let total = 0;
      for (const kind of kinds) total += (await other.list(ref, { kind, limit: 50 })).items.length;
      expect(total).toBe(30);
    }
  });

  it('pages with cursors and the newest first', async () => {
    const lister = createSimulatedChannelLister('twitch', { now });
    const channel = await lister.resolve('acme');
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await lister.list(channel, {
        kind: 'streams',
        limit: 5,
        ...(cursor ? { cursor } : {}),
      });
      seen.push(...page.items.map((item) => item.publishedAt));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(4);
    expect(seen).toHaveLength(18);
    expect(seen).toEqual([...seen].sort().reverse());
  });

  it('sorts by views where the platform can, and refuses it for YouTube', async () => {
    const kick = createSimulatedChannelLister('kick', { now });
    const ref = await kick.resolve('acme');
    const views = (await kick.list(ref, { kind: 'clips', limit: 50, sort: 'views' })).items.map(
      (item) => item.viewCount ?? 0,
    );
    expect(views).toEqual([...views].sort((a, b) => b - a));
    const youtube = createSimulatedChannelLister('youtube', { now });
    const yref = await youtube.resolve('@acme');
    await expect(
      youtube.list(yref, { kind: 'uploads', limit: 50, sort: 'views' }),
    ).rejects.toMatchObject({
      code: 'list_sort_unsupported',
    });
    await expect(youtube.list(yref, { kind: 'clips', limit: 50 })).rejects.toMatchObject({
      code: 'list_kind_unsupported',
    });
  });

  it('filters Twitch clips by period', async () => {
    const lister = createSimulatedChannelLister('twitch', { now });
    const ref = await lister.resolve('acme');
    const day = await lister.list(ref, { kind: 'clips', limit: 50, period: 'day' });
    const all = await lister.list(ref, { kind: 'clips', limit: 50, period: 'all' });
    expect(day.items.length).toBeLessThan(all.items.length);
    expect(day.items.length).toBeGreaterThan(0);
  });

  it('every listed item probes through the fixture downloader with a matching state', async () => {
    for (const platform of ['twitch', 'kick', 'youtube'] as const) {
      const lister = createSimulatedChannelLister(platform, { now });
      const ref = await lister.resolve(platform === 'youtube' ? '@acme' : 'acme');
      const kinds =
        platform === 'youtube'
          ? (['uploads', 'streams', 'shorts'] as const)
          : (['streams', 'clips'] as const);
      for (const kind of kinds) {
        for (const item of (await lister.list(ref, { kind, limit: 50 })).items) {
          const link: LinkRef = {
            platform,
            kind: item.kind === 'clip' ? 'clip' : item.kind === 'short' ? 'short' : 'video',
            externalId: item.externalId,
            canonicalUrl: 'https://example.invalid/not-used',
          };
          const answer = resolveSimulationLink(link);
          expect(answer?.type).toBe('video');
          if (answer?.type !== 'video') continue;
          const info = mapProbeJson(answer.probeJson, link).info;
          expect(info.title).toBe(item.title);
          expect(info.live).toBe(item.state !== 'ready');
          if (item.state === 'ready' && item.durationSec !== null) {
            expect(info.durationMs).toBe(item.durationSec * 1000);
          }
        }
      }
    }
  });
});
