/**
 * Module 19: how the API asks for an uploaded video's poster and length.
 * Against a fake Temporal client: the workflow goes to the media queue under
 * one id per Media row, a run already going counts as started, and an
 * unreachable Temporal answers false (logged by the scheduler) instead of
 * throwing into the upload.
 */
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  MEDIA_TASK_QUEUE,
  MEDIA_VIDEO_FACTS_TIMEOUT_MS,
  MEDIA_VIDEO_FACTS_WORKFLOW,
} from '@postgear/scheduling';
import { WorkflowExecutionAlreadyStartedError, WorkflowIdReusePolicy } from '@temporalio/client';
import type { Env } from '../../config/env';
import { type SchedulingClient, SchedulingService } from '../scheduling/scheduling.service';

const config = {
  get: (key: string) => (key === 'TEMPORAL_HOST' ? 'localhost:7233' : 'default'),
} as unknown as ConfigService<Env, true>;

function serviceWith(start: jest.Mock) {
  const client = { workflow: { start } } as unknown as SchedulingClient;
  return new SchedulingService(config, async () => client);
}

describe('SchedulingService.startMediaVideoFacts', () => {
  it('starts the facts workflow on the media queue, keyed on the Media row', async () => {
    const start = jest.fn().mockResolvedValue({});

    await expect(serviceWith(start).startMediaVideoFacts('m-1', 'org-1')).resolves.toBe(true);

    expect(start).toHaveBeenCalledWith(MEDIA_VIDEO_FACTS_WORKFLOW, {
      workflowId: 'media-video-facts:m-1',
      taskQueue: MEDIA_TASK_QUEUE,
      args: [{ mediaId: 'm-1', organizationId: 'org-1' }],
      workflowExecutionTimeout: MEDIA_VIDEO_FACTS_TIMEOUT_MS,
      workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
    });
  });

  it('takes a run that is already going as started', async () => {
    const start = jest
      .fn()
      .mockRejectedValue(
        new WorkflowExecutionAlreadyStartedError('running', 'media-video-facts:m-1', 'type'),
      );

    await expect(serviceWith(start).startMediaVideoFacts('m-1', 'org-1')).resolves.toBe(true);
  });

  it('answers false, and logs, when Temporal cannot be reached', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const start = jest.fn().mockRejectedValue(new Error('connection refused'));

      await expect(serviceWith(start).startMediaVideoFacts('m-1', 'org-1')).resolves.toBe(false);
      expect(String(warn.mock.calls[0]?.[0])).toContain('media video facts');
    } finally {
      warn.mockRestore();
    }
  });
});
