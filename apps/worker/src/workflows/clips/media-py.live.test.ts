/**
 * The one real cross-language test (Sprint 13, Module 01): a TypeScript
 * workflow on the local Temporal calls `mediaPyHealth` on the running Python
 * service and gets the typed answer back.
 *
 * It needs Docker's Temporal and `npm run dev:media`, so it runs only with
 * `MEDIA_PY_LIVE_TEST=1` and shows as skipped otherwise (CI has neither):
 *
 *   MEDIA_PY_LIVE_TEST=1 npx jest --config apps/worker/jest.config.js media-py.live
 *
 * The Node side here is a workflow-only worker on its own queue with a
 * stand-in for the doctor, so the test proves the Python hop and nothing else.
 */
import { mediaPyHealthOutput } from '@postgear/media-contract';
import { MEDIA_PY_TASK_QUEUE } from '@postgear/scheduling';
import { Client, Connection } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import { clipRuntimeCheckWorkflow } from './runtime-check.workflow';

const live = process.env.MEDIA_PY_LIVE_TEST === '1';
const describeLive = live ? describe : describe.skip;

jest.setTimeout(120_000);

describeLive('a TypeScript workflow calls the Python media service', () => {
  const address = process.env.TEMPORAL_HOST ?? 'localhost:7233';
  const namespace = process.env.TEMPORAL_NAMESPACE ?? 'default';
  const taskQueue = `test-media-py-live-${Date.now()}`;
  let native: NativeConnection;
  let connection: Connection;

  beforeAll(async () => {
    native = await NativeConnection.connect({ address });
    connection = await Connection.connect({ address });
  });

  afterAll(async () => {
    await connection?.close();
    await native?.close();
  });

  it('gets the typed health answer from postgear-media-py', async () => {
    const worker = await Worker.create({
      connection: native,
      namespace,
      taskQueue,
      workflowsPath: require.resolve('../index'),
      activities: {
        clipRuntimeCheck: async () => ({
          ok: true,
          simulation: true,
          platforms: [],
          checks: [],
          checkedAt: new Date().toISOString(),
        }),
      },
    });
    const client = new Client({ connection, namespace });
    const report = await worker.runUntil(
      client.workflow.execute(clipRuntimeCheckWorkflow, {
        taskQueue,
        workflowId: `media-py-live-${Date.now()}`,
        workflowExecutionTimeout: '30 seconds',
      }),
    );

    expect(report.mediaPy).toBeDefined();
    expect(report.mediaPy?.ok).toBe(true);
    expect(report.mediaPy?.contractVersion).toBe(1);
    expect(Object.keys(report.mediaPy?.bindings ?? {}).sort()).toEqual([
      'faces',
      'motion',
      'stills',
      'transcriber',
    ]);
    // The same shape the contract's fixtures pin, rebuilt from the report's parts.
    expect(mediaPyHealthOutput.shape.taskQueue.parse(MEDIA_PY_TASK_QUEUE)).toBe('postgear-media-py');
  });
});

if (!live) {
  it('is skipped without MEDIA_PY_LIVE_TEST=1 (it needs Temporal and the Python service)', () => {
    expect(live).toBe(false);
  });
}
