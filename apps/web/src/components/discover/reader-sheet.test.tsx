/**
 * The reader sheet (Module 08, blueprint section 6): what it says while a page
 * is on its way, the article as plain text with its line of who, when and how
 * long, each refusal in its one sentence with Open kept, an answer that lands
 * too late dropped, Read A Page with its address field, and Create Post From
 * This handing the Create Post sheet a brief built from the article.
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '@/lib/api';
import { readPage } from '@/lib/discover-api';
import type { DiscoverItem, Locality, ReaderArticle } from '@/types/discover';
import { stubBrowserLayout } from '../workflows/fields/test-dom';
import { readerPostTarget } from './discover-model';
import {
  NOT_AN_ADDRESS,
  OPENING_STORY,
  READ_FAILED,
  READING_PAGE,
  ReaderSheet,
  type ReaderSheetProps,
  type ReaderTarget,
} from './reader-sheet';

jest.mock('@/lib/discover-api', () => ({ readPage: jest.fn() }));
jest.mock('../home/home-model', () => ({ viewerTimeZone: () => 'UTC' }));

const mockedRead = readPage as jest.MockedFunction<typeof readPage>;

beforeAll(stubBrowserLayout);
jest.setTimeout(20_000);

const MIDDLE_DOT = String.fromCodePoint(0xb7);

const CHENNAI: Locality = {
  countryCode: 'IN',
  countryName: 'India',
  regionCode: 'IN-TN',
  regionName: 'Tamil Nadu',
  city: 'Chennai',
  timeZone: 'Asia/Kolkata',
  languages: ['ta', 'en'],
  newsLanguages: ['ta', 'en'],
};

const TREND: DiscoverItem = {
  id: 't1',
  kind: 'trend',
  source: { id: 'google-trends', name: 'Google Trends' },
  title: 'weather coimbatore',
  url: 'https://www.thehindu.example/rain',
  related: [
    { title: 'Heavy rain alert', url: 'https://www.thehindu.example/rain', source: 'The Hindu' },
  ],
  brief: 'Rising search in Tamil Nadu: "weather coimbatore".',
};

const STORY: DiscoverItem = {
  id: 'n1',
  kind: 'news',
  source: { id: 'google-news', name: 'Nakkheeran' },
  title: 'A story behind a Google link',
  opaqueUrl: 'https://news.google.com/rss/articles/abc',
  language: 'ta',
  brief: 'News story in Chennai.',
};

const ARTICLE: ReaderArticle = {
  url: 'https://www.thehindu.example/rain',
  finalUrl: 'https://www.thehindu.example/rain/final',
  title: 'Heavy rain alert for Coimbatore',
  byline: 'A. Reporter',
  siteName: 'The Sample Courier',
  language: 'en-GB',
  excerpt: 'Schools are closed for the day.',
  text: [
    'Schools are closed for the day.',
    '<b>Bold</b> stays text, and so does <script>alert(1)</script>.',
    'கோயம்புத்தூரில் கனமழை பெய்து வருகிறது.',
  ].join('\n\n'),
  image: 'https://img.example/rain.jpg',
  publishedAt: '2026-11-04T06:30:00.000Z',
  wordCount: 420,
  readMinutes: 3,
};

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

function item(of: DiscoverItem): ReaderTarget {
  return { mode: 'item', item: of };
}

const PAGE: ReaderTarget = { mode: 'page' };

function renderSheet(target: ReaderTarget | null, props: Partial<ReaderSheetProps> = {}) {
  const onClose = jest.fn();
  const onCreatePost = jest.fn();
  const all: ReaderSheetProps = {
    target,
    place: CHENNAI,
    language: 'ta',
    onClose,
    onCreatePost,
    ...props,
  };
  const view = render(<ReaderSheet {...all} />);
  return {
    onClose,
    onCreatePost,
    open: (next: ReaderTarget | null) => view.rerender(<ReaderSheet {...all} target={next} />),
    unmount: view.unmount,
  };
}

function sheet(): HTMLElement {
  return screen.getByTestId('reader-sheet');
}

function typeAddress(value: string) {
  fireEvent.change(screen.getByLabelText('Page address'), { target: { value } });
}

function submitAddress() {
  fireEvent.submit(screen.getByRole('form', { name: 'Read a page' }));
}

beforeEach(() => {
  mockedRead.mockReset();
});

describe('ReaderSheet, reading an item', () => {
  it('is not there at all until something is read', () => {
    renderSheet(null);

    expect(screen.queryByTestId('reader-sheet')).not.toBeInTheDocument();
    expect(mockedRead).not.toHaveBeenCalled();
  });

  it('reads the item\'s own address once, and says "Reading the page..." meanwhile', async () => {
    mockedRead.mockReturnValue(new Promise(() => undefined));
    renderSheet(item(TREND));

    const loading = await screen.findByTestId('reader-loading');
    expect(loading).toHaveAttribute('aria-busy', 'true');
    expect(loading).toHaveTextContent(READING_PAGE);
    expect(mockedRead).toHaveBeenCalledTimes(1);
    expect(mockedRead).toHaveBeenCalledWith('https://www.thehindu.example/rain');
    // The story is named while it loads, and can be opened the usual way.
    expect(
      within(sheet()).getByRole('heading', { name: 'weather coimbatore' }),
    ).toBeInTheDocument();
    expect(within(sheet()).getByRole('link', { name: /^Open/ })).toHaveAttribute(
      'href',
      'https://www.thehindu.example/rain',
    );
  });

  it('says "Opening the story..." for a Google News link, which has to be opened first', async () => {
    mockedRead.mockReturnValue(new Promise(() => undefined));
    renderSheet(item(STORY));

    expect(await screen.findByTestId('reader-loading')).toHaveTextContent(OPENING_STORY);
    expect(mockedRead).toHaveBeenCalledWith('https://news.google.com/rss/articles/abc');
  });

  it('draws the article: who, when and how long, the title, the picture, the text', async () => {
    mockedRead.mockResolvedValue(ARTICLE);
    renderSheet(item(TREND));

    const meta = await screen.findByTestId('reader-meta');
    expect(meta).toHaveTextContent('The Sample Courier, by A. Reporter, 4 Nov 2026, 3 min read');
    expect(meta.textContent).not.toContain(MIDDLE_DOT);
    expect(meta).toHaveAttribute('dir', 'auto');

    const heading = within(sheet()).getByRole('heading', {
      name: 'Heavy rain alert for Coimbatore',
    });
    expect(heading).toHaveAttribute('dir', 'auto');

    const image = screen.getByTestId('reader-image');
    expect(image).toHaveAttribute('src', 'https://img.example/rain.jpg');
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');

    const text = screen.getByTestId('reader-text');
    expect(text).toHaveAttribute('dir', 'auto');
    const paragraphs = text.querySelectorAll('p');
    expect(paragraphs).toHaveLength(3);
    for (const paragraph of paragraphs) expect(paragraph).toHaveAttribute('dir', 'auto');
    expect(paragraphs[2]).toHaveTextContent('கோயம்புத்தூரில் கனமழை பெய்து வருகிறது.');
    expect(screen.queryByTestId('reader-loading')).not.toBeInTheDocument();
  });

  it('draws what the page wrote as text, never as markup', async () => {
    mockedRead.mockResolvedValue(ARTICLE);
    renderSheet(item(TREND));

    const text = await screen.findByTestId('reader-text');
    expect(text).toHaveTextContent(
      '<b>Bold</b> stays text, and so does <script>alert(1)</script>.',
    );
    expect(text.querySelector('b')).toBeNull();
    expect(text.querySelector('script')).toBeNull();
  });

  it('takes the picture away when it does not load, and shows none it was not given', async () => {
    mockedRead.mockResolvedValue(ARTICLE);
    const first = renderSheet(item(TREND));
    fireEvent.error(await screen.findByTestId('reader-image'));
    expect(screen.queryByTestId('reader-image')).not.toBeInTheDocument();
    expect(screen.getByTestId('reader-text')).toBeInTheDocument();
    first.unmount();

    mockedRead.mockResolvedValue({ ...ARTICLE, image: 'javascript:alert(1)' });
    renderSheet(item(TREND));
    await screen.findByTestId('reader-text');
    expect(screen.queryByTestId('reader-image')).not.toBeInTheDocument();
  });

  it('sends Open to where the page really was, in a new tab', async () => {
    mockedRead.mockResolvedValue(ARTICLE);
    renderSheet(item(STORY));

    await screen.findByTestId('reader-text');
    const open = within(sheet()).getByRole('link', { name: /^Open/ });
    expect(open).toHaveAttribute('href', 'https://www.thehindu.example/rain/final');
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', 'noopener noreferrer');
    expect(open).toHaveAccessibleName('Open Heavy rain alert for Coimbatore in a new tab');
  });

  it.each([
    ['read_private', 422, 'This page is private or on your own network.'],
    ['read_failed', 422, 'We could not read this page. Open it in a new tab instead.'],
    ['read_not_article', 422, 'This page is not an article.'],
    ['link_unresolved', 422, 'We could not open this story here. Open it in a new tab instead.'],
    ['read_throttled', 429, 'Try again in a moment.'],
  ])(
    'shows the sentence for %s in place of the text, and keeps Open',
    async (code, status, sentence) => {
      mockedRead.mockRejectedValue(new ApiError(sentence, status, code));
      renderSheet(item(STORY));

      const alert = await screen.findByTestId('reader-error');
      expect(alert).toHaveAttribute('role', 'alert');
      expect(alert).toHaveTextContent(sentence);
      expect(screen.queryByTestId('reader-text')).not.toBeInTheDocument();
      expect(screen.queryByTestId('reader-loading')).not.toBeInTheDocument();
      expect(within(sheet()).getByRole('link', { name: /^Open/ })).toHaveAttribute(
        'href',
        'https://news.google.com/rss/articles/abc',
      );
      expect(screen.getByRole('button', { name: 'Create Post From This' })).toBeDisabled();
    },
  );

  it('uses a sentence of its own when the read never reached the API', async () => {
    mockedRead.mockRejectedValue(new ApiError('Failed to fetch', 0));
    const first = renderSheet(item(TREND));
    expect(await screen.findByTestId('reader-error')).toHaveTextContent(READ_FAILED);
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();
    first.unmount();

    mockedRead.mockRejectedValue(new TypeError('boom'));
    renderSheet(item(TREND));
    expect(await screen.findByTestId('reader-error')).toHaveTextContent(READ_FAILED);
  });

  it('says it cannot read an item with no web address, without asking', async () => {
    renderSheet(item({ ...TREND, url: 'javascript:alert(1)', related: [] }));

    expect(await screen.findByTestId('reader-error')).toHaveTextContent(READ_FAILED);
    expect(mockedRead).not.toHaveBeenCalled();
    expect(within(sheet()).queryByRole('link', { name: /^Open/ })).not.toBeInTheDocument();
  });

  it('drops an answer that lands after the sheet was closed', async () => {
    const answer = deferred<ReaderArticle>();
    mockedRead.mockReturnValue(answer.promise);
    const { open } = renderSheet(item(TREND));
    await screen.findByTestId('reader-loading');

    open(null);
    await act(async () => {
      answer.resolve(ARTICLE);
      await answer.promise;
    });

    expect(screen.queryByTestId('reader-text')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reader-meta')).not.toBeInTheDocument();
  });

  it('reads again when the same card is opened again, and the first answer never paints the second', async () => {
    const first = deferred<ReaderArticle>();
    const second = deferred<ReaderArticle>();
    mockedRead.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { open } = renderSheet(item(TREND));
    await screen.findByTestId('reader-loading');

    open(null);
    open(item(TREND));
    await waitFor(() => expect(mockedRead).toHaveBeenCalledTimes(2));

    await act(async () => {
      first.resolve({ ...ARTICLE, title: 'The first answer, too late' });
      await first.promise;
    });
    expect(screen.queryByText('The first answer, too late')).not.toBeInTheDocument();
    expect(screen.getByTestId('reader-loading')).toBeInTheDocument();

    await act(async () => {
      second.resolve(ARTICLE);
      await second.promise;
    });
    expect(
      within(sheet()).getByRole('heading', { name: 'Heavy rain alert for Coimbatore' }),
    ).toBeInTheDocument();
  });

  it('closes when its Close is pressed', async () => {
    mockedRead.mockResolvedValue(ARTICLE);
    const { onClose } = renderSheet(item(TREND));

    await screen.findByTestId('reader-text');
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ReaderSheet, Create Post From This', () => {
  it('is disabled until an article is on screen', async () => {
    const answer = deferred<ReaderArticle>();
    mockedRead.mockReturnValue(answer.promise);
    renderSheet(item(TREND));

    const button = await screen.findByRole('button', { name: 'Create Post From This' });
    expect(button).toBeDisabled();

    await act(async () => {
      answer.resolve(ARTICLE);
      await answer.promise;
    });
    expect(button).toBeEnabled();
  });

  it('hands over a brief built from the article, in its language, and closes the reader', async () => {
    mockedRead.mockResolvedValue(ARTICLE);
    const { onCreatePost, onClose } = renderSheet(item(TREND));

    await screen.findByTestId('reader-text');
    fireEvent.click(screen.getByRole('button', { name: 'Create Post From This' }));

    expect(onCreatePost).toHaveBeenCalledTimes(1);
    const post = onCreatePost.mock.calls[0][0];
    expect(post).toEqual(readerPostTarget(ARTICLE, TREND, CHENNAI, 'ta'));
    expect(post.item.brief).toBe(
      'Heavy rain alert for Coimbatore (The Sample Courier). Schools are closed for the day.',
    );
    // The article is English and Chennai speaks English, so the draft starts there.
    expect(post.language).toBe('en');
    expect(post.place).toBe(CHENNAI);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the chip's language when the place does not speak the article's", async () => {
    mockedRead.mockResolvedValue({ ...ARTICLE, language: 'fr' });
    const { onCreatePost } = renderSheet(item(TREND));

    await screen.findByTestId('reader-text');
    fireEvent.click(screen.getByRole('button', { name: 'Create Post From This' }));

    expect(onCreatePost.mock.calls[0][0].language).toBe('ta');
  });

  it("gives a story that only had Google's link the publisher's address", async () => {
    mockedRead.mockResolvedValue({ ...ARTICLE, url: STORY.opaqueUrl as string });
    const { onCreatePost } = renderSheet(item(STORY));

    await screen.findByTestId('reader-text');
    fireEvent.click(screen.getByRole('button', { name: 'Create Post From This' }));

    const { item: handed } = onCreatePost.mock.calls[0][0];
    expect(handed.id).toBe('n1');
    expect(handed.url).toBe('https://www.thehindu.example/rain/final');
    expect(handed.opaqueUrl).toBe(STORY.opaqueUrl);
  });

  it('stays disabled without a place and a language to draft in', async () => {
    mockedRead.mockResolvedValue(ARTICLE);
    const { onCreatePost } = renderSheet(item(TREND), { place: null, language: null });

    await screen.findByTestId('reader-text');
    const button = screen.getByRole('button', { name: 'Create Post From This' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onCreatePost).not.toHaveBeenCalled();
  });
});

describe('ReaderSheet, Read A Page', () => {
  it('opens on an address field and reads nothing by itself', () => {
    renderSheet(PAGE);

    expect(within(sheet()).getByRole('heading', { name: 'Read A Page' })).toBeInTheDocument();
    expect(screen.getByLabelText('Page address')).toHaveAttribute(
      'placeholder',
      'Enter your page address',
    );
    expect(screen.getByRole('button', { name: 'Read' })).toBeDisabled();
    expect(within(sheet()).queryByRole('link', { name: /^Open/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Post From This' })).toBeDisabled();
    expect(mockedRead).not.toHaveBeenCalled();
  });

  it('reads on Enter, with https put in front of an address typed without it', async () => {
    mockedRead.mockResolvedValue(ARTICLE);
    renderSheet(PAGE);

    typeAddress('  reader.example/articles/harbour-market ');
    submitAddress();

    expect(mockedRead).toHaveBeenCalledWith('https://reader.example/articles/harbour-market');
    expect(await screen.findByTestId('reader-text')).toBeInTheDocument();
    expect(
      within(sheet()).getByRole('heading', { name: 'Heavy rain alert for Coimbatore' }),
    ).toBeInTheDocument();
  });

  it('reads from the Read button too', async () => {
    mockedRead.mockResolvedValue(ARTICLE);
    renderSheet(PAGE);

    typeAddress('http://reader.example/a');
    fireEvent.click(screen.getByRole('button', { name: 'Read' }));

    await waitFor(() => expect(mockedRead).toHaveBeenCalledWith('http://reader.example/a'));
  });

  it('does nothing for an empty field or spaces', () => {
    renderSheet(PAGE);

    submitAddress();
    typeAddress('   ');
    submitAddress();

    expect(mockedRead).not.toHaveBeenCalled();
    expect(screen.queryByText(NOT_AN_ADDRESS)).not.toBeInTheDocument();
  });

  it('says so when what was typed is not an address, without asking the API', () => {
    renderSheet(PAGE);

    typeAddress('not an address');
    submitAddress();
    expect(screen.getByText(NOT_AN_ADDRESS)).toBeInTheDocument();

    typeAddress('ftp://files.example/a.txt');
    submitAddress();
    expect(screen.getByText(NOT_AN_ADDRESS)).toBeInTheDocument();
    expect(mockedRead).not.toHaveBeenCalled();
  });

  it('keeps the field after a read, so another page can be read', async () => {
    mockedRead
      .mockResolvedValueOnce(ARTICLE)
      .mockResolvedValueOnce({ ...ARTICLE, title: 'The second page' });
    renderSheet(PAGE);

    typeAddress('reader.example/one');
    submitAddress();
    await screen.findByTestId('reader-text');
    expect(screen.getByLabelText('Page address')).toHaveValue('reader.example/one');

    typeAddress('reader.example/two');
    submitAddress();

    expect(await within(sheet()).findByRole('heading', { name: 'The second page' })).toBeVisible();
    expect(mockedRead).toHaveBeenLastCalledWith('https://reader.example/two');
  });

  it('shows the private sentence for an address on a private network, with Open to what was typed', async () => {
    mockedRead.mockRejectedValue(
      new ApiError('This page is private or on your own network.', 422, 'read_private'),
    );
    renderSheet(PAGE);

    typeAddress('http://10.0.0.1/');
    submitAddress();

    expect(await screen.findByTestId('reader-error')).toHaveTextContent(
      'This page is private or on your own network.',
    );
    expect(within(sheet()).getByRole('link', { name: /^Open/ })).toHaveAttribute(
      'href',
      'http://10.0.0.1/',
    );
    expect(screen.getByLabelText('Page address')).toHaveValue('http://10.0.0.1/');
  });

  it('makes a story of the pasted page for Create Post From This', async () => {
    mockedRead.mockResolvedValue(ARTICLE);
    const { onCreatePost } = renderSheet(PAGE);

    typeAddress('reader.example/one');
    submitAddress();
    await screen.findByTestId('reader-text');
    fireEvent.click(screen.getByRole('button', { name: 'Create Post From This' }));

    const post = onCreatePost.mock.calls[0][0];
    expect(post).toEqual(readerPostTarget(ARTICLE, null, CHENNAI, 'ta'));
    expect(post.item).toMatchObject({
      id: 'read:https://www.thehindu.example/rain/final',
      kind: 'news',
      source: { id: 'rss', name: 'The Sample Courier' },
      url: 'https://www.thehindu.example/rain/final',
    });
  });
});
