/**
 * Security sweep, Pictures and Hosted services (Sprint 13, Module 16).
 *
 * Stills of a video reach a model only when `CLIPS_ACTION_VISION` is on: a
 * run started with the switch off keeps `actionVision: false` even with Look
 * For Action chosen and paid, so the still check refuses before a picture is
 * read and the model is never asked.
 *
 * Existing tests this builds on (not repeated here):
 * - highlights/clip-highlights.service.spec.ts, "Look For Action: charged
 *   once under its own key, the vision switch kept on the run" (switch on)
 *   and "Look For Action off: no action charge and no vision, whatever the
 *   switch";
 * - highlights/clip-stills.service.spec.ts, "refuses a run that started with
 *   the vision check off, or without Look For Action" (a hand-made run);
 * - no-free-route.audit.spec.ts, "check-stills: pictures reach the model only
 *   while Look For Action is paid";
 * - the worker: clips/highlights/watch.test.ts, "measures the chosen
 *   stretch..." (no stills asked without the switch) and "asks four stills a
 *   burst, puts the sentence on its clip, and deletes the stills" / "a still
 *   check that fails leaves the bursts unchecked" (stills deleted on success
 *   and failure); Python: apps/media/tests/test_visual_services.py.
 */
import { Readable } from 'node:stream';
import { Logger } from '@nestjs/common';
import type { AiEngine } from '../../ai/engine/engine.types';
import type { PrivateStorage } from '../../media/storage/storage.interface';
import { ClipStillsService } from '../highlights/clip-stills.service';
import { TEST_ORG, TEST_USER } from '../testing/rows';
import { type AiBench, aiBench, highlightsOf, refusal, setupOf, VIDEO } from './ai-audit-bench';

let mockDb: unknown;
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

beforeEach(() => {
  for (const level of ['log', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
  }
});
afterEach(() => jest.restoreAllMocks());

function bench(): AiBench {
  const made = aiBench({ heard: [0, 600] });
  mockDb = made.db;
  return made;
}

function stills() {
  const storage = {
    getStream: jest.fn(async () => ({
      totalBytes: 3,
      body: Readable.from([Buffer.from([0xff, 0xd8, 0xff])]),
    })),
  };
  const writer = {
    checkStills: jest.fn(async ({ bursts }: { bursts: unknown[] }) =>
      bursts.map(() => ({ notable: false, kind: 'nothing' as const, sure: 0.9, line: '' })),
    ),
  };
  const ai = { createSnippetWriter: jest.fn(() => writer) };
  const service = new ClipStillsService(
    storage as unknown as PrivateStorage,
    ai as unknown as AiEngine,
  );
  return { service, storage, writer, ai };
}

const body = (jobId: string) => ({
  organizationId: TEST_ORG,
  bursts: [
    {
      stillKeys: [`clips/${TEST_ORG}/${VIDEO}/still-0-${jobId.replace(/-/g, '')}.jpg`],
      momentSec: 12,
      spanSec: 2,
      withSound: true,
    },
  ],
});

describe('pictures reach a model only with CLIPS_ACTION_VISION on', () => {
  it('keeps the vision check off on a run started with the switch off, Look For Action chosen', async () => {
    const b = bench();
    const started = await highlightsOf(b, false).start(
      TEST_ORG,
      TEST_USER,
      VIDEO,
      setupOf({ action: true }),
    );
    // A fresh bench holds this one run.
    expect(b.tables.runs).toHaveLength(1);
    const run = b.tables.runs?.[0] as unknown as { params: Record<string, unknown> };
    expect(run?.params).toMatchObject({ actionVision: false, setup: { action: true } });

    // Look For Action is still paid (the motion measure runs on our servers)...
    expect(b.ledger.some((row) => row.idempotencyKey === `clips.ai:action:${started.job.id}`)).toBe(
      true,
    );
    // ...but no picture is read and no model is asked.
    const { service, storage, writer, ai } = stills();
    const answer = await refusal(service.check(started.job.id, body(started.job.id)));
    expect(answer).toMatchObject({ status: 409, body: { code: 'highlights_failed' } });
    expect(storage.getStream).not.toHaveBeenCalled();
    expect(ai.createSnippetWriter).not.toHaveBeenCalled();
    expect(writer.checkStills).not.toHaveBeenCalled();
  });

  it('reads the pictures with the switch on, for the same run shape', async () => {
    const b = bench();
    const started = await highlightsOf(b, true).start(
      TEST_ORG,
      TEST_USER,
      VIDEO,
      setupOf({ action: true }),
    );
    const { service, writer } = stills();
    await service.check(started.job.id, body(started.job.id));
    expect(writer.checkStills).toHaveBeenCalledTimes(1);
  });
});
