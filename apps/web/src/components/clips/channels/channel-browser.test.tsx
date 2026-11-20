import { TooltipProvider } from '@postgear/ui';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { ApiError } from '@/lib/api';
import type { ClipChannelView, ClipStreamsPage } from '@/types/clips';
import { FIXTURE_CHANNEL, FIXTURE_STREAMS, fixtureProbe } from '../clips-fixtures';
import { ChannelBrowser, type ChannelBrowserApi } from './channel-browser';
import { CONNECT_SENTENCE, EMPTY_CHANNEL } from './channels-model';
import type { ChannelsState } from './use-channels';

// Nothing here may reach the API: the browser gets a fake, and the real
// client is replaced so a stray call fails loudly instead of fetching.
jest.mock('@/lib/clips-api', () => ({}));
jest.mock('@postgear/ui', () => ({ ...jest.requireActual('@postgear/ui'), toast: jest.fn() }));

const { toast } = jest.requireMock('@postgear/ui') as { toast: jest.Mock };

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
});
beforeEach(() => toast.mockReset());

const READY = 'Friday Night Speedrun, Any Percent Attempts';
const LIVE = 'Live: Late Night Chill Stream';
const PROCESSING = 'Tuesday Practice Session';
const IMPORTED = 'World Record Attempt Night';
const HIDDEN = 'Old Charity Marathon';

function page(items = FIXTURE_STREAMS, overrides: Partial<ClipStreamsPage> = {}): ClipStreamsPage {
  return {
    kind: 'streams',
    sort: 'newest',
    period: null,
    items: [...items],
    nextCursor: null,
    updatedAt: new Date(Date.now() - 4.5 * 60_000).toISOString(),
    stale: false,
    capped: false,
    notice: null,
    ...overrides,
  };
}

function fakeApi(): jest.Mocked<ChannelBrowserApi> {
  return {
    list: jest.fn(async (_channelId, options = {}) =>
      page(options.hidden ? FIXTURE_STREAMS : FIXTURE_STREAMS.filter((item) => !item.hidden)),
    ),
    refresh: jest.fn(async (_channelId: string) => ({ refreshedAt: new Date().toISOString() })),
    probe: jest.fn(async (_url: string, _options?: { signal?: AbortSignal }) => fixtureProbe()),
    hide: jest.fn(async (_channelId, externalId) => ({ externalId, hidden: true })),
    unhide: jest.fn(async (_channelId, externalId) => ({ externalId, hidden: false })),
    remove: jest.fn(async (_channelId: string) => ({ message: 'The channel was removed.' })),
    check: jest.fn(async (platform, handle) => ({
      platform,
      handle,
      displayName: handle,
      avatarUrl: null,
    })),
    add: jest.fn(async (platform, handle) => ({
      ...FIXTURE_CHANNEL,
      platform,
      handle,
      displayName: handle,
    })),
  };
}

function channelsState(
  channels: ClipChannelView[],
  overrides: Partial<ChannelsState> = {},
): ChannelsState {
  return {
    channels,
    loading: false,
    error: null,
    reload: jest.fn(),
    added: jest.fn(),
    removed: jest.fn(),
    ...overrides,
  };
}

function renderBrowser(props: Partial<Parameters<typeof ChannelBrowser>[0]> = {}) {
  const api = props.api ?? fakeApi();
  const onProbed = jest.fn();
  const ui: ReactElement = (
    <TooltipProvider>
      <ChannelBrowser
        orgId="org-1"
        platforms={['youtube', 'twitch', 'kick']}
        channelsState={channelsState([FIXTURE_CHANNEL])}
        api={api}
        onProbed={onProbed}
        {...props}
      />
    </TooltipProvider>
  );
  return { ...render(ui), api: api as jest.Mocked<ChannelBrowserApi>, onProbed };
}

const rowOf = (title: string) => screen.getByText(title).closest('li') as HTMLElement;

