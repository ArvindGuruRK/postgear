/**
 * A competitor's rows (Module 07): a tag for each of the five kinds, a News row
 * that names its publisher, the title and Open as links out of the app, Create
 * Post handing back the item, outside text with `dir="auto"`, and an address
 * that is not the web never made a link.
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { DiscoverItem } from '@/types/discover';
import { stubBrowserLayout } from '../workflows/fields/test-dom';
import { CompetitorRows } from './competitor-row';

beforeAll(stubBrowserLayout);

const NOW = new Date('2026-11-10T12:00:00Z');

function item(patch: Partial<DiscoverItem> = {}): DiscoverItem {
  return {
    id: 'c1',
    kind: 'competitor',
    source: { id: 'rss', name: 'Acme Analytics Blog', url: 'https://acme.example/blog' },
    title: 'Five ways to cut churn',
    url: 'https://acme.example/blog/five-ways-to-cut-churn',
    publishedAt: '2026-11-09T09:00:00Z',
    brief: "Acme published: 'Five ways to cut churn'. Write our own take.",
    ...patch,
  };
}

const FIVE: DiscoverItem[] = [
  item(),
  item({
    id: 'c2',
    source: { id: 'youtube', name: 'Acme Analytics' },
    title: 'Reading a retention chart',
    url: 'https://www.youtube.com/watch?v=SAMPLE',
  }),
  item({
    id: 'c3',
    source: { id: 'bluesky', name: 'Bluesky' },
    title: 'Scheduled reports are live.',
    url: 'https://bsky.app/profile/acme.example/post/1',
  }),
  item({
    id: 'c4',
    source: { id: 'mastodon', name: 'Mastodon' },
    title: 'نبحث عن مهندس دعم',
    url: 'https://mastodon.example/@acme/2',
  }),
  item({
    id: 'c5',
    source: { id: 'google-news', name: 'Sample Business Daily' },
    title: 'Acme Analytics raises a round',
    url: undefined,
    opaqueUrl: 'https://news.google.com/rss/articles/CBMiSAMPLE?oc=5',
  }),
];

describe('CompetitorRows', () => {
  it('tags each row with its kind, in the order given', () => {
    render(<CompetitorRows items={FIVE} now={NOW} />);

    const rows = screen.getAllByTestId('discover-competitor-row');
    expect(screen.getByRole('list')).toContainElement(rows[0]);
    expect(rows.map((row) => row.getAttribute('data-kind'))).toEqual([
      'blog',
      'youtube',
      'bluesky',
      'mastodon',
      'news',
    ]);
    const tags = ['Blog', 'YouTube', 'Bluesky', 'Mastodon', 'News'];
    rows.forEach((row, index) => {
      expect(within(row).getByText(tags[index])).toBeInTheDocument();
    });
  });

  it('names the publisher on a News row only', () => {
    render(<CompetitorRows items={FIVE} now={NOW} />);

    const rows = screen.getAllByTestId('discover-competitor-row');
    expect(within(rows[4]).getByTestId('competitor-publisher')).toHaveTextContent(
      'Sample Business Daily',
    );
    expect(within(rows[0]).queryByTestId('competitor-publisher')).not.toBeInTheDocument();
    expect(within(rows[0]).queryByText('Acme Analytics Blog')).not.toBeInTheDocument();
  });

  it('says when each was published', () => {
    render(<CompetitorRows items={[item()]} now={NOW} />);

    expect(screen.getByTestId('competitor-when')).toHaveTextContent('1 day ago');
  });

  it('leaves the time out when the item has no date', () => {
    render(<CompetitorRows items={[item({ publishedAt: undefined })]} now={NOW} />);

    expect(screen.queryByTestId('competitor-when')).not.toBeInTheDocument();
  });

  it('links the title and Open out of the app, Open named for a screen reader', () => {
    render(<CompetitorRows items={[item()]} now={NOW} />);

    const title = screen.getByRole('link', { name: 'Five ways to cut churn' });
    const open = screen.getByRole('link', { name: 'Open Five ways to cut churn in a new tab' });
    for (const link of [title, open]) {
      expect(link).toHaveAttribute('href', 'https://acme.example/blog/five-ways-to-cut-churn');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it("opens a story through Google's redirect when that is all there is", () => {
    render(<CompetitorRows items={[FIVE[4]]} now={NOW} />);

    expect(
      screen.getByRole('link', { name: 'Open Acme Analytics raises a round in a new tab' }),
    ).toHaveAttribute('href', 'https://news.google.com/rss/articles/CBMiSAMPLE?oc=5');
  });

  it('never makes a link of an address that is not the web', () => {
    render(<CompetitorRows items={[item({ url: 'javascript:alert(1)' })]} now={NOW} />);

    expect(screen.getByText('Five ways to cut churn')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('lets the browser pick the direction of a title', () => {
    render(<CompetitorRows items={[FIVE[3]]} now={NOW} />);

    expect(screen.getByRole('link', { name: 'نبحث عن مهندس دعم' }).closest('[dir]')).toHaveAttribute(
      'dir',
      'auto',
    );
  });

  it('hands Create Post the item', () => {
    const onCreatePost = jest.fn();
    render(<CompetitorRows items={FIVE} now={NOW} onCreatePost={onCreatePost} />);

    const rows = screen.getAllByTestId('discover-competitor-row');
    fireEvent.click(within(rows[2]).getByRole('button', { name: /^Create Post( for |$)/ }));

    expect(onCreatePost).toHaveBeenCalledTimes(1);
    expect(onCreatePost).toHaveBeenCalledWith(FIVE[2]);
  });

  it('has no Create Post without somewhere to send it', () => {
    render(<CompetitorRows items={[item()]} now={NOW} />);

    expect(screen.queryByRole('button', { name: /^Create Post( for |$)/ })).not.toBeInTheDocument();
  });

  it('puts what it is handed after Open', () => {
    render(
      <CompetitorRows
        items={[item()]}
        now={NOW}
        renderExtra={(row) => <button type="button">Read {row.id}</button>}
      />,
    );

    const open = screen.getByRole('link', { name: /^Open/ });
    const extra = screen.getByRole('button', { name: 'Read c1' });
    expect(open.compareDocumentPosition(extra) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
