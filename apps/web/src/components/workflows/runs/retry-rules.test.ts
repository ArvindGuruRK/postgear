import { ApiError } from '@/lib/api';
import {
  RETRY_NOT_FAILED,
  RETRY_NOT_SAFE,
  RETRY_OLD_VERSION,
  RETRY_PUBLISHING,
  retryErrorMessage,
  retryFromHereState,
} from './retry-rules';

const failedRun = { status: 'FAILED' as const, mode: 'LIVE' as const, version: 3 };

describe('retryFromHereState', () => {
  it('is offered only on a failed step of a finished run', () => {
    expect(
      retryFromHereState({
        step: { status: 'SUCCEEDED', nodeType: 'notify.inApp' },
        run: failedRun,
        activeVersion: 3,
      }),
    ).toEqual({ show: false });
    expect(
      retryFromHereState({
        step: { status: 'FAILED', nodeType: 'notify.inApp' },
        run: { ...failedRun, status: 'RUNNING' },
        activeVersion: 3,
      }),
    ).toEqual({ show: false });
  });

  it('is enabled for a safe step of a run on the active version', () => {
    expect(
      retryFromHereState({
        step: { status: 'FAILED', nodeType: 'notify.inApp' },
        run: failedRun,
        activeVersion: 3,
      }),
    ).toEqual({ show: true, enabled: true });
  });

  it('refuses publishing steps with the publishing reason', () => {
    expect(
      retryFromHereState({
        step: { status: 'FAILED', nodeType: 'postgear.publish' },
        run: failedRun,
        activeVersion: 3,
      }),
    ).toEqual({ show: true, enabled: false, reason: RETRY_PUBLISHING });
  });

  it('refuses steps that are not safe to run twice', () => {
    expect(
      retryFromHereState({
        step: { status: 'FAILED', nodeType: 'notify.slack' },
        run: failedRun,
        activeVersion: 3,
      }),
    ).toEqual({ show: true, enabled: false, reason: RETRY_NOT_SAFE });
  });

  it('refuses a live run of an older version, but not a test run', () => {
    expect(
      retryFromHereState({
        step: { status: 'FAILED', nodeType: 'notify.inApp' },
        run: failedRun,
        activeVersion: 4,
      }),
    ).toEqual({ show: true, enabled: false, reason: RETRY_OLD_VERSION });
    expect(
      retryFromHereState({
        step: { status: 'FAILED', nodeType: 'notify.inApp' },
        run: { status: 'FAILED', mode: 'TEST', version: null },
        activeVersion: 4,
      }),
    ).toEqual({ show: true, enabled: true });
  });

  it('gives the reasons the owner asked for, word for word', () => {
    expect(RETRY_PUBLISHING).toBe(
      'Publishing steps cannot be retried from here. Start a new run instead.',
    );
    expect(RETRY_OLD_VERSION).toBe('This run used an older version.');
  });
});

describe('retryErrorMessage', () => {
  it('turns the API refusals into their sentences', () => {
    expect(retryErrorMessage(new ApiError('x', 422, 'retry_old_version'))).toBe(RETRY_OLD_VERSION);
    expect(retryErrorMessage(new ApiError('x', 422, 'retry_step_not_failed'))).toBe(
      RETRY_NOT_FAILED,
    );
    expect(retryErrorMessage(new ApiError('Not safe.', 422, 'retry_not_safe'))).toBe('Not safe.');
    expect(retryErrorMessage(new Error('boom'))).toBe(
      'The retry could not start. Try again in a moment.',
    );
  });
});
