import { cancelJob, failJob, type OutcomeDeps, openJob } from './job-outcomes';
import {
  allImportKeys,
  allWatchKeys,
  exportMediaKeys,
  facesFileKey,
  highlightsSignalsKey,
  jobHex,
  segmentKey,
  speechKeys,
} from './keys';
import {
  CLIP_ID,
  FakePrivateStorage,
  FakeRows,
  JOB_ID,
  jobRow,
  ORG,
  VIDEO_ID,
  videoRow,
} from './testing/fakes';

const LIMITS = { maxVideoMs: 3_600_000, storageBytes: 1_000_000, retentionDays: 30 };
const ORIGINAL_KEY = `clips/${ORG}/${VIDEO_ID}/original-0123456789abcdef0123456789abcdef.mp4`;
const uploadInput = {
  videoId: VIDEO_ID,
  origin: { type: 'upload', originalKey: ORIGINAL_KEY },
  limits: LIMITS,
  expectedBytes: null,
};

function setup(job = jobRow({ input: uploadInput })) {
  const rows = new FakeRows();
  rows.jobs.set(job.id, job);
  rows.videos.set(VIDEO_ID, videoRow());
  const privateStorage = new FakePrivateStorage();
  const publicDeleted: string[] = [];
  const reverseCharges = jest.fn(async () => ({ reversed: 1 }));
  const deps: OutcomeDeps = {
    rows,
    privateStorage,
    storage: { delete: async (key: string) => void publicDeleted.push(key) },
    internal: { reverseCharges },
    now: () => new Date('2026-11-18T12:00:00Z'),
  };
  return { rows, privateStorage, publicDeleted, reverseCharges, deps };
}

describe('openJob', () => {
  it('refuses another kind, another workspace, or an input that does not parse, permanently', async () => {
    const { rows } = setup();
    await expect(
      openJob(rows, { jobId: JOB_ID, organizationId: ORG }, 'RENDER'),
    ).rejects.toMatchObject({
      code: 'tool_failed',
      retryable: false,
    });
    await expect(
      openJob(rows, { jobId: JOB_ID, organizationId: 'other-org' }, 'IMPORT'),
    ).rejects.toMatchObject({
      retryable: false,
    });
    rows.jobs.set(JOB_ID, jobRow({ input: { videoId: 'not-a-uuid' } }));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(
      openJob(rows, { jobId: JOB_ID, organizationId: ORG }, 'IMPORT'),
    ).rejects.toMatchObject({
      retryable: false,
    });
  });

  it('answers the parsed input', async () => {
    const { rows } = setup();
    const { input } = await openJob(rows, { jobId: JOB_ID, organizationId: ORG }, 'IMPORT');
    expect(input.origin).toEqual({ type: 'upload', originalKey: ORIGINAL_KEY });
  });
});

describe('failJob (import)', () => {
  it('deletes what the job could have stored, fails job and video with one sentence, rings once, gives the minutes back', async () => {
    const { deps, rows, privateStorage, reverseCharges } = setup();
    const failure = { jobId: JOB_ID, organizationId: ORG, code: 'tool_failed' };

    expect(await failJob(deps, failure)).toBe(true);
    expect(privateStorage.deleted).toEqual(allImportKeys(ORG, VIDEO_ID, JOB_ID));
    expect(rows.jobs.get(JOB_ID)?.status).toBe('FAILED');
    const video = rows.videos.get(VIDEO_ID);
    expect(video?.status).toBe('FAILED');
    expect(video?.error).toEqual({ code: 'tool_failed', message: expect.any(String) });
    expect(rows.notifications).toEqual([
      expect.objectContaining({
        type: 'clip_video_failed',
        title: 'Your video could not be imported',
      }),
    ]);
    expect(reverseCharges).toHaveBeenCalledWith(JOB_ID, { organizationId: ORG });

    // A retried bookkeeping call changes nothing and rings no second bell.
    expect(await failJob(deps, failure)).toBe(false);
    expect(rows.notifications).toHaveLength(1);
  });

  it('a minutes refusal deletes the uploaded ORIGINAL, object and row', async () => {
    const { deps, rows, privateStorage } = setup();
    privateStorage.objects.set(ORIGINAL_KEY, Buffer.from('x'));
    rows.assets.push({
      id: 'orig',
      kind: 'ORIGINAL',
      key: ORIGINAL_KEY,
      bytes: 1,
      videoId: VIDEO_ID,
      clipId: null,
      meta: null,
      createdAt: new Date(),
    });

    await failJob(deps, { jobId: JOB_ID, organizationId: ORG, code: 'clips_minutes_used' });
    expect(privateStorage.objects.has(ORIGINAL_KEY)).toBe(false);
    expect(rows.assets).toHaveLength(0);
  });

  it('keeps the ORIGINAL for a failure a retry can fix', async () => {
    const { deps, privateStorage } = setup();
    privateStorage.objects.set(ORIGINAL_KEY, Buffer.from('x'));
    await failJob(deps, { jobId: JOB_ID, organizationId: ORG, code: 'tool_failed' });
    expect(privateStorage.objects.has(ORIGINAL_KEY)).toBe(true);
  });

  it('never touches a job that is already DONE', async () => {
    const { deps, rows, privateStorage, reverseCharges } = setup(
      jobRow({ status: 'DONE', input: uploadInput }),
    );
    expect(await failJob(deps, { jobId: JOB_ID, organizationId: ORG, code: 'tool_failed' })).toBe(
      false,
    );
    expect(privateStorage.deleted).toHaveLength(0);
    expect(rows.videos.get(VIDEO_ID)?.status).toBe('IMPORTING');
    expect(reverseCharges).not.toHaveBeenCalled();
  });
});

