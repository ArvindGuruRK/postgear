/**
 * `ClipCostService` against the real Postgres (Module 15 section 3): the
 * cost is written once into the two columns, a second call changes nothing,
 * an import reads its own files' bytes, and the maintenance pass finds what
 * a lost call left behind.
 *
 * Runs only with the local database and every migration applied:
 *
 *   CLIPS_COSTS_DB_TEST=1 npx dotenv -e .env -- npx jest --config apps/api/jest.config.js clip-cost.service.db
 *
 * Skipped in CI (no Postgres). The throwaway workspace is deleted at the end.
 */
import { prisma } from '@postgear/db';
import type { AiEngine } from '../../ai/engine/engine.types';
import { ClipCostService } from './clip-cost.service';

const RUN = process.env.CLIPS_COSTS_DB_TEST === '1';

(RUN ? describe : describe.skip)('ClipCostService (real Postgres)', () => {
  const orgId = `cost-record-${Date.now().toString(36)}`;
  const start = new Date('2031-04-01T10:00:00.000Z');
  const end = new Date('2031-04-01T10:01:00.000Z');
  const service = new ClipCostService({ modelName: 'simulation' } as unknown as AiEngine);

  beforeAll(async () => {
    await prisma.organization.create({ data: { id: orgId, name: 'Cost Record Test' } });
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('writes an export cost once', async () => {
    const job = await prisma.clipJob.create({
      data: {
        organizationId: orgId,
        kind: 'RENDER',
        status: 'DONE',
        input: { proof: false },
        output: { mediaId: null, proofKey: null, durationMs: 30_000, bytes: 20_000_000 },
        startedAt: start,
        finishedAt: end,
      },
    });
    await service.record(orgId, job.id);
    const first = await prisma.clipJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(first.costCents).toBe(0);
    expect(first.cost).toMatchObject({ provider: 'ffmpeg', cents: 0.2033, prices: '2026-11-14' });

    // A second call, even after the column was changed by hand, leaves it alone.
    await prisma.clipJob.update({ where: { id: job.id }, data: { costCents: 7 } });
    await service.record(orgId, job.id);
    const second = await prisma.clipJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(second.costCents).toBe(7);
  });

  it('reads an import its own files and is found by the maintenance pass', async () => {
    const video = await prisma.clipVideo.create({
      data: {
        organizationId: orgId,
        platform: 'UPLOAD',
        kind: 'UPLOAD',
        title: 'Cost Test Video',
        durationMs: 600_000,
        status: 'READY',
      },
    });
    const job = await prisma.clipJob.create({
      data: {
        organizationId: orgId,
        kind: 'IMPORT',
        status: 'DONE',
        videoId: video.id,
        input: {},
        output: { durationMs: 600_000, assets: 1 },
        startedAt: start,
        finishedAt: end,
      },
    });
    await prisma.clipAsset.create({
      data: {
        organizationId: orgId,
        videoId: video.id,
        kind: 'PROXY',
        key: `clips/${orgId}/${video.id}/proxy.mp4`,
        bytes: BigInt(900_000_000),
        createdAt: start,
      },
    });

    await expect(service.recordMissing(start, 1_000)).resolves.toBeGreaterThanOrEqual(1);
    const row = await prisma.clipJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.cost).toMatchObject({
      videoSeconds: 600,
      units: { processorSeconds: 120, storedGbMonths: 0.9 },
      cents: 1.4367,
    });
    expect(row.costCents).toBe(1);
  });
});
