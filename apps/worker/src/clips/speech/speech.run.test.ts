/**
 * The Node half of a voice job (Sprint 13, Module 09), against the fake rows
 * and storage: the line stored as the job's text file and the Python input
 * carrying keys only, the WAV made the workspace's own sound (the same meta
 * an uploaded sound has, plus `voice` and `madeByAi`) with the job DONE, and
 * what a closed job, a wrong key or a WAV FFmpeg refuses leaves behind.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { MediaPySpeakOutput } from '@postgear/media-contract';
import { SoundError } from '@postgear/media-tools';
import { readSoundAssetMeta } from '@postgear/video-engine';
import { ClipStepError } from '../failures';
import { speechKeys } from '../keys';
import { FakePrivateStorage, FakeRows, fakeProgress, JOB_ID, jobRow, ORG } from '../testing/fakes';
import {
  type ConvertSound,
  finishSpeech,
  MADE_VOICE_NAME,
  prepareSpeech,
  type SpeechRun,
  speechForce,
  VOICE_FAIL_MARKER,
  VOICE_SLOW_MARKER,
} from './speech.run';

const NOW = new Date('2026-11-27T10:00:00Z');
const KEYS = speechKeys(ORG, JOB_ID);
const LINE = 'Wait for it. This is the best part of the stream.';
const PEAKS = Array.from({ length: 100 }, (_, i) => i % 200);

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'pg-speech-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function setup(text = LINE) {
  const rows = new FakeRows();
  const storage = new FakePrivateStorage();
  const input = { text, voiceId: 'sim-meadow', aiMinutes: 1 };
  rows.jobs.set(JOB_ID, jobRow({ kind: 'SPEECH', videoId: null, input }));
  const progress = fakeProgress();
  const run: SpeechRun = {
    jobId: JOB_ID,
    organizationId: ORG,
    input,
    rows,
    privateStorage: storage as unknown as SpeechRun['privateStorage'],
    progress: progress.progress,
    simulated: true,
    now: () => NOW,
  };
  return { rows, storage, run, reports: progress.reports };
}

/** A converter that writes a small `.m4a` stand-in, as `convertUploadedSound` would. */
function converter(durationMs = 3_012.4): jest.Mock & ConvertSound {
  return jest.fn(async (options: { cwd: string; output: string }) => {
    await writeFile(path.join(options.cwd, options.output), Buffer.from('m4a bytes'));
    return { file: options.output, durationMs, peaks: PEAKS, bytes: 9 };
  }) as jest.Mock & ConvertSound;
}

function spokenWav(storage: FakePrivateStorage): MediaPySpeakOutput {
  storage.objects.set(KEYS.wav, Buffer.from('RIFF....WAVE'));
  storage.objects.set(KEYS.text, Buffer.from('{}'));
  return { soundKey: KEYS.wav, durationMs: 3_000, sampleRate: 24_000, producer: 'simulation' };
}

describe('the job keys', () => {
  it('sit in the workspace library, named from the job id', () => {
    const hex = JOB_ID.replace(/-/g, '');
    expect(KEYS).toEqual({
      text: `clips/${ORG}/library/${hex}.json`,
      wav: `clips/${ORG}/library/${hex}.wav`,
      sound: `clips/${ORG}/library/${hex}.m4a`,
    });
  });
});

