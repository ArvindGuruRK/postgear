/**
 * The calendar and the queue are read only to an Editor (Sprint 13, Module
 * 14): no drag, no Reschedule or Post Now, Delete for drafts only. Opening a
 * post in the composer stays.
 */
import { TooltipProvider } from '@postgear/ui';
import { render, screen } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import type { PostSummary } from '@/types/post';
import { postAbilities } from '../posts/post-abilities';
import { PostDetailDialog } from '../posts/post-detail-dialog';
import { PostCard } from './post-card';

beforeAll(() => stubBrowserLayout());

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function post(state: PostSummary['state'], channelState = state): PostSummary {
  return {
    group: `g-${state}`,
    state,
    publishDate: '2030-01-01T10:00:00.000Z',
    updatedAt: '2029-12-01T10:00:00.000Z',
    preview: 'Hello',
    parts: 1,
    tags: [],
    intervalInDays: null,
    channels: [
      {
        channelId: 'c1',
        name: 'Acme',
        providerIdentifier: 'x',
        picture: null,
        state: channelState,
        releaseURL: null,
        error: null,
      },
    ],
  } as unknown as PostSummary;
}

const NOW = new Date('2029-12-15T10:00:00.000Z');

describe('postAbilities', () => {
  it('gives an Editor nothing that moves or publishes a post', () => {
    for (const state of ['DRAFT', 'QUEUE', 'ERROR'] as const) {
      const can = postAbilities(post(state), true);
      expect(can.publishNow).toBe(false);
      expect(can.reschedule).toBe(false);
      expect(can.drag).toBe(false);
    }
  });

  it('lets an Editor delete a draft only', () => {
    expect(postAbilities(post('DRAFT'), true).remove).toBe(true);
    expect(postAbilities(post('QUEUE'), true).remove).toBe(false);
    expect(postAbilities(post('ERROR'), true).remove).toBe(false);
  });

  it('keeps the rules for everyone else', () => {
    expect(postAbilities(post('QUEUE'))).toEqual({
      publishNow: true,
      reschedule: true,
      drag: true,
      remove: true,
    });
    expect(postAbilities(post('DRAFT')).publishNow).toBe(false);
    const published = postAbilities(post('PUBLISHED'));
    expect(published.reschedule || published.drag || published.remove).toBe(false);
  });
});

describe('for an Editor', () => {
  it('a card has no grip to drag', () => {
    render(
      <TooltipProvider>
        <PostCard post={post('QUEUE')} now={NOW} editHref="/org-1/composer?group=g" draftsOnly />
      </TooltipProvider>,
    );
    expect(screen.queryByTestId('post-card-grip')).toBeNull();
  });

  it('the detail dialog offers no Reschedule or Post Now, and still opens the composer', () => {
    render(
      <PostDetailDialog
        orgId="org-1"
        post={post('QUEUE')}
        now={NOW}
        busy={false}
        draftsOnly
        onOpenChange={jest.fn()}
        onPublishNow={jest.fn()}
        onReschedule={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /Reschedule/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Post Now/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete Post' })).toBeNull();
    expect(screen.getByRole('link', { name: /Edit/ }).getAttribute('href')).toBe(
      '/org-1/composer?group=g-QUEUE',
    );
  });

  it('an admin keeps the grip and the dialog actions', () => {
    render(
      <TooltipProvider>
        <PostCard post={post('QUEUE')} now={NOW} editHref="/org-1/composer?group=g" />
      </TooltipProvider>,
    );
    expect(screen.getByTestId('post-card-grip')).toBeTruthy();
  });
});
