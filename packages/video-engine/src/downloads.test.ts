import {
  downloadableFormats,
  downloadExtension,
  downloadFileName,
  downloadMenuLabel,
  expiresInLine,
  isDownloadExpired,
} from './downloads';
import { downloadInputSchema, downloadOutputSchema } from './jobs';
import type { LinkFormat } from './links/types';

function video(height: number, bytes: number | null = null): LinkFormat {
  return {
    id: `h${height}`,
    label: `${height}p`,
    height,
    fps: 30,
    ext: 'mp4',
    bytes,
    audioOnly: false,
  };
}

const AUDIO: LinkFormat = {
  id: 'audio',
  label: 'Audio Only',
  height: null,
  fps: null,
  ext: 'm4a',
  bytes: 3_000_000,
  audioOnly: true,
};

describe('downloadableFormats', () => {
  it('offers heights up to 1080p, tallest first, then Audio Only', () => {
    const offered = downloadableFormats([AUDIO, video(360), video(2160), video(1080), video(720)]);
    expect(offered.map((format) => format.id)).toEqual(['h1080', 'h720', 'h360', 'audio']);
  });

  it('leaves out a video entry with no height, and works without an audio entry', () => {
    const odd = { ...video(480), height: null };
    expect(downloadableFormats([odd, video(480)]).map((format) => format.id)).toEqual(['h480']);
  });
});

describe('downloadMenuLabel', () => {
  it('adds the size when the platform gave one', () => {
    expect(downloadMenuLabel(video(1080, 412_000_000))).toBe('1080p (412 MB)');
    expect(downloadMenuLabel(video(720))).toBe('720p');
  });

  it('never shows a size on Audio Only (it is converted to MP3)', () => {
    expect(downloadMenuLabel(AUDIO)).toBe('Audio Only');
  });
});

describe('downloadFileName', () => {
  it('keeps a plain title and adds the extension', () => {
    expect(downloadFileName('Ranked grind until I hit Diamond', 'mp4')).toBe(
      'Ranked grind until I hit Diamond.mp4',
    );
    expect(downloadExtension(true)).toBe('mp3');
    expect(downloadExtension(false)).toBe('mp4');
  });

  it('makes an odd title safe for every file system', () => {
    expect(downloadFileName('../../etc/passwd', 'mp4')).toBe('etc passwd.mp4');
    expect(downloadFileName('a:b*c?"d"<e>|f\u0007', 'mp3')).toBe('a b c d e f.mp3');
    expect(downloadFileName('   ...   ', 'mp4')).toBe('Download.mp4');
    expect(downloadFileName('Tamil தமிழ்', 'mp4')).toBe(
      'Tamil தமிழ்.mp4',
    );
  });

  it('stays within 150 characters with the extension', () => {
    const name = downloadFileName('x'.repeat(400), 'mp4');
    expect(name).toHaveLength(150);
    expect(name.endsWith('.mp4')).toBe(true);
  });
});

describe('expiresInLine', () => {
  const now = new Date('2026-11-19T10:00:00.000Z');

  it('rounds hours down', () => {
    expect(expiresInLine('2026-11-20T09:59:00.000Z', now)).toBe('Expires in 23 hours');
    expect(expiresInLine('2026-11-19T11:30:00.000Z', now)).toBe('Expires in 1 hour');
  });

  it('counts minutes in the last hour', () => {
    expect(expiresInLine('2026-11-19T10:40:30.000Z', now)).toBe('Expires in 40 minutes');
    expect(expiresInLine('2026-11-19T10:01:00.000Z', now)).toBe('Expires in 1 minute');
    expect(expiresInLine('2026-11-19T10:00:20.000Z', now)).toBe('Expires in less than a minute');
  });

  it('is null once it has expired or the date does not read', () => {
    expect(expiresInLine('2026-11-19T10:00:00.000Z', now)).toBeNull();
    expect(expiresInLine('not a date', now)).toBeNull();
    expect(expiresInLine(null, now)).toBeNull();
  });

  it('agrees with isDownloadExpired', () => {
    expect(isDownloadExpired('2026-11-19T10:00:00.000Z', now)).toBe(true);
    expect(isDownloadExpired(new Date('2026-11-19T10:00:01.000Z'), now)).toBe(false);
    expect(isDownloadExpired(null, now)).toBe(false);
  });
});

describe('the DOWNLOAD job schemas', () => {
  const input = {
    link: {
      platform: 'youtube',
      kind: 'video',
      externalId: 'simtalk0001',
      canonicalUrl: 'https://www.youtube.com/watch?v=simtalk0001',
    },
    formatId: 'h720',
    label: '720p',
    audioOnly: false,
    title: 'A three minute talk',
    durationMs: 180_000,
    expectedBytes: null,
    maxBytes: 5_000_000_000,
    rights: { byUserId: 'user-1', at: '2026-11-19T10:00:00.000Z', textVersion: '2026-11-14' },
  };

  it('reads a full input and refuses one without the rights record', () => {
    expect(downloadInputSchema.safeParse(input).success).toBe(true);
    const { rights: _rights, ...withoutRights } = input;
    expect(downloadInputSchema.safeParse(withoutRights).success).toBe(false);
    expect(downloadInputSchema.safeParse({ ...input, extra: 1 }).success).toBe(false);
  });

  it('reads an output with and without Save To Media', () => {
    const output = {
      assetId: '0f0e8b8c-3c2b-4b7e-9d8a-3f6c1d2e4a5b',
      key: 'clips/seed-demo-org/downloads/0f0e8b8c-3c2b-4b7e-9d8a-3f6c1d2e4a5b/file.mp4',
      bytes: 1_000,
      ext: 'mp4',
      fileName: 'A three minute talk.mp4',
      durationMs: 180_000,
      width: 1280,
      height: 720,
      fps: 30,
    };
    expect(downloadOutputSchema.safeParse(output).success).toBe(true);
    expect(
      downloadOutputSchema.safeParse({ ...output, media: { status: 'saving', mediaId: null } })
        .success,
    ).toBe(true);
    expect(downloadOutputSchema.safeParse({ ...output, ext: 'm4a' }).success).toBe(false);
  });
});
