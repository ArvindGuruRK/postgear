/**
 * Security sweep, Speech text (Sprint 13, Module 16), the worker's half.
 *
 * No word of a transcript and no line to be spoken reaches a log line, a
 * failure Temporal stores, or the Python input. A known sentence is followed
 * through a listen and a voice job, on success and on the failures that are
 * most likely to repeat it: a database client that prints the values it was
 * handed, and a JSON parser that quotes its input.
 *
 * Existing tests this builds on (not repeated here):
 * - transcribe/transcribe.run.test.ts, "never logs a word of what was said"
 *   (the success line);
 * - speech/speech.run.test.ts, "stores the line as the text file and hands
 *   Python keys only" and "never puts the line in the sound meta";
 * - secrets.security.test.ts (secrets are scrubbed from every failure line).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { gzipSync } from 'node:zlib';
import type { MediaPySpeakOutput } from '@postgear/media-contract';
import type { ApplicationFailure } from '@temporalio/common';
import { ClipStepError, clipFailure, SPEECH_ACTIVITIES } from './failures';
import { heardFileKey, speechKeys } from './keys';
import {
  type ConvertSound,
  finishSpeech,
  prepareSpeech,
  type SpeechRun,
} from './speech/speech.run';
import {
  FakePrivateStorage,
  FakeRows,
  fakeProgress,
  JOB_ID,
  jobRow,
  ORG,
  VIDEO_ID,
  videoRow,
} from './testing/fakes';
import { finishTranscribe, type TranscribeRun } from './transcribe/transcribe.run';

const SENTENCE = 'Purple elephants dance at midnight beside the river';
const WORDS = ['Purple', 'elephants', 'dance', 'midnight', 'river'];
const NOW = new Date('2026-11-28T10:00:00Z');

let dir: string;
let printed: string[] = [];
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'pg-speech-security-'));
  printed = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      printed.push(args.map((arg) => (typeof arg === 'string' ? arg : String(arg))).join(' '));
    });
  }
});
afterEach(async () => {
  jest.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

/** Everything a person or an operator could read: the console and the failure Temporal keeps. */
function expectNoSpeech(...failures: Array<ApplicationFailure | Error>): void {
  const seen = [
    ...printed,
    ...failures.flatMap((failure) => [
      failure.message,
      String(failure.stack ?? ''),
      JSON.stringify((failure as ApplicationFailure).details ?? null),
      String((failure as { cause?: unknown }).cause ?? ''),
    ]),
  ].join('\n');
  for (const word of WORDS) expect(seen).not.toContain(word);
}

/** What a database client's refusal looks like: it prints the values it was handed. */
function databaseError(): Error {
  const error = new Error(
    `Invalid \`prisma.clipAsset.create()\` invocation:\n  meta: { fixes: [{ at: 1200, text: "${SENTENCE}" }] }`,
  );
  error.name = 'PrismaClientValidationError';
  return error;
}

function speechSetup() {
  const rows = new FakeRows();
  const storage = new FakePrivateStorage();
  const input = { text: SENTENCE, voiceId: 'sim-meadow', aiMinutes: 1 };
  rows.jobs.set(JOB_ID, jobRow({ kind: 'SPEECH', videoId: null, input }));
  const run: SpeechRun = {
    jobId: JOB_ID,
    organizationId: ORG,
    input,
    rows,
    privateStorage: storage as unknown as SpeechRun['privateStorage'],
    progress: fakeProgress().progress,
    simulated: false,
    now: () => NOW,
  };
  return { rows, storage, run };
}

const convert: ConvertSound = async (options) => {
  await writeFile(path.join(options.cwd, options.output), Buffer.from('m4a bytes'));
  return {
    file: options.output,
    durationMs: 3_000,
    peaks: Array.from({ length: 100 }, (_, i) => i % 200),
    bytes: 9,
  };
};

function spoken(storage: FakePrivateStorage): MediaPySpeakOutput {
  const keys = speechKeys(ORG, JOB_ID);
  storage.objects.set(keys.wav, Buffer.from('RIFF....WAVE'));
  return { soundKey: keys.wav, durationMs: 3_000, sampleRate: 24_000, producer: 'kokoro' };
}

function transcribeSetup() {
  const rows = new FakeRows();
  const storage = new FakePrivateStorage();
  rows.videos.set(VIDEO_ID, videoRow({ status: 'READY', title: 'A Ten Minute Stream' }));
  const input = {
    videoId: VIDEO_ID,
    language: 'auto',
    ranges: [{ fromMs: 0, toMs: 60_000 }],
    aiMinutes: 1,
  };
  rows.jobs.set(JOB_ID, jobRow({ kind: 'TRANSCRIBE', videoId: VIDEO_ID, input }));
  const run: TranscribeRun = {
    jobId: JOB_ID,
    organizationId: ORG,
    input,
    rows,
    privateStorage: storage as unknown as TranscribeRun['privateStorage'],
    progress: fakeProgress().progress,
    simulated: false,
    now: () => NOW,
  };
  const internal = { reverseCharges: async () => ({ reversed: 0 }) as never };
  return { rows, storage, run, internal };
}

