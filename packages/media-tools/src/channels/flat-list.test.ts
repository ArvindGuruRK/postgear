import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ChannelRef } from '@postgear/video-engine';
import flatKick from '../../fixtures/ytdlp/flat-kick-videos.json';
import flatTwitch from '../../fixtures/ytdlp/flat-twitch-videos.json';
import flatYoutube from '../../fixtures/ytdlp/flat-youtube-tab.json';
import { IMPORT_EXTRACTORS } from '../downloader/yt-dlp.args';
import { type RunTool, type RunToolOptions, ToolError } from '../run/types';
import {
  channelKey,
  channelPageUrl,
  flatListArgs,
  LISTING_EXTRACTOR_ALLOWLIST,
} from './flat-list.args';
import { parseFlatList } from './flat-list.parse';
import { createYtDlpFlatLister } from './flat.lister';
import { ChannelListerError } from './types';

const paths = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', ytDlp: 'yt-dlp', jsRuntime: null };

describe('flatListArgs', () => {
  it('builds a Kick list call with one listing extractor and the page after --', () => {
    expect(
      flatListArgs(
        { paths },
        { platform: 'kick', key: 'Acme', kind: 'streams', start: 1, count: 51 },
      ),
    ).toEqual([
      '-J',
      '--flat-playlist',
      '--ignore-config',
      '--no-warnings',
      '--use-extractors',
      'kick:videos',
      '-I',
      '1:51',
      '--color',
      'never',
      '--socket-timeout',
      '20',
      '--retries',
      '2',
      '--no-cache-dir',
      '--',
      'https://kick.com/acme/videos',
    ]);
  });

  it('uses only allowlisted listing extractors, none of which the import may use', () => {
    const importNames = Object.values(IMPORT_EXTRACTORS).flat();
    for (const [platform, kinds] of [
      ['twitch', ['streams', 'clips']],
      ['kick', ['streams', 'clips']],
      ['youtube', ['uploads', 'streams', 'shorts']],
    ] as const) {
      for (const kind of kinds) {
        const key = platform === 'youtube' ? '@acme' : 'acme';
        const args = flatListArgs({ paths }, { platform, key, kind, start: 51, count: 51 });
        const extractor = args[args.indexOf('--use-extractors') + 1] as string;
        expect(LISTING_EXTRACTOR_ALLOWLIST).toContain(extractor);
        expect(importNames).not.toContain(extractor);
        expect(args[args.indexOf('-I') + 1]).toBe('51:101');
        expect(args[args.length - 2]).toBe('--');
        expect(args).not.toContain('--cookies');
      }
    }
  });

  it('builds the page from a checked key on a fixed host', () => {
    expect(channelPageUrl('twitch', 'Acme_TV', 'streams', { sort: 'views' })).toBe(
      'https://www.twitch.tv/acme_tv/videos?filter=archives&sort=views',
    );
    expect(channelPageUrl('twitch', 'acme', 'clips', { period: 'week' })).toBe(
      'https://www.twitch.tv/acme/clips?filter=clips&range=7d',
    );
    expect(channelPageUrl('youtube', '@acme', 'shorts')).toBe(
      'https://www.youtube.com/@acme/shorts',
    );
    expect(channelPageUrl('youtube', 'UCsimacme000000000000001', 'uploads')).toBe(
      'https://www.youtube.com/channel/UCsimacme000000000000001/videos',
    );
    expect(channelPageUrl('kick', 'acme', 'clips')).toBe('https://kick.com/acme/clips');
  });

  it('refuses names that could leave the page, YouTube by views, and wrong lists', () => {
    for (const [platform, key] of [
      ['twitch', 'ab'],
      ['twitch', 'acme/../x'],
      ['twitch', 'acme?x=1'],
      ['kick', 'a'.repeat(26)],
      ['kick', 'acme#x'],
      ['youtube', '@a'],
      ['youtube', '@acme/videos'],
    ] as const) {
      expect(() => channelKey(platform, key)).toThrow(ChannelListerError);
    }
    expect(() => channelPageUrl('youtube', '@acme', 'uploads', { sort: 'views' })).toThrow(
      expect.objectContaining({ code: 'list_sort_unsupported' }),
    );
    expect(() =>
      flatListArgs(
        { paths },
        { platform: 'kick', key: 'acme', kind: 'shorts', start: 1, count: 1 },
      ),
    ).toThrow(expect.objectContaining({ code: 'list_kind_unsupported' }));
  });

  it('adds approximate dates for YouTube', () => {
    const args = flatListArgs(
      { paths },
      { platform: 'youtube', key: '@acme', kind: 'uploads', start: 1, count: 2 },
    );
    expect(args).toEqual(
      expect.arrayContaining(['--extractor-args', 'youtubetab:approximate_date']),
    );
  });
});

