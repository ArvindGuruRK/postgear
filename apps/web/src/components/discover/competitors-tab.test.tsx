/**
 * The Competitors tab (Module 07, stories DC-7.1 to DC-7.3): the empty state
 * with Add Competitor, one group per competitor with its rows, a resting
 * source's sentence in its own group only, a failed group that leaves the
 * others alone, the limit of 20, Edit for everyone and Remove for admins only
 * (asked first, in red), and Refresh asking for everything again.
 */
import '@testing-library/jest-dom';
import { TooltipProvider } from '@postgear/ui';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '@/lib/api';
import {
  createCompetitor,
  getCompetitorItems,
  getCompetitors,
  removeCompetitor,
  updateCompetitor,
} from '@/lib/discover-api';
import type {
  Competitor,
  CompetitorItemsResponse,
  CompetitorsResponse,
  DiscoverItem,
} from '@/types/discover';
import { stubBrowserLayout } from '../workflows/fields/test-dom';
import { ITEMS_FAILED, REMOVE_FAILED, STILL_READING } from './competitor-model';
import {
  COMPETITORS_LOAD_FAILED,
  CompetitorsTab,
  type CompetitorsTabProps,
  NO_COMPETITORS_HINT,
  NO_COMPETITORS_TITLE,
  PENDING_RETRY_MS,
  PENDING_TRIES,
} from './competitors-tab';

jest.mock('@/lib/discover-api', () => ({
  getCompetitors: jest.fn(),
  getCompetitorItems: jest.fn(),
  createCompetitor: jest.fn(),
  updateCompetitor: jest.fn(),
  removeCompetitor: jest.fn(),
  findCompetitorFeeds: jest.fn(),
}));

const mockedList = getCompetitors as jest.MockedFunction<typeof getCompetitors>;
const mockedItems = getCompetitorItems as jest.MockedFunction<typeof getCompetitorItems>;
const mockedCreate = createCompetitor as jest.MockedFunction<typeof createCompetitor>;
const mockedUpdate = updateCompetitor as jest.MockedFunction<typeof updateCompetitor>;
const mockedRemove = removeCompetitor as jest.MockedFunction<typeof removeCompetitor>;

beforeAll(stubBrowserLayout);

const NOW = new Date('2026-11-10T12:00:00Z');

function competitor(id: string, name: string, patch: Partial<Competitor> = {}): Competitor {
  return {
    id,
    name,
    websiteUrl: `https://${id}.example/`,
    feedUrls: [`https://${id}.example/feed.xml`],
    youtubeChannelId: null,
    blueskyHandle: null,
    mastodonAcct: null,
    newsQuery: null,
    lastCheckedAt: null,
    lastError: null,
    createdAt: '2026-11-10T08:00:00.000Z',
    updatedAt: '2026-11-10T08:00:00.000Z',
    ...patch,
  };
}

const ACME = competitor('acme', 'Acme Analytics', { youtubeChannelId: 'UCacmeSampleChannel00000' });
const BOLT = competitor('bolt', 'Bolt Metrics');

function row(
  id: string,
  title: string,
  source: DiscoverItem['source']['id'] = 'rss',
): DiscoverItem {
  return {
    id,
    kind: 'competitor',
    source: { id: source, name: 'A Source' },
    title,
    url: `https://rows.example/${id}`,
    publishedAt: '2026-11-09T09:00:00Z',
    brief: `They published: '${title}'. Write our own take.`,
  };
}

function items(patch: Partial<CompetitorItemsResponse> = {}): CompetitorItemsResponse {
  return {
    items: [],
    unavailable: [],
    notes: [],
    fetchedAt: '2026-11-10T11:50:00.000Z',
    stale: false,
    pending: false,
    ...patch,
  };
}

function listOf(...competitors: Competitor[]): CompetitorsResponse {
  return { competitors, limit: 20 };
}

function renderTab(props: Partial<CompetitorsTabProps> = {}) {
  const all: CompetitorsTabProps = {
    orgId: 'org-a',
    isAdmin: false,
    now: NOW,
    refreshKey: 0,
    ...props,
  };
  const view = render(
    <TooltipProvider>
      <CompetitorsTab {...all} />
    </TooltipProvider>,
  );
  return {
    ...view,
    again: (next: Partial<CompetitorsTabProps>) =>
      view.rerender(
        <TooltipProvider>
          <CompetitorsTab {...all} {...next} />
        </TooltipProvider>,
      ),
  };
}

