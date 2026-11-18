import { PlaylistSliceError, sliceHlsPlaylist } from './playlist-slicer';

const PLAYLIST_URL = 'https://cdn.sim.invalid/vod/900000001/chunked/index-dvr.m3u8';

/** A Twitch-like VOD playlist: ten 10 s segments, relative names, vendor tags. */
function twitchPlaylist(count = 10, seconds = 10): string {
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${seconds}`,
    '#ID3-EQUIV-TDTG:2026-01-02T00:00:00',
    '#EXT-X-PLAYLIST-TYPE:EVENT',
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-TWITCH-ELAPSED-SECS:0.000',
    `#EXT-X-TWITCH-TOTAL-SECS:${count * seconds}.000`,
  ];
  for (let i = 0; i < count; i += 1) {
    lines.push(`#EXTINF:${seconds}.000,`, i === 3 ? `${i}-muted.ts` : `${i}.ts`);
  }
  lines.push('#EXT-X-ENDLIST');
  return lines.join('\n');
}

function segmentsOf(text: string): string[] {
  return text.split('\n').filter((line) => line.length > 0 && !line.startsWith('#'));
}

describe('sliceHlsPlaylist', () => {
  it('keeps the segments that cover the window, with absolute addresses and a VOD header', () => {
    const slice = sliceHlsPlaylist({
      text: twitchPlaylist(),
      playlistUrl: PLAYLIST_URL,
      fromMs: 25_000,
      toMs: 41_000,
    });
    expect(segmentsOf(slice.text)).toEqual([
      'https://cdn.sim.invalid/vod/900000001/chunked/2.ts',
      'https://cdn.sim.invalid/vod/900000001/chunked/3-muted.ts',
      'https://cdn.sim.invalid/vod/900000001/chunked/4.ts',
    ]);
    expect(slice.coveredStartMs).toBe(20_000);
    expect(slice.coveredEndMs).toBe(50_000);
    expect(slice.offsetMs).toBe(5_000);
    expect(slice.totalMs).toBe(100_000);
    expect(slice.segmentCount).toBe(3);
    const lines = slice.text.split('\n');
    expect(lines.slice(0, 5)).toEqual([
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:10',
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXT-X-PLAYLIST-TYPE:VOD',
    ]);
    expect(slice.text).toContain('#EXT-X-ENDLIST');
    expect(slice.text).not.toContain('TWITCH');
    expect(slice.text).not.toContain('EVENT');
  });

  it('covers the asked window exactly in every case', () => {
    const windows: Array<[number, number]> = [
      [0, 10_000],
      [0, 1],
      [9_999, 10_001],
      [10_000, 20_000],
      [33_333, 77_777],
      [95_000, 100_000],
    ];
    for (const [fromMs, toMs] of windows) {
      const slice = sliceHlsPlaylist({
        text: twitchPlaylist(),
        playlistUrl: PLAYLIST_URL,
        fromMs,
        toMs,
      });
      expect(slice.coveredStartMs).toBeLessThanOrEqual(fromMs);
      expect(slice.coveredEndMs).toBeGreaterThanOrEqual(toMs);
      // No segment more than needed on either side.
      expect(fromMs - slice.coveredStartMs).toBeLessThan(10_000);
      expect(slice.coveredEndMs - toMs).toBeLessThan(10_000);
      expect(slice.offsetMs).toBe(fromMs - slice.coveredStartMs);
    }
  });

  it('starts mid-segment and reports the offset to cut', () => {
    const slice = sliceHlsPlaylist({
      text: twitchPlaylist(),
      playlistUrl: PLAYLIST_URL,
      fromMs: 12_345,
      toMs: 14_000,
    });
    expect(segmentsOf(slice.text)).toEqual(['https://cdn.sim.invalid/vod/900000001/chunked/1.ts']);
    expect(slice.offsetMs).toBe(2_345);
  });

  it('stops at the end when the window runs past it', () => {
    const slice = sliceHlsPlaylist({
      text: twitchPlaylist(),
      playlistUrl: PLAYLIST_URL,
      fromMs: 85_000,
      toMs: 500_000,
    });
    expect(segmentsOf(slice.text)).toHaveLength(2);
    expect(slice.coveredEndMs).toBe(100_000);
  });

  it('refuses a window that starts past the end', () => {
    expect(() =>
      sliceHlsPlaylist({
        text: twitchPlaylist(),
        playlistUrl: PLAYLIST_URL,
        fromMs: 100_000,
        toMs: 110_000,
      }),
    ).toThrow(new PlaylistSliceError('empty_window'));
    expect(() =>
      sliceHlsPlaylist({ text: twitchPlaylist(), playlistUrl: PLAYLIST_URL, fromMs: 5, toMs: 5 }),
    ).toThrow(PlaylistSliceError);
  });

  it('keeps discontinuities between kept segments, and none before the first', () => {
    // Kick-like: 12.5 s segments, program dates, a dropped stream before segment 3 and 5.
    const text = [
      '#EXTM3U',
      '#EXT-X-VERSION:4',
      '#EXT-X-TARGETDURATION:13',
      '#EXT-X-PLAYLIST-TYPE:EVENT',
      '#EXT-X-PROGRAM-DATE-TIME:2026-02-24T10:00:00.000Z',
      '#EXTINF:12.5,',
      'https://stream.sim.invalid/a/0.ts',
      '#EXTINF:12.5,',
      'https://stream.sim.invalid/a/1.ts',
      '#EXTINF:12.5,',
      'https://stream.sim.invalid/a/2.ts',
      '#EXT-X-DISCONTINUITY',
      '#EXT-X-PROGRAM-DATE-TIME:2026-02-24T10:03:00.000Z',
      '#EXTINF:6.25,',
      'https://stream.sim.invalid/b/0.ts',
      '#EXTINF:12.5,',
      'https://stream.sim.invalid/b/1.ts',
      '#EXT-X-DISCONTINUITY',
      '#EXTINF:12.5,',
      'https://stream.sim.invalid/c/0.ts',
    ].join('\r\n');
    const inside = sliceHlsPlaylist({
      text,
      playlistUrl: 'https://stream.sim.invalid/a/playlist.m3u8',
      fromMs: 30_000,
      toMs: 45_000,
    });
    expect(
      inside.text
        .split('\n')
        .filter((line) => !line.startsWith('#EXT-X-') || line === '#EXT-X-DISCONTINUITY')
        .filter((l) => l.length > 0 && l !== '#EXTM3U'),
    ).toEqual([
      '#EXTINF:12.5,',
      'https://stream.sim.invalid/a/2.ts',
      '#EXT-X-DISCONTINUITY',
      '#EXTINF:6.25,',
      'https://stream.sim.invalid/b/0.ts',
      '#EXTINF:12.5,',
      'https://stream.sim.invalid/b/1.ts',
    ]);
    expect(inside.coveredStartMs).toBe(25_000);
    expect(inside.coveredEndMs).toBe(56_250);
    expect(inside.text).not.toContain('PROGRAM-DATE-TIME');

    // A window that starts right after a discontinuity carries no leading tag.
    const after = sliceHlsPlaylist({
      text,
      playlistUrl: 'https://stream.sim.invalid/a/playlist.m3u8',
      fromMs: 38_000,
      toMs: 40_000,
    });
    expect(after.text).not.toContain('#EXT-X-DISCONTINUITY');
    expect(segmentsOf(after.text)).toEqual(['https://stream.sim.invalid/b/0.ts']);
  });

  it('adds up long playlists without drift', () => {
    // 10,800 segments of 12.5 s (a 37 hour Kick stream) and 2.002 s fractions.
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 10_800; i += 1) lines.push('#EXTINF:2.002,', `${i}.ts`);
    const slice = sliceHlsPlaylist({
      text: lines.join('\n'),
      playlistUrl: PLAYLIST_URL,
      fromMs: 20_020_000,
      toMs: 20_022_002,
    });
    expect(segmentsOf(slice.text)).toEqual([
      'https://cdn.sim.invalid/vod/900000001/chunked/10000.ts',
    ]);
    expect(slice.coveredStartMs).toBe(20_020_000);
    expect(slice.offsetMs).toBe(0);
  });

  it('keeps and repeats the map tag with an absolute address', () => {
    const text = [
      '#EXTM3U',
      '#EXT-X-VERSION:7',
      '#EXT-X-INDEPENDENT-SEGMENTS',
      '#EXT-X-MAP:URI="init.mp4"',
      '#EXTINF:4.0,',
      'seg0.m4s',
      '#EXTINF:4.0,',
      'seg1.m4s',
      '#EXT-X-DISCONTINUITY',
      '#EXT-X-MAP:URI="init-2.mp4"',
      '#EXTINF:4.0,',
      'seg2.m4s',
    ].join('\n');
    const slice = sliceHlsPlaylist({
      text,
      playlistUrl: 'https://cdn.sim.invalid/v/index.m3u8',
      fromMs: 5_000,
      toMs: 9_000,
    });
    const lines = slice.text.split('\n');
    expect(lines).toContain('#EXT-X-INDEPENDENT-SEGMENTS');
    expect(lines).toContain('#EXT-X-VERSION:7');
    const body = lines.slice(lines.indexOf('#EXT-X-INDEPENDENT-SEGMENTS') + 1);
    expect(body.slice(0, 7)).toEqual([
      '#EXT-X-MAP:URI="https://cdn.sim.invalid/v/init.mp4"',
      '#EXTINF:4.0,',
      'https://cdn.sim.invalid/v/seg1.m4s',
      '#EXT-X-DISCONTINUITY',
      '#EXT-X-MAP:URI="https://cdn.sim.invalid/v/init-2.mp4"',
      '#EXTINF:4.0,',
      'https://cdn.sim.invalid/v/seg2.m4s',
    ]);
  });

  it('refuses master playlists, encryption, byte ranges and other schemes', () => {
    const refusals: Array<[string, string]> = [
      ['#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow.m3u8', 'not_media_playlist'],
      ['#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="k"\n#EXTINF:1,\n0.ts', 'encrypted'],
      ['#EXTM3U\n#EXTINF:1,\n#EXT-X-BYTERANGE:100@0\n0.ts', 'byte_range'],
      ['#EXTM3U\n#EXTINF:1,\nfile:///etc/passwd', 'bad_playlist'],
      ['#EXTM3U\n#EXTINF:1,\nhttp://cdn.sim.invalid/0.ts', 'bad_playlist'],
      ['#EXTM3U\n0.ts', 'bad_playlist'],
      ['#EXTM3U\n#EXTINF:-3,\n0.ts', 'bad_playlist'],
      ['#EXTM3U\n#EXTINF:abc,\n0.ts', 'bad_playlist'],
      ['not a playlist', 'bad_playlist'],
    ];
    for (const [text, code] of refusals) {
      try {
        sliceHlsPlaylist({ text, playlistUrl: PLAYLIST_URL, fromMs: 0, toMs: 1_000 });
        throw new Error(`expected ${code}`);
      } catch (error) {
        expect(error).toBeInstanceOf(PlaylistSliceError);
        expect((error as PlaylistSliceError).code).toBe(code);
      }
    }
    // A key of METHOD=NONE is fine.
    expect(
      sliceHlsPlaylist({
        text: '#EXTM3U\n#EXT-X-KEY:METHOD=NONE\n#EXTINF:1,\n0.ts',
        playlistUrl: PLAYLIST_URL,
        fromMs: 0,
        toMs: 500,
      }).segmentCount,
    ).toBe(1);
  });

  it('refuses a playlist over the size cap', () => {
    expect(() =>
      sliceHlsPlaylist({
        text: `#EXTM3U\n${'#'.repeat(5 * 1024 * 1024)}`,
        playlistUrl: PLAYLIST_URL,
        fromMs: 0,
        toMs: 1,
      }),
    ).toThrow(new PlaylistSliceError('too_large'));
  });
});
