/**
 * The costs route's sums (Module 15 section 3): job costs by kind and by
 * workspace, the ledger by meter and workspace (charged, reversed, adjusted,
 * net) and by person (`meta.by`, a reversal counted for the person of its
 * charge), and the cost of one net unit of each meter. The window comes from
 * the query and goes to both sums.
 */
import type { JobCostRow, OperatorCostsRepository, UsageRow } from './operator-costs.repository';
import { KIND_METERS, OperatorCostsService } from './operator-costs.service';

const NOW = new Date('2026-11-28T12:00:00.000Z');
const AI = 'clips.ai_minutes_per_month';
const IMPORT = 'clips.import_minutes_per_month';

function build(jobs: JobCostRow[], usage: UsageRow[]) {
  const repository = {
    jobCosts: jest.fn(async () => jobs),
    usage: jest.fn(async () => usage),
    workspaceNames: jest.fn(
      async (ids: string[]) =>
        new Map(ids.map((id) => [id, id === 'org-a' ? 'Acme Media' : 'Beta Studio'])),
    ),
    personNames: jest.fn(
      async (ids: string[]) =>
        new Map(ids.filter((id) => id !== 'gone').map((id) => [id, `Person ${id}`])),
    ),
  };
  const service = new OperatorCostsService(repository as unknown as OperatorCostsRepository);
  return { service, repository };
}

const JOBS: JobCostRow[] = [
  { kind: 'TRANSCRIBE', organizationId: 'org-a', jobs: 3, costed: 3, estimated: 0, cents: 2.0001 },
  { kind: 'HIGHLIGHTS', organizationId: 'org-a', jobs: 2, costed: 1, estimated: 1, cents: 1.5 },
  { kind: 'TRANSCRIBE', organizationId: 'org-b', jobs: 1, costed: 1, estimated: 1, cents: 0.4999 },
  { kind: 'RENDER', organizationId: 'org-b', jobs: 4, costed: 4, estimated: 0, cents: 0.6933 },
  { kind: 'IMPORT', organizationId: 'org-b', jobs: 1, costed: 1, estimated: 0, cents: 1.2 },
];

const USAGE: UsageRow[] = [
  // org-a: Asha charged 12 AI minutes and had 2 given back; Ravi charged 3.
  { meter: AI, organizationId: 'org-a', kind: 'CHARGE', by: 'asha', units: 12_000 },
  { meter: AI, organizationId: 'org-a', kind: 'REVERSAL', by: 'asha', units: -2_000 },
  { meter: AI, organizationId: 'org-a', kind: 'CHARGE', by: 'ravi', units: 3_000 },
  // An operator adjustment keeps no person.
  { meter: AI, organizationId: 'org-a', kind: 'ADJUSTMENT', by: null, units: -1_000 },
  // org-b: an older charge with no person, and an import charge by someone since removed.
  { meter: AI, organizationId: 'org-b', kind: 'CHARGE', by: null, units: 4_000 },
  { meter: IMPORT, organizationId: 'org-b', kind: 'CHARGE', by: 'gone', units: 61_500 },
];

