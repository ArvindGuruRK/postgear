import { TooltipProvider } from '@postgear/ui';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { ApiError } from '@/lib/api';
import type { ClipCounts, ClipListItem } from '@/types/clips';
import { fixtureClipItem } from './clip-list-fixtures';
import { ClipsTab, writeClipsView } from './clips-tab';
import type { ClipsListState } from './use-clips-list';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/org-1/clips',
}));
jest.mock('@/lib/clips-api', () => ({
  updateClip: jest.fn(),
  duplicateClip: jest.fn(),
  deleteClip: jest.fn(),
}));
jest.mock('@/lib/clips-bulk-api', () => ({
  ...jest.requireActual('@/lib/clips-bulk-api'),
  bulkSetClipStatus: jest.fn(),
  bulkDeleteClips: jest.fn(),
  createMontage: jest.fn(),
}));
const toast = jest.fn();
jest.mock('@postgear/ui', () => ({
  ...jest.requireActual('@postgear/ui'),
  toast: (input: unknown) => toast(input),
}));

const bulk = jest.requireMock('@/lib/clips-bulk-api') as {
  bulkSetClipStatus: jest.Mock;
  bulkDeleteClips: jest.Mock;
  createMontage: jest.Mock;
};

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
});

beforeEach(() => {
  bulk.bulkSetClipStatus.mockReset();
  bulk.bulkDeleteClips.mockReset();
  bulk.createMontage.mockReset();
  push.mockReset();
  toast.mockClear();
  window.localStorage.clear();
});

const CLIPS: ClipListItem[] = [
  fixtureClipItem({ id: 'clip-1', title: 'Team Talk', durationMs: 30_000 }),
  fixtureClipItem({ id: 'clip-2', title: 'Big Play', durationMs: 70_000, ratio: '1:1' }),
  fixtureClipItem({ id: 'clip-3', title: 'The Save', durationMs: 20_000 }),
  fixtureClipItem({ id: 'clip-4', title: 'Last Word', durationMs: 10_000, origin: 'MONTAGE' }),
];
const COUNTS: ClipCounts = { all: 4, new: 0, draft: 4, exported: 0, scheduled: 0, hidden: 0 };

