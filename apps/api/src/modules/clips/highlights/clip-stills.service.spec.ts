import { Readable } from 'node:stream';
import { Logger } from '@nestjs/common';
import { createSimulatedModelClient, createSnippetWriter } from '@postgear/ai-engine';
import { defaultClipSetup } from '@postgear/video-engine';
import type { AiEngine } from '../../ai/engine/engine.types';
import type { PrivateStorage } from '../../media/storage/storage.interface';
import { ClipStillsService, isJobStillKey, STILL_MAX_BYTES } from './clip-stills.service';

const ORG = 'org-1';
const JOB = '11111111-1111-4111-8111-111111111111';
const HEX = JOB.replace(/-/g, '');
const VIDEO = '22222222-2222-4222-8222-222222222222';

const mockDb = {
  job: { id: JOB, videoId: VIDEO, highlightRunId: 'run-1' } as Record<string, unknown> | null,
  params: {} as unknown,
};
jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  prisma: {
    clipJob: { findFirst: jest.fn(async () => mockDb.job) },
    clipHighlightRun: { findFirst: jest.fn(async () => ({ params: mockDb.params })) },
  },
}));

const key = (n: number, hex = HEX, org = ORG, video = VIDEO) =>
  `clips/${org}/${video}/still-${n}-${hex}.jpg`;

function burst(first: number, withSound = true) {
  return {
    stillKeys: [0, 1, 2, 3].map((n) => key(first + n)),
    momentSec: 63 + first,
    spanSec: 5.5,
    withSound,
  };
}

function setup(
  options: { action?: boolean; vision?: boolean; sizes?: Record<string, number> } = {},
) {
  mockDb.params = {
    setup: { ...defaultClipSetup(600_000), action: options.action ?? true },
    listenJobId: null,
    charges: { read: 'entry-read', signals: null, action: 'entry-action' },
    actionVision: options.vision ?? true,
  };
  const stored = new Map<string, Buffer>();
  for (let n = 0; n < 12; n += 1) stored.set(key(n), Buffer.from([0xff, 0xd8, 0xff, n]));
  const storage = {
    getStream: jest.fn(async (k: string) => {
      const bytes = stored.get(k);
      if (!bytes) return null;
      return { body: Readable.from([bytes]), totalBytes: options.sizes?.[k] ?? bytes.length };
    }),
  };
  const writer = createSnippetWriter(createSimulatedModelClient());
  const checkStills = jest.spyOn(writer, 'checkStills');
  const ai = { createSnippetWriter: jest.fn(() => writer) };
  const service = new ClipStillsService(
    storage as unknown as PrivateStorage,
    ai as unknown as AiEngine,
  );
  return { service, storage, stored, checkStills };
}

let logs: string[] = [];
beforeEach(() => {
  logs = [];
  jest.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
    logs.push(String(message));
  });
  jest.spyOn(Logger.prototype, 'warn').mockImplementation((message: unknown) => {
    logs.push(String(message));
  });
});
afterEach(() => jest.restoreAllMocks());

describe('isJobStillKey', () => {
  it('accepts only this job, video and workspace, stills 0 to 47', () => {
    expect(isJobStillKey(key(0), ORG, VIDEO, JOB)).toBe(true);
    expect(isJobStillKey(key(47), ORG, VIDEO, JOB)).toBe(true);
    expect(isJobStillKey(key(48), ORG, VIDEO, JOB)).toBe(false);
    expect(isJobStillKey(key(1).replace('still-1', 'still-01'), ORG, VIDEO, JOB)).toBe(false);
    expect(isJobStillKey(key(0, 'a'.repeat(32)), ORG, VIDEO, JOB)).toBe(false);
    expect(isJobStillKey(key(0, HEX, 'org-2'), ORG, VIDEO, JOB)).toBe(false);
    expect(isJobStillKey(`clips/${ORG}/${VIDEO}/proxy-${HEX}.mp4`, ORG, VIDEO, JOB)).toBe(false);
    expect(isJobStillKey(`clips/${ORG}/${VIDEO}/still-0-${HEX}.jpg/../x`, ORG, VIDEO, JOB)).toBe(
      false,
    );
  });
});

describe('POST /internal/clips/jobs/:jobId/check-stills', () => {
  it('reads the stills, sends them as bytes and answers one verdict a burst', async () => {
    const { service, checkStills } = setup();
    const answer = await service.check(JOB, {
      organizationId: ORG,
      bursts: [burst(0), burst(4, false)],
    });
    expect(answer.verdicts).toHaveLength(2);
    expect(answer.verdicts[0]?.notable).toBe(true);
    expect(answer.verdicts[1]?.notable).toBe(false);
    const sent = checkStills.mock.calls[0]?.[0];
    expect(sent?.bursts[0]?.images).toHaveLength(4);
    expect(sent?.bursts[0]?.images[0]).toEqual({ mimeType: 'image/jpeg', base64: '/9j/AA==' });
  });

  it('logs counts and ids only: no picture bytes and no sentence', async () => {
    const { service } = setup();
    const answer = await service.check(JOB, { organizationId: ORG, bursts: [burst(0)] });
    const all = logs.join('\n');
    expect(all).toContain('clips.stills.checked');
    expect(all).not.toContain('/9j/');
    expect(all).not.toContain(answer.verdicts[0]?.line as string);
  });

  it("refuses another job's still before reading anything", async () => {
    const { service, storage } = setup();
    const stranger = { ...burst(0), stillKeys: [key(0, 'b'.repeat(32))] };
    await expect(
      service.check(JOB, { organizationId: ORG, bursts: [stranger] }),
    ).rejects.toMatchObject({ status: 404 });
    expect(storage.getStream).not.toHaveBeenCalled();
  });

  it('refuses a run that started with the vision check off, or without Look For Action', async () => {
    for (const options of [{ vision: false }, { action: false }]) {
      const { service, storage } = setup(options);
      await expect(
        service.check(JOB, { organizationId: ORG, bursts: [burst(0)] }),
      ).rejects.toMatchObject({ status: 409 });
      expect(storage.getStream).not.toHaveBeenCalled();
    }
  });

  it('a burst whose stills are gone or too large is unchecked (null), never "nothing"', async () => {
    const { service, stored } = setup({ sizes: { [key(4)]: STILL_MAX_BYTES + 1 } });
    for (const n of [0, 1, 2, 3]) stored.delete(key(n));
    const answer = await service.check(JOB, {
      organizationId: ORG,
      bursts: [burst(0), { ...burst(4), stillKeys: [key(4)] }],
    });
    expect(answer.verdicts).toEqual([null, null]);
  });

  it('answers 404 for a job of another workspace', async () => {
    const { service } = setup();
    mockDb.job = null;
    await expect(
      service.check(JOB, { organizationId: 'org-2', bursts: [burst(0)] }),
    ).rejects.toMatchObject({ status: 404 });
    mockDb.job = { id: JOB, videoId: VIDEO, highlightRunId: 'run-1' };
  });
});
