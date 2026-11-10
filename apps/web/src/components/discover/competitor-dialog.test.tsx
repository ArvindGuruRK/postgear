/**
 * Add and Edit Competitor (Module 07, story DC-7.1): a website's feeds listed
 * and ticked after Find Feeds, the sentence when it has none, a pasted feed,
 * the private-address sentence on Find Feeds and on Save with nothing closed,
 * the news phrase that follows the name, and an edit that starts from what was
 * saved.
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '@/lib/api';
import { createCompetitor, findCompetitorFeeds, updateCompetitor } from '@/lib/discover-api';
import type { Competitor, DiscoveredFeed } from '@/types/discover';
import { stubBrowserLayout } from '../workflows/fields/test-dom';
import { CompetitorDialog } from './competitor-dialog';
import {
  FEEDS_FULL,
  FIND_FAILED,
  FINDING_FEEDS,
  NAME_NEEDED,
  NO_FEEDS_FOUND,
  SAVE_FAILED,
  WEBSITE_HINT,
  YOUTUBE_HINT,
} from './competitor-model';

jest.mock('@/lib/discover-api', () => ({
  createCompetitor: jest.fn(),
  updateCompetitor: jest.fn(),
  findCompetitorFeeds: jest.fn(),
}));

const mockedCreate = createCompetitor as jest.MockedFunction<typeof createCompetitor>;
const mockedUpdate = updateCompetitor as jest.MockedFunction<typeof updateCompetitor>;
const mockedFind = findCompetitorFeeds as jest.MockedFunction<typeof findCompetitorFeeds>;

beforeAll(stubBrowserLayout);
jest.setTimeout(20_000);

const PRIVATE = 'This address is private or on your own network.';

const FEEDS: DiscoveredFeed[] = [
  { url: 'https://acme.example/blog/rss.xml', title: 'Blog', kind: 'rss' },
  { url: 'https://acme.example/changelog/atom.xml', title: 'Changelog', kind: 'atom' },
];

const ACME: Competitor = {
  id: 'c1',
  name: 'Acme Analytics',
  websiteUrl: 'https://acme.example/',
  feedUrls: ['https://acme.example/blog/rss.xml'],
  youtubeChannelId: 'UCacmeSampleChannel00000',
  blueskyHandle: 'acme.example',
  mastodonAcct: 'acme@mastodon.example',
  newsQuery: 'Acme funding',
  lastCheckedAt: null,
  lastError: null,
  createdAt: '2026-11-10T08:00:00.000Z',
  updatedAt: '2026-11-10T08:00:00.000Z',
};

function renderDialog(competitor: Competitor | null = null) {
  const onClose = jest.fn();
  const onSaved = jest.fn();
  render(<CompetitorDialog open competitor={competitor} onClose={onClose} onSaved={onSaved} />);
  return { onClose, onSaved };
}

/** The label of a required field ends in its asterisk. */
const NAME = /^Name/;

