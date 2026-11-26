/**
 * A clip's captions and the workspace's caption styles (Sprint 13, Module 03)
 * against an in-memory database, ledger and transcript store: the track that
 * is answered, what is listened to (only what the clip plays), a supplied
 * file on either clock, a translation charged once and given back on failure,
 * a deleted clip's own transcripts, tenancy, and no speech text in any log.
 */
import { HttpException, Logger } from '@nestjs/common';
import type { ClipAsset } from '@postgear/db';
import {
  builtInCaptionStyle,
  type CaptionsTrack,
  type ClipDocument,
  createCaptionsTrack,
  createClipDocument,
  emptyTranscript,
  mergeTranscript,
  readTranscriptAssetMeta,
  type Transcript,
  transcriptAssetMeta,
  updateCaptionsTrack,
  withCaptionsTrack,
} from '@postgear/video-engine';
import { createSimulatedModelClient, translateLines } from '@postgear/ai-engine';
import type { AiEngine } from '../../ai/engine/engine.types';
import type { UsageService } from '../../entitlements/usage.service';
import { ClipItemService } from '../clip/clip-item.service';
import type { ClipLimitsGuard } from '../limits/clip-limits.guard';
import {
  assetRow,
  clipRow,
  emptyTables,
  type FakeClipDb,
  type FakeTables,
  fakeClipDb,
} from '../testing/fake-clip-db';
import { TEST_ORG, TEST_USER, videoRow } from '../testing/rows';
import type { ClipTranscriptStore } from '../transcripts/clip-transcript-store';
import type { ClipTranscriptsService } from '../transcripts/clip-transcripts.service';
import { ClipTranscriptsService as RealTranscripts } from '../transcripts/clip-transcripts.service';
import { ClipVideosRepository } from '../videos/clip-videos.repository';
import { ClipCaptionStylesRepository } from './clip-caption-styles.repository';
import { createCaptionStyleSchema, updateCaptionStyleSchema } from './clip-caption-styles.schema';
import { ClipCaptionStylesService } from './clip-caption-styles.service';
import { ClipCaptionsService, decodeText } from './clip-captions.service';

let mockDb: FakeClipDb;
jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');
  return {
    ...actual,
    prisma: new Proxy(
      {},
      { get: (_target, key) => (mockDb as Record<string | symbol, unknown>)[key] },
    ),
  };
});

const VIDEO = videoRow().id;
const CLIP = clipRow().id;
const OTHER_ORG = 'seed-second-org';
const TEN_MINUTES = 600_000;
const HEARD_ID = '77777777-7777-4777-8777-777777777777';
const HEARD_KEY = `clips/${TEST_ORG}/${VIDEO}/transcript-${'c'.repeat(32)}.json.gz`;
const LOOK = builtInCaptionStyle('clean')?.look;

/** The clip plays 120 s to 150 s of the video. */
function document(fromMs = 120_000, toMs = 150_000): ClipDocument {
  return createClipDocument({ videoId: VIDEO, fromMs, toMs, ratio: '9:16' });
}

/** One word a second from `fromSec`, sentences of five words. */
function listened(fromSec: number, toSec: number): Transcript {
  return mergeTranscript(emptyTranscript('en', 'simulation'), {
    ranges: [{ fromMs: fromSec * 1000, toMs: toSec * 1000 }],
    words: Array.from({ length: toSec - fromSec }, (_, index) => ({
      start: (fromSec + index) * 1000,
      end: (fromSec + index) * 1000 + 600,
      text: index % 5 === 4 ? `secret${index}.` : `secret${index}`,
      sure: 0.9,
    })),
  });
}

