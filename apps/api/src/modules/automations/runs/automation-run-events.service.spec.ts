/**
 * The live progress stream against a fake repository, a fake stream and a
 * clock the test drives: the first poll sends every step and the run, later
 * polls only what changed, the stream closes once the run is terminal (after
 * its final state) or after 30 minutes, and a foreign run never opens one.
 */
import { NotFoundException } from '@nestjs/common';
import { HIDDEN } from '@postgear/automation';
import {
  AutomationRunMode,
  AutomationRunStatus,
  AutomationStepStatus,
  encrypt,
} from '@postgear/db';
import type { SseStream } from '../../../common/sse';
import {
  AutomationRunEventsService,
  RUN_EVENTS_MAX_MS,
  RUN_EVENTS_OVERLAP_MS,
  RUN_EVENTS_POLL_MS,
  type RunEventsClock,
} from './automation-run-events.service';
import type {
  AutomationRunsRepository,
  LatestStep,
  RunSummaryRow,
  StepRow,
} from './automation-runs.repository';

const ORG = 'org_1';
const RUN_ID = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const T0 = new Date('2026-10-29T09:00:00.000Z');

function at(ms: number): Date {
  return new Date(T0.getTime() + ms);
}

function runRow(
  status: AutomationRunStatus,
  overrides: Partial<RunSummaryRow> = {},
): RunSummaryRow {
  return {
    id: RUN_ID,
    automationId: 'auto_1',
    mode: AutomationRunMode.TEST,
    status,
    triggerType: 'trigger.manual',
    options: null,
    startedById: 'user_1',
    stepCount: 0,
    creditsUsed: 0,
    error: null,
    startedAt: T0,
    finishedAt: null,
    createdAt: T0,
    ...overrides,
  };
}

function latest(
  nodeKey: string,
  status: AutomationStepStatus,
  updatedAt: Date,
  extra: Partial<StepRow> = {},
): LatestStep {
  return {
    step: {
      id: `row_${nodeKey}`,
      nodeKey,
      nodeType: 'notify.inApp',
      nodeName: nodeKey,
      status,
      attempt: 1,
      input: null,
      output: null,
      truncated: false,
      error: null,
      startedAt: T0,
      finishedAt: null,
      durationMs: null,
      createdAt: T0,
      updatedAt,
      ...extra,
    },
    attempts: 1,
  };
}

function fakeStream() {
  const events: { type: string; data: unknown }[] = [];
  const controller = new AbortController();
  let closed = false;
  const stream: SseStream = {
    send: (type, data) => {
      if (!closed) events.push({ type, data });
    },
    close: () => {
      closed = true;
    },
    signal: controller.signal,
    get closed() {
      return closed;
    },
  };
  return { stream, events, leave: () => controller.abort() };
}

function fakeClock(): RunEventsClock & { slept: number[] } {
  let now = T0.getTime();
  const slept: number[] = [];
  return {
    slept,
    now: () => now,
    sleep: async (ms) => {
      slept.push(ms);
      now += ms;
    },
  };
}

