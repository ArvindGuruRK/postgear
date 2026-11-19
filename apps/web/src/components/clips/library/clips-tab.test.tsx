import { TooltipProvider } from '@postgear/ui';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import type { ClipCounts, ClipListItem } from '@/types/clips';
import { fixtureClipItem, fixtureClipView } from './clip-list-fixtures';
import {
  CLIPS_EMPTY,
  ClipsTab,
  listChange,
  listClipActions,
  PLATFORM_FILTERS,
  platformFilterSentence,
  readClipsView,
  STATUS_FILTERS,
  VIEW_STORAGE_KEY,
} from './clips-tab';
import { type ClipsListState, EMPTY_COUNTS } from './use-clips-list';

// Send To Composer (Module 17) opens the composer through the router.
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/org-1/clips',
}));
jest.mock('@/lib/clips-api', () => ({
  updateClip: jest.fn(),
  duplicateClip: jest.fn(),
  deleteClip: jest.fn(),
}));
const toast = jest.fn();
jest.mock('@postgear/ui', () => ({
  ...jest.requireActual('@postgear/ui'),
  toast: (input: unknown) => toast(input),
}));

const api = jest.requireMock('@/lib/clips-api') as {
  updateClip: jest.Mock;
  duplicateClip: jest.Mock;
  deleteClip: jest.Mock;
};

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
});

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  toast.mockClear();
  window.localStorage.clear();
});

const FIRST = fixtureClipItem({ id: 'clip-1', title: 'Team Talk (0:30)' });
const SECOND = fixtureClipItem({
  id: 'clip-2',
  title: 'Big Play (1:10)',
  platform: 'twitch',
  state: 'exported',
  exported: true,
  durationMs: 70_000,
  ratio: '1:1',
});

const COUNTS: ClipCounts = { all: 2, new: 0, draft: 1, exported: 1, scheduled: 0, hidden: 1234 };

function listState(overrides: Partial<ClipsListState> = {}): ClipsListState {
  return {
    clips: [FIRST, SECOND],
    counts: COUNTS,
    total: 2,
    status: 'all',
    sources: [],
    sort: 'newest',
    loading: false,
    loadingMore: false,
    error: null,
    hasMore: false,
    setStatus: jest.fn(),
    setSources: jest.fn(),
    setSort: jest.fn(),
    loadMore: jest.fn(),
    refresh: jest.fn(),
    patch: jest.fn(),
    prepend: jest.fn(),
    drop: jest.fn(),
    ...overrides,
  };
}

function renderTab(list: ClipsListState = listState()) {
  const onVideos = jest.fn();
  const view = render(
    <TooltipProvider>
      <ClipsTab orgId="seed-demo-org" list={list} onVideos={onVideos} />
    </TooltipProvider>,
  );
  return { list, onVideos, view };
}

const group = (name: string) => screen.getByRole('group', { name });

describe('the words and helpers', () => {
  it('names the platform filter in a sentence', () => {
    expect(platformFilterSentence([])).toBeNull();
    expect(platformFilterSentence(['twitch'])).toBe('Showing clips from Twitch');
    expect(platformFilterSentence(['youtube', 'kick'])).toBe('Showing clips from 2 platforms');
    expect(PLATFORM_FILTERS).toEqual(['youtube', 'twitch', 'kick', 'upload']);
  });

  it('has an empty sentence for every state filter', () => {
    expect(STATUS_FILTERS.map((one) => one.label)).toEqual([
      'All',
      'New',
      'Drafts',
      'Exported',
      'Scheduled',
      'Hidden',
    ]);
    for (const one of STATUS_FILTERS) expect(one.empty).toMatch(/^[A-Z].*\.$/);
  });

  it('reads the remembered view, and takes Grid when storage is empty, odd or blocked', () => {
    expect(readClipsView()).toBe('grid');
    window.localStorage.setItem(VIEW_STORAGE_KEY, 'list');
    expect(readClipsView()).toBe('list');
    window.localStorage.setItem(VIEW_STORAGE_KEY, 'tiles');
    expect(readClipsView()).toBe('grid');
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readClipsView()).toBe('grid');
    spy.mockRestore();
  });

  it('turns a clip answer into a row change, keeping what the row alone knows', () => {
    const answer = fixtureClipView({ title: 'Best Bit', revision: 9, state: 'hidden' });
    const change = listChange(answer);
    expect(change).toMatchObject({ title: 'Best Bit', revision: 9, state: 'hidden' });
    expect(change).not.toHaveProperty('videoTitle');
    expect(change).not.toHaveProperty('poster');
    expect(change).not.toHaveProperty('document');
  });
});

