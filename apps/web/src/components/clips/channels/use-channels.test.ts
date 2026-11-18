import { act, renderHook } from '@testing-library/react';
import { ApiError } from '@/lib/api';
import type { ClipChannelView } from '@/types/clips';
import { FIXTURE_CHANNEL } from '../clips-fixtures';
import { CHANNELS_LOAD_FAILED, useChannels } from './use-channels';

jest.mock('@/lib/clips-api', () => ({}));

interface Pending {
  signal: AbortSignal;
  resolve: (channels: ClipChannelView[]) => void;
  reject: (cause: unknown) => void;
}

function controlledLoad() {
  const calls: Pending[] = [];
  const load = jest.fn(
    (options: { signal?: AbortSignal } = {}) =>
      new Promise<ClipChannelView[]>((resolve, reject) => {
        calls.push({ signal: options.signal as AbortSignal, resolve, reject });
      }),
  );
  return { load, calls };
}

const OTHER: ClipChannelView = { ...FIXTURE_CHANNEL, id: 'channel-2', displayName: 'Other' };

describe('useChannels', () => {
  it('asks nothing until it is enabled, then loads once', async () => {
    const { load, calls } = controlledLoad();
    const { result, rerender } = renderHook(({ enabled }) => useChannels(enabled, load), {
      initialProps: { enabled: false },
    });
    expect(load).not.toHaveBeenCalled();

    rerender({ enabled: true });
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => calls[0].resolve([FIXTURE_CHANNEL]));
    expect(result.current.loading).toBe(false);
    expect(result.current.channels).toEqual([FIXTURE_CHANNEL]);

    rerender({ enabled: false });
    rerender({ enabled: true });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('lets a newer load win over a slower older one', async () => {
    const { load, calls } = controlledLoad();
    const { result } = renderHook(() => useChannels(true, load));
    act(() => result.current.reload());
    expect(calls[0].signal.aborted).toBe(true);

    await act(async () => calls[1].resolve([OTHER]));
    await act(async () => calls[0].resolve([FIXTURE_CHANNEL]));
    expect(result.current.channels).toEqual([OTHER]);
  });

  it("keeps the API's sentence, or says the list did not load", async () => {
    const { load, calls } = controlledLoad();
    const { result } = renderHook(() => useChannels(true, load));
    await act(async () =>
      calls[0].reject(new ApiError('Clips is switched off.', 403, 'clips_disabled')),
    );
    expect(result.current.error).toEqual({
      message: 'Clips is switched off.',
      code: 'clips_disabled',
    });

    act(() => result.current.reload());
    await act(async () => calls[1].reject(new TypeError('Failed to fetch')));
    expect(result.current.error).toEqual({ message: CHANNELS_LOAD_FAILED, code: undefined });
  });

  it('puts an added channel first, never twice, and drops a removed one', async () => {
    const { load, calls } = controlledLoad();
    const { result } = renderHook(() => useChannels(true, load));
    await act(async () => calls[0].resolve([FIXTURE_CHANNEL]));

    act(() => result.current.added(OTHER));
    expect(result.current.channels.map((one) => one.id)).toEqual(['channel-2', 'channel-1']);
    act(() => result.current.added({ ...FIXTURE_CHANNEL, displayName: 'Renamed' }));
    expect(result.current.channels.map((one) => one.id)).toEqual(['channel-1', 'channel-2']);
    expect(result.current.channels[0].displayName).toBe('Renamed');

    act(() => result.current.removed('channel-2'));
    expect(result.current.channels.map((one) => one.id)).toEqual(['channel-1']);
  });
});
