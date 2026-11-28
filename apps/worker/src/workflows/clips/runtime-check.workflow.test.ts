/**
 * `clipRuntimeCheckWorkflow` with the Python service up and down (Sprint 13,
 * Module 01). A second worker on `postgear-media-py` stands in for Python:
 * it registers `mediaPyHealth` under the contract's name, as the Python
 * worker does. With no worker on that queue, the check still answers the
 * video tools and marks the Python service off after its four seconds.
 */
import type { MediaPyHealthOutput } from '@postgear/media-contract';
import { MEDIA_PY_TASK_QUEUE, MEDIA_PY_TIMINGS } from '@postgear/scheduling';
import { ApplicationFailure } from '@temporalio/common';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { MEDIA_PY_OFF, clipRuntimeCheckWorkflow } from './runtime-check.workflow';

jest.setTimeout(180_000);

const TASK_QUEUE = 'test-runtime-check';

const toolsReport = {
  ok: true,
  simulation: true,
  platforms: ['youtube'],
  checks: [],
  checkedAt: '2026-11-25T00:00:00.000Z',
};

const health: MediaPyHealthOutput = {
  contractVersion: 1,
  serviceVersion: '0.1.0',
  pythonVersion: '3.13.18',
  simulation: true,
  taskQueue: MEDIA_PY_TASK_QUEUE,
  bindings: {
    transcriber: { state: 'simulation', name: 'simulation' },
    faces: { state: 'simulation', name: 'simulation' },
    motion: { state: 'simulation', name: 'simulation' },
    stills: { state: 'off', name: 'opencv' },
    speaker: { state: 'live', name: 'kokoro' },
    hostedTranscriber: { state: 'simulation', name: 'simulation' },
  },
  modelsPresent: false,
  hostedAboveMinutes: null,
};

let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
});

afterAll(async () => {
  await env?.teardown();
});

function nodeWorker() {
  return Worker.create({
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: require.resolve('../index'),
    activities: { clipRuntimeCheck: jest.fn().mockResolvedValue(toolsReport) },
  });
}

function pythonStandIn(mediaPyHealth: jest.Mock) {
  return Worker.create({
    connection: env.nativeConnection,
    taskQueue: MEDIA_PY_TASK_QUEUE,
    activities: { mediaPyHealth },
  });
}

describe('clipRuntimeCheckWorkflow and the Python service', () => {
  it('adds the typed health answer when the Python worker polls', async () => {
    const mediaPyHealth = jest.fn().mockResolvedValue(health);
    const [node, python] = await Promise.all([nodeWorker(), pythonStandIn(mediaPyHealth)]);
    const report = await python.runUntil(
      node.runUntil(
        env.client.workflow.execute(clipRuntimeCheckWorkflow, {
          taskQueue: TASK_QUEUE,
          workflowId: 'runtime-check-python-up',
        }),
      ),
    );
    expect(mediaPyHealth).toHaveBeenCalledWith({ version: 1 });
    expect(report.ok).toBe(true);
    expect(report.mediaPy).toEqual({
      ok: true,
      simulation: true,
      contractVersion: 1,
      serviceVersion: '0.1.0',
      bindings: {
        transcriber: 'simulation',
        faces: 'simulation',
        motion: 'simulation',
        stills: 'off',
        speaker: 'live',
        hostedTranscriber: 'simulation',
      },
    });
  });

  it('marks the Python service off when nobody polls its queue, and still answers the tools', async () => {
    const node = await nodeWorker();
    const report = await node.runUntil(
      env.client.workflow.execute(clipRuntimeCheckWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'runtime-check-python-down',
      }),
    );
    expect(report.ok).toBe(true);
    expect(report.checks).toEqual([]);
    expect(report.mediaPy).toEqual(MEDIA_PY_OFF);
  });

  it('marks it off when it speaks another contract version', async () => {
    const mediaPyHealth = jest.fn().mockResolvedValue({ ...health, contractVersion: 2 });
    const [node, python] = await Promise.all([nodeWorker(), pythonStandIn(mediaPyHealth)]);
    const report = await python.runUntil(
      node.runUntil(
        env.client.workflow.execute(clipRuntimeCheckWorkflow, {
          taskQueue: TASK_QUEUE,
          workflowId: 'runtime-check-python-old',
        }),
      ),
    );
    expect(report.mediaPy?.ok).toBe(false);
  });

  it('does not retry a failed health call (one attempt, then off)', async () => {
    const mediaPyHealth = jest
      .fn()
      .mockRejectedValue(ApplicationFailure.create({ message: 'boom', type: 'MEDIA_TOOL_FAILED' }));
    const [node, python] = await Promise.all([nodeWorker(), pythonStandIn(mediaPyHealth)]);
    const report = await python.runUntil(
      node.runUntil(
        env.client.workflow.execute(clipRuntimeCheckWorkflow, {
          taskQueue: TASK_QUEUE,
          workflowId: 'runtime-check-python-fails',
        }),
      ),
    );
    expect(mediaPyHealth).toHaveBeenCalledTimes(MEDIA_PY_TIMINGS.mediaPyHealth.maximumAttempts);
    expect(report.mediaPy).toEqual(MEDIA_PY_OFF);
  });
});
