/**
 * The plan store keeps an open screen in step with the plan (Sprint 12,
 * Module 20 e2e finding): the editor reads it once and stays open for a long
 * time, so an upgrade made meanwhile has to reach it without a reload. It
 * checks the answer's age every few seconds and when the tab comes back into
 * view, and asks again only once the answer is older than 15 seconds.
 *
 * The store lives at module level, so each test uses a workspace of its own
 * (a new workspace drops the old answer, as switching workspaces does).
 */
import { act, renderHook } from '@testing-library/react';
import { type EntitlementSnapshot, useEntitlements } from './entitlements';

const mockApi = jest.fn();
jest.mock('./api', () => ({
  api: (...args: unknown[]) => mockApi(...args),
  onPaymentRequired: jest.fn(),
}));

function snapshot(tier: string, quality: string): EntitlementSnapshot {
  return {
    tier,
    status: 'ACTIVE',
    trialEndsAt: null,
    values: { 'clips.export_max_quality': quality },
    meters: {},
  };
}

const FREE = snapshot('FREE', '720p');
const PRO = snapshot('PRO', '1080p60');

/** Lets the resolved request reach the store and React. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setVisibility(value: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
}

describe('useEntitlements', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-19T10:00:00Z'));
    mockApi.mockReset();
    setVisibility('visible');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('follows a plan change while the screen stays open, once the answer is 15 seconds old', async () => {
    mockApi.mockResolvedValueOnce(FREE).mockResolvedValueOnce(PRO);

    const { result } = renderHook(() => useEntitlements('org-follows'));
    await settle();
    expect(result.current.snapshot?.tier).toBe('FREE');
    expect(mockApi).toHaveBeenCalledTimes(1);

    // Still fresh after ten seconds: nothing is asked.
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    expect(mockApi).toHaveBeenCalledTimes(1);

    // Past fifteen seconds the next check asks again, and the screen redraws.
    await act(async () => {
      jest.advanceTimersByTime(6_000);
    });
    await settle();
    expect(mockApi).toHaveBeenCalledTimes(2);
    expect(result.current.snapshot?.tier).toBe('PRO');
    expect(result.current.snapshot?.values['clips.export_max_quality']).toBe('1080p60');
  });

  it('asks again when the tab comes back into view with an old answer', async () => {
    mockApi.mockResolvedValueOnce(FREE).mockResolvedValueOnce(PRO);
    const { result } = renderHook(() => useEntitlements('org-focus'));
    await settle();

    // Hidden: the timer checks nothing.
    setVisibility('hidden');
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(mockApi).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await settle();
    expect(mockApi).toHaveBeenCalledTimes(2);
    expect(result.current.snapshot?.tier).toBe('PRO');
  });

  it('shares one request between screens and stops checking once none is open', async () => {
    mockApi.mockResolvedValue(FREE);
    const first = renderHook(() => useEntitlements('org-shared'));
    const second = renderHook(() => useEntitlements('org-shared'));
    await settle();
    expect(mockApi).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(20_000);
    });
    await settle();
    // Two screens, one request per age-out.
    expect(mockApi).toHaveBeenCalledTimes(2);

    first.unmount();
    second.unmount();
    await act(async () => {
      jest.advanceTimersByTime(120_000);
    });
    expect(mockApi).toHaveBeenCalledTimes(2);
  });
});