function group(name: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: `Latest From ${name}` });
  return heading.closest('[data-testid="discover-competitor-group"]') as HTMLElement;
}

function openMenu(name: string) {
  fireEvent.keyDown(screen.getByRole('button', { name: `More actions for ${name}` }), {
    key: 'Enter',
  });
}

beforeEach(() => {
  mockedList.mockReset();
  mockedItems.mockReset();
  mockedCreate.mockReset();
  mockedUpdate.mockReset();
  mockedRemove.mockReset();
  mockedItems.mockResolvedValue(items());
});

describe('CompetitorsTab', () => {
  it('shows its footprint while the list loads', () => {
    mockedList.mockReturnValue(new Promise(() => undefined));
    renderTab();

    expect(screen.getByRole('status', { name: 'Loading competitors' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });

  it('says there are none yet, with Add Competitor', async () => {
    mockedList.mockResolvedValue(listOf());
    renderTab();

    expect(await screen.findByText(NO_COMPETITORS_TITLE)).toBeInTheDocument();
    expect(screen.getByText(NO_COMPETITORS_HINT)).toBeInTheDocument();
    expect(mockedItems).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Add Competitor' }));
    expect(await screen.findByRole('heading', { name: 'Add Competitor' })).toBeInTheDocument();
  });

  it('shows a new competitor as a group once it is saved', async () => {
    mockedList.mockResolvedValue(listOf());
    mockedCreate.mockResolvedValue(ACME);
    renderTab();

    fireEvent.click(await screen.findByRole('button', { name: 'Add Competitor' }));
    fireEvent.change(await screen.findByLabelText(/^Name/), {
      target: { value: 'Acme Analytics' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByRole('heading', { name: 'Latest From Acme Analytics' }),
    ).toBeInTheDocument();
    expect(mockedItems).toHaveBeenCalledWith('acme');
    expect(screen.queryByText(NO_COMPETITORS_TITLE)).not.toBeInTheDocument();
  });

  it('could not load: says so and tries again', async () => {
    mockedList.mockRejectedValueOnce(new ApiError('Failed to fetch', 0));
    mockedList.mockResolvedValueOnce(listOf(ACME));
    renderTab();

    expect(await screen.findByText(COMPETITORS_LOAD_FAILED)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));

    expect(
      await screen.findByRole('heading', { name: 'Latest From Acme Analytics' }),
    ).toBeInTheDocument();
  });

  it('draws one group per competitor, each with its own rows and where they come from', async () => {
    mockedList.mockResolvedValue(listOf(ACME, BOLT));
    mockedItems.mockImplementation(async (id) =>
      id === 'acme'
        ? items({ items: [row('a1', 'Five ways to cut churn'), row('a2', 'A video', 'youtube')] })
        : items({ items: [row('b1', 'Bolt ships dashboards')] }),
    );
    renderTab();

    await screen.findByText('Five ways to cut churn');
    const acme = group('Acme Analytics');
    const bolt = group('Bolt Metrics');

    expect(within(acme).getAllByTestId('discover-competitor-row')).toHaveLength(2);
    expect(
      within(acme).getByText('From their feeds, YouTube and Google News.'),
    ).toBeInTheDocument();
    expect(await within(bolt).findByText('Bolt ships dashboards')).toBeInTheDocument();
    expect(within(bolt).getByText('From their feeds and Google News.')).toBeInTheDocument();
    expect(within(bolt).queryByText('Five ways to cut churn')).not.toBeInTheDocument();
    expect(mockedItems).toHaveBeenCalledWith('acme');
    expect(mockedItems).toHaveBeenCalledWith('bolt');
    expect(screen.getByTestId('competitor-count')).toHaveTextContent('2 of 20');
  });

  it("shows a resting source's sentence in its own group only, with the rows it kept", async () => {
    const note = 'YouTube could not be reached. Showing what we had from 2 hours ago.';
    mockedList.mockResolvedValue(listOf(ACME, BOLT));
    mockedItems.mockImplementation(async (id) =>
      id === 'acme'
        ? items({
            items: [row('a1', 'An older video', 'youtube')],
            unavailable: ['youtube'],
            notes: [note],
            stale: true,
          })
        : items({ items: [row('b1', 'Bolt ships dashboards')] }),
    );
    renderTab();

    await screen.findByText('An older video');
    const acme = group('Acme Analytics');
    const bolt = group('Bolt Metrics');

    const shown = within(acme).getByTestId('competitor-note');
    expect(shown).toHaveTextContent(note);
    expect(shown).toHaveAttribute('data-stale', 'true');
    await within(bolt).findByText('Bolt ships dashboards');
    expect(within(bolt).queryByTestId('competitor-note')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows every sentence when more than one kind is resting, and no "nothing new" beside them', async () => {
    mockedList.mockResolvedValue(listOf(ACME));
    mockedItems.mockResolvedValue(
      items({
        unavailable: ['blog', 'youtube'],
        notes: ['Blog could not be read.', 'YouTube could not be reached.'],
      }),
    );
    renderTab();

    await waitFor(() => expect(screen.getAllByTestId('competitor-note')).toHaveLength(2));
    expect(screen.getByText('Blog could not be read.')).toBeInTheDocument();
    expect(screen.queryByTestId('competitor-nothing-new')).not.toBeInTheDocument();
  });

  it('says nothing is new when a competitor has no rows and no trouble', async () => {
    mockedList.mockResolvedValue(listOf(ACME));
    renderTab();

    expect(await screen.findByTestId('competitor-nothing-new')).toHaveTextContent(
      'Nothing new from Acme Analytics in the last 30 days.',
    );
  });

  it('keeps a failed group to itself and lets it try again', async () => {
    mockedList.mockResolvedValue(listOf(ACME, BOLT));
    let acmeAsked = 0;
    mockedItems.mockImplementation(async (id) => {
      if (id === 'bolt') return items({ items: [row('b1', 'Bolt ships dashboards')] });
      acmeAsked += 1;
      if (acmeAsked === 1) throw new ApiError('Failed to fetch', 0);
      return items({ items: [row('a1', 'Five ways to cut churn')] });
    });
    renderTab();

    await screen.findByText('Bolt ships dashboards');
    const acme = group('Acme Analytics');
    const failed = await within(acme).findByTestId('competitor-error');
    expect(failed).toHaveTextContent(ITEMS_FAILED);
    expect(within(group('Bolt Metrics')).queryByTestId('competitor-error')).not.toBeInTheDocument();

    fireEvent.click(within(failed).getByRole('button', { name: 'Try Again' }));

    expect(await within(acme).findByText('Five ways to cut churn')).toBeInTheDocument();
    expect(within(acme).queryByTestId('competitor-error')).not.toBeInTheDocument();
  });

  it("shows the API's own sentence when a group is refused", async () => {
    mockedList.mockResolvedValue(listOf(ACME));
    mockedItems.mockRejectedValue(new ApiError('Competitor not found.', 404));
    renderTab();

    expect(await screen.findByTestId('competitor-error')).toHaveTextContent(
      'Competitor not found.',
    );
  });

  it('hands Create Post the row', async () => {
    const onCreatePost = jest.fn();
    const churn = row('a1', 'Five ways to cut churn');
    mockedList.mockResolvedValue(listOf(ACME));
    mockedItems.mockResolvedValue(items({ items: [churn] }));
    renderTab({ onCreatePost });

    fireEvent.click(await screen.findByRole('button', { name: /^Create Post( for |$)/ }));

    expect(onCreatePost).toHaveBeenCalledWith(churn);
  });

  it('asks for the list and every group again on Refresh, keeping the rows meanwhile', async () => {
    mockedList.mockResolvedValue(listOf(ACME));
    mockedItems.mockResolvedValueOnce(items({ items: [row('a1', 'Five ways to cut churn')] }));
    const view = renderTab();

    await screen.findByText('Five ways to cut churn');
    expect(mockedList).toHaveBeenCalledTimes(1);
    expect(mockedItems).toHaveBeenCalledTimes(1);

    let land!: (answer: CompetitorItemsResponse) => void;
    mockedItems.mockReturnValueOnce(
      new Promise<CompetitorItemsResponse>((resolve) => {
        land = resolve;
      }),
    );
    view.again({ refreshKey: 1 });

    await waitFor(() => expect(mockedItems).toHaveBeenCalledTimes(2));
    expect(mockedList).toHaveBeenCalledTimes(2);
    // The old rows stay until the new answer lands.
    expect(screen.getByText('Five ways to cut churn')).toBeInTheDocument();

    await act(async () => {
      land(items({ items: [row('a9', 'A newer post')] }));
    });
    expect(screen.getByText('A newer post')).toBeInTheDocument();
    expect(screen.queryByText('Five ways to cut churn')).not.toBeInTheDocument();
  });

  it('offers Add Competitor until the limit, then explains why not', async () => {
    const twenty = Array.from({ length: 20 }, (_, index) =>
      competitor(`c${index}`, `Competitor ${index}`),
    );
    mockedList.mockResolvedValue(listOf(...twenty));
    renderTab();

    const add = await screen.findByRole('button', { name: 'Add Competitor' });
    expect(add).toBeDisabled();
    expect(screen.getByTestId('competitor-count')).toHaveTextContent('20 of 20');

    await act(async () => {
      fireEvent.focus(add.parentElement as HTMLElement);
    });
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'You can follow up to 20 competitors.',
    );
  });

  it('keeps Add Competitor open below the limit', async () => {
    mockedList.mockResolvedValue(listOf(ACME));
    renderTab();

    expect(await screen.findByRole('button', { name: 'Add Competitor' })).toBeEnabled();
  });
});

describe('CompetitorsTab, the group menu', () => {
  it('offers a member Edit and no Remove', async () => {
    mockedList.mockResolvedValue(listOf(ACME));
    renderTab({ isAdmin: false });

    await screen.findByRole('heading', { name: 'Latest From Acme Analytics' });
    openMenu('Acme Analytics');

    expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('opens Edit on the saved values and reloads the group after the save', async () => {
    const renamed = { ...ACME, name: 'Acme', updatedAt: '2026-11-10T12:30:00.000Z' };
    mockedList.mockResolvedValue(listOf(ACME));
    mockedUpdate.mockResolvedValue(renamed);
    renderTab();

    await screen.findByRole('heading', { name: 'Latest From Acme Analytics' });
    await waitFor(() => expect(mockedItems).toHaveBeenCalledTimes(1));
    openMenu('Acme Analytics');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));

    expect(await screen.findByRole('heading', { name: 'Edit Competitor' })).toBeInTheDocument();
    const name = screen.getByLabelText(/^Name/);
    expect(name).toHaveValue('Acme Analytics');
    fireEvent.change(name, { target: { value: 'Acme' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('heading', { name: 'Latest From Acme' })).toBeInTheDocument();
    await waitFor(() => expect(mockedItems).toHaveBeenCalledTimes(2));
    expect(mockedUpdate).toHaveBeenCalledWith('acme', expect.objectContaining({ name: 'Acme' }));
  });

  it('asks an admin before removing, in red, and removes on yes', async () => {
    mockedList.mockResolvedValue(listOf(ACME, BOLT));
    mockedRemove.mockResolvedValue(undefined);
    renderTab({ isAdmin: true });

    await screen.findByRole('heading', { name: 'Latest From Acme Analytics' });
    openMenu('Acme Analytics');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }));

    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByRole('heading', { name: 'Remove Competitor' })).toBeInTheDocument();
    expect(
      within(confirm).getByText('Remove Acme Analytics? Their items disappear from Discover.'),
    ).toBeInTheDocument();
    const remove = within(confirm).getByRole('button', { name: 'Remove' });
    expect(remove.className).toContain('bg-actionDanger');
    expect(mockedRemove).not.toHaveBeenCalled();

    fireEvent.click(remove);

    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Latest From Acme Analytics' }),
      ).not.toBeInTheDocument(),
    );
    expect(mockedRemove).toHaveBeenCalledWith('acme');
    expect(screen.getByRole('heading', { name: 'Latest From Bolt Metrics' })).toBeInTheDocument();
    expect(screen.getByTestId('competitor-count')).toHaveTextContent('1 of 20');
  });

  it('removes nothing on Cancel', async () => {
    mockedList.mockResolvedValue(listOf(ACME));
    renderTab({ isAdmin: true });

    await screen.findByRole('heading', { name: 'Latest From Acme Analytics' });
    openMenu('Acme Analytics');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }),
    );

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(mockedRemove).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Latest From Acme Analytics' })).toBeInTheDocument();
  });

  it("keeps the question open with the API's sentence when the removal is refused", async () => {
    mockedList.mockResolvedValue(listOf(ACME));
    mockedRemove.mockRejectedValue(new ApiError('You do not have permission to do that.', 403));
    renderTab({ isAdmin: true });

    await screen.findByRole('heading', { name: 'Latest From Acme Analytics' });
    openMenu('Acme Analytics');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    const confirm = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));

    expect(await within(confirm).findByTestId('competitor-remove-error')).toHaveTextContent(
      'You do not have permission to do that.',
    );
    expect(
      screen.getByRole('heading', { name: 'Latest From Acme Analytics', hidden: true }),
    ).toBeInTheDocument();
  });

  it('uses a sentence of its own when a removal never reached the API', async () => {
    mockedList.mockResolvedValue(listOf(ACME));
    mockedRemove.mockRejectedValue(new ApiError('Failed to fetch', 0));
    renderTab({ isAdmin: true });

    await screen.findByRole('heading', { name: 'Latest From Acme Analytics' });
    openMenu('Acme Analytics');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    const confirm = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));

    expect(await within(confirm).findByTestId('competitor-remove-error')).toHaveTextContent(
      REMOVE_FAILED,
    );
  });
});

