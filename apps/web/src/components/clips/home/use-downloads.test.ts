import { act, renderHook } from '@testing-library/react';
import type { DownloadView } from '@/types/clips';
import { fixtureJob } from '../clips-fixtures';
import { SAVING_POLL_LIMIT_MS, SAVING_POLL_MS, useDownloads } from './use-downloads';

jest.mock('@/lib/clips-api', () => ({ listDownloads: jest.fn() }));

const { listDownloads } = jest.requireMock('@/lib/clips-api') as { listDownloads: jest.Mock };

function view(media: DownloadView['media']): DownloadView {
  return {
    id: 'dl-1',
    title: 'A Talk On Plans 2027',
    label: '720p',
    audioOnly: false,
    ext: 'mp4',
    state: 'ready',
    job: fixtureJob({ id: 'dl-1', kind: 'DOWNLOAD', status: 'DONE', progress: 100, videoId: null }),
    bytes: 190_000_000,
    expiresAt: '2026-11-19T09:10:00.000Z',
    canSaveToMedia: media === null,
    media,
    createdAt: '2026-11-18T09:10:00.000Z',
  };
}

/** Lets the list's answer land. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function wait(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await settle();
}

beforeEach(() => {
  jest.useFakeTimers();
  listDownloads.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useDownloads', () => {
  it('asks again every 3 seconds while a save runs, then stops after five minutes', async () => {
    listDownloads.mockResolvedValue([view({ status: 'saving', mediaId: null })]);
    renderHook(() => useDownloads(true));
    await settle();
    expect(listDownloads).toHaveBeenCalledTimes(1);

    await wait(SAVING_POLL_MS);
    expect(listDownloads).toHaveBeenCalledTimes(2);

    await wait(SAVING_POLL_LIMIT_MS);
    const asked = listDownloads.mock.calls.length;
    // A save that never answers does not keep the page asking.
    await wait(20 * SAVING_POLL_MS);
    expect(listDownloads).toHaveBeenCalledTimes(asked);
  });

  it('does not ask again while nothing is saving', async () => {
    listDownloads.mockResolvedValue([view(null)]);
    renderHook(() => useDownloads(true));
    await settle();
    await wait(20 * SAVING_POLL_MS);
    expect(listDownloads).toHaveBeenCalledTimes(1);
  });
});
