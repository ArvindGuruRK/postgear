/**
 * Runs and steps for the Runs tab's tests: a complete row with sensible
 * defaults, each test overriding only what it is about.
 */
import type { RunStep, RunSummary } from '@/types/workflows';

export function makeRun(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    id: 'run-1',
    automationId: 'wf-1',
    mode: 'LIVE',
    status: 'SUCCEEDED',
    triggerType: 'trigger.postPublished',
    options: null,
    startedById: null,
    stepCount: 3,
    creditsUsed: 0,
    error: null,
    startedAt: '2026-10-29T14:02:00.000Z',
    finishedAt: '2026-10-29T14:02:03.100Z',
    createdAt: '2026-10-29T14:02:00.000Z',
    version: 3,
    triggerSummary: 'Post published on Instagram',
    ...overrides,
  };
}

export function makeStep(overrides: Partial<RunStep> = {}): RunStep {
  return {
    id: `row-${overrides.nodeKey ?? 'slack'}`,
    nodeKey: 'slack',
    nodeType: 'notify.slack',
    nodeName: 'Slack',
    status: 'SUCCEEDED',
    attempt: 1,
    attempts: 1,
    input: { text: 'Hello' },
    output: { sent: true },
    truncated: false,
    error: null,
    ports: ['out'],
    startedAt: '2026-10-29T14:02:01.000Z',
    finishedAt: '2026-10-29T14:02:02.000Z',
    durationMs: 1000,
    updatedAt: '2026-10-29T14:02:02.000Z',
    ...overrides,
  };
}