describe('prepareSpeech', () => {
  it('stores the line as the text file and hands Python keys only', async () => {
    const { storage, run, reports } = setup();
    const payload = await prepareSpeech(run);
    expect(payload).toEqual({
      version: 1,
      jobId: JOB_ID,
      orgId: ORG,
      textKey: KEYS.text,
      voiceId: 'sim-meadow',
      outKey: KEYS.wav,
      simulation: { force: null },
    });
    expect(JSON.stringify(payload)).not.toContain('Wait for it');
    expect(JSON.parse(storage.objects.get(KEYS.text)?.toString('utf8') ?? '')).toEqual({
      version: 1,
      text: LINE,
    });
    expect(reports[0]).toEqual({ stage: 'voice', progress: 5 });
  });

  it('reads the forcing switches from the line, and sends no hint for a real run', async () => {
    expect(speechForce(`Hello ${VOICE_FAIL_MARKER}`)).toBe('fail');
    expect(speechForce(`Hello ${VOICE_SLOW_MARKER}`)).toBe('slow');
    expect(speechForce('Hello')).toBeNull();
    const forced = setup(`Hello ${VOICE_FAIL_MARKER}`);
    expect((await prepareSpeech(forced.run)).simulation).toEqual({ force: 'fail' });
    const real = setup();
    expect((await prepareSpeech({ ...real.run, simulated: false })).simulation).toBeNull();
  });

  it('a line longer than the contract allows fails for good, before Python', async () => {
    const { storage, run } = setup('x'.repeat(501));
    await expect(prepareSpeech(run)).rejects.toMatchObject({ code: 'voice_failed' });
    expect(storage.objects.size).toBe(0);
  });
});

describe('finishSpeech', () => {
  it('keeps the voice as the workspace own sound, with the job DONE', async () => {
    const { rows, storage, run } = setup();
    const convert = converter();
    expect(await finishSpeech(run, spokenWav(storage), dir, convert)).toBe(true);
    expect(convert).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: dir, input: 'voice.wav', output: 'sound.m4a' }),
    );

    const asset = rows.assets.find((row) => row.id === JOB_ID);
    expect(asset).toMatchObject({ kind: 'AUDIO', key: KEYS.sound, videoId: null, clipId: null });
    expect(asset?.meta).toEqual({
      status: 'ready',
      purpose: 'sound',
      name: MADE_VOICE_NAME,
      durationMs: 3_012,
      peaks: PEAKS,
      voice: 'sim-meadow',
      madeByAi: true,
    });
    // It reads as an uploaded sound everywhere one is read.
    expect(readSoundAssetMeta(asset?.meta)).toMatchObject({ status: 'ready', durationMs: 3_012 });
    expect(rows.jobs.get(JOB_ID)?.status).toBe('DONE');
    expect(rows.spoken.get(JOB_ID)).toEqual({ assetId: JOB_ID, durationMs: 3_012 });
    // The line and the WAV are gone; the sound stays.
    expect(storage.objects.has(KEYS.text)).toBe(false);
    expect(storage.objects.has(KEYS.wav)).toBe(false);
    expect(storage.objects.get(KEYS.sound)?.toString()).toBe('m4a bytes');
  });

  it('never puts the line in the sound meta', async () => {
    const { rows, storage, run } = setup();
    await finishSpeech(run, spokenWav(storage), dir, converter());
    expect(JSON.stringify(rows.assets)).not.toContain('Wait for it');
  });

  it('refuses a key it did not make', async () => {
    const { storage, run } = setup();
    const answer = spokenWav(storage);
    const other = KEYS.wav.replace(/[0-9a-f]{32}/, 'c'.repeat(32));
    await expect(
      finishSpeech(run, { ...answer, soundKey: other }, dir, converter()),
    ).rejects.toBeInstanceOf(ClipStepError);
  });

  it('a WAV FFmpeg cannot use fails for good; a tool fault is left to retry', async () => {
    const { storage, run } = setup();
    const answer = spokenWav(storage);
    const unusable = jest.fn().mockRejectedValue(new SoundError('sound_unusable'));
    await expect(finishSpeech(run, answer, dir, unusable)).rejects.toMatchObject({
      code: 'voice_failed',
      retryable: false,
    });
    const fault = jest.fn().mockRejectedValue(new SoundError('tool_failed'));
    await expect(finishSpeech(run, answer, dir, fault)).rejects.toBeInstanceOf(SoundError);
  });

  it('a job closed meanwhile keeps nothing', async () => {
    const { rows, storage, run } = setup();
    const job = rows.jobs.get(JOB_ID);
    if (job) job.status = 'CANCELLED';
    expect(await finishSpeech(run, spokenWav(storage), dir, converter())).toBe(false);
    expect(storage.objects.size).toBe(0);
    expect(rows.assets.some((row) => row.id === JOB_ID)).toBe(false);
  });
});