describe('cancelJob (import)', () => {
  it('removes every file under the video, soft deletes it, gives the minutes back', async () => {
    const { deps, rows, privateStorage, reverseCharges } = setup();
    privateStorage.objects.set(ORIGINAL_KEY, Buffer.from('x'));

    expect(await cancelJob(deps, { jobId: JOB_ID, organizationId: ORG })).toBe(true);
    expect(privateStorage.objects.size).toBe(0);
    expect(rows.jobs.get(JOB_ID)?.status).toBe('CANCELLED');
    expect(rows.videos.get(VIDEO_ID)).toMatchObject({
      status: 'REMOVED',
      deletedAt: expect.any(Date),
    });
    expect(rows.notifications).toHaveLength(0);
    expect(reverseCharges).toHaveBeenCalled();
  });

  it('loses to a finish that landed first: a ready video stays', async () => {
    const { deps, rows, privateStorage } = setup(jobRow({ status: 'DONE', input: uploadInput }));
    privateStorage.objects.set(ORIGINAL_KEY, Buffer.from('x'));
    expect(await cancelJob(deps, { jobId: JOB_ID, organizationId: ORG })).toBe(false);
    expect(privateStorage.objects.size).toBe(1);
    expect(rows.videos.get(VIDEO_ID)?.deletedAt).toBeNull();
  });
});

describe('segment and render bookkeeping', () => {
  const segmentInput = {
    videoId: VIDEO_ID,
    clipId: CLIP_ID,
    origin: uploadInput.origin,
    fromMs: 1_000,
    toMs: 21_000,
    maxHeight: 1080,
  };

  it('a failed sharp range deletes its one key and rings no bell', async () => {
    const { deps, rows, privateStorage } = setup(
      jobRow({ kind: 'SEGMENT', clipId: CLIP_ID, input: segmentInput }),
    );
    await failJob(deps, { jobId: JOB_ID, organizationId: ORG, code: 'tool_failed' });
    expect(privateStorage.deleted).toEqual([segmentKey(ORG, VIDEO_ID, JOB_ID)]);
    expect(rows.jobs.get(JOB_ID)?.status).toBe('FAILED');
    expect(rows.notifications).toHaveLength(0);
  });

  it('a failed export deletes its public files unless a Media row already uses them, and rings', async () => {
    const job = jobRow({
      kind: 'RENDER',
      clipId: CLIP_ID,
      input: { clipId: CLIP_ID, videoId: VIDEO_ID },
    });
    const { deps, rows, publicDeleted } = setup(job);
    const keys = exportMediaKeys(JOB_ID, job.createdAt);
    rows.mediaKeys.add(keys.video);

    await failJob(deps, { jobId: JOB_ID, organizationId: ORG, code: 'export_failed' });
    expect(publicDeleted).toEqual([keys.poster]);
    expect(rows.notifications).toEqual([
      expect.objectContaining({
        type: 'clip_export_failed',
        title: 'Your clip could not be exported',
        content: expect.stringMatching(/^"Best Moment": /),
        link: `/${ORG}/clips/edit/${CLIP_ID}?tab=export`,
      }),
    ]);
  });

  it('a failed export of a clip deleted meanwhile still closes, with no bell', async () => {
    const { deps, rows } = setup(
      jobRow({ kind: 'RENDER', clipId: CLIP_ID, input: { clipId: CLIP_ID, videoId: VIDEO_ID } }),
    );
    rows.clips.clear();
    await failJob(deps, { jobId: JOB_ID, organizationId: ORG, code: 'export_failed' });
    expect(rows.jobs.get(JOB_ID)?.status).toBe('FAILED');
    expect(rows.notifications).toHaveLength(0);
  });
});

