/**
 * `PrismaRunStore.loadRun` on a fake client: which graph a run executes.
 *
 * A live run runs the version it was started on (`run.version.graph`),
 * never the workflow's draft and never a snapshot, so editing an active
 * workflow ("Unpublished Changes") leaves its live runs alone. A test run
 * runs the draft snapshot it was started with.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaRunStore } from './prisma-run-store';
import { graphOf, line, ORG, step } from './testing';

const published = graphOf(
  [step('trig1', 'trigger.manual'), step('bell', 'notify.inApp', { name: 'Published Step' })],
  [line('trig1', 'bell')],
);
const draft = graphOf(
  [step('trig1', 'trigger.manual'), step('mail', 'notify.inApp', { name: 'Draft Step' })],
  [line('trig1', 'mail')],
);

function storeWith(row: Record<string, unknown>) {
  const findFirst = jest.fn(async () => ({
    id: 'run_1',
    organizationId: ORG,
    automationId: 'auto_1',
    status: 'QUEUED',
    triggerPayload: {},
    seedOutputs: null,
    options: null,
    startedAt: null,
    createdAt: new Date('2026-11-03T09:00:00.000Z'),
    automation: { name: 'Publishing Report' },
    organization: { name: 'Bloom Bakery' },
    ...row,
  }));
  const db = { automationRun: { findFirst } };
  return {
    store: new PrismaRunStore(db as unknown as ConstructorParameters<typeof PrismaRunStore>[0]),
    findFirst,
  };
}

describe('PrismaRunStore.loadRun', () => {
  it('gives a live run the graph of its own version, even with a newer draft saved', async () => {
    const { store, findFirst } = storeWith({
      mode: 'LIVE',
      version: { graph: published },
      // A stray snapshot on a live row is ignored too.
      graphSnapshot: draft,
    });

    const run = await store.loadRun({ runId: 'run_1', organizationId: ORG });

    expect(run?.graph).toEqual(published);
    // The workflow's draft is never read for a run.
    const select = (findFirst.mock.calls[0] as unknown as [{ select: Record<string, unknown> }])[0]
      .select;
    expect(select.automation).toEqual({ select: { name: true } });
    expect(select.version).toEqual({ select: { graph: true } });
  });

  it('gives a live run whose version is gone no graph, so the run fails plainly', async () => {
    const { store } = storeWith({ mode: 'LIVE', version: null, graphSnapshot: draft });

    await expect(store.loadRun({ runId: 'run_1', organizationId: ORG })).resolves.toMatchObject({
      graph: null,
    });
  });

  it('gives a test run the draft snapshot it started with', async () => {
    const { store } = storeWith({ mode: 'TEST', version: null, graphSnapshot: draft });

    await expect(store.loadRun({ runId: 'run_1', organizationId: ORG })).resolves.toMatchObject({
      graph: draft,
    });
  });

  it('is the only graph source: no worker code reads the workflow draft', () => {
    const files = (function walk(directory: string): string[] {
      return readdirSync(directory).flatMap((entry) => {
        const path = join(directory, entry);
        if (statSync(path).isDirectory()) return walk(path);
        return /\.ts$/.test(entry) && !/\.(test|spec)\.ts$/.test(entry) ? [path] : [];
      });
    })(join(__dirname, '..'));

    expect(files.length).toBeGreaterThan(20);
    expect(files.filter((file) => readFileSync(file, 'utf8').includes('draftGraph'))).toEqual([]);
  });

  it('reads the run through its workspace only', async () => {
    const { store, findFirst } = storeWith({ mode: 'LIVE', version: { graph: published } });

    await store.loadRun({ runId: 'run_1', organizationId: ORG });

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'run_1', organizationId: ORG } }),
    );
  });
});
