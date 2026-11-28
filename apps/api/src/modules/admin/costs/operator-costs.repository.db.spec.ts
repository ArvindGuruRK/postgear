/**
 * The costs route's two SQL sums against the real Postgres (Module 15
 * section 3): a mock cannot show what `cost->>'cents'`, the `finishedAt`
 * window or the reversal's join to its charge's `meta.by` really do.
 *
 * It needs the local database (docker compose up) with every migration
 * applied, so it runs only when CLIPS_COSTS_DB_TEST=1:
 *
 *   CLIPS_COSTS_DB_TEST=1 npx dotenv -e .env -- npx jest --config apps/api/jest.config.js operator-costs.repository.db
 *
 * CI has no Postgres service, so there it shows as skipped. The test makes
 * two throwaway workspaces and deletes them at the end (their jobs and
 * ledger rows go with them through the cascade). Other workspaces' rows in
 * the same window are filtered out by workspace id, so a busy local
 * database does not change the result.
 */
import { prisma } from '@postgear/db';
import { OperatorCostsRepository } from './operator-costs.repository';

const RUN = process.env.CLIPS_COSTS_DB_TEST === '1';
const AI = 'clips.ai_minutes_per_month';

(RUN ? describe : describe.skip)('the costs sums (real Postgres)', () => {
  const stamp = Date.now().toString(36);
  const orgA = `costs-a-${stamp}`;
  const orgB = `costs-b-${stamp}`;
  const from = new Date('2031-03-01T00:00:00.000Z');
  const to = new Date('2031-03-02T00:00:00.000Z');
  const inside = new Date('2031-03-01T12:00:00.000Z');
  const repository = new OperatorCostsRepository();

  beforeAll(async () => {
    await prisma.organization.createMany({
      data: [
        { id: orgA, name: 'Costs Test A' },
        { id: orgB, name: 'Costs Test B' },
      ],
    });
    const job = (
      organizationId: string,
      kind: 'RENDER' | 'TRANSCRIBE',
      finishedAt: Date | null,
      cost: { cents: number; estimated: boolean } | null,
      status: 'DONE' | 'FAILED' | 'RUNNING' = 'DONE',
    ) => ({
      organizationId,
      kind,
      status,
      input: {},
      finishedAt,
      costCents: cost ? Math.round(cost.cents) : null,
      cost: cost ?? undefined,
    });
    await prisma.clipJob.createMany({
      data: [
        job(orgA, 'RENDER', inside, { cents: 0.1733, estimated: false }),
        job(orgA, 'RENDER', inside, { cents: 0.2033, estimated: false }),
        job(orgA, 'TRANSCRIBE', inside, { cents: 0.6667, estimated: true }, 'FAILED'),
        // Not costed yet: counted, not guessed.
        job(orgA, 'TRANSCRIBE', inside, null),
        // Outside the window, and still running: left out.
        job(orgA, 'RENDER', to, { cents: 5, estimated: false }),
        job(orgA, 'RENDER', null, null, 'RUNNING'),
        job(orgB, 'RENDER', inside, { cents: 1.5, estimated: false }),
      ],
    });
    const charge = await prisma.usageEntry.create({
      data: {
        organizationId: orgA,
        meter: AI,
        units: 12_000,
        kind: 'CHARGE',
        idempotencyKey: `clips.ai:listen:${stamp}`,
        cycleStart: from,
        meta: { step: 'listen', by: 'user-asha' },
        createdAt: inside,
      },
    });
    await prisma.usageEntry.createMany({
      data: [
        {
          organizationId: orgA,
          meter: AI,
          units: -2_000,
          kind: 'REVERSAL',
          idempotencyKey: `rev:${charge.id}`,
          reversesId: charge.id,
          cycleStart: from,
          createdAt: inside,
        },
        {
          organizationId: orgA,
          meter: AI,
          units: 3_000,
          kind: 'CHARGE',
          idempotencyKey: `clips.ai:read:${stamp}`,
          cycleStart: from,
          createdAt: inside,
        },
        // Not a Clips meter, and outside the window: left out.
        {
          organizationId: orgA,
          meter: 'ai.credits',
          units: 5_000,
          kind: 'CHARGE',
          idempotencyKey: `other:${stamp}`,
          cycleStart: from,
          createdAt: inside,
        },
        {
          organizationId: orgA,
          meter: AI,
          units: 9_000,
          kind: 'CHARGE',
          idempotencyKey: `clips.ai:late:${stamp}`,
          cycleStart: from,
          createdAt: to,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await prisma.$disconnect();
  });

  it('sums finished jobs in [from, to) by kind and workspace, the exact cents', async () => {
    const rows = (await repository.jobCosts(from, to))
      .filter((row) => row.organizationId === orgA || row.organizationId === orgB)
      .sort((a, b) => `${a.organizationId}${a.kind}`.localeCompare(`${b.organizationId}${b.kind}`));
    expect(rows).toEqual([
      { kind: 'RENDER', organizationId: orgA, jobs: 2, costed: 2, estimated: 0, cents: 0.3766 },
      { kind: 'TRANSCRIBE', organizationId: orgA, jobs: 2, costed: 1, estimated: 1, cents: 0.6667 },
      { kind: 'RENDER', organizationId: orgB, jobs: 1, costed: 1, estimated: 0, cents: 1.5 },
    ]);
  });

  it('sums Clips ledger entries in [from, to), a reversal under its charge person', async () => {
    const rows = (await repository.usage(from, to))
      .filter((row) => row.organizationId === orgA)
      .sort((a, b) => `${a.kind}${a.by}`.localeCompare(`${b.kind}${b.by}`));
    expect(rows).toEqual([
      { meter: AI, organizationId: orgA, kind: 'CHARGE', by: null, units: 3_000 },
      { meter: AI, organizationId: orgA, kind: 'CHARGE', by: 'user-asha', units: 12_000 },
      { meter: AI, organizationId: orgA, kind: 'REVERSAL', by: 'user-asha', units: -2_000 },
    ]);
  });

  it('names the workspaces', async () => {
    const names = await repository.workspaceNames([orgA, orgB]);
    expect(names.get(orgA)).toBe('Costs Test A');
    expect(names.get(orgB)).toBe('Costs Test B');
  });
});
