/**
 * The code a failed work activity leaves on its job (Module 19 section 4):
 * our own code when the activity carried one, "This took too long and was
 * stopped." when the work ran past its time, and the plain failure for a lost
 * worker (a heartbeat timeout) or anything unknown.
 */

import { clipErrorMessage } from '@postgear/video-engine';
import {
  ActivityFailure,
  ApplicationFailure,
  RetryState,
  TimeoutFailure,
} from '@temporalio/common';
import { failureDetail } from './clip-job';

const activityFailure = (cause: Error) =>
  new ActivityFailure('failed', 'clipImport', '1', RetryState.TIMEOUT, 'worker', cause);

describe('failureDetail', () => {
  it('reads our code (and the platform) off an application failure', () => {
    const cause = ApplicationFailure.create({
      message: 'link_private',
      details: [{ code: 'link_private', platform: 'twitch' }],
    });
    expect(failureDetail(activityFailure(cause))).toEqual({
      code: 'link_private',
      platform: 'twitch',
    });
  });

  it.each(['START_TO_CLOSE', 'SCHEDULE_TO_CLOSE'] as const)(
    'reads a %s timeout as timed_out, with its sentence',
    (timeoutType) => {
      const detail = failureDetail(
        activityFailure(new TimeoutFailure('late', undefined, timeoutType)),
      );
      expect(detail).toEqual({ code: 'timed_out' });
      expect(clipErrorMessage(detail.code)).toBe('This took too long and was stopped. Try again.');
    },
  );

  it('keeps a heartbeat timeout (a lost worker) as the plain failure', () => {
    expect(
      failureDetail(activityFailure(new TimeoutFailure('lost', undefined, 'HEARTBEAT'))),
    ).toEqual({
      code: 'tool_failed',
    });
  });

  it('reads anything else as the plain failure', () => {
    expect(failureDetail(new Error('boom'))).toEqual({ code: 'tool_failed' });
  });
});
