/**
 * Security sweep, the Limits line (Sprint 12, Module 20 section 1): a clip
 * job cannot outlive its timeout.
 *
 * The API starts every clip workflow with the contract's execution timeout
 * (`scheduling.clips.security.spec.ts`), and the runner kills a program at
 * its own time limit (`runner.test.ts` "kills the program at the timeout",
 * `runner-time-limit.security.test.ts`). In between, this file pins the
 * workflow side: the heavy activity is only ever given what is left of the
 * job's limit less the bookkeeping reserve (per attempt and across attempts),
 * it must heartbeat, and every other activity a clip workflow can run has a
 * finite time and a bounded number of tries.
 *
 * `@temporalio/workflow` is mocked only where it needs a running workflow
 * (`workflowInfo`) or records what we check (`proxyActivities`).
 */
import {
  CLIP_FAILURE_TYPES,
  CLIP_HEARTBEAT_MS,
  CLIP_JOB_TIMEOUTS_MS,
  CLIP_RETRY_POLICY,
  CLIP_SAVE_DOWNLOAD_TIMEOUT_MS,
  type ClipJobKindName,
} from '@postgear/scheduling';
import { msToNumber } from '@temporalio/common/lib/time';
import * as workflow from '@temporalio/workflow';
import { CLEANUP_RESERVE_MS, workActivities, workBudgetMs } from './clip-job';
// Loaded for the proxies they make at load time (recorded by the mock below).
import './job.workflows';
import './query.workflows';
import './runtime-check.workflow';
import './sound-check.workflow';
import './sticker-check.workflow';

interface ProxyOptions {
  startToCloseTimeout?: number | string;
  scheduleToCloseTimeout?: number | string;
  heartbeatTimeout?: number | string;
  retry?: { maximumAttempts?: number; nonRetryableErrorTypes?: string[] };
}

interface Recorded {
  proxies: ProxyOptions[];
  info: { startTime: Date; executionExpirationTime: Date | undefined };
}

// The record lives inside the mock, so it exists before any module that is loaded with it.
jest.mock('@temporalio/workflow', () => {
  const recorded: Recorded = {
    proxies: [],
    info: { startTime: new Date(0), executionExpirationTime: undefined },
  };
  return {
    ...jest.requireActual('@temporalio/workflow'),
    recorded,
    proxyActivities: (options: ProxyOptions) => {
      recorded.proxies.push(options);
      return {};
    },
    workflowInfo: () => recorded.info,
    defineSignal: (name: string) => ({ name, type: 'signal' }),
  };
});

const mockWorkflow = (workflow as unknown as { recorded: Recorded }).recorded;

const KINDS = Object.keys(CLIP_JOB_TIMEOUTS_MS) as ClipJobKindName[];
const START = new Date('2026-11-19T10:00:00.000Z');
const MINUTE = 60_000;

const asMs = (value: number | string | undefined): number =>
  value === undefined ? Number.POSITIVE_INFINITY : msToNumber(value as never);

/** The work activity's options for a job of `kind`, `elapsed` ms after it started. */
function workOptions(kind: ClipJobKindName, elapsed: number, knownExpiry = true): ProxyOptions {
  mockWorkflow.info = {
    startTime: START,
    executionExpirationTime: knownExpiry
      ? new Date(START.getTime() + CLIP_JOB_TIMEOUTS_MS[kind])
      : undefined,
  };
  const now = jest.spyOn(Date, 'now').mockReturnValue(START.getTime() + elapsed);
  const before = mockWorkflow.proxies.length;
  try {
    workActivities(kind);
  } finally {
    now.mockRestore();
  }
  const made = mockWorkflow.proxies.slice(before);
  expect(made).toHaveLength(1);
  return made[0] as ProxyOptions;
}

/** Every proxy recorded while the modules loaded (the bookkeeping, look, quick and check ones). */
const loadTimeProxies = [...mockWorkflow.proxies];

describe('the heavy work of a clip job', () => {
  it.each(KINDS)(
    'a %s job gives its work only what is left of its limit, less the reserve',
    (kind) => {
      const limit = CLIP_JOB_TIMEOUTS_MS[kind];
      for (const elapsed of [0, 5 * MINUTE, limit / 2, limit - CLEANUP_RESERVE_MS - 2 * MINUTE]) {
        const options = workOptions(kind, elapsed);
        const left = limit - elapsed - CLEANUP_RESERVE_MS;
        // Per attempt and across attempts: retries cannot add time.
        expect(asMs(options.startToCloseTimeout)).toBe(left);
        expect(asMs(options.scheduleToCloseTimeout)).toBe(left);
        expect(
          START.getTime() + elapsed + asMs(options.scheduleToCloseTimeout),
        ).toBeLessThanOrEqual(START.getTime() + limit - CLEANUP_RESERVE_MS);
      }
    },
  );

  it.each(KINDS)('a %s job must heartbeat, and retries at most as the contract says', (kind) => {
    const options = workOptions(kind, 0);
    expect(asMs(options.heartbeatTimeout)).toBe(2 * CLIP_HEARTBEAT_MS);
    expect(options.retry?.maximumAttempts).toBe(CLIP_RETRY_POLICY.maximumAttempts);
    expect(options.retry?.nonRetryableErrorTypes).toContain(CLIP_FAILURE_TYPES.permanent);
  });

  it('reads the limit from the contract when Temporal does not say when the run expires', () => {
    const options = workOptions('RENDER', 10 * MINUTE, false);
    expect(asMs(options.scheduleToCloseTimeout)).toBe(
      CLIP_JOB_TIMEOUTS_MS.RENDER - 10 * MINUTE - CLEANUP_RESERVE_MS,
    );
  });

  it('never hands out more than the minimum minute once the reserve is reached', () => {
    mockWorkflow.info = {
      startTime: START,
      executionExpirationTime: new Date(START.getTime() + CLIP_JOB_TIMEOUTS_MS.IMPORT),
    };
    const now = jest
      .spyOn(Date, 'now')
      .mockReturnValue(START.getTime() + CLIP_JOB_TIMEOUTS_MS.IMPORT - MINUTE);
    try {
      expect(workBudgetMs('IMPORT')).toBe(MINUTE);
    } finally {
      now.mockRestore();
    }
  });
});

describe('every other activity a clip workflow runs', () => {
  it('has a finite time per attempt and a bounded number of tries', () => {
    expect(loadTimeProxies.length).toBeGreaterThanOrEqual(7);
    for (const options of loadTimeProxies) {
      const perAttempt = asMs(options.startToCloseTimeout);
      expect(Number.isFinite(perAttempt)).toBe(true);
      const attempts = options.retry?.maximumAttempts;
      const total = asMs(options.scheduleToCloseTimeout);
      // Either the whole is capped, or each try is and the tries are few.
      expect(
        Number.isFinite(total) || (attempts !== undefined && attempts > 0 && attempts <= 5),
      ).toBe(true);
    }
  });

  it("keeps Save To Media's tries inside its own workflow limit", () => {
    const save = loadTimeProxies.find((options) => options.heartbeatTimeout !== undefined);
    expect(save).toBeDefined();
    expect(asMs(save?.scheduleToCloseTimeout)).toBeLessThan(CLIP_SAVE_DOWNLOAD_TIMEOUT_MS);
  });
});
