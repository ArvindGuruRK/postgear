/**
 * What a page may see of a video, a clip's source and an exported file:
 * never a storage key or a tool's text, our sentence for a failure, and
 * an https platform link only.
 */
import { clipErrorMessage } from '@postgear/video-engine';
import { exportFileName } from '../clip/clip-item.service';
import { sharpSourceFor } from '../clip/sharp-source';
import { videoRow } from '../testing/rows';
import { filmstripMetaOf, orderedSheets, toVideoView } from './clip-video-view';
import { decodeCursor, encodeCursor } from './clip-videos.service';

const VIEW_FIELDS = [
  'channelName',
  'createdAt',
  'durationMs',
  'error',
  'expiresAt',
  'fps',
  'hasAudio',
  'hdAvailable',
  'height',
  'id',
  'kind',
  'lastUsedAt',
  'link',
  'platform',
  'posterUrl',
  'status',
  'title',
  'width',
];

describe('toVideoView', () => {
  it('names only the documented fields, none of them a key or a workspace', () => {
    const view = toVideoView(videoRow(), 'https://signed.example/poster.jpg');
    expect(Object.keys(view).sort()).toEqual(VIEW_FIELDS);
    const text = JSON.stringify(view);
    expect(text).not.toContain('clips/');
    expect(text).not.toContain('seed-demo-org');
    expect(view.platform).toBe('twitch');
    expect(view.kind).toBe('past_stream');
  });

  it('answers our sentence for a failure, whatever text the row holds', () => {
    const view = toVideoView(
      videoRow({
        status: 'FAILED',
        error: { code: 'import_failed', message: 'ERROR: yt-dlp exited 1 at /tmp/x' },
      }),
    );
    expect(view.error).toEqual({
      code: 'import_failed',
      message: clipErrorMessage('import_failed'),
    });
    expect(JSON.stringify(view)).not.toContain('yt-dlp');
  });

  it('shows no error unless the video failed', () => {
    const view = toVideoView(
      videoRow({ status: 'READY', error: { code: 'import_failed', message: 'x' } }),
    );
    expect(view.error).toBeNull();
  });

  it('shows an https platform link only, and none for an upload', () => {
    expect(toVideoView(videoRow({ canonicalUrl: 'http://twitch.tv/videos/1' })).link).toBeNull();
    expect(toVideoView(videoRow({ platform: 'UPLOAD', kind: 'UPLOAD' })).link).toBeNull();
    expect(toVideoView(videoRow({ platform: 'UPLOAD', kind: 'UPLOAD' })).platform).toBe('upload');
  });
});

describe('asset meta', () => {
  it('reads a malformed filmstrip as none', () => {
    expect(filmstripMetaOf({ tileWidth: 'wide' })).toBeNull();
  });

  it('orders filmstrip sheets by their place in the strip', () => {
    const at = new Date('2026-11-01T00:00:00Z');
    const sheet = (id: string, index: number) => ({
      id,
      kind: 'FILMSTRIP' as const,
      key: id,
      meta: { sheet: index },
      createdAt: at,
    });
    const ordered = orderedSheets([sheet('c', 2), sheet('a', 0), sheet('b', 1)] as never);
    expect(ordered.map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('sharpSourceFor', () => {
  const doc = { segments: [{ sourceIn: 10_000, sourceOut: 40_000 }] } as never;
  const at = (seconds: number) => new Date(1_700_000_000_000 + seconds * 1000);

  it('picks the tallest segment that covers the clip, with its offset', () => {
    const source = sharpSourceFor(doc, [
      {
        id: 's1',
        kind: 'SEGMENT',
        key: 'k1',
        meta: { fromMs: 0, toMs: 60_000, height: 720, fps: 30 },
        createdAt: at(1),
      },
      {
        id: 's2',
        kind: 'SEGMENT',
        key: 'k2',
        meta: { fromMs: 5_000, toMs: 45_000, height: 1080, fps: 30 },
        createdAt: at(2),
      },
      { id: 'p', kind: 'PROXY', key: 'kp', meta: null, createdAt: at(3) },
    ]);
    expect(source).toEqual(
      expect.objectContaining({ kind: 'segment', assetId: 's2', sourceOffsetMs: 5_000 }),
    );
  });

  it('falls back to the light copy when no segment covers a trim past the handles', () => {
    const source = sharpSourceFor(doc, [
      {
        id: 's1',
        kind: 'SEGMENT',
        key: 'k1',
        meta: { fromMs: 20_000, toMs: 60_000, height: 1080, fps: 30 },
        createdAt: at(1),
      },
      { id: 'p', kind: 'PROXY', key: 'kp', meta: null, createdAt: at(2) },
    ]);
    expect(source).toEqual(
      expect.objectContaining({ kind: 'proxy', assetId: 'p', sourceOffsetMs: 0 }),
    );
  });

  it('answers none when the video has no files', () => {
    expect(sharpSourceFor(doc, [])).toBeNull();
  });
});

describe('small helpers', () => {
  it('round-trips the list cursor and refuses a forged one', () => {
    const row = {
      createdAt: new Date('2026-11-01T10:00:00.000Z'),
      id: '22222222-2222-4222-8222-222222222222',
    };
    expect(decodeCursor(encodeCursor(row))).toEqual(row);
    expect(decodeCursor(Buffer.from('yesterday|1 OR 1=1').toString('base64url'))).toBeNull();
  });

  it('names an export file safely, always .mp4', () => {
    expect(exportFileName('My/Clip: "best" part')).toBe('My Clip best part.mp4');
    expect(exportFileName('...')).toBe('Clip.mp4');
  });
});
