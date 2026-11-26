/**
 * A clip's captions fetched for a render (Sprint 13, Module 03): the words
 * with the video's fixes applied, the style resolved, and above all tenancy:
 * a transcript id that is not this workspace's, of this video, is never read.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  builtInCaptionStyle,
  type ClipDocument,
  CURRENT_SCHEMA_VERSION,
  emptyTranscript,
  encodeTranscript,
  mergeTranscript,
  transcriptAssetMeta,
} from '@postgear/video-engine';
import { FakePrivateStorage, FakeRows, ORG, VIDEO_ID } from '../testing/fakes';
import { fetchCaptions } from './files';

const TRANSCRIPT_ID = '33333333-4444-4555-8666-777777777777';
const STYLE_ID = '44444444-5555-4666-8777-888888888888';
const KEY = `clips/${ORG}/${VIDEO_ID}/transcript-${'d'.repeat(32)}.json.gz`;
const OTHER_VIDEO = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

const heard = mergeTranscript(emptyTranscript('en', 'simulation'), {
  ranges: [{ fromMs: 0, toMs: 30_000 }],
  words: [
    { start: 1_000, end: 1_400, text: 'Hello', sure: 0.9 },
    { start: 1_500, end: 1_900, text: 'Arvin.', sure: 0.4 },
  ],
});

function document(styleId = 'bold-pop', transcriptAssetId = TRANSCRIPT_ID): ClipDocument {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    canvas: { ratio: '9:16', width: 1080, height: 1920, fps: 30, background: '#000000' },
    sources: [{ id: 'src', videoId: VIDEO_ID }],
    segments: [{ id: 'seg', source: 'src', sourceIn: 0, sourceOut: 10_000, speed: 1, volume: 1 }],
    layout: {
      kind: 'fullscreen',
      areas: [
        {
          id: 'main',
          name: 'Video',
          frame: { x: 0, y: 0, w: 1, h: 1 },
          crop: [{ at: 0, rect: { x: 0, y: 0, w: 1, h: 1 } }],
          fit: 'cover',
        },
      ],
    },
    zooms: [],
    looks: { colour: 'none', strength: 0, vignette: 0 },
    fades: { inMs: 0, outMs: 0 },
    tracks: [
      {
        id: 'cc',
        kind: 'captions',
        transcriptAssetId,
        language: 'en',
        styleId,
        position: { x: 0.5, y: 0.72 },
        sizePx: 86,
        maxWords: 3,
        edits: {},
      },
    ],
    bleeps: [],
  };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'pg-captions-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function setup(options: { source?: 'listened' | 'supplied'; videoId?: string } = {}) {
  const rows = new FakeRows();
  const storage = new FakePrivateStorage();
  storage.objects.set(KEY, gzipSync(Buffer.from(encodeTranscript(heard))));
  rows.assets.push({
    id: TRANSCRIPT_ID,
    kind: 'TRANSCRIPT',
    key: KEY,
    bytes: 1,
    videoId: options.videoId ?? VIDEO_ID,
    clipId: null,
    meta: {
      ...transcriptAssetMeta(heard, [{ at: 1_500, text: 'Arvind.' }]),
      source: options.source ?? 'listened',
    },
    createdAt: new Date(),
  });
  const deps = { rows, privateStorage: storage as never };
  return { rows, storage, deps };
}

describe('fetchCaptions', () => {
  it('answers nothing for a clip with no captions', async () => {
    const { deps } = setup();
    const doc = { ...document(), tracks: [] };
    await expect(fetchCaptions(deps, ORG, VIDEO_ID, doc, dir)).resolves.toBeUndefined();
  });

  it("hands over the words with the video's fixes applied and the built-in look", async () => {
    const { deps } = setup();
    const captions = await fetchCaptions(deps, ORG, VIDEO_ID, document(), dir);
    expect(captions?.transcript.words.map((word) => [word.text, word.sure])).toEqual([
      ['Hello', 0.9],
      ['Arvind.', 1],
    ]);
    expect(captions?.look).toEqual(builtInCaptionStyle('bold-pop')?.look);
    expect(captions?.wordTimed).toBe(true);
    expect(captions).not.toHaveProperty('sourceId');
  });

  it('marks a supplied file as not word timed, so the page is highlighted', async () => {
    const { deps } = setup({ source: 'supplied' });
    expect((await fetchCaptions(deps, ORG, VIDEO_ID, document(), dir))?.wordTimed).toBe(false);
  });

  it("uses the workspace's own style, and the default look when it was deleted", async () => {
    const { deps, rows } = setup();
    const own = { ...builtInCaptionStyle('clean')?.look, colour: '#FF00FF' };
    rows.captionStyles.set(STYLE_ID, {
      id: STYLE_ID,
      name: 'Mine',
      look: own,
      organizationId: ORG,
    });
    expect((await fetchCaptions(deps, ORG, VIDEO_ID, document(STYLE_ID), dir))?.look.colour).toBe(
      '#FF00FF',
    );
    rows.captionStyles.clear();
    expect((await fetchCaptions(deps, ORG, VIDEO_ID, document(STYLE_ID), dir))?.look).toEqual(
      builtInCaptionStyle('bold-pop')?.look,
    );
  });

  it("never reads another workspace's style", async () => {
    const { deps, rows } = setup();
    const theirs = { ...builtInCaptionStyle('clean')?.look, colour: '#FF00FF' };
    rows.captionStyles.set(STYLE_ID, {
      id: STYLE_ID,
      name: 'Theirs',
      look: theirs,
      organizationId: 'other-org',
    });
    expect((await fetchCaptions(deps, ORG, VIDEO_ID, document(STYLE_ID), dir))?.look.colour).toBe(
      '#FFFFFF',
    );
  });

  it.each([
    [
      'an id that is not in the workspace',
      () => document('bold-pop', '99999999-8888-4777-8666-555555555555'),
      {},
    ],
    [
      'a transcript of another video (an id copied from elsewhere)',
      () => document(),
      { videoId: OTHER_VIDEO },
    ],
  ])('stops with captions_missing for %s, and reads nothing', async (_name, makeDoc, options) => {
    const { deps, storage } = setup(options as { videoId?: string });
    const gets: string[] = [];
    const original = storage.getToFile.bind(storage);
    storage.getToFile = async (key: string, file: string) => {
      gets.push(key);
      return original(key, file);
    };
    await expect(fetchCaptions(deps, ORG, VIDEO_ID, makeDoc(), dir)).rejects.toMatchObject({
      code: 'captions_missing',
      retryable: false,
    });
    expect(gets).toEqual([]);
  });

  it("asks for the video's assets with the caller's workspace, never by id alone", async () => {
    const { deps, rows } = setup();
    const asked: Array<[string, string]> = [];
    const original = rows.videoAssets.bind(rows);
    rows.videoAssets = async (org: string, videoId: string) => {
      asked.push([org, videoId]);
      // The real rows scope the query by workspace: another workspace's request finds nothing.
      return org === ORG ? original(org, videoId) : [];
    };
    await fetchCaptions(deps, ORG, VIDEO_ID, document(), dir);
    await expect(fetchCaptions(deps, 'other-org', VIDEO_ID, document(), dir)).rejects.toMatchObject(
      { code: 'captions_missing' },
    );
    expect(asked).toEqual([
      [ORG, VIDEO_ID],
      ['other-org', VIDEO_ID],
    ]);
  });

  it('stops with captions_missing when the file is gone or does not read', async () => {
    const gone = setup();
    gone.storage.objects.clear();
    await expect(fetchCaptions(gone.deps, ORG, VIDEO_ID, document(), dir)).rejects.toMatchObject({
      code: 'captions_missing',
    });
    const broken = setup();
    broken.storage.objects.set(KEY, gzipSync(Buffer.from('{"not":"a transcript"}')));
    await expect(fetchCaptions(broken.deps, ORG, VIDEO_ID, document(), dir)).rejects.toMatchObject({
      code: 'captions_missing',
    });
  });

  it('names the source whose words these are in a clip with several videos', async () => {
    const { deps } = setup();
    const doc = document();
    doc.sources = [...doc.sources, { id: 'two', videoId: OTHER_VIDEO }];
    expect((await fetchCaptions(deps, ORG, VIDEO_ID, doc, dir))?.sourceId).toBe('src');
  });
});