function fakeLedger() {
  const entries: Array<{ id: string; key: string; units: number; refId: string | null }> = [];
  const used = () => entries.reduce((sum, entry) => sum + entry.units, 0);
  const usage = {
    consume: jest.fn(
      async (
        _org: string,
        _meter: string,
        units: number,
        options: { idempotencyKey: string; refId?: string },
      ) => {
        const entry = {
          id: `entry-${entries.length + 1}`,
          key: options.idempotencyKey,
          units,
          refId: options.refId ?? null,
        };
        entries.push(entry);
        return {
          entryId: entry.id,
          duplicate: false,
          over: false,
          state: {
            used: used(),
            limit: 300,
            remaining: 300 - used(),
            cycleStart: new Date('2026-11-01T00:00:00.000Z'),
            cycleEnd: new Date('2026-12-01T00:00:00.000Z'),
          },
        };
      },
    ),
    reverseAllFor: jest.fn(async (_org: string, refId: string) => {
      const charges = entries.filter((entry) => entry.refId === refId && entry.units > 0);
      for (const charge of charges) {
        entries.push({
          id: `rev-${charge.id}`,
          key: `rev:${charge.id}`,
          units: -charge.units,
          refId,
        });
      }
      return charges.length;
    }),
  };
  return { usage, entries, used };
}

interface SetupOptions {
  /** The video's own transcript: the seconds listened to, or null for none. */
  heard?: [number, number] | null;
  document?: ClipDocument;
  ai?: 'simulation' | 'off' | 'failing';
}

function setup(options: SetupOptions = {}) {
  const tables: FakeTables = emptyTables();
  tables.videos.push(videoRow({ status: 'READY', durationMs: TEN_MINUTES, hasAudio: true }));
  const files = new Map<string, Transcript>();
  const heard = options.heard === undefined ? ([0, 300] as [number, number]) : options.heard;
  if (heard) {
    const transcript = listened(heard[0], heard[1]);
    files.set(HEARD_KEY, transcript);
    tables.assets.push(
      assetRow({
        id: HEARD_ID,
        organizationId: TEST_ORG,
        videoId: VIDEO,
        clipId: null,
        kind: 'TRANSCRIPT',
        key: HEARD_KEY,
        meta: transcriptAssetMeta(transcript),
      } as Partial<ClipAsset>),
    );
  }
  tables.clips.push(clipRow({ document: options.document ?? document() }));
  mockDb = fakeClipDb(tables);

  const store = {
    read: jest.fn(async (key: string) => files.get(key) ?? null),
    write: jest.fn(async (key: string, transcript: Transcript) => {
      files.set(key, transcript);
      return 100;
    }),
    delete: jest.fn(async (key: string) => {
      files.delete(key);
    }),
  };
  const ledger = fakeLedger();
  const ensure = jest.fn();
  // The real service for reading rows and words; `ensure` (Module 02's own spec) is watched.
  const transcripts = new RealTranscripts(
    new ClipVideosRepository(),
    {} as never,
    {} as never,
    { assertEnabled: jest.fn(async () => undefined) } as unknown as ClipLimitsGuard,
    ledger.usage as unknown as UsageService,
    store as unknown as ClipTranscriptStore,
    { state: jest.fn(async () => 'ok') } as never,
  );
  const realEnsure = transcripts.ensure.bind(transcripts);
  transcripts.ensure = ensure.mockImplementation(realEnsure) as never;

  const model = createSimulatedModelClient();
  const translate = jest.fn(
    async (
      request: Parameters<typeof translateLines>[1],
      callOptions?: { signal?: AbortSignal },
    ) => {
      if (options.ai === 'failing') {
        throw Object.assign(new Error('The provider said: secret0 secret1'), {
          kind: 'unavailable',
        });
      }
      return translateLines(model, request, callOptions);
    },
  );
  const ai = {
    modelName: 'simulation',
    createSnippetWriter: jest.fn(() => (options.ai === 'off' ? null : { translate })),
  } as unknown as AiEngine;

  const styles = new ClipCaptionStylesService(new ClipCaptionStylesRepository());
  const items = Object.create(ClipItemService.prototype) as ClipItemService;
  const service = new ClipCaptionsService(
    items,
    new ClipVideosRepository(),
    transcripts as unknown as ClipTranscriptsService,
    styles,
    store as unknown as ClipTranscriptStore,
    ledger.usage as unknown as UsageService,
    { assertEnabled: jest.fn(async () => undefined) } as unknown as ClipLimitsGuard,
    ai,
  );
  return { service, styles, tables, files, store, ledger, ensure, translate };
}

