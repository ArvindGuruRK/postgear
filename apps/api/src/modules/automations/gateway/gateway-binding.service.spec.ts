/**
 * The two guards behind every gateway route (Module 10), on an in-memory
 * run and effect table:
 *
 * - binding: a run of another workspace, a finished run, or a step that is
 *   not in the graph the run executes are all the same 404;
 * - the effect ledger: the first call acts, a retry gets the stored answer
 *   without acting, a call while another holds a fresh PENDING is a 409
 *   `in_progress`, and a stale PENDING (a crashed attempt) is taken over.
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { FakeGatewayDb, graphWith, ORG, OTHER_ORG, RUN } from './testing/fake-gateway-db';

const db = new FakeGatewayDb();

jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  get prisma() {
    return db.prisma;
  },
}));

import {
  EFFECT_STALE_MS,
  type EffectContext,
  GatewayBindingService,
} from './gateway-binding.service';

const binding = { runId: RUN, nodeKey: 'draft01', organizationId: ORG };
const DRAFT = ['postgear.createDraft'];

describe('GatewayBindingService', () => {
  let service: GatewayBindingService;

  beforeEach(() => {
    db.runs = [];
    db.effects = [];
    db.now = () => new Date();
    jest.clearAllMocks();
    service = new GatewayBindingService();
  });

  describe('bind', () => {
    it('binds a running test run to the step in its snapshot', async () => {
      db.addRun();
      await expect(service.bind(binding, DRAFT)).resolves.toMatchObject({
        run: { id: RUN, organizationId: ORG, mode: 'test', automationName: 'AI Weekly Post' },
        node: { key: 'draft01', type: 'postgear.createDraft' },
      });
    });

    it('refuses a run of another workspace without saying it exists', async () => {
      db.addRun({ organizationId: OTHER_ORG });
      await expect(service.bind(binding, DRAFT)).rejects.toBeInstanceOf(NotFoundException);
      expect(db.prisma.automationRun.findFirst.mock.calls[0][0].where).toEqual({
        id: RUN,
        organizationId: ORG,
      });
    });

    it('refuses a finished run, and accepts one waiting on a review', async () => {
      for (const status of ['SUCCEEDED', 'FAILED', 'CANCELLED', 'QUEUED']) {
        db.runs = [];
        db.addRun({ status });
        await expect(service.bind(binding, DRAFT)).rejects.toBeInstanceOf(NotFoundException);
      }
      db.runs = [];
      db.addRun({ status: 'WAITING' });
      await expect(service.bind(binding, DRAFT)).resolves.toBeDefined();
    });

    it('refuses a step that is not in the version a live run executes', async () => {
      db.addRun({
        mode: 'LIVE',
        // The draft has the step; the live version does not.
        graph: graphWith({ draft01: 'postgear.createDraft' }),
        version: { graph: graphWith({ other01: 'postgear.createDraft' }) },
      });
      await expect(service.bind(binding, DRAFT)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.bind({ ...binding, nodeKey: 'other01' }, DRAFT)).resolves.toMatchObject({
        run: { mode: 'live' },
      });
    });

    it('refuses a step of another type than the route serves', async () => {
      db.addRun({ graph: graphWith({ draft01: 'postgear.publish' }) });
      await expect(service.bind(binding, DRAFT)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('runEffect', () => {
    const answer = { output: { postGroup: 'g1' }, credits: 0 };

    it('acts on the first call and stores the answer', async () => {
      const work = jest.fn(async (_effect: EffectContext) => answer);
      await expect(service.runEffect(binding, 'post.draft', work)).resolves.toEqual(answer);
      expect(work).toHaveBeenCalledTimes(1);
      expect(work.mock.calls[0][0].previous).toBeNull();
      expect(db.effect()).toMatchObject({ status: 'DONE', kind: 'post.draft', result: answer });
    });

    it('answers a retry with the stored result, without acting again', async () => {
      await service.runEffect(binding, 'post.draft', async () => answer);
      const again = jest.fn(async () => ({ output: { postGroup: 'g2' }, credits: 0 }));

      await expect(service.runEffect(binding, 'post.draft', again)).resolves.toEqual(answer);
      expect(again).not.toHaveBeenCalled();
      expect(db.effects).toHaveLength(1);
    });

    it('answers 409 in_progress while another attempt holds a fresh PENDING', async () => {
      let release: () => void = () => undefined;
      const first = service.runEffect(
        binding,
        'post.draft',
        () =>
          new Promise<typeof answer>((resolve) => {
            release = () => resolve(answer);
          }),
      );
      await new Promise((resolve) => setImmediate(resolve));

      const second = jest.fn(async () => answer);
      const refused = await service.runEffect(binding, 'post.draft', second).catch((e) => e);
      expect(refused).toBeInstanceOf(ConflictException);
      expect((refused as ConflictException).getResponse()).toMatchObject({ code: 'in_progress' });
      expect(second).not.toHaveBeenCalled();

      release();
      await expect(first).resolves.toEqual(answer);
    });

    it('takes over a stale PENDING and runs again with what it saved', async () => {
      const started = new Date(Date.now() - EFFECT_STALE_MS - 1_000);
      db.effects.push({
        id: 'eff_old',
        organizationId: ORG,
        idempotencyKey: `${RUN}:draft01`,
        kind: 'post.draft',
        status: 'PENDING',
        result: { sentTo: ['a@x.com'] },
        createdAt: started,
        updatedAt: started,
      });
      const work = jest.fn(async (_effect: EffectContext) => answer);

      await expect(service.runEffect(binding, 'post.draft', work)).resolves.toEqual(answer);
      expect(work.mock.calls[0][0].previous).toEqual({ sentTo: ['a@x.com'] });
      expect(db.effect()).toMatchObject({ status: 'DONE', result: answer });
    });

    it('marks the effect FAILED when the work throws, so a retry may run it again', async () => {
      await expect(
        service.runEffect(binding, 'post.draft', async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(db.effect()?.status).toBe('FAILED');

      const work = jest.fn(async () => answer);
      await expect(service.runEffect(binding, 'post.draft', work)).resolves.toEqual(answer);
      expect(work).toHaveBeenCalledTimes(1);
    });
  });
});
