/**
 * The Node half of a listening job (Sprint 13, Module 02), against the fake
 * rows and storage: the Python input, the merge into an existing transcript,
 * fixes kept across a re-listen, the give-back when nothing was heard, and
 * what a closed job or a wrong key leaves behind (nothing).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { HeardFile, MediaPyTranscribeOutput } from '@postgear/media-contract';
import {
  decodeTranscript,
  emptyTranscript,
  encodeTranscript,
  mergeTranscript,
  readTranscriptAssetMeta,
  transcriptAssetMeta,
} from '@postgear/video-engine';
import { ClipStepError } from '../failures';
import { heardFileKey, transcriptFileKey } from '../keys';
import {
  FakePrivateStorage,
  FakeRows,
  fakeProgress,
  JOB_ID,
  jobRow,
  ORG,
  VIDEO_ID,
  videoRow,
} from '../testing/fakes';
import {
  finishTranscribe,
  LISTEN_FAIL_MARKER,
  prepareTranscribe,
  simulationHint,
  type TranscribeRun,
  transcriptAssetFor,
} from './transcribe.run';

const AUDIO_KEY = `clips/${ORG}/${VIDEO_ID}/analysis-audio-${'a'.repeat(32)}.wav`;
const OLD_JOB = '22222222-3333-4444-8555-666666666666';
const NOW = new Date('2026-11-26T10:00:00Z');

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'pg-transcribe-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function setup(
  options: { ranges?: Array<{ fromMs: number; toMs: number }>; language?: string } = {},
) {
  const rows = new FakeRows();
  const storage = new FakePrivateStorage();
  rows.videos.set(VIDEO_ID, videoRow({ status: 'READY', title: 'A Ten Minute Stream' }));
  rows.links.set(VIDEO_ID, {
    platform: 'twitch',
    kind: 'past_stream',
    externalId: '900000001',
    width: 1280,
    height: 720,
  });
  rows.assets.push({
    id: 'audio-1',
    kind: 'ANALYSIS_AUDIO',
    key: AUDIO_KEY,
    bytes: 10,
    videoId: VIDEO_ID,
    clipId: null,
    meta: {},
    createdAt: NOW,
  });
  const input = {
    videoId: VIDEO_ID,
    language: options.language ?? 'auto',
    ranges: options.ranges ?? [{ fromMs: 60_000, toMs: 120_000 }],
    aiMinutes: 2,
  };
  rows.jobs.set(JOB_ID, jobRow({ kind: 'TRANSCRIBE', videoId: VIDEO_ID, input }));
  const reversed: string[] = [];
  const run: TranscribeRun = {
    jobId: JOB_ID,
    organizationId: ORG,
    input,
    rows,
    privateStorage: storage as unknown as TranscribeRun['privateStorage'],
    progress: fakeProgress().progress,
    simulated: true,
    now: () => NOW,
  };
  const internal = {
    reverseCharges: async (jobId: string) => {
      reversed.push(jobId);
      return { reversed: 1 } as never;
    },
  };
  return { rows, storage, run, internal, reversed };
}

function heardBody(
  words: HeardFile['words'],
  ranges = [{ fromMs: 60_000, toMs: 120_000 }],
): HeardFile {
  return {
    version: 1,
    language: 'en',
    model: 'simulation',
    ranges,
    words,
    speech: { sampleRateHz: 2, values: [] },
  };
}

function putHeard(storage: FakePrivateStorage, body: HeardFile): MediaPyTranscribeOutput {
  const key = heardFileKey(ORG, VIDEO_ID, JOB_ID);
  storage.objects.set(key, gzipSync(Buffer.from(JSON.stringify(body))));
  return {
    heardKey: key,
    language: body.language,
    languageProbability: null,
    model: body.model,
    secondsListened: 60,
    wordCount: body.words.length,
    noSpeech: body.words.length === 0,
  };
}

function storedTranscript(storage: FakePrivateStorage, key: string) {
  const bytes = storage.objects.get(key);
  if (!bytes) throw new Error(`nothing stored at ${key}`);
  return decodeTranscript(gunzipSync(bytes).toString('utf8'));
}

const WORDS = [
  { start: 60_200, end: 60_600, text: 'Hello', sure: 0.9 },
  { start: 60_700, end: 61_100, text: 'Arvin.', sure: 0.5 },
];

describe('prepareTranscribe', () => {
  it('builds the Python input from keys and rows, with the sample of a simulated link', async () => {
    const { run } = setup();
    const payload = await prepareTranscribe(run);
    expect(payload).toEqual({
      version: 1,
      jobId: JOB_ID,
      orgId: ORG,
      videoId: VIDEO_ID,
      audioKey: AUDIO_KEY,
      durationMs: 180_000,
      ranges: [{ fromMs: 60_000, toMs: 120_000 }],
      language: 'auto',
      simulation: { sample: 'stream', force: null },
    });
  });

  it('sends no simulation hint when the providers are real', async () => {
    const { run } = setup();
    expect((await prepareTranscribe({ ...run, simulated: false })).simulation).toBeNull();
  });

  it('a video with no sound is no_speech, never retried', async () => {
    const { run, rows } = setup();
    rows.videos.set(VIDEO_ID, videoRow({ status: 'READY', hasAudio: false }));
    await expect(prepareTranscribe(run)).rejects.toMatchObject({
      code: 'no_speech',
      retryable: false,
    });
    rows.videos.set(VIDEO_ID, videoRow({ status: 'READY' }));
    rows.assets = [];
    await expect(prepareTranscribe(run)).rejects.toBeInstanceOf(ClipStepError);
  });

  it('a video that is gone or not ready fails for good', async () => {
    const { run, rows } = setup();
    rows.videos.set(VIDEO_ID, videoRow({ status: 'IMPORTING' }));
    await expect(prepareTranscribe(run)).rejects.toMatchObject({
      code: 'transcribe_failed',
      retryable: false,
    });
  });
});

describe('simulationHint', () => {
  it('reads an upload named like an own sample as that sample', () => {
    const upload = {
      platform: 'upload',
      kind: 'upload',
      externalId: null,
      width: 1,
      height: 1,
    } as const;
    expect(simulationHint({ title: 'Verideck_60s_3D' }, upload)).toEqual({
      sample: 'verideck',
      force: null,
    });
    expect(simulationHint({ title: 'holiday.mp4' }, upload)).toEqual({ sample: null, force: null });
  });

  it('reads the forcing markers from the title', () => {
    expect(simulationHint({ title: `x ${LISTEN_FAIL_MARKER}` }, null).force).toBe('fail');
    expect(simulationHint({ title: 'x [simulate:no-speech]' }, null).force).toBe('no-speech');
    expect(simulationHint({ title: 'x [simulate:listen-slow]' }, null).force).toBe('slow');
  });
});

describe('finishTranscribe', () => {
  it('stores the first transcript, closes the job and removes the heard file', async () => {
    const { run, rows, storage, internal, reversed } = setup();
    const heard = putHeard(storage, heardBody(WORDS));
    const outcome = await finishTranscribe(run, heard, dir, internal);

    expect(outcome).toEqual({ finished: true, noSpeech: false });
    const key = transcriptFileKey(ORG, VIDEO_ID, JOB_ID);
    const transcript = storedTranscript(storage, key);
    expect(transcript.words.map((word) => [word.i, word.text])).toEqual([
      [0, 'Hello'],
      [1, 'Arvin.'],
    ]);
    expect(transcript.covered).toEqual([{ fromMs: 60_000, toMs: 120_000 }]);
    const asset = rows.assets.find((row) => row.kind === 'TRANSCRIPT');
    expect(asset).toMatchObject({ id: JOB_ID, key, videoId: VIDEO_ID });
    expect(readTranscriptAssetMeta(asset?.meta)).toMatchObject({
      language: 'en',
      words: 2,
      fixes: [],
    });
    expect(rows.jobs.get(JOB_ID)?.status).toBe('DONE');
    expect(rows.transcribed.get(JOB_ID)).toMatchObject({
      wordCount: 2,
      noSpeech: false,
      language: 'en',
    });
    expect(storage.objects.has(heard.heardKey)).toBe(false);
    expect(reversed).toEqual([]);
  });

  it('merges into the existing transcript, keeps its fixes and replaces the old file', async () => {
    const { run, rows, storage, internal } = setup({ ranges: [{ fromMs: 0, toMs: 60_000 }] });
    const oldKey = transcriptFileKey(ORG, VIDEO_ID, OLD_JOB);
    const old = mergeTranscript(emptyTranscript('en', 'simulation'), {
      ranges: [{ fromMs: 60_000, toMs: 120_000 }],
      words: WORDS,
    });
    storage.objects.set(oldKey, gzipSync(Buffer.from(encodeTranscript(old))));
    rows.assets.push({
      id: OLD_JOB,
      kind: 'TRANSCRIPT',
      key: oldKey,
      bytes: 1,
      videoId: VIDEO_ID,
      clipId: null,
      meta: { ...transcriptAssetMeta(old, [{ at: 60_700, text: 'Arvind.' }]) },
      createdAt: NOW,
    });
    const heard = putHeard(
      storage,
      heardBody(
        [{ start: 10_000, end: 10_400, text: 'Earlier', sure: 0.9 }],
        [{ fromMs: 0, toMs: 60_000 }],
      ),
    );
    await finishTranscribe(run, heard, dir, internal);

    const transcript = storedTranscript(storage, transcriptFileKey(ORG, VIDEO_ID, JOB_ID));
    // Nothing already indexed is renumbered; the earlier word takes the next index.
    expect(transcript.words.map((word) => [word.i, word.text])).toEqual([
      [2, 'Earlier'],
      [0, 'Hello'],
      [1, 'Arvin.'],
    ]);
    expect(transcript.covered).toEqual([{ fromMs: 0, toMs: 120_000 }]);
    const transcripts = rows.assets.filter((row) => row.kind === 'TRANSCRIPT');
    expect(transcripts).toHaveLength(1);
    expect(readTranscriptAssetMeta(transcripts[0]?.meta)?.fixes).toEqual([
      { at: 60_700, text: 'Arvind.' },
    ]);
    expect(storage.objects.has(oldKey)).toBe(false);
  });

  it('a stretch with no speech is covered, done, and its AI minutes are given back', async () => {
    const { run, rows, storage, internal, reversed } = setup();
    const outcome = await finishTranscribe(run, putHeard(storage, heardBody([])), dir, internal);
    expect(outcome).toEqual({ finished: true, noSpeech: true });
    const transcript = storedTranscript(storage, transcriptFileKey(ORG, VIDEO_ID, JOB_ID));
    expect(transcript.words).toEqual([]);
    expect(transcript.covered).toEqual([{ fromMs: 60_000, toMs: 120_000 }]);
    expect(rows.jobs.get(JOB_ID)?.status).toBe('DONE');
    expect(rows.transcribed.get(JOB_ID)).toMatchObject({ noSpeech: true });
    expect(reversed).toEqual([JOB_ID]);
  });

  it('refuses a language we cannot draw heard by Detect Automatically, keeping nothing (Module 16)', async () => {
    const { run, rows, storage, internal } = setup();
    const heard = putHeard(storage, { ...heardBody(WORDS), language: 'ja' });
    await expect(finishTranscribe(run, heard, dir, internal)).rejects.toMatchObject({
      code: 'language_unsupported',
      retryable: false,
    });
    expect(storage.puts).toBe(0);
    expect(storage.objects.has(heard.heardKey)).toBe(false);
    expect(rows.assets.filter((row) => row.kind === 'TRANSCRIPT')).toEqual([]);
    expect(rows.jobs.get(JOB_ID)?.status).not.toBe('DONE');
  });

  it('keeps a no-speech answer whatever language it names, and a supported one heard by auto', async () => {
    const silent = setup();
    const quiet = putHeard(silent.storage, { ...heardBody([]), language: 'ja' });
    await expect(finishTranscribe(silent.run, quiet, dir, silent.internal)).resolves.toEqual({
      finished: true,
      noSpeech: true,
    });
    const tamil = setup();
    const heard = putHeard(tamil.storage, { ...heardBody(WORDS), language: 'ta' });
    await expect(finishTranscribe(tamil.run, heard, dir, tamil.internal)).resolves.toEqual({
      finished: true,
      noSpeech: false,
    });
  });

  it('refuses an answer that names any key but the job own heard file', async () => {
    const { run, storage, internal } = setup();
    const heard = putHeard(storage, heardBody(WORDS));
    const other = `clips/other-org/${VIDEO_ID}/heard-${'b'.repeat(32)}.json.gz`;
    await expect(
      finishTranscribe(run, { ...heard, heardKey: other }, dir, internal),
    ).rejects.toMatchObject({ code: 'transcribe_failed', retryable: false });
    expect(storage.puts).toBe(0);
  });

  it('a job closed meanwhile keeps nothing', async () => {
    const { run, rows, storage, internal } = setup();
    const heard = putHeard(storage, heardBody(WORDS));
    rows.jobs.set(
      JOB_ID,
      jobRow({ kind: 'TRANSCRIBE', videoId: VIDEO_ID, status: 'CANCELLED', input: run.input }),
    );
    const outcome = await finishTranscribe(run, heard, dir, internal);
    expect(outcome.finished).toBe(false);
    expect(rows.assets.filter((row) => row.kind === 'TRANSCRIPT')).toEqual([]);
    expect(storage.objects.has(transcriptFileKey(ORG, VIDEO_ID, JOB_ID))).toBe(false);
    expect(storage.objects.has(heard.heardKey)).toBe(false);
  });

  it('a heard file that does not read is retried, never trusted', async () => {
    const { run, storage, internal, rows } = setup();
    const key = heardFileKey(ORG, VIDEO_ID, JOB_ID);
    storage.objects.set(key, gzipSync(Buffer.from('{"version":1,"words":"nope"}')));
    await expect(
      finishTranscribe(
        run,
        {
          heardKey: key,
          language: 'en',
          languageProbability: null,
          model: 'simulation',
          secondsListened: 1,
          wordCount: 0,
          noSpeech: true,
        },
        dir,
        internal,
      ),
    ).rejects.toMatchObject({ code: 'transcribe_failed', retryable: true });
    expect(rows.assets.filter((row) => row.kind === 'TRANSCRIPT')).toEqual([]);
  });

  it('never logs a word of what was said', async () => {
    const { run, storage, internal } = setup();
    const lines: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    try {
      await finishTranscribe(run, putHeard(storage, heardBody(WORDS)), dir, internal);
    } finally {
      spy.mockRestore();
    }
    expect(lines.join('\n')).toContain('clips.transcribe.done');
    expect(lines.join('\n')).not.toMatch(/Hello|Arvin/);
  });
});

describe('transcriptAssetFor', () => {
  const asset = (id: string, language: string, source = 'listened') => ({
    id,
    kind: 'TRANSCRIPT' as const,
    key: `k-${id}`,
    bytes: 1,
    videoId: VIDEO_ID,
    clipId: null,
    meta: { language, model: 'm', source, covered: [], words: 0, fixes: [] },
    createdAt: NOW,
  });

  it('picks by language, and the first spoken one for auto, never a translation', () => {
    const assets = [asset('a', 'hi', 'translated'), asset('b', 'en'), asset('c', 'ta')];
    expect(transcriptAssetFor(assets, 'auto')?.id).toBe('b');
    expect(transcriptAssetFor(assets, 'ta')?.id).toBe('c');
    expect(transcriptAssetFor(assets, 'hi')).toBeNull();
    expect(transcriptAssetFor([], 'auto')).toBeNull();
  });
});