describe('ChannelBrowser', () => {
  it('lists the chosen channel without ever asking the probe', async () => {
    const { api } = renderBrowser();

    expect(await screen.findByText(READY)).toBeInTheDocument();
    for (const title of [LIVE, PROCESSING, IMPORTED]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(screen.queryByText(HIDDEN)).not.toBeInTheDocument();
    expect(api.list).toHaveBeenCalledWith(
      'channel-1',
      expect.objectContaining({ kind: 'streams', sort: 'newest', hidden: false, cursor: null }),
    );
    expect(screen.getByText(/Updated 4 minutes ago, 4 streams/)).toBeInTheDocument();
    expect(within(rowOf(READY)).getByText('14 Nov, 3 h 42 min, 12,408 views')).toBeInTheDocument();
    expect(api.probe).not.toHaveBeenCalled();
  });

  it('shows Live Now and no Import for a live row, and Open for an imported one', async () => {
    renderBrowser();
    await screen.findByText(READY);

    const live = within(rowOf(LIVE));
    expect(live.getByText('Live Now')).toBeInTheDocument();
    expect(live.queryByRole('button', { name: /^Import/ })).not.toBeInTheDocument();

    expect(within(rowOf(PROCESSING)).getByText('Still Processing')).toBeInTheDocument();

    const imported = within(rowOf(IMPORTED));
    expect(imported.getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      '/org-1/clips/video/video-ready',
    );
    expect(imported.queryByRole('button', { name: /^Import/ })).not.toBeInTheDocument();
  });

  it("sends a row's canonical link to the probe on Import, then hands the card on", async () => {
    const { api, onProbed } = renderBrowser();
    await screen.findByText(READY);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: `Import ${READY}` }));
    });

    expect(api.probe).toHaveBeenCalledTimes(1);
    expect(api.probe).toHaveBeenCalledWith('https://www.twitch.tv/videos/1000000001', {
      signal: expect.any(AbortSignal),
    });
    expect(onProbed).toHaveBeenCalledWith(
      'https://www.twitch.tv/videos/1000000001',
      fixtureProbe(),
    );
  });

  it("shows the probe's refusal under the row", async () => {
    const api = fakeApi();
    api.probe.mockRejectedValue(
      new ApiError(
        'This video is private or needs a login, so we cannot read it.',
        422,
        'link_private',
      ),
    );
    const { onProbed } = renderBrowser({ api });
    await screen.findByText(READY);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: `Import ${READY}` }));
    });

    expect(
      within(rowOf(READY)).getByText(
        'This video is private or needs a login, so we cannot read it.',
      ),
    ).toBeInTheDocument();
    expect(onProbed).not.toHaveBeenCalled();
  });

  it('keeps Import off while the video tools are down', async () => {
    renderBrowser({ disabled: true });
    await screen.findByText(READY);
    expect(screen.getByRole('button', { name: `Import ${READY}` })).toBeDisabled();
  });

  it('hides a row at once, tells the API, and Undo brings it back', async () => {
    const { api } = renderBrowser();
    await screen.findByText(READY);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: `Hide ${READY} from the list` }));
    });

    expect(screen.queryByText(READY)).not.toBeInTheDocument();
    expect(api.hide).toHaveBeenCalledWith('channel-1', '1000000001');
    // Undo sits in the list, not in a toast: inside the Browse dialog a toast
    // could not be pressed.
    expect(toast).not.toHaveBeenCalled();
    const undo = screen.getByTestId('clips-hidden-undo');
    expect(undo).toHaveTextContent('Hidden from the list.');
    expect(screen.getByText(/3 streams/)).toBeInTheDocument();

    await act(async () => fireEvent.click(within(undo).getByRole('button', { name: 'Undo' })));
    expect(api.unhide).toHaveBeenCalledWith('channel-1', '1000000001');
    expect(screen.getByText(READY)).toBeInTheDocument();
    expect(screen.queryByTestId('clips-hidden-undo')).toBeNull();
  });

  it('puts a row back when the API refuses to hide it', async () => {
    const api = fakeApi();
    api.hide.mockRejectedValue(new ApiError('That did not save.', 500));
    renderBrowser({ api });
    await screen.findByText(READY);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: `Hide ${READY} from the list` }));
    });

    expect(screen.getByText(READY)).toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith({ title: 'That did not save.', variant: 'danger' });
  });

  it('asks for hidden rows with Show Hidden, and Show Again unhides one', async () => {
    const { api } = renderBrowser();
    await screen.findByText(READY);

    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'Show Hidden' }));
    });

    expect(api.list).toHaveBeenLastCalledWith(
      'channel-1',
      expect.objectContaining({ hidden: true }),
    );
    await screen.findByText(HIDDEN);
    const hidden = within(rowOf(HIDDEN));
    await act(async () => {
      fireEvent.click(hidden.getByRole('button', { name: 'Show Again' }));
    });
    expect(api.unhide).toHaveBeenCalledWith('channel-1', '1000000005');
    expect(
      within(rowOf(HIDDEN)).queryByRole('button', { name: 'Show Again' }),
    ).not.toBeInTheDocument();
    expect(api.probe).not.toHaveBeenCalled();
  });

  it('starts the Clips list on its own defaults', async () => {
    const { api } = renderBrowser();
    await screen.findByText(READY);

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole('tab', { name: 'Clips' }), { button: 0 });
    });

    await waitFor(() =>
      expect(api.list).toHaveBeenLastCalledWith(
        'channel-1',
        expect.objectContaining({ kind: 'clips', sort: 'views', period: 'all' }),
      ),
    );
    expect(api.probe).not.toHaveBeenCalled();
  });

  it('lets a Twitch list sort, but locks the sort for YouTube', async () => {
    const twitch = renderBrowser();
    await screen.findByText(READY);
    const twitchSort = within(screen.getByRole('group', { name: 'Sort' }));
    expect(twitchSort.getByRole('button', { name: 'Most Viewed' })).toBeEnabled();
    twitch.unmount();

    const youtube: ClipChannelView = {
      ...FIXTURE_CHANNEL,
      id: 'channel-yt',
      platform: 'youtube',
      handle: '@simstreamer',
      lists: [
        { kind: 'uploads', sorts: ['newest', 'views'], periods: [] },
        { kind: 'streams', sorts: ['newest'], periods: [] },
        { kind: 'shorts', sorts: ['newest'], periods: [] },
      ],
    };
    renderBrowser({ channelsState: channelsState([youtube]) });
    await screen.findByText(READY);
    const sort = within(screen.getByRole('group', { name: 'Sort' }));
    expect(sort.getByRole('button', { name: 'Newest' })).toBeDisabled();
    expect(sort.getByRole('button', { name: 'Most Viewed' })).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Videos' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Shorts' })).toBeInTheDocument();
  });

  it('says so when a channel has nothing public', async () => {
    const api = fakeApi();
    api.list.mockResolvedValue(page([]));
    renderBrowser({ api });
    expect(await screen.findByText(EMPTY_CHANNEL)).toBeInTheDocument();
  });

  it("shows a list's refusal with Try Again", async () => {
    const api = fakeApi();
    api.list.mockRejectedValueOnce(
      new ApiError('Twitch is not answering right now.', 503, 'platform_resting'),
    );
    renderBrowser({ api });

    expect(await screen.findByText('Twitch is not answering right now.')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    });
    expect(await screen.findByText(READY)).toBeInTheDocument();
  });

  it('invites the first channel when there is none', () => {
    const { api } = renderBrowser({ channelsState: channelsState([]) });
    expect(screen.getByText(CONNECT_SENTENCE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add A Channel' })).toBeEnabled();
    expect(api.list).not.toHaveBeenCalled();
  });

  it('offers Try Again when the channels did not load', () => {
    const reload = jest.fn();
    renderBrowser({
      channelsState: channelsState([], {
        error: { message: 'We could not load your channels. Try again.', code: undefined },
        reload,
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(reload).toHaveBeenCalled();
  });
});