/** Saves `track` into the stored clip, as the editor's next save would. */
function saveTrack(tables: FakeTables, track: CaptionsTrack): void {
  const clip = tables.clips[0];
  if (!clip) throw new Error('no clip');
  clip.document = withCaptionsTrack(clip.document as unknown as ClipDocument, track) as never;
}

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return { status: error.getStatus(), body: error.getResponse() as Record<string, unknown> };
    }
    throw error;
  }
  throw new Error('expected a refusal');
}

const srt = (cues: Array<[string, string, string]>) =>
  cues.map(([from, to, text], index) => `${index + 1}\n${from} --> ${to}\n${text}\n`).join('\n');
const file = (text: string, name = 'episode.srt') => {
  const buffer = Buffer.from(text, 'utf8');
  return { buffer, originalname: name, size: buffer.length };
};

describe('caption styles', () => {
  const body = (name: string) => createCaptionStyleSchema.parse({ name, look: LOOK });

  it('lists the six built in first, then the workspace own, oldest first', async () => {
    const { styles } = setup();
    await styles.create(TEST_ORG, TEST_USER, body('Mine'));
    await styles.create(TEST_ORG, TEST_USER, body('Second'));
    const answer = await styles.list(TEST_ORG);
    expect(answer.styles.map((style) => style.name)).toEqual([
      'Bold Pop',
      'Marker',
      'Karaoke',
      'Clean',
      'Boxed',
      'Typewriter',
      'Mine',
      'Second',
    ]);
    expect(answer).toMatchObject({ defaultStyleId: 'bold-pop', own: 2, limit: 30 });
    expect(answer.styles[6]).toMatchObject({ builtIn: false, look: LOOK });
  });

  it('cleans a name and refuses a look the export cannot draw', () => {
    expect(body('  My\u0000   Style \n').name).toBe('My Style');
    expect(createCaptionStyleSchema.safeParse({ name: ' ', look: LOOK }).success).toBe(false);
    const both = { ...LOOK, box: { colour: '#000000', pad: 10 } };
    expect(createCaptionStyleSchema.safeParse({ name: 'Both', look: both }).success).toBe(false);
    expect(createCaptionStyleSchema.safeParse({ name: 'X', look: LOOK, extra: 1 }).success).toBe(
      false,
    );
    expect(updateCaptionStyleSchema.safeParse({}).success).toBe(false);
  });

  it('stops at 30 of its own', async () => {
    const { styles } = setup();
    for (let index = 0; index < 30; index += 1) {
      await styles.create(TEST_ORG, TEST_USER, body(`Style ${index}`));
    }
    const refused = await refusal(styles.create(TEST_ORG, TEST_USER, body('One more')));
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('caption_style_limit');
    // Another workspace is not held back by this one's.
    await expect(styles.create(OTHER_ORG, TEST_USER, body('Theirs'))).resolves.toBeDefined();
  });

  it('changes and deletes only its own workspace styles', async () => {
    const { styles } = setup();
    const { style } = await styles.create(TEST_ORG, TEST_USER, body('Mine'));
    const renamed = await styles.update(TEST_ORG, style.id, { name: 'Renamed' });
    expect(renamed.style).toMatchObject({ name: 'Renamed', look: LOOK });

    for (const attempt of [
      styles.update(OTHER_ORG, style.id, { name: 'Stolen' }),
      styles.remove(OTHER_ORG, style.id),
      styles.remove(TEST_ORG, 'not-a-uuid'),
    ]) {
      const refused = await refusal(attempt);
      expect(refused.status).toBe(404);
      expect(refused.body.code).toBe('caption_style_not_found');
    }
    expect(await styles.findOwn(OTHER_ORG, style.id)).toBeNull();
    await expect(styles.remove(TEST_ORG, style.id)).resolves.toEqual({
      message: 'Caption style deleted.',
    });
    expect((await styles.list(TEST_ORG)).own).toBe(0);
  });

  it('leaves out a stored look that no longer reads', async () => {
    const { styles, tables } = setup();
    await styles.create(TEST_ORG, TEST_USER, body('Good'));
    (tables.captionStyles?.[0] as unknown as { look: unknown }).look = { font: 'Inter' };
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    expect((await styles.list(TEST_ORG)).own).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('clips.caption_style.unreadable'));
    warn.mockRestore();
  });
});

