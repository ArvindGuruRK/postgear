import { TooltipProvider } from '@postgear/ui';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { ApiError } from '@/lib/api';
import type { ClipJobView, ClipVideoCard } from '@/types/clips';
import { FIXTURE_CARDS, fixtureJob } from '../clips-fixtures';
import { VideoCard, type VideoCardActions } from './video-card';

jest.mock('@/lib/clips-api', () => ({ getVideo: jest.fn() }));
jest.mock('../use-clip-job', () => ({ useClipJob: jest.fn() }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/clips-recipes-api', () => ({
  listRecipes: jest.fn(async () => ({ recipes: [], own: 0, max: 50 })),
  autoEditPrice: jest.fn(() => new Promise(() => undefined)),
  startAutoEdit: jest.fn(),
}));
jest.mock('./clips-meters', () => ({ AiMinutesChip: () => null }));

const { getVideo } = jest.requireMock('@/lib/clips-api') as { getVideo: jest.Mock };
const { useClipJob } = jest.requireMock('../use-clip-job') as { useClipJob: jest.Mock };

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
});
beforeEach(() => {
  getVideo.mockReset();
  useClipJob.mockReset();
  useClipJob.mockReturnValue({ job: null, error: null, refresh: jest.fn() });
});

function actions(): jest.Mocked<VideoCardActions> {
  return {
    onCancel: jest.fn(async (_videoId: string) => undefined),
    onRetry: jest.fn(async (_videoId: string) => undefined),
    onDelete: jest.fn(async (_videoId: string) => undefined),
    onSettled: jest.fn(),
  };
}

function renderCard(card: ClipVideoCard, cardActions = actions(), follow = true) {
  const view = render(
    <TooltipProvider>
      <ul>
        <VideoCard card={card} orgId="org-1" actions={cardActions} follow={follow} />
      </ul>
    </TooltipProvider>,
  );
  return { ...view, actions: cardActions };
}