describe('listClipActions', () => {
  it('puts a changed clip in place', async () => {
    const list = listState();
    api.updateClip.mockResolvedValue(fixtureClipView({ id: 'clip-1', title: 'Best Bit' }));
    await listClipActions(list).rename(FIRST, 'Best Bit');
    expect(list.patch).toHaveBeenCalledWith(
      'clip-1',
      expect.objectContaining({ title: 'Best Bit' }),
    );
  });

  it('adds a copy at the top, carrying the row it was copied from', async () => {
    const list = listState();
    const copy = fixtureClipView({
      id: 'clip-9',
      title: 'Team Talk (0:30) (Copy)',
      createdAt: '2026-11-18T12:00:00.000Z',
    });
    api.duplicateClip.mockResolvedValue(copy);
    await listClipActions(list).duplicate(FIRST);
    const row = (list.prepend as jest.Mock).mock.calls[0][0] as ClipListItem;
    expect(row).toMatchObject({
      id: 'clip-9',
      title: 'Team Talk (0:30) (Copy)',
      videoTitle: FIRST.videoTitle,
      platform: FIRST.platform,
      createdAt: '2026-11-18T12:00:00.000Z',
    });
    expect(list.refresh).not.toHaveBeenCalled();
  });

  it('reads the list again when the copied row is no longer on it', async () => {
    const list = listState({ clips: [SECOND] });
    api.duplicateClip.mockResolvedValue(fixtureClipView({ id: 'clip-9' }));
    await listClipActions(list).duplicate(FIRST);
    expect(list.prepend).not.toHaveBeenCalled();
    expect(list.refresh).toHaveBeenCalledTimes(1);
  });

  it('takes a deleted clip off', async () => {
    const list = listState();
    api.deleteClip.mockResolvedValue({ message: 'Clip deleted.' });
    await listClipActions(list).remove(SECOND);
    expect(list.drop).toHaveBeenCalledWith('clip-2');
  });
});

