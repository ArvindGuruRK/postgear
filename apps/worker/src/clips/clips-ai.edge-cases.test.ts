/**
 * Sprint 13, Module 16 section 2: the worker's share of the Clips AI stories'
 * edge cases (section 5 of `docs/new-modules/user-stories-clips-ai.md`) and
 * of the forcing switches, each one shown to work only under simulation.
 *
 * - "Listening fails half way": a listen job that fails reads the story's
 *   sentence, keeps no heard file and gives its AI minutes back.
 * - "No speech in the video": a video with no sound fails as `no_speech`
 *   with the story's sentence, and gives its AI minutes back.
 * - `[simulate:listen-fail]` and `[simulate:no-speech]` in a video's title
 *   reach the Python service only when the providers are simulated.
 * - `[simulate:emote-too-big]` walks the ladder to the end only under
 *   simulation; with real providers the title is just a title and FFmpeg runs.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { MediaFacts, RunTool } from '@postgear/media-tools';
import { clipKeys } from '@postgear/storage';
import { CLIP_ERROR_MESSAGES, type EmoteJobInput } from '@postgear/video-engine';
import { EMOTE_TOO_BIG_MARKER, type EmoteRun, runEmote } from './emote/emote.run';
import { failJob, type OutcomeDeps } from './job-outcomes';
import { heardFileKey } from './keys';
import type { AssetRow } from './rows';
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
import {
  LISTEN_FAIL_MARKER,
  LISTEN_SILENT_MARKER,
  LISTEN_SLOW_MARKER,
  prepareTranscribe,
  type TranscribeRun,
} from './transcribe/transcribe.run';

const LISTEN_FAILED =
  'We could not finish listening to this video. Your AI minutes were given back.';
const NO_SPEECH = 'We could not hear any speech in this video.';
const AUDIO_KEY = `clips/${ORG}/${VIDEO_ID}/analysis-audio-${'a'.repeat(32)}.wav`;
const NOW = new Date('2026-11-28T10:00:00Z');

const listenInput = {
  videoId: VIDEO_ID,
  language: 'auto',
  ranges: [{ fromMs: 60_000, toMs: 120_000 }],
  aiMinutes: 2,
};

function outcomes() {
  const rows = new FakeRows();
  rows.jobs.set(JOB_ID, jobRow({ kind: 'TRANSCRIBE', videoId: VIDEO_ID, input: listenInput }));
  rows.videos.set(VIDEO_ID, videoRow());
  const privateStorage = new FakePrivateStorage();
  const reverseCharges = jest.fn(async () => ({ reversed: 1 }));
  const deps: OutcomeDeps = {
    rows,
    privateStorage,
    storage: { delete: async () => undefined },
    internal: { reverseCharges },
    now: () => NOW,
  };
  return { rows, privateStorage, reverseCharges, deps };
}

describe('"Listening fails half way"', () => {
  it.each(['tool_failed', 'transcribe_failed', 'MEDIA_TOOL_FAILED'])(
    'a listen job ending in %s reads the story sentence, keeps no heard file and gives the minutes back',
    async (code) => {
      const { rows, privateStorage, reverseCharges, deps } = outcomes();
      expect(await failJob(deps, { jobId: JOB_ID, organizationId: ORG, code })).toBe(true);
      expect(rows.jobs.get(JOB_ID)?.status).toBe('FAILED');
      expect(rows.closed[0]?.error).toEqual({ code: 'transcribe_failed', message: LISTEN_FAILED });
      expect(CLIP_ERROR_MESSAGES.transcribe_failed).toBe(LISTEN_FAILED);
      expect(privateStorage.deleted).toEqual([heardFileKey(ORG, VIDEO_ID, JOB_ID)]);
      expect(reverseCharges).toHaveBeenCalledTimes(1);
      expect(reverseCharges).toHaveBeenCalledWith(JOB_ID, { organizationId: ORG });
    },
  );
});

describe('"No speech in the video"', () => {
  it('a listen job refused as no_speech reads the story sentence and gives the charge back', async () => {
    const { rows, reverseCharges, deps } = outcomes();
    await failJob(deps, { jobId: JOB_ID, organizationId: ORG, code: 'no_speech' });
    expect(rows.closed[0]?.error).toEqual({ code: 'no_speech', message: NO_SPEECH });
    expect(reverseCharges).toHaveBeenCalledWith(JOB_ID, { organizationId: ORG });
  });
});

describe('the listening switches in a title', () => {
  function listen(title: string, simulated: boolean) {
    const rows = new FakeRows();
    rows.videos.set(VIDEO_ID, videoRow({ status: 'READY', title }));
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
    const run: TranscribeRun = {
      jobId: JOB_ID,
      organizationId: ORG,
      input: listenInput,
      rows,
      privateStorage: new FakePrivateStorage() as unknown as TranscribeRun['privateStorage'],
      progress: fakeProgress().progress,
      simulated,
      now: () => NOW,
    };
    return prepareTranscribe(run);
  }

  it.each([
    [LISTEN_FAIL_MARKER, 'fail'],
    [LISTEN_SILENT_MARKER, 'no-speech'],
    [LISTEN_SLOW_MARKER, 'slow'],
  ])('%s forces "%s" under simulation and is never sent otherwise', async (marker, force) => {
    expect(marker).toMatch(/^\[simulate:[a-z-]+\]$/);
    const simulated = await listen(`PostGear Sample ${marker}`, true);
    expect(simulated.simulation?.force).toBe(force);
    const real = await listen(`PostGear Sample ${marker}`, false);
    expect(real.simulation).toBeNull();
  });

  it('are the names the testing guide lists', () => {
    expect([LISTEN_FAIL_MARKER, LISTEN_SILENT_MARKER, LISTEN_SLOW_MARKER]).toEqual([
      '[simulate:listen-fail]',
      '[simulate:no-speech]',
      '[simulate:listen-slow]',
    ]);
  });
});

describe('[simulate:emote-too-big] outside simulation', () => {
  const PROXY_KEY = clipKeys.videoFile(ORG, VIDEO_ID, 'proxy', 'mp4');
  const input: EmoteJobInput = {
    videoId: VIDEO_ID,
    platform: 'twitch',
    startMs: 20_000,
    endMs: 23_000,
    crop: { x: 420, y: 0, size: 1080 },
    frame: { width: 1920, height: 1080 },
    key: null,
    flip: false,
    still: false,
    stillAtMs: null,
  };
  const proxy: AssetRow = {
    id: 'a0000000-0000-4000-8000-000000000000',
    kind: 'PROXY',
    key: PROXY_KEY,
    bytes: 1,
    videoId: VIDEO_ID,
    clipId: null,
    meta: {},
    createdAt: NOW,
  };

  async function exportWith(simulated: boolean) {
    const rows = new FakeRows();
    rows.videos.set(
      VIDEO_ID,
      videoRow({ status: 'READY', durationMs: 60_000, title: `Stream ${EMOTE_TOO_BIG_MARKER}` }),
    );
    rows.assets = [proxy];
    const storage = new FakePrivateStorage();
    storage.objects.set(PROXY_KEY, Buffer.from('a stand-in video'));
    // Stops at the first encode: enough to see whether FFmpeg was asked at all.
    const runTool = jest.fn(async () => {
      throw new Error('stop after the first encode');
    });
    const dir = mkdtempSync(path.join(tmpdir(), 'pg-emote-edge-'));
    const run: EmoteRun = {
      job: jobRow({ kind: 'EMOTE', input }),
      input,
      dir,
      signal: new AbortController().signal,
      runTool: runTool as unknown as RunTool,
      probe: async () => ({ width: 1920, height: 1080 }) as MediaFacts,
      privateStorage: storage,
      rows,
      progress: {
        report: async () => undefined,
        flush: async () => undefined,
        done: async () => true,
      },
      heartbeat: () => undefined,
      simulated,
      attempt: 1,
    };
    try {
      const failure = await runEmote(run).catch((error: unknown) => error);
      return { failure, runTool };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('under simulation fails as too big before any encode', async () => {
    // The too-big line (ids and sizes only) is not this test's business.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { failure, runTool } = await exportWith(true);
      expect(failure).toMatchObject({ code: 'emote_too_big', retryable: false });
      expect(runTool).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('with real providers is just a title: FFmpeg is asked as usual', async () => {
    const { failure, runTool } = await exportWith(false);
    expect(runTool).toHaveBeenCalled();
    expect(failure).toMatchObject({ code: 'emote_failed' });
  });
});