describe('VideoCard', () => {
  it('shows a ready video with Open, its facts and how long it is kept', () => {
    renderCard(FIXTURE_CARDS.ready);
    expect(screen.getByTestId('clips-video-card')).toHaveAttribute('data-status', 'READY');
    expect(screen.getByText('Twitch, 3 h 42 min, 12 clips')).toBeInTheDocument();
    expect(screen.getByText('Kept until 28 Nov')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      '/org-1/clips/video/video-ready',
    );
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(useClipJob).toHaveBeenCalledWith(null);
  });

  it('shows a busy import in words, with its percentage and time left', () => {
    renderCard(FIXTURE_CARDS.busy, actions(), false);
    expect(screen.getByText('Getting the video')).toBeInTheDocument();
    expect(screen.getByText('42%')).toBeInTheDocument();
    expect(screen.getByText('About 4 minutes left')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Kept until/)).not.toBeInTheDocument();
  });

  it('does not follow the job live with follow off', () => {
    renderCard(FIXTURE_CARDS.busy, actions(), false);
    expect(useClipJob).toHaveBeenCalledWith(null);
    expect(useClipJob).not.toHaveBeenCalledWith('job-1');
  });

  it('follows the job live, shows its newer step, and settles once when it ends', () => {
    const live: ClipJobView = fixtureJob({
      stageLabel: 'Preparing the preview',
      progress: 80,
      etaSeconds: 40,
    });
    useClipJob.mockReturnValue({ job: live, error: null, refresh: jest.fn() });
    const { actions: cardActions, rerender } = renderCard(FIXTURE_CARDS.busy);

    expect(useClipJob).toHaveBeenCalledWith('job-1');
    expect(screen.getByText('Preparing the preview')).toBeInTheDocument();
    expect(screen.getByText('Less than a minute left')).toBeInTheDocument();
    expect(cardActions.onSettled).not.toHaveBeenCalled();

    useClipJob.mockReturnValue({
      job: fixtureJob({ status: 'DONE', progress: 100 }),
      error: null,
      refresh: jest.fn(),
    });
    const again = (
      <TooltipProvider>
        <ul>
          <VideoCard card={FIXTURE_CARDS.busy} orgId="org-1" actions={cardActions} />
        </ul>
      </TooltipProvider>
    );
    rerender(again);
    rerender(again);
    expect(cardActions.onSettled).toHaveBeenCalledTimes(1);
    expect(cardActions.onSettled).toHaveBeenCalledWith('video-busy');
  });

  it('says a queued job is waiting for our turn, with no time left yet', () => {
    renderCard(FIXTURE_CARDS.waiting, actions(), false);
    expect(screen.getByText('Waiting for our turn')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.queryByText(/left$/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('clips-waiting-note')).not.toBeInTheDocument();
  });

  it('says about how long a queued import waits, and why a low priority one waits (Module 15)', () => {
    const card = {
      ...FIXTURE_CARDS.waiting,
      job: {
        ...(FIXTURE_CARDS.waiting.job as ClipJobView),
        waiting: { aboutSeconds: 300, position: 4, lowPriority: true },
      },
    };
    renderCard(card, actions(), false);
    expect(screen.getByText('Waiting for our turn, about 5 minutes')).toBeInTheDocument();
    expect(screen.getByTestId('clips-waiting-note')).toHaveTextContent(
      'Plans with a higher priority go first.',
    );
  });

  it('cancels a busy import', async () => {
    const { actions: cardActions } = renderCard(FIXTURE_CARDS.busy, actions(), false);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
    expect(cardActions.onCancel).toHaveBeenCalledWith('video-busy');
  });

  it('shows why an import failed and tries again', async () => {
    const { actions: cardActions } = renderCard(FIXTURE_CARDS.failed);
    expect(
      screen.getByText('This video is private or needs a login, so we cannot read it.'),
    ).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    });
    expect(cardActions.onRetry).toHaveBeenCalledWith('video-failed');
  });

  it("shows the API's sentence when an action is refused", async () => {
    const cardActions = actions();
    cardActions.onRetry.mockRejectedValue(new ApiError('This import is not failed any more.', 409));
    renderCard(FIXTURE_CARDS.failed, cardActions);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    });
    expect(screen.getByText('This import is not failed any more.')).toBeInTheDocument();
  });

  it('counts the clips that go with a deleted video before the red button works', async () => {
    let answer: (value: unknown) => void = () => undefined;
    getVideo.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const { actions: cardActions } = renderCard(FIXTURE_CARDS.ready);

    fireEvent.keyDown(
      screen.getByRole('button', { name: `More for ${FIXTURE_CARDS.ready.video.title}` }),
      { key: 'Enter' },
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete Video' }));

    const confirm = await screen.findByRole('button', { name: 'Delete Video' });
    expect(confirm).toBeDisabled();
    expect(getVideo).toHaveBeenCalledWith('video-ready', { signal: expect.any(AbortSignal) });

    await act(async () =>
      answer({
        ...FIXTURE_CARDS.ready,
        clips: [{ exported: false }, { exported: true }, { exported: false }],
      }),
    );
    expect(screen.getByTestId('delete-video-sentence')).toHaveTextContent(
      'Delete this video and its 2 clips that were never exported? Exported clips stay in Media.',
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete Video' }));
    });
    expect(cardActions.onDelete).toHaveBeenCalledWith('video-ready');
  });

  it('offers Download Original only on a ready uploaded video', async () => {
    const cardActions = { ...actions(), onDownloadOriginal: jest.fn(async () => undefined) };
    const uploaded: ClipVideoCard = {
      ...FIXTURE_CARDS.ready,
      video: {
        ...FIXTURE_CARDS.ready.video,
        id: 'video-upload',
        platform: 'upload',
        title: 'My Upload',
      },
    };
    renderCard(uploaded, cardActions);
    fireEvent.keyDown(screen.getByRole('button', { name: 'More for My Upload' }), { key: 'Enter' });
    const item = await screen.findByRole('menuitem', { name: 'Download Original' });
    await act(async () => {
      fireEvent.click(item);
    });
    expect(cardActions.onDownloadOriginal).toHaveBeenCalledWith('video-upload');
  });

  it('has no Download Original on a video from a link', async () => {
    renderCard(FIXTURE_CARDS.ready, { ...actions(), onDownloadOriginal: jest.fn() });
    fireEvent.keyDown(
      screen.getByRole('button', { name: `More for ${FIXTURE_CARDS.ready.video.title}` }),
      { key: 'Enter' },
    );
    await screen.findByRole('menuitem', { name: 'Delete Video' });
    expect(screen.queryByRole('menuitem', { name: 'Download Original' })).not.toBeInTheDocument();
  });

  it('offers Auto-Edit Video on a ready video and opens its dialog (Module 10)', async () => {
    renderCard(FIXTURE_CARDS.ready);
    fireEvent.keyDown(
      screen.getByRole('button', { name: `More for ${FIXTURE_CARDS.ready.video.title}` }),
      { key: 'Enter' },
    );
    const item = await screen.findByRole('menuitem', { name: 'Auto-Edit Video' });
    await act(async () => {
      fireEvent.click(item);
    });
    expect(await screen.findByTestId('clip-auto-edit')).toBeInTheDocument();
  });

  it('has no Auto-Edit Video in the playground', async () => {
    renderCard(FIXTURE_CARDS.ready, actions(), false);
    fireEvent.keyDown(
      screen.getByRole('button', { name: `More for ${FIXTURE_CARDS.ready.video.title}` }),
      { key: 'Enter' },
    );
    await screen.findByRole('menuitem', { name: 'Delete Video' });
    expect(screen.queryByRole('menuitem', { name: 'Auto-Edit Video' })).not.toBeInTheDocument();
  });
});

describe('VideoCard keeping and size (Module 19)', () => {
  const ready = FIXTURE_CARDS.ready;

  it('says "Removed in 2 days" in the warning colour, with how to keep it', () => {
    const soon = new Date(Date.now() + 2 * 86_400_000 - 60_000).toISOString();
    renderCard({ ...ready, video: { ...ready.video, expiresAt: soon } });
    const line = screen.getByTestId('clips-video-removed-soon');
    expect(line).toHaveTextContent('Removed in 2 days');
    expect(line).toHaveTextContent('Open it to keep it longer.');
  });

  it('keeps "Kept until" while the date is far', () => {
    const far = new Date(Date.now() + 20 * 86_400_000).toISOString();
    renderCard({ ...ready, video: { ...ready.video, expiresAt: far } });
    expect(screen.queryByTestId('clips-video-removed-soon')).toBeNull();
    expect(screen.getByText(/^Kept until /)).toBeInTheDocument();
  });

  it('shows the stored size only in the size view', () => {
    const sized = { ...ready, storedBytes: 1_400_000_000 };
    const { unmount } = render(
      <TooltipProvider>
        <ul>
          <VideoCard card={sized} orgId="org-1" actions={actions()} follow={false} showSize />
        </ul>
      </TooltipProvider>,
    );
    expect(screen.getByText(/1\.4 GB/)).toBeInTheDocument();
    unmount();
    renderCard(sized, actions(), false);
    expect(screen.queryByText(/1\.4 GB/)).toBeNull();
  });
});
