/**
 * Trending's rows and chips (Module 05): a Wikipedia row links to its article
 * twice (the title and Open) and offers Create Post; a social chip is a link
 * out whose name tells the two networks apart, with no Create Post and no
 * shadow; outside text carries `dir="auto"`; and an address that is not the
 * web is never made a link.
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { DiscoverItem } from '@/types/discover';
import { stubBrowserLayout } from '../workflows/fields/test-dom';
import { SocialChips, WikipediaRows } from './discover-rows';

beforeAll(stubBrowserLayout);

function article(patch: Partial<DiscoverItem> = {}): DiscoverItem {
  return {
    id: 'w1',
    kind: 'wiki',
    source: { id: 'wikipedia', name: 'Wikipedia', url: 'https://ta.wikipedia.org' },
    title: 'திருக்குறள்',
    url: 'https://ta.wikipedia.org/wiki/Thirukkural',
    language: 'ta',
    signal: { label: '1,627 reads', rank: 1, views: 1627 },
    brief: 'Widely read on Tamil Wikipedia: "திருக்குறள்" (1,627 reads).',
    ...patch,
  };
}

function topic(patch: Partial<DiscoverItem> = {}): DiscoverItem {
  return {
    id: 's1',
    kind: 'social',
    source: { id: 'bluesky', name: 'Bluesky', url: 'https://bsky.app' },
    title: 'House speaker picks',
    url: 'https://bsky.app/profile/did:plc:abc/feed/xyz',
    signal: { label: '4,625 posts', posts: 4625 },
    brief: 'Trending worldwide on Bluesky: "House speaker picks" (4,625 posts).',
    ...patch,
  };
}

describe('WikipediaRows', () => {
  const ARTICLES = [
    article(),
    article({
      id: 'w2',
      title: 'اللغة العربية',
      url: 'https://ar.wikipedia.org/wiki/Arabic',
      signal: { label: '980 reads', rank: 2, views: 980 },
    }),
  ];

  it('lists the articles in order, each with its place, reads and a link to it', () => {
    render(<WikipediaRows items={ARTICLES} />);

    const rows = screen.getAllByTestId('discover-wiki-row');
    expect(rows).toHaveLength(2);
    expect(screen.getByRole('list')).toContainElement(rows[0]);

    const first = within(rows[0]);
    expect(first.getByText('1')).toBeInTheDocument();
    expect(first.getByText('1,627 reads')).toBeInTheDocument();
    const title = first.getByRole('link', { name: 'திருக்குறள்' });
    expect(title).toHaveAttribute('href', 'https://ta.wikipedia.org/wiki/Thirukkural');
    expect(title).toHaveAttribute('target', '_blank');
    expect(title).toHaveAttribute('rel', 'noopener noreferrer');

    expect(within(rows[1]).getByText('2')).toBeInTheDocument();
    expect(within(rows[1]).getByText('980 reads')).toBeInTheDocument();
  });

  it('opens the article out of the app, named for a screen reader', () => {
    render(<WikipediaRows items={ARTICLES} />);

    const open = screen.getByRole('link', { name: 'Open திருக்குறள் in a new tab' });
    expect(open).toHaveAttribute('href', 'https://ta.wikipedia.org/wiki/Thirukkural');
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('lets the browser pick the direction of a title', () => {
    render(<WikipediaRows items={ARTICLES} />);

    expect(screen.getByRole('link', { name: 'اللغة العربية' }).closest('[dir]')).toHaveAttribute(
      'dir',
      'auto',
    );
  });

  it('hands Create Post the article, and shows no Create Post without a sheet', () => {
    const onCreatePost = jest.fn();
    const { rerender } = render(<WikipediaRows items={ARTICLES} onCreatePost={onCreatePost} />);

    const rows = screen.getAllByTestId('discover-wiki-row');
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Create Post' }));
    expect(onCreatePost).toHaveBeenCalledWith(ARTICLES[1]);

    rerender(<WikipediaRows items={ARTICLES} />);
    expect(screen.queryByRole('button', { name: 'Create Post' })).not.toBeInTheDocument();
  });

  it('never makes a link of an address that is not the web', () => {
    render(<WikipediaRows items={[article({ url: 'javascript:alert(1)' })]} />);

    const row = screen.getByTestId('discover-wiki-row');
    expect(within(row).getByText('திருக்குறள்')).toBeInTheDocument();
    expect(within(row).queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('SocialChips', () => {
  const TOPICS = [
    topic(),
    topic({
      id: 's2',
      source: { id: 'mastodon', name: 'Mastodon', url: 'https://mastodon.social' },
      title: '#MeerMittwoch',
      url: 'https://mastodon.social/tags/MeerMittwoch',
      signal: { label: '273 uses this week', posts: 273 },
    }),
  ];

  it('makes each topic a link out that says which network it is from', () => {
    render(<SocialChips items={TOPICS} />);

    const bluesky = screen.getByRole('link', {
      name: 'House speaker picks on Bluesky, 4,625 posts, opens in a new tab',
    });
    expect(bluesky).toHaveAttribute('href', 'https://bsky.app/profile/did:plc:abc/feed/xyz');
    expect(bluesky).toHaveAttribute('target', '_blank');
    expect(bluesky).toHaveAttribute('rel', 'noopener noreferrer');
    expect(bluesky).toHaveTextContent('House speaker picks');
    expect(bluesky).toHaveTextContent('4,625 posts');

    const mastodon = screen.getByRole('link', {
      name: '#MeerMittwoch on Mastodon, 273 uses this week, opens in a new tab',
    });
    expect(mastodon).toHaveAttribute('href', 'https://mastodon.social/tags/MeerMittwoch');
    expect(mastodon).toHaveAttribute('data-source', 'mastodon');
  });

  it('stands on its border: no shadow, and nothing to press but the link', () => {
    render(<SocialChips items={TOPICS} />);

    for (const chip of screen.getAllByTestId('discover-social-chip')) {
      expect(chip.className).not.toMatch(/shadow/);
    }
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('lets the browser pick the direction of a topic', () => {
    render(<SocialChips items={[topic({ title: 'كأس العالم' })]} />);

    expect(screen.getByText('كأس العالم')).toHaveAttribute('dir', 'auto');
  });

  it('shows a topic without a safe address as words, not a link', () => {
    render(
      <SocialChips
        items={[
          topic({ url: undefined }),
          topic({ id: 's3', title: 'Bad link', url: 'javascript:alert(1)' }),
        ]}
      />,
    );

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    const chips = screen.getAllByTestId('discover-social-chip');
    expect(chips).toHaveLength(2);
    // The network is still said, for a reader who cannot see the row it sits in.
    expect(within(chips[0]).getByText('on Bluesky')).toBeInTheDocument();
    expect(within(chips[0]).getByText('4,625 posts')).toBeInTheDocument();
  });
});