describe('adding captions', () => {
  it('answers the track and the words at once when the clip was listened to', async () => {
    const { service, ensure, ledger } = setup();
    const outcome = await service.add(TEST_ORG, TEST_USER, CLIP, { styleId: 'karaoke' });
    if (!outcome.covered) throw new Error('expected covered');
    expect(outcome.track).toEqual(
      createCaptionsTrack({
        transcriptAssetId: HEARD_ID,
        language: 'en',
        styleId: 'karaoke',
        look: builtInCaptionStyle('karaoke')?.look as never,
      }),
    );
    // The clip's 120 to 150 s, widened by the 30 s handles.
    expect(outcome.transcript.words[0]?.start).toBe(90_000);
    expect(outcome.transcript.words.at(-1)?.start).toBe(179_000);
    expect(ensure).toHaveBeenCalledWith(TEST_ORG, TEST_USER, VIDEO, {
      ranges: [{ fromMs: 90_000, toMs: 180_000 }],
    });
    expect(ledger.entries).toEqual([]);
  });

  it('asks only for what the clip plays, never the part between two kept stretches', async () => {
    const doc = document(60_000, 80_000);
    doc.segments = [
      {
        ...(doc.segments[0] as ClipDocument['segments'][number]),
        sourceIn: 60_000,
        sourceOut: 80_000,
      },
      {
        ...(doc.segments[0] as ClipDocument['segments'][number]),
        id: 'later',
        sourceIn: 400_000,
        sourceOut: 420_000,
      },
    ];
    const { service, ensure } = setup({ document: doc, heard: [0, 600] });
    await service.add(TEST_ORG, TEST_USER, CLIP, {});
    expect(ensure.mock.calls[0]?.[3]).toEqual({
      ranges: [
        { fromMs: 30_000, toMs: 110_000 },
        { fromMs: 370_000, toMs: 450_000 },
      ],
    });
  });

  it('hands back the listening job while the clip has not been listened to', async () => {
    const { service, ensure } = setup({ heard: null });
    const job = { covered: false, job: { id: 'job-1' }, price: 2, joined: false, ranges: [] };
    ensure.mockResolvedValueOnce(job);
    await expect(service.add(TEST_ORG, TEST_USER, CLIP, {})).resolves.toBe(job);
  });

  it('refuses a clip whose part of the video has no words', async () => {
    // Listened to, but the words stop before the clip starts.
    const { service, files, tables } = setup({ heard: [0, 300] });
    const quiet = listened(0, 60);
    quiet.covered = [{ fromMs: 0, toMs: 300_000 }];
    files.set(HEARD_KEY, quiet);
    (tables.assets[0] as { meta: unknown }).meta = transcriptAssetMeta(quiet);
    const refused = await refusal(service.add(TEST_ORG, TEST_USER, CLIP, {}));
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('no_speech');
  });

  it("takes the workspace's own style, never another workspace's or an unknown one", async () => {
    const { service, styles } = setup();
    const own = await styles.create(
      TEST_ORG,
      TEST_USER,
      createCaptionStyleSchema.parse({ name: 'Mine', look: { ...LOOK, sizePx: 99, maxWords: 2 } }),
    );
    const theirs = await styles.create(
      OTHER_ORG,
      TEST_USER,
      createCaptionStyleSchema.parse({ name: 'Theirs', look: LOOK }),
    );
    const outcome = await service.add(TEST_ORG, TEST_USER, CLIP, { styleId: own.style.id });
    if (!outcome.covered) throw new Error('expected covered');
    expect(outcome.track).toMatchObject({ styleId: own.style.id, sizePx: 99, maxWords: 2 });

    for (const styleId of [theirs.style.id, 'no-such-style']) {
      const refused = await refusal(service.add(TEST_ORG, TEST_USER, CLIP, { styleId }));
      expect(refused.status).toBe(404);
      expect(refused.body.code).toBe('caption_style_not_found');
    }
  });

  it("answers another workspace's clip as not found, before anything is asked", async () => {
    const { service, ensure } = setup();
    for (const attempt of [
      service.add(OTHER_ORG, TEST_USER, CLIP, {}),
      service.words(OTHER_ORG, CLIP),
      service.fromFile(OTHER_ORG, CLIP, file('x'), {}),
      service.translate(OTHER_ORG, TEST_USER, CLIP, { language: 'ta' }),
    ]) {
      expect((await refusal(attempt)).status).toBe(404);
    }
    expect(ensure).not.toHaveBeenCalled();
  });
});

