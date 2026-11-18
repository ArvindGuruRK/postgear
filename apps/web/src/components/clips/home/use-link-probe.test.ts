import { act, renderHook } from '@testing-library/react';
import { ApiError } from '@/lib/api';
import type { ClipProbe } from '@/types/clips';
import { fixtureProbe } from '../clips-fixtures';
import { PROBE_UNREACHABLE, type ProbeFn, useLinkProbe } from './use-link-probe';

interface Pending {
  url: string;
  signal: AbortSignal;
  resolve: (probe: ClipProbe) => void;
  reject: (cause: unknown) => void;
}

/** A probe that answers only when the test says so. */
function controlledProbe() {
  const calls: Pending[] = [];
  const probeFn: jest.MockedFunction<ProbeFn> = jest.fn(
    (url, { signal }) =>
      new Promise<ClipProbe>((resolve, reject) => {
        calls.push({ url, signal, resolve, reject });
      }),
  );
  return { probeFn, calls };
}

const titled = (title: string) => fixtureProbe({ info: { ...fixtureProbe().info, title } });

describe('useLinkProbe', () => {
  it('shows the card for a link that reads', async () => {
    const { probeFn, calls } = controlledProbe();
    const { result } = renderHook(() => useLinkProbe(probeFn));

    act(() => result.current.probe('  https://www.twitch.tv/videos/1  '));
    expect(result.current.state).toEqual({
      kind: 'looking',
      url: 'https://www.twitch.tv/videos/1',
    });
    expect(probeFn).toHaveBeenCalledWith('https://www.twitch.tv/videos/1', expect.anything());

    const answer = titled('First');
    await act(async () => calls[0].resolve(answer));
    expect(result.current.state).toEqual({
      kind: 'found',
      url: 'https://www.twitch.tv/videos/1',
      probe: answer,
    });
  });

  it('never lets a slower older probe replace a newer one', async () => {
    const { probeFn, calls } = controlledProbe();
    const { result } = renderHook(() => useLinkProbe(probeFn));

    act(() => result.current.probe('https://www.twitch.tv/videos/1'));
    act(() => result.current.probe('https://www.twitch.tv/videos/2'));
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls[1].signal.aborted).toBe(false);

    await act(async () => calls[1].resolve(titled('Second')));
    // The first answers late anyway, as if its abort came too late.
    await act(async () => calls[0].resolve(titled('First')));

    expect(result.current.state).toMatchObject({
      kind: 'found',
      url: 'https://www.twitch.tv/videos/2',
      probe: { info: { title: 'Second' } },
    });
  });

  it('drops a late refusal for an older link too', async () => {
    const { probeFn, calls } = controlledProbe();
    const { result } = renderHook(() => useLinkProbe(probeFn));

    act(() => result.current.probe('https://www.twitch.tv/videos/1'));
    act(() => result.current.probe('https://www.twitch.tv/videos/2'));
    await act(async () => calls[0].reject(new ApiError('Private.', 422, 'link_private')));
    expect(result.current.state).toEqual({
      kind: 'looking',
      url: 'https://www.twitch.tv/videos/2',
    });
  });

  it("carries the API's sentence and code on a refusal", async () => {
    const { probeFn, calls } = controlledProbe();
    const { result } = renderHook(() => useLinkProbe(probeFn));

    act(() => result.current.probe('https://vimeo.com/1'));
    await act(async () =>
      calls[0].reject(
        new ApiError(
          'Vimeo links are not supported. You can upload the file instead.',
          422,
          'link_unsupported',
        ),
      ),
    );
    expect(result.current.state).toEqual({
      kind: 'refused',
      url: 'https://vimeo.com/1',
      message: 'Vimeo links are not supported. You can upload the file instead.',
      code: 'link_unsupported',
    });
  });

  it('says Clips could not be reached when there is no answer', async () => {
    const { probeFn, calls } = controlledProbe();
    const { result } = renderHook(() => useLinkProbe(probeFn));

    act(() => result.current.probe('https://www.twitch.tv/videos/1'));
    await act(async () => calls[0].reject(new TypeError('Failed to fetch')));
    expect(result.current.state).toEqual({
      kind: 'refused',
      url: 'https://www.twitch.tv/videos/1',
      message: PROBE_UNREACHABLE,
      code: undefined,
    });

    act(() => result.current.probe('https://www.twitch.tv/videos/2'));
    await act(async () => calls[1].reject(new ApiError('offline', 0)));
    expect(result.current.state).toMatchObject({ kind: 'refused', message: PROBE_UNREACHABLE });
  });

  it('asks nothing for an empty link, and reset drops a running probe', async () => {
    const { probeFn, calls } = controlledProbe();
    const { result } = renderHook(() => useLinkProbe(probeFn));

    act(() => result.current.probe('   '));
    expect(probeFn).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ kind: 'idle' });

    act(() => result.current.probe('https://www.twitch.tv/videos/1'));
    act(() => result.current.reset());
    expect(calls[0].signal.aborted).toBe(true);
    await act(async () => calls[0].resolve(titled('Late')));
    expect(result.current.state).toEqual({ kind: 'idle' });
  });

  it('shows a probe made elsewhere and cancels its own', async () => {
    const { probeFn, calls } = controlledProbe();
    const { result } = renderHook(() => useLinkProbe(probeFn));

    act(() => result.current.probe('https://www.twitch.tv/videos/1'));
    const fromRow = titled('From A Channel Row');
    act(() => result.current.show('https://www.twitch.tv/videos/9', fromRow));
    await act(async () => calls[0].resolve(titled('Late')));
    expect(result.current.state).toEqual({
      kind: 'found',
      url: 'https://www.twitch.tv/videos/9',
      probe: fromRow,
    });
  });

  it('aborts the running probe when the page goes away', () => {
    const { probeFn, calls } = controlledProbe();
    const { result, unmount } = renderHook(() => useLinkProbe(probeFn));
    act(() => result.current.probe('https://www.twitch.tv/videos/1'));
    unmount();
    expect(calls[0].signal.aborted).toBe(true);
  });
});