function heard(storage: FakePrivateStorage, body: Buffer) {
  const key = heardFileKey(ORG, VIDEO_ID, JOB_ID);
  storage.objects.set(key, gzipSync(body));
  return {
    heardKey: key,
    language: 'en',
    languageProbability: null,
    model: 'large-v3',
    secondsListened: 60,
    wordCount: WORDS.length,
    noSpeech: false,
  };
}

function heardWords(): Buffer {
  const words = SENTENCE.split(' ').map((text, index) => ({
    start: 1_000 + index * 500,
    end: 1_400 + index * 500,
    text,
    sure: 0.9,
  }));
  return Buffer.from(
    JSON.stringify({
      version: 1,
      language: 'en',
      model: 'large-v3',
      ranges: [{ fromMs: 0, toMs: 60_000 }],
      words,
      speech: { sampleRateHz: 2, values: [] },
    }),
  );
}

/** Runs `fn`, and answers the failure the activity would throw. */
async function failureOf(
  activity: string,
  fn: () => Promise<unknown>,
): Promise<ApplicationFailure> {
  try {
    await fn();
  } catch (error) {
    return clipFailure(error, { activity, jobId: JOB_ID });
  }
  throw new Error('expected the step to fail');
}

describe('a voice job never shows its line', () => {
  it('hands Python keys only, and logs counts on success', async () => {
    const { storage, run } = speechSetup();
    const payload = await prepareSpeech(run);
    expect(JSON.stringify(payload)).not.toContain('elephants');
    expect(await finishSpeech(run, spoken(storage), dir, convert)).toBe(true);
    expect(printed.join('\n')).toContain('clips.voice.done');
    expectNoSpeech();
  });

  it('keeps it out of the log and the failure when the database repeats it (fails without the sweep fix)', async () => {
    const { rows, storage, run } = speechSetup();
    jest.spyOn(rows, 'finishSpeech').mockRejectedValue(databaseError());
    const failure = await failureOf('clipSpeechFinish', () =>
      finishSpeech(run, spoken(storage), dir, convert),
    );
    expect(printed.join('\n')).toContain('PrismaClientValidationError');
    expect(failure.message).toBe('clip clipSpeechFinish failed: tool_failed');
    expectNoSpeech(failure);
  });

  it('refuses a line too long for the contract with a code, never the line', async () => {
    const { run } = speechSetup();
    run.input = { ...run.input, text: `${SENTENCE} `.repeat(20) };
    const failure = await failureOf('clipSpeechPrepare', () => prepareSpeech(run));
    expect(failure.message).toBe('clip clipSpeechPrepare failed: voice_failed');
    expectNoSpeech(failure);
  });
});

describe('a listen never shows what was said', () => {
  it('logs counts only when it stores the words', async () => {
    const { storage, run, internal } = transcribeSetup();
    await finishTranscribe(run, heard(storage, heardWords()), dir, internal);
    expect(printed.join('\n')).toContain('clips.transcribe.done');
    expectNoSpeech();
  });

  it('keeps it out when the database repeats the words (fails without the sweep fix)', async () => {
    const { rows, storage, run, internal } = transcribeSetup();
    jest.spyOn(rows, 'finishTranscribe').mockRejectedValue(databaseError());
    const failure = await failureOf('clipTranscribeFinish', () =>
      finishTranscribe(run, heard(storage, heardWords()), dir, internal),
    );
    expect(failure.message).toBe('clip clipTranscribeFinish failed: tool_failed');
    expectNoSpeech(failure);
  });

  it('keeps it out when a heard file that is not JSON is quoted by the parser', async () => {
    const { storage, run, internal } = transcribeSetup();
    const failure = await failureOf('clipTranscribeFinish', () =>
      finishTranscribe(run, heard(storage, Buffer.from(`${SENTENCE} {`)), dir, internal),
    );
    expect(failure.message).toBe('clip clipTranscribeFinish failed: transcribe_failed');
    expectNoSpeech(failure);
  });
});

describe('the failure line of a speech activity', () => {
  it.each([...SPEECH_ACTIVITIES])('names only the kind of error in %s', (activity) => {
    const failure = clipFailure(new SyntaxError(`Unexpected token in "${SENTENCE}"`), {
      activity,
      jobId: JOB_ID,
    });
    const line = JSON.parse(printed.at(-1) ?? '{}') as Record<string, unknown>;
    expect(line).toMatchObject({ event: 'clips.activity.failed', activity, reason: 'SyntaxError' });
    expectNoSpeech(failure);
  });

  it('keeps the whole reason for the steps that hold no speech (a tool fault is still debuggable)', () => {
    clipFailure(new Error('disk quota exceeded on /scratch'), { activity: 'clipRender' });
    const line = JSON.parse(printed.at(-1) ?? '{}') as Record<string, unknown>;
    expect(line.reason).toBe('Error: disk quota exceeded on /scratch');
  });

  it('turns our own step errors into a code, whatever their cause says', () => {
    const failure = clipFailure(
      new ClipStepError('transcribe_failed', { retryable: true, cause: new Error(SENTENCE) }),
      { activity: 'clipTranscribeFinish', jobId: JOB_ID },
    );
    expect(failure.details).toEqual([{ code: 'transcribe_failed' }]);
    expectNoSpeech(failure);
  });
});
