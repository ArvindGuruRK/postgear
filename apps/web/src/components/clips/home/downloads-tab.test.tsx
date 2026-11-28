import { TooltipProvider } from '@postgear/ui';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { ApiError } from '@/lib/api';
import type { DownloadView } from '@/types/clips';
import { fixtureJob } from '../clips-fixtures';
import {
  DOWNLOADS_EMPTY,
  DownloadRow,
  DownloadsTab,
  preparingLine,
  shownState,
} from './downloads-tab';
import type { DownloadsState } from './use-downloads';

jest.mock('@/lib/clips-api', () => ({
  ...jest.requireActual('@/lib/clips-api'),
  saveDownloadToMedia: jest.fn(),
  saveDownloadFile: jest.fn(async () => undefined),
  deleteDownload: jest.fn(async () => undefined),
}));

const clipsApi = jest.requireMock('@/lib/clips-api') as {
  saveDownloadToMedia: jest.Mock;
  saveDownloadFile: jest.Mock;
  deleteDownload: jest.Mock;
};

beforeAll(() => stubBrowserLayout());
beforeEach(() => jest.clearAllMocks());

const NOW = new Date('2026-11-18T10:00:00.000Z');

function view(overrides: Partial<DownloadView> = {}): DownloadView {
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
    canSaveToMedia: true,
    media: null,
    createdAt: '2026-11-18T09:10:00.000Z',
    ...overrides,
  };
}

function wrap(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

function row(download: DownloadView, more: Partial<Parameters<typeof DownloadRow>[0]> = {}) {
  const handlers = { onEnded: jest.fn(), onChanged: jest.fn(), onRemoved: jest.fn() };
  wrap(
    <ul>
      <DownloadRow view={download} now={NOW} follow={false} {...handlers} {...more} />
    </ul>,
  );
  return handlers;
}

function state(overrides: Partial<DownloadsState> = {}): DownloadsState {
  return {
    rows: [],
    loading: false,
    error: null,
    now: NOW,
    refresh: jest.fn(),
    add: jest.fn(),
    replace: jest.fn(),
    remove: jest.fn(),
    ...overrides,
  };
}

describe('preparingLine and shownState', () => {
  it('says how far it is, and only words before a number', () => {
    expect(preparingLine(40.4, false)).toBe('Getting your file, 40%');
    expect(preparingLine(0, false)).toBe('Getting your file');
    expect(preparingLine(10, true)).toBe('Waiting for our turn');
    expect(preparingLine(0, true, { aboutSeconds: 60, position: 0, lowPriority: true })).toBe(
      'Waiting for our turn, about 1 minute',
    );
  });

  it('turns a ready file Expired once its time is over, by the page clock', () => {
    expect(shownState(view(), NOW)).toBe('ready');
    expect(shownState(view({ expiresAt: '2026-11-18T09:59:59.000Z' }), NOW)).toBe('expired');
    expect(shownState(view({ state: 'failed' }), NOW)).toBe('failed');
  });
});

describe('DownloadsTab', () => {
  it('shows the empty state with the sentence from the blueprint', () => {
    wrap(<DownloadsTab downloads={state()} />);
    expect(screen.getByText(DOWNLOADS_EMPTY)).toBeInTheDocument();
  });

  it('shows the error with Try Again when the list did not load', () => {
    const refresh = jest.fn();
    wrap(
      <DownloadsTab downloads={state({ error: 'Your downloads could not be loaded.', refresh })} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(refresh).toHaveBeenCalled();
  });

  it('draws one row per download', () => {
    wrap(
      <DownloadsTab
        downloads={state({ rows: [view(), view({ id: 'dl-2', label: 'Audio Only', ext: 'mp3' })] })}
      />,
    );
    expect(screen.getAllByTestId('clips-download-row')).toHaveLength(2);
  });
});

describe('DownloadRow', () => {
  it('a ready file: size, Save File, Save To Media and the expiry', async () => {
    row(view());
    expect(screen.getByText('720p, 190 MB')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save To Media' })).toBeEnabled();
    expect(screen.getByText('Expires in 23 hours')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save File' }));
    });
    expect(clipsApi.saveDownloadFile).toHaveBeenCalledWith('dl-1');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('Save File shows the API sentence in the row when the file is gone, never its JSON', async () => {
    clipsApi.saveDownloadFile.mockRejectedValueOnce(
      new ApiError('This download has expired. Prepare it again.', 410, 'download_expired'),
    );
    row(view());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save File' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This download has expired. Prepare it again.',
    );
    expect(screen.getByRole('button', { name: 'Save File' })).toBeEnabled();
  });

  it('an MP3 has Save File but no Save To Media', () => {
    row(view({ label: 'Audio Only', audioOnly: true, ext: 'mp3', canSaveToMedia: false }));
    expect(screen.getByRole('button', { name: 'Save File' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save To Media' })).not.toBeInTheDocument();
  });

  it('a file being prepared shows how far it is, and no Save File', () => {
    row(
      view({
        state: 'preparing',
        job: fixtureJob({ id: 'dl-1', kind: 'DOWNLOAD', progress: 40, videoId: null }),
        bytes: null,
        expiresAt: null,
        canSaveToMedia: false,
      }),
    );
    expect(screen.getByText('Getting your file, 40%')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save File' })).not.toBeInTheDocument();
  });

  it('a failed file shows its reason', () => {
    row(
      view({
        state: 'failed',
        job: fixtureJob({
          id: 'dl-1',
          kind: 'DOWNLOAD',
          status: 'FAILED',
          error: { code: 'format_gone', message: 'This quality is no longer offered.' },
        }),
        canSaveToMedia: false,
      }),
    );
    expect(screen.getByText('This quality is no longer offered.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save File' })).not.toBeInTheDocument();
  });

  it('an expired file says Expired and keeps only the menu', () => {
    row(view({ expiresAt: '2026-11-18T09:00:00.000Z' }));
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save File' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save To Media' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More for A Talk On Plans 2027' })).toBeEnabled();
  });

  it('Save To Media hands the new row back, and a saved file shows In Media', async () => {
    const saving = view({ canSaveToMedia: false, media: { status: 'saving', mediaId: null } });
    clipsApi.saveDownloadToMedia.mockResolvedValueOnce(saving);
    const { onChanged } = row(view());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save To Media' }));
    });
    expect(clipsApi.saveDownloadToMedia).toHaveBeenCalledWith('dl-1');
    expect(onChanged).toHaveBeenCalledWith(saving);
  });

  it('shows Saving To Media while it runs and In Media once saved', () => {
    row(view({ canSaveToMedia: false, media: { status: 'saving', mediaId: null } }));
    expect(screen.getByRole('button', { name: 'Saving To Media' })).toBeDisabled();
  });

  it('shows In Media once saved', () => {
    row(view({ canSaveToMedia: false, media: { status: 'saved', mediaId: 'media-1' } }));
    expect(screen.getByText('In Media')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save To Media/ })).not.toBeInTheDocument();
  });

  it('Delete Download asks first, then removes the row', async () => {
    const { onRemoved } = row(view());
    fireEvent.keyDown(screen.getByRole('button', { name: 'More for A Talk On Plans 2027' }), {
      key: 'Enter',
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete Download' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete Download' }));
    });
    expect(clipsApi.deleteDownload).toHaveBeenCalledWith('dl-1');
    expect(onRemoved).toHaveBeenCalledWith('dl-1');
  });
});
