import { TooltipProvider } from '@postgear/ui';
import { fireEvent, render, screen } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { FIXTURE_CARDS } from '../clips-fixtures';
import type { VideosState } from './use-videos';
import type { VideoCardActions } from './video-card';
import { VIDEOS_EMPTY, VideosTab } from './videos-tab';

jest.mock('@/lib/clips-api', () => ({}));
jest.mock('../use-clip-job', () => ({
  useClipJob: () => ({ job: null, error: null, refresh: () => undefined }),
}));

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
});

const ALL_CARDS = [
  FIXTURE_CARDS.ready,
  FIXTURE_CARDS.busy,
  FIXTURE_CARDS.waiting,
  FIXTURE_CARDS.failed,
];

function videosState(overrides: Partial<VideosState> = {}): VideosState {
  return {
    cards: ALL_CARDS,
    total: ALL_CARDS.length,
    sort: 'newest',
    setSort: jest.fn(),
    loading: false,
    loadingMore: false,
    error: null,
    hasMore: false,
    loadMore: jest.fn(),
    refresh: jest.fn(),
    refreshOne: jest.fn(async () => undefined),
    replace: jest.fn(),
    remove: jest.fn(),
    ...overrides,
  };
}

const ACTIONS: VideoCardActions = {
  onCancel: async () => undefined,
  onRetry: async () => undefined,
  onDelete: async () => undefined,
  onSettled: () => undefined,
};

function renderTab(videos: VideosState, onCreate = jest.fn()) {
  render(
    <TooltipProvider>
      <VideosTab orgId="org-1" videos={videos} actions={ACTIONS} onCreate={onCreate} />
    </TooltipProvider>,
  );
  return { onCreate };
}

describe('VideosTab', () => {
  it('draws one card per video with the count', () => {
    renderTab(videosState());
    const cards = screen.getAllByTestId('clips-video-card');
    expect(cards.map((card) => card.getAttribute('data-status'))).toEqual([
      'READY',
      'IMPORTING',
      'IMPORTING',
      'FAILED',
    ]);
    expect(screen.getByText('4 videos')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show More' })).not.toBeInTheDocument();
  });

  it('counts from the total, singular for one', () => {
    renderTab(videosState({ cards: [FIXTURE_CARDS.ready], total: 1 }));
    expect(screen.getByText('1 video')).toBeInTheDocument();
  });

  it('counts the whole list, not just the page drawn', () => {
    renderTab(videosState({ total: 1_250, hasMore: true }));
    expect(screen.getByText('1,250 videos')).toBeInTheDocument();
  });

  it('invites the first video when there is none', () => {
    const { onCreate } = renderTab(videosState({ cards: [], total: 0 }));
    expect(screen.getByText(VIDEOS_EMPTY)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(onCreate).toHaveBeenCalled();
  });

  it('shows footprints while the first page loads', () => {
    renderTab(videosState({ cards: [], total: 0, loading: true }));
    expect(screen.queryByText(VIDEOS_EMPTY)).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('clips-video-card')).toHaveLength(0);
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('offers Try Again when the list did not load', () => {
    const refresh = jest.fn();
    renderTab(
      videosState({
        cards: [],
        total: 0,
        error: 'Your videos could not be loaded. Check your connection.',
        refresh,
      }),
    );
    expect(
      screen.getByText('Your videos could not be loaded. Check your connection.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(refresh).toHaveBeenCalled();
  });

  it('loads more and changes the sort', () => {
    const videos = videosState({ hasMore: true });
    renderTab(videos);
    fireEvent.click(screen.getByRole('button', { name: 'Show More' }));
    expect(videos.loadMore).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Oldest' }));
    expect(videos.setSort).toHaveBeenCalledWith('oldest');
  });

  it('keeps Show More off while the next page loads', () => {
    renderTab(videosState({ hasMore: true, loadingMore: true }));
    expect(screen.getByRole('button', { name: 'Loading' })).toBeDisabled();
  });
});