function listState(overrides: Partial<ClipsListState> = {}): ClipsListState {
  return {
    clips: CLIPS,
    counts: COUNTS,
    total: 4,
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

function renderTab(list = listState(), onExportAll = jest.fn()) {
  const view = render(
    <TooltipProvider>
      <ClipsTab orgId="seed-demo-org" list={list} onVideos={jest.fn()} onExportAll={onExportAll} />
    </TooltipProvider>,
  );
  return { view, list, onExportAll };
}

const tick = (title: string) => screen.getByRole('checkbox', { name: `Select ${title}` });
const bar = () => screen.queryByTestId('clips-bulk-bar');

describe('ticking clips on the grid', () => {
  it('shows a tick box per card, and the bar once one is ticked', () => {
    renderTab();
    expect(screen.getAllByTestId('clip-tick')).toHaveLength(4);
    expect(bar()).toBeNull();
    fireEvent.click(tick('Team Talk'));
    expect(tick('Team Talk')).toHaveAttribute('aria-checked', 'true');
    expect(within(bar() as HTMLElement).getByText('1 Selected')).toBeInTheDocument();
  });

  it('hides the tick boxes until hovered, then keeps them all once one is ticked', () => {
    renderTab();
    expect(tick('Big Play').className).toContain('opacity-0');
    fireEvent.click(tick('Team Talk'));
    expect(tick('Big Play').className).not.toContain('opacity-0');
  });

  it('ticks a range on a Shift-click', () => {
    renderTab();
    fireEvent.click(tick('Team Talk'));
    fireEvent.click(tick('The Save'), { shiftKey: true });
    expect(tick('Big Play')).toHaveAttribute('aria-checked', 'true');
    expect(tick('Last Word')).toHaveAttribute('aria-checked', 'false');
    expect(within(bar() as HTMLElement).getByText('3 Selected')).toBeInTheDocument();
  });

  it('clears the ticks on a filter change', () => {
    const { view } = renderTab();
    fireEvent.click(tick('Team Talk'));
    expect(bar()).not.toBeNull();
    view.rerender(
      <TooltipProvider>
        <ClipsTab
          orgId="seed-demo-org"
          list={listState({ status: 'draft' })}
          onVideos={jest.fn()}
          onExportAll={jest.fn()}
        />
      </TooltipProvider>,
    );
    expect(bar()).toBeNull();
  });

  it('clears the ticks from the bar', () => {
    renderTab();
    fireEvent.click(tick('Team Talk'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(bar()).toBeNull();
  });

  it('shows the Montage badge on a montage', () => {
    renderTab();
    expect(screen.getAllByTestId('clip-montage-badge')).toHaveLength(1);
  });
});

describe('ticking clips on the list', () => {
  it('ticks rows, and every row from the header', () => {
    writeClipsView('list');
    renderTab();
    expect(screen.getAllByTestId('clip-montage-badge')).toHaveLength(1);
    fireEvent.click(tick('Big Play'));
    expect(within(bar() as HTMLElement).getByText('1 Selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select every clip on the page' }));
    expect(within(bar() as HTMLElement).getByText('4 Selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select every clip on the page' }));
    expect(bar()).toBeNull();
  });
});

describe('the bar', () => {
  it('enables Create Montage from two clips', () => {
    renderTab();
    fireEvent.click(tick('Team Talk'));
    expect(screen.getByTestId('clips-bulk-montage')).toBeDisabled();
    expect(screen.getByTestId('clips-bulk-export')).toBeEnabled();
    fireEvent.click(tick('Big Play'));
    expect(screen.getByTestId('clips-bulk-montage')).toBeEnabled();
  });

  it('hands the ticked clips to Export All', () => {
    const { onExportAll } = renderTab();
    fireEvent.click(tick('Team Talk'));
    fireEvent.click(tick('The Save'));
    fireEvent.click(screen.getByTestId('clips-bulk-export'));
    expect(onExportAll).toHaveBeenCalledWith([CLIPS[0], CLIPS[2]]);
  });

  it('hides every ticked clip in one call', async () => {
    bulk.bulkSetClipStatus.mockResolvedValue({ updated: 2 });
    const { list } = renderTab();
    fireEvent.click(tick('Team Talk'));
    fireEvent.click(tick('Big Play'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('clips-bulk-hide'));
    });
    expect(bulk.bulkSetClipStatus).toHaveBeenCalledWith({
      clipIds: ['clip-1', 'clip-2'],
      status: 'HIDDEN',
    });
    expect(list.refresh).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({ title: '2 clips hidden.' });
    expect(bar()).toBeNull();
  });

  it('offers Unhide when every ticked clip is hidden', async () => {
    bulk.bulkSetClipStatus.mockResolvedValue({ updated: 1 });
    renderTab(
      listState({
        status: 'hidden',
        clips: [
          fixtureClipItem({ id: 'clip-9', title: 'Gone', state: 'hidden', status: 'HIDDEN' }),
        ],
      }),
    );
    fireEvent.click(tick('Gone'));
    expect(screen.getByTestId('clips-bulk-hide')).toHaveTextContent('Unhide');
    await act(async () => {
      fireEvent.click(screen.getByTestId('clips-bulk-hide'));
    });
    expect(bulk.bulkSetClipStatus).toHaveBeenCalledWith({ clipIds: ['clip-9'], status: 'DRAFT' });
  });

  it('asks before Delete, naming the count, then takes the clips off', async () => {
    bulk.bulkDeleteClips.mockResolvedValue({ deleted: 2 });
    const { list } = renderTab();
    fireEvent.click(tick('Team Talk'));
    fireEvent.click(tick('The Save'));
    fireEvent.click(screen.getByTestId('clips-bulk-delete'));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Delete 2 Clips?')).toBeInTheDocument();
    expect(bulk.bulkDeleteClips).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete 2 Clips' }));
    });
    expect(bulk.bulkDeleteClips).toHaveBeenCalledWith(['clip-1', 'clip-3']);
    expect(list.drop).toHaveBeenCalledWith('clip-1');
    expect(list.drop).toHaveBeenCalledWith('clip-3');
    expect(toast).toHaveBeenCalledWith({ title: '2 clips deleted.' });
  });

  it('keeps the ticks and says why when the server refuses', async () => {
    bulk.bulkDeleteClips.mockRejectedValue(new ApiError('Clip not found.', 404, 'clip_not_found'));
    const { list } = renderTab();
    fireEvent.click(tick('Team Talk'));
    fireEvent.click(screen.getByTestId('clips-bulk-delete'));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Delete 1 Clip?')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete 1 Clip' }));
    });
    expect(list.drop).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({ title: 'Clip not found.', variant: 'danger' });
    await waitFor(() => expect(bar()).not.toBeNull());
  });

  it('opens Create Montage on the ticked clips', async () => {
    renderTab();
    fireEvent.click(tick('Team Talk'));
    fireEvent.click(tick('The Save'));
    fireEvent.click(screen.getByTestId('clips-bulk-montage'));
    const dialog = await screen.findByTestId('clips-montage-dialog');
    expect(within(dialog).getAllByTestId('clips-montage-row')).toHaveLength(2);
  });
});