describe('OperatorCostsService', () => {
  it('asks both sums for the same window: today UTC by default', async () => {
    const { service, repository } = build([], []);
    const view = await service.costs({}, NOW);
    const from = new Date('2026-11-28T00:00:00.000Z');
    const to = new Date('2026-11-29T00:00:00.000Z');
    expect(repository.jobCosts).toHaveBeenCalledWith(from, to);
    expect(repository.usage).toHaveBeenCalledWith(from, to);
    expect(view.from).toBe(from.toISOString());
    expect(view.to).toBe(to.toISOString());
    expect(view.prices).toBe('2026-11-14');
  });

  it('sums job costs by kind and by workspace, dearest first, and counts the jobs not costed', async () => {
    const { service } = build(JOBS, []);
    const view = await service.costs({ from: '2026-11-01', to: '2026-12-01' }, NOW);

    expect(view.totals).toEqual({ jobs: 11, costed: 10, missing: 1, estimated: 2, cents: 5.8933 });
    expect(view.byKind).toEqual([
      { kind: 'TRANSCRIBE', jobs: 4, costed: 4, estimated: 1, cents: 2.5 },
      { kind: 'HIGHLIGHTS', jobs: 2, costed: 1, estimated: 1, cents: 1.5 },
      { kind: 'IMPORT', jobs: 1, costed: 1, estimated: 0, cents: 1.2 },
      { kind: 'RENDER', jobs: 4, costed: 4, estimated: 0, cents: 0.6933 },
    ]);
    expect(view.byWorkspace).toEqual([
      { organizationId: 'org-a', workspace: 'Acme Media', jobs: 5, costed: 4, cents: 3.5001 },
      { organizationId: 'org-b', workspace: 'Beta Studio', jobs: 6, costed: 6, cents: 2.3932 },
    ]);
  });

  it('sums the ledger by meter and workspace: charged, reversed, adjusted and net', async () => {
    const { service } = build([], USAGE);
    const view = await service.costs({}, NOW);
    expect(view.usageByWorkspace).toEqual([
      {
        meter: AI,
        label: 'AI Minutes',
        organizationId: 'org-a',
        workspace: 'Acme Media',
        charged: 15,
        reversed: 2,
        adjusted: -1,
        net: 12,
      },
      {
        meter: AI,
        label: 'AI Minutes',
        organizationId: 'org-b',
        workspace: 'Beta Studio',
        charged: 4,
        reversed: 0,
        adjusted: 0,
        net: 4,
      },
      {
        meter: IMPORT,
        label: 'Import Minutes',
        organizationId: 'org-b',
        workspace: 'Beta Studio',
        charged: 61.5,
        reversed: 0,
        adjusted: 0,
        net: 61.5,
      },
    ]);
  });

  it('sums by person from meta.by, with no person for entries that kept none', async () => {
    const { service } = build([], USAGE);
    const view = await service.costs({}, NOW);
    const rows = view.usageByPerson.map((row) => ({
      userId: row.userId,
      person: row.person,
      organizationId: row.organizationId,
      meter: row.meter,
      charged: row.charged,
      reversed: row.reversed,
      net: row.net,
    }));
    expect(rows).toEqual([
      {
        userId: 'gone',
        person: null,
        organizationId: 'org-b',
        meter: IMPORT,
        charged: 61.5,
        reversed: 0,
        net: 61.5,
      },
      {
        userId: 'asha',
        person: 'Person asha',
        organizationId: 'org-a',
        meter: AI,
        charged: 12,
        reversed: 2,
        net: 10,
      },
      {
        userId: null,
        person: null,
        organizationId: 'org-b',
        meter: AI,
        charged: 4,
        reversed: 0,
        net: 4,
      },
      {
        userId: 'ravi',
        person: 'Person ravi',
        organizationId: 'org-a',
        meter: AI,
        charged: 3,
        reversed: 0,
        net: 3,
      },
      {
        userId: null,
        person: null,
        organizationId: 'org-a',
        meter: AI,
        charged: 0,
        reversed: 0,
        net: -1,
      },
    ]);
  });

  it('sets each meter cost beside its net units: the cost of one AI minute', async () => {
    const { service } = build(JOBS, USAGE);
    const view = await service.costs({}, NOW);
    const ai = view.byMeter.find((row) => row.meter === AI);
    // TRANSCRIBE 2.5 + HIGHLIGHTS 1.5 cents over 16 net AI minutes.
    expect(ai).toMatchObject({
      label: 'AI Minutes',
      kinds: ['HIGHLIGHTS', 'TRANSCRIBE', 'TRANSLATE', 'SPEECH'],
      cents: 4,
      charged: 19,
      reversed: 2,
      adjusted: -1,
      net: 16,
      centsPerUnit: 0.25,
    });
    expect(view.byMeter.find((row) => row.meter === IMPORT)).toMatchObject({
      cents: 1.2,
      net: 61.5,
      centsPerUnit: 0.0195,
    });
    // A meter with no use still shows its cost line, with no cost per unit.
    expect(view.byMeter.find((row) => row.meter === 'clips.downloads_per_day')).toMatchObject({
      label: 'Downloads A Day',
      cents: 0,
      net: 0,
      centsPerUnit: null,
    });
  });

  it('names a meter for every kind the AI minutes, imports and downloads pay for', () => {
    expect(KIND_METERS).toEqual({
      IMPORT: IMPORT,
      SEGMENT: null,
      HIGHLIGHTS: AI,
      RENDER: null,
      DOWNLOAD: 'clips.downloads_per_day',
      TRANSCRIBE: AI,
      FACES: null,
      TRANSLATE: AI,
      SPEECH: AI,
      AUTO_EDIT: null,
      EMOTE: 'clips.downloads_per_day',
    });
  });
});