describe('the words of a clip', () => {
  it("answers the video's words before the clip has captions, and the track's own after", async () => {
    const { service, tables } = setup();
    const before = await service.words(TEST_ORG, CLIP);
    expect(before).toMatchObject({ missing: false, ranges: [{ fromMs: 120_000, toMs: 150_000 }] });
    expect(before.transcript?.id).toBe(HEARD_ID);
    // Listened to already: adding captions is free.
    expect(before.price).toBe(0);

    const supplied = await service.fromFile(
      TEST_ORG,
      CLIP,
      file(srt([['00:00:01,000', '00:00:03,000', 'My own words']])),
      {},
    );
    saveTrack(tables, supplied.track);
    const after = await service.words(TEST_ORG, CLIP);
    expect(after.transcript?.id).toBe(supplied.track.transcriptAssetId);
    expect(after.transcript?.words.map((word) => word.text)).toEqual(['My', 'own', 'words']);
  });

  it('says so when the captions name a transcript that is gone', async () => {
    const { service, tables } = setup();
    saveTrack(
      tables,
      createCaptionsTrack({
        transcriptAssetId: '99999999-9999-4999-8999-999999999999',
        language: 'en',
        styleId: 'clean',
        look: LOOK as never,
      }),
    );
    await expect(service.words(TEST_ORG, CLIP)).resolves.toMatchObject({
      transcript: null,
      missing: true,
    });
  });
});

describe('the price on the button', () => {
  it('is what listening to the clip part of the video costs, before anything is charged', async () => {
    const { service, ledger } = setup({ heard: null });
    // 120 to 150 s widened by the handles is 90 s: two AI minutes.
    await expect(service.words(TEST_ORG, CLIP)).resolves.toMatchObject({
      transcript: null,
      missing: false,
      price: 2,
    });
    expect(ledger.entries).toEqual([]);
  });
});

