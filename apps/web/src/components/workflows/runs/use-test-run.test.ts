/**
 * The test run's pure rules (Module 08): why a test did not start, and each
 * step's last result across tests (newer wins, unfinished rows wait).
 */
import { ApiError } from '@/lib/api';
import type { AutomationStepStatus, RunStep } from '@/types/workflows';
import type { RunModel } from './run-model';
import {
  mergeLastTest,
  stepResult,
  TEST_NOT_STARTED,
  TOO_MANY_TESTS,
  testRefusal,
} from './use-test-run';

function step(nodeKey: string, status: AutomationStepStatus, at: string): RunStep {
  return {
    id: `${nodeKey}-${at}`,
    nodeKey,
    nodeType: 'logic.setFields',
    nodeName: nodeKey,
    status,
    attempt: 1,
    attempts: 1,
    input: null,
    output: { at },
    truncated: false,
    error: null,
    ports: ['out'],
    startedAt: at,
    finishedAt: status === 'RUNNING' || status === 'QUEUED' ? null : at,
    durationMs: 10,
    updatedAt: at,
  };
}

function model(runId: string, steps: RunStep[], running = false): RunModel {
  return {
    runId,
    automationId: 'w1',
    mode: 'TEST',
    runStatus: running ? 'RUNNING' : 'SUCCEEDED',
    error: null,
    startedAt: steps[0]?.startedAt ?? null,
    finishedAt: running ? null : (steps.at(-1)?.finishedAt ?? null),
    graph: null,
    steps: Object.fromEntries(steps.map((row) => [row.nodeKey, row])),
    paint: {},
    edgesTaken: new Set(),
    edgesSkipped: new Set(),
    edgesActive: new Set(),
  };
}

const EARLY = '2026-10-29T14:02:00.000Z';
const LATE = '2026-10-29T14:05:00.000Z';

describe('testRefusal', () => {
  it('says to wait a minute on a 429', () => {
    expect(testRefusal(new ApiError('Slow down', 429))).toEqual({
      message: TOO_MANY_TESTS,
      blocked: false,
    });
  });

  it('asks for the issues list on a 422 test_blocked', () => {
    expect(testRefusal(new ApiError('Fix 2 issues first.', 422, 'test_blocked'))).toEqual({
      message: 'Fix 2 issues first.',
      blocked: true,
    });
  });

  it("shows the API's words for another refusal, and a plain sentence when offline", () => {
    expect(testRefusal(new ApiError('This workflow has no trigger.', 422))).toEqual({
      message: 'This workflow has no trigger.',
      blocked: false,
    });
    expect(testRefusal(new ApiError('Network', 0)).message).toBe(TEST_NOT_STARTED);
    expect(testRefusal(new Error('boom')).message).toBe(TEST_NOT_STARTED);
  });
});

describe('mergeLastTest', () => {
  it('keeps finished results and leaves rows still going or passed over', () => {
    const merged = mergeLastTest(
      {},
      model(
        'run-1',
        [
          step('a', 'SUCCEEDED', EARLY),
          step('b', 'RUNNING', EARLY),
          step('c', 'SKIPPED', EARLY),
          step('d', 'DRY_RUN', EARLY),
        ],
        true,
      ),
    );
    expect(Object.keys(merged).sort()).toEqual(['a', 'd']);
    expect(merged.a).toMatchObject({ runId: 'run-1', at: EARLY, live: false });
  });

  it('returns the same object when nothing changed', () => {
    const run = model('run-1', [step('a', 'SUCCEEDED', EARLY)]);
    const once = mergeLastTest({}, run);
    expect(mergeLastTest(once, run)).toBe(once);
  });

  it('lets a newer result win, so an older run loaded late hides nothing', () => {
    const newer = mergeLastTest({}, model('run-2', [step('a', 'FAILED', LATE)]));
    const after = mergeLastTest(newer, model('run-1', [step('a', 'SUCCEEDED', EARLY)]));
    expect(after.a.runId).toBe('run-2');
    const replaced = mergeLastTest(
      mergeLastTest({}, model('run-1', [step('a', 'SUCCEEDED', EARLY)])),
      model('run-2', [step('a', 'FAILED', LATE)]),
    );
    expect(replaced.a.step.status).toBe('FAILED');
  });
});

describe('stepResult', () => {
  const last = mergeLastTest({}, model('run-1', [step('a', 'SUCCEEDED', EARLY)]));

  it("shows the running test's row first, marked live", () => {
    const result = stepResult('a', model('run-2', [step('a', 'RUNNING', LATE)], true), last);
    expect(result).toMatchObject({ runId: 'run-2', live: true });
  });

  it('falls back to the last result, then to nothing', () => {
    const running = model('run-2', [step('b', 'RUNNING', LATE)], true);
    expect(stepResult('a', running, last)?.runId).toBe('run-1');
    expect(stepResult('a', null, last)?.runId).toBe('run-1');
    expect(stepResult('z', running, last)).toBeNull();
  });
});
