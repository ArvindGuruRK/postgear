/**
 * Follow The Speaker for a run's clips (Sprint 13, Module 08) against an
 * in-memory database: the run's own setup decides; every clip of the run is
 * marked (beside `seen`), a clip somebody saved is left alone; faces are asked
 * for the best three only; faces off stops quietly; a refusal is counted,
 * never thrown; another workspace's job is a 404.
 */
import { HttpStatus, NotFoundException } from '@nestjs/common';
import type { ClipHighlightRun } from '@postgear/db';
import { defaultClipSetup } from '@postgear/video-engine';
import type { ClipFacesService } from './clip-faces.service';
import { ClipErrorException } from '../clip-error.exception';
import {
  clipRow,
  emptyTables,
  type FakeClipDb,
  type FakeTables,
  fakeClipDb,
} from '../testing/fake-clip-db';
import { jobRow, TEST_ORG } from '../testing/rows';
import { ClipFollowService } from './clip-follow.service';

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

const JOB = '33333333-3333-4333-8333-333333333333';
const RUN = '44444444-4444-4444-8444-444444444444';
const OTHER_RUN = '44444444-4444-4444-8444-000000000002';
const clipId = (n: number) => `55555555-5555-4555-8555-${String(n).padStart(12, '0')}`;

function runRow(setup: unknown): ClipHighlightRun {
  return {
    id: RUN,
    organizationId: TEST_ORG,
    videoId: '22222222-2222-4222-8222-222222222222',
    status: 'DONE',
    params: { setup, listenJobId: null, charges: {}, actionVision: false },
  } as unknown as ClipHighlightRun;
}

function seed(setup: unknown, extra: (tables: FakeTables) => void = () => undefined) {
  const tables = emptyTables();
  tables.jobs.push(jobRow({ id: JOB, kind: 'HIGHLIGHTS', highlightRunId: RUN }));
  tables.runs = [runRow(setup)];
  const scores = [40, 90, null, 70, 10];
  scores.forEach((score, index) => {
    tables.clips.push(
      clipRow({
        id: clipId(index + 1),
        highlightRunId: RUN,
        origin: 'AI_TRANSCRIPT',
        status: 'NEW',
        score,
        ...(index === 0 ? { meta: { seen: 'A car flips over.' } } : {}),
      }),
    );
  });
  // Another run's clip is never touched.
  tables.clips.push(clipRow({ id: clipId(9), highlightRunId: OTHER_RUN, score: 99 }));
  extra(tables);
  return tables;
}

const following = { ...defaultClipSetup(600_000), follow: true };

function setup(tables: FakeTables, ensure?: jest.Mock) {
  mockDb = fakeClipDb(tables);
  const faces = {
    ensure:
      ensure ??
      jest.fn(async (_org: string, _user: string | null, id: string) =>
        id === clipId(2) ? { status: 'ready', reused: true } : { status: 'running', job: {} },
      ),
  };
  return { service: new ClipFollowService(faces as unknown as ClipFacesService), faces };
}

const metaOf = (tables: FakeTables, id: string) =>
  (tables.clips.find((clip) => clip.id === id) as { meta?: unknown }).meta;

describe('ClipFollowService.forRun', () => {
  it('marks every clip of the run and asks faces for the best three, free', async () => {
    const tables = seed(following);
    const { service, faces } = setup(tables);
    const answer = await service.forRun(JOB, TEST_ORG);
    expect(answer).toEqual({
      follow: true,
      marked: 5,
      faces: { ready: 1, running: 2, failed: 0 },
      facesOff: false,
    });
    // `seen` kept beside the mark.
    expect(metaOf(tables, clipId(1))).toEqual({
      seen: 'A car flips over.',
      followOnOpen: 'speaker',
    });
    expect(metaOf(tables, clipId(3))).toEqual({ followOnOpen: 'speaker' });
    expect(metaOf(tables, clipId(9))).toBeUndefined();
    // Scores 90, 70, 40: never the run's others, never another run's 99.
    expect(faces.ensure.mock.calls.map((call) => call[2])).toEqual([
      clipId(2),
      clipId(4),
      clipId(1),
    ]);
    expect(faces.ensure.mock.calls.every((call) => call[0] === TEST_ORG && call[1] === null)).toBe(
      true,
    );
  });

  it('does nothing when the run did not ask to follow, or on a wide shape', async () => {
    for (const chosen of [
      defaultClipSetup(600_000),
      // A stored setup that says follow on a wide shape does not read at all.
      { ...following, ratio: '16:9' },
      null,
    ]) {
      const tables = seed(chosen);
      const { service, faces } = setup(tables);
      expect(await service.forRun(JOB, TEST_ORG)).toMatchObject({ follow: false, marked: 0 });
      expect(faces.ensure).not.toHaveBeenCalled();
      expect(
        tables.clips.every(
          (clip) => !(clip as { meta?: { followOnOpen?: unknown } }).meta?.followOnOpen,
        ),
      ).toBe(true);
    }
  });

  it('leaves a clip somebody already saved alone, and is safe to repeat', async () => {
    const tables = seed(following, (t) => {
      const saved = t.clips.find((clip) => clip.id === clipId(5));
      if (saved) saved.revision = 2;
    });
    const { service } = setup(tables);
    expect((await service.forRun(JOB, TEST_ORG)).marked).toBe(4);
    expect(metaOf(tables, clipId(5))).toBeUndefined();
    expect((await service.forRun(JOB, TEST_ORG)).marked).toBe(0);
  });

  it('stops quietly when faces are off, and counts any other refusal', async () => {
    const off = jest.fn(async () => {
      throw new ClipErrorException(HttpStatus.SERVICE_UNAVAILABLE, 'faces_off');
    });
    const first = setup(seed(following), off);
    expect(await first.service.forRun(JOB, TEST_ORG)).toMatchObject({
      marked: 5,
      facesOff: true,
      faces: { ready: 0, running: 0, failed: 0 },
    });
    expect(off).toHaveBeenCalledTimes(1);

    const flaky = jest.fn(async (_org: string, _user: string | null, id: string) => {
      if (id === clipId(4)) throw new NotFoundException();
      return { status: 'running', job: {} };
    });
    const second = setup(seed(following), flaky);
    expect(await second.service.forRun(JOB, TEST_ORG)).toMatchObject({
      faces: { ready: 0, running: 2, failed: 1 },
      facesOff: false,
    });
  });

  it("another workspace's job, or one that is not Find Clips, is a 404", async () => {
    const { service } = setup(seed(following));
    await expect(service.forRun(JOB, 'seed-second-org')).rejects.toBeInstanceOf(NotFoundException);
    const tables = seed(following, (t) => {
      const job = t.jobs[0];
      if (job) job.kind = 'IMPORT';
    });
    await expect(setup(tables).service.forRun(JOB, TEST_ORG)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
