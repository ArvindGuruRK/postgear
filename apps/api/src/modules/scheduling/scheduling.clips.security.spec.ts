/**
 * Security sweep, the Limits line (Sprint 12, Module 20 section 1): a clip
 * job cannot outlive its timeout.
 *
 * The API is where a job's hard limit is set: every clip workflow it starts
 * carries the contract's execution timeout for its kind (Temporal ends the
 * run there, and the reconcile then marks the row FAILED `timed_out` and
 * gives its charges back, see `clips-internal.service.spec.ts`), and a
 * second start for the same row is refused, so a job can never be given a
 * fresh clock by starting it again.
 */
import type { ConfigService } from '@nestjs/config';
import {
  CLIP_JOB_QUEUES,
  CLIP_JOB_TIMEOUTS_MS,
  CLIP_JOB_WORKFLOWS,
  CLIP_SAVE_DOWNLOAD_TIMEOUT_MS,
  type ClipJobKindName,
} from '@postgear/scheduling';
import { WorkflowIdReusePolicy } from '@temporalio/client';
import type { Env } from '../../config/env';
import { type SchedulingClient, SchedulingService } from './scheduling.service';

const config = {
  get: (key: string) => (key === 'TEMPORAL_HOST' ? 'localhost:7233' : 'default'),
} as unknown as ConfigService<Env, true>;

function fakeClient() {
  const start = jest.fn().mockResolvedValue({});
  const client = {
    workflow: { start, signalWithStart: jest.fn(), getHandle: jest.fn() },
    connection: { close: jest.fn().mockResolvedValue(undefined) },
  };
  return { client: client as unknown as SchedulingClient, start };
}

const KINDS = Object.keys(CLIP_JOB_TIMEOUTS_MS) as ClipJobKindName[];
const SIX_HOURS = 6 * 60 * 60_000;
/**
 * Listening is the one kind allowed past six hours (Module 02): six hours of
 * sound heard on a processor can take longer than six hours. It still has a
 * hard limit, and only one hour more.
 */
const LONGER: Partial<Record<ClipJobKindName, number>> = { TRANSCRIBE: 7 * 60 * 60_000 };

describe('a clip job has a hard time limit from the contract', () => {
  it('names a finite limit of at most six hours for every kind but listening, which has seven', () => {
    // Sprint 13 adds listening, faces, translating and voice.
    expect([...KINDS].sort()).toEqual([
      // Module 10: Auto-Edit Video.
      'AUTO_EDIT',
      'DOWNLOAD',
      // Module 14: Emote Maker.
      'EMOTE',
      'FACES',
      'HIGHLIGHTS',
      'IMPORT',
      'RENDER',
      'SEGMENT',
      'SPEECH',
      'TRANSCRIBE',
      'TRANSLATE',
    ]);
    for (const kind of KINDS) {
      const limit = CLIP_JOB_TIMEOUTS_MS[kind];
      expect(Number.isFinite(limit)).toBe(true);
      expect(limit).toBeGreaterThan(0);
      expect(limit).toBeLessThanOrEqual(LONGER[kind] ?? SIX_HOURS);
    }
    expect(CLIP_SAVE_DOWNLOAD_TIMEOUT_MS).toBeLessThanOrEqual(SIX_HOURS);
  });

  it.each(Object.keys(CLIP_JOB_TIMEOUTS_MS) as ClipJobKindName[])(
    'starts a %s job with its execution timeout, and never a second run for the same row',
    async (kind) => {
      const { client, start } = fakeClient();
      const service = new SchedulingService(config, async () => client);

      await expect(service.startClipJob('job-1', 'org-1', kind)).resolves.toBe(true);

      expect(start).toHaveBeenCalledTimes(1);
      expect(start).toHaveBeenCalledWith(
        CLIP_JOB_WORKFLOWS[kind],
        expect.objectContaining({
          workflowId: 'clip-job:job-1',
          taskQueue: CLIP_JOB_QUEUES[kind],
          workflowExecutionTimeout: CLIP_JOB_TIMEOUTS_MS[kind],
          workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
        }),
      );
    },
  );

  it('starts Save To Media with its own execution timeout', async () => {
    const { client, start } = fakeClient();
    const service = new SchedulingService(config, async () => client);

    await expect(service.startClipSaveDownload('job-1', 'org-1')).resolves.toBe(true);

    expect(start).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ workflowExecutionTimeout: CLIP_SAVE_DOWNLOAD_TIMEOUT_MS }),
    );
  });
});