describe('parseFlatList', () => {
  it('maps Kick entries, dropping ids that do not fit and never returning an address', () => {
    const { items, facts } = parseFlatList(flatKick, {
      platform: 'kick',
      kind: 'streams',
      channelKey: 'acme',
    });
    expect(facts.channelName).toBe('Acme');
    expect(items.map((item) => item.externalId)).toEqual([
      '00000000-0000-4000-8000-000000000103',
      '00000000-0000-4000-8000-000000000104',
      '00000000-0000-4000-8000-000000000105',
    ]);
    expect(items[0]).toEqual({
      externalId: '00000000-0000-4000-8000-000000000103',
      kind: 'vod',
      title: 'Acme On Kick: Co-op Night',
      publishedAt: '2026-01-02T00:00:00.000Z',
      durationSec: 600,
      viewCount: 2240,
      thumbnailUrl: 'https://img.sim.invalid/kick/103.webp',
      state: 'ready',
      channel: 'acme',
    });
    expect(items[1]).toMatchObject({
      durationSec: null,
      viewCount: null,
      publishedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(items[2]).toMatchObject({ state: 'live', thumbnailUrl: null });
    expect(JSON.stringify(items)).not.toContain('kick.com');
  });

  it('maps Twitch entries with expiry from the broadcaster type and drops duplicates', () => {
    const { items } = parseFlatList(flatTwitch, {
      platform: 'twitch',
      kind: 'streams',
      channelKey: 'acme',
      broadcasterType: 'affiliate',
    });
    expect(items.map((item) => item.externalId)).toEqual(['900000103', '900000104']);
    expect(items[0]?.expiresAt).toBe('2026-01-16T00:00:00.000Z');
    expect(items[0]?.channel).toBeUndefined();
  });

  it('maps YouTube tab entries (videos, shorts, an upcoming stream) the same shape', () => {
    const { items, facts } = parseFlatList(flatYoutube, {
      platform: 'youtube',
      kind: 'uploads',
      channelKey: '@acme',
    });
    expect(facts.channelId).toBe('UCsimacme000000000000001');
    expect(items.map((item) => [item.externalId, item.state])).toEqual([
      ['simacmeu001', 'ready'],
      ['simacmes001', 'ready'],
      ['simacmel002', 'upcoming'],
    ]);
    expect(items[0]?.thumbnailUrl).toBe('https://img.sim.invalid/vi/simacmeu001/hqdefault.jpg');
    expect(items[1]?.publishedAt).toBe('');
    expect(items[2]?.publishedAt).toBe(new Date(1767400000 * 1000).toISOString());
  });

  it('calls a shape it cannot read a platform change', () => {
    expect(() =>
      parseFlatList(
        { _type: 'video', id: 'x' },
        { platform: 'kick', kind: 'streams', channelKey: 'acme' },
      ),
    ).toThrow(expect.objectContaining({ code: 'platform_changed' }));
    expect(
      parseFlatList(
        { _type: 'playlist' },
        { platform: 'kick', kind: 'streams', channelKey: 'acme' },
      ).items,
    ).toEqual([]);
  });
});

describe('createYtDlpFlatLister', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'pg-flat-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function runToolAnswering(
    json: unknown,
    calls: Array<{ args: readonly string[]; options: RunToolOptions }>,
  ): RunTool {
    return async (_tool, args, options) => {
      calls.push({ args, options });
      return { exitCode: 0, stdout: JSON.stringify(json), stderrTail: '', durationMs: 1 };
    };
  }

  const kickRef: ChannelRef = {
    platform: 'kick',
    handle: 'acme',
    externalId: 'acme',
    displayName: 'Acme',
    avatarUrl: null,
  };

  it('pages by index and asks for one more to know there is a next page', async () => {
    const calls: Array<{ args: readonly string[]; options: RunToolOptions }> = [];
    const lister = createYtDlpFlatLister('kick', {
      paths,
      runTool: runToolAnswering(flatKick, calls),
      scratchDir: dir,
    });
    const first = await lister.list(kickRef, { kind: 'streams', limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBe('3');
    expect(calls[0]?.args[calls[0].args.indexOf('-I') + 1]).toBe('1:3');
    expect(calls[0]?.options.timeoutMs).toBeLessThanOrEqual(25_000);
    const second = await lister.list(kickRef, { kind: 'streams', limit: 50, cursor: '3' });
    expect(second.nextCursor).toBeUndefined();
    expect(calls[1]?.args[calls[1].args.indexOf('-I') + 1]).toBe('3:53');
    expect(await lister.list(kickRef, { kind: 'streams', limit: 50, cursor: '1001' })).toEqual({
      items: [],
    });
    expect(await lister.list(kickRef, { kind: 'streams', limit: 50, cursor: '../x' })).toEqual({
      items: [],
    });
  });

  it('resolves a YouTube handle to its channel id', async () => {
    const lister = createYtDlpFlatLister('youtube', {
      paths,
      runTool: runToolAnswering(flatYoutube, []),
      scratchDir: dir,
    });
    expect(await lister.resolve('acme')).toEqual({
      platform: 'youtube',
      handle: '@acme',
      externalId: 'UCsimacme000000000000001',
      displayName: 'Acme',
      avatarUrl: null,
    });
  });

  it('maps failures to channel codes', async () => {
    const failing =
      (stderrTail: string, extra: Partial<{ aborted: boolean; timedOut: boolean }> = {}): RunTool =>
      async (tool) => {
        throw new ToolError({ tool, exitCode: 1, stderrTail, ...extra });
      };
    const cases: Array<[RunTool, string]> = [
      [failing('ERROR: [kick:videos] acme: HTTP Error 404: Not Found'), 'channel_not_found'],
      [failing('ERROR: HTTP Error 429: Too Many Requests'), 'platform_rate_limited'],
      [failing('ERROR: Unable to extract channel data'), 'platform_changed'],
      [failing('', { timedOut: true }), 'channel_listing_failed'],
      [failing('', { aborted: true }), 'cancelled'],
      [
        async () => ({ exitCode: 0, stdout: 'not json', stderrTail: '', durationMs: 1 }),
        'platform_changed',
      ],
    ];
    for (const [runTool, code] of cases) {
      const lister = createYtDlpFlatLister('kick', { paths, runTool, scratchDir: dir });
      await expect(lister.list(kickRef, { kind: 'streams', limit: 10 })).rejects.toMatchObject({
        code,
      });
    }
  });
});