describe('highlights bookkeeping (Module 16)', () => {
  const RUN_ID = 'cccccccc-dddd-4eee-8fff-000000000000';
  const OLD_SIGNALS = `clips/${ORG}/${VIDEO_ID}/signals-old.json.gz`;

  function highlightsSetup() {
    const made = setup(jobRow({ kind: 'HIGHLIGHTS', input: { videoId: VIDEO_ID, runId: RUN_ID } }));
    made.rows.runs.set(RUN_ID, {
      id: RUN_ID,
      organizationId: ORG,
      videoId: VIDEO_ID,
      status: 'RUNNING',
      createdById: 'user-1',
    });
    made.privateStorage.objects.set(OLD_SIGNALS, Buffer.from('old'));
    made.privateStorage.objects.set(
      highlightsSignalsKey(ORG, VIDEO_ID, JOB_ID),
      Buffer.from('new'),
    );
    return made;
  }

  it('a failure deletes the run own signals file, fails job and run with the sentence, gives the minutes back', async () => {
    const { deps, rows, privateStorage, reverseCharges } = highlightsSetup();
    await failJob(deps, { jobId: JOB_ID, organizationId: ORG, code: 'tool_failed' });

    expect(privateStorage.deleted).toEqual([
      highlightsSignalsKey(ORG, VIDEO_ID, JOB_ID),
      ...allWatchKeys(ORG, VIDEO_ID, JOB_ID),
    ]);
    expect(privateStorage.objects.has(OLD_SIGNALS)).toBe(true);
    // Module 06: every still, the motion file and the state file of the run go too.
    expect(privateStorage.deleted).toContain(
      `clips/${ORG}/${VIDEO_ID}/still-47-${jobHex(JOB_ID)}.jpg`,
    );
    expect(rows.jobs.get(JOB_ID)?.status).toBe('FAILED');
    expect(rows.runs.get(RUN_ID)?.status).toBe('FAILED');
    expect(rows.closed[0]?.error).toEqual({
      code: 'highlights_failed',
      message: 'We could not finish looking for clips. Your AI minutes were given back.',
    });
    expect(rows.closed[0]?.highlightRunId).toBe(RUN_ID);
    expect(rows.notifications).toHaveLength(0);
    expect(reverseCharges).toHaveBeenCalledTimes(1);
    expect(reverseCharges).toHaveBeenCalledWith(JOB_ID, { organizationId: ORG });
  });

  it('a cancel closes job and run as CANCELLED and gives the minutes back', async () => {
    const { deps, rows, reverseCharges } = highlightsSetup();
    await cancelJob(deps, { jobId: JOB_ID, organizationId: ORG });

    expect(rows.jobs.get(JOB_ID)?.status).toBe('CANCELLED');
    expect(rows.runs.get(RUN_ID)?.status).toBe('CANCELLED');
    expect(reverseCharges).toHaveBeenCalledTimes(1);
  });

  it('a run that already finished is never touched (its clips and charge stay)', async () => {
    const { deps, rows, reverseCharges } = highlightsSetup();
    const job = rows.jobs.get(JOB_ID);
    if (job) job.status = 'DONE';
    const run = rows.runs.get(RUN_ID);
    if (run) run.status = 'DONE';

    await failJob(deps, { jobId: JOB_ID, organizationId: ORG, code: 'tool_failed' });
    expect(rows.jobs.get(JOB_ID)?.status).toBe('DONE');
    expect(rows.runs.get(RUN_ID)?.status).toBe('DONE');
    expect(reverseCharges).not.toHaveBeenCalled();
  });
});

describe('faces bookkeeping (Sprint 13, Module 07)', () => {
  const facesInput = { videoId: VIDEO_ID, clipId: CLIP_ID, fromMs: 1_000, toMs: 61_000 };

  it.each([
    [
      'failed',
      (deps: OutcomeDeps) =>
        failJob(deps, { jobId: JOB_ID, organizationId: ORG, code: 'faces_failed' }),
    ],
    ['cancelled', (deps: OutcomeDeps) => cancelJob(deps, { jobId: JOB_ID, organizationId: ORG })],
  ])(
    'a %s faces job deletes the face file Python may have written, and nothing else',
    async (_, close) => {
      const { deps, rows, privateStorage } = setup(
        jobRow({ kind: 'FACES', clipId: CLIP_ID, input: facesInput }),
      );
      expect(await close(deps)).toBe(true);
      expect(privateStorage.deleted).toEqual([facesFileKey(ORG, VIDEO_ID, JOB_ID)]);
      expect(rows.notifications).toHaveLength(0);
    },
  );
});