describe('CompetitorsTab, an answer that is not ready', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** Lets the answers that are out land, then moves the clock. */
  async function pass(ms: number) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ms);
    });
  }

  it('keeps the footprint and asks again by itself, and never says "nothing new" meanwhile', async () => {
    mockedList.mockResolvedValue(listOf(ACME));
    mockedItems
      .mockResolvedValueOnce(items({ pending: true }))
      .mockResolvedValueOnce(items({ pending: true }))
      .mockResolvedValue(items({ items: [row('a1', 'Five ways to cut churn')] }));
    renderTab();

    await pass(0);
    expect(mockedItems).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('status', { name: /Loading what Acme Analytics published/ }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('competitor-nothing-new')).not.toBeInTheDocument();

    await pass(PENDING_RETRY_MS);
    expect(mockedItems).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('competitor-nothing-new')).not.toBeInTheDocument();

    await pass(PENDING_RETRY_MS);
    expect(mockedItems).toHaveBeenCalledTimes(3);
    expect(screen.getByText('Five ways to cut churn')).toBeInTheDocument();

    // It has its answer: nothing more is asked.
    await pass(PENDING_RETRY_MS * 3);
    expect(mockedItems).toHaveBeenCalledTimes(3);
  });

  it('shows the rows it has while the rest is still being read', async () => {
    mockedList.mockResolvedValue(listOf(ACME));
    mockedItems
      .mockResolvedValueOnce(items({ pending: true, items: [row('a1', 'A blog post')] }))
      .mockResolvedValue(
        items({ items: [row('a1', 'A blog post'), row('a2', 'A video', 'youtube')] }),
      );
    renderTab();

    await pass(0);
    expect(screen.getByText('A blog post')).toBeInTheDocument();

    await pass(PENDING_RETRY_MS);
    expect(screen.getByText('A video')).toBeInTheDocument();
  });

  it('gives up after a few tries and says so, with Try Again, in that group only', async () => {
    mockedList.mockResolvedValue(listOf(ACME, BOLT));
    mockedItems.mockImplementation(async (id) =>
      id === 'acme'
        ? items({ pending: true })
        : items({ items: [row('b1', 'Bolt ships dashboards')] }),
    );
    renderTab();

    await pass(0);
    for (let tries = 0; tries < PENDING_TRIES; tries += 1) await pass(PENDING_RETRY_MS);
    const acmeCalls = () => mockedItems.mock.calls.filter(([id]) => id === 'acme').length;
    expect(acmeCalls()).toBe(PENDING_TRIES + 1);

    const acme = group('Acme Analytics');
    expect(within(acme).getByTestId('competitor-error')).toHaveTextContent(STILL_READING);
    expect(within(acme).queryByTestId('competitor-nothing-new')).not.toBeInTheDocument();
    expect(within(group('Bolt Metrics')).getByText('Bolt ships dashboards')).toBeInTheDocument();

    // No more by itself.
    await pass(PENDING_RETRY_MS * 3);
    expect(acmeCalls()).toBe(PENDING_TRIES + 1);

    // A person asking starts the count over.
    mockedItems.mockImplementation(async () => items({ items: [row('a1', 'Back at last')] }));
    fireEvent.click(within(acme).getByRole('button', { name: 'Try Again' }));
    await pass(0);
    expect(within(acme).getByText('Back at last')).toBeInTheDocument();
    expect(within(acme).queryByTestId('competitor-error')).not.toBeInTheDocument();
  });

  it('stops asking once the tab is gone', async () => {
    mockedList.mockResolvedValue(listOf(ACME));
    mockedItems.mockResolvedValue(items({ pending: true }));
    const view = renderTab();

    await pass(0);
    view.unmount();
    await pass(PENDING_RETRY_MS * 3);

    expect(mockedItems).toHaveBeenCalledTimes(1);
  });
});