describe('a supplied captions file', () => {
  it('reads a file made for the clip on the clip clock, free, as the clip own transcript', async () => {
    const { service, tables, ledger, ensure } = setup({ heard: null });
    const outcome = await service.fromFile(
      TEST_ORG,
      CLIP,
      file(
        srt([
          ['00:00:01,000', '00:00:03,000', 'Hello there'],
          ['00:00:04,000', '00:00:06,000', '<i>General</i> Kenobi'],
        ]),
        'C:\\videos\\episode 14.srt',
      ),
      { styleId: 'boxed' },
    );
    // The clip starts at 120 s of the video.
    expect(outcome.transcript.words.map((word) => word.text)).toEqual([
      'Hello',
      'there',
      'General',
      'Kenobi',
    ]);
    // Each line keeps its own times; a line's time is shared out over its words.
    expect(outcome.transcript.words.map((word) => word.start)).toEqual([
      121_000, 122_000, 124_000, 125_059,
    ]);
    expect(outcome.transcript.words.at(-1)?.end).toBe(126_000);
    expect(outcome).toMatchObject({ skipped: 0, note: null });
    expect(outcome.transcript).toMatchObject({ source: 'supplied', fileName: 'episode 14.srt' });
    expect(outcome.track).toMatchObject({ styleId: 'boxed', language: 'en' });

    const row = tables.assets.find((asset) => asset.id === outcome.track.transcriptAssetId);
    expect(row).toMatchObject({ clipId: CLIP, videoId: VIDEO, organizationId: TEST_ORG });
    expect(row?.key).toMatch(
      new RegExp(`^clips/${TEST_ORG}/${VIDEO}/transcript-[0-9a-f]{32}\\.json\\.gz$`),
    );
    // Free, and nothing was listened to.
    expect(ledger.entries).toEqual([]);
    expect(ensure).not.toHaveBeenCalled();
  });

  it('reads a file made for the whole video on the video clock, and counts the lines outside', async () => {
    const { service } = setup({ heard: null });
    const outcome = await service.fromFile(
      TEST_ORG,
      CLIP,
      file(
        srt([
          ['00:00:05,000', '00:00:07,000', 'Far before the clip'],
          ['00:02:05,000', '00:02:07,000', 'Inside the clip'],
          ['00:09:00,000', '00:09:02,000', 'Far after the clip'],
        ]),
      ),
      {},
    );
    expect(outcome.transcript.words.map((word) => word.text)).toEqual(['Inside', 'the', 'clip']);
    expect(outcome.transcript.words[0]?.start).toBe(125_000);
    expect(outcome.skipped).toBe(2);
    expect(outcome.note).toBe('We skipped 2 lines that were outside this clip.');
  });

  it("never stands in for the video's own transcript", async () => {
    const { service, ensure } = setup({ heard: null });
    await service.fromFile(
      TEST_ORG,
      CLIP,
      file(srt([['00:00:01,000', '00:00:03,000', 'Mine alone']])),
      {},
    );
    ensure.mockResolvedValueOnce({
      covered: false,
      job: { id: 'j' },
      price: 2,
      joined: false,
      ranges: [],
    });
    // Add Captions on the same clip still has to listen: the file did not cover the video.
    const outcome = await service.add(TEST_ORG, TEST_USER, CLIP, {});
    expect(outcome.covered).toBe(false);
  });

  it('places a clip-clock file through the clip parts, at their speed', async () => {
    const doc = document(120_000, 130_000);
    const first = doc.segments[0] as ClipDocument['segments'][number];
    doc.segments = [
      { ...first, sourceIn: 120_000, sourceOut: 130_000, speed: 2 },
      { ...first, id: 'second', sourceIn: 200_000, sourceOut: 210_000, speed: 1 },
    ];
    // Part one plays 0 to 5 s of the clip (10 s at double speed), part two 5 to 15 s.
    const { service } = setup({ document: doc, heard: null });
    const outcome = await service.fromFile(
      TEST_ORG,
      CLIP,
      file(
        srt([
          ['00:00:01,000', '00:00:02,000', 'One'],
          ['00:00:06,000', '00:00:07,000', 'Two'],
        ]),
      ),
      {},
    );
    expect(outcome.transcript.words.map((word) => [word.text, word.start, word.end])).toEqual([
      ['One', 122_000, 124_000],
      ['Two', 201_000, 202_000],
    ]);
  });

  it('refuses what is not a captions file, with our sentence', async () => {
    const { service, tables } = setup({ heard: null });
    const before = tables.assets.length;
    const cases: Array<[Parameters<typeof service.fromFile>[2], number, string]> = [
      [undefined, 422, 'captions_file_unreadable'],
      [file('just some notes, no times'), 422, 'captions_file_unreadable'],
      [
        { buffer: Buffer.from([0x00, 0x01, 0x02, 0x00]), originalname: 'a.srt', size: 4 },
        422,
        'captions_file_unreadable',
      ],
      [
        { buffer: Buffer.alloc(1), originalname: 'big.srt', size: 3 * 1024 * 1024 },
        413,
        'captions_file_too_big',
      ],
      // Every line is far outside the clip on either clock.
      [file(srt([['00:08:00,000', '00:08:02,000', 'Late']])), 422, 'captions_file_outside'],
    ];
    for (const [upload, status, code] of cases) {
      const refused = await refusal(service.fromFile(TEST_ORG, CLIP, upload, {}));
      expect([refused.status, refused.body.code]).toEqual([status, code]);
    }
    expect(
      (await refusal(service.fromFile(TEST_ORG, CLIP, file('x'), { language: 'xx' }))).body.code,
    ).toBe('language_unsupported');
    expect(tables.assets).toHaveLength(before);
  });

  it('reads UTF-16 as Windows editors save it', () => {
    const text = 'WEBVTT\n\n00:01.000 --> 00:02.000\nவணக்கம்';
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
    expect(decodeText(utf16)).toBe(text);
    expect(decodeText(Buffer.from(text, 'utf8'))).toBe(text);
  });
});