describe('ClipsTab', () => {
  it('sends a workspace with no clips at all to its videos', () => {
    const { onVideos } = renderTab(listState({ clips: [], counts: EMPTY_COUNTS, total: 0 }));
    expect(screen.getByText(CLIPS_EMPTY)).toBeVisible();
    expect(screen.queryByRole('group', { name: 'Clip State' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Go To Videos' }));
    expect(onVideos).toHaveBeenCalledTimes(1);
  });

  it('keeps the filters when a platform filter leaves nothing, and says so for the state', () => {
    renderTab(
      listState({ clips: [], counts: EMPTY_COUNTS, sources: ['kick'], status: 'exported' }),
    );
    expect(screen.queryByText(CLIPS_EMPTY)).toBeNull();
    expect(screen.getByText('Nothing exported yet.')).toBeVisible();
    expect(screen.getByText('Showing clips from Kick')).toBeVisible();
  });

  it('shows the state filter with its counts, and changes it', () => {
    const { list } = renderTab();
    const states = within(group('Clip State')).getAllByRole('button');
    expect(states.map((one) => one.textContent)).toEqual([
      'All 2',
      'New 0',
      'Drafts 1',
      'Exported 1',
      'Scheduled 0',
      'Hidden 1,234',
    ]);
    expect(states[0]).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(states[2]);
    expect(list.setStatus).toHaveBeenCalledWith('draft');
  });

  it('sorts Newest or Oldest', () => {
    const { list } = renderTab();
    const sort = group('Sort Clips');
    expect(within(sort).getByRole('button', { name: 'Newest' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(within(sort).getByRole('button', { name: 'Oldest' }));
    expect(list.setSort).toHaveBeenCalledWith('oldest');
  });

  it('shows the clips as cards, then as a table, and remembers the choice', () => {
    renderTab();
    expect(screen.getByRole('list', { name: 'Clips' })).toBeInTheDocument();
    expect(screen.getAllByTestId('clip-card')).toHaveLength(2);
    expect(screen.queryByRole('table')).toBeNull();

    fireEvent.click(within(group('View')).getByRole('button', { name: 'List' }));
    expect(screen.queryAllByTestId('clip-card')).toHaveLength(0);
    const rows = screen.getAllByTestId('clip-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getByText('Twitch')).toBeInTheDocument();
    expect(within(rows[1]).getByText('1:10')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Exported')).toBeInTheDocument();
    expect(window.localStorage.getItem(VIEW_STORAGE_KEY)).toBe('list');
  });

  it('opens on the view this browser chose last time', async () => {
    window.localStorage.setItem(VIEW_STORAGE_KEY, 'list');
    renderTab();
    await waitFor(() => expect(screen.getAllByTestId('clip-row')).toHaveLength(2));
    expect(within(group('View')).getByRole('button', { name: 'List' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('filters by platform from a menu of ticks, and Clear lets it go', async () => {
    const { list } = renderTab(listState({ sources: ['twitch'] }));
    expect(screen.getByText('Showing clips from Twitch')).toBeVisible();
    const trigger = screen.getByRole('button', { name: /^Platform \(1\)/ });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const twitch = await screen.findByRole('menuitemcheckbox', { name: 'Twitch' });
    expect(twitch).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'YouTube' }));
    expect(list.setSources).toHaveBeenLastCalledWith(['twitch', 'youtube']);
    fireEvent.click(twitch);
    expect(list.setSources).toHaveBeenLastCalledWith([]);
    // Ticking keeps the menu open for the next one.
    expect(screen.getByRole('menuitemcheckbox', { name: 'Kick' })).toBeInTheDocument();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(list.setSources).toHaveBeenLastCalledWith([]);
  });

  it('shows no platform sentence or Clear while no platform is chosen', () => {
    renderTab();
    expect(screen.getByRole('button', { name: /^Platform$/ })).toBeInTheDocument();
    expect(screen.queryByText(/^Showing clips from/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  });

  it('shows placeholders while the first page loads, and keeps rows while a refresh runs', () => {
    const { view } = renderTab(listState({ clips: [], loading: true, counts: COUNTS }));
    expect(screen.queryAllByTestId('clip-card')).toHaveLength(0);
    expect(view.container.querySelector('ul[aria-hidden="true"]')).not.toBeNull();

    view.rerender(
      <TooltipProvider>
        <ClipsTab orgId="seed-demo-org" list={listState({ loading: true })} onVideos={jest.fn()} />
      </TooltipProvider>,
    );
    expect(screen.getAllByTestId('clip-card')).toHaveLength(2);
    expect(screen.getByRole('list', { name: 'Clips' })).toHaveAttribute('aria-busy', 'true');
  });

  it('says what went wrong with Try Again when the first page fails', () => {
    const message = 'Your clips could not be loaded. Check your connection.';
    const { list } = renderTab(listState({ clips: [], error: message }));
    expect(screen.getByText(message)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(list.refresh).toHaveBeenCalledTimes(1);
  });

  it('says why a state filter is empty', () => {
    renderTab(listState({ clips: [], status: 'scheduled' }));
    expect(screen.getByText('No clips are scheduled.')).toBeVisible();
  });

  it('pages with Show More, and says Loading while it runs', () => {
    const { list, view } = renderTab(listState({ hasMore: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Show More' }));
    expect(list.loadMore).toHaveBeenCalledTimes(1);
    view.rerender(
      <TooltipProvider>
        <ClipsTab
          orgId="seed-demo-org"
          list={listState({ hasMore: true, loadingMore: true })}
          onVideos={jest.fn()}
        />
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: 'Loading' })).toBeDisabled();
  });

  it('deletes a clip from its card after the red confirm', async () => {
    const { list } = renderTab();
    api.deleteClip.mockResolvedValue({ message: 'Clip deleted.' });
    fireEvent.keyDown(screen.getByRole('button', { name: `More for ${SECOND.title}` }), {
      key: 'Enter',
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete Clip' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete Clip' });
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Delete Clip' }));
    });
    expect(api.deleteClip).toHaveBeenCalledWith('clip-2');
    expect(list.drop).toHaveBeenCalledWith('clip-2');
    expect(toast).toHaveBeenCalledWith({ title: 'Clip deleted.' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('hides and shows a clip from the table rows too', async () => {
    window.localStorage.setItem(VIEW_STORAGE_KEY, 'list');
    const hidden = fixtureClipItem({ id: 'clip-3', title: 'Old Bit', state: 'hidden' });
    const { list } = renderTab(listState({ clips: [hidden], status: 'hidden' }));
    await waitFor(() => expect(screen.getAllByTestId('clip-row')).toHaveLength(1));
    api.updateClip.mockResolvedValue(fixtureClipView({ id: 'clip-3', state: 'draft' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'More for Old Bit' }), { key: 'Enter' });
    await act(async () => {
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Unhide' }));
    });
    expect(api.updateClip).toHaveBeenCalledWith('clip-3', 3, { status: 'DRAFT' });
    expect(list.patch).toHaveBeenCalledWith('clip-3', expect.objectContaining({ state: 'draft' }));
  });
});