function type(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

/** A promise the test settles when it chooses. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  mockedCreate.mockReset();
  mockedUpdate.mockReset();
  mockedFind.mockReset();
});

describe('CompetitorDialog, adding', () => {
  it('opens blank, named Add Competitor, with placeholders that ask', () => {
    renderDialog();

    expect(screen.getByRole('heading', { name: 'Add Competitor' })).toBeInTheDocument();
    expect(screen.getByLabelText(NAME)).toHaveValue('');
    for (const placeholder of [
      "Enter your competitor's name",
      "Enter your competitor's website",
      'Enter your feed address',
      "Enter your competitor's YouTube channel id",
      "Enter your competitor's Bluesky handle",
      "Enter your competitor's Mastodon account",
      'Enter your news search phrase',
    ]) {
      expect(screen.getByPlaceholderText(placeholder)).toBeInTheDocument();
    }
    expect(screen.queryByTestId('competitor-feed-list')).not.toBeInTheDocument();
    expect(mockedFind).not.toHaveBeenCalled();
  });

  it('lists the feeds it found, ticked, after Find Feeds', async () => {
    const answer = deferred<DiscoveredFeed[]>();
    mockedFind.mockReturnValue(answer.promise);
    renderDialog();

    type('Website', 'acme.example');
    fireEvent.click(screen.getByRole('button', { name: 'Find Feeds' }));

    expect(mockedFind).toHaveBeenCalledWith('acme.example');
    expect(screen.getByTestId('competitor-feeds-status')).toHaveTextContent(FINDING_FEEDS);
    expect(screen.getByRole('button', { name: 'Find Feeds' })).toBeDisabled();

    await act(async () => {
      answer.resolve(FEEDS);
    });

    const blog = screen.getByRole('checkbox', { name: /Blog, RSS/ });
    const changelog = screen.getByRole('checkbox', { name: /Changelog, Atom/ });
    expect(blog).toBeChecked();
    expect(changelog).toBeChecked();
    const list = screen.getByTestId('competitor-feed-list');
    expect(within(list).getByText('https://acme.example/blog/rss.xml')).toBeInTheDocument();
    expect(screen.getByTestId('competitor-feeds-status')).toBeEmptyDOMElement();
  });

  it('never asks while the website is being typed', () => {
    renderDialog();

    type('Website', 'a');
    type('Website', 'ac');
    type('Website', 'acme.example');

    expect(mockedFind).not.toHaveBeenCalled();
  });

  it('asks once when the website field is left with a new address, and not again unchanged', async () => {
    mockedFind.mockResolvedValue(FEEDS);
    renderDialog();

    type('Website', 'acme.example');
    fireEvent.blur(screen.getByLabelText('Website'));
    await screen.findByRole('checkbox', { name: /Blog, RSS/ });
    fireEvent.blur(screen.getByLabelText('Website'));

    expect(mockedFind).toHaveBeenCalledTimes(1);
  });

  it('asks once when the field is left for the Find Feeds button', async () => {
    mockedFind.mockResolvedValue(FEEDS);
    renderDialog();

    type('Website', 'acme.example');
    const button = screen.getByRole('button', { name: 'Find Feeds' });
    fireEvent.blur(screen.getByLabelText('Website'), { relatedTarget: button });
    fireEvent.click(button);
    await screen.findByRole('checkbox', { name: /Blog, RSS/ });

    expect(mockedFind).toHaveBeenCalledTimes(1);
  });

  it('says so when the website has no feeds, and takes a pasted one', async () => {
    mockedFind.mockResolvedValue([]);
    renderDialog();

    type('Website', 'acme.example');
    fireEvent.click(screen.getByRole('button', { name: 'Find Feeds' }));

    expect(await screen.findByText(NO_FEEDS_FOUND)).toBeInTheDocument();

    type('Feed address', 'acme.example/news.xml');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByRole('checkbox', { name: 'https://acme.example/news.xml' })).toBeChecked();
    expect(screen.getByLabelText('Feed address')).toHaveValue('');
  });

  it('adds a pasted feed on Enter without saving the form', () => {
    renderDialog();

    type('Feed address', 'https://acme.example/feed');
    fireEvent.keyDown(screen.getByLabelText('Feed address'), { key: 'Enter' });

    expect(screen.getByRole('checkbox', { name: 'https://acme.example/feed' })).toBeChecked();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('refuses a sixth feed with the sentence', () => {
    renderDialog();

    for (const index of [1, 2, 3, 4, 5]) {
      type('Feed address', `https://acme.example/feed-${index}.xml`);
      fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    }
    type('Feed address', 'https://acme.example/feed-6.xml');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByText(FEEDS_FULL)).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(5);
  });

  it('drops an answer for a website the person has since changed', async () => {
    const first = deferred<DiscoveredFeed[]>();
    const second = deferred<DiscoveredFeed[]>();
    mockedFind.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderDialog();

    type('Website', 'old.example');
    fireEvent.blur(screen.getByLabelText('Website'));
    type('Website', 'acme.example');
    fireEvent.blur(screen.getByLabelText('Website'));

    await act(async () => {
      second.resolve([FEEDS[0]]);
    });
    await act(async () => {
      first.resolve([{ url: 'https://old.example/feed', title: 'Old', kind: 'rss' }]);
    });

    expect(screen.getByRole('checkbox', { name: /Blog, RSS/ })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Old, RSS/ })).not.toBeInTheDocument();
  });

  it('shows the private sentence from Find Feeds and stays open', async () => {
    mockedFind.mockRejectedValue(new ApiError(PRIVATE, 422, 'competitor_private'));
    const { onClose } = renderDialog();

    type('Website', 'http://127.0.0.1:3000');
    fireEvent.click(screen.getByRole('button', { name: 'Find Feeds' }));

    expect(await screen.findByTestId('competitor-find-error')).toHaveTextContent(PRIVATE);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Website')).toHaveValue('http://127.0.0.1:3000');
  });

  it('uses a sentence of its own when the API never answered', async () => {
    mockedFind.mockRejectedValue(new ApiError('Failed to fetch', 0));
    renderDialog();

    type('Website', 'acme.example');
    fireEvent.click(screen.getByRole('button', { name: 'Find Feeds' }));

    expect(await screen.findByTestId('competitor-find-error')).toHaveTextContent(FIND_FAILED);
  });

  it('fills the news phrase from the name until it is edited, and sends null for it', async () => {
    mockedCreate.mockResolvedValue({ ...ACME, newsQuery: null });
    const { onClose, onSaved } = renderDialog();

    type(NAME, 'Acme');
    expect(screen.getByLabelText('News search phrase')).toHaveValue('Acme');
    type(NAME, 'Acme Analytics');
    expect(screen.getByLabelText('News search phrase')).toHaveValue('Acme Analytics');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ ...ACME, newsQuery: null }));
    expect(mockedCreate).toHaveBeenCalledWith({
      name: 'Acme Analytics',
      websiteUrl: null,
      feedUrls: [],
      youtubeChannelId: null,
      blueskyHandle: null,
      mastodonAcct: null,
      newsQuery: null,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps a phrase the person wrote when the name changes, and sends it', async () => {
    mockedCreate.mockResolvedValue(ACME);
    renderDialog();

    type(NAME, 'Acme');
    type('News search phrase', 'Acme funding');
    type(NAME, 'Acme Analytics');
    expect(screen.getByLabelText('News search phrase')).toHaveValue('Acme funding');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalled());
    expect(mockedCreate.mock.calls[0][0]).toMatchObject({ newsQuery: 'Acme funding' });
  });

  it('sends the ticked feeds and the channels', async () => {
    mockedFind.mockResolvedValue(FEEDS);
    mockedCreate.mockResolvedValue(ACME);
    renderDialog();

    type(NAME, 'Acme Analytics');
    type('Website', 'acme.example');
    fireEvent.click(screen.getByRole('button', { name: 'Find Feeds' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /Changelog, Atom/ }));
    type('YouTube channel id', 'UCacmeSampleChannel00000');
    type('Bluesky handle', '@acme.example');
    type('Mastodon account', 'acme@mastodon.example');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalled());
    expect(mockedCreate).toHaveBeenCalledWith({
      name: 'Acme Analytics',
      websiteUrl: 'acme.example',
      feedUrls: ['https://acme.example/blog/rss.xml'],
      youtubeChannelId: 'UCacmeSampleChannel00000',
      blueskyHandle: 'acme.example',
      mastodonAcct: 'acme@mastodon.example',
      newsQuery: null,
    });
  });

  it('names the wrong field instead of sending it', () => {
    renderDialog();

    type('YouTube channel id', 'acme');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText(NAME_NEEDED)).toBeInTheDocument();
    expect(screen.getByText(YOUTUBE_HINT)).toBeInTheDocument();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('shows the private sentence from Save, keeps what was typed, and stays open', async () => {
    mockedCreate.mockRejectedValue(new ApiError(PRIVATE, 422, 'competitor_private'));
    const { onClose, onSaved } = renderDialog();

    type(NAME, 'Acme');
    type('Feed address', 'http://10.0.0.5/feed');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByTestId('competitor-save-error')).toHaveTextContent(PRIVATE);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByLabelText(NAME)).toHaveValue('Acme');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('shows the limit sentence from Save', async () => {
    mockedCreate.mockRejectedValue(
      new ApiError('You can follow up to 20 competitors.', 422, 'competitor_limit'),
    );
    renderDialog();

    type(NAME, 'Acme');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByTestId('competitor-save-error')).toHaveTextContent(
      'You can follow up to 20 competitors.',
    );
  });

  it('uses a sentence of its own when a save never reached the API', async () => {
    mockedCreate.mockRejectedValue(new ApiError('Failed to fetch', 0));
    renderDialog();

    type(NAME, 'Acme');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByTestId('competitor-save-error')).toHaveTextContent(SAVE_FAILED);
  });

  it('closes on Cancel and saves nothing', () => {
    const { onClose } = renderDialog();

    type(NAME, 'Acme');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});

describe('CompetitorDialog, editing', () => {
  it('starts from the saved values, its feeds ticked, and asks for nothing', () => {
    renderDialog(ACME);

    expect(screen.getByRole('heading', { name: 'Edit Competitor' })).toBeInTheDocument();
    expect(screen.getByLabelText(NAME)).toHaveValue('Acme Analytics');
    expect(screen.getByLabelText('Website')).toHaveValue('https://acme.example/');
    expect(
      screen.getByRole('checkbox', { name: 'https://acme.example/blog/rss.xml' }),
    ).toBeChecked();
    expect(screen.getByLabelText('YouTube channel id')).toHaveValue('UCacmeSampleChannel00000');
    expect(screen.getByLabelText('Bluesky handle')).toHaveValue('acme.example');
    expect(screen.getByLabelText('Mastodon account')).toHaveValue('acme@mastodon.example');
    expect(screen.getByLabelText('News search phrase')).toHaveValue('Acme funding');

    // Leaving the website as it was saved looks nothing up.
    fireEvent.blur(screen.getByLabelText('Website'));
    expect(mockedFind).not.toHaveBeenCalled();
  });

  it('saves an unticked feed as gone', async () => {
    const saved = { ...ACME, feedUrls: [], updatedAt: '2026-11-10T09:00:00.000Z' };
    mockedUpdate.mockResolvedValue(saved);
    const { onSaved } = renderDialog(ACME);

    fireEvent.click(screen.getByRole('checkbox', { name: 'https://acme.example/blog/rss.xml' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    // Only what changed: an address nobody touched is not sent, so it is not looked up again.
    expect(mockedUpdate).toHaveBeenCalledWith('c1', { feedUrls: [] });
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('follows the name again when the saved competitor had no phrase of its own', () => {
    renderDialog({ ...ACME, newsQuery: null });

    expect(screen.getByLabelText('News search phrase')).toHaveValue('Acme Analytics');
    type(NAME, 'Acme');
    expect(screen.getByLabelText('News search phrase')).toHaveValue('Acme');
  });
});

describe('CompetitorDialog, what the review found', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('names the website field when it is not an address, and asks nobody', async () => {
    renderDialog();
    type(NAME, 'Acme');
    type('Website', 'acme analytics.com');

    fireEvent.click(screen.getByRole('button', { name: 'Find Feeds' }));
    expect(await screen.findByText(WEBSITE_HINT)).toBeInTheDocument();
    expect(mockedFind).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText(WEBSITE_HINT)).toBeInTheDocument();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('drops the website sentence once the address is one', async () => {
    mockedFind.mockResolvedValue(FEEDS);
    renderDialog();
    type('Website', 'acme analytics.com');
    fireEvent.click(screen.getByRole('button', { name: 'Find Feeds' }));
    await screen.findByText(WEBSITE_HINT);

    type('Website', 'acme.example');
    fireEvent.click(screen.getByRole('button', { name: 'Find Feeds' }));

    await waitFor(() => expect(mockedFind).toHaveBeenCalledWith('acme.example'));
    expect(screen.queryByText(WEBSITE_HINT)).not.toBeInTheDocument();
  });

  it('sends only the name when only the name changed', async () => {
    const saved = { ...ACME, name: 'Acme Corp' };
    mockedUpdate.mockResolvedValue(saved);
    const { onSaved } = renderDialog(ACME);

    type(NAME, 'Acme Corp');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(mockedUpdate).toHaveBeenCalledWith('c1', { name: 'Acme Corp' });
  });

  it('sends nothing at all when nothing changed, and closes', async () => {
    const { onSaved, onClose } = renderDialog(ACME);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalledWith(ACME);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });
});