describe('AutomationRunEventsService', () => {
  let repository: jest.Mocked<AutomationRunsRepository>;
  let clock: ReturnType<typeof fakeClock>;
  let service: AutomationRunEventsService;

  beforeEach(() => {
    repository = {
      findRunSummary: jest.fn(),
      stepsChangedSince: jest.fn().mockResolvedValue([]),
      latestSteps: jest.fn().mockResolvedValue([]),
      connectionCredentials: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<AutomationRunsRepository>;
    clock = fakeClock();
    service = new AutomationRunEventsService(repository, clock);
  });

  it('never opens a stream for another workspace or a malformed id', async () => {
    repository.findRunSummary.mockResolvedValue(null);

    await expect(service.assertRun(ORG, RUN_ID)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.assertRun(ORG, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.findRunSummary).toHaveBeenCalledTimes(1);
    expect(repository.findRunSummary).toHaveBeenCalledWith(ORG, RUN_ID);
  });

  it('sends steps and the run as they change, then closes after the terminal state', async () => {
    repository.findRunSummary
      .mockResolvedValueOnce(runRow(AutomationRunStatus.RUNNING))
      .mockResolvedValueOnce(runRow(AutomationRunStatus.RUNNING))
      .mockResolvedValueOnce(
        runRow(AutomationRunStatus.SUCCEEDED, { stepCount: 2, finishedAt: at(2_000) }),
      );
    repository.stepsChangedSince
      // First poll: everything so far.
      .mockResolvedValueOnce([
        { id: 'row_trig', nodeKey: 'trig', updatedAt: at(100) },
        { id: 'row_bell', nodeKey: 'bell', updatedAt: at(200) },
      ])
      // Second: the same rows again (inside the look-back), nothing new.
      .mockResolvedValueOnce([
        { id: 'row_trig', nodeKey: 'trig', updatedAt: at(100) },
        { id: 'row_bell', nodeKey: 'bell', updatedAt: at(200) },
      ])
      // Third: the bell step finished.
      .mockResolvedValueOnce([{ id: 'row_bell', nodeKey: 'bell', updatedAt: at(1_900) }]);
    repository.latestSteps
      .mockResolvedValueOnce([
        latest('trig', AutomationStepStatus.SUCCEEDED, at(100)),
        latest('bell', AutomationStepStatus.RUNNING, at(200)),
      ])
      .mockResolvedValueOnce([latest('bell', AutomationStepStatus.SUCCEEDED, at(1_900))]);
    const { stream, events } = fakeStream();

    await service.stream(ORG, RUN_ID, stream);

    expect(events.map((event) => event.type)).toEqual(['step', 'step', 'run', 'step', 'run']);
    expect(events[0].data).toMatchObject({ nodeKey: 'trig', status: 'SUCCEEDED', attempts: 1 });
    expect(events[2].data).toEqual({
      id: RUN_ID,
      status: 'RUNNING',
      error: null,
      stepCount: 0,
      startedAt: T0.toISOString(),
      finishedAt: null,
    });
    expect(events[3].data).toMatchObject({ nodeKey: 'bell', status: 'SUCCEEDED' });
    expect(events[4].data).toMatchObject({ status: 'SUCCEEDED', stepCount: 2 });

    // Polls every 750 ms, looking back 5 s behind the newest change seen.
    expect(clock.slept).toEqual([RUN_EVENTS_POLL_MS, RUN_EVENTS_POLL_MS]);
    expect(repository.stepsChangedSince.mock.calls[0][2]).toEqual(new Date(0));
    expect(repository.stepsChangedSince.mock.calls[1][2]).toEqual(
      new Date(at(200).getTime() - RUN_EVENTS_OVERLAP_MS),
    );
    // Only the steps that changed are read in full.
    expect(repository.latestSteps).toHaveBeenLastCalledWith(ORG, RUN_ID, ['bell']);
  });

  it('closes at once for a run that already ended', async () => {
    repository.findRunSummary.mockResolvedValue(runRow(AutomationRunStatus.CANCELLED));
    const { stream, events } = fakeStream();

    await service.stream(ORG, RUN_ID, stream);

    expect(events).toEqual([
      { type: 'run', data: expect.objectContaining({ status: 'CANCELLED' }) },
    ]);
    expect(clock.slept).toEqual([]);
  });

  it('closes after 30 minutes so the client reconnects', async () => {
    repository.findRunSummary.mockResolvedValue(runRow(AutomationRunStatus.WAITING));
    const { stream, events } = fakeStream();

    await service.stream(ORG, RUN_ID, stream);

    expect(clock.slept).toHaveLength(Math.ceil(RUN_EVENTS_MAX_MS / RUN_EVENTS_POLL_MS));
    // The run did not change, so it was sent once.
    expect(events.filter((event) => event.type === 'run')).toHaveLength(1);
  });

  it('stops when the client leaves', async () => {
    const { stream, leave } = fakeStream();
    repository.findRunSummary.mockImplementation(async () => {
      stream.close();
      leave();
      return runRow(AutomationRunStatus.RUNNING);
    });

    await service.stream(ORG, RUN_ID, stream);
    expect(repository.findRunSummary).toHaveBeenCalledTimes(1);
  });

  it('hides connection values in step events', async () => {
    const previous = process.env.ENCRYPTION_KEY_AES256;
    process.env.ENCRYPTION_KEY_AES256 = 'd'.repeat(64);
    try {
      const link = 'https://discord.example.test/api/webhooks/123/secret-token-value';
      repository.connectionCredentials.mockResolvedValue([
        encrypt(JSON.stringify({ webhookUrl: link })),
      ]);
      repository.findRunSummary.mockResolvedValue(runRow(AutomationRunStatus.SUCCEEDED));
      repository.stepsChangedSince.mockResolvedValue([
        { id: 'row_bell', nodeKey: 'bell', updatedAt: at(100) },
      ]);
      repository.latestSteps.mockResolvedValue([
        latest('bell', AutomationStepStatus.SUCCEEDED, at(100), { input: { link } }),
      ]);
      const { stream, events } = fakeStream();

      await service.stream(ORG, RUN_ID, stream);

      expect(events[0].data).toMatchObject({ input: { link: HIDDEN } });
      expect(JSON.stringify(events)).not.toContain('secret-token-value');
    } finally {
      process.env.ENCRYPTION_KEY_AES256 = previous;
    }
  });

  it('reports a run that disappeared and a failed poll as error events', async () => {
    repository.findRunSummary.mockResolvedValueOnce(null);
    const first = fakeStream();
    await service.stream(ORG, RUN_ID, first.stream);
    expect(first.events).toEqual([
      { type: 'error', data: { message: 'This run is no longer available.' } },
    ]);

    repository.findRunSummary.mockRejectedValueOnce(new Error('connection reset'));
    const second = fakeStream();
    await expect(service.stream(ORG, RUN_ID, second.stream)).resolves.toBeUndefined();
    expect(second.events).toEqual([
      {
        type: 'error',
        data: { message: 'Live updates stopped. Open the run again to see where it is.' },
      },
    ]);
  });
});