describe('translating captions', () => {
  async function withCaptions(options: SetupOptions = {}) {
    const made = setup(options);
    const added = await made.service.add(TEST_ORG, TEST_USER, CLIP, { styleId: 'clean' });
    if (!added.covered) throw new Error('expected covered');
    saveTrack(made.tables, added.track);
    return { ...made, track: added.track };
  }

  it('charges by the clip length, stores a translation of the clip own, and answers the track', async () => {
    const { service, ledger, tables, track } = await withCaptions();
    const outcome = await service.translate(TEST_ORG, TEST_USER, CLIP, { language: 'ta' });

    // A 30 second clip: a quarter of a minute a minute, one at least.
    expect(outcome).toMatchObject({ price: 1, reused: false });
    expect(outcome.meter).toMatchObject({ used: 1 });
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]?.key).toMatch(/^clips\.ai:translate:[0-9a-f-]{36}$/);

    expect(outcome.track).toMatchObject({
      language: 'ta',
      styleId: track.styleId,
      position: track.position,
      edits: {},
    });
    expect(outcome.track.transcriptAssetId).not.toBe(HEARD_ID);
    expect(outcome.transcript.source).toBe('translated');
    expect(outcome.transcript.words.every((word) => /[\u0B80-\u0BFF@#\d]/.test(word.text))).toBe(
      true,
    );
    // The translation stands where its sentences were said: inside the widened clip.
    expect(outcome.transcript.words[0]?.start).toBe(90_000);
    expect(outcome.transcript.words.at(-1)?.end).toBeLessThanOrEqual(180_000);

    const row = tables.assets.find((asset) => asset.id === outcome.track.transcriptAssetId);
    expect(row?.clipId).toBe(CLIP);
    expect(readTranscriptAssetMeta(row?.meta)).toMatchObject({
      source: 'translated',
      language: 'ta',
      origin: HEARD_ID,
    });
  });

  it('answers the same request again from the stored translation, free', async () => {
    const { service, ledger, translate } = await withCaptions();
    const first = await service.translate(TEST_ORG, TEST_USER, CLIP, { language: 'hi' });
    const again = await service.translate(TEST_ORG, TEST_USER, CLIP, { language: 'hi' });
    expect(again).toMatchObject({ price: 0, reused: true });
    expect(again.track.transcriptAssetId).toBe(first.track.transcriptAssetId);
    expect(ledger.used()).toBe(1);
    // The model was asked once: the second request never reached it.
    expect(translate).toHaveBeenCalledTimes(1);
  });

  it('makes a double click one call and one charge', async () => {
    const { service, ledger } = await withCaptions();
    const [one, two] = await Promise.all([
      service.translate(TEST_ORG, TEST_USER, CLIP, { language: 'es' }),
      service.translate(TEST_ORG, TEST_USER, CLIP, { language: 'es' }),
    ]);
    expect(two.track.transcriptAssetId).toBe(one.track.transcriptAssetId);
    expect(ledger.used()).toBe(1);
  });

  it('translates the words as the clip shows them: its changes on, its hidden words out', async () => {
    const { service, tables, track, translate } = await withCaptions();
    const clip = tables.clips[0] as { document: unknown };
    clip.document = updateCaptionsTrack(clip.document as ClipDocument, () => ({
      ...track,
      edits: { 90: { text: '@postgear' }, 91: { hidden: true } },
    }));
    await service.translate(TEST_ORG, TEST_USER, CLIP, { language: 'fr' });
    const sent = translate.mock.calls[0]?.[0].lines[0] as string;
    // The hidden word left a pause, so the changed word is a line of its own.
    expect(sent).toBe('@postgear');
    expect(translate.mock.calls[0]?.[0].lines[1]).toBe('secret92 secret93 secret94.');
  });

  it('translates from the words that were said, never from another translation, and goes back free', async () => {
    const { service, tables, translate, ledger } = await withCaptions();
    const tamil = await service.translate(TEST_ORG, TEST_USER, CLIP, { language: 'ta' });
    saveTrack(tables, tamil.track);
    translate.mockClear();

    await service.translate(TEST_ORG, TEST_USER, CLIP, { language: 'hi' });
    expect(translate.mock.calls[0]?.[0]).toMatchObject({ from: 'English', to: 'Hindi' });
    expect(translate.mock.calls[0]?.[0].lines[0]).toContain('secret');

    const back = await service.translate(TEST_ORG, TEST_USER, CLIP, { language: 'en' });
    expect(back).toMatchObject({ price: 0, reused: true });
    expect(back.track.transcriptAssetId).toBe(HEARD_ID);
    expect(ledger.used()).toBe(2);
  });

  it('gives the minutes back when the model fails, and logs no speech', async () => {
    const { service, ledger, tables } = await withCaptions({ ai: 'failing' });
    const lines: string[] = [];
    const spies = (['log', 'warn', 'error'] as const).map((level) =>
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        lines.push(String(args[0]));
      }),
    );
    const before = tables.assets.length;
    const refused = await refusal(service.translate(TEST_ORG, TEST_USER, CLIP, { language: 'ta' }));
    for (const spy of spies) spy.mockRestore();

    expect(refused.status).toBe(502);
    expect(refused.body.code).toBe('translate_failed');
    expect(ledger.used()).toBe(0);
    expect(tables.assets).toHaveLength(before);
    expect(lines.join('\n')).toContain('clips.captions.translate_failed');
    expect(lines.join('\n')).not.toContain('secret');
  });

  it('refuses before any charge when there is nothing to do', async () => {
    const off = await withCaptions({ ai: 'off' });
    expect(
      (await refusal(off.service.translate(TEST_ORG, TEST_USER, CLIP, { language: 'ta' }))).body
        .code,
    ).toBe('translate_off');
    expect(off.ledger.entries).toEqual([]);

    const same = await withCaptions();
    const cases: Array<[string, number, string]> = [
      ['en', 422, 'translate_same_language'],
      ['xx', 422, 'language_unsupported'],
    ];
    for (const [language, status, code] of cases) {
      const refused = await refusal(
        same.service.translate(TEST_ORG, TEST_USER, CLIP, { language }),
      );
      expect([refused.status, refused.body.code]).toEqual([status, code]);
    }
    expect(same.ledger.entries).toEqual([]);

    const none = setup();
    const refused = await refusal(
      none.service.translate(TEST_ORG, TEST_USER, CLIP, { language: 'ta' }),
    );
    expect([refused.status, refused.body.code]).toEqual([409, 'captions_first']);
  });

  it('logs ids and counts only when it works', async () => {
    const { service } = await withCaptions();
    const lines: string[] = [];
    const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(String(args[0]));
    });
    await service.translate(TEST_ORG, TEST_USER, CLIP, { language: 'de' });
    spy.mockRestore();
    expect(lines.join('\n')).toContain('clips.captions.translated');
    expect(lines.join('\n')).not.toMatch(/secret|hallo|Freunde/);
  });
});