describe('voice bookkeeping (Sprint 13, Module 09)', () => {
  const speechInput = { text: 'Hello there', voiceId: 'sim-river', aiMinutes: 1 };

  it.each([
    [
      'failed',
      (deps: OutcomeDeps) =>
        failJob(deps, { jobId: JOB_ID, organizationId: ORG, code: 'tool_failed' }),
    ],
    ['cancelled', (deps: OutcomeDeps) => cancelJob(deps, { jobId: JOB_ID, organizationId: ORG })],
  ])('a %s voice job removes its three files and gives the AI minutes back', async (_, close) => {
    const { deps, rows, privateStorage, reverseCharges } = setup(
      jobRow({ kind: 'SPEECH', videoId: null, clipId: CLIP_ID, input: speechInput }),
    );
    expect(await close(deps)).toBe(true);
    const keys = speechKeys(ORG, JOB_ID);
    expect(privateStorage.deleted).toEqual([keys.text, keys.wav, keys.sound]);
    expect(reverseCharges).toHaveBeenCalledWith(JOB_ID, { organizationId: ORG });
    expect(rows.notifications).toHaveLength(0);
  });

  it('a failed voice job reads "We could not make the voice"', async () => {
    const { deps, rows } = setup(
      jobRow({ kind: 'SPEECH', videoId: null, clipId: CLIP_ID, input: speechInput }),
    );
    await failJob(deps, { jobId: JOB_ID, organizationId: ORG, code: 'tool_failed' });
    expect(rows.jobs.get(JOB_ID)?.status).toBe('FAILED');
    expect(rows.closed[0]?.error).toEqual({
      code: 'voice_failed',
      message: 'We could not make the voice. Your AI minutes were given back.',
    });
  });

  it('a voice job that already finished is never touched (its sound and charge stay)', async () => {
    const { deps, privateStorage, reverseCharges } = setup(
      jobRow({ kind: 'SPEECH', status: 'DONE', videoId: null, input: speechInput }),
    );
    expect(await cancelJob(deps, { jobId: JOB_ID, organizationId: ORG })).toBe(false);
    expect(privateStorage.deleted).toEqual([]);
    expect(reverseCharges).not.toHaveBeenCalled();
  });
});

describe('auto-edit bookkeeping (Sprint 13, Module 10)', () => {
  const autoEditInput = {
    videoId: VIDEO_ID,
    clipId: CLIP_ID,
    recipeId: 'starter-auto-edit-talking-video',
    range: { fromMs: 0, toMs: 600_000 },
    listenJobId: null,
    listenStarted: false,
  };
  const autoEditJob = () => jobRow({ kind: 'AUTO_EDIT', clipId: CLIP_ID, input: autoEditInput });

  it('a listen job that did not finish keeps its own sentence; anything else reads "We could not finish the edit"', async () => {
    const listen = setup(autoEditJob());
    await failJob(listen.deps, { jobId: JOB_ID, organizationId: ORG, code: 'transcribe_failed' });
    expect(listen.rows.closed[0]?.error).toMatchObject({ code: 'transcribe_failed' });

    const other = setup(autoEditJob());
    await failJob(other.deps, { jobId: JOB_ID, organizationId: ORG, code: 'tool_failed' });
    expect(other.rows.jobs.get(JOB_ID)?.status).toBe('FAILED');
    expect(other.rows.closed[0]?.error).toEqual({
      code: 'auto_edit_failed',
      message:
        'We could not finish the edit. Try again: what we heard is kept, so it costs nothing more.',
    });
    expect(other.privateStorage.deleted).toEqual([]);
  });

  it('a cancel closes the job as CANCELLED, deleting nothing', async () => {
    const { deps, rows, privateStorage, reverseCharges } = setup(autoEditJob());
    expect(await cancelJob(deps, { jobId: JOB_ID, organizationId: ORG })).toBe(true);
    expect(rows.jobs.get(JOB_ID)?.status).toBe('CANCELLED');
    expect(privateStorage.deleted).toEqual([]);
    expect(reverseCharges).toHaveBeenCalledWith(JOB_ID, { organizationId: ORG });
  });
});