describe('deleting a clip with transcripts of its own', () => {
  it('deletes them, unless a copy of the clip still shows one, which then keeps it', async () => {
    const { service, tables, files } = setup({ heard: null });
    const kept = await service.fromFile(
      TEST_ORG,
      CLIP,
      file(srt([['00:00:01,000', '00:00:03,000', 'Kept by the copy']])),
      {},
    );
    const dropped = await service.fromFile(
      TEST_ORG,
      CLIP,
      file(srt([['00:00:01,000', '00:00:03,000', 'Nobody shows this']])),
      {},
    );
    const copyId = '66666666-6666-4666-8666-666666666666';
    tables.clips.push(clipRow({ id: copyId, document: withCaptionsTrack(document(), kept.track) }));

    const keys = await service.releaseClip(TEST_ORG, { id: CLIP, videoId: VIDEO });
    const droppedRow = [...files.keys()].length;
    expect(keys).toHaveLength(1);
    expect(droppedRow).toBe(2); // files are deleted by the caller, after the rows
    expect(tables.assets.map((asset) => [asset.id, asset.clipId])).toEqual([
      [kept.track.transcriptAssetId, copyId],
    ]);
    expect(tables.assets.some((asset) => asset.id === dropped.track.transcriptAssetId)).toBe(false);
    // Another workspace's delete touches nothing.
    await expect(service.releaseClip(OTHER_ORG, { id: copyId, videoId: VIDEO })).resolves.toEqual(
      [],
    );
  });
});
